// js/dataset-ui.js — Dataset panel + modals + bulk actions.
import { el, $, showToast } from './dom.js';
import { state, liveItems } from './state.js';
import { renderView, updateStats, updateDirtyBadge, setActive } from './view.js';
import { analyzeSchema, renderSidebar } from './schema.js';
import { confirmModal } from './modal.js';
import { recomputeItemMetrics, rebuildCardInPlace, exportRawFor } from './view-card.js';
import { fmtNum } from './path.js';
import {
  profileDataset, computeStats, lintAll,
  exactDedup, nearDedup, rowText, rowAssistantText,
  redactJSON, redactPII, PII_PATTERNS,
  shareGPTToOpenAI, openAIToShareGPT, alpacaToOpenAI, completionToOpenAI,
  splitDataset, sample,
  leakageCheck, validateAgainstSchema, detectRowFormat,
  applyOps, dryRunOps, diffJSON,
} from './dataset.js';

const FMT_LABEL = {
  'openai-chat': 'OpenAI chat',
  'openai-chat-loose': 'OpenAI-ish chat',
  'sharegpt': 'ShareGPT',
  'preference-pair': 'Preference pair (DPO)',
  'alpaca': 'Alpaca',
  'completion': 'Prompt/Completion',
  'qa': 'Q/A',
  'text': 'Text',
  'array': 'Array',
  'object': 'Object',
  'parse-error': 'Parse error',
  'unknown': 'Unknown',
};

/* ---------- Generic dataset modal helper ---------- */

function openDatasetModal(title, contentEl, opts = {}){
  const overlay = el('div', 'ds-overlay');
  const box = el('div', 'ds-box');
  const head = el('div', 'ds-head');
  head.append(el('div', 'ds-title', title));
  const closeBtn = el('button', 'mini-btn', 'Close');
  head.append(closeBtn);
  const body = el('div', 'ds-body');
  body.append(contentEl);
  const foot = el('div', 'ds-foot');
  if (opts.actions){
    for (const a of opts.actions) foot.append(a);
  }
  box.append(head, body, foot);
  overlay.append(box);
  document.body.append(overlay);
  const close = () => overlay.remove();
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', function onKey(e){
    if (!overlay.isConnected){ document.removeEventListener('keydown', onKey, true); return; }
    if (e.key === 'Escape'){ e.preventDefault(); close(); document.removeEventListener('keydown', onKey, true); }
  }, true);
  return { overlay, body, foot, close };
}

/* ---------- Format profile + stats panel ---------- */

export function openFormatProfile(){
  const items = state.items;
  const prof = profileDataset(items);
  const stats = computeStats(items);
  const wrap = el('div', 'ds-section');
  if (!prof.total){
    wrap.append(el('div', 'side-empty', 'No rows loaded.'));
    openDatasetModal('Format profile', wrap);
    return;
  }
  const dom = el('div', 'ds-row',
    `Dominant: ${FMT_LABEL[prof.dominant] || prof.dominant} (${(prof.dominantPct*100).toFixed(1)}%)`);
  wrap.append(dom);
  const tbl = el('table', 'ds-table');
  const head = el('tr');
  head.append(el('th',null,'Format'), el('th',null,'Count'), el('th',null,'Pct'));
  tbl.append(head);
  for (const [name, n] of prof.counts){
    const tr = el('tr');
    tr.append(
      el('td',null, FMT_LABEL[name] || name),
      el('td',null, fmtNum(n)),
      el('td',null, ((n/prof.total)*100).toFixed(1) + '%')
    );
    tbl.append(tr);
  }
  wrap.append(tbl);
  // Stats summary
  const sec = el('div','ds-section');
  sec.append(el('h3',null,'Token estimate'));
  const t = stats.tokens;
  sec.append(el('div','ds-grid',
    `n=${fmtNum(t.count)} • min=${fmtNum(t.min)} • p50=${fmtNum(t.p50)} • p90=${fmtNum(t.p90)} • p99=${fmtNum(t.p99)} • max=${fmtNum(t.max)} • Σ≈${fmtNum(t.sum)}`));
  sec.append(histogram(stats.tokenBuckets, 'tokens'));
  if (stats.turns.count){
    sec.append(el('h3',null,'Turns per row'));
    const u = stats.turns;
    sec.append(el('div','ds-grid',
      `min=${u.min} • p50=${u.p50} • p90=${u.p90} • max=${u.max}`));
    sec.append(histogram(stats.turnBuckets, 'turns'));
    sec.append(el('h3',null,'Role distribution'));
    const rl = el('div','ds-roles');
    for (const [role, n] of stats.roleCount){
      rl.append(el('span','ds-chip', `${role}: ${fmtNum(n)}`));
    }
    sec.append(rl);
  }
  wrap.append(sec);
  openDatasetModal('Format profile + stats', wrap);
}

function histogram(buckets, label){
  if (!buckets.length) return el('div','side-empty','no data');
  const max = Math.max(...buckets.map(b => b.count));
  const wrap = el('div','ds-hist');
  for (const b of buckets){
    const row = el('div','ds-hist-row');
    row.append(el('span','ds-hist-label', `${Math.floor(b.lo)}–${Math.floor(b.hi)}`));
    const bar = el('div','ds-hist-bar');
    const fill = el('div','ds-hist-fill');
    fill.style.width = max ? `${(b.count / max) * 100}%` : '0%';
    bar.append(fill);
    row.append(bar);
    row.append(el('span','ds-hist-count', fmtNum(b.count)));
    wrap.append(row);
  }
  return wrap;
}

/* ---------- Dedup ---------- */

export function openDedup(){
  const wrap = el('div','ds-section');
  const ctrl = el('div','ds-controls');
  ctrl.append(el('label',null,'Mode'));
  const mode = document.createElement('select');
  mode.className = 'select';
  for (const opt of [
    {v:'exact-row', t:'Exact (entire row)'},
    {v:'exact-assistant', t:'Exact (assistant text)'},
    {v:'near-row', t:'Near-duplicate (entire row, simhash)'},
    {v:'near-assistant', t:'Near-duplicate (assistant text)'}
  ]){
    const o = document.createElement('option'); o.value = opt.v; o.textContent = opt.t; mode.append(o);
  }
  ctrl.append(mode);
  ctrl.append(el('label',null,'Hamming ≤'));
  const ham = document.createElement('input');
  ham.type = 'number'; ham.value = '4'; ham.min = '0'; ham.max = '32'; ham.className = 'num-input';
  ctrl.append(ham);
  const runBtn = el('button','btn primary','Find duplicates');
  ctrl.append(runBtn);
  wrap.append(ctrl);
  const result = el('div','ds-result');
  wrap.append(result);

  const m = openDatasetModal('Deduplicate', wrap);

  runBtn.addEventListener('click', () => {
    const items = state.items;
    let groups;
    const m1 = mode.value;
    if (m1 === 'exact-row') groups = exactDedup(items, rowText);
    else if (m1 === 'exact-assistant') groups = exactDedup(items, rowAssistantText);
    else if (m1 === 'near-row') groups = nearDedup(items, rowText, +ham.value || 4);
    else groups = nearDedup(items, rowAssistantText, +ham.value || 4);
    renderDedupGroups(result, groups);
  });
}

function renderDedupGroups(container, groups){
  container.replaceChildren();
  if (!groups.length){ container.append(el('div','side-empty','No duplicates found.')); return; }
  const dupCount = groups.reduce((a, g) => a + (g.length - 1), 0);
  const head = el('div','ds-row',
    `${groups.length} cluster${groups.length===1?'':'s'} • ${dupCount} extra row${dupCount===1?'':'s'} could be deleted (keeping one per cluster)`);
  container.append(head);
  const actions = el('div','ds-controls');
  const keepFirstBtn = el('button','btn','Delete all but first per cluster');
  const excludeBtn = el('button','btn','Exclude all but first per cluster');
  actions.append(keepFirstBtn, excludeBtn);
  container.append(actions);

  const list = el('div','ds-cluster-list');
  groups.forEach((g, i) => {
    const cl = el('div','ds-cluster');
    const h = el('div','ds-cluster-head', `Cluster ${i+1} • ${g.length} rows`);
    cl.append(h);
    for (const oi of g){
      const it = state.items[oi];
      const row = el('div','ds-cluster-row');
      const goto = el('button','mini-btn','#' + (it.fileIdx + 1));
      goto.addEventListener('click', () => { setActive(oi, true); });
      const preview = el('span','ds-cluster-text', rowText(it).slice(0, 200));
      row.append(goto, preview);
      cl.append(row);
    }
    list.append(cl);
  });
  container.append(list);

  keepFirstBtn.addEventListener('click', async () => {
    const ok = await confirmModal({title:'Delete duplicates?',
      body:`This will mark ${groups.reduce((a,g)=>a+g.length-1,0)} rows as deleted (keeping the first in each cluster).`,
      okLabel:'Delete', dangerous:true});
    if (!ok) return;
    let n = 0;
    for (const g of groups){
      for (let i = 1; i < g.length; i++){
        const it = state.items[g[i]];
        if (!it.deleted){ it.deleted = true; n++; }
      }
    }
    analyzeSchema(); renderSidebar(); renderView(); updateDirtyBadge();
    showToast(`Deleted ${n} duplicate${n===1?'':'s'}`);
  });

  excludeBtn.addEventListener('click', () => {
    let n = 0;
    for (const g of groups){
      for (let i = 1; i < g.length; i++){
        const it = state.items[g[i]];
        if (!it.excluded){ it.excluded = true; n++; }
      }
    }
    renderView(); updateStats();
    showToast(`Excluded ${n} duplicate${n===1?'':'s'}`);
  });
}

/* ---------- PII scrub ---------- */

export function openPIIScrub(){
  const wrap = el('div','ds-section');
  wrap.append(el('div','ds-row','Choose patterns to find/redact.'));
  const opts = el('div','ds-roles');
  const enabled = new Set(PII_PATTERNS.map(p => p.id).filter(id => id !== 'url'));
  for (const p of PII_PATTERNS){
    const lab = el('label','ds-pii-opt');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = enabled.has(p.id);
    cb.addEventListener('change', () => {
      if (cb.checked) enabled.add(p.id); else enabled.delete(p.id);
    });
    lab.append(cb, document.createTextNode(' ' + p.id));
    opts.append(lab);
  }
  wrap.append(opts);

  const result = el('div','ds-result');
  const scanBtn = el('button','btn','Scan');
  const redactBtn = el('button','btn primary','Redact (apply edits)');
  const ctrls = el('div','ds-controls');
  ctrls.append(scanBtn, redactBtn);
  wrap.append(ctrls, result);

  openDatasetModal('PII scrub', wrap);

  scanBtn.addEventListener('click', () => {
    const out = [];
    let total = 0;
    const counts = new Map();
    for (const it of liveItems()){
      if (it.error){
        const r = redactPII(it.rawText, enabled);
        if (r.count) out.push({ origIdx: it.origIdx, count: r.count });
        total += r.count;
      } else {
        const [, n] = redactJSON(it.parsed, enabled);
        if (n) out.push({ origIdx: it.origIdx, count: n });
        total += n;
      }
    }
    result.replaceChildren();
    result.append(el('div','ds-row', `Found ${total} match${total===1?'':'es'} across ${out.length} row${out.length===1?'':'s'}`));
    const list = el('div','ds-cluster-list');
    for (const r of out.slice(0, 200)){
      const it = state.items[r.origIdx];
      const row = el('div','ds-cluster-row');
      const goto = el('button','mini-btn','#' + (it.fileIdx + 1));
      goto.addEventListener('click', () => setActive(r.origIdx, true));
      row.append(goto, el('span',null,`${r.count} hit${r.count===1?'':'s'}`));
      list.append(row);
    }
    if (out.length > 200) list.append(el('div','side-empty', `… and ${out.length - 200} more`));
    result.append(list);
  });

  redactBtn.addEventListener('click', async () => {
    const ok = await confirmModal({title:'Apply PII redaction?',
      body:'Matched substrings will be replaced with tokens like <EMAIL>. Edits become unsaved (review before save).',
      okLabel:'Apply'});
    if (!ok) return;
    let touched = 0, total = 0;
    for (const it of liveItems()){
      if (it.error) continue;
      const [next, n] = redactJSON(it.parsed, enabled);
      if (n){
        it.parsed = next;
        it.dirty = true;
        recomputeItemMetrics(it);
        rebuildCardInPlace(it);
        touched++; total += n;
      }
    }
    analyzeSchema(); renderSidebar(); renderView(); updateDirtyBadge();
    showToast(`Redacted ${total} match${total===1?'':'es'} in ${touched} row${touched===1?'':'s'}`);
  });
}

/* ---------- Lint pack ---------- */

export function openLint(){
  const wrap = el('div','ds-section');
  const result = el('div','ds-result');
  const runBtn = el('button','btn primary','Run lint');
  const excludeBtn = el('button','btn','Exclude all errors');
  const ctrls = el('div','ds-controls');
  ctrls.append(runBtn, excludeBtn);
  wrap.append(ctrls, result);

  openDatasetModal('Lint dataset', wrap);

  runBtn.addEventListener('click', () => {
    const all = lintAll(state.items);
    result.replaceChildren();
    if (!all.length){ result.append(el('div','side-empty','No issues found.')); return; }
    const counts = new Map();
    for (const r of all) for (const i of r.issues) counts.set(i.code, (counts.get(i.code)||0)+1);
    const summary = el('div','ds-roles');
    for (const [code, n] of [...counts.entries()].sort((a,b)=>b[1]-a[1])){
      summary.append(el('span','ds-chip', `${code}: ${n}`));
    }
    result.append(el('div','ds-row', `${all.length} row${all.length===1?'':'s'} have issues`));
    result.append(summary);
    const list = el('div','ds-cluster-list');
    for (const r of all.slice(0, 500)){
      const it = state.items[r.origIdx];
      const row = el('div','ds-cluster-row');
      const goto = el('button','mini-btn','#' + (it.fileIdx + 1));
      goto.addEventListener('click', () => setActive(r.origIdx, true));
      row.append(goto);
      const issues = el('span','ds-cluster-text');
      for (const i of r.issues){
        const sp = el('span', `ds-issue ${i.sev}`);
        sp.textContent = i.code;
        sp.title = i.msg;
        issues.append(sp);
      }
      row.append(issues);
      list.append(row);
    }
    if (all.length > 500) list.append(el('div','side-empty', `… and ${all.length - 500} more`));
    result.append(list);
  });

  excludeBtn.addEventListener('click', () => {
    const all = lintAll(state.items);
    let n = 0;
    for (const r of all){
      if (r.issues.some(i => i.sev === 'error')){
        const it = state.items[r.origIdx];
        if (!it.excluded){ it.excluded = true; n++; }
      }
    }
    renderView(); updateStats();
    showToast(`Excluded ${n} row${n===1?'':'s'} with errors`);
  });
}

/* ---------- Schema validate ---------- */

export function openSchemaValidate(){
  const wrap = el('div','ds-section');
  wrap.append(el('div','ds-row','Paste a JSON Schema (Draft-07-ish subset). Each row is validated; failures are listed.'));
  const ta = document.createElement('textarea');
  ta.className = 'ds-schema-input';
  ta.placeholder = '{ "type": "object", "required": ["messages"], "properties": { "messages": { "type":"array", "minItems":1 } } }';
  wrap.append(ta);
  const presets = el('div','ds-controls');
  const presetOpenAI = el('button','mini-btn','OpenAI chat preset');
  const presetSharegpt = el('button','mini-btn','ShareGPT preset');
  const presetAlpaca = el('button','mini-btn','Alpaca preset');
  presets.append(presetOpenAI, presetSharegpt, presetAlpaca);
  wrap.append(presets);
  const result = el('div','ds-result');
  const runBtn = el('button','btn primary','Validate');
  const excludeBtn = el('button','btn','Exclude failures');
  const ctrls = el('div','ds-controls');
  ctrls.append(runBtn, excludeBtn);
  wrap.append(ctrls, result);

  openDatasetModal('JSON Schema validate', wrap);

  presetOpenAI.addEventListener('click', () => {
    ta.value = JSON.stringify({
      type:'object', required:['messages'],
      properties:{
        messages:{ type:'array', minItems:1, items:{
          type:'object', required:['role','content'],
          properties:{
            role:{ type:'string', enum:['system','user','assistant','tool','function'] },
            content:{ type:['string','array','null'] }
          }
        }}
      }
    }, null, 2);
  });
  presetSharegpt.addEventListener('click', () => {
    ta.value = JSON.stringify({
      type:'object', required:['conversations'],
      properties:{
        conversations:{ type:'array', minItems:1, items:{
          type:'object', required:['from','value'],
          properties:{ from:{type:'string'}, value:{type:'string'} }
        }}
      }
    }, null, 2);
  });
  presetAlpaca.addEventListener('click', () => {
    ta.value = JSON.stringify({
      type:'object', required:['instruction','output'],
      properties:{
        instruction:{ type:'string', minLength:1 },
        input:{ type:'string' },
        output:{ type:'string', minLength:1 }
      }
    }, null, 2);
  });

  let lastFailures = [];

  runBtn.addEventListener('click', () => {
    let schema;
    try { schema = JSON.parse(ta.value); }
    catch (e){ showToast('Invalid JSON: ' + e.message, 'err'); return; }
    const failures = [];
    for (const it of liveItems()){
      if (it.error){ failures.push({ origIdx: it.origIdx, errs: [{ path:'$', msg:'parse error' }] }); continue; }
      const errs = validateAgainstSchema(it.parsed, schema);
      if (errs.length) failures.push({ origIdx: it.origIdx, errs });
    }
    lastFailures = failures;
    result.replaceChildren();
    result.append(el('div','ds-row', failures.length
      ? `${failures.length} row${failures.length===1?'':'s'} failed validation`
      : 'All rows pass.'));
    const list = el('div','ds-cluster-list');
    for (const f of failures.slice(0, 500)){
      const it = state.items[f.origIdx];
      const row = el('div','ds-cluster-row');
      const goto = el('button','mini-btn','#' + (it.fileIdx + 1));
      goto.addEventListener('click', () => setActive(f.origIdx, true));
      row.append(goto);
      const errs = el('span','ds-cluster-text', f.errs.slice(0,3).map(e => `${e.path}: ${e.msg}`).join(' | '));
      row.append(errs);
      list.append(row);
    }
    if (failures.length > 500) list.append(el('div','side-empty', `… and ${failures.length - 500} more`));
    result.append(list);
  });

  excludeBtn.addEventListener('click', () => {
    let n = 0;
    for (const f of lastFailures){
      const it = state.items[f.origIdx];
      if (!it.excluded){ it.excluded = true; n++; }
    }
    renderView(); updateStats();
    showToast(`Excluded ${n} failing row${n===1?'':'s'}`);
  });
}

/* ---------- Format convert ---------- */

export function openConvert(){
  const wrap = el('div','ds-section');
  wrap.append(el('div','ds-row','Convert all rows in this file to OpenAI chat format. Source format is auto-detected per row.'));
  const result = el('div','ds-result');
  const runBtn = el('button','btn primary','Convert all → OpenAI chat');
  const sharegptBtn = el('button','btn','OpenAI → ShareGPT');
  wrap.append(el('div','ds-controls', null), result);
  wrap.querySelector('.ds-controls').append(runBtn, sharegptBtn);
  openDatasetModal('Format convert', wrap);

  runBtn.addEventListener('click', async () => {
    const ok = await confirmModal({title:'Convert?', body:'All rows will be edited in place to OpenAI chat. Save to apply.', okLabel:'Convert'});
    if (!ok) return;
    let n = 0, skipped = 0;
    for (const it of liveItems()){
      if (it.error){ skipped++; continue; }
      const fmt = detectRowFormat(it.parsed);
      let next = null;
      if (fmt === 'sharegpt') next = shareGPTToOpenAI(it.parsed);
      else if (fmt === 'alpaca') next = alpacaToOpenAI(it.parsed);
      else if (fmt === 'completion') next = completionToOpenAI(it.parsed);
      else if (fmt === 'openai-chat' || fmt === 'openai-chat-loose') { skipped++; continue; }
      else { skipped++; continue; }
      it.parsed = next; it.dirty = true;
      recomputeItemMetrics(it); rebuildCardInPlace(it); n++;
    }
    analyzeSchema(); renderSidebar(); renderView(); updateDirtyBadge();
    showToast(`Converted ${n} row${n===1?'':'s'} • ${skipped} skipped`);
  });

  sharegptBtn.addEventListener('click', async () => {
    const ok = await confirmModal({title:'Convert?', body:'OpenAI chat rows → ShareGPT (conversations[]).', okLabel:'Convert'});
    if (!ok) return;
    let n = 0, skipped = 0;
    for (const it of liveItems()){
      if (it.error){ skipped++; continue; }
      const fmt = detectRowFormat(it.parsed);
      if (fmt !== 'openai-chat' && fmt !== 'openai-chat-loose'){ skipped++; continue; }
      it.parsed = openAIToShareGPT(it.parsed);
      it.dirty = true;
      recomputeItemMetrics(it); rebuildCardInPlace(it); n++;
    }
    analyzeSchema(); renderSidebar(); renderView(); updateDirtyBadge();
    showToast(`Converted ${n} row${n===1?'':'s'} • ${skipped} skipped`);
  });
}

/* ---------- Sample / split ---------- */

export function openSplit(){
  const wrap = el('div','ds-section');
  wrap.append(el('div','ds-row','Shuffle and split into train/val/test files (downloaded as JSONL).'));
  const ctrls = el('div','ds-controls');
  ctrls.append(el('label',null,'Train'));
  const tr = document.createElement('input'); tr.type='number'; tr.value='0.8'; tr.step='0.05'; tr.className='num-input';
  ctrls.append(tr);
  ctrls.append(el('label',null,'Val'));
  const va = document.createElement('input'); va.type='number'; va.value='0.1'; va.step='0.05'; va.className='num-input';
  ctrls.append(va);
  ctrls.append(el('label',null,'Test'));
  const te = document.createElement('input'); te.type='number'; te.value='0.1'; te.step='0.05'; te.className='num-input';
  ctrls.append(te);
  ctrls.append(el('label',null,'Seed'));
  const sd = document.createElement('input'); sd.type='number'; sd.value='1'; sd.className='num-input';
  ctrls.append(sd);
  const runBtn = el('button','btn primary','Split + download');
  ctrls.append(runBtn);
  wrap.append(ctrls);

  const sampleSec = el('div','ds-section');
  sampleSec.append(el('h3',null,'Or sample N rows'));
  const sctrls = el('div','ds-controls');
  sctrls.append(el('label',null,'N'));
  const nIn = document.createElement('input'); nIn.type='number'; nIn.value='100'; nIn.className='num-input';
  sctrls.append(nIn);
  const sampleBtn = el('button','btn','Sample + download');
  sctrls.append(sampleBtn);
  sampleSec.append(sctrls);
  wrap.append(sampleSec);

  openDatasetModal('Sample / split', wrap);

  runBtn.addEventListener('click', () => {
    const ratios = [+tr.value || 0, +va.value || 0, +te.value || 0];
    const seed = +sd.value || 1;
    const splits = splitDataset(state.items, ratios, seed);
    const labels = ['train', 'val', 'test'];
    splits.forEach((idxs, i) => {
      const lines = idxs.map(oi => exportRawFor(state.items[oi])).filter(Boolean);
      downloadText(`${baseName()}-${labels[i]}.jsonl`, lines.join('\n') + '\n', 'application/jsonl');
    });
    showToast(`Split: ${splits.map((s,i)=>`${labels[i]}=${s.length}`).join(' • ')}`);
  });

  sampleBtn.addEventListener('click', () => {
    const idxs = sample(state.items, +nIn.value || 100, +sd.value || 1);
    const lines = idxs.map(oi => exportRawFor(state.items[oi])).filter(Boolean);
    downloadText(`${baseName()}-sample-${idxs.length}.jsonl`, lines.join('\n') + '\n', 'application/jsonl');
    showToast(`Sampled ${idxs.length} row${idxs.length===1?'':'s'}`);
  });
}

function baseName(){
  return (state.fileName || 'dataset').replace(/\.(json|jsonl|txt|log)$/i, '');
}

function downloadText(name, text, mime){
  const blob = new Blob([text], {type:mime});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- Leakage check ---------- */

export function openLeakage(){
  const wrap = el('div','ds-section');
  wrap.append(el('div','ds-row','Pick another open file (file B) to compare against the active file (file A). Reports rows in B that overlap A.'));
  const ctrls = el('div','ds-controls');
  ctrls.append(el('label',null,'File B'));
  const sel = document.createElement('select'); sel.className = 'select';
  for (const slot of state.files){
    if (slot.id === state.activeId) continue;
    const s = slot.snapshot || {};
    const o = document.createElement('option');
    o.value = slot.id; o.textContent = s.fileName || slot.id;
    sel.append(o);
  }
  ctrls.append(sel);
  ctrls.append(el('label',null,'min length'));
  const mn = document.createElement('input'); mn.type='number'; mn.value='64'; mn.className='num-input';
  ctrls.append(mn);
  ctrls.append(el('label',null,'Hamming ≤'));
  const ha = document.createElement('input'); ha.type='number'; ha.value='4'; ha.className='num-input';
  ctrls.append(ha);
  const runBtn = el('button','btn primary','Check');
  ctrls.append(runBtn);
  wrap.append(ctrls);
  const result = el('div','ds-result');
  wrap.append(result);

  openDatasetModal('Leakage check', wrap);

  runBtn.addEventListener('click', () => {
    const slot = state.files.find(s => s.id === sel.value);
    if (!slot){ showToast('Pick a file', 'err'); return; }
    const itemsA = state.items;
    const itemsB = slot.snapshot?.items || [];
    if (!itemsB.length){ showToast('File B has no rows (open it once to load).', 'err'); return; }
    const hits = leakageCheck(itemsA, itemsB, { minLen: +mn.value || 64, nearHamming: +ha.value || 4 });
    result.replaceChildren();
    result.append(el('div','ds-row', `${hits.length} row${hits.length===1?'':'s'} in B overlap A`));
    const list = el('div','ds-cluster-list');
    for (const h of hits.slice(0, 500)){
      const row = el('div','ds-cluster-row');
      row.append(el('span','ds-issue ' + (h.kind === 'exact' ? 'error' : 'warn'), h.kind));
      row.append(el('span',null, `B#${h.origIdx}` + (h.matchA != null ? ` ↔ A#${h.matchA}` : '')));
      list.append(row);
    }
    if (hits.length > 500) list.append(el('div','side-empty', `… and ${hits.length - 500} more`));
    result.append(list);
  });
}

/* ---------- Bulk transform ---------- */

export function openBulkTransform(){
  const wrap = el('div','ds-section');
  wrap.append(el('div','ds-row','Apply declarative transforms to every row. Dry-run shows preview before applying.'));
  const ops = [];
  const opsList = el('div','ds-cluster-list');
  const renderOps = () => {
    opsList.replaceChildren();
    if (!ops.length){ opsList.append(el('div','side-empty','No ops added.')); return; }
    ops.forEach((op, i) => {
      const row = el('div','ds-cluster-row');
      row.append(el('span',null, JSON.stringify(op)));
      const rm = el('button','mini-btn warn','×');
      rm.addEventListener('click', () => { ops.splice(i,1); renderOps(); });
      row.append(rm);
      opsList.append(row);
    });
  };
  renderOps();

  // Op builder
  const builder = el('div','ds-controls');
  const opSel = document.createElement('select'); opSel.className='select';
  const opChoices = [
    'regex-replace', 'set-key', 'remove-key', 'rename-key',
    'drop-empty-turns', 'lowercase-roles', 'trim-whitespace', 'drop-system'
  ];
  for (const o of opChoices){
    const opt = document.createElement('option'); opt.value = o; opt.textContent = o;
    opSel.append(opt);
  }
  builder.append(opSel);
  const arg1 = document.createElement('input'); arg1.placeholder='arg 1'; arg1.className='search';
  const arg2 = document.createElement('input'); arg2.placeholder='arg 2'; arg2.className='search';
  const arg3 = document.createElement('input'); arg3.placeholder='arg 3 (scope: all|user|assistant|system)'; arg3.className='search';
  builder.append(arg1, arg2, arg3);

  const updateArgPlaceholders = () => {
    const v = opSel.value;
    arg1.style.display = arg2.style.display = arg3.style.display = '';
    if (v === 'regex-replace'){ arg1.placeholder='regex pattern'; arg2.placeholder='replacement'; arg3.placeholder='scope (all|user|assistant)'; }
    else if (v === 'set-key'){ arg1.placeholder='key'; arg2.placeholder='value (JSON)'; arg3.style.display='none'; }
    else if (v === 'remove-key'){ arg1.placeholder='key'; arg2.style.display=arg3.style.display='none'; }
    else if (v === 'rename-key'){ arg1.placeholder='from key'; arg2.placeholder='to key'; arg3.style.display='none'; }
    else { arg1.style.display=arg2.style.display=arg3.style.display='none'; }
  };
  opSel.addEventListener('change', updateArgPlaceholders);
  updateArgPlaceholders();

  const addBtn = el('button','btn','Add op');
  builder.append(addBtn);
  wrap.append(builder, opsList);

  addBtn.addEventListener('click', () => {
    const v = opSel.value;
    let op = { op:v };
    if (v === 'regex-replace'){
      op.pattern = arg1.value; op.replacement = arg2.value; op.flags = 'g';
      if (arg3.value) op.scope = arg3.value;
    } else if (v === 'set-key'){
      op.key = arg1.value;
      try { op.value = JSON.parse(arg2.value); } catch { op.value = arg2.value; }
    } else if (v === 'remove-key'){
      op.key = arg1.value;
    } else if (v === 'rename-key'){
      op.from = arg1.value; op.to = arg2.value;
    }
    ops.push(op);
    renderOps();
  });

  const dryRunBtn = el('button','btn','Dry run');
  const applyBtn = el('button','btn primary','Apply');
  const ctrls = el('div','ds-controls');
  ctrls.append(dryRunBtn, applyBtn);
  wrap.append(ctrls);
  const result = el('div','ds-result');
  wrap.append(result);

  openDatasetModal('Bulk transform', wrap);

  dryRunBtn.addEventListener('click', () => {
    if (!ops.length){ showToast('No ops'); return; }
    const r = dryRunOps(state.items, ops, 20);
    result.replaceChildren();
    result.append(el('div','ds-row', `${r.touched} row${r.touched===1?'':'s'} would change • ${r.errors} error${r.errors===1?'':'s'}`));
    for (const p of r.preview.filter(p => p.changed || p.err).slice(0, 5)){
      const cl = el('div','ds-cluster');
      cl.append(el('div','ds-cluster-head', `Row #${state.items[p.origIdx].fileIdx + 1}`));
      if (p.err){
        cl.append(el('div','ds-issue error', p.err));
      } else {
        const before = el('pre','ds-pre', JSON.stringify(p.before, null, 2).slice(0, 1200));
        const after = el('pre','ds-pre', JSON.stringify(p.after, null, 2).slice(0, 1200));
        cl.append(el('div','ds-row','BEFORE'), before, el('div','ds-row','AFTER'), after);
      }
      result.append(cl);
    }
  });

  applyBtn.addEventListener('click', async () => {
    if (!ops.length){ showToast('No ops'); return; }
    const ok = await confirmModal({title:'Apply transform?',
      body:`Will edit all matching rows. Save to commit. Ops: ${ops.length}`, okLabel:'Apply'});
    if (!ok) return;
    let touched = 0;
    for (const it of liveItems()){
      if (it.error) continue;
      let next;
      try { next = applyOps(it.parsed, ops); }
      catch (e) { continue; }
      if (JSON.stringify(next) !== JSON.stringify(it.parsed)){
        it.parsed = next;
        it.dirty = true;
        recomputeItemMetrics(it);
        rebuildCardInPlace(it);
        touched++;
      }
    }
    analyzeSchema(); renderSidebar(); renderView(); updateDirtyBadge();
    showToast(`Transform applied to ${touched} row${touched===1?'':'s'}`);
  });
}

/* ---------- Tagging / Review ---------- */

const REVIEW_LABEL = { approve:'✓', reject:'✗', todo:'?' };

export function setRowReview(item, value){
  if (!item) return;
  item.review = value;
  if (item._cardEl) updateCardReviewUI(item);
}

export function toggleRowTag(item, tag){
  if (!item) return;
  if (!Array.isArray(item.tags)) item.tags = [];
  const i = item.tags.indexOf(tag);
  if (i >= 0) item.tags.splice(i,1); else item.tags.push(tag);
  if (item._cardEl) updateCardReviewUI(item);
}

export function updateCardReviewUI(item){
  if (!item._cardEl) return;
  const head = item._cardEl.querySelector('.card-head');
  if (!head) return;
  head.querySelectorAll('.review-badge,.tag-badge').forEach(n => n.remove());
  if (item.review){
    const b = el('span', `review-badge review-${item.review}`, REVIEW_LABEL[item.review] + ' ' + item.review);
    head.append(b);
  }
  for (const t of item.tags || []){
    head.append(el('span','tag-badge', '#' + t));
  }
}

export function openTagging(){
  const wrap = el('div','ds-section');
  wrap.append(el('div','ds-row','Apply review status / tags to active row, or in bulk to filtered set.'));
  const ctrls = el('div','ds-controls');
  const approveAll = el('button','btn','Approve all visible');
  const rejectAll = el('button','btn warn','Reject all visible');
  const clearReview = el('button','btn','Clear review');
  ctrls.append(approveAll, rejectAll, clearReview);
  wrap.append(ctrls);

  const tagBox = el('div','ds-controls');
  tagBox.append(el('label',null,'Tag'));
  const tagInp = document.createElement('input'); tagInp.className='search'; tagInp.placeholder='tag name';
  tagBox.append(tagInp);
  const addTag = el('button','btn','Tag visible');
  const removeTag = el('button','btn','Remove tag from visible');
  tagBox.append(addTag, removeTag);
  wrap.append(tagBox);

  const exclSec = el('div','ds-controls');
  const exclRej = el('button','btn','Exclude all rejected');
  const delRej = el('button','btn warn','Delete all rejected');
  exclSec.append(exclRej, delRej);
  wrap.append(exclSec);

  // Stats
  const stats = el('div','ds-row');
  const refresh = () => {
    let a=0,r=0,t=0,untag=0;
    for (const it of liveItems()){
      if (it.review === 'approve') a++;
      else if (it.review === 'reject') r++;
      else if (it.review === 'todo') t++;
      else untag++;
    }
    stats.textContent = `Approved: ${a} • Rejected: ${r} • Todo: ${t} • Untagged: ${untag}`;
  };
  refresh();
  wrap.append(stats);

  openDatasetModal('Tagging + review', wrap);

  approveAll.addEventListener('click', () => {
    for (const it of state.viewItems) setRowReview(it, 'approve');
    refresh(); renderView();
    showToast(`Approved ${state.viewItems.length}`);
  });
  rejectAll.addEventListener('click', () => {
    for (const it of state.viewItems) setRowReview(it, 'reject');
    refresh(); renderView();
    showToast(`Rejected ${state.viewItems.length}`);
  });
  clearReview.addEventListener('click', () => {
    for (const it of state.viewItems) setRowReview(it, null);
    refresh(); renderView();
  });
  addTag.addEventListener('click', () => {
    const t = tagInp.value.trim(); if (!t){ showToast('Tag is empty'); return; }
    for (const it of state.viewItems){
      if (!Array.isArray(it.tags)) it.tags = [];
      if (!it.tags.includes(t)) it.tags.push(t);
      if (it._cardEl) updateCardReviewUI(it);
    }
    refresh();
    showToast(`Tagged ${state.viewItems.length} with #${t}`);
  });
  removeTag.addEventListener('click', () => {
    const t = tagInp.value.trim(); if (!t) return;
    for (const it of state.viewItems){
      if (Array.isArray(it.tags)) it.tags = it.tags.filter(x => x !== t);
      if (it._cardEl) updateCardReviewUI(it);
    }
    refresh();
  });
  exclRej.addEventListener('click', () => {
    let n = 0;
    for (const it of liveItems()) if (it.review === 'reject' && !it.excluded){ it.excluded = true; n++; }
    renderView();
    showToast(`Excluded ${n}`);
  });
  delRej.addEventListener('click', async () => {
    const ok = await confirmModal({title:'Delete rejected?', body:'Marks all rejected rows as deleted.', okLabel:'Delete', dangerous:true});
    if (!ok) return;
    let n = 0;
    for (const it of liveItems()) if (it.review === 'reject'){ it.deleted = true; n++; }
    analyzeSchema(); renderSidebar(); renderView(); updateDirtyBadge();
    showToast(`Deleted ${n}`);
  });
}

/* ---------- Diff (per-row vs original) ---------- */

export function openDiffActive(){
  const it = state.items[state.activeOrigIdx];
  if (!it){ showToast('No active row', 'err'); return; }
  if (it.error){ showToast('Active row is parse-error', 'err'); return; }
  const wrap = el('div','ds-section');
  if (!it.dirty || !it.originalParsed){
    wrap.append(el('div','side-empty','No edits on this row.'));
    openDatasetModal('Row diff', wrap);
    return;
  }
  const diffs = diffJSON(it.originalParsed, it.parsed);
  if (!diffs.length){
    wrap.append(el('div','side-empty','No structural changes.'));
  } else {
    const list = el('div','ds-cluster-list');
    for (const d of diffs){
      const row = el('div','ds-cluster-row');
      row.append(el('span', `ds-issue ${d.kind === 'add' ? 'warn' : d.kind === 'remove' ? 'error' : ''}`, d.kind));
      row.append(el('span','ds-cluster-text', `${d.path}: ${d.kind === 'add' ? '+' + JSON.stringify(d.to) : d.kind === 'remove' ? '-' + JSON.stringify(d.from) : JSON.stringify(d.from) + ' → ' + JSON.stringify(d.to)}`.slice(0, 240)));
      list.append(row);
    }
    wrap.append(list);
  }
  openDatasetModal(`Diff: row #${it.fileIdx + 1}`, wrap);
}

/* ---------- Side panel renderer ---------- */

export function renderDatasetPanel(){
  const root = document.querySelector('.side-panel[data-panel="dataset"]');
  if (!root) return;
  root.replaceChildren();
  root.append(el('div','side-panel-header','DATASET'));

  const sec1 = el('div','ds-panel-sec');
  sec1.append(el('div','ds-panel-h','Audit'));
  sec1.append(btn('Format profile + stats', openFormatProfile));
  sec1.append(btn('Lint dataset', openLint));
  sec1.append(btn('JSON Schema validate', openSchemaValidate));
  root.append(sec1);

  const sec2 = el('div','ds-panel-sec');
  sec2.append(el('div','ds-panel-h','Curate'));
  sec2.append(btn('Find duplicates', openDedup));
  sec2.append(btn('PII scrub', openPIIScrub));
  sec2.append(btn('Bulk transform', openBulkTransform));
  root.append(sec2);

  const sec3 = el('div','ds-panel-sec');
  sec3.append(el('div','ds-panel-h','Workflow'));
  sec3.append(btn('Tagging + review', openTagging));
  sec3.append(btn('Sample / split', openSplit));
  sec3.append(btn('Format convert', openConvert));
  sec3.append(btn('Leakage check', openLeakage));
  sec3.append(btn('Diff active row', openDiffActive));
  root.append(sec3);

  // Live counts
  const counts = el('div','ds-panel-counts');
  let a=0,r=0,t=0;
  for (const it of liveItems()){
    if (it.review === 'approve') a++;
    else if (it.review === 'reject') r++;
    else if (it.review === 'todo') t++;
  }
  counts.append(el('span','ds-chip', `✓ ${a}`),
                el('span','ds-chip', `✗ ${r}`),
                el('span','ds-chip', `? ${t}`));
  root.append(counts);
}

function btn(label, action){
  const b = el('button','mini-btn ds-panel-btn', label);
  b.addEventListener('click', action);
  return b;
}

/* ---------- Window hooks ---------- */
if (typeof window !== 'undefined'){
  window.__dataset_ui = {
    openFormatProfile, openDedup, openPIIScrub, openLint, openSchemaValidate,
    openConvert, openSplit, openLeakage, openBulkTransform, openTagging,
    openDiffActive,
    renderDatasetPanel, setRowReview, toggleRowTag, updateCardReviewUI,
  };
}

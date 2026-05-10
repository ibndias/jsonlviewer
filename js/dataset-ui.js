// js/dataset-ui.js — Dataset panel + modals + bulk actions.
import { el, $, showToast } from './dom.js';
import { state, liveItems } from './state.js';
import { renderView, updateStats, updateDirtyBadge, setActive } from './view.js';
import { analyzeSchema, renderSidebar } from './schema.js';
import { confirmModal } from './modal.js';
import { recomputeItemMetrics, rebuildCardInPlace, exportRawFor } from './view-card.js';
import { fmtNum } from './path.js';
import {
  profileDataset, computeStats, lintAll, lintRow,
  exactDedup, nearDedup, rowText, rowAssistantText,
  redactJSON, redactPII, scanPII, PII_PATTERNS,
  shareGPTToOpenAI, openAIToShareGPT, alpacaToOpenAI, completionToOpenAI,
  splitDataset, sample,
  leakageCheck, validateAgainstSchema, detectRowFormat, extractTurns,
  applyOps, dryRunOps, diffJSON,
} from './dataset.js';

const REVIEW_LABEL = { approve:'✓', reject:'✗', todo:'?' };

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
  const titleWrap = el('div','ds-title-wrap');
  titleWrap.append(el('div', 'ds-title', title));
  if (opts.subtitle) titleWrap.append(el('div', 'ds-subtitle', opts.subtitle));
  head.append(titleWrap);
  const closeBtn = el('button', 'ds-close-btn', '×');
  closeBtn.setAttribute('aria-label', 'Close');
  head.append(closeBtn);
  const body = el('div', 'ds-body');
  body.append(contentEl);
  const foot = el('div', 'ds-foot');
  if (opts.actions){
    for (const a of opts.actions) foot.append(a);
  } else {
    foot.style.display = 'none';
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

function emptyState(msg){
  const wrap = el('div','ds-empty');
  wrap.append(el('div','ds-empty-icon','◯'));
  wrap.append(el('div','ds-empty-msg', msg));
  return wrap;
}

function ensureFile(){
  if (!state.items.length){ showToast('Load a file first', 'err'); return false; }
  return true;
}

function jumpButton(origIdx, label){
  const it = state.items[origIdx];
  const b = el('button','mini-btn ds-jump', label || ('#' + ((it?.fileIdx ?? 0) + 1)));
  b.title = 'Jump to row';
  b.addEventListener('click', () => setActive(origIdx, true));
  return b;
}

function snippetWithMatch(text, start, end, ctx = 40){
  const s = String(text || '');
  const left  = s.slice(Math.max(0, start - ctx), start);
  const match = s.slice(start, end);
  const right = s.slice(end, Math.min(s.length, end + ctx));
  const wrap = el('div','ds-snippet-row');
  if (Math.max(0, start - ctx) > 0) wrap.append(el('span','ds-ellipsis','…'));
  wrap.append(document.createTextNode(left));
  const mk = el('mark','ds-mark', match);
  wrap.append(mk);
  wrap.append(document.createTextNode(right));
  if (end + ctx < s.length) wrap.append(el('span','ds-ellipsis','…'));
  return wrap;
}

/* ---------- Format profile + stats panel ---------- */

export function openFormatProfile(){
  if (!ensureFile()) return;
  const items = state.items;
  const prof = profileDataset(items);
  const stats = computeStats(items);
  const wrap = el('div', 'ds-section');

  wrap.append(qualityCard(computeQualityScore(prof, stats, state.lastAudit), prof, state.lastAudit));

  const tbl = el('table', 'ds-table');
  const thr = el('tr');
  thr.append(el('th',null,'Format'), el('th',null,'Rows'), el('th',null,'%'), el('th',null,''));
  tbl.append(thr);
  for (const [name, n] of prof.counts){
    const tr = el('tr');
    const pct = (n/prof.total)*100;
    tr.append(
      el('td',null, FMT_LABEL[name] || name),
      el('td',null, fmtNum(n)),
      el('td',null, pct.toFixed(1) + '%')
    );
    const barCell = el('td');
    const bar = el('div','ds-bar');
    const fill = el('div','ds-bar-fill');
    fill.style.width = pct + '%';
    bar.append(fill);
    barCell.append(bar);
    tr.append(barCell);
    tbl.append(tr);
  }
  wrap.append(tbl);

  const sec = el('div','ds-section');
  sec.append(el('h3',null,'Token estimate per row'));
  const t = stats.tokens;
  sec.append(el('div','ds-grid',
    `n=${fmtNum(t.count)} • min=${fmtNum(t.min)} • p50=${fmtNum(t.p50)} • p90=${fmtNum(t.p90)} • p99=${fmtNum(t.p99)} • max=${fmtNum(t.max)} • Σ≈${fmtNum(t.sum)}`));
  sec.append(histogram(stats.tokenBuckets));
  if (stats.turns.count){
    sec.append(el('h3',null,'Turns per row'));
    const u = stats.turns;
    sec.append(el('div','ds-grid',
      `min=${u.min} • p50=${u.p50} • p90=${u.p90} • max=${u.max}`));
    sec.append(histogram(stats.turnBuckets));
    sec.append(el('h3',null,'Role distribution'));
    const rl = el('div','ds-roles');
    for (const [role, n] of stats.roleCount){
      rl.append(el('span','ds-chip', `${role}: ${fmtNum(n)}`));
    }
    sec.append(rl);
  }
  wrap.append(sec);
  openDatasetModal('Format profile + stats', wrap, {
    subtitle: `${fmtNum(prof.total)} rows • dominant: ${FMT_LABEL[prof.dominant] || prof.dominant} (${(prof.dominantPct*100).toFixed(0)}%)`
  });
}

function computeQualityScore(prof, stats, audit){
  const total = prof.total || 1;
  const errPct = (prof.counts.find(([k]) => k === 'parse-error')?.[1] || 0) / total;
  const conformPct = prof.dominantPct || 0;
  // Audit-derived rates (rows-affected / total). Defaults 0 if no audit yet.
  let lintErrPct = 0, piiPct = 0, dupPct = 0;
  if (audit){
    if (audit.lint) for (const issues of audit.lint.values()){
      if (issues.some(i => i.sev === 'error')){ lintErrPct++; }
    }
    lintErrPct = lintErrPct / total;
    if (audit.pii) piiPct = audit.pii.size / total;
    if (audit.dups) dupPct = audit.dups.size / total;
  }
  // Weighted: conformance (40%), no-parse-errs (15%), no-lint-errs (15%),
  // no-PII (15%), no-dups (15%). All penalize linearly.
  const s = 0.40 * conformPct
          + 0.15 * (1 - errPct)
          + 0.15 * (1 - lintErrPct)
          + 0.15 * (1 - piiPct)
          + 0.15 * (1 - dupPct);
  return Math.round(Math.max(0, Math.min(1, s)) * 100);
}

function qualityCard(score, prof, audit){
  const wrap = el('div','ds-quality');
  const ring = el('div','ds-quality-ring');
  ring.style.setProperty('--score', score);
  ring.append(el('div','ds-quality-num', String(score)));
  ring.append(el('div','ds-quality-unit', '/ 100'));
  wrap.append(ring);
  const txt = el('div','ds-quality-text');
  txt.append(el('div','ds-quality-h', score >= 80 ? 'Looks healthy' : score >= 60 ? 'Needs cleanup' : 'High variance'));
  const bits = [`${(prof.dominantPct*100).toFixed(0)}% conform to ${FMT_LABEL[prof.dominant] || prof.dominant}`];
  if (prof.counts.find(([k])=>k==='parse-error')) bits.push('parse errors present');
  if (audit){
    if (audit.lint && audit.lint.size) bits.push(`${audit.lint.size} rows w/ lint`);
    if (audit.pii && audit.pii.size) bits.push(`${audit.pii.size} rows w/ PII`);
    if (audit.dups && audit.dups.size) bits.push(`${audit.dups.size} dup rows`);
    if (audit.stale) bits.push('cache stale — re-run');
  } else {
    bits.push('audit not run');
  }
  txt.append(el('div','ds-quality-d', bits.join(' · ') + '.'));
  wrap.append(txt);
  return wrap;
}

function histogram(buckets){
  if (!buckets.length) return el('div','side-empty','no data');
  const max = Math.max(...buckets.map(b => b.count));
  const wrap = el('div','ds-hist');
  for (const b of buckets){
    const row = el('div','ds-hist-row');
    const lo = Math.round(b.lo), hi = Math.round(b.hi);
    row.append(el('span','ds-hist-label', lo === hi ? String(lo) : `${lo}–${hi}`));
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

/* ---------- Audit overview ---------- */

export function openAuditOverview(){
  if (!ensureFile()) return;
  const wrap = el('div','ds-section');
  const status = el('div','ds-row','Running audits…');
  wrap.append(status);
  const m = openDatasetModal('Audit overview', wrap, { subtitle: 'Profile + Lint + Dedup + PII at a glance' });

  setTimeout(() => {
    const items = state.items;
    const prof = profileDataset(items);
    const stats = computeStats(items);
    const lints = lintAll(items);
    const dupGroups = exactDedup(items, rowText);
    const piiByRow = new Map();
    let piiTotal = 0;
    for (const it of liveItems()){
      const text = it.error ? it.rawText : JSON.stringify(it.parsed);
      const hits = scanPII(text);
      if (hits.length){ piiByRow.set(it.origIdx, hits); piiTotal += hits.length; }
    }
    const lintMap = new Map();
    for (const r of lints) lintMap.set(r.origIdx, r.issues);
    const dupSet = new Set();
    for (const g of dupGroups) for (const i of g) dupSet.add(i);
    state.lastAudit = { lint: lintMap, pii: piiByRow, dups: dupSet, ranAt: Date.now() };
    state.lastAudit.score = computeQualityScore(prof, stats, state.lastAudit);
    state.lastAudit.dominant = prof.dominant;
    state.lastAudit.dominantPct = prof.dominantPct;
    decorateAllCards();

    wrap.replaceChildren();
    const score = state.lastAudit.score;
    wrap.append(qualityCard(score, prof, state.lastAudit));

    const grid = el('div','ds-overview-grid');
    grid.append(overviewCard('Format', `${(prof.dominantPct*100).toFixed(0)}%`, FMT_LABEL[prof.dominant] || prof.dominant, () => { m.close(); openFormatProfile(); }));
    grid.append(overviewCard('Lint issues', fmtNum(lints.length), `${countSeverity(lints,'error')} errors • ${countSeverity(lints,'warn')} warns`, () => { m.close(); openLint(); }));
    grid.append(overviewCard('Duplicates', fmtNum(dupGroups.length), `${fmtNum(dupSet.size)} rows in ${dupGroups.length} cluster${dupGroups.length===1?'':'s'}`, () => { m.close(); openDedup(); }));
    grid.append(overviewCard('PII matches', fmtNum(piiTotal), `${piiByRow.size} row${piiByRow.size===1?'':'s'} with hits`, () => { m.close(); openPIIScrub(); }));
    grid.append(overviewCard('Rows', fmtNum(stats.n), `~${fmtNum(stats.tokens.sum)} tokens total`, null));
    grid.append(overviewCard('Reviewed', countReview('approve') + ' / ' + state.items.filter(x=>!x.deleted).length, `${countReview('reject')} rejected • ${countReview('todo')} todo`, () => { m.close(); openTagging(); }));
    wrap.append(grid);

    const recs = [];
    if (dupGroups.length) recs.push({
      msg: `Resolve ${dupGroups.length} duplicate cluster${dupGroups.length===1?'':'s'} before training.`,
      cta: 'Open dedup', go: () => { m.close(); openDedup(); }
    });
    if (piiTotal) recs.push({
      msg: `Redact ${piiTotal} PII match${piiTotal===1?'':'es'}.`,
      cta: 'Open PII scrub', go: () => { m.close(); openPIIScrub(); }
    });
    if (lints.some(r => r.issues.some(i => i.sev === 'error'))) recs.push({
      msg: 'Fix lint errors (parse-error / empty-output / empty-instruction).',
      cta: 'Open lint', go: () => { m.close(); openLint(); }
    });
    if (prof.dominantPct < 0.95 && prof.dominant !== 'unknown' && prof.total > 1) recs.push({
      msg: `Format-convert non-${FMT_LABEL[prof.dominant]} rows for consistency.`,
      cta: 'Open convert', go: () => { m.close(); openConvert(); }
    });
    if (!recs.length) recs.push({ msg: 'No blocking issues detected.' });
    const rec = el('div','ds-section');
    rec.append(el('h3',null,'Recommended next'));
    const ul = el('div','ds-rec-list');
    for (const r of recs){
      const row = el('div','ds-rec-row');
      row.append(el('span','ds-rec-msg', r.msg));
      if (r.go){
        const b = el('button','mini-btn ds-rec-cta', r.cta);
        b.addEventListener('click', r.go);
        row.append(b);
      }
      ul.append(row);
    }
    rec.append(ul);
    wrap.append(rec);
  }, 30);
}

function overviewCard(label, big, hint, onClick){
  const c = el('div','ds-ov-card' + (onClick ? ' clickable' : ''));
  c.append(el('div','ds-ov-label', label));
  c.append(el('div','ds-ov-big', big));
  c.append(el('div','ds-ov-hint', hint));
  if (onClick) c.addEventListener('click', onClick);
  return c;
}

function countSeverity(lints, sev){
  let n = 0;
  for (const r of lints) for (const i of r.issues) if (i.sev === sev) n++;
  return n;
}

function countReview(value){
  let n = 0;
  for (const it of liveItems()) if (it.review === value) n++;
  return n;
}

/* ---------- Dedup ---------- */

export function openDedup(){
  if (!ensureFile()) return;
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
  ctrl.append(el('label',null,'Keep'));
  const keep = document.createElement('select'); keep.className = 'select';
  for (const o of [['first','First (file order)'], ['last','Last'], ['longest','Longest'], ['shortest','Shortest']]){
    const opt = document.createElement('option'); opt.value = o[0]; opt.textContent = o[1];
    keep.append(opt);
  }
  ctrl.append(keep);
  const runBtn = el('button','btn primary','Find duplicates');
  ctrl.append(runBtn);
  wrap.append(ctrl);
  const result = el('div','ds-result');
  wrap.append(result);

  openDatasetModal('Find duplicates', wrap, { subtitle: 'Exact via FNV-1a · Near via 64-bit simhash + Hamming' });

  runBtn.addEventListener('click', () => {
    const items = state.items;
    let groups;
    const m1 = mode.value;
    if (m1 === 'exact-row') groups = exactDedup(items, rowText);
    else if (m1 === 'exact-assistant') groups = exactDedup(items, rowAssistantText);
    else if (m1 === 'near-row') groups = nearDedup(items, rowText, +ham.value || 4);
    else groups = nearDedup(items, rowAssistantText, +ham.value || 4);
    renderDedupGroups(result, groups, keep.value);
  });
}

function pickKeeper(group, mode){
  if (mode === 'first') return group[0];
  if (mode === 'last') return group[group.length - 1];
  if (mode === 'longest') return group.reduce((best, oi) => rowText(state.items[oi]).length > rowText(state.items[best]).length ? oi : best, group[0]);
  if (mode === 'shortest') return group.reduce((best, oi) => rowText(state.items[oi]).length < rowText(state.items[best]).length ? oi : best, group[0]);
  return group[0];
}

function renderDedupGroups(container, groups, keepMode){
  container.replaceChildren();
  if (!groups.length){ container.append(emptyState('No duplicates found.')); return; }
  const dupCount = groups.reduce((a, g) => a + (g.length - 1), 0);
  container.append(el('div','ds-row',
    `${groups.length} cluster${groups.length===1?'':'s'} • ${dupCount} candidate${dupCount===1?'':'s'} for removal (keeping ${keepMode}).`));

  const dupSet = new Set();
  for (const g of groups) for (const i of g) dupSet.add(i);
  if (state.lastAudit){ state.lastAudit.dups = dupSet; state.lastAudit.stale = false; state.lastAudit.ranAt = Date.now(); }
  else state.lastAudit = { lint:new Map(), pii:new Map(), dups:dupSet, ranAt:Date.now() };
  decorateAllCards();

  const actions = el('div','ds-controls');
  const filterDups = el('button','btn','Filter list to duplicates');
  const deleteOthers = el('button','btn','Delete duplicates');
  const excludeOthers = el('button','btn','Exclude duplicates');
  actions.append(filterDups, deleteOthers, excludeOthers);
  container.append(actions);

  filterDups.addEventListener('click', () => {
    for (const oi of dupSet){
      const it = state.items[oi];
      if (!Array.isArray(it.tags)) it.tags = [];
      if (!it.tags.includes('_dup')) it.tags.push('_dup');
    }
    state.tagFilter = new Set(['_dup']);
    state.pagesShown = 1;
    renderView();
    showToast('List filtered to duplicates (#_dup tag). Clear in Dataset panel.');
  });

  const list = el('div','ds-cluster-list');
  groups.forEach((g, i) => {
    const cl = el('div','ds-cluster');
    cl.append(el('div','ds-cluster-head', `Cluster ${i+1} • ${g.length} rows`));
    const keeper = pickKeeper(g, keepMode);
    for (const oi of g){
      const it = state.items[oi];
      const row = el('div','ds-cluster-row');
      row.append(el('span', 'ds-issue ' + (oi === keeper ? 'ok' : 'warn'), oi === keeper ? 'KEEP' : 'drop'));
      row.append(jumpButton(oi));
      row.append(el('span','ds-cluster-text', rowText(it).slice(0, 200)));
      cl.append(row);
    }
    list.append(cl);
  });
  container.append(list);

  deleteOthers.addEventListener('click', async () => {
    const ok = await confirmModal({title:'Delete duplicates?',
      body:`Will mark ${dupCount} rows as deleted (keeping ${keepMode}).`,
      okLabel:'Delete', dangerous:true});
    if (!ok) return;
    let n = 0;
    for (const g of groups){
      const k = pickKeeper(g, keepMode);
      for (const oi of g){
        if (oi === k) continue;
        const it = state.items[oi];
        if (!it.deleted){ it.deleted = true; n++; }
      }
    }
    analyzeSchema(); renderSidebar(); renderView(); updateDirtyBadge();
    showToast(`Deleted ${n} duplicate${n===1?'':'s'}`);
  });

  excludeOthers.addEventListener('click', () => {
    let n = 0;
    for (const g of groups){
      const k = pickKeeper(g, keepMode);
      for (const oi of g){
        if (oi === k) continue;
        const it = state.items[oi];
        if (!it.excluded){ it.excluded = true; n++; }
      }
    }
    renderView(); updateStats();
    showToast(`Excluded ${n} duplicate${n===1?'':'s'}`);
  });
}

/* ---------- PII scrub ---------- */

export function openPIIScrub(){
  if (!ensureFile()) return;
  const wrap = el('div','ds-section');
  wrap.append(el('div','ds-row','URL is off by default (often desired data). Click match locations to jump.'));
  const opts = el('div','ds-roles');
  const enabled = new Set(PII_PATTERNS.map(p => p.id).filter(id => id !== 'url'));
  for (const p of PII_PATTERNS){
    const lab = el('label','ds-pii-opt');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = enabled.has(p.id);
    cb.addEventListener('change', () => {
      if (cb.checked) enabled.add(p.id); else enabled.delete(p.id);
      renderPIIResults(result, enabled);
    });
    lab.append(cb, document.createTextNode(' ' + p.id));
    opts.append(lab);
  }
  wrap.append(opts);

  const result = el('div','ds-result');
  const scanBtn = el('button','btn','Re-scan');
  const redactBtn = el('button','btn warn','Redact all matches');
  const ctrls = el('div','ds-controls');
  ctrls.append(scanBtn, redactBtn);
  wrap.append(ctrls, result);

  openDatasetModal('PII scrub', wrap, { subtitle: 'Locate and redact emails, phones, IPs, keys, JWT, SSN, CC' });

  scanBtn.addEventListener('click', () => renderPIIResults(result, enabled));

  redactBtn.addEventListener('click', async () => {
    const ok = await confirmModal({title:'Redact all matched PII?',
      body:'Replaces matches with tokens like <EMAIL>. Edits become unsaved (review before save).',
      okLabel:'Redact'});
    if (!ok) return;
    let touched = 0, total = 0;
    for (const it of liveItems()){
      if (it.error){
        const r = redactPII(it.rawText, enabled);
        if (r.count){ it.rawText = r.text; it.dirty = true; recomputeItemMetrics(it); rebuildCardInPlace(it); touched++; total += r.count; }
        continue;
      }
      const [next, n] = redactJSON(it.parsed, enabled);
      if (n){
        it.parsed = next; it.dirty = true;
        recomputeItemMetrics(it); rebuildCardInPlace(it);
        touched++; total += n;
      }
    }
    analyzeSchema(); renderSidebar(); renderView(); updateDirtyBadge();
    showToast(`Redacted ${total} match${total===1?'':'es'} in ${touched} row${touched===1?'':'s'}`);
    renderPIIResults(result, enabled);
  });

  renderPIIResults(result, enabled);
}

function collectPIIHits(item, enabled){
  const hitsByField = [];
  if (item.error){
    const hits = scanPII(item.rawText, enabled);
    if (hits.length) hitsByField.push({ field: 'rawText', text: item.rawText, hits });
    return hitsByField;
  }
  const turns = extractTurns(item.parsed);
  if (turns.length){
    turns.forEach((t, i) => {
      const hits = scanPII(t.content, enabled);
      if (hits.length) hitsByField.push({ field: `turn ${i} (${t.role})`, text: t.content, hits });
    });
    return hitsByField;
  }
  const walk = (v, path) => {
    if (typeof v === 'string'){
      const hits = scanPII(v, enabled);
      if (hits.length) hitsByField.push({ field: path, text: v, hits });
    } else if (Array.isArray(v)){
      v.forEach((x, i) => walk(x, `${path}[${i}]`));
    } else if (v && typeof v === 'object'){
      for (const k of Object.keys(v)) walk(v[k], `${path}.${k}`);
    }
  };
  walk(item.parsed, '$');
  return hitsByField;
}

function renderPIIResults(container, enabled){
  container.replaceChildren();
  const items = liveItems();
  // Show spinner for big datasets, defer scan to next tick
  if (items.length > 200){
    container.append(el('div','ds-row muted', `Scanning ${items.length} rows…`));
    setTimeout(() => renderPIIResultsSync(container, enabled), 30);
    return;
  }
  return renderPIIResultsSync(container, enabled);
}

function renderPIIResultsSync(container, enabled){
  container.replaceChildren();
  const byPattern = new Map();
  const byRow = new Map();
  let total = 0;
  for (const it of liveItems()){
    const fieldHits = collectPIIHits(it, enabled);
    if (fieldHits.length){
      for (const fh of fieldHits){
        for (const h of fh.hits){
          if (!byPattern.has(h.id)) byPattern.set(h.id, []);
          byPattern.get(h.id).push({ origIdx: it.origIdx, field: fh.field, text: fh.text, ...h });
          total++;
        }
      }
      byRow.set(it.origIdx, fieldHits);
    }
  }

  const piiCache = new Map();
  for (const [oi, fieldHits] of byRow){
    piiCache.set(oi, fieldHits.flatMap(fh => fh.hits.map(h => ({ ...h, field: fh.field }))));
  }
  if (state.lastAudit){ state.lastAudit.pii = piiCache; state.lastAudit.stale = false; state.lastAudit.ranAt = Date.now(); }
  else state.lastAudit = { lint:new Map(), pii: piiCache, dups:new Set(), ranAt:Date.now() };
  decorateAllCards();

  if (!total){ container.append(emptyState('No PII detected with selected patterns.')); return; }

  container.append(el('div','ds-row', `${total} match${total===1?'':'es'} across ${byRow.size} row${byRow.size===1?'':'s'}`));
  const chips = el('div','ds-roles');
  for (const [id, arr] of [...byPattern.entries()].sort((a,b) => b[1].length - a[1].length)){
    chips.append(el('span','ds-chip sev-warn', `${id}: ${arr.length}`));
  }
  container.append(chips);

  const list = el('div','ds-cluster-list');
  for (const [id, arr] of [...byPattern.entries()].sort((a,b) => b[1].length - a[1].length)){
    const det = document.createElement('details');
    det.className = 'ds-acc';
    det.open = byPattern.size === 1;
    const summary = document.createElement('summary');
    summary.className = 'ds-acc-head';
    summary.append(el('span','ds-issue warn', id));
    summary.append(el('span','muted', ` ${arr.length} match${arr.length===1?'':'es'}`));
    det.append(summary);
    const body = el('div','ds-acc-body');
    const groupedByRow = new Map();
    for (const h of arr){
      if (!groupedByRow.has(h.origIdx)) groupedByRow.set(h.origIdx, []);
      groupedByRow.get(h.origIdx).push(h);
    }
    for (const [oi, hits] of groupedByRow){
      const row = el('div','ds-pii-row');
      const head = el('div','ds-pii-row-head');
      head.append(jumpButton(oi));
      head.append(el('span','ds-pii-field', hits[0].field));
      head.append(el('span','muted', `${hits.length} hit${hits.length===1?'':'s'}`));
      const redactRow = el('button','mini-btn warn','Redact this row');
      redactRow.addEventListener('click', () => {
        const it = state.items[oi];
        if (it.error){
          const r = redactPII(it.rawText, enabled);
          if (r.count){ it.rawText = r.text; it.dirty = true; recomputeItemMetrics(it); rebuildCardInPlace(it); }
        } else {
          const [next, n] = redactJSON(it.parsed, enabled);
          if (n){ it.parsed = next; it.dirty = true; recomputeItemMetrics(it); rebuildCardInPlace(it); }
        }
        analyzeSchema(); renderSidebar(); renderView(); updateDirtyBadge();
        showToast('Row redacted');
        renderPIIResults(container, enabled);
      });
      head.append(redactRow);
      row.append(head);
      for (const h of hits){
        row.append(snippetWithMatch(h.text, h.start, h.end));
      }
      body.append(row);
    }
    det.append(body);
    list.append(det);
  }
  container.append(list);
}

/* ---------- Lint pack ---------- */

export function openLint(){
  if (!ensureFile()) return;
  const wrap = el('div','ds-section');
  const result = el('div','ds-result');
  const runBtn = el('button','btn primary','Re-run lint');
  const excludeBtn = el('button','btn','Exclude rows with errors');
  const ctrls = el('div','ds-controls');
  ctrls.append(runBtn, excludeBtn);
  wrap.append(ctrls, result);

  openDatasetModal('Lint dataset', wrap, { subtitle: 'Format conformance + structural sanity per row' });

  const run = () => {
    const all = lintAll(state.items);
    const lintMap = new Map();
    for (const r of all) lintMap.set(r.origIdx, r.issues);
    if (state.lastAudit){ state.lastAudit.lint = lintMap; state.lastAudit.stale = false; state.lastAudit.ranAt = Date.now(); }
    else state.lastAudit = { lint:lintMap, pii:new Map(), dups:new Set(), ranAt:Date.now() };
    decorateAllCards();

    result.replaceChildren();
    if (!all.length){ result.append(emptyState('No issues found.')); return; }
    const counts = new Map();
    for (const r of all) for (const i of r.issues) counts.set(i.code, (counts.get(i.code)||0)+1);
    const summary = el('div','ds-roles');
    for (const [code, n] of [...counts.entries()].sort((a,b)=>b[1]-a[1])){
      const sev = sevForCode(code);
      summary.append(el('span',`ds-chip ${sev === 'error' ? 'sev-error' : 'sev-warn'}`, `${code}: ${n}`));
    }
    result.append(el('div','ds-row', `${all.length} row${all.length===1?'':'s'} have issues`));
    result.append(summary);
    const list = el('div','ds-cluster-list');
    for (const r of all.slice(0, 500)){
      const it = state.items[r.origIdx];
      const cl = el('div','ds-cluster');
      const head = el('div','ds-cluster-head');
      head.append(jumpButton(r.origIdx, `#${it.fileIdx + 1}`));
      head.append(el('span','muted', `${r.issues.length} issue${r.issues.length===1?'':'s'}`));
      cl.append(head);
      for (const issue of r.issues){
        const row = el('div','ds-pii-row');
        const h = el('div','ds-pii-row-head');
        h.append(el('span', `ds-issue ${issue.sev}`, issue.code));
        h.append(el('span','ds-pii-field', issue.msg));
        row.append(h);
        if (issue.code === 'empty-content' || issue.code === 'consecutive-role'){
          const turns = it.parsed ? extractTurns(it.parsed) : [];
          const m = /turn (\d+)/.exec(issue.msg);
          if (m && turns[+m[1]]){
            const tt = turns[+m[1]];
            row.append(el('div','ds-snippet', `${tt.role}: ${(tt.content || '(empty)').slice(0, 200)}`));
          }
        }
        cl.append(row);
      }
      list.append(cl);
    }
    if (all.length > 500) list.append(el('div','side-empty', `… and ${all.length - 500} more`));
    result.append(list);
  };
  run();
  runBtn.addEventListener('click', run);

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

function sevForCode(code){
  if (['parse-error','empty-output','empty-instruction','empty-turns','pref-empty'].includes(code)) return 'error';
  return 'warn';
}

/* ---------- Schema validate ---------- */

export function openSchemaValidate(){
  if (!ensureFile()) return;
  const wrap = el('div','ds-section');
  wrap.append(el('div','ds-row','Paste a JSON Schema (Draft-07-ish subset). Each row is validated; failures with paths are listed.'));
  const ta = document.createElement('textarea');
  ta.className = 'ds-schema-input';
  ta.placeholder = '{ "type": "object", "required": ["messages"] }';
  wrap.append(ta);
  const parseStatus = el('div','ds-row muted','');
  wrap.append(parseStatus);
  ta.addEventListener('input', () => {
    if (!ta.value.trim()){ parseStatus.textContent = ''; parseStatus.className = 'ds-row muted'; return; }
    try { JSON.parse(ta.value); parseStatus.textContent = 'valid JSON'; parseStatus.className = 'ds-row ok'; }
    catch (e){ parseStatus.textContent = 'JSON: ' + e.message; parseStatus.className = 'ds-row err'; }
  });
  const presets = el('div','ds-controls');
  presets.append(el('span','muted','Presets:'));
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

  openDatasetModal('JSON Schema validate', wrap, { subtitle: 'Subset of Draft-07: type/required/properties/items/enum/min*/max*/pattern/oneOf/anyOf/allOf' });

  const fireInput = () => ta.dispatchEvent(new Event('input'));

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
    fireInput();
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
    fireInput();
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
    fireInput();
  });

  let lastFailures = [];

  runBtn.addEventListener('click', () => {
    if (!ta.value.trim()){ showToast('Paste or pick a preset', 'err'); return; }
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
    if (!failures.length) return;
    const list = el('div','ds-cluster-list');
    for (const f of failures.slice(0, 500)){
      const it = state.items[f.origIdx];
      const cl = el('div','ds-cluster');
      const h = el('div','ds-cluster-head');
      h.append(jumpButton(f.origIdx, `#${it.fileIdx + 1}`));
      h.append(el('span','muted', `${f.errs.length} error${f.errs.length===1?'':'s'}`));
      cl.append(h);
      for (const e of f.errs.slice(0, 12)){
        const row = el('div','ds-pii-row-head');
        row.append(el('span','ds-issue error', 'fail'));
        row.append(el('code','ds-pii-field', e.path));
        row.append(el('span',null, e.msg));
        cl.append(row);
      }
      list.append(cl);
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
  if (!ensureFile()) return;
  const wrap = el('div','ds-section');
  wrap.append(el('div','ds-row','Convert rows to a target format. Source auto-detected per row. Preview before applying.'));
  const result = el('div','ds-result');
  const previewBtn = el('button','btn','Preview (dry-run)');
  const runBtn = el('button','btn primary','Convert all → OpenAI chat');
  const sharegptBtn = el('button','btn','OpenAI → ShareGPT');
  const ctrls = el('div','ds-controls');
  ctrls.append(previewBtn, runBtn, sharegptBtn);
  wrap.append(ctrls, result);
  openDatasetModal('Format convert', wrap, { subtitle: 'ShareGPT / Alpaca / Completion → OpenAI chat (or reverse)' });

  let direction = 'to-openai';
  function convertRow(parsed){
    const fmt = detectRowFormat(parsed);
    if (direction === 'to-openai'){
      if (fmt === 'sharegpt') return shareGPTToOpenAI(parsed);
      if (fmt === 'alpaca') return alpacaToOpenAI(parsed);
      if (fmt === 'completion') return completionToOpenAI(parsed);
      return null;
    }
    // to-sharegpt
    if (fmt === 'openai-chat' || fmt === 'openai-chat-loose') return openAIToShareGPT(parsed);
    return null;
  }
  function renderPreview(){
    result.replaceChildren();
    let willConvert = 0, willSkip = 0;
    const previews = [];
    for (const it of liveItems()){
      if (it.error){ willSkip++; continue; }
      const next = convertRow(it.parsed);
      if (!next){ willSkip++; continue; }
      willConvert++;
      if (previews.length < 3) previews.push({ origIdx: it.origIdx, before: it.parsed, after: next });
    }
    result.append(el('div','ds-row', `Will convert ${willConvert} row${willConvert===1?'':'s'} • skip ${willSkip}`));
    if (!previews.length){ result.append(emptyState('Nothing to convert with current data.')); return; }
    for (const p of previews){
      const it = state.items[p.origIdx];
      const cl = el('div','ds-cluster');
      cl.append(el('div','ds-cluster-head', `Row #${it.fileIdx + 1}`));
      cl.append(el('div','ds-row','BEFORE'));
      cl.append(el('pre','ds-pre', JSON.stringify(p.before, null, 2).slice(0, 800)));
      cl.append(el('div','ds-row','AFTER'));
      cl.append(el('pre','ds-pre', JSON.stringify(p.after, null, 2).slice(0, 800)));
      result.append(cl);
    }
  }
  previewBtn.addEventListener('click', () => { direction = 'to-openai'; renderPreview(); });

  runBtn.addEventListener('click', async () => {
    direction = 'to-openai';
    const ok = await confirmModal({title:'Convert all → OpenAI chat?', body:'Edits become unsaved. Save to commit.', okLabel:'Convert'});
    if (!ok) return;
    let n = 0, skipped = 0;
    for (const it of liveItems()){
      if (it.error){ skipped++; continue; }
      const next = convertRow(it.parsed);
      if (!next){ skipped++; continue; }
      it.parsed = next; it.dirty = true;
      recomputeItemMetrics(it); rebuildCardInPlace(it); n++;
    }
    analyzeSchema(); renderSidebar(); renderView(); updateDirtyBadge();
    showToast(n ? `Converted ${n} row${n===1?'':'s'} • ${skipped} skipped` : `Nothing to convert (${skipped} skipped)`, n ? '' : 'err');
  });

  // Shift-click on the ShareGPT button → preview that direction; plain click = apply.
  sharegptBtn.addEventListener('click', async (e) => {
    direction = 'to-sharegpt';
    if (e.shiftKey){ renderPreview(); return; }
    const ok = await confirmModal({title:'OpenAI → ShareGPT?', body:'Maps messages[] → conversations[]. Shift-click for preview first.', okLabel:'Convert'});
    if (!ok) return;
    let n = 0, skipped = 0;
    for (const it of liveItems()){
      if (it.error){ skipped++; continue; }
      const next = convertRow(it.parsed);
      if (!next){ skipped++; continue; }
      it.parsed = next; it.dirty = true;
      recomputeItemMetrics(it); rebuildCardInPlace(it); n++;
    }
    analyzeSchema(); renderSidebar(); renderView(); updateDirtyBadge();
    showToast(n ? `Converted ${n} row${n===1?'':'s'} • ${skipped} skipped` : 'Nothing to convert', n ? '' : 'err');
  });
}

/* ---------- Sample / split ---------- */

export function openSplit(){
  if (!ensureFile()) return;
  const wrap = el('div','ds-section');
  wrap.append(el('div','ds-row','Shuffle (deterministic by seed) and download as JSONL files.'));
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
  const summary = el('div','ds-row muted','');
  wrap.append(summary);

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

  openDatasetModal('Sample / split', wrap, { subtitle: `${liveItems().length} live rows available` });

  const updatePreview = () => {
    const ratios = [+tr.value || 0, +va.value || 0, +te.value || 0];
    const total = liveItems().length;
    const sum = ratios.reduce((a,b) => a+b, 0) || 1;
    const counts = ratios.map(r => Math.floor(total * r / sum));
    counts[2] = total - counts[0] - counts[1];
    summary.textContent = `train=${counts[0]} • val=${counts[1]} • test=${counts[2]}`;
  };
  for (const inp of [tr, va, te]) inp.addEventListener('input', updatePreview);
  updatePreview();

  runBtn.addEventListener('click', () => {
    const ratios = [Math.max(0, +tr.value || 0), Math.max(0, +va.value || 0), Math.max(0, +te.value || 0)];
    const sum = ratios.reduce((a,b) => a+b, 0);
    if (sum <= 0){ showToast('Ratios must sum to > 0', 'err'); return; }
    if (!liveItems().length){ showToast('No live rows', 'err'); return; }
    const seed = +sd.value || 1;
    const splits = splitDataset(state.items, ratios, seed);
    const labels = ['train', 'val', 'test'];
    splits.forEach((idxs, i) => {
      if (!idxs.length) return;
      const lines = idxs.map(oi => exportRawFor(state.items[oi])).filter(Boolean);
      downloadText(`${baseName()}-${labels[i]}.jsonl`, lines.join('\n') + '\n', 'application/jsonl');
    });
    showToast(`Split: ${splits.map((s,i)=>`${labels[i]}=${s.length}`).join(' • ')}`);
  });

  sampleBtn.addEventListener('click', () => {
    const n = +nIn.value || 0;
    if (n <= 0){ showToast('N must be > 0', 'err'); return; }
    const idxs = sample(state.items, n, +sd.value || 1);
    if (!idxs.length){ showToast('No live rows', 'err'); return; }
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
  if (!ensureFile()) return;
  const wrap = el('div','ds-section');
  const otherSlots = state.files.filter(s => s.id !== state.activeId && (s.snapshot?.items?.length));
  if (!otherSlots.length){
    wrap.append(emptyState('Open a second file in another tab to compare against.'));
    openDatasetModal('Leakage check', wrap);
    return;
  }
  wrap.append(el('div','ds-row','Compare active file (A) against another open file (B).'));
  const ctrls = el('div','ds-controls');
  ctrls.append(el('label',null,'File B'));
  const sel = document.createElement('select'); sel.className = 'select';
  for (const slot of otherSlots){
    const s = slot.snapshot || {};
    const o = document.createElement('option');
    o.value = slot.id; o.textContent = s.fileName || slot.id;
    sel.append(o);
  }
  ctrls.append(sel);
  ctrls.append(el('label',null,'min len'));
  const mn = document.createElement('input'); mn.type='number'; mn.value='64'; mn.className='num-input';
  ctrls.append(mn);
  ctrls.append(el('label',null,'Hamming ≤'));
  const ha = document.createElement('input'); ha.type='number'; ha.value='4'; ha.className='num-input';
  ctrls.append(ha);
  const runBtn = el('button','btn primary','Check overlap');
  ctrls.append(runBtn);
  wrap.append(ctrls);
  const result = el('div','ds-result');
  wrap.append(result);

  openDatasetModal('Leakage check', wrap, { subtitle: 'Find rows in B that overlap with A (per-turn substring + simhash)' });

  runBtn.addEventListener('click', () => {
    const slot = state.files.find(s => s.id === sel.value);
    if (!slot){ showToast('Pick a file', 'err'); return; }
    const itemsA = state.items;
    const itemsB = slot.snapshot?.items || [];
    if (!itemsB.length){ showToast('File B has no rows.', 'err'); return; }
    const hits = leakageCheck(itemsA, itemsB, { minLen: +mn.value || 64, nearHamming: +ha.value || 4 });
    result.replaceChildren();
    if (!hits.length){ result.append(emptyState('No overlap detected.')); return; }
    result.append(el('div','ds-row',
      `${hits.length} row${hits.length===1?'':'s'} in B overlap A — ${hits.filter(h=>h.kind==='exact').length} exact / ${hits.filter(h=>h.kind==='near').length} near`));
    const list = el('div','ds-cluster-list');
    for (const h of hits.slice(0, 500)){
      const itB = itemsB[h.origIdx];
      const row = el('div','ds-cluster');
      const head = el('div','ds-cluster-head');
      head.append(el('span','ds-issue ' + (h.kind === 'exact' ? 'error' : 'warn'), h.kind));
      head.append(el('span','muted', `B#${itB ? itB.fileIdx + 1 : h.origIdx}` + (h.matchA != null ? ` ↔ A#${(itemsA[h.matchA]?.fileIdx ?? h.matchA) + 1}` : '')));
      row.append(head);
      if (itB) row.append(el('div','ds-snippet', rowText(itB).slice(0, 240)));
      list.append(row);
    }
    if (hits.length > 500) list.append(el('div','side-empty', `… and ${hits.length - 500} more`));
    result.append(list);
  });
}

/* ---------- Bulk transform ---------- */

export function openBulkTransform(){
  if (!ensureFile()) return;
  const wrap = el('div','ds-section');
  wrap.append(el('div','ds-row','Stack declarative ops; dry-run shows inline diff before applying.'));
  const ops = [];
  const opsList = el('div','ds-cluster-list');
  const renderOps = () => {
    opsList.replaceChildren();
    if (!ops.length){ opsList.append(emptyState('No ops yet.')); return; }
    ops.forEach((op, i) => {
      const row = el('div','ds-cluster-row');
      row.append(el('span','ds-chip', String(i+1)));
      row.append(el('span','ds-cluster-text', describeOp(op)));
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
  const arg3 = document.createElement('input'); arg3.placeholder='scope'; arg3.className='search';
  builder.append(arg1, arg2, arg3);

  const updateArgPlaceholders = () => {
    const v = opSel.value;
    [arg1, arg2, arg3].forEach(a => a.style.display = '');
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
      if (!arg1.value){ showToast('Pattern empty', 'err'); return; }
      op.pattern = arg1.value; op.replacement = arg2.value; op.flags = 'g';
      if (arg3.value) op.scope = arg3.value;
    } else if (v === 'set-key'){
      if (!arg1.value){ showToast('Key empty', 'err'); return; }
      op.key = arg1.value;
      try { op.value = JSON.parse(arg2.value); } catch { op.value = arg2.value; }
    } else if (v === 'remove-key'){
      if (!arg1.value){ showToast('Key empty', 'err'); return; }
      op.key = arg1.value;
    } else if (v === 'rename-key'){
      if (!arg1.value || !arg2.value){ showToast('Both keys required', 'err'); return; }
      op.from = arg1.value; op.to = arg2.value;
    }
    ops.push(op);
    arg1.value = arg2.value = arg3.value = '';
    renderOps();
  });

  const dryRunBtn = el('button','btn','Dry run');
  const applyBtn = el('button','btn primary','Apply to all');
  const ctrls = el('div','ds-controls');
  ctrls.append(dryRunBtn, applyBtn);
  wrap.append(ctrls);
  const result = el('div','ds-result');
  wrap.append(result);

  openDatasetModal('Bulk transform', wrap, { subtitle: 'Declarative pipeline · safe (no code execution)' });

  dryRunBtn.addEventListener('click', () => {
    if (!ops.length){ showToast('No ops'); return; }
    const r = dryRunOps(state.items, ops, 20);
    result.replaceChildren();
    result.append(el('div','ds-row', `${r.touched} row${r.touched===1?'':'s'} would change • ${r.errors} error${r.errors===1?'':'s'}`));
    const previews = r.preview.filter(p => p.changed || p.err).slice(0, 5);
    if (!previews.length){ result.append(emptyState('No changes detected.')); return; }
    for (const p of previews){
      const it = state.items[p.origIdx];
      const cl = el('div','ds-cluster');
      const head = el('div','ds-cluster-head');
      head.append(jumpButton(p.origIdx, `#${it.fileIdx + 1}`));
      cl.append(head);
      if (p.err){
        cl.append(el('div','ds-issue error', p.err));
      } else {
        cl.append(renderInlineDiff(p.before, p.after));
      }
      result.append(cl);
    }
  });

  applyBtn.addEventListener('click', async () => {
    if (!ops.length){ showToast('No ops'); return; }
    const ok = await confirmModal({title:'Apply transform?',
      body:`Will edit all matching rows. Save to commit. Ops: ${ops.length}`, okLabel:'Apply'});
    if (!ok) return;
    let touched = 0, errored = 0;
    let firstErr = null;
    for (const it of liveItems()){
      if (it.error) continue;
      let next;
      try { next = applyOps(it.parsed, ops); }
      catch (e) { errored++; if (!firstErr) firstErr = String(e.message || e); continue; }
      if (JSON.stringify(next) !== JSON.stringify(it.parsed)){
        it.parsed = next;
        it.dirty = true;
        recomputeItemMetrics(it);
        rebuildCardInPlace(it);
        touched++;
      }
    }
    if (errored){
      showToast(`Skipped ${errored} row${errored===1?'':'s'}: ${firstErr}`, 'err');
      return;
    }
    analyzeSchema(); renderSidebar(); renderView(); updateDirtyBadge();
    showToast(`Transform applied to ${touched} row${touched===1?'':'s'}`);
  });
}

function describeOp(op){
  if (op.op === 'regex-replace') return `regex-replace /${op.pattern}/${op.flags||'g'} → "${op.replacement}"${op.scope ? ' (scope: ' + op.scope + ')' : ''}`;
  if (op.op === 'set-key') return `set-key "${op.key}" = ${JSON.stringify(op.value)}`;
  if (op.op === 'remove-key') return `remove-key "${op.key}"`;
  if (op.op === 'rename-key') return `rename "${op.from}" → "${op.to}"`;
  return op.op;
}

function renderInlineDiff(before, after){
  const wrap = el('div','ds-diff');
  const diffs = diffJSON(before, after);
  if (!diffs.length){
    wrap.append(el('div','muted','no structural change'));
    return wrap;
  }
  for (const d of diffs.slice(0, 30)){
    const row = el('div','ds-diff-row');
    row.append(el('span', `ds-issue ${d.kind === 'add' ? 'ok' : d.kind === 'remove' ? 'error' : 'warn'}`, d.kind));
    row.append(el('code','ds-diff-path', d.path));
    if (d.kind === 'add') row.append(el('span','ds-diff-to', '+ ' + truncJSON(d.to)));
    else if (d.kind === 'remove') row.append(el('span','ds-diff-from', '- ' + truncJSON(d.from)));
    else { row.append(el('span','ds-diff-from', truncJSON(d.from)), el('span','ds-diff-arrow','→'), el('span','ds-diff-to', truncJSON(d.to))); }
    wrap.append(row);
  }
  if (diffs.length > 30) wrap.append(el('div','muted', `… and ${diffs.length - 30} more`));
  return wrap;
}

function truncJSON(v){
  const s = JSON.stringify(v);
  return s.length > 120 ? s.slice(0, 120) + '…' : s;
}

/* ---------- Tagging / Review ---------- */

export function knownTags(opts = {}){
  const includeInternal = !!opts.includeInternal;
  const set = new Set();
  for (const it of liveItems()){
    for (const t of (it.tags || [])){
      if (!includeInternal && t.startsWith('_')) continue;
      set.add(t);
    }
  }
  return [...set].sort();
}

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
  head.querySelectorAll('.review-badge,.tag-badge,.audit-badge').forEach(n => n.remove());
  if (item.review){
    const b = el('span', `review-badge review-${item.review}`, REVIEW_LABEL[item.review] + ' ' + item.review);
    head.append(b);
  }
  for (const t of item.tags || []){
    if (t.startsWith('_')) continue; // internal markers (e.g., #_dup)
    head.append(el('span','tag-badge', '#' + t));
  }
  if (state.lastAudit){
    const stale = state.lastAudit.stale ? ' audit-stale' : '';
    const lints = state.lastAudit.lint?.get(item.origIdx) || [];
    if (lints.length){
      const sev = lints.some(i => i.sev === 'error') ? 'error' : 'warn';
      const b = el('span', `audit-badge audit-${sev}${stale}`, `⚠ ${lints.length} lint`);
      b.title = (state.lastAudit.stale ? '(audit stale) ' : '') + lints.slice(0,4).map(i => i.code).join(', ');
      head.append(b);
    }
    const piiHits = state.lastAudit.pii?.get(item.origIdx);
    if (piiHits && piiHits.length){
      const types = [...new Set(piiHits.map(h => h.id))];
      const b = el('span', `audit-badge audit-pii${stale}`, `🛡 ${piiHits.length} PII`);
      b.title = (state.lastAudit.stale ? '(audit stale) ' : '') + types.join(', ');
      head.append(b);
    }
    if (state.lastAudit.dups?.has(item.origIdx)){
      head.append(el('span', `audit-badge audit-dup${stale}`, '◯ dup'));
    }
  }
}

export function decorateAllCards(){
  for (const it of state.items) if (it._cardEl) updateCardReviewUI(it);
  renderDatasetPanel();
}

export function openTagging(){
  if (!ensureFile()) return;
  const wrap = el('div','ds-section');
  wrap.append(el('div','ds-row','Active-row controls + bulk on visible rows. Autocomplete pulls from existing tags.'));

  // Active row
  const activeSec = el('div','ds-section');
  activeSec.append(el('h3',null,'Active row'));
  const activeIt = state.items[state.activeOrigIdx];
  if (activeIt){
    const row = el('div','ds-controls');
    const approve = el('button','btn','✓ Approve (a)');
    const reject = el('button','btn warn','✗ Reject (r)');
    const todo = el('button','btn','? Todo (t)');
    const clear = el('button','btn','Clear');
    approve.addEventListener('click', () => { setRowReview(activeIt, 'approve'); refresh(); });
    reject.addEventListener('click',  () => { setRowReview(activeIt, 'reject'); refresh(); });
    todo.addEventListener('click',    () => { setRowReview(activeIt, 'todo'); refresh(); });
    clear.addEventListener('click',   () => { setRowReview(activeIt, null); refresh(); });
    row.append(approve, reject, todo, clear);
    activeSec.append(row);
  } else {
    activeSec.append(el('div','muted','No active row.'));
  }
  wrap.append(activeSec);

  // Bulk
  const bulkSec = el('div','ds-section');
  const visibleCount = state.viewItems.length;
  bulkSec.append(el('h3',null, `Bulk on visible rows (${visibleCount})`));
  const ctrls = el('div','ds-controls');
  const approveAll = el('button','btn',`Approve ${visibleCount}`);
  const rejectAll = el('button','btn warn',`Reject ${visibleCount}`);
  const clearReview = el('button','btn',`Clear review on ${visibleCount}`);
  ctrls.append(approveAll, rejectAll, clearReview);
  bulkSec.append(ctrls);

  const tagBox = el('div','ds-controls');
  tagBox.append(el('label',null,'Tag'));
  const tagInp = document.createElement('input');
  tagInp.className='search'; tagInp.placeholder='tag name';
  tagInp.setAttribute('list','ds-known-tags');
  tagBox.append(tagInp);
  let tagDL = document.getElementById('ds-known-tags');
  if (!tagDL){ tagDL = document.createElement('datalist'); tagDL.id='ds-known-tags'; document.body.append(tagDL); }
  tagDL.replaceChildren();
  for (const t of knownTags()){
    const o = document.createElement('option'); o.value = t; tagDL.append(o);
  }
  const addTag = el('button','btn',`Tag ${visibleCount}`);
  const removeTag = el('button','btn',`Untag ${visibleCount}`);
  tagBox.append(addTag, removeTag);
  bulkSec.append(tagBox);

  const exclSec = el('div','ds-controls');
  const exclRej = el('button','btn','Exclude all rejected');
  const delRej = el('button','btn warn','Delete all rejected');
  exclSec.append(exclRej, delRej);
  bulkSec.append(exclSec);
  wrap.append(bulkSec);

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
    renderDatasetPanel();
  };
  refresh();
  wrap.append(stats);

  openDatasetModal('Tagging + review', wrap, { subtitle: 'Keyboard: a / r / t toggle approve / reject / todo on active row' });

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

  const hasFile = !!state.items.length;

  // Big audit button
  const auditBtn = el('button','btn primary ds-audit-btn');
  auditBtn.append(el('span','ds-panel-icon','⚙'));
  auditBtn.append(el('span',null,'Run all audits'));
  auditBtn.disabled = !hasFile;
  auditBtn.addEventListener('click', () => openAuditOverview());
  root.append(auditBtn);

  if (!hasFile){
    root.append(emptyState('Load a file to enable curation tools.'));
    return;
  }

  // Live count chips after audit + score (cached at audit time)
  if (state.lastAudit){
    const score = state.lastAudit.score ?? '—';
    const scoreRow = el('div','ds-panel-score');
    const ring = el('div','ds-panel-ring');
    ring.style.setProperty('--score', score);
    ring.append(el('span','ds-panel-ring-num', String(score)));
    scoreRow.append(ring);
    const txt = el('div','ds-panel-score-txt');
    txt.append(el('div','ds-panel-score-h', score >= 80 ? 'healthy' : score >= 60 ? 'cleanup' : 'high variance'));
    txt.append(el('div','ds-panel-score-s', `quality • ${state.lastAudit.stale ? 'stale' : new Date(state.lastAudit.ranAt).toLocaleTimeString()}`));
    scoreRow.append(txt);
    root.append(scoreRow);

    const live = el('div','ds-panel-live');
    const lintN = state.lastAudit.lint?.size || 0;
    let piiN = 0;
    for (const arr of (state.lastAudit.pii?.values() || [])) piiN += arr.length;
    const dupN = state.lastAudit.dups?.size || 0;
    live.append(el('span', `ds-chip ${lintN ? 'sev-warn' : ''}`, `lint: ${lintN}`));
    live.append(el('span', `ds-chip ${piiN ? 'sev-warn' : ''}`, `PII: ${piiN}`));
    live.append(el('span', `ds-chip ${dupN ? 'sev-warn' : ''}`, `dup: ${dupN}`));
    if (state.lastAudit.stale){
      live.append(el('span', 'ds-chip sev-warn ds-stale-chip', 'stale — re-run'));
    }
    root.append(live);

    const exportBtn = el('button','mini-btn ds-panel-btn','⤓ Export audit report');
    exportBtn.addEventListener('click', exportAuditReport);
    root.append(exportBtn);
  }

  const sec1 = el('div','ds-panel-sec');
  sec1.append(el('div','ds-panel-h','Audit'));
  sec1.append(panelBtn('▦', 'Format profile + stats', openFormatProfile));
  sec1.append(panelBtn('✓', 'Lint dataset', openLint));
  sec1.append(panelBtn('§', 'Schema validate', openSchemaValidate));
  root.append(sec1);

  const sec2 = el('div','ds-panel-sec');
  sec2.append(el('div','ds-panel-h','Curate'));
  sec2.append(panelBtn('◯', 'Find duplicates', openDedup));
  sec2.append(panelBtn('★', 'PII scrub', openPIIScrub));
  sec2.append(panelBtn('⤳', 'Bulk transform', openBulkTransform));
  root.append(sec2);

  const sec3 = el('div','ds-panel-sec');
  sec3.append(el('div','ds-panel-h','Workflow'));
  sec3.append(panelBtn('☑', 'Tagging + review', openTagging));
  sec3.append(panelBtn('✂', 'Sample / split', openSplit));
  sec3.append(panelBtn('⇄', 'Format convert', openConvert));
  sec3.append(panelBtn('⌕', 'Leakage check', openLeakage));
  sec3.append(panelBtn('Δ', 'Diff active row (d)', openDiffActive));
  root.append(sec3);

  // Filter section
  const filt = el('div','ds-panel-sec');
  filt.append(el('div','ds-panel-h','Filter list by review'));
  const reviewRow = el('div','ds-roles ds-filter-row');
  for (const [v, lab] of [['approve','✓ approved'],['reject','✗ rejected'],['todo','? todo'],['none','– no review']]){
    const c = el('button','ds-filter-chip' + (state.reviewFilter.has(v) ? ' active' : ''), lab);
    c.addEventListener('click', () => {
      if (state.reviewFilter.has(v)) state.reviewFilter.delete(v);
      else state.reviewFilter.add(v);
      state.pagesShown = 1;
      renderView();
      renderDatasetPanel();
    });
    reviewRow.append(c);
  }
  filt.append(reviewRow);
  const tags = knownTags();
  if (tags.length){
    filt.append(el('div','ds-panel-h','Filter by tag'));
    const tagRow = el('div','ds-roles ds-filter-row');
    for (const t of tags){
      const c = el('button','ds-filter-chip' + (state.tagFilter.has(t) ? ' active' : ''), '#' + t);
      c.addEventListener('click', () => {
        if (state.tagFilter.has(t)) state.tagFilter.delete(t);
        else state.tagFilter.add(t);
        state.pagesShown = 1;
        renderView();
        renderDatasetPanel();
      });
      tagRow.append(c);
    }
    filt.append(tagRow);
  }
  // Internal filters (e.g. _dup from "Filter list to duplicates")
  const internalActive = [...state.tagFilter].filter(t => t.startsWith('_'));
  if (internalActive.length){
    const note = el('div','ds-internal-filter');
    note.append(el('span','ds-issue warn','filtered'));
    note.append(el('span',null, internalActive.map(t => t.slice(1)).join(', ')));
    filt.append(note);
  }
  if (state.reviewFilter.size || state.tagFilter.size){
    const clear = el('button','mini-btn ds-panel-btn','Clear filters');
    clear.addEventListener('click', () => {
      state.reviewFilter.clear();
      state.tagFilter.clear();
      state.pagesShown = 1;
      renderView();
      renderDatasetPanel();
    });
    filt.append(clear);
  }
  root.append(filt);

  // Counts footer
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

  root.append(el('div','ds-panel-hint','a / r / t · review · d · diff'));
}

function exportAuditReport(){
  if (!state.lastAudit){ showToast('Run audit first', 'err'); return; }
  const prof = profileDataset(state.items);
  const stats = computeStats(state.items);
  const score = computeQualityScore(prof, stats, state.lastAudit);
  const audit = state.lastAudit;
  const report = {
    format: 'jsonlviewer-audit',
    schemaVersion: 1,
    file: state.fileName || 'untitled',
    ranAt: new Date(audit.ranAt).toISOString(),
    stale: !!audit.stale,
    score,
    profile: {
      total: prof.total,
      dominant: prof.dominant,
      dominantPct: prof.dominantPct,
      counts: Object.fromEntries(prof.counts),
    },
    stats: {
      tokens: stats.tokens,
      turns: stats.turns,
      roleCount: Object.fromEntries(stats.roleCount),
    },
    lint: [...audit.lint.entries()].map(([oi, issues]) => ({
      origIdx: oi, fileIdx: state.items[oi]?.fileIdx, issues
    })),
    // Privacy: do NOT include the matched substring in the report. Ship
    // only pattern id, field path, position, and length so reviewers can
    // locate matches without leaking the secrets they were meant to find.
    pii: [...audit.pii.entries()].map(([oi, hits]) => ({
      origIdx: oi, fileIdx: state.items[oi]?.fileIdx,
      hits: hits.map(h => ({
        id: h.id,
        field: h.field,
        start: h.start,
        end: h.end,
        len: (h.end ?? 0) - (h.start ?? 0),
      }))
    })),
    duplicates: [...audit.dups],
  };
  const text = JSON.stringify(report, null, 2);
  const base = (state.fileName || 'dataset').replace(/\.(json|jsonl|txt|log)$/i, '');
  downloadText(`${base}-audit.json`, text, 'application/json');
  showToast('Audit report downloaded');
}

function panelBtn(icon, label, action){
  const b = el('button','mini-btn ds-panel-btn');
  b.append(el('span','ds-panel-icon', icon));
  b.append(el('span',null, label));
  b.addEventListener('click', action);
  return b;
}

/* ---------- Window hooks ---------- */
if (typeof window !== 'undefined'){
  window.__dataset_ui = {
    openFormatProfile, openDedup, openPIIScrub, openLint, openSchemaValidate,
    openConvert, openSplit, openLeakage, openBulkTransform, openTagging,
    openDiffActive, openAuditOverview,
    renderDatasetPanel, setRowReview, toggleRowTag, updateCardReviewUI,
    decorateAllCards, knownTags,
  };
  window.__dataset_exportAudit = exportAuditReport;
}

// js/view-edit.js
import { el, showToast } from './dom.js';
import { state } from './state.js';
import { parsePath, walkPath } from './path.js';
import { makeKeyEl } from './view-node.js';
import { applyColorize } from './view-colorize.js';
import { recomputeItemMetrics, rebuildCardInPlace } from './view-card.js';
import { analyzeSchema, renderSidebar } from './schema.js';
import { updateDirtyBadge, updateStats } from './view.js';
import { persistActiveFile } from './files.js';

export function markDirty(item){
  if (!item.dirty){
    item.dirty = true;
    updateDirtyBadge();
  }
  recomputeItemMetrics(item);
  persistActiveFile();
}
window.__edit_markDirty = markDirty;

export function applyValueAtPath(item, path, newValue){
  if (item.error) return false;
  const tokens = parsePath(path);
  if (!tokens.length){
    item.parsed = newValue;
  } else {
    const {parent, lastKey} = walkPath(item.parsed, tokens);
    parent[lastKey] = newValue;
  }
  markDirty(item);
  return true;
}

export function applyKeyRenameAtPath(item, oldPath, newKey){
  const tokens = parsePath(oldPath);
  if (!tokens.length) return false;
  const {parent, lastKey} = walkPath(item.parsed, tokens);
  if (Array.isArray(parent)) return false;
  if (lastKey === newKey) return true;
  if (Object.prototype.hasOwnProperty.call(parent, newKey)){
    showToast('Key "' + newKey + '" already exists', 'err');
    return false;
  }
  const fresh = {};
  for (const k of Object.keys(parent)){
    if (k === lastKey) fresh[newKey] = parent[lastKey];
    else fresh[k] = parent[k];
  }
  if (tokens.length === 1){
    item.parsed = fresh;
  } else {
    const grandTokens = tokens.slice(0, -1);
    const grandLast = grandTokens[grandTokens.length-1].value;
    const grandWalk = walkPath(item.parsed, grandTokens);
    grandWalk.parent[grandLast] = fresh;
  }
  markDirty(item);
  return true;
}

export function removeAtPath(item, path){
  const tokens = parsePath(path);
  if (!tokens.length){
    showToast('Cannot delete root — use card Delete', 'err');
    return;
  }
  const {parent, lastKey} = walkPath(item.parsed, tokens);
  if (Array.isArray(parent)){
    parent.splice(lastKey, 1);
  } else {
    delete parent[lastKey];
  }
  markDirty(item);
  rebuildCardInPlace(item);
  updateStats();
  analyzeSchema(); renderSidebar();
}

export function appendArrayItem(item, path){
  const tokens = parsePath(path);
  let target;
  if (!tokens.length){ target = item.parsed; }
  else { const w = walkPath(item.parsed, tokens); target = w.parent[w.lastKey]; }
  if (!Array.isArray(target)) return;
  target.push(null);
  markDirty(item);
  rebuildCardInPlace(item);
  updateStats();
}

export function addObjectKey(item, path, keyName){
  const tokens = parsePath(path);
  let target;
  if (!tokens.length){ target = item.parsed; }
  else { const w = walkPath(item.parsed, tokens); target = w.parent[w.lastKey]; }
  if (!target || typeof target !== 'object' || Array.isArray(target)) return;
  if (Object.prototype.hasOwnProperty.call(target, keyName)){
    showToast('Key "' + keyName + '" already exists', 'err');
    return;
  }
  target[keyName] = null;
  markDirty(item);
  rebuildCardInPlace(item);
  updateStats();
  analyzeSchema(); renderSidebar();
}

export function activeEditing(){ return !!document.querySelector('.edit-input'); }

export function startInlineEdit(spanEl){
  if (activeEditing()) return;
  const card = spanEl.closest('.card');
  if (!card) return;
  const item = state.items[Number(card.dataset.origIdx)];
  if (!item || item.error) return;
  const kind = spanEl.dataset.kind;
  if (kind === 'key') startKeyEdit(item, spanEl);
  else startValueEdit(item, spanEl);
}

export function startKeyEdit(item, spanEl){
  const oldKey = spanEl.dataset.key;
  const oldPath = spanEl.dataset.path;
  const inp = el('input','edit-input');
  inp.value = oldKey;
  inp.size = Math.max(oldKey.length, 3);
  spanEl.replaceWith(inp);
  inp.focus(); inp.select();
  // Keep width tracking content as user types.
  inp.addEventListener('input', () => { inp.size = Math.max(inp.value.length, 3); });
  let done = false;
  const finish = (commit) => {
    if (done) return; done = true;
    if (commit){
      const newKey = inp.value;
      if (newKey && newKey !== oldKey){
        const ok = applyKeyRenameAtPath(item, oldPath, newKey);
        if (!ok){ rebuildCardInPlace(item); return; }
        rebuildCardInPlace(item);
        updateStats();
        analyzeSchema(); renderSidebar();
        showToast('Renamed key');
        return;
      }
    }
    const orig = makeKeyEl(oldKey, oldPath, false);
    inp.replaceWith(orig);
    if (state.colorize) applyColorize();
  };
  inp.addEventListener('keydown', (e)=>{
    if (e.key === 'Enter'){ e.preventDefault(); finish(true); }
    else if (e.key === 'Escape'){ e.preventDefault(); finish(false); }
  });
  inp.addEventListener('blur', ()=> finish(true));
}

export function startValueEdit(item, spanEl){
  const path = spanEl.dataset.path;
  const vtype = spanEl.dataset.vtype;
  const tokens = parsePath(path);
  let oldVal;
  if (!tokens.length) oldVal = item.parsed;
  else { const w = walkPath(item.parsed, tokens); oldVal = w.parent[w.lastKey]; }

  let inp;
  let autosize = null;
  if (vtype === 'string'){
    inp = el('textarea','edit-input');
    inp.value = String(oldVal);
    inp.rows = 1;
    autosize = () => {
      // Width: longest line in chars → cols.
      const longest = Math.max(...String(inp.value).split('\n').map(l => l.length), 8);
      inp.cols = Math.min(longest + 1, 80);
      // Height: scrollHeight.
      inp.style.height = 'auto';
      inp.style.height = inp.scrollHeight + 'px';
    };
  } else if (vtype === 'number'){
    inp = el('input','edit-input');
    inp.type = 'text'; inp.value = String(oldVal);
    inp.size = Math.max(String(oldVal).length, 4);
    inp.addEventListener('input', () => { inp.size = Math.max(inp.value.length, 4); });
  } else if (vtype === 'boolean'){
    inp = el('select','edit-input');
    const tOpt = document.createElement('option'); tOpt.value='true'; tOpt.textContent='true';
    const fOpt = document.createElement('option'); fOpt.value='false'; fOpt.textContent='false';
    if (oldVal === true) tOpt.selected = true; else fOpt.selected = true;
    inp.append(tOpt, fOpt);
  } else {
    inp = el('select','edit-input');
    ['string','number','boolean','null','{}','[]'].forEach(t=>{
      const o = document.createElement('option'); o.value = t; o.textContent = t;
      inp.append(o);
    });
  }
  spanEl.replaceWith(inp);
  inp.focus();
  if (typeof inp.select === 'function') try{inp.select();}catch{}
  if (autosize){
    autosize();
    inp.addEventListener('input', autosize);
    // Re-measure once layout settles (font load / wrapping).
    requestAnimationFrame(autosize);
  }

  let done = false;
  const finish = (commit) => {
    if (done) return; done = true;
    if (!commit){ rebuildCardInPlace(item); return; }
    let newVal;
    try {
      if (vtype === 'string'){ newVal = inp.value; }
      else if (vtype === 'number'){
        const n = Number(inp.value);
        if (!Number.isFinite(n)) throw new Error('not a number');
        newVal = n;
      }
      else if (vtype === 'boolean'){ newVal = (inp.value === 'true'); }
      else {
        const t = inp.value;
        if (t === 'string') newVal = '';
        else if (t === 'number') newVal = 0;
        else if (t === 'boolean') newVal = false;
        else if (t === 'null') newVal = null;
        else if (t === '{}') newVal = {};
        else if (t === '[]') newVal = [];
      }
    } catch (e) {
      showToast('Invalid: ' + e.message, 'err');
      rebuildCardInPlace(item);
      return;
    }
    applyValueAtPath(item, path, newVal);
    rebuildCardInPlace(item);
    updateStats();
    analyzeSchema(); renderSidebar();
  };
  inp.addEventListener('keydown', (e)=>{
    if (e.key === 'Escape'){ e.preventDefault(); finish(false); }
    else if (e.key === 'Enter'){
      if (vtype === 'string'){
        if (!e.shiftKey){ e.preventDefault(); finish(true); }
      } else {
        e.preventDefault(); finish(true);
      }
    }
  });
  inp.addEventListener('blur', ()=> finish(true));
}

export function openRawEditor(item, bodyEl){
  const wrap = el('div','raw-editor');
  const ta = document.createElement('textarea');
  ta.value = item.error ? item.rawText : JSON.stringify(item.parsed, null, 2);
  ta.spellcheck = false;
  const bar = el('div','raw-editor-bar');
  const status = el('span','raw-error ok','valid');
  const saveB = el('button','btn primary','Save');
  const cancelB = el('button','btn ghost','Cancel');
  bar.append(status, cancelB, saveB);
  wrap.append(ta, bar);
  bodyEl.replaceChildren(wrap);
  ta.focus();

  const validate = () => {
    try {
      const v = JSON.parse(ta.value);
      ta.classList.remove('error');
      status.classList.add('ok');
      status.textContent = 'valid JSON';
      return {ok:true, value:v};
    } catch (e) {
      ta.classList.add('error');
      status.classList.remove('ok');
      status.textContent = String(e.message || e);
      return {ok:false};
    }
  };
  ta.addEventListener('input', validate);
  validate();

  const restore = () => { rebuildCardInPlace(item); };
  cancelB.addEventListener('click', restore);
  saveB.addEventListener('click', () => {
    const r = validate();
    if (!r.ok){ showToast('Invalid JSON', 'err'); return; }
    item.parsed = r.value;
    item.error = false;
    item.dirty = true;
    recomputeItemMetrics(item);
    rebuildCardInPlace(item);
    analyzeSchema(); renderSidebar();
    updateStats();
    updateDirtyBadge();
    showToast('Item updated');
  });
  ta.addEventListener('keydown', (e)=>{
    if (e.key === 'Escape'){ e.preventDefault(); restore(); }
    else if ((e.ctrlKey || e.metaKey) && e.key === 's'){ e.preventDefault(); saveB.click(); }
    else if (e.key === 'Tab'){
      e.preventDefault();
      const s = ta.selectionStart, en = ta.selectionEnd;
      ta.value = ta.value.slice(0,s) + '  ' + ta.value.slice(en);
      ta.selectionStart = ta.selectionEnd = s + 2;
    }
  });
}

// js/view-node.js
import { el } from './dom.js';
import { state } from './state.js';
import { pathKey, pathIdx } from './path.js';
import { keyColor } from './view-colorize.js';
import { promptKey } from './modal.js';
import {
  markDirty, removeAtPath, appendArrayItem, addObjectKey,
  startInlineEdit, startKeyEdit, startValueEdit
} from './view-edit.js';
import { renderMarkdownToDOM } from './view-markdown.js';

export const makeStringSpan = (v, path) => {
  const s = el('span','str editable');
  s.dataset.raw = v;
  s.dataset.escaped = v.replaceAll('\\', '\\\\').replaceAll('\r','\\r').replaceAll('\n','\\n').replaceAll('\t','\\t');
  s.dataset.json = JSON.stringify(v);
  s.dataset.path = path;
  s.dataset.kind = 'value';
  s.dataset.vtype = 'string';
  if (state.markdown){
    s.classList.add('has-md');
    s.append(renderMarkdownToDOM(v));
  } else {
    s.textContent = state.modeNewlines ? s.dataset.raw : s.dataset.escaped;
  }
  return s;
};

// Local helper — only used by renderNode; not exported.
const renderPrimitive = (v, path) => {
  if (v === null) {
    const n = el('span','nil editable','null');
    n.dataset.json = 'null'; n.dataset.path = path; n.dataset.kind = 'value'; n.dataset.vtype = 'null';
    return n;
  }
  switch (typeof v){
    case 'string': return makeStringSpan(v, path);
    case 'number': {
      const n = el('span','num editable', String(v));
      n.dataset.json = String(v); n.dataset.path = path; n.dataset.kind = 'value'; n.dataset.vtype = 'number';
      return n;
    }
    case 'boolean': {
      const b = el('span','bool editable', String(v));
      b.dataset.json = String(v); b.dataset.path = path; b.dataset.kind = 'value'; b.dataset.vtype = 'boolean';
      return b;
    }
    default: {
      const p = el('span','pun', String(v));
      p.dataset.json = String(v); p.dataset.path = path; p.dataset.kind = 'value';
      return p;
    }
  }
};

export function makeKeyEl(keyLabel, path, isArrayIndex){
  const cls = isArrayIndex ? 'idx' : 'key editable';
  const text = isArrayIndex ? String(keyLabel) : ('"' + keyLabel + '"');
  const k = el('span', cls, text);
  k.dataset.key = String(keyLabel);
  k.dataset.path = path;
  k.dataset.kind = 'key';
  return k;
}

export function makeRowDelBtn(item, path){
  const wrap = el('span','row-actions');
  const del = el('button','row-btn del','×');
  del.title = 'Delete this entry';
  del.addEventListener('click', (e)=>{
    e.stopPropagation();
    removeAtPath(item, path);
  });
  wrap.append(del);
  return wrap;
}

export function makeNodeAddBtn(item, path, isArr){
  const b = el('button','row-btn add', isArr ? '+ item' : '+ key');
  b.title = isArr ? 'Append item' : 'Add key';
  b.addEventListener('click', async (e)=>{
    e.stopPropagation(); e.preventDefault();
    if (isArr){
      appendArrayItem(item, path);
    } else {
      const key = await promptKey();
      if (key) addObjectKey(item, path, key);
    }
  });
  return b;
}

export function makeNodeDelBtn(item, path){
  const b = el('button','row-btn del','×');
  b.title = 'Delete this entry';
  b.addEventListener('click', (e)=>{
    e.stopPropagation(); e.preventDefault();
    removeAtPath(item, path);
  });
  return b;
}

export function renderNode(item, value, keyLabel=null, path='$', isArrayIndex=false){
  const container = el('div','tree');

  if (value === null || typeof value !== 'object'){
    const row = el('div','kv');
    if (keyLabel !== null){
      row.append(makeKeyEl(keyLabel, path, isArrayIndex), el('span','pun',': '));
    }
    row.append(renderPrimitive(value, path));
    if (keyLabel !== null){
      row.append(makeRowDelBtn(item, path));
    }
    container.append(row);
    return container;
  }

  const isArr = Array.isArray(value);
  const entries = isArr ? value.map((v,i)=>[i, v]) : Object.entries(value);

  const details = el('details','tree-node'); details.open = true;
  const summary = el('summary');
  const caret = el('span','caret');
  const headOpen  = isArr ? '[' : '{';
  const headClose = isArr ? ']' : '}';
  const meta = isArr
    ? `${entries.length} item${entries.length!==1?'s':''}`
    : `${entries.length} key${entries.length!==1?'s':''}`;

  if (keyLabel !== null){
    summary.append(caret, makeKeyEl(keyLabel, path, isArrayIndex), el('span','pun',': '));
  } else {
    summary.append(caret);
  }
  summary.dataset.kind = 'node';
  summary.dataset.path = path;
  try { summary.dataset.json = JSON.stringify(value); } catch { /* ignore */ }

  summary.append(
    el('span','pun', headOpen),
    el('span','node-meta',' … ' + meta),
    el('span','pun pun-close', headClose)
  );
  const acts = el('span','row-actions');
  acts.append(makeNodeAddBtn(item, path, isArr));
  if (keyLabel !== null) acts.append(makeNodeDelBtn(item, path));
  summary.append(acts);
  details.append(summary);

  const kids = el('div','children');
  for (let [k, v] of entries){
    const childPath = isArr ? (path + pathIdx(k)) : (path + pathKey(k));
    kids.append(renderNode(item, v, k, childPath, isArr));
  }
  details.append(kids);
  container.append(details);
  return container;
}

export function applyNewlineMode(){
  document.querySelectorAll('.str').forEach(s => {
    if (s.dataset.raw == null) return;
    if (state.markdown){ renderStringSpan(s); return; }
    s.classList.remove('has-md');
    s.replaceChildren(document.createTextNode(state.modeNewlines ? s.dataset.raw : s.dataset.escaped));
  });
}

export function renderStringSpan(s){
  if (s.dataset.raw == null) return;
  if (state.markdown){
    s.classList.add('has-md');
    s.replaceChildren(renderMarkdownToDOM(s.dataset.raw));
  } else {
    s.classList.remove('has-md');
    s.replaceChildren(document.createTextNode(state.modeNewlines ? s.dataset.raw : s.dataset.escaped));
  }
}

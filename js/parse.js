// js/parse.js
import { makeItem } from './view-card.js';
import { state } from './state.js';

export function tryParseFullJSON(text){
  try { return { ok:true, value: JSON.parse(text) }; }
  catch (e){ return { ok:false, error: e }; }
}

export function parseAsJSON(value, originalText){
  state.mode = 'json';
  const items = [];
  if (Array.isArray(value)){
    state.sourceShape = 'array';
    value.forEach((item, i) => {
      let raw;
      try { raw = JSON.stringify(item); } catch { raw = ''; }
      items.push(makeItem(i, 'Item', raw, item, false));
    });
  } else {
    state.sourceShape = 'single';
    let raw;
    try { raw = JSON.stringify(value); } catch { raw = originalText; }
    items.push(makeItem(0, 'Item', raw, value, false));
  }
  return items;
}

export function parseAsJSONL(text){
  state.mode = 'jsonl';
  state.sourceShape = 'jsonl';
  const items = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (line.trim() === '') return;
    try {
      const parsed = JSON.parse(line);
      items.push(makeItem(i, 'Line', line, parsed, false));
    } catch {
      items.push(makeItem(i, 'Line', line, null, true));
    }
  });
  return items;
}

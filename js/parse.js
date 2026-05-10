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

// Streaming JSONL parser. Reads via File.stream(), parses line-by-line,
// invokes onProgress(rowsSoFar, bytesRead) periodically. Returns items[].
// Use for files >> 10MB to keep the UI responsive.
export async function parseAsJSONLStream(file, onProgress){
  state.mode = 'jsonl';
  state.sourceShape = 'jsonl';
  const items = [];
  const reader = file.stream().getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let bytes = 0;
  let lastReport = 0;
  while (true){
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0){
      const raw = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      const line = raw.replace(/\r$/, '');
      if (line.trim() === '') continue;
      const i = items.length;
      try {
        const parsed = JSON.parse(line);
        items.push(makeItem(i, 'Line', line, parsed, false));
      } catch {
        items.push(makeItem(i, 'Line', line, null, true));
      }
    }
    const now = Date.now();
    if (onProgress && now - lastReport > 100){
      onProgress(items.length, bytes);
      lastReport = now;
      // Yield to the event loop
      await new Promise(r => setTimeout(r, 0));
    }
  }
  // Flush trailing buffer
  buffer += decoder.decode();
  const tail = buffer.replace(/\r?\n$/, '').trim();
  if (tail){
    const i = items.length;
    try {
      const parsed = JSON.parse(tail);
      items.push(makeItem(i, 'Line', tail, parsed, false));
    } catch {
      items.push(makeItem(i, 'Line', tail, null, true));
    }
  }
  if (onProgress) onProgress(items.length, bytes);
  return items;
}

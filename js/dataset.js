// js/dataset.js — pure algorithms for LLM dataset curation/audit.
// No DOM, no IDB. UI lives in dataset-ui.js.

/* ---------------------------------------------------------------
 * Format profile detection
 * --------------------------------------------------------------- */

const ROLE_OPENAI = new Set(['system', 'user', 'assistant', 'tool', 'function']);

export function detectRowFormat(parsed){
  if (parsed == null || typeof parsed !== 'object') return 'unknown';
  if (Array.isArray(parsed)) return 'array';
  if (Array.isArray(parsed.messages) && parsed.messages.length){
    const ok = parsed.messages.every(m =>
      m && typeof m === 'object' && typeof m.role === 'string' &&
      ROLE_OPENAI.has(m.role) && 'content' in m
    );
    if (ok) return 'openai-chat';
    const looseOk = parsed.messages.every(m => m && typeof m === 'object' && 'role' in m && 'content' in m);
    if (looseOk) return 'openai-chat-loose';
  }
  if (Array.isArray(parsed.conversations) && parsed.conversations.length){
    const ok = parsed.conversations.every(m =>
      m && typeof m === 'object' && ('from' in m || 'role' in m) && ('value' in m || 'content' in m)
    );
    if (ok) return 'sharegpt';
  }
  if (('chosen' in parsed) && ('rejected' in parsed)){
    return 'preference-pair';
  }
  if (typeof parsed.instruction === 'string' && (typeof parsed.output === 'string' || typeof parsed.response === 'string')){
    return 'alpaca';
  }
  if (typeof parsed.prompt === 'string' && typeof parsed.completion === 'string'){
    return 'completion';
  }
  if (typeof parsed.text === 'string' && Object.keys(parsed).length <= 3){
    return 'text';
  }
  if ((typeof parsed.question === 'string' || typeof parsed.q === 'string') &&
      (typeof parsed.answer === 'string' || typeof parsed.a === 'string')){
    return 'qa';
  }
  return 'object';
}

export function profileDataset(items){
  const counts = new Map();
  let total = 0;
  for (const it of items){
    if (it.deleted) continue;
    if (it.error){ counts.set('parse-error', (counts.get('parse-error') || 0) + 1); total++; continue; }
    const f = detectRowFormat(it.parsed);
    counts.set(f, (counts.get(f) || 0) + 1);
    total++;
  }
  const arr = [...counts.entries()].sort((a,b) => b[1] - a[1]);
  const dominant = arr[0] ? arr[0][0] : 'unknown';
  const dominantPct = total ? (arr[0][1] / total) : 0;
  return { total, counts: arr, dominant, dominantPct };
}

/* ---------------------------------------------------------------
 * Role / content extraction
 * --------------------------------------------------------------- */

export function extractTurns(parsed){
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  if (Array.isArray(parsed.messages)){
    return parsed.messages.map(m => ({
      role: String(m.role ?? 'unknown'),
      content: stringifyContent(m.content)
    }));
  }
  if (Array.isArray(parsed.conversations)){
    return parsed.conversations.map(m => ({
      role: String(m.role ?? m.from ?? 'unknown'),
      content: stringifyContent(m.content ?? m.value)
    }));
  }
  if (typeof parsed.instruction === 'string' && (typeof parsed.output === 'string' || typeof parsed.response === 'string')){
    const u = parsed.instruction + (parsed.input ? '\n\n' + parsed.input : '');
    const a = parsed.output ?? parsed.response;
    return [{role:'user', content:u}, {role:'assistant', content:String(a)}];
  }
  if (typeof parsed.prompt === 'string' && typeof parsed.completion === 'string'){
    return [{role:'user', content:parsed.prompt}, {role:'assistant', content:parsed.completion}];
  }
  return [];
}

export function stringifyContent(c){
  if (c == null) return '';
  if (typeof c === 'string') return c;
  if (Array.isArray(c)){
    return c.map(part => {
      if (typeof part === 'string') return part;
      if (part && typeof part === 'object'){
        if (typeof part.text === 'string') return part.text;
        if (typeof part.content === 'string') return part.content;
      }
      return '';
    }).join('\n');
  }
  try { return JSON.stringify(c); } catch { return ''; }
}

/* ---------------------------------------------------------------
 * Token estimate
 * --------------------------------------------------------------- */

export function estTok(s){
  if (!s) return 0;
  return Math.ceil(s.length / 4);
}

export function rowTokens(item){
  if (item.error) return estTok(item.rawText);
  const turns = extractTurns(item.parsed);
  if (turns.length){
    let n = 0;
    for (const t of turns) n += estTok(t.content) + 4;
    return n;
  }
  return estTok(JSON.stringify(item.parsed));
}

/* ---------------------------------------------------------------
 * Stats
 * --------------------------------------------------------------- */

export function computeStats(items){
  const live = items.filter(it => !it.deleted);
  const tokens = [];
  const turnCounts = [];
  const roleCount = new Map();
  let parseErr = 0;
  let chatRows = 0;
  for (const it of live){
    if (it.error){ parseErr++; tokens.push(estTok(it.rawText)); continue; }
    tokens.push(rowTokens(it));
    const turns = extractTurns(it.parsed);
    if (turns.length){
      chatRows++;
      turnCounts.push(turns.length);
      for (const t of turns) roleCount.set(t.role, (roleCount.get(t.role) || 0) + 1);
    }
  }
  return {
    n: live.length,
    parseErr, chatRows,
    tokens: summarize(tokens),
    turns: summarize(turnCounts),
    tokenBuckets: bucketize(tokens, 10),
    turnBuckets: bucketize(turnCounts, 8),
    roleCount: [...roleCount.entries()].sort((a,b) => b[1] - a[1]),
  };
}

export function summarize(arr){
  if (!arr.length) return { count:0, min:0, max:0, mean:0, p50:0, p90:0, p99:0, sum:0 };
  const sorted = arr.slice().sort((a,b) => a-b);
  const sum = arr.reduce((a,b) => a+b, 0);
  const pick = p => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return {
    count: arr.length, min: sorted[0], max: sorted[sorted.length - 1],
    mean: sum / arr.length, p50: pick(0.5), p90: pick(0.9), p99: pick(0.99), sum
  };
}

export function bucketize(arr, n){
  if (!arr.length) return [];
  const sorted = arr.slice().sort((a,b) => a-b);
  const min = sorted[0], max = sorted[sorted.length - 1];
  if (min === max) return [{lo:min, hi:max, count:arr.length}];
  const w = (max - min) / n;
  const out = [];
  for (let i = 0; i < n; i++){
    const lo = min + w * i;
    const hi = i === n - 1 ? max : min + w * (i + 1);
    let count = 0;
    for (const v of arr){
      if (i === n - 1 ? v >= lo && v <= hi : v >= lo && v < hi) count++;
    }
    out.push({lo, hi, count});
  }
  return out;
}

/* ---------------------------------------------------------------
 * Dedup
 * --------------------------------------------------------------- */

export function fnv1a(str){
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < str.length; i++){
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function exactDedup(items, keyFn){
  const groups = new Map();
  for (const it of items){
    if (it.deleted) continue;
    const k = keyFn(it);
    if (!k) continue;
    const h = fnv1a(k);
    if (!groups.has(h)) groups.set(h, []);
    groups.get(h).push(it.origIdx);
  }
  return [...groups.values()].filter(arr => arr.length > 1);
}

export function simhash64(text){
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) || [];
  if (!tokens.length) return [0, 0];
  const v = new Int32Array(64);
  for (const t of tokens){
    const h1 = fnv1a(t);
    const h2 = fnv1a(t + '!');
    for (let i = 0; i < 32; i++) v[i]      += (h1 >>> i) & 1 ? 1 : -1;
    for (let i = 0; i < 32; i++) v[32 + i] += (h2 >>> i) & 1 ? 1 : -1;
  }
  let lo = 0, hi = 0;
  for (let i = 0; i < 32; i++) if (v[i] > 0) lo |= (1 << i);
  for (let i = 0; i < 32; i++) if (v[32 + i] > 0) hi |= (1 << i);
  return [lo >>> 0, hi >>> 0];
}

export function popcount32(x){
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  return (Math.imul(x, 0x01010101) >>> 24) & 0xff;
}

export function hammingDist64(a, b){
  return popcount32((a[0] ^ b[0]) >>> 0) + popcount32((a[1] ^ b[1]) >>> 0);
}

export function nearDedup(items, textFn, maxHamming = 6){
  const sigs = [];
  for (const it of items){
    if (it.deleted) continue;
    const t = textFn(it);
    if (!t || t.length < 16) continue;
    sigs.push({ origIdx: it.origIdx, sig: simhash64(t) });
  }
  const parent = sigs.map((_, i) => i);
  const find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
  for (let i = 0; i < sigs.length; i++){
    for (let j = i + 1; j < sigs.length; j++){
      if (hammingDist64(sigs[i].sig, sigs[j].sig) <= maxHamming) union(i, j);
    }
  }
  const groups = new Map();
  for (let i = 0; i < sigs.length; i++){
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(sigs[i].origIdx);
  }
  return [...groups.values()].filter(arr => arr.length > 1);
}

export function rowText(item){
  if (item.error) return item.rawText;
  const turns = extractTurns(item.parsed);
  if (turns.length) return turns.map(t => t.role + ': ' + t.content).join('\n');
  try { return JSON.stringify(item.parsed); } catch { return ''; }
}

export function rowAssistantText(item){
  if (item.error) return '';
  const turns = extractTurns(item.parsed);
  return turns.filter(t => t.role === 'assistant' || t.role === 'gpt').map(t => t.content).join('\n');
}

/* ---------------------------------------------------------------
 * PII scrub
 * --------------------------------------------------------------- */

export const PII_PATTERNS = [
  { id:'email',  re:/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, repl:'<EMAIL>' },
  { id:'phone',  re:/(?:\+?\d[\d -]{8,}\d)/g, repl:'<PHONE>' },
  { id:'ipv4',   re:/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, repl:'<IP>' },
  { id:'ipv6',   re:/\b(?:[A-Fa-f0-9]{1,4}:){2,7}[A-Fa-f0-9]{1,4}\b/g, repl:'<IP6>' },
  { id:'cc',     re:/\b(?:\d[ -]?){13,19}\b/g, repl:'<CC>', validate:luhnOk },
  { id:'ssn',    re:/\b\d{3}-\d{2}-\d{4}\b/g, repl:'<SSN>' },
  { id:'apikey', re:/\b(?:sk-[A-Za-z0-9]{20,}|sk_live_[A-Za-z0-9]{16,}|AIza[0-9A-Za-z_-]{30,}|ghp_[A-Za-z0-9]{30,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/g, repl:'<APIKEY>' },
  { id:'jwt',    re:/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\b/g, repl:'<JWT>' },
  { id:'url',    re:/\bhttps?:\/\/[^\s)\]"']+/g, repl:'<URL>' },
];

export function luhnOk(s){
  const d = s.replace(/[ -]/g, '');
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0, alt = false;
  for (let i = d.length - 1; i >= 0; i--){
    let n = +d[i];
    if (Number.isNaN(n)) return false;
    if (alt){ n *= 2; if (n > 9) n -= 9; }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export function scanPII(text, enabled){
  const findings = [];
  if (!text) return findings;
  for (const p of PII_PATTERNS){
    if (enabled && !enabled.has(p.id)) continue;
    for (const m of text.matchAll(p.re)){
      if (p.validate && !p.validate(m[0])) continue;
      findings.push({ id:p.id, start:m.index, end:m.index + m[0].length, match:m[0] });
    }
  }
  return findings;
}

export function redactPII(text, enabled){
  if (!text) return { text, count:0 };
  let out = text, count = 0;
  for (const p of PII_PATTERNS){
    if (enabled && !enabled.has(p.id)) continue;
    out = out.replace(p.re, (m) => {
      if (p.validate && !p.validate(m)) return m;
      count++;
      return p.repl;
    });
  }
  return { text: out, count };
}

export function redactJSON(value, enabled){
  let count = 0;
  const walk = (v) => {
    if (typeof v === 'string'){
      const r = redactPII(v, enabled);
      count += r.count;
      return r.text;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object'){
      const out = {};
      for (const k of Object.keys(v)) out[k] = walk(v[k]);
      return out;
    }
    return v;
  };
  return [walk(value), count];
}

/* ---------------------------------------------------------------
 * Lint pack
 * --------------------------------------------------------------- */

export function lintRow(item){
  const issues = [];
  if (item.deleted) return issues;
  if (item.error){ issues.push({ code:'parse-error', sev:'error', msg:'JSON parse error' }); return issues; }
  const p = item.parsed;
  const fmt = detectRowFormat(p);
  if (fmt === 'openai-chat' || fmt === 'openai-chat-loose' || fmt === 'sharegpt'){
    const turns = extractTurns(p);
    if (!turns.length) issues.push({ code:'empty-turns', sev:'error', msg:'messages/conversations is empty' });
    let lastRole = null, hasAssistant = false;
    for (let i = 0; i < turns.length; i++){
      const t = turns[i];
      if (!t.content || !t.content.trim()) issues.push({ code:'empty-content', sev:'warn', msg:`turn ${i} (${t.role}) has empty content` });
      if (t.role === 'assistant' || t.role === 'gpt') hasAssistant = true;
      if (lastRole && lastRole === t.role && (t.role === 'user' || t.role === 'assistant' || t.role === 'human' || t.role === 'gpt')){
        issues.push({ code:'consecutive-role', sev:'warn', msg:`consecutive '${t.role}' turns at ${i}` });
      }
      lastRole = t.role;
    }
    if (turns.length && !hasAssistant) issues.push({ code:'no-assistant', sev:'warn', msg:'no assistant turn' });
  } else if (fmt === 'preference-pair'){
    if (!p.chosen || !p.rejected) issues.push({ code:'pref-empty', sev:'error', msg:'chosen/rejected empty' });
    if (typeof p.chosen === 'string' && typeof p.rejected === 'string' && p.chosen.trim() === p.rejected.trim()){
      issues.push({ code:'pref-equal', sev:'warn', msg:'chosen equals rejected' });
    }
  } else if (fmt === 'alpaca'){
    if (!p.instruction || !String(p.instruction).trim()) issues.push({ code:'empty-instruction', sev:'error', msg:'empty instruction' });
    const out = p.output ?? p.response;
    if (!out || !String(out).trim()) issues.push({ code:'empty-output', sev:'error', msg:'empty output' });
  }
  const tok = rowTokens(item);
  if (tok < 5) issues.push({ code:'very-short', sev:'warn', msg:`only ~${tok} tokens` });
  return issues;
}

export function lintAll(items){
  const out = [];
  for (const it of items){
    if (it.deleted) continue;
    const issues = lintRow(it);
    if (issues.length) out.push({ origIdx: it.origIdx, issues });
  }
  return out;
}

/* ---------------------------------------------------------------
 * Format conversions
 * --------------------------------------------------------------- */

export function shareGPTToOpenAI(parsed){
  const turns = parsed.conversations || [];
  const roleMap = { human:'user', gpt:'assistant', system:'system', tool:'tool' };
  const messages = turns.map(t => ({
    role: roleMap[t.from] ?? roleMap[t.role] ?? t.role ?? t.from ?? 'user',
    content: typeof (t.value ?? t.content) === 'string' ? (t.value ?? t.content) : JSON.stringify(t.value ?? t.content)
  }));
  const out = { ...parsed };
  delete out.conversations;
  out.messages = messages;
  return out;
}

export function openAIToShareGPT(parsed){
  const turns = parsed.messages || [];
  const roleMap = { user:'human', assistant:'gpt', system:'system', tool:'tool' };
  const conversations = turns.map(m => ({
    from: roleMap[m.role] ?? m.role,
    value: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
  }));
  const out = { ...parsed };
  delete out.messages;
  out.conversations = conversations;
  return out;
}

export function alpacaToOpenAI(parsed){
  const u = String(parsed.instruction ?? '') + (parsed.input ? '\n\n' + parsed.input : '');
  const a = String(parsed.output ?? parsed.response ?? '');
  const messages = [{ role:'user', content:u }, { role:'assistant', content:a }];
  return { messages };
}

export function completionToOpenAI(parsed){
  return { messages: [
    { role:'user', content: String(parsed.prompt ?? '') },
    { role:'assistant', content: String(parsed.completion ?? '') }
  ]};
}

/* ---------------------------------------------------------------
 * Sampling + split
 * --------------------------------------------------------------- */

export function mulberry32(seed){
  let t = seed >>> 0;
  return function(){
    t |= 0; t = (t + 0x6D2B79F5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(arr, seed){
  const rng = mulberry32(seed);
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--){
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function splitDataset(items, ratios = [0.8, 0.1, 0.1], seed = 1){
  const live = items.filter(it => !it.deleted);
  const idxs = shuffle(live.map(it => it.origIdx), seed);
  const total = idxs.length;
  const sum = ratios.reduce((a,b) => a+b, 0) || 1;
  const norm = ratios.map(r => r / sum);
  const out = [];
  let consumed = 0;
  for (let i = 0; i < norm.length; i++){
    const take = i === norm.length - 1
      ? idxs.length - consumed
      : Math.floor(total * norm[i]);
    out.push(idxs.slice(consumed, consumed + take));
    consumed += take;
  }
  return out;
}

export function sample(items, n, seed = 1){
  const live = items.filter(it => !it.deleted);
  const idxs = shuffle(live.map(it => it.origIdx), seed);
  return idxs.slice(0, Math.min(n, idxs.length));
}

/* ---------------------------------------------------------------
 * Leakage check
 * --------------------------------------------------------------- */

function rowChunks(item){
  // Yield comparable text fragments for an item: each turn's content separately,
  // plus the joined rowText. Strings only.
  const out = [];
  if (item.error){ if (item.rawText) out.push(item.rawText); return out; }
  const turns = extractTurns(item.parsed);
  if (turns.length){
    for (const t of turns) if (t.content) out.push(String(t.content));
    return out;
  }
  // Non-chat: walk strings in JSON
  const walk = (v) => {
    if (typeof v === 'string'){ if (v) out.push(v); return; }
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') for (const k of Object.keys(v)) walk(v[k]);
  };
  walk(item.parsed);
  return out;
}

function norm(s){ return s.toLowerCase().replace(/\s+/g, ' ').trim(); }

export function leakageCheck(itemsA, itemsB, opts = {}){
  const minLen = opts.minLen || 64;
  const nearH = opts.nearHamming ?? 4;
  // Build chunk set from A using per-turn content.
  const chunks = new Set();
  const simsA = [];
  for (const it of itemsA){
    if (it.deleted) continue;
    for (const c of rowChunks(it)){
      const n = norm(c);
      if (n.length >= minLen) chunks.add(n);
    }
    const t = rowText(it);
    if (t.length >= 16) simsA.push({ origIdx: it.origIdx, sig: simhash64(t) });
  }
  const hits = [];
  for (const it of itemsB){
    if (it.deleted) continue;
    let exact = false;
    for (const cb of rowChunks(it)){
      const nb = norm(cb);
      if (nb.length < 8) continue;
      for (const c of chunks){
        if (nb.includes(c) || c.includes(nb)){ exact = true; break; }
      }
      if (exact) break;
    }
    if (exact){ hits.push({ origIdx: it.origIdx, kind:'exact' }); continue; }
    const t = rowText(it);
    if (t.length < 16) continue;
    const sig = simhash64(t);
    for (const a of simsA){
      if (hammingDist64(sig, a.sig) <= nearH){
        hits.push({ origIdx: it.origIdx, kind:'near', matchA: a.origIdx });
        break;
      }
    }
  }
  return hits;
}

/* ---------------------------------------------------------------
 * JSON Schema validate (subset)
 * --------------------------------------------------------------- */

export function validateAgainstSchema(value, schema, path = '$'){
  const errs = [];
  if (!schema || typeof schema !== 'object') return errs;
  if (schema.const !== undefined && JSON.stringify(value) !== JSON.stringify(schema.const)){
    errs.push({ path, msg:`expected const ${JSON.stringify(schema.const)}` });
  }
  if (Array.isArray(schema.enum) && !schema.enum.some(e => JSON.stringify(e) === JSON.stringify(value))){
    errs.push({ path, msg:`not in enum` });
  }
  if (schema.type){
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const ok = types.some(t => typeMatches(value, t));
    if (!ok) errs.push({ path, msg:`expected type ${types.join('|')}, got ${jsonType(value)}` });
  }
  if (typeof value === 'string'){
    if (schema.minLength != null && value.length < schema.minLength) errs.push({ path, msg:`minLength ${schema.minLength}` });
    if (schema.maxLength != null && value.length > schema.maxLength) errs.push({ path, msg:`maxLength ${schema.maxLength}` });
    if (schema.pattern){
      try { if (!new RegExp(schema.pattern).test(value)) errs.push({ path, msg:`pattern mismatch` }); } catch {}
    }
  }
  if (typeof value === 'number'){
    if (schema.minimum != null && value < schema.minimum) errs.push({ path, msg:`< minimum ${schema.minimum}` });
    if (schema.maximum != null && value > schema.maximum) errs.push({ path, msg:`> maximum ${schema.maximum}` });
  }
  if (Array.isArray(value)){
    if (schema.minItems != null && value.length < schema.minItems) errs.push({ path, msg:`minItems ${schema.minItems}` });
    if (schema.maxItems != null && value.length > schema.maxItems) errs.push({ path, msg:`maxItems ${schema.maxItems}` });
    if (schema.items){
      for (let i = 0; i < value.length; i++){
        const sub = Array.isArray(schema.items) ? schema.items[i] : schema.items;
        if (sub) errs.push(...validateAgainstSchema(value[i], sub, `${path}[${i}]`));
      }
    }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)){
    if (Array.isArray(schema.required)){
      for (const k of schema.required){
        if (!(k in value)) errs.push({ path:`${path}.${k}`, msg:`required` });
      }
    }
    if (schema.properties){
      for (const k of Object.keys(schema.properties)){
        if (k in value) errs.push(...validateAgainstSchema(value[k], schema.properties[k], `${path}.${k}`));
      }
    }
  }
  if (Array.isArray(schema.allOf)) for (const s of schema.allOf) errs.push(...validateAgainstSchema(value, s, path));
  if (Array.isArray(schema.anyOf)){
    const sub = schema.anyOf.map(s => validateAgainstSchema(value, s, path));
    if (!sub.some(x => x.length === 0)) errs.push({ path, msg:`anyOf failed` });
  }
  if (Array.isArray(schema.oneOf)){
    const passed = schema.oneOf.filter(s => validateAgainstSchema(value, s, path).length === 0).length;
    if (passed !== 1) errs.push({ path, msg:`oneOf matched ${passed}` });
  }
  return errs;
}

function jsonType(v){
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

function typeMatches(v, t){
  if (t === 'null') return v === null;
  if (t === 'array') return Array.isArray(v);
  if (t === 'integer') return typeof v === 'number' && Number.isInteger(v);
  if (t === 'number') return typeof v === 'number';
  if (t === 'object') return v !== null && typeof v === 'object' && !Array.isArray(v);
  if (t === 'string' || t === 'boolean') return typeof v === t;
  return false;
}

/* ---------------------------------------------------------------
 * Declarative bulk transform (no eval)
 *   ops: array of {op, path?, pattern?, replacement?, value?, key?}
 *   ops:
 *     - regex-replace { pattern, flags?, replacement, scope?: 'all'|'assistant'|'user' }
 *     - set-key { key, value }      (value is JSON)
 *     - remove-key { key }
 *     - rename-key { from, to }
 *     - drop-empty-turns
 *     - lowercase-roles
 *     - trim-whitespace
 *     - drop-system
 *
 * Path navigation uses simple dot/bracket: $, .key, [n].
 * --------------------------------------------------------------- */

function clone(v){
  if (typeof structuredClone === 'function') return structuredClone(v);
  return JSON.parse(JSON.stringify(v));
}

function buildRegex(pattern, flags){
  return new RegExp(pattern, flags ?? 'g');
}

function applyOpToString(s, op, re){
  if (op.op === 'regex-replace'){
    return s.replace(re, op.replacement ?? '');
  }
  if (op.op === 'trim-whitespace'){
    return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  return s;
}

export function applyOps(parsed, ops){
  if (parsed == null) return parsed;
  let v = clone(parsed);
  for (const op of ops){
    if (op.op === 'regex-replace'){
      const re = buildRegex(op.pattern, op.flags);
      const scope = op.scope || 'all';
      const turns = extractTurns(v);
      if (turns.length){
        // Apply on messages or conversations
        if (Array.isArray(v.messages)){
          v.messages = v.messages.map(m => {
            if (scope !== 'all' && m.role !== scope) return m;
            if (typeof m.content === 'string') return { ...m, content: applyOpToString(m.content, op, re) };
            return m;
          });
        } else if (Array.isArray(v.conversations)){
          v.conversations = v.conversations.map(c => {
            const role = c.role || c.from;
            if (scope !== 'all' && role !== scope && !(scope === 'user' && role === 'human') && !(scope === 'assistant' && role === 'gpt')) return c;
            const key = 'value' in c ? 'value' : 'content';
            if (typeof c[key] === 'string') return { ...c, [key]: applyOpToString(c[key], op, re) };
            return c;
          });
        }
      } else if (v && typeof v === 'object'){
        // Walk all string fields
        const walk = (node) => {
          if (typeof node === 'string') return applyOpToString(node, op, re);
          if (Array.isArray(node)) return node.map(walk);
          if (node && typeof node === 'object'){
            const out = {};
            for (const k of Object.keys(node)) out[k] = walk(node[k]);
            return out;
          }
          return node;
        };
        v = walk(v);
      }
    } else if (op.op === 'set-key'){
      if (v && typeof v === 'object' && !Array.isArray(v)) v[op.key] = clone(op.value);
    } else if (op.op === 'remove-key'){
      if (v && typeof v === 'object' && !Array.isArray(v)) delete v[op.key];
    } else if (op.op === 'rename-key'){
      if (v && typeof v === 'object' && !Array.isArray(v) && (op.from in v)){
        v[op.to] = v[op.from];
        delete v[op.from];
      }
    } else if (op.op === 'drop-empty-turns'){
      if (Array.isArray(v.messages)) v.messages = v.messages.filter(m => m && (typeof m.content === 'string' ? m.content.trim() : m.content));
      if (Array.isArray(v.conversations)) v.conversations = v.conversations.filter(c => {
        const val = c.value ?? c.content;
        return val && (typeof val === 'string' ? val.trim() : val);
      });
    } else if (op.op === 'lowercase-roles'){
      if (Array.isArray(v.messages)) v.messages = v.messages.map(m => m && m.role ? { ...m, role: String(m.role).toLowerCase() } : m);
      if (Array.isArray(v.conversations)) v.conversations = v.conversations.map(c => ({ ...c, from: c.from ? String(c.from).toLowerCase() : c.from, role: c.role ? String(c.role).toLowerCase() : c.role }));
    } else if (op.op === 'trim-whitespace'){
      const re = null;
      const walk = (node) => {
        if (typeof node === 'string') return applyOpToString(node, op, re);
        if (Array.isArray(node)) return node.map(walk);
        if (node && typeof node === 'object'){
          const out = {};
          for (const k of Object.keys(node)) out[k] = walk(node[k]);
          return out;
        }
        return node;
      };
      v = walk(v);
    } else if (op.op === 'drop-system'){
      if (Array.isArray(v.messages)) v.messages = v.messages.filter(m => m && m.role !== 'system');
      if (Array.isArray(v.conversations)) v.conversations = v.conversations.filter(c => (c.from ?? c.role) !== 'system');
    }
  }
  return v;
}

export function dryRunOps(items, ops, limit = 20){
  const out = [];
  let touched = 0, errors = 0;
  for (let i = 0; i < items.length; i++){
    const it = items[i];
    if (it.deleted || it.error) continue;
    const before = it.parsed;
    let after, err = null;
    try { after = applyOps(it.parsed, ops); }
    catch (e){ err = String(e.message || e); errors++; }
    const changed = !err && JSON.stringify(after) !== JSON.stringify(before);
    if (changed) touched++;
    if (out.length < limit) out.push({ origIdx: it.origIdx, before, after, err, changed });
  }
  return { preview: out, touched, errors };
}

/* ---------------------------------------------------------------
 * Diff
 * --------------------------------------------------------------- */

export function diffJSON(a, b, path = '$'){
  const out = [];
  if (jsonType(a) !== jsonType(b)){
    out.push({ path, kind:'change', from:a, to:b });
    return out;
  }
  if (a === b) return out;
  if (typeof a !== 'object' || a === null){
    if (a !== b) out.push({ path, kind:'change', from:a, to:b });
    return out;
  }
  if (Array.isArray(a)){
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++){
      if (i >= a.length) out.push({ path:`${path}[${i}]`, kind:'add', to:b[i] });
      else if (i >= b.length) out.push({ path:`${path}[${i}]`, kind:'remove', from:a[i] });
      else out.push(...diffJSON(a[i], b[i], `${path}[${i}]`));
    }
    return out;
  }
  const ks = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of ks){
    if (!(k in a)) out.push({ path:`${path}.${k}`, kind:'add', to:b[k] });
    else if (!(k in b)) out.push({ path:`${path}.${k}`, kind:'remove', from:a[k] });
    else out.push(...diffJSON(a[k], b[k], `${path}.${k}`));
  }
  return out;
}

if (typeof window !== 'undefined'){
  window.__dataset = {
    detectRowFormat, profileDataset, extractTurns,
    computeStats, summarize, bucketize,
    fnv1a, exactDedup, simhash64, hammingDist64, nearDedup,
    rowText, rowAssistantText, rowTokens,
    PII_PATTERNS, scanPII, redactPII, redactJSON, luhnOk,
    lintRow, lintAll,
    shareGPTToOpenAI, openAIToShareGPT, alpacaToOpenAI, completionToOpenAI,
    splitDataset, sample, mulberry32,
    leakageCheck, validateAgainstSchema,
    applyOps, dryRunOps,
    diffJSON,
  };
}

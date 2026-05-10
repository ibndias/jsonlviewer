// js/files.js
import {
  el, $, showToast,
  $drop, $list, $sortSel, $search, $minTokens, $maxTokens, $loadMore
} from './dom.js';
import { state, newFileId } from './state.js';
import { tryParseFullJSON, parseAsJSON, parseAsJSONL, parseAsJSONLStream } from './parse.js';
import { analyzeSchema, renderSidebar } from './schema.js';
import { renderView, updateStats, updateDirtyBadge } from './view.js';
import { confirmModal } from './modal.js';
import { exportRawFor } from './view-card.js';
import { fmtNum } from './path.js';
import { flushFile, flushFileDebounced, getActiveProject, loadActiveProjectFiles, deleteFile as _projectsDeleteFile, getSettings } from './projects.js';

/* ---- Per-file snapshot helpers ---- */
// Save current per-file state into the active file's snapshot.
export function snapshotCurrent(){
  if (!state.activeId) return;
  const f = state.files.find(x => x.id === state.activeId);
  if (!f) return;
  f.snapshot = {
    fileName: state.fileName,
    mode: state.mode,
    sourceShape: state.sourceShape,
    items: state.items,
    schema: state.schema,
    selectedKeys: new Set(state.selectedKeys),
    searchQuery: state.searchQuery,
    minTokens: state.minTokens,
    maxTokens: state.maxTokens,
    sortMode: state.sortMode,
    pagesShown: state.pagesShown,
    viewItems: state.viewItems,
    activeOrigIdx: state.activeOrigIdx,
  };
}
export function applyFromFile(f){
  const s = f.snapshot;
  if (!s) return;
  state.fileName = s.fileName;
  state.mode = s.mode;
  state.sourceShape = s.sourceShape;
  state.items = s.items;
  state.schema = s.schema;
  state.selectedKeys = new Set(s.selectedKeys);
  state.searchQuery = s.searchQuery;
  state.minTokens = s.minTokens;
  state.maxTokens = s.maxTokens;
  state.sortMode = s.sortMode;
  state.pagesShown = s.pagesShown;
  state.viewItems = s.viewItems;
  state.activeOrigIdx = s.activeOrigIdx;
  state.activeId = f.id;
  $search.value = state.searchQuery || '';
  $minTokens.value = state.minTokens != null ? state.minTokens : '';
  $maxTokens.value = state.maxTokens != null ? state.maxTokens : '';
  $sortSel.value = state.sortMode;
}
export function switchToFile(id){
  if (!id || state.activeId === id) return;
  snapshotCurrent();
  const f = state.files.find(x => x.id === id);
  if (!f) return;
  applyFromFile(f);
  renderFileTree();
  analyzeSchema();
  renderSidebar();
  renderView();
  // Compact drop banner reflects the active file.
  if ($drop && state.fileName){
    $drop.classList.add('compact');
    $drop.style.display = 'none';
  }
}
export async function closeFile(id){
  const idx = state.files.findIndex(x => x.id === id);
  if (idx < 0) return;
  if (state.activeId === id){
    // Wipe current state; if other files exist, switch to next.
    const next = state.files[idx + 1] || state.files[idx - 1] || null;
    state.files.splice(idx, 1);
    if (next){
      state.activeId = null;
      applyFromFile(next);
      analyzeSchema(); renderSidebar(); renderView();
    } else {
      state.activeId = null;
      resetView();
      state.fileName = '';
      $drop.classList.remove('compact');
      const main = $drop.firstElementChild;
      main.replaceChildren();
      const s = el('strong', null, 'Drag & drop');
      main.append(s,
        document.createTextNode(' a '),
        el('code', null, '.json'),
        document.createTextNode(' or '),
        el('code', null, '.jsonl'),
        document.createTextNode(' file here, or click '),
        el('em', null, 'Open'),
        document.createTextNode('.'));
      analyzeSchema(); renderSidebar(); renderView(); updateStats();
    }
  } else {
    state.files.splice(idx, 1);
  }
  renderFileTree();
  try {
    if (getActiveProject()){
      await _projectsDeleteFile(id);
    }
  } catch (e) { console.warn('deleteFile failed:', e); }
}

/* Load file */
export function resetView(){
  state.items = [];
  state.schema = new Map();
  state.selectedKeys = new Set();
  state.viewItems = [];
  state.pagesShown = 1;
  state.activeOrigIdx = -1;
  state.searchQuery = '';
  state.minTokens = null;
  state.maxTokens = null;
  state.sortMode = 'default';
  $search.value = '';
  $minTokens.value = '';
  $maxTokens.value = '';
  $sortSel.value = 'default';
  $list.replaceChildren();
  $loadMore.replaceChildren();
  updateDirtyBadge();
}

// Parse a single File into the current state slot. Used by both initial
// load (no prior file) and append-as-new-file (multi-file mode).
export async function _parseFileIntoState(file, folder=''){
  resetView();
  state.fileName = file.name;
  updateStats();

  const lower = (file.name || '').toLowerCase();
  const STREAM_THRESHOLD = 10 * 1024 * 1024; // 10 MB

  let items;
  if (lower.endsWith('.jsonl') && file.size > STREAM_THRESHOLD && typeof file.stream === 'function'){
    // Streaming JSONL parse with toast progress
    const banner = el('div','load-banner','Loading… 0 rows');
    document.body.append(banner);
    try {
      items = await parseAsJSONLStream(file, (rows, bytes) => {
        const pct = file.size ? Math.min(99, Math.floor((bytes / file.size) * 100)) : 0;
        banner.textContent = `Loading ${file.name}… ${rows.toLocaleString()} rows · ${pct}%`;
      });
    } finally {
      banner.remove();
    }
  } else {
    const text = await file.text();
    if (lower.endsWith('.json')) {
      const full = tryParseFullJSON(text);
      items = full.ok ? parseAsJSON(full.value, text) : parseAsJSONL(text);
    } else {
      const full = tryParseFullJSON(text);
      if (full.ok && (typeof full.value !== 'string')) items = parseAsJSON(full.value, text);
      else items = parseAsJSONL(text);
    }
  }
  items.forEach((it, i) => { it.origIdx = i; });
  state.items = items;
}

export async function loadFile(file, opts={}){
  const folder = opts.folder || '';
  // If we have an active file with edits, snapshot it before parking;
  // we now ALWAYS open additional files as new tabs (no overwrite).
  snapshotCurrent();
  await _parseFileIntoState(file, folder);

  // Register new file slot.
  const id = opts.persistedId || newFileId();
  const slot = {id, folder, snapshot:null};
  state.files.push(slot);
  state.activeId = id;
  snapshotCurrent();

  analyzeSchema();
  renderSidebar();
  renderView();
  renderFileTree();

  $drop.classList.add('compact');
  $drop.style.display = 'none';

  // First, try restoring a persisted audit for the same file (fast).
  setTimeout(() => { try { window.__dataset_ui?.tryRestoreAuditCache?.(); } catch {} }, 0);
  // Then auto-run audit on small datasets so the panel score is ambient.
  if (state.items.length && state.items.length <= 5000){
    setTimeout(() => { try { window.__dataset_ui?.runAuditSilent?.(); } catch {} }, 50);
  }

  // Persist to IDB unless suppressed (cache restore path).
  if (!opts.suppressFlush){
    try {
      const settings = await getSettings();
      const capBytes = (settings.bigFileCapMB || 50) * 1024 * 1024;
      const proj = getActiveProject();
      if (proj){
        if (file.size > capBytes){
          // Session-only: write metadata row without content.
          await flushFile({
            id,
            projectId: proj.id,
            name: file.name,
            folder,
            ext: file.name.toLowerCase().endsWith('.jsonl') ? 'jsonl' : 'json',
            sizeBytes: file.size,
            sessionOnly: true,
            content: undefined,
            updatedAt: Date.now()
          });
          showToast(`${file.name} kept session-only (>${settings.bigFileCapMB}MB)`);
        } else {
          const text = await file.text();
          await flushFile({
            id,
            projectId: proj.id,
            name: file.name,
            folder,
            ext: file.name.toLowerCase().endsWith('.jsonl') ? 'jsonl' : 'json',
            sizeBytes: file.size,
            sessionOnly: false,
            content: text,
            updatedAt: Date.now()
          });
        }
      }
    } catch (e) {
      console.warn('flushFile failed:', e);
    }
  }
}

export async function loadFiles(fileList, opts={}){
  if (!fileList || !fileList.length) return;
  // For folder upload, use webkitRelativePath as folder source.
  const filtered = [...fileList].filter(f => /\.(json|jsonl|txt|log)$/i.test(f.name));
  if (!filtered.length){ showToast('No .json/.jsonl files found', 'err'); return; }
  for (const f of filtered){
    const rel = f.webkitRelativePath || '';
    const folder = rel ? rel.split('/').slice(0,-1).join('/') : (opts.folder || '');
    await loadFile(f, {folder});
  }
  showToast(`Loaded ${filtered.length} file${filtered.length===1?'':'s'}`);
}

/* ---------- File tree render ---------- */
export function renderFileTree(){
  const tree = $('fileTree');
  if (!tree) return;
  if (!state.files.length){
    tree.replaceChildren(el('div','file-tree-empty','No files open. Drop here or use the buttons below.'));
    return;
  }
  // Group by folder path
  const groups = new Map(); // folderPath -> [slots]
  for (const f of state.files){
    const k = f.folder || '';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(f);
  }
  const frag = document.createDocumentFragment();
  // Root files first (no folder)
  if (groups.has('')){
    for (const slot of groups.get('')) frag.append(buildFileRow(slot));
    groups.delete('');
  }
  const folderNames = [...groups.keys()].sort();
  for (const fname of folderNames){
    frag.append(buildFolderRow(fname, groups.get(fname)));
  }
  tree.replaceChildren(frag);
}
export function buildFileRow(slot){
  const live = (slot.id === state.activeId);
  const s = live ? state : (slot.snapshot || {});
  const row = el('div','file-row');
  row.dataset.id = slot.id;
  if (live) row.classList.add('active');
  const items = s.items || [];
  const dirty = items.some(it => it.dirty || it.deleted);
  if (dirty) row.classList.add('dirty');
  const ext = (s.fileName || '').toLowerCase().endsWith('.jsonl') ? 'JSONL' : 'JSON';
  row.append(
    el('span','file-icon', ext),
    el('span','file-name', s.fileName || '(untitled)'),
    el('span','file-meta', String(items.filter(it=>!it.deleted).length))
  );
  const close = el('button','file-close','×');
  close.title = 'Close file';
  close.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (dirty){
      const ok = await confirmModal({
        title:'Close file with unsaved edits?',
        body:'Edits in "' + (s.fileName || 'this file') + '" will be lost.',
        okLabel:'Close', dangerous:true
      });
      if (!ok) return;
    }
    closeFile(slot.id);
  });
  row.append(close);
  row.addEventListener('click', () => switchToFile(slot.id));
  return row;
}
export function buildFolderRow(name, slots){
  const wrap = document.createDocumentFragment();
  const head = el('div','folder-row open');
  head.append(
    el('span','folder-caret'),
    (() => {
      const span = el('span','folder-icon');
      const SVG = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(SVG, 'svg');
      svg.setAttribute('class', 'icon');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '2');
      svg.setAttribute('stroke-linecap', 'round');
      svg.setAttribute('stroke-linejoin', 'round');
      const path = document.createElementNS(SVG, 'path');
      path.setAttribute('d', 'M4 4h4l2 2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z');
      svg.append(path);
      span.append(svg);
      return span;
    })(),
    el('span','file-name', name + '/'),
    el('span','file-meta', String(slots.length))
  );
  const kids = el('div','folder-children');
  for (const slot of slots) kids.append(buildFileRow(slot));
  head.addEventListener('click', () => {
    const isOpen = head.classList.toggle('open') === false ? false : head.classList.contains('open');
    kids.classList.toggle('collapsed', !isOpen);
  });
  wrap.append(head, kids);
  return wrap;
}

/* Save full file (preserves source shape) */
export function saveFile(){
  const live = state.items.filter(it => !it.deleted);
  if (!live.length){ showToast('Nothing to save'); return; }
  let text, ext, mime;
  if (state.sourceShape === 'array'){
    const arr = live.map(it => it.error ? null : it.parsed);
    text = JSON.stringify(arr, null, 2);
    ext = 'json'; mime = 'application/json';
  } else if (state.sourceShape === 'single'){
    const v = live[0].error ? null : live[0].parsed;
    text = JSON.stringify(v, null, 2);
    ext = 'json'; mime = 'application/json';
  } else {
    const lines = live.map(it => exportRawFor(it)).filter(Boolean);
    text = lines.join('\n') + '\n';
    ext = 'jsonl'; mime = 'application/jsonl';
  }
  const blob = new Blob([text], {type:mime});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const base = (state.fileName || 'export').replace(/\.(json|jsonl|txt|log)$/i, '');
  a.href = url;
  a.download = `${base}-edited.${ext}`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  for (const it of state.items) it.dirty = false;
  state.items = state.items.filter(it => !it.deleted);
  state.items.forEach((it, i)=>{ it.origIdx = i; it.fileIdx = i; it._cardEl = null; it.originalParsed = it.error ? null : structuredClone(it.parsed); });
  analyzeSchema(); renderSidebar();
  renderView();
  updateDirtyBadge();
  showToast(`Saved ${fmtNum(live.length)} item${live.length===1?'':'s'}`);
}

export function readNumOrNull(v){
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
export function onLengthChange(){
  state.minTokens = readNumOrNull($minTokens.value);
  state.maxTokens = readNumOrNull($maxTokens.value);
  state.pagesShown = 1;
  renderView();
}

/* Drag & drop — multi-file capable. Tries to read folders too via
   DataTransferItem.webkitGetAsEntry where supported. */
export async function handleDrop(e){
  const dt = e.dataTransfer;
  if (!dt) return;
  // Try entry API for folder support
  const entries = [];
  if (dt.items && dt.items.length){
    for (const it of dt.items){
      if (typeof it.webkitGetAsEntry === 'function'){
        const ent = it.webkitGetAsEntry();
        if (ent) entries.push(ent);
      }
    }
  }
  if (entries.length){
    const collected = [];
    for (const ent of entries){
      await collectEntry(ent, '', collected);
    }
    if (collected.length){ await loadFiles(collected); return; }
  }
  // Fallback: plain files list
  if (dt.files && dt.files.length) await loadFiles(dt.files);
}
export function collectEntry(entry, folderPath, out){
  return new Promise(resolve => {
    if (entry.isFile){
      entry.file(file => {
        // Decorate webkitRelativePath via folderPath
        if (folderPath) try { Object.defineProperty(file, 'webkitRelativePath', {value: folderPath + '/' + file.name}); } catch {}
        out.push(file);
        resolve();
      }, () => resolve());
    } else if (entry.isDirectory){
      const reader = entry.createReader();
      const next = folderPath ? folderPath + '/' + entry.name : entry.name;
      const readBatch = () => reader.readEntries(async (batch) => {
        if (!batch.length){ resolve(); return; }
        for (const child of batch) await collectEntry(child, next, out);
        readBatch();
      }, () => resolve());
      readBatch();
    } else { resolve(); }
  });
}

/* ---------- Cache restore ---------- */
let _loadFileStub = null;

export function __setLoadFileStub(fn){ _loadFileStub = fn; }
export function __clearLoadFileStub(){ _loadFileStub = null; }

export async function restoreFromCache(){
  const cached = await loadActiveProjectFiles();
  for (const row of cached){
    if (row.sessionOnly || !row.content){
      // Add a placeholder slot so the tree shows the file. Mark sessionOnly.
      const slot = {id: row.id, folder: row.folder, sessionOnly: true, snapshot: {
        fileName: row.name + ' (session-only)',
        mode: row.ext, sourceShape: row.ext,
        items: [], schema: new Map(),
        selectedKeys: new Set(),
        searchQuery: '', minTokens: null, maxTokens: null,
        sortMode: 'default', pagesShown: 1, viewItems: [], activeOrigIdx: -1
      }};
      state.files.push(slot);
      renderFileTree();
      continue;
    }
    const blob = new Blob([row.content], { type: row.ext === 'jsonl' ? 'application/jsonl' : 'application/json' });
    const file = new File([blob], row.name, { type: blob.type });
    const opts = { folder: row.folder, suppressFlush: true, persistedId: row.id };
    if (_loadFileStub){
      await _loadFileStub(file, opts);
    } else {
      await loadFile(file, opts);
    }
  }
}

window.__files_setLoadFileStub = __setLoadFileStub;
window.__files_clearLoadFileStub = __clearLoadFileStub;
window.__files_restoreFromCache = restoreFromCache;

/* ---------- Active file row helpers (used by Task 5) ---------- */
export function getActiveFileRow(){
  const slot = state.files.find(s => s.id === state.activeId);
  if (!slot) return null;
  const liveItemsArr = state.items.filter(it => !it.deleted);
  let text;
  if (state.sourceShape === 'jsonl'){
    text = liveItemsArr.map(it => exportRawFor(it)).filter(Boolean).join('\n') + '\n';
  } else {
    text = JSON.stringify(liveItemsArr.map(it => it.parsed), null, 2);
  }
  const ext = (state.fileName || '').toLowerCase().endsWith('.jsonl') ? 'jsonl' : 'json';
  const proj = getActiveProject();
  if (!proj) return null;
  return {
    id: slot.id,
    projectId: proj.id,
    name: state.fileName || 'untitled',
    folder: slot.folder || '',
    ext,
    sizeBytes: text.length,
    sessionOnly: false,
    content: text,
    updatedAt: Date.now()
  };
}

export async function persistActiveFile(){
  const row = getActiveFileRow();
  if (row) await flushFileDebounced(row);
}

// js/main.js — bootstrap; modules extracted incrementally.
import {
  el, $, showToast, initTheme,
  $stats, $dirtyBadge, $dirtyCount, $list, $drop, $file,
  $nl, $md, $themeToggle, $colorize, $editToggle, $quickCopy,
  $search, $expandAll, $collapseAll, $filterInfo, $toast,
  $exportBtn, $saveBtn, $sortSel, $minTokens, $maxTokens, $loadMore,
  $sidebar, $schemaKeys, $sideActions, $clearKeys, $addRow, $addItemBtn,
  $modal, $modalTitle, $modalBody, $modalOk, $modalCancel
} from './dom.js';
import { confirmModal, promptKey } from './modal.js';
import { pathKey, pathIdx, parsePath, walkPath, estimateTokens, fmtNum } from './path.js';
import { state, newFileId, liveItems } from './state.js';
import { applyColorize, keyColor } from './view-colorize.js';
import {
  makeStringSpan, makeKeyEl, makeRowDelBtn, makeNodeAddBtn, makeNodeDelBtn,
  renderNode, applyNewlineMode, renderStringSpan
} from './view-node.js';
import {
  markDirty, applyValueAtPath, applyKeyRenameAtPath, removeAtPath,
  appendArrayItem, addObjectKey, activeEditing,
  startInlineEdit, startKeyEdit, startValueEdit, openRawEditor
} from './view-edit.js';
import { applyMarkdownMode, safeHref, appendInline, renderMarkdownToDOM } from './view-markdown.js';

  /* ---- Per-file snapshot helpers ---- */
  // Save current per-file state into the active file's snapshot.
  function snapshotCurrent(){
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
  function applyFromFile(f){
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
  function switchToFile(id){
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
      const main = $drop.firstElementChild;
      main.replaceChildren();
      main.append(el('strong', null, state.fileName),
                  document.createTextNode(' active — drop or click to load more files.'));
    }
  }
  function closeFile(id){
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
  }

  function detectChatFormat(parsed){
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    if (Array.isArray(parsed.messages) && parsed.messages.length &&
        parsed.messages.every(m => m && typeof m === 'object' && 'role' in m && 'content' in m)){
      return parsed.messages.map(m => ({ role: m.role, content: m.content }));
    }
    if (Array.isArray(parsed.conversations) && parsed.conversations.length &&
        parsed.conversations.every(m => m && typeof m === 'object' &&
          ('from' in m || 'role' in m) && ('value' in m || 'content' in m))){
      return parsed.conversations.map(m => ({
        role: m.role ?? m.from ?? 'unknown',
        content: m.content ?? m.value
      }));
    }
    return null;
  }

  function renderChatView(messages){
    const wrap = el('div','chat-view');
    for (const m of messages){
      const role = String(m.role ?? 'unknown');
      const turn = el('div','chat-turn');
      const r = el('div','chat-role', role);
      r.classList.add('role-' + role.toLowerCase().replace(/[^a-z0-9_-]/g,''));
      const c = el('div','chat-content');
      const raw = (typeof m.content === 'string') ? m.content : JSON.stringify(m.content, null, 2);
      c.dataset.raw = raw;
      if (state.markdown){
        c.replaceChildren(renderMarkdownToDOM(raw));
      } else {
        c.textContent = raw;
      }
      turn.append(r, c);
      wrap.append(turn);
    }
    return wrap;
  }

  /* JSON tree rendering — functions moved to js/view-node.js */

  /* Item construction */
  function makeItem(fileIdx, prefix, rawText, parsed, error){
    const charCount = error ? rawText.length : JSON.stringify(parsed).length;
    let topKeys = [];
    if (!error && parsed && typeof parsed === 'object' && !Array.isArray(parsed)){
      topKeys = Object.keys(parsed);
    }
    return {
      origIdx: 0,
      fileIdx, prefix, rawText, parsed, error,
      originalParsed: error ? null : structuredClone(parsed),
      dirty: false,
      deleted: false,
      excluded: false,
      _cardEl: null,
      charCount,
      tokens: estimateTokens(charCount),
      searchText: error ? rawText.toLowerCase() : JSON.stringify(parsed).toLowerCase(),
      topKeys,
    };
  }

  function recomputeItemMetrics(item){
    if (item.error){
      item.charCount = item.rawText.length;
      item.searchText = item.rawText.toLowerCase();
    } else {
      const s = JSON.stringify(item.parsed);
      item.charCount = s.length;
      item.searchText = s.toLowerCase();
    }
    item.tokens = estimateTokens(item.charCount);
    item.topKeys = (!item.error && item.parsed && typeof item.parsed === 'object' && !Array.isArray(item.parsed))
      ? Object.keys(item.parsed) : [];
  }

  function exportRawFor(item){
    if (item.error) return item.rawText.replace(/\r?\n/g,' ');
    try { return JSON.stringify(item.parsed); } catch { return ''; }
  }

  /* Card builder */
  function buildCard(item){
    const card = el('div','card');
    card.dataset.origIdx = String(item.origIdx);
    if (item.dirty) card.classList.add('dirty');

    const head = el('div','card-head');
    const left = el('div','row');
    const ln = el('span','ln');
    ln.append(document.createTextNode(item.prefix + ' '), el('strong', null, String(item.fileIdx + 1)));
    left.append(ln);

    const stat = el('span','chip-stat',
      `${fmtNum(item.charCount)} chars • ~${fmtNum(item.tokens)} tok`);
    stat.title = 'Character count and rough token estimate (chars / 4)';
    left.append(stat);

    const dirtyB = el('span','badge-dirty');
    dirtyB.append(el('span','dot'), document.createTextNode(' modified'));
    left.append(dirtyB);

    const toolbar = el('div','toolbar');

    const copyBtn = el('button','mini-btn','Copy raw');
    copyBtn.title = 'Copy the raw text for this item';
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(item.rawText);
        copyBtn.textContent = 'Copied!';
        setTimeout(()=>copyBtn.textContent='Copy raw', 900);
        showToast('Copied raw text');
      } catch {}
    });

    const copyJsonBtn = el('button','mini-btn','Copy JSON');
    copyJsonBtn.title = 'Copy this item as pretty JSON';
    copyJsonBtn.addEventListener('click', async () => {
      try {
        const txt = item.error ? item.rawText : JSON.stringify(item.parsed, null, 2);
        await navigator.clipboard.writeText(txt);
        copyJsonBtn.textContent = 'Copied!';
        setTimeout(()=>copyJsonBtn.textContent='Copy JSON', 900);
        showToast('Copied JSON');
      } catch {}
    });

    const expandBtn = el('button','mini-btn','Expand');
    expandBtn.title = 'Expand all nodes in this item';
    expandBtn.addEventListener('click', () => {
      card.querySelectorAll('details.tree-node').forEach(d => d.open = true);
    });

    const collapseBtn = el('button','mini-btn','Collapse');
    collapseBtn.title = 'Collapse all nodes in this item';
    collapseBtn.addEventListener('click', () => {
      card.querySelectorAll('details.tree-node').forEach(d => d.open = false);
    });

    const editRawBtn = el('button','mini-btn','Edit raw');
    editRawBtn.title = 'Edit the entire item as JSON text';
    editRawBtn.addEventListener('click', () => openRawEditor(item, body));

    const resetBtn = el('button','mini-btn reset','Reset');
    resetBtn.title = 'Revert this item to its original (unedited) state';
    resetBtn.addEventListener('click', async () => {
      if (!item.dirty) return;
      const ok = await confirmModal({
        title:'Reset item?',
        body:'Discard all edits in this item and restore original content.',
        okLabel:'Reset', dangerous:true
      });
      if (!ok) return;
      item.parsed = structuredClone(item.originalParsed);
      item.dirty = false;
      recomputeItemMetrics(item);
      rebuildCardInPlace(item);
      updateDirtyBadge();
      updateStats();
      analyzeSchema(); renderSidebar();
      showToast('Item reset');
    });

    const excludeBtn = el('button','mini-btn warn','Exclude');
    excludeBtn.title = 'Exclude this item from Export (toggle)';
    excludeBtn.addEventListener('click', () => {
      item.excluded = !item.excluded;
      syncExcluded(card, item, excludeBtn);
      updateStats();
      updateFilterInfo();
    });

    const deleteBtn = el('button','mini-btn danger','Delete');
    deleteBtn.title = 'Permanently remove this item from the list';
    deleteBtn.addEventListener('click', async () => {
      const ok = await confirmModal({
        title:'Delete item?',
        body:'This removes the item entirely. It will not be exported or saved.',
        okLabel:'Delete', dangerous:true
      });
      if (!ok) return;
      item.deleted = true;
      analyzeSchema(); renderSidebar();
      renderView();
      updateDirtyBadge();
      showToast('Item deleted');
    });

    toolbar.append(copyBtn, copyJsonBtn, expandBtn, collapseBtn, editRawBtn, excludeBtn, deleteBtn, resetBtn);

    const body = el('div','body');
    let treeContent;
    if (item.error){
      const pre = el('pre','tree');
      pre.textContent = item.rawText;
      treeContent = pre;
    } else {
      treeContent = renderNode(item, item.parsed, null, '$');
    }
    body.append(treeContent);

    if (!item.error){
      const chat = detectChatFormat(item.parsed);
      if (chat && chat.length){
        const chatBtn = el('button','mini-btn','Chat view');
        chatBtn.title = 'Render as a conversation (detected messages/conversations field)';
        let showingChat = false;
        chatBtn.addEventListener('click', () => {
          showingChat = !showingChat;
          if (showingChat){
            const fresh = renderChatView(detectChatFormat(item.parsed) || []);
            body.replaceChildren(fresh);
            chatBtn.textContent = 'Tree view';
            chatBtn.classList.add('active');
          } else {
            body.replaceChildren(treeContent);
            chatBtn.textContent = 'Chat view';
            chatBtn.classList.remove('active');
          }
        });
        toolbar.append(chatBtn);
      }
    }

    head.append(left);
    head.append(item.error ? el('span','badge-err','Parse error') : el('span','badge-ok','OK'));
    head.append(toolbar);

    const headerWrap = el('header'); headerWrap.append(head);
    card.append(headerWrap, body);

    card.addEventListener('mousedown', () => setActive(item.origIdx, false));

    syncExcluded(card, item, excludeBtn);
    return card;
  }

  function syncExcluded(card, item, btn){
    card.classList.toggle('excluded', item.excluded);
    btn.textContent = item.excluded ? 'Include' : 'Exclude';
    btn.classList.toggle('active', item.excluded);
  }

  function getCardEl(item){
    if (!item._cardEl) item._cardEl = buildCard(item);
    return item._cardEl;
  }

  function rebuildCardInPlace(item){
    const old = item._cardEl;
    item._cardEl = null;
    const fresh = getCardEl(item);
    if (old && old.isConnected) old.replaceWith(fresh);
    if (state.colorize) applyColorize();
    if (state.activeOrigIdx === item.origIdx) markActive();
  }

  /* Schema sidebar */
  function analyzeSchema(){
    const m = new Map();
    for (const it of liveItems()){
      for (const k of it.topKeys){
        m.set(k, (m.get(k) || 0) + 1);
      }
    }
    state.schema = m;
  }

  function renderSidebar(){
    const m = state.schema;
    if (!m.size){
      $schemaKeys.replaceChildren(el('div','side-empty', state.items.length
        ? 'No top-level object keys (items are arrays/primitives).'
        : 'Load a file to see keys.'));
      $sideActions.style.display = 'none';
      return;
    }
    const keys = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const frag = document.createDocumentFragment();
    for (const [name, count] of keys){
      const chip = el('span','key-chip');
      chip.textContent = name;
      chip.append(el('span','count', String(count)));
      if (state.selectedKeys.has(name)) chip.classList.add('selected');
      chip.addEventListener('click', () => {
        if (state.selectedKeys.has(name)) state.selectedKeys.delete(name);
        else state.selectedKeys.add(name);
        state.pagesShown = 1;
        renderSidebar();
        renderView();
      });
      frag.append(chip);
    }
    $schemaKeys.replaceChildren(frag);
    $sideActions.style.display = state.selectedKeys.size ? '' : 'none';
  }

  /* Filter / sort / paginate */
  function applyFilters(items){
    const q = state.searchQuery.toLowerCase();
    const minT = (state.minTokens != null && Number.isFinite(state.minTokens)) ? state.minTokens : -Infinity;
    const maxT = (state.maxTokens != null && Number.isFinite(state.maxTokens)) ? state.maxTokens : Infinity;
    const reqKeys = state.selectedKeys;
    return items.filter(it => {
      if (it.deleted) return false;
      if (q && !it.searchText.includes(q)) return false;
      if (it.tokens < minT || it.tokens > maxT) return false;
      if (reqKeys.size){
        for (const k of reqKeys) if (!it.topKeys.includes(k)) return false;
      }
      return true;
    });
  }

  function applySort(items){
    if (state.sortMode === 'default') return items;
    const arr = items.slice();
    const dir = state.sortMode.endsWith('-asc') ? 1 : -1;
    const field = state.sortMode.startsWith('tokens') ? 'tokens' : 'charCount';
    arr.sort((a, b) => (a[field] - b[field]) * dir);
    return arr;
  }

  function renderView(){
    state.viewItems = applySort(applyFilters(state.items));
    const limit = state.pageSize * state.pagesShown;
    const slice = state.viewItems.slice(0, limit);
    const frag = document.createDocumentFragment();
    for (const it of slice) frag.append(getCardEl(it));
    $list.replaceChildren(frag);
    renderLoadMore();
    updateFilterInfo();
    updateStats();
    markActive();
    if (state.colorize) applyColorize();
    $addRow.style.display = state.items.length ? '' : 'none';
  }

  function renderLoadMore(){
    $loadMore.replaceChildren();
    const total = state.viewItems.length;
    const shown = Math.min(state.pageSize * state.pagesShown, total);
    if (!liveItems().length) return;
    const status = el('span',null, `Showing ${fmtNum(shown)} of ${fmtNum(total)}`);
    $loadMore.append(status);
    if (shown < total){
      const btn = el('button','btn',`Load next ${Math.min(state.pageSize, total - shown)}`);
      btn.addEventListener('click', () => {
        state.pagesShown++;
        renderView();
      });
      const all = el('button','btn','Load all');
      all.addEventListener('click', () => {
        state.pagesShown = Math.ceil(total / state.pageSize);
        renderView();
      });
      $loadMore.append(btn, all);
    }
  }

  function updateFilterInfo(){
    if (!state.items.length){ $filterInfo.textContent = ''; return; }
    const live = liveItems();
    const total = live.length;
    const match = state.viewItems.length;
    const excluded = state.viewItems.filter(it => it.excluded).length;
    const hidden = total - match;
    const parts = [];
    if (hidden > 0) parts.push(`${fmtNum(hidden)} hidden by filter`);
    if (excluded > 0) parts.push(`${fmtNum(excluded)} excluded`);
    parts.push(`${fmtNum(match - excluded)} will export`);
    $filterInfo.textContent = parts.join(' · ');
  }

  function updateStats(){
    if (!state.fileName){ $stats.textContent = 'No file loaded'; return; }
    const modeTxt = state.mode === 'json' ? 'JSON' : state.mode === 'jsonl' ? 'JSONL' : 'Auto';
    const live = liveItems();
    const total = live.length;
    let ok = 0, err = 0, totalChars = 0;
    for (const it of live){
      if (it.error) err++; else ok++;
      totalChars += it.charCount;
    }
    const totalTokens = estimateTokens(totalChars);
    const itemWord = total === 1 ? 'item' : 'items';
    const errWord = err === 1 ? 'error' : 'errors';
    const deleted = state.items.length - live.length;
    const delPart = deleted ? ` • ${fmtNum(deleted)} deleted` : '';
    $stats.textContent =
      `${state.fileName} • ${modeTxt} • ${fmtNum(total)} ${itemWord} • ` +
      `${fmtNum(ok)} ok • ${fmtNum(err)} ${errWord}${delPart} • ` +
      `${fmtNum(totalChars)} chars • ~${fmtNum(totalTokens)} tok`;
  }

  function updateDirtyBadge(){
    const editedN = state.items.filter(it => it.dirty && !it.deleted).length;
    const delN = state.items.filter(it => it.deleted).length;
    const n = editedN + delN;
    if (n > 0){
      $dirtyBadge.classList.add('show');
      $dirtyCount.textContent = `${fmtNum(n)} unsaved change${n===1?'':'s'}`;
    } else {
      $dirtyBadge.classList.remove('show');
    }
    // Reflect dirty state on the file-tree row.
    renderFileTree();
  }

  /* Active card / keyboard nav */
  function setActive(origIdx, scroll=true){
    state.activeOrigIdx = origIdx;
    markActive();
    if (scroll){
      const card = getActiveCard();
      if (card) card.scrollIntoView({ block:'nearest', behavior:'smooth' });
    }
  }
  function markActive(){
    $list.querySelectorAll('.card.active').forEach(c => c.classList.remove('active'));
    const card = getActiveCard();
    if (card) card.classList.add('active');
  }
  function getActiveCard(){
    if (state.activeOrigIdx < 0) return null;
    const it = state.items[state.activeOrigIdx];
    if (!it || !it._cardEl) return null;
    return it._cardEl.isConnected ? it._cardEl : null;
  }
  function jumpRelative(delta){
    const view = state.viewItems;
    if (!view.length) return;
    let idx = view.findIndex(it => it.origIdx === state.activeOrigIdx);
    if (idx < 0) idx = (delta > 0) ? -1 : view.length;
    let target = idx + delta;
    target = Math.max(0, Math.min(view.length - 1, target));
    const prevPages = state.pagesShown;
    while (target >= state.pageSize * state.pagesShown){
      state.pagesShown++;
    }
    if (state.pagesShown !== prevPages) renderView();
    setActive(view[target].origIdx, true);
  }

  /* Parsing */
  function tryParseFullJSON(text){
    try { return { ok:true, value: JSON.parse(text) }; }
    catch (e){ return { ok:false, error: e }; }
  }

  function parseAsJSON(value, originalText){
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

  function parseAsJSONL(text){
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

  /* Load file */
  function resetView(){
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
  async function _parseFileIntoState(file, folder=''){
    resetView();
    state.fileName = file.name;
    updateStats();

    const text = await file.text();
    const lower = (file.name || '').toLowerCase();

    let items;
    if (lower.endsWith('.json')) {
      const full = tryParseFullJSON(text);
      items = full.ok ? parseAsJSON(full.value, text) : parseAsJSONL(text);
    } else {
      const full = tryParseFullJSON(text);
      if (full.ok && (typeof full.value !== 'string')) items = parseAsJSON(full.value, text);
      else items = parseAsJSONL(text);
    }
    items.forEach((it, i) => { it.origIdx = i; });
    state.items = items;
  }

  async function loadFile(file, opts={}){
    const folder = opts.folder || '';
    // If we have an active file with edits, snapshot it before parking;
    // we now ALWAYS open additional files as new tabs (no overwrite).
    snapshotCurrent();
    await _parseFileIntoState(file, folder);

    // Register new file slot.
    const id = newFileId();
    const slot = {id, folder, snapshot:null};
    state.files.push(slot);
    state.activeId = id;
    snapshotCurrent();

    analyzeSchema();
    renderSidebar();
    renderView();
    renderFileTree();

    $drop.classList.add('compact');
    const main = $drop.firstElementChild;
    main.replaceChildren();
    main.append(el('strong', null, file.name),
                document.createTextNode(' active — drop more, click ‹+ Files› / ‹+ Folder›, or pick another from the left.'));
  }

  async function loadFiles(fileList, opts={}){
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
  function renderFileTree(){
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
  function buildFileRow(slot){
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
          body:'Edits in “' + (s.fileName || 'this file') + '” will be lost.',
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
  function buildFolderRow(name, slots){
    const wrap = document.createDocumentFragment();
    const head = el('div','folder-row open');
    head.append(
      el('span','folder-caret'),
      el('span','folder-icon','📁'),
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

  /* Add new item */
  $addItemBtn.addEventListener('click', () => {
    if (!state.fileName){
      state.fileName = 'untitled.jsonl';
      state.mode = 'jsonl';
      state.sourceShape = 'jsonl';
    }
    const newIdx = state.items.length;
    const newItem = makeItem(newIdx,
      state.sourceShape === 'jsonl' ? 'Line' : 'Item',
      '{}', {}, false);
    newItem.origIdx = newIdx;
    newItem.dirty = true;
    state.items.push(newItem);
    analyzeSchema(); renderSidebar();
    renderView();
    setActive(newIdx, true);
    updateDirtyBadge();
    showToast('New item appended');
  });

  /* Global expand/collapse */
  $expandAll.addEventListener('click', () => {
    $list.querySelectorAll('details.tree-node').forEach(d => d.open = true);
  });
  $collapseAll.addEventListener('click', () => {
    $list.querySelectorAll('details.tree-node').forEach(d => d.open = false);
  });

  /* Export visible+included items as JSONL */
  $exportBtn.addEventListener('click', () => {
    const items = state.viewItems.filter(it => !it.excluded && !it.deleted);
    if (!items.length){ showToast('Nothing to export'); return; }
    const lines = items.map(it => exportRawFor(it)).filter(Boolean);
    const blob = new Blob([lines.join('\n') + '\n'], { type: 'application/jsonl' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const base = (state.fileName || 'export').replace(/\.(json|jsonl|txt|log)$/i, '');
    a.href = url;
    a.download = `${base}-filtered.jsonl`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`Exported ${fmtNum(lines.length)} item${lines.length===1?'':'s'}`);
  });

  /* Save full file (preserves source shape) */
  $saveBtn.addEventListener('click', saveFile);
  function saveFile(){
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

  /* Sort / length filter */
  $sortSel.addEventListener('change', () => {
    state.sortMode = $sortSel.value;
    state.pagesShown = 1;
    renderView();
  });
  function readNumOrNull(v){
    if (v === '' || v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  function onLengthChange(){
    state.minTokens = readNumOrNull($minTokens.value);
    state.maxTokens = readNumOrNull($maxTokens.value);
    state.pagesShown = 1;
    renderView();
  }
  let lenTimer;
  [$minTokens, $maxTokens].forEach(inp => {
    inp.addEventListener('input', () => {
      clearTimeout(lenTimer);
      lenTimer = setTimeout(onLengthChange, 150);
    });
  });

  /* Sidebar clear */
  $clearKeys.addEventListener('click', () => {
    state.selectedKeys.clear();
    state.pagesShown = 1;
    renderSidebar();
    renderView();
  });

  /* Drag & drop — multi-file capable. Tries to read folders too via
     DataTransferItem.webkitGetAsEntry where supported. */
  ;['dragenter','dragover'].forEach(ev => {
    document.addEventListener(ev, e => {
      e.preventDefault(); e.stopPropagation();
      $drop.classList.add('active');
    });
  });
  ;['dragleave','drop'].forEach(ev => {
    document.addEventListener(ev, e => {
      e.preventDefault(); e.stopPropagation();
      if (ev === 'drop'){
        handleDrop(e);
      }
      $drop.classList.remove('active');
    });
  });
  async function handleDrop(e){
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
  function collectEntry(entry, folderPath, out){
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

  /* Header Open: opens the multi-file picker.  */
  const $filesInput = $('filesInput');
  const $folderInput = $('folderInput');
  if ($file){
    $file.addEventListener('change', async (e) => {
      const fs = e.target.files;
      if (fs && fs.length) await loadFiles(fs);
      $file.value = '';
    });
  }
  if ($filesInput){
    $filesInput.addEventListener('change', async (e) => {
      await loadFiles(e.target.files);
      $filesInput.value = '';
    });
  }
  if ($folderInput){
    $folderInput.addEventListener('change', async (e) => {
      await loadFiles(e.target.files);
      $folderInput.value = '';
    });
  }
  $drop.addEventListener('click', () => $filesInput ? $filesInput.click() : $file.click());
  const $addFilesBtn = $('addFilesBtn');
  const $addFolderBtn = $('addFolderBtn');
  if ($addFilesBtn) $addFilesBtn.addEventListener('click', () => $filesInput.click());
  if ($addFolderBtn) $addFolderBtn.addEventListener('click', () => $folderInput.click());

  /* Toggles */
  $nl.addEventListener('change', () => {
    state.modeNewlines = $nl.checked;
    applyNewlineMode();
  });
  $md.addEventListener('change', () => {
    state.markdown = $md.checked;
    applyMarkdownMode();
    showToast(state.markdown ? 'Markdown: ON' : 'Markdown: OFF');
  });
  $quickCopy.addEventListener('change', () => {
    state.quickCopy = $quickCopy.checked;
    showToast(state.quickCopy ? 'Quick Copy: ON' : 'Quick Copy: OFF');
  });
  $colorize.addEventListener('change', () => {
    state.colorize = $colorize.checked;
    applyColorize();
  });
  $editToggle.addEventListener('change', () => {
    state.editMode = $editToggle.checked;
    document.body.classList.toggle('edit-on', state.editMode);
    showToast(state.editMode
      ? 'Edit ON — dbl-click any value, hover rows for ＋／✕'
      : 'Edit OFF (dbl-click still works)');
  });
  $themeToggle.addEventListener('change', () => {
    const theme = $themeToggle.checked ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('jsonl_viewer_theme', theme);
    if (state.colorize) applyColorize();
  });

  /* Search */
  let searchTimer;
  $search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.searchQuery = $search.value;
      state.pagesShown = 1;
      renderView();
    }, 120);
  });

  /* Inline-edit dispatch via dblclick */
  document.addEventListener('dblclick', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    if (activeEditing()) return;
    const editable = t.closest('.editable');
    if (!editable) return;
    if (editable.closest('.raw-editor')) return;
    e.preventDefault();
    e.stopPropagation();
    startInlineEdit(editable);
  });

  /* Quick Copy */
  document.addEventListener('click', async (e) => {
    if (!state.quickCopy) return;
    if (activeEditing()) return;
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    if (t.closest('.row-actions')) return;
    if (t.closest('.raw-editor')) return;
    if (t.closest('.edit-input')) return;
    if (t.closest('.toolbar')) return;
    const valueEl = t.closest('.str,.num,.bool,.nil');
    const keyEl = t.closest('.key,.idx');
    const summaryEl = t.closest('summary');
    try {
      if (e.altKey && (valueEl || keyEl || summaryEl)){
        const path = valueEl?.dataset.path || keyEl?.dataset.path || summaryEl?.dataset.path;
        if (path){
          await navigator.clipboard.writeText(path);
          showToast('Copied path: ' + path);
          e.preventDefault();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && summaryEl && summaryEl.dataset.json){
        await navigator.clipboard.writeText(summaryEl.dataset.json);
        showToast('Copied node JSON');
        e.preventDefault();
        return;
      }
      if (valueEl && valueEl.dataset.json != null){
        await navigator.clipboard.writeText(valueEl.dataset.json);
        showToast('Copied value');
        e.preventDefault();
        return;
      }
      if (keyEl && !summaryEl){
        const k = keyEl.dataset.key || '';
        await navigator.clipboard.writeText(k);
        showToast('Copied key: ' + k);
        e.preventDefault();
        return;
      }
    } catch {}
  });

  /* Keyboard shortcuts */
  function isTypingInField(t){
    if (!t) return false;
    const tag = (t.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (t.isContentEditable) return true;
    return false;
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape'){
      if (document.activeElement === $search){
        if ($search.value){
          $search.value = '';
          state.searchQuery = '';
          state.pagesShown = 1;
          renderView();
        } else {
          $search.blur();
        }
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's'){
      e.preventDefault();
      saveFile();
      return;
    }
    if (isTypingInField(e.target)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    // Normalize so caps-lock / shift don't break shortcuts.
    const k = (e.key || '').length === 1 ? e.key.toLowerCase() : e.key;
    switch (k){
      case '/':
        e.preventDefault();
        $search.focus();
        $search.select();
        break;
      case 'n':
      case 'j':
        e.preventDefault();
        jumpRelative(1);
        break;
      case 'p':
      case 'k':
        e.preventDefault();
        jumpRelative(-1);
        break;
      case 'e':
        e.preventDefault();
        toggleActiveTree(true);
        break;
      case 'c':
        e.preventDefault();
        toggleActiveTree(false);
        break;
      case 'x': {
        e.preventDefault();
        const it = state.items[state.activeOrigIdx];
        if (it){
          it.excluded = !it.excluded;
          if (it._cardEl){
            const btn = it._cardEl.querySelector('.mini-btn.warn');
            if (btn) syncExcluded(it._cardEl, it, btn);
          }
          updateFilterInfo();
        }
        break;
      }
      case 'Delete':
      case 'Backspace': {
        e.preventDefault();
        const it = state.items[state.activeOrigIdx];
        if (!it) return;
        confirmModal({
          title:'Delete item?',
          body:'This removes the item entirely.',
          okLabel:'Delete', dangerous:true
        }).then(ok => {
          if (!ok) return;
          it.deleted = true;
          analyzeSchema(); renderSidebar();
          renderView();
          updateDirtyBadge();
          showToast('Item deleted');
        });
        break;
      }
    }
  });
  function toggleActiveTree(open){
    const card = getActiveCard();
    const target = card || $list;
    target.querySelectorAll('details.tree-node').forEach(d => d.open = open);
  }

  /* Beforeunload warning when dirty (skip in test mode via ?test=1) */
  const testMode = /[?&]test=1\b/.test(location.search);
  if (!testMode){
    window.addEventListener('beforeunload', (e) => {
      if (state.items.some(it => it.dirty || it.deleted)){
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

// Temporary window-globals bridge — removed as host modules are extracted in
// later tasks. See docs/superpowers/plans/2026-05-09-p1-module-refactor.md.
window.analyzeSchema = analyzeSchema;
window.renderSidebar = renderSidebar;
window.renderView = renderView;
window.rebuildCardInPlace = rebuildCardInPlace;
window.updateDirtyBadge = updateDirtyBadge;
window.updateStats = updateStats;
window.getCardEl = getCardEl;
window.recomputeItemMetrics = recomputeItemMetrics;

/* Init */
initTheme();
updateStats();
renderSidebar();
renderFileTree();
updateDirtyBadge();

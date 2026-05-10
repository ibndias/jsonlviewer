// js/view-card.js
import { el, showToast } from './dom.js';
import { state } from './state.js';
import { estimateTokens, fmtNum } from './path.js';
import { renderNode } from './view-node.js';
import { detectChatFormat, renderChatView } from './view-chat.js';
import { applyColorize } from './view-colorize.js';
import { openRawEditor } from './view-edit.js';
import { confirmModal } from './modal.js';
import { analyzeSchema, renderSidebar } from './schema.js';
import { updateDirtyBadge, updateStats, updateFilterInfo, renderView, setActive, markActive } from './view.js';

export function makeItem(fileIdx, prefix, rawText, parsed, error){
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
    tags: [],          // user-applied labels (string[])
    review: null,      // null | 'approve' | 'reject' | 'todo'
  };
}

export function recomputeItemMetrics(item){
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

export function exportRawFor(item){
  if (item.error) return item.rawText.replace(/\r?\n/g,' ');
  try { return JSON.stringify(item.parsed); } catch { return ''; }
}

/* Card builder */
export function buildCard(item){
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

  const expandBtn = el('button','mini-btn','Collapse');
  expandBtn.title = 'Toggle expand/collapse all nodes in this item';
  expandBtn.addEventListener('click', () => {
    const nodes = [...card.querySelectorAll('details.tree-node')];
    const openCount = nodes.filter(d => d.open).length;
    const shouldOpen = openCount < nodes.length / 2;
    nodes.forEach(d => d.open = shouldOpen);
    expandBtn.textContent = shouldOpen ? 'Collapse' : 'Expand';
  });

  // Hidden alias for legacy palette/test compat (no UI button rendered).
  const collapseBtn = document.createElement('button');
  collapseBtn.style.display = 'none';
  collapseBtn.addEventListener('click', () => {
    card.querySelectorAll('details.tree-node').forEach(d => d.open = false);
    expandBtn.textContent = 'Expand';
  });

  const editRawBtn = el('button','mini-btn','Edit raw');
  editRawBtn.title = 'Edit the entire item as JSON text';
  editRawBtn.addEventListener('click', () => openRawEditor(item, body));

  const resetBtn = el('button','mini-btn reset','Reset');
  resetBtn.title = 'Revert this item to its original (unedited) state';
  resetBtn.addEventListener('click', async () => {
    if (!item.dirty) return;
    const ok = await confirmModal({
      title:'Reset item',
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
      title:'Delete item',
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
  // Dedicated meta strip for review / tag / audit badges so the toolbar
  // doesn't get crowded. Populated by updateCardReviewUI().
  const metaStrip = el('div','card-meta');
  head.append(metaStrip);
  head.append(toolbar);

  const headerWrap = el('header'); headerWrap.append(head);
  card.append(headerWrap, body);

  card.addEventListener('mousedown', () => setActive(item.origIdx, false));

  syncExcluded(card, item, excludeBtn);
  // Render any pre-existing review/tag badges
  try { window.__dataset_ui?.updateCardReviewUI(item); } catch {}
  return card;
}

export function syncExcluded(card, item, btn){
  card.classList.toggle('excluded', item.excluded);
  btn.textContent = item.excluded ? 'Include' : 'Exclude';
  btn.classList.toggle('active', item.excluded);
}

export function getCardEl(item){
  if (!item._cardEl) item._cardEl = buildCard(item);
  return item._cardEl;
}

export function rebuildCardInPlace(item){
  const old = item._cardEl;
  item._cardEl = null;
  const fresh = getCardEl(item);
  if (old && old.isConnected) old.replaceWith(fresh);
  if (state.colorize) applyColorize();
  if (state.activeOrigIdx === item.origIdx) markActive();
}

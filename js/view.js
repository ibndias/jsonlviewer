// js/view.js
import { el, $list, $stats, $filterInfo, $loadMore, $dirtyBadge, $dirtyCount, $addRow } from './dom.js';
import { state, liveItems } from './state.js';
import { fmtNum, estimateTokens } from './path.js';
import { getCardEl } from './view-card.js';
import { applyColorize } from './view-colorize.js';

// Hook for updateDirtyBadge to call renderFileTree (set by main.js to avoid
// circular imports, since renderFileTree lives in main.js for now).
let _onDirtyBadge = null;
export function setDirtyBadgeHook(fn){ _onDirtyBadge = fn; }

export function applyFilters(items){
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

export function applySort(items){
  if (state.sortMode === 'default') return items;
  const arr = items.slice();
  const dir = state.sortMode.endsWith('-asc') ? 1 : -1;
  const field = state.sortMode.startsWith('tokens') ? 'tokens' : 'charCount';
  arr.sort((a, b) => (a[field] - b[field]) * dir);
  return arr;
}

export function renderView(){
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

export function renderLoadMore(){
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

export function updateFilterInfo(){
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

export function updateStats(){
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

export function updateDirtyBadge(){
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
  if (_onDirtyBadge) _onDirtyBadge();
}

/* Active card / keyboard nav */
export function setActive(origIdx, scroll=true){
  state.activeOrigIdx = origIdx;
  markActive();
  if (scroll){
    const card = getActiveCard();
    if (card) card.scrollIntoView({ block:'nearest', behavior:'smooth' });
  }
}
export function markActive(){
  $list.querySelectorAll('.card.active').forEach(c => c.classList.remove('active'));
  const card = getActiveCard();
  if (card) card.classList.add('active');
}
export function getActiveCard(){
  if (state.activeOrigIdx < 0) return null;
  const it = state.items[state.activeOrigIdx];
  if (!it || !it._cardEl) return null;
  return it._cardEl.isConnected ? it._cardEl : null;
}
export function jumpRelative(delta){
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
export function toggleActiveTree(open){
  const card = getActiveCard();
  const target = card || $list;
  target.querySelectorAll('details.tree-node').forEach(d => d.open = open);
}

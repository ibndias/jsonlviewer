// js/dom.js
export const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

export const $ = id => document.getElementById(id);

export const $stats       = $('stats');
export const $dirtyBadge  = $('dirtyBadge');
export const $dirtyCount  = $('dirtyCount');
export const $list        = $('list');
export const $drop        = $('drop');
export const $file        = $('fileInput');
export const $nl          = $('nlToggle');
export const $md          = $('mdToggle');
export const $themeToggle = $('themeToggle');
export const $colorize    = $('colorizeToggle');
export const $editToggle  = $('editToggle');
export const $quickCopy   = $('quickCopyToggle');
export const $search      = $('search');
export const $expandAll   = $('expandAll');
export const $collapseAll = $('collapseAll');
export const $filterInfo  = $('filterInfo');
export const $toast       = $('toast');
export const $exportBtn   = $('exportBtn');
export const $saveBtn     = $('saveBtn');
export const $sortSel     = $('sortSel');
export const $minTokens   = $('minTokens');
export const $maxTokens   = $('maxTokens');
export const $loadMore    = $('loadMore');
export const $sidebar     = $('sidebar');
export const $schemaKeys  = $('schemaKeys');
export const $sideActions = $('sideActions');
export const $clearKeys   = $('clearKeysBtn');
export const $addRow      = $('addRow');
export const $addItemBtn  = $('addItemBtn');
export const $modal       = $('modal');
export const $modalTitle  = $('modalTitle');
export const $modalBody   = $('modalBody');
export const $modalOk     = $('modalOk');
export const $modalCancel = $('modalCancel');

let toastTimer;
export function showToast(msg, kind=''){
  $toast.textContent = msg;
  $toast.classList.remove('err');
  if (kind === 'err') $toast.classList.add('err');
  $toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.remove('show'), 2300);
}

const KNOWN_THEMES = new Set([
  'light', 'dark', 'dracula', 'monokai', 'nord',
  'solarized-dark', 'solarized-light', 'github-light', 'github-dark',
  'tokyo-night', 'one-dark', 'gruvbox',
]);

export function applyTheme(name){
  const theme = KNOWN_THEMES.has(name) ? name : 'light';
  document.documentElement.setAttribute('data-theme', theme);
  $themeToggle.checked = (theme !== 'light' && theme !== 'solarized-light' && theme !== 'github-light');
  localStorage.setItem('jsonl_viewer_theme', theme);
  const sel = document.getElementById('themeSelect');
  if (sel && sel.value !== theme) sel.value = theme;
}

export function initTheme(){
  const saved = localStorage.getItem('jsonl_viewer_theme');
  if (saved && KNOWN_THEMES.has(saved)){
    applyTheme(saved);
  } else {
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(prefersDark ? 'dark' : 'light');
  }
  const sel = document.getElementById('themeSelect');
  if (sel){
    sel.addEventListener('change', () => applyTheme(sel.value));
  }
}

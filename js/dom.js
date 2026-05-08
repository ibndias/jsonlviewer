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
  toastTimer = setTimeout(() => $toast.classList.remove('show'), 1600);
}

export function initTheme(){
  const savedTheme = localStorage.getItem('jsonl_viewer_theme');
  if (savedTheme){
    document.documentElement.setAttribute('data-theme', savedTheme);
    $themeToggle.checked = (savedTheme === 'dark');
  } else {
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    $themeToggle.checked = prefersDark;
  }
  $themeToggle.addEventListener('change', () => {
    const theme = $themeToggle.checked ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('jsonl_viewer_theme', theme);
  });
}

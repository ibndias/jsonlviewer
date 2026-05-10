// js/main.js — bootstrap; modules extracted incrementally.
import './db.js';
import './projects.js';
import './export.js';
import './sync.js';
import { subscribe as _subscribe } from './sync.js';
import { getActiveProject as _getActiveProject } from './projects.js';
import {
  $, showToast, initTheme,
  $list, $drop, $file,
  $nl, $md, $themeToggle, $colorize, $editToggle, $quickCopy,
  $search, $expandAll, $collapseAll,
  $exportBtn, $saveBtn, $sortSel, $minTokens, $maxTokens,
  $clearKeys, $addItemBtn
} from './dom.js';
import { confirmModal } from './modal.js';
import { fmtNum } from './path.js';
import { state } from './state.js';
import { applyColorize } from './view-colorize.js';
import { applyNewlineMode } from './view-node.js';
import { activeEditing, startInlineEdit, markDirty as __markDirty } from './view-edit.js';
import { applyMarkdownMode } from './view-markdown.js';
import {
  makeItem, exportRawFor, syncExcluded
} from './view-card.js';
import { analyzeSchema, renderSidebar } from './schema.js';
import {
  renderView, updateFilterInfo, updateStats, updateDirtyBadge,
  setActive, jumpRelative, toggleActiveTree
} from './view.js';
import {
  loadFiles, renderFileTree,
  saveFile, onLengthChange, handleDrop, restoreFromCache,
  getActiveFileRow as _getActiveFileRowImport,
  persistActiveFile as _persistActiveFileImport
} from './files.js';
import { bootProjects } from './projects.js';
import { initProjectChip, initStatusBar, refreshStatusBar, refreshChip, openSettingsModal } from './projects-ui.js';
import { openCommandPalette, openQuickOpen } from './palette.js';
import { initShell, renderTabStrip, refreshProjectsPanel } from './shell.js';
import './dataset.js';
import {
  renderDatasetPanel, setRowReview, toggleRowTag, updateCardReviewUI,
  openTagging, openDiffActive
} from './dataset-ui.js';

// Test-harness window hooks (only readable in test mode but cheap to attach):
window.state = state;
window.__edit_markDirty = __markDirty;
window.markDirty = __markDirty;
window.__files_getActiveFileRow = _getActiveFileRowImport;
window.__files_persistActiveFile = _persistActiveFileImport;
window.__projectsui_refreshChip = refreshChip;
window.__projectsui_refreshStatusBar = refreshStatusBar;
window.__projectsui_openSettings = openSettingsModal;

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
  // Turn on edit mode so + / × hovers reveal immediately.
  if (!state.editMode){
    state.editMode = true;
    document.body.classList.add('edit-on');
    $editToggle.checked = true;
  }
  analyzeSchema(); renderSidebar();
  renderView();
  setActive(newIdx, true);
  updateDirtyBadge();
  // Auto-open the raw editor on the new item so user can type JSON.
  requestAnimationFrame(() => {
    const card = $list.querySelectorAll('.card')[newIdx];
    if (!card) return;
    const editRawBtn = [...card.querySelectorAll('.mini-btn')].find(b => b.textContent.trim() === 'Edit raw');
    if (editRawBtn) editRawBtn.click();
  });
  showToast('New item — type JSON or close to keep {}');
});

/* Global expand/collapse */
function setAllTreeOpen(open){
  $list.querySelectorAll('details.tree-node').forEach(d => d.open = open);
  const t = $('treeToggle');
  if (t) t.textContent = open ? 'Collapse all' : 'Expand all';
}
$expandAll.addEventListener('click', () => setAllTreeOpen(true));
$collapseAll.addEventListener('click', () => setAllTreeOpen(false));
const $treeToggle = $('treeToggle');
if ($treeToggle){
  $treeToggle.addEventListener('click', () => {
    // If most are open, collapse; else expand.
    const nodes = [...$list.querySelectorAll('details.tree-node')];
    const openCount = nodes.filter(d => d.open).length;
    const shouldOpen = openCount < nodes.length / 2;
    setAllTreeOpen(shouldOpen);
  });
}

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

/* Sort / length filter */
$sortSel.addEventListener('change', () => {
  state.sortMode = $sortSel.value;
  state.pagesShown = 1;
  renderView();
});
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
      window.__shell_renderTabStrip?.();
    }
    $drop.classList.remove('active');
  });
});

/* Header Open: opens the multi-file picker.  */
const $filesInput = $('filesInput');
const $folderInput = $('folderInput');
if ($file){
  $file.addEventListener('change', async (e) => {
    const fs = e.target.files;
    if (fs && fs.length) await loadFiles(fs);
    $file.value = '';
    window.__shell_renderTabStrip?.();
  });
}
if ($filesInput){
  $filesInput.addEventListener('change', async (e) => {
    await loadFiles(e.target.files);
    $filesInput.value = '';
    window.__shell_renderTabStrip?.();
  });
}
if ($folderInput){
  $folderInput.addEventListener('change', async (e) => {
    await loadFiles(e.target.files);
    $folderInput.value = '';
    window.__shell_renderTabStrip?.();
  });
}
$drop.addEventListener('click', (e) => {
  // If clicked inside the demo button, the button's own handler runs and we skip.
  if (e.target.closest('#loadDemoBtn')) return;
  if ($filesInput) $filesInput.click(); else $file.click();
});
const $loadDemoBtn = $('loadDemoBtn');
if ($loadDemoBtn){
  $loadDemoBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const demo = [
      JSON.stringify({messages:[{role:'user',content:'Email me at alice@example.com about the report'},{role:'assistant',content:'Sure, I’ll send it.'}]}),
      JSON.stringify({messages:[{role:'user',content:'Show how to parse JSON in JS'},{role:'assistant',content:'Use JSON.parse(text).'}]}),
      JSON.stringify({messages:[{role:'user',content:'Show how to parse JSON in JS'},{role:'assistant',content:'Use JSON.parse(text).'}]}),
      JSON.stringify({messages:[{role:'user',content:''},{role:'assistant',content:'reply'}]}),
      JSON.stringify({messages:[{role:'user',content:'My API key is sk-aaaaaaaaaaaaaaaaaaaaa'},{role:'assistant',content:'Don’t share keys.'}]}),
    ].join('\n');
    const file = new File([demo], 'demo.jsonl', {type:'application/jsonl'});
    const dt = new DataTransfer(); dt.items.add(file);
    if ($filesInput){ $filesInput.files = dt.files; $filesInput.dispatchEvent(new Event('change',{bubbles:true})); }
  });
}
const $addFilesBtn = $('addFilesBtn');
const $addFolderBtn = $('addFolderBtn');
if ($addFilesBtn) $addFilesBtn.addEventListener('click', () => $filesInput.click());
if ($addFolderBtn) $addFolderBtn.addEventListener('click', () => $folderInput.click());

const $settingsBtn = $('settingsBtn');
if ($settingsBtn) $settingsBtn.addEventListener('click', () => {
  // Open the Settings side panel (where the toggles live).
  window.__shell_switchPanel?.('settings');
  // Make sure the side bar isn't collapsed (mobile).
  document.getElementById('sideBar')?.classList.remove('collapsed');
});

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
  // Command palette / quick open
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'p'){
    e.preventDefault();
    openCommandPalette();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'p'){
    e.preventDefault();
    openQuickOpen();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'b'){
    e.preventDefault();
    // Toggle side bar visibility (mobile-friendly).
    const sb = document.getElementById('sideBar');
    if (sb) sb.classList.toggle('collapsed');
    return;
  }
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
    case 'a': {
      // Review approve
      e.preventDefault();
      const it = state.items[state.activeOrigIdx];
      if (it){ setRowReview(it, it.review === 'approve' ? null : 'approve'); renderDatasetPanel(); showToast(it.review === 'approve' ? 'Approved' : 'Cleared review'); }
      break;
    }
    case 'r': {
      // Review reject
      e.preventDefault();
      const it = state.items[state.activeOrigIdx];
      if (it){ setRowReview(it, it.review === 'reject' ? null : 'reject'); renderDatasetPanel(); showToast(it.review === 'reject' ? 'Rejected' : 'Cleared review'); }
      break;
    }
    case 't': {
      // Mark "todo" review
      e.preventDefault();
      const it = state.items[state.activeOrigIdx];
      if (it){ setRowReview(it, it.review === 'todo' ? null : 'todo'); renderDatasetPanel(); showToast(it.review === 'todo' ? 'Marked todo' : 'Cleared review'); }
      break;
    }
    case 'd': {
      // Diff active row
      e.preventDefault();
      openDiffActive();
      break;
    }
    case '?': {
      e.preventDefault();
      window.__dataset_ui?.openShortcutsCheatsheet?.();
      break;
    }
    case 'i': {
      // Switch to dataset panel and focus the Inspector section
      e.preventDefault();
      window.__shell_switchPanel?.('dataset');
      requestAnimationFrame(() => {
        const det = document.querySelector('.ds-inspector');
        if (det){ det.open = true; det.querySelector('summary')?.focus(); }
      });
      break;
    }
  }
});
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

/* Init */
initTheme();
const _isTestMode = /[?&]test=1\b/.test(location.search);

if (!_isTestMode){
  _subscribe(async (msg) => {
    if (msg.type !== 'file-changed' && msg.type !== 'file-deleted') return;
    const proj = _getActiveProject();
    if (!proj || msg.projectId !== proj.id) return;
    try {
      // v1: refresh full project from IDB.
      // Clear in-memory state first (so restoreFromCache doesn't double-load).
      state.files = [];
      state.activeId = null;
      state.items = [];
      await restoreFromCache();
      renderView();
      renderSidebar();
    } catch (e) { console.warn('sync reload failed:', e); }
  });
}

(async () => {
  if (!_isTestMode){
    try {
      await bootProjects();
      await restoreFromCache();
    } catch (e) {
      console.warn('boot/restore failed:', e);
    }
    initProjectChip();
    initStatusBar();
    initShell();
  }
  updateStats();
  renderSidebar();
  renderFileTree();
  updateDirtyBadge();
  if (state.colorize) applyColorize();
  // Render Lucide icons (replaces <i data-lucide> with inline <svg>).
  if (typeof window.lucide !== 'undefined' && window.lucide.createIcons){
    try { window.lucide.createIcons(); } catch (e) { console.warn('lucide.createIcons failed:', e); }
  }
})();

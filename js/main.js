// js/main.js — bootstrap; modules extracted incrementally.
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
import {
  makeStringSpan, makeKeyEl, makeRowDelBtn, makeNodeAddBtn, makeNodeDelBtn,
  renderNode, applyNewlineMode, renderStringSpan
} from './view-node.js';
import {
  markDirty, applyValueAtPath, applyKeyRenameAtPath, removeAtPath,
  appendArrayItem, addObjectKey, activeEditing,
  startInlineEdit, startKeyEdit, startValueEdit, openRawEditor
} from './view-edit.js';
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
  snapshotCurrent, applyFromFile, switchToFile, closeFile,
  resetView, loadFile, loadFiles, renderFileTree,
  saveFile, readNumOrNull, onLengthChange, handleDrop
} from './files.js';

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
updateStats();
renderSidebar();
renderFileTree();
updateDirtyBadge();

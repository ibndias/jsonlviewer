// js/palette.js — command palette + quick open.
import { el, $, $list } from './dom.js';
import { state } from './state.js';
import { switchToFile } from './files.js';
import { renderView } from './view.js';
import { renderSidebar } from './schema.js';
import { showToast } from './dom.js';

let _overlayEl = null;
let _selectedIdx = 0;
let _items = [];          // {label, hint, action}
let _inputEl = null;
let _listEl = null;

function fuzzyFilter(items, q){
  if (!q) return items;
  const ql = q.toLowerCase();
  return items.filter(it => (it.label + ' ' + (it.hint || '')).toLowerCase().includes(ql));
}

function close(){
  if (_overlayEl){ _overlayEl.remove(); _overlayEl = null; }
  document.removeEventListener('keydown', onKey, true);
  _items = []; _selectedIdx = 0; _inputEl = null; _listEl = null;
}

function onKey(e){
  if (!_overlayEl) return;
  if (e.key === 'Escape'){ e.preventDefault(); close(); return; }
  if (e.key === 'ArrowDown'){
    e.preventDefault();
    const filtered = fuzzyFilter(_items, _inputEl.value);
    _selectedIdx = Math.min(_selectedIdx + 1, filtered.length - 1);
    renderList();
    return;
  }
  if (e.key === 'ArrowUp'){
    e.preventDefault();
    _selectedIdx = Math.max(_selectedIdx - 1, 0);
    renderList();
    return;
  }
  if (e.key === 'Enter'){
    e.preventDefault();
    const filtered = fuzzyFilter(_items, _inputEl.value);
    const it = filtered[_selectedIdx];
    if (it){
      const action = it.action;
      close();
      try { action(); } catch (err) { console.error(err); showToast('Command failed', 'err'); }
    }
    return;
  }
}

function renderList(){
  if (!_listEl || !_inputEl) return;
  const filtered = fuzzyFilter(_items, _inputEl.value);
  _selectedIdx = Math.max(0, Math.min(_selectedIdx, filtered.length - 1));
  _listEl.replaceChildren();
  filtered.forEach((it, i) => {
    const row = el('div', 'palette-row' + (i === _selectedIdx ? ' selected' : ''));
    row.append(
      el('span', 'palette-label', it.label),
      it.hint ? el('span', 'palette-hint', it.hint) : null
    );
    row.addEventListener('click', () => {
      _selectedIdx = i;
      const action = it.action;
      close();
      try { action(); } catch (err) { console.error(err); showToast('Command failed', 'err'); }
    });
    _listEl.append(row);
  });
}

function open(items, placeholder){
  if (_overlayEl) close();
  _items = items;
  _selectedIdx = 0;
  const overlay = el('div', 'palette-overlay');
  const box = el('div', 'palette-box');
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.placeholder = placeholder || 'Type a command…';
  inp.className = 'palette-input';
  const list = el('div', 'palette-list');
  box.append(inp, list);
  overlay.append(box);
  document.body.append(overlay);
  _overlayEl = overlay;
  _inputEl = inp;
  _listEl = list;
  inp.addEventListener('input', () => {
    _selectedIdx = 0;
    renderList();
  });
  // Click outside closes
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  setTimeout(() => inp.focus(), 0);
  document.addEventListener('keydown', onKey, true);
  renderList();
}

// --- Public API ---

export function openCommandPalette(){
  const items = buildCommandList();
  open(items, 'Type a command…');
}

export function openQuickOpen(){
  const items = state.files.map(slot => {
    const s = slot.id === state.activeId ? state : slot.snapshot || {};
    const name = s.fileName || '(untitled)';
    return {
      label: name,
      hint: slot.folder || '',
      action: () => switchToFile(slot.id)
    };
  });
  if (!items.length){
    showToast('No files open');
    return;
  }
  open(items, 'Search files…');
}

function buildCommandList(){
  const cmds = [];
  // Helper to call window-attached functions safely
  const w = window;
  cmds.push({label: 'Project: New', action: async () => {
    const name = prompt('Project name', 'Untitled ' + new Date().toISOString().slice(0,10));
    if (!name) return;
    const proj = await w.__projects_create(name);
    state.files = []; state.activeId = null; state.items = [];
    await w.__projects_switch(proj.id);
    await (await import('./files.js')).restoreFromCache();
    w.__projectsui_refreshChip?.();
    w.__projectsui_refreshStatusBar?.();
    renderView(); renderSidebar();
    showToast('Created project "' + proj.name + '"');
  }});
  cmds.push({label: 'Project: Switch to…', action: () => $('projectChip')?.click()});
  cmds.push({label: 'Project: Rename', action: async () => {
    const proj = w.__projects_active();
    if (!proj) return;
    const newName = prompt('New name', proj.name);
    if (!newName || newName === proj.name) return;
    await w.__projects_rename(proj.id, newName);
    w.__projectsui_refreshChip?.();
    w.__projectsui_refreshStatusBar?.();
    showToast('Renamed');
  }});
  cmds.push({label: 'Project: Delete', action: async () => {
    const proj = w.__projects_active();
    if (!proj) return;
    if (!confirm(`Delete project "${proj.name}" and ${proj.fileIds.length} files?`)) return;
    await w.__projects_delete(proj.id);
    await w.__projects_boot();
    state.files = []; state.activeId = null; state.items = [];
    await (await import('./files.js')).restoreFromCache();
    w.__projectsui_refreshChip?.();
    w.__projectsui_refreshStatusBar?.();
    renderView(); renderSidebar();
    showToast('Deleted');
  }});
  cmds.push({label: 'Project: Manage…', action: () => {
    // Trigger manage via project chip then click Manage button
    $('projectChip')?.click();
    setTimeout(() => {
      const btns = document.querySelectorAll('.pp-action');
      for (const b of btns) if (b.textContent.includes('Manage')) { b.click(); return; }
    }, 50);
  }});
  cmds.push({label: 'File: Open Files…', action: () => $('filesInput')?.click() || $('fileInput')?.click()});
  cmds.push({label: 'File: Open Folder…', action: () => $('folderInput')?.click()});
  cmds.push({label: 'File: Save Active', action: () => $('saveBtn')?.click()});
  cmds.push({label: 'View: Toggle Theme', action: () => $('themeToggle')?.click()});
  cmds.push({label: 'View: Toggle Newlines', action: () => $('nlToggle')?.click()});
  cmds.push({label: 'View: Toggle Markdown', action: () => $('mdToggle')?.click()});
  cmds.push({label: 'View: Toggle Edit Mode', action: () => $('editToggle')?.click()});
  cmds.push({label: 'View: Toggle Quick Copy', action: () => $('quickCopyToggle')?.click()});
  cmds.push({label: 'View: Expand All', action: () => $('expandAll')?.click()});
  cmds.push({label: 'View: Collapse All', action: () => $('collapseAll')?.click()});
  cmds.push({label: 'View: Settings…', action: () => w.__projectsui_openSettings?.()});
  return cmds;
}

// --- Test hooks ---
window.__palette_open = openCommandPalette;
window.__palette_quickOpen = openQuickOpen;
window.__palette_close = close;
window.__palette_isOpen = () => !!_overlayEl;
window.__palette_filtered = () => fuzzyFilter(_items, _inputEl?.value || '').map(x => x.label);

// js/projects-ui.js — toolbar project chip + popup + manage modal.
import { el, $modal, $modalTitle, $modalBody, $modalOk, $modalCancel, showToast } from './dom.js';
import {
  bootProjects, getActiveProject, listProjects,
  createProject, switchProject, renameProject, deleteProject
} from './projects.js';
import { restoreFromCache } from './files.js';
import { state } from './state.js';
import { renderView, updateStats, updateDirtyBadge } from './view.js';
import { renderSidebar, analyzeSchema } from './schema.js';

export function initProjectChip(){
  const chip = document.getElementById('projectChip');
  if (!chip) return;
  chip.addEventListener('click', openPopup);
  refreshChip();
}

export function refreshChip(){
  const chip = document.getElementById('projectChip');
  if (!chip) return;
  const proj = getActiveProject();
  chip.textContent = (proj ? proj.name : 'Untitled') + ' ▾';
}

let _popupEl = null;
function closePopup(){
  if (_popupEl){ _popupEl.remove(); _popupEl = null; }
  document.removeEventListener('click', onDocClick, true);
  document.removeEventListener('keydown', onKey, true);
}
function onDocClick(e){ if (_popupEl && !_popupEl.contains(e.target) && e.target.id !== 'projectChip') closePopup(); }
function onKey(e){ if (e.key === 'Escape') closePopup(); }

async function openPopup(){
  if (_popupEl){ closePopup(); return; }
  const projects = await listProjects();
  projects.sort((a,b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const active = getActiveProject();
  const pop = el('div', 'project-popup');
  for (const p of projects){
    const row = el('div', 'pp-row' + (active && p.id === active.id ? ' active' : ''));
    row.append(
      el('span', 'pp-check', active && p.id === active.id ? '✓' : ' '),
      el('span', 'pp-name', p.name),
      el('span', 'pp-meta', `${p.fileIds.length} ${p.fileIds.length === 1 ? 'file' : 'files'}`)
    );
    row.addEventListener('click', async () => {
      closePopup();
      if (active && p.id === active.id) return;
      await doSwitchProject(p.id);
    });
    pop.append(row);
  }
  pop.append(el('div', 'pp-divider'));
  const newBtn = el('button', 'pp-action', '+ New Project');
  newBtn.addEventListener('click', async () => { closePopup(); await doNewProject(); });
  pop.append(newBtn);
  const manageBtn = el('button', 'pp-action', '⚙ Manage Projects…');
  manageBtn.addEventListener('click', () => { closePopup(); openManageModal(); });
  pop.append(manageBtn);

  // Position below the chip
  const chip = document.getElementById('projectChip');
  const r = chip.getBoundingClientRect();
  pop.style.position = 'fixed';
  pop.style.left = `${r.left}px`;
  pop.style.top = `${r.bottom + 4}px`;
  pop.style.minWidth = `${Math.max(r.width, 240)}px`;
  document.body.append(pop);
  _popupEl = pop;
  setTimeout(() => {
    document.addEventListener('click', onDocClick, true);
    document.addEventListener('keydown', onKey, true);
  }, 0);
}

async function doSwitchProject(id){
  // Clear in-memory state
  state.files = [];
  state.activeId = null;
  state.items = [];
  await switchProject(id);
  await restoreFromCache();
  // Re-render
  analyzeSchema();
  renderSidebar();
  renderView();
  updateStats();
  updateDirtyBadge();
  refreshChip();
  refreshStatusBar();
  showToast('Switched to ' + getActiveProject().name);
}

async function doNewProject(){
  const name = await openPromptModal('New Project', 'Project name', 'Untitled ' + new Date().toISOString().slice(0,10));
  if (!name) return;
  const proj = await createProject(name);
  // Switch to it
  state.files = []; state.activeId = null; state.items = [];
  await switchProject(proj.id);
  analyzeSchema(); renderSidebar(); renderView(); updateStats(); updateDirtyBadge();
  refreshChip(); refreshStatusBar();
  showToast('Created project "' + proj.name + '"');
}

function openPromptModal(title, label, defaultValue=''){
  return new Promise(resolve => {
    $modalTitle.textContent = title;
    $modalBody.replaceChildren();
    const lbl = el('label', null, label);
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.value = defaultValue;
    inp.className = 'modal-input';
    $modalBody.append(lbl, inp);
    $modalOk.textContent = 'OK';
    $modalOk.className = 'btn primary';
    $modalOk.style.background = ''; $modalOk.style.borderColor = '';
    $modal.style.display = 'flex';
    setTimeout(() => { inp.focus(); inp.select(); }, 0);
    const cleanup = (val) => {
      $modal.style.display = 'none';
      $modalOk.removeEventListener('click', okFn);
      $modalCancel.removeEventListener('click', cancelFn);
      $modal.removeEventListener('click', bgFn);
      document.removeEventListener('keydown', keyFn, true);
      resolve(val);
    };
    const okFn = () => cleanup(inp.value.trim() || null);
    const cancelFn = () => cleanup(null);
    const bgFn = (e) => { if (e.target === $modal) cleanup(null); };
    const keyFn = (e) => {
      if (e.key === 'Escape'){ e.preventDefault(); cleanup(null); }
      else if (e.key === 'Enter'){ e.preventDefault(); cleanup(inp.value.trim() || null); }
    };
    $modalOk.addEventListener('click', okFn);
    $modalCancel.addEventListener('click', cancelFn);
    $modal.addEventListener('click', bgFn);
    document.addEventListener('keydown', keyFn, true);
  });
}

async function openManageModal(){
  const projects = await listProjects();
  projects.sort((a,b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const active = getActiveProject();
  $modalTitle.textContent = 'Manage Projects';
  $modalBody.replaceChildren();
  const list = el('div', 'manage-list');
  for (const p of projects){
    const row = el('div', 'manage-row');
    if (active && p.id === active.id) row.classList.add('active');
    row.append(
      el('span', 'mr-name', p.name + (active && p.id === active.id ? ' (active)' : '')),
      el('span', 'mr-meta', `${p.fileIds.length} files · updated ${new Date(p.updatedAt || 0).toLocaleString()}`)
    );
    const btns = el('div', 'mr-btns');
    const renameBtn = el('button', 'mini-btn', 'Rename');
    renameBtn.addEventListener('click', async () => {
      const newName = await openPromptModal('Rename Project', 'New name', p.name);
      if (!newName || newName === p.name) { openManageModal(); return; }
      await renameProject(p.id, newName);
      refreshChip(); refreshStatusBar();
      showToast('Renamed');
      openManageModal();
    });
    const deleteBtn = el('button', 'mini-btn danger', 'Delete');
    deleteBtn.addEventListener('click', async () => {
      const ok = confirm(`Delete project "${p.name}" and ${p.fileIds.length} files? Cannot be undone.`);
      if (!ok) { openManageModal(); return; }
      await deleteProject(p.id);
      // If deleted active, re-boot to ensure a fresh Untitled
      if (active && p.id === active.id){
        await bootProjects();
        state.files = []; state.activeId = null; state.items = [];
        await restoreFromCache();
        analyzeSchema(); renderSidebar(); renderView(); updateStats(); updateDirtyBadge();
      }
      refreshChip(); refreshStatusBar();
      showToast('Deleted');
      openManageModal();
    });
    btns.append(renameBtn, deleteBtn);
    row.append(btns);
    list.append(row);
  }
  $modalBody.append(list);
  $modalOk.textContent = 'Close';
  $modalOk.className = 'btn';
  $modalOk.style.background = ''; $modalOk.style.borderColor = '';
  $modal.style.display = 'flex';
  const cleanup = () => {
    $modal.style.display = 'none';
    $modalOk.removeEventListener('click', okFn);
    $modalCancel.removeEventListener('click', okFn);
    $modal.removeEventListener('click', bgFn);
    document.removeEventListener('keydown', keyFn, true);
  };
  const okFn = () => cleanup();
  const bgFn = (e) => { if (e.target === $modal) cleanup(); };
  const keyFn = (e) => { if (e.key === 'Escape'){ e.preventDefault(); cleanup(); } };
  $modalOk.addEventListener('click', okFn);
  $modalCancel.addEventListener('click', okFn);
  $modal.addEventListener('click', bgFn);
  document.addEventListener('keydown', keyFn, true);
}

// --- Status bar ---
export function initStatusBar(){
  refreshStatusBar();
}

export function refreshStatusBar(){
  const bar = document.getElementById('statusBar');
  if (!bar) return;
  const proj = getActiveProject();
  const fileCount = state.files.length;
  const errCount = state.items.filter(it => it.error).length;
  bar.textContent = `${proj ? proj.name : 'Untitled'}  ·  ${fileCount} ${fileCount === 1 ? 'file' : 'files'}  ·  ${state.items.filter(it => !it.deleted).length} items  ·  ${errCount} errors`;
}

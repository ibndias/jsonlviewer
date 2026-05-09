// js/shell.js — VS Code shell wiring (activity bar + panel switch + tab strip).
import { el, $, showToast } from './dom.js';
import { state } from './state.js';
import { switchToFile, closeFile } from './files.js';
import { listProjects, getActiveProject, switchProject, createProject } from './projects.js';
import { restoreFromCache } from './files.js';
import { renderView, updateStats, updateDirtyBadge } from './view.js';
import { analyzeSchema, renderSidebar } from './schema.js';

let _activePanel = 'files';
let _schemaVisible = true;

export function initShell(){
  // Activity bar
  document.querySelectorAll('#activityBar .act-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const panel = btn.dataset.panel;
      if (panel === 'schema'){
        _schemaVisible = !_schemaVisible;
        document.querySelector('.shell').classList.toggle('schema-hidden', !_schemaVisible);
        btn.classList.toggle('active', _schemaVisible);
        return;
      }
      switchPanel(panel);
    });
  });

  // Side bar buttons
  document.getElementById('newProjectBtn')?.addEventListener('click', async () => {
    const name = prompt('Project name', 'Untitled ' + new Date().toISOString().slice(0,10));
    if (!name) return;
    const proj = await createProject(name);
    state.files = []; state.activeId = null; state.items = [];
    await switchProject(proj.id);
    await restoreFromCache();
    analyzeSchema(); renderSidebar(); renderView(); updateStats(); updateDirtyBadge();
    refreshProjectsPanel();
    window.__projectsui_refreshChip?.();
    window.__projectsui_refreshStatusBar?.();
    showToast('Created ' + proj.name);
  });
  document.getElementById('manageProjectsBtn')?.addEventListener('click', () => {
    document.getElementById('projectChip')?.click();
    setTimeout(() => {
      const btns = document.querySelectorAll('.pp-action');
      for (const b of btns) if (b.textContent.includes('Manage')) { b.click(); return; }
    }, 50);
  });

  document.getElementById('openSettingsModalBtn')?.addEventListener('click', () => {
    window.__projectsui_openSettings?.();
  });

  // Initial paint
  refreshProjectsPanel();
  renderTabStrip();
  // Render Dataset panel (lazy import to avoid circular)
  try { window.__dataset_ui?.renderDatasetPanel(); } catch {}

  // Schema icon reflects state
  const schemaBtn = document.querySelector('.act-btn[data-panel="schema"]');
  if (schemaBtn) schemaBtn.classList.add('active');
}

function switchPanel(name){
  _activePanel = name;
  document.querySelectorAll('#activityBar .act-btn').forEach(b => {
    if (b.dataset.panel === 'schema') return;  // handled separately
    b.classList.toggle('active', b.dataset.panel === name);
  });
  document.querySelectorAll('.side-panel').forEach(p => {
    p.classList.toggle('active', p.dataset.panel === name);
  });
  if (name === 'projects') refreshProjectsPanel();
  if (name === 'dataset') try { window.__dataset_ui?.renderDatasetPanel(); } catch {}
}

export async function refreshProjectsPanel(){
  const list = document.getElementById('projectsList');
  if (!list) return;
  try {
    const projects = await listProjects();
    projects.sort((a,b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const active = getActiveProject();
    list.replaceChildren();
    for (const p of projects){
      const row = el('div', 'pl-row' + (active && p.id === active.id ? ' active' : ''));
      row.append(
        el('span', 'pl-name', p.name),
        el('span', 'pl-meta', `${p.fileIds.length}`)
      );
      row.addEventListener('click', async () => {
        if (active && p.id === active.id) return;
        state.files = []; state.activeId = null; state.items = [];
        await switchProject(p.id);
        await restoreFromCache();
        analyzeSchema(); renderSidebar(); renderView(); updateStats(); updateDirtyBadge();
        refreshProjectsPanel();
        renderTabStrip();
        window.__projectsui_refreshChip?.();
        window.__projectsui_refreshStatusBar?.();
        showToast('Switched to ' + p.name);
      });
      list.append(row);
    }
    if (!projects.length) list.append(el('div', 'side-empty', 'No projects yet.'));
  } catch (e) {
    list.replaceChildren(el('div', 'side-empty', 'No projects loaded.'));
  }
}

export function renderTabStrip(){
  const strip = document.getElementById('tabStrip');
  if (!strip) return;
  strip.replaceChildren();
  for (const slot of state.files){
    const live = slot.id === state.activeId;
    const s = live ? state : (slot.snapshot || {});
    const name = s.fileName || '(untitled)';
    const items = s.items || [];
    const dirty = items.some(it => it.dirty || it.deleted);
    const tab = el('div', 'tab-item' + (live ? ' active' : ''));
    if (dirty) tab.append(el('span', 'tab-dirty-dot'));
    tab.append(el('span', 'tab-name', name));
    const close = el('button', 'tab-close', '×');
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      closeFile(slot.id);
      renderTabStrip();
    });
    tab.append(close);
    tab.addEventListener('click', () => {
      if (slot.id !== state.activeId){
        switchToFile(slot.id);
        renderTabStrip();
      }
    });
    strip.append(tab);
  }
}

window.__shell_renderTabStrip = renderTabStrip;
window.__shell_refreshProjectsPanel = refreshProjectsPanel;
window.__shell_switchPanel = switchPanel;

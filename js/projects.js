// js/projects.js — active project + CRUD + autosave debouncer.
import { dbOpen, dbGet, dbPut, dbDelete, dbAll, dbListByProject, dbMetaGet, dbMetaSet } from './db.js';
import { publish } from './sync.js';

const FLUSH_DEBOUNCE_MS = 500;

let _db = null;
let _active = null;
let _dbNameOverride = null;
const _flushTimers = new Map();

function newId(){
  return 'p_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

async function ensureDb(){
  if (_db) return _db;
  _db = await dbOpen(_dbNameOverride || undefined);
  return _db;
}

// Exposed so other modules (e.g. export.js) share the same DB connection.
export async function getDb(){ return ensureDb(); }

export async function bootProjects(){
  const db = await ensureDb();
  const activeId = await dbMetaGet(db, 'activeProjectId');
  let proj = activeId ? await dbGet(db, 'projects', activeId) : null;
  if (!proj){
    proj = {
      id: newId(),
      name: 'Untitled',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      fileIds: [],
      openTabIds: [],
      activeTabId: null
    };
    await dbPut(db, 'projects', proj);
    await dbMetaSet(db, 'activeProjectId', proj.id);
  }
  _active = proj;
  return proj;
}

export function getActiveProject(){ return _active; }

export async function loadActiveProjectFiles(){
  const db = await ensureDb();
  if (!_active) return [];
  const files = await dbListByProject(db, _active.id);
  const order = new Map(_active.fileIds.map((id, i) => [id, i]));
  files.sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
  return files;
}

export async function flushFile(fileRow){
  const db = await ensureDb();
  await dbPut(db, 'files', { ...fileRow, updatedAt: Date.now() });
  if (!_active.fileIds.includes(fileRow.id)){
    _active.fileIds.push(fileRow.id);
    _active.updatedAt = Date.now();
    await dbPut(db, 'projects', _active);
  }
  publish({ type: 'file-changed', fileId: fileRow.id, projectId: _active.id });
}

export async function deleteFile(fileId){
  const db = await ensureDb();
  await dbDelete(db, 'files', fileId);
  _active.fileIds = _active.fileIds.filter(id => id !== fileId);
  _active.updatedAt = Date.now();
  await dbPut(db, 'projects', _active);
  publish({ type: 'file-deleted', fileId, projectId: _active.id });
}

export function flushFileDebounced(fileRow){
  const id = fileRow.id;
  clearTimeout(_flushTimers.get(id));
  return new Promise((resolve, reject) => {
    _flushTimers.set(id, setTimeout(() => {
      _flushTimers.delete(id);
      flushFile(fileRow).then(resolve, reject);
    }, FLUSH_DEBOUNCE_MS));
  });
}

export async function flushFileImmediate(fileRow){
  clearTimeout(_flushTimers.get(fileRow.id));
  _flushTimers.delete(fileRow.id);
  return flushFile(fileRow);
}

export async function listProjects(){
  const db = await ensureDb();
  return await dbAll(db, 'projects');
}

export async function createProject(name){
  const db = await ensureDb();
  const proj = {
    id: 'p_' + Math.random().toString(36).slice(2) + Date.now().toString(36),
    name: name || 'Untitled',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    fileIds: [],
    openTabIds: [],
    activeTabId: null
  };
  await dbPut(db, 'projects', proj);
  return proj;
}

export async function switchProject(id){
  const db = await ensureDb();
  const proj = await dbGet(db, 'projects', id);
  if (!proj) throw new Error('Project not found: ' + id);
  _active = proj;
  await dbMetaSet(db, 'activeProjectId', id);
  return proj;
}

export async function renameProject(id, newName){
  const db = await ensureDb();
  const proj = await dbGet(db, 'projects', id);
  if (!proj) throw new Error('Project not found: ' + id);
  proj.name = newName;
  proj.updatedAt = Date.now();
  await dbPut(db, 'projects', proj);
  if (_active && _active.id === id) _active.name = newName;
  return proj;
}

export async function deleteProject(id){
  const db = await ensureDb();
  // Delete all files belonging to this project
  const files = await dbListByProject(db, id);
  for (const f of files) await dbDelete(db, 'files', f.id);
  await dbDelete(db, 'projects', id);
  // If deleted active, clear and re-boot to fresh Untitled
  if (_active && _active.id === id){
    _active = null;
    await dbMetaSet(db, 'activeProjectId', '');  // empty so bootProjects creates new
  }
}

const DEFAULT_SETTINGS = { bigFileCapMB: 50 };

export async function getSettings(){
  const db = await ensureDb();
  const s = await dbMetaGet(db, 'settings');
  return { ...DEFAULT_SETTINGS, ...(s || {}) };
}

export async function setSettings(patch){
  const db = await ensureDb();
  const cur = await getSettings();
  const next = { ...cur, ...patch };
  await dbMetaSet(db, 'settings', next);
  return next;
}

export async function clearAllData(){
  const db = await ensureDb();
  const projects = await dbAll(db, 'projects');
  for (const p of projects) await dbDelete(db, 'projects', p.id);
  const files = await dbAll(db, 'files');
  for (const f of files) await dbDelete(db, 'files', f.id);
  await dbDelete(db, 'meta', 'activeProjectId');
  await dbDelete(db, 'meta', 'settings');
  _active = null;
}

// --- Test hooks ---
window.__projects_setDbName = (name) => {
  _dbNameOverride = name;
  if (_db) try { _db.close(); } catch {}
  _db = null;
  _active = null;
};
window.__projects_boot = bootProjects;
window.__projects_active = getActiveProject;
window.__projects_flushFile = flushFile;
window.__projects_deleteFile = deleteFile;
window.__projects_loadActiveProjectFiles = loadActiveProjectFiles;
window.__projects_list = listProjects;
window.__projects_create = createProject;
window.__projects_switch = switchProject;
window.__projects_rename = renameProject;
window.__projects_delete = deleteProject;
window.__projects_getSettings = getSettings;
window.__projects_setSettings = setSettings;
window.__projects_clearAll = clearAllData;

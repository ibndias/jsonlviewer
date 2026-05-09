// js/export.js — bundle import/export.
import { dbAll, dbListByProject, dbPut, dbGet } from './db.js';
import { getDb } from './projects.js';

async function _db(){ return getDb(); }

const BUNDLE_FORMAT = 'jsonlviewer-bundle';
const SCHEMA_VERSION = 1;

export async function exportProject(projectId){
  const db = await _db();
  const proj = await dbGet(db, 'projects', projectId);
  if (!proj) throw new Error('Project not found');
  const files = await dbListByProject(db, projectId);
  const bundle = {
    format: BUNDLE_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: Date.now(),
    projects: [{
      id: proj.id,
      name: proj.name,
      createdAt: proj.createdAt,
      updatedAt: proj.updatedAt,
      files: files
        .filter(f => !f.sessionOnly && f.content !== undefined)
        .map(f => ({
          name: f.name,
          folder: f.folder,
          ext: f.ext,
          sizeBytes: f.sizeBytes,
          content: f.content
        }))
    }]
  };
  return bundle;
}

export async function exportAllProjects(){
  const db = await _db();
  const projects = await dbAll(db, 'projects');
  const out = [];
  for (const proj of projects){
    const files = await dbListByProject(db, proj.id);
    out.push({
      id: proj.id,
      name: proj.name,
      createdAt: proj.createdAt,
      updatedAt: proj.updatedAt,
      files: files
        .filter(f => !f.sessionOnly && f.content !== undefined)
        .map(f => ({
          name: f.name,
          folder: f.folder,
          ext: f.ext,
          sizeBytes: f.sizeBytes,
          content: f.content
        }))
    });
  }
  return {
    format: BUNDLE_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: Date.now(),
    projects: out
  };
}

export function downloadBundle(bundle, filename){
  const json = JSON.stringify(bundle, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function validateBundle(bundle){
  if (!bundle || typeof bundle !== 'object') throw new Error('Bundle must be a JSON object');
  if (bundle.format !== BUNDLE_FORMAT) throw new Error(`Bundle.format mismatch (expected "${BUNDLE_FORMAT}")`);
  if (bundle.schemaVersion !== SCHEMA_VERSION) throw new Error(`Bundle.schemaVersion mismatch (expected ${SCHEMA_VERSION}, got ${bundle.schemaVersion})`);
  if (!Array.isArray(bundle.projects)) throw new Error('Bundle.projects must be an array');
  for (const p of bundle.projects){
    if (!p.id || typeof p.id !== 'string') throw new Error('Project missing id');
    if (typeof p.name !== 'string') throw new Error('Project missing name');
    if (!Array.isArray(p.files)) throw new Error('Project.files must be an array');
    for (const f of p.files){
      if (typeof f.name !== 'string') throw new Error('File missing name');
      if (typeof f.content !== 'string') throw new Error('File missing content');
    }
  }
  return true;
}

function newId(){
  return 'p_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
function newFileId(){
  return 'f_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export async function importBundle(bundle, opts={}){
  validateBundle(bundle);
  const db = await _db();
  const renameOnConflict = opts.renameOnConflict !== false;  // default true

  const existing = await dbAll(db, 'projects');
  const existingIds = new Set(existing.map(p => p.id));
  const importedIds = [];

  for (const p of bundle.projects){
    let id = p.id;
    const hadConflict = existingIds.has(id);
    if (hadConflict){
      id = newId();   // rename to avoid clobbering
    }
    // Generate fresh file ids and update fileIds array
    const fileIds = [];
    const projRow = {
      id,
      name: p.name + (hadConflict && renameOnConflict ? ' (imported)' : ''),
      createdAt: p.createdAt || Date.now(),
      updatedAt: Date.now(),
      fileIds,
      openTabIds: [],
      activeTabId: null
    };
    for (const f of p.files){
      const fid = newFileId();
      fileIds.push(fid);
      await dbPut(db, 'files', {
        id: fid,
        projectId: id,
        name: f.name,
        folder: f.folder || '',
        ext: f.ext || (f.name.toLowerCase().endsWith('.jsonl') ? 'jsonl' : 'json'),
        sizeBytes: f.sizeBytes != null ? f.sizeBytes : f.content.length,
        sessionOnly: false,
        content: f.content,
        updatedAt: Date.now()
      });
    }
    await dbPut(db, 'projects', projRow);
    importedIds.push(id);
  }
  return importedIds;
}

// --- Test hooks ---
window.__export_project = exportProject;
window.__export_all = exportAllProjects;
window.__export_download = downloadBundle;
window.__import_bundle = importBundle;

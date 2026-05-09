// js/db.js — IndexedDB wrapper for jsonlviewer.
const DB_NAME = 'jsonlviewer';
const DB_VERSION = 1;

function _openDb(name, version){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')){
        db.createObjectStore('projects', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('files')){
        const s = db.createObjectStore('files', { keyPath: 'id' });
        s.createIndex('byProject', 'projectId', { unique: false });
      }
      if (!db.objectStoreNames.contains('meta')){
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
  });
}

export async function dbOpen(name = DB_NAME){
  return _openDb(name, DB_VERSION);
}

function _request(db, store, mode, action){
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const req = action(s);
    t.oncomplete = () => resolve(req && 'result' in req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export function dbGet(db, store, key){
  return _request(db, store, 'readonly', s => s.get(key));
}

export function dbPut(db, store, value){
  return _request(db, store, 'readwrite', s => s.put(value));
}

export function dbDelete(db, store, key){
  return _request(db, store, 'readwrite', s => s.delete(key));
}

export function dbAll(db, store){
  return _request(db, store, 'readonly', s => s.getAll());
}

export function dbListByProject(db, projectId){
  return new Promise((resolve, reject) => {
    const t = db.transaction('files', 'readonly');
    const idx = t.objectStore('files').index('byProject');
    const req = idx.getAll(IDBKeyRange.only(projectId));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function dbDeleteByProject(db, projectId){
  const items = await dbListByProject(db, projectId);
  for (const f of items) await dbDelete(db, 'files', f.id);
}

export async function dbMetaGet(db, key){
  const r = await dbGet(db, 'meta', key);
  return r ? r.value : undefined;
}

export function dbMetaSet(db, key, value){
  return dbPut(db, 'meta', { key, value });
}

// --- Test hooks (window-exposed for runner.html) ---
window.__db_open = dbOpen;
window.__db_put = dbPut;
window.__db_get = dbGet;
window.__db_delete = dbDelete;
window.__db_listByProject = dbListByProject;

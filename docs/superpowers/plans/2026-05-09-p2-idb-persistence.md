# P2 — IDB Persistence + Auto-Project Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist files, folders, and edits across browser reload via IndexedDB. Single auto-saved "Untitled" project for v1; UI for project switching/management deferred to P3.

**Architecture:** New modules `js/db.js` (IndexedDB wrapper), `js/projects.js` (active-project state + autosave debouncer), `js/sync.js` (BroadcastChannel pub/sub). Wire into existing `files.js` (structural-change hooks) and `view-edit.js` (edit hooks) so changes flush to IDB. On boot, `main.js` restores the saved workspace before rendering.

**Tech Stack:** IndexedDB (`idb`-style raw API, no library), BroadcastChannel, ES modules. Same browser-test runner harness.

**Spec:** `docs/superpowers/specs/2026-05-09-projects-local-cache-design.md`. **Plan it builds on:** `docs/superpowers/plans/2026-05-09-p1-module-refactor.md` (P1 must be merged into `main` before P2 begins).

**Out of scope (deferred to later P plans):**
- Project switcher UI / Manage modal / Activity bar / Side bar (P3).
- Tabs, command palette, quick open (P4).
- Search panel, settings panel (P5).
- Big-file `sessionOnly` flow (P6).
- Import/export bundles (P7).

---

## Module additions

| File | Lines (target) | Responsibility |
|---|---|---|
| `js/db.js` | ~150 | Open `jsonlviewer` DB v1, expose `get/put/delete/iterate` per store, `meta` helpers, quota-error handling. Pure async API; no UI. |
| `js/projects.js` | ~200 | Track `activeProjectId` in module state + IDB `meta`. Functions: `bootProjects()`, `createUntitled()`, `flushFile(id)`, `flushStructural()`, `loadActiveProject()`. Owns autosave debounce queue. Emits CustomEvents on `document` for UI consumers. |
| `js/sync.js` | ~80 | One `BroadcastChannel('jsonlviewer-sync')`. Generates per-tab `senderId`. Exposes `publish(msg)` and `subscribe(fn)`; remote msgs with same `senderId` filtered. |
| `js/main.js` | +30 lines | New: import projects/sync, await `bootProjects()` before initial render. New event listeners for structural/edit changes that call `projects.flushXxx()`. |
| `js/files.js` | +20 lines | New: emit `'jsonlviewer:files-changed'` event after `loadFile` / `closeFile`. |
| `js/view-edit.js` | +5 lines | New: emit `'jsonlviewer:file-edited'` event after each successful edit (markDirty caller). |

No existing function bodies are rewritten. We **add** event-emission lines and a new bootstrap step.

---

## Data model recap (from spec)

```
Database: jsonlviewer  (version 1)

Object store: projects (keyPath: "id")
  { id, name, createdAt, updatedAt, fileIds, openTabIds, activeTabId }

Object store: files (keyPath: "id"; index "byProject" on projectId)
  { id, projectId, name, folder, ext, sizeBytes, sessionOnly,
    content?, updatedAt }

Object store: meta (keyPath: "key")
  { key: "activeProjectId", value: <uuid> }
  { key: "schemaVersion",   value: 1 }
  { key: "settings",        value: { bigFileCapMB: 50 } }
```

**P2 simplification:** `openTabIds` and `activeTabId` are persisted but not read by any UI in P2. `sessionOnly`, `bigFileCapMB`, `settings` are persisted but the big-file flow is deferred to P6 — for P2, every file is cached with content regardless of size (we'll add the cap later).

---

## TDD discipline

P2 introduces real new logic. Each task uses TDD:
1. Write a failing test in `test/runner.html` (the existing in-browser harness).
2. Run; confirm RED.
3. Implement minimal code to make it green.
4. Run; confirm GREEN + all 23 prior tests still GREEN.
5. Commit.

Tests for `db.js` use the real IndexedDB in the iframe; each test opens a uniquely-named DB (e.g., `jsonlviewer-test-${Math.random()}`) and deletes it on teardown so test runs are independent.

`projects.js` and `sync.js` tests can substitute fake DB wrappers / fake `BroadcastChannel` to keep tests fast and deterministic.

---

## Test runner — recap

Local server already running on port 8765 (worktree-rooted). Open `http://localhost:8765/.worktrees/p2-idb-persistence/test/runner.html` in a browser, click "Run all". Expected count after P2: 23 (P1) + 12 (new) ≈ 35 tests.

The controller verifies via Playwright after each subagent commit. Pass criterion: `summary.textContent` matches `/\b35\s*passed\b/i` and `/\b0\s*failed\b/i`.

---

## Task 0: P2 worktree + baseline

**Files:** none

- [ ] **Step 1: Create worktree on new branch**

```bash
cd /home/derry/ws/jsonlviewer
git worktree add .worktrees/p2-idb-persistence -b p2-idb-persistence
cd .worktrees/p2-idb-persistence
```

- [ ] **Step 2: Verify P1 baseline (23/0)**

Open `http://localhost:8765/.worktrees/p2-idb-persistence/test/runner.html`, click Run all.
Expected: `23 passed · 0 failed`.

- [ ] **Step 3: No commit needed.**

---

## Task 1: `js/db.js` — IndexedDB wrapper

**Files:**
- Create: `js/db.js`
- Modify: `test/runner.html` (add db tests)

- [ ] **Step 1: Write failing tests for db.js**

In `test/runner.html`, after the existing tests, add:

```javascript
test('db: open creates schema v1 with three stores', async () => {
  const db = await fwin().__db_openTestDb('jsonlviewer-t-' + Date.now());
  const stores = [...db.objectStoreNames].sort();
  assertEq(JSON.stringify(stores), JSON.stringify(['files', 'meta', 'projects']));
  db.close();
  await new Promise((res, rej) => {
    const r = indexedDB.deleteDatabase(db.name);
    r.onsuccess = res; r.onerror = rej;
  });
});

test('db: put + get round-trip on projects store', async () => {
  const dbName = 'jsonlviewer-t-' + Date.now();
  const db = await fwin().__db_openTestDb(dbName);
  const proj = {id:'p1', name:'X', createdAt:1, updatedAt:1, fileIds:[], openTabIds:[], activeTabId:null};
  await fwin().__db_put(db, 'projects', proj);
  const got = await fwin().__db_get(db, 'projects', 'p1');
  assertEq(got.id, 'p1');
  assertEq(got.name, 'X');
  db.close();
  await new Promise(res => { indexedDB.deleteDatabase(dbName).onsuccess = res; });
});

test('db: byProject index lists files of a project', async () => {
  const dbName = 'jsonlviewer-t-' + Date.now();
  const db = await fwin().__db_openTestDb(dbName);
  await fwin().__db_put(db, 'files', {id:'f1', projectId:'p1', name:'a.json', folder:'', ext:'json', sizeBytes:1, sessionOnly:false, content:'{}', updatedAt:1});
  await fwin().__db_put(db, 'files', {id:'f2', projectId:'p1', name:'b.json', folder:'', ext:'json', sizeBytes:1, sessionOnly:false, content:'{}', updatedAt:1});
  await fwin().__db_put(db, 'files', {id:'f3', projectId:'p2', name:'c.json', folder:'', ext:'json', sizeBytes:1, sessionOnly:false, content:'{}', updatedAt:1});
  const ours = await fwin().__db_listByProject(db, 'p1');
  assertEq(ours.length, 2);
  db.close();
  await new Promise(res => { indexedDB.deleteDatabase(dbName).onsuccess = res; });
});
```

The `fwin().__db_*` helpers will be exposed by `js/db.js` for testing.

- [ ] **Step 2: Run runner. Expected RED on three new tests.**

- [ ] **Step 3: Implement `js/db.js`**

```javascript
// js/db.js
const DB_NAME = 'jsonlviewer';
const DB_VERSION = 1;

function openDb(name = DB_NAME, version = DB_VERSION){
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

function tx(db, storeNames, mode='readonly'){
  return db.transaction(storeNames, mode);
}

function txOp(db, storeName, mode, fn){
  return new Promise((resolve, reject) => {
    const t = tx(db, storeName, mode);
    const s = t.objectStore(storeName);
    const result = fn(s);
    t.oncomplete = () => resolve(result instanceof IDBRequest ? result.result : result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function dbOpen(){ return openDb(); }

export async function dbGet(db, store, key){
  return txOp(db, store, 'readonly', s => s.get(key));
}

export async function dbPut(db, store, value){
  return txOp(db, store, 'readwrite', s => s.put(value));
}

export async function dbDelete(db, store, key){
  return txOp(db, store, 'readwrite', s => s.delete(key));
}

export async function dbAll(db, store){
  return txOp(db, store, 'readonly', s => s.getAll());
}

export async function dbListByProject(db, projectId){
  return new Promise((resolve, reject) => {
    const t = tx(db, 'files', 'readonly');
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

export async function dbMetaSet(db, key, value){
  return dbPut(db, 'meta', { key, value });
}

// --- Test hooks (window-exposed for runner.html) ---
window.__db_openTestDb = (name) => openDb(name, 1);
window.__db_put = dbPut;
window.__db_get = dbGet;
window.__db_listByProject = dbListByProject;
```

- [ ] **Step 4: Wire `js/db.js` into the page**

`js/main.js` doesn't need it yet (Task 4 will use it). For tests to find `__db_*` on the iframe window, `db.js` must be loaded as a side-effect import in `main.js`:

```javascript
// in js/main.js, near the other imports:
import './db.js';
```

The side-effect import causes the test hooks to attach.

- [ ] **Step 5: Run runner. Expected: 23 prior + 3 new = 26 passed, 0 failed.**

- [ ] **Step 6: Commit**

```bash
git add js/db.js js/main.js test/runner.html
git commit -m "feat(p2): add js/db.js IndexedDB wrapper with three-store schema v1"
```

---

## Task 2: `js/projects.js` — active project + CRUD + autosave

**Files:**
- Create: `js/projects.js`
- Modify: `test/runner.html` (add tests)

- [ ] **Step 1: Write failing tests**

```javascript
test('projects: bootProjects creates Untitled if none', async () => {
  // Use a unique DB name and pass it via global override
  const tname = 'jsonlviewer-t-' + Date.now();
  fwin().__projects_setDbName(tname);
  const active = await fwin().__projects_boot();
  assert(active);
  assertEq(active.name, 'Untitled');
  // teardown
  await new Promise(res => { indexedDB.deleteDatabase(tname).onsuccess = res; });
});

test('projects: flushFile persists then loadActiveProject restores', async () => {
  const tname = 'jsonlviewer-t-' + Date.now();
  fwin().__projects_setDbName(tname);
  const proj = await fwin().__projects_boot();
  await fwin().__projects_flushFile({
    id: 'f1', projectId: proj.id, name: 'a.jsonl', folder: '',
    ext: 'jsonl', sizeBytes: 5, sessionOnly: false, content: '{"a":1}\n',
    updatedAt: 1
  });
  const files = await fwin().__projects_loadActiveProjectFiles();
  assertEq(files.length, 1);
  assertEq(files[0].name, 'a.jsonl');
  assertEq(files[0].content, '{"a":1}\n');
  await new Promise(res => { indexedDB.deleteDatabase(tname).onsuccess = res; });
});
```

- [ ] **Step 2: Run runner. RED on 2 new tests.**

- [ ] **Step 3: Implement `js/projects.js`**

```javascript
// js/projects.js
import { dbOpen, dbGet, dbPut, dbDelete, dbListByProject, dbMetaGet, dbMetaSet, dbDeleteByProject } from './db.js';

let _db = null;
let _active = null;
let _dbNameOverride = null;
const _flushTimers = new Map(); // fileId -> timeout id
const FLUSH_DEBOUNCE_MS = 500;

function newId(){
  return 'p_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

async function ensureDb(){
  if (_db) return _db;
  _db = _dbNameOverride
    ? await (await import('./db.js')).dbOpen.call(null, _dbNameOverride)
    : await dbOpen();
  return _db;
}

export async function bootProjects(){
  const db = await ensureDb();
  let activeId = await dbMetaGet(db, 'activeProjectId');
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
  // Order by fileIds so user-defined order is preserved.
  const order = new Map(_active.fileIds.map((id, i) => [id, i]));
  files.sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
  return files;
}

export async function flushFile(fileRow){
  const db = await ensureDb();
  await dbPut(db, 'files', { ...fileRow, updatedAt: Date.now() });
  // Ensure project.fileIds contains it.
  if (!_active.fileIds.includes(fileRow.id)){
    _active.fileIds.push(fileRow.id);
    _active.updatedAt = Date.now();
    await dbPut(db, 'projects', _active);
  }
}

export async function deleteFile(fileId){
  const db = await ensureDb();
  await dbDelete(db, 'files', fileId);
  _active.fileIds = _active.fileIds.filter(id => id !== fileId);
  _active.updatedAt = Date.now();
  await dbPut(db, 'projects', _active);
}

export async function flushFileDebounced(fileRow){
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

// --- Test hooks ---
window.__projects_setDbName = (name) => { _dbNameOverride = name; _db = null; _active = null; };
window.__projects_boot = bootProjects;
window.__projects_flushFile = flushFile;
window.__projects_loadActiveProjectFiles = loadActiveProjectFiles;
```

(Note: the dynamic re-import in `ensureDb` is just to avoid making `dbOpen` accept a name param — actually simpler to extend `dbOpen`. Adjust `db.js` to `export async function dbOpen(name = DB_NAME)`.)

- [ ] **Step 4: Add `db.js` flexibility** — change `dbOpen` to accept an optional name:

```javascript
export async function dbOpen(name){ return openDb(name); }
```

Then `ensureDb` in projects.js becomes:
```javascript
async function ensureDb(){
  if (_db) return _db;
  _db = await dbOpen(_dbNameOverride || undefined);
  return _db;
}
```

- [ ] **Step 5: Wire `js/projects.js` into main.js** — side-effect import (Task 4 will properly use it):

```javascript
import './projects.js';
```

- [ ] **Step 6: Run runner. Expected: 28 passed, 0 failed.**

- [ ] **Step 7: Commit**

```bash
git add js/db.js js/projects.js js/main.js test/runner.html
git commit -m "feat(p2): add js/projects.js (boot + flush + autosave debounce)"
```

---

## Task 3: `js/sync.js` — BroadcastChannel pub/sub

**Files:**
- Create: `js/sync.js`
- Modify: `test/runner.html` (add tests)

- [ ] **Step 1: Write failing tests**

```javascript
test('sync: own messages are filtered out', async () => {
  const events = [];
  fwin().__sync_subscribe(msg => events.push(msg));
  fwin().__sync_publish({type: 'test', value: 42});
  await sleep(50);
  assertEq(events.length, 0);  // Own message filtered
});

test('sync: remote messages are delivered', async () => {
  const events = [];
  fwin().__sync_subscribe(msg => events.push(msg));
  // Simulate a remote message by posting via a fresh BroadcastChannel
  const remote = new BroadcastChannel('jsonlviewer-sync');
  remote.postMessage({type: 'test', value: 99, senderId: 'OTHER_TAB'});
  await sleep(50);
  assertEq(events.length, 1);
  assertEq(events[0].value, 99);
  remote.close();
});
```

- [ ] **Step 2: Run runner. RED on 2 new tests.**

- [ ] **Step 3: Implement `js/sync.js`**

```javascript
// js/sync.js
const CHANNEL = 'jsonlviewer-sync';
const senderId = 's_' + Math.random().toString(36).slice(2);
const subs = [];
let bc = null;

function ensureChannel(){
  if (bc) return bc;
  bc = new BroadcastChannel(CHANNEL);
  bc.addEventListener('message', e => {
    const msg = e.data;
    if (!msg || msg.senderId === senderId) return;
    for (const fn of subs) try { fn(msg); } catch {}
  });
  return bc;
}

export function publish(msg){
  ensureChannel();
  bc.postMessage({ ...msg, senderId });
}

export function subscribe(fn){
  ensureChannel();
  subs.push(fn);
  return () => {
    const i = subs.indexOf(fn);
    if (i >= 0) subs.splice(i, 1);
  };
}

export function getSenderId(){ return senderId; }

// --- Test hooks ---
window.__sync_publish = publish;
window.__sync_subscribe = subscribe;
window.__sync_senderId = () => senderId;
```

- [ ] **Step 4: Side-effect import in main.js**

```javascript
import './sync.js';
```

- [ ] **Step 5: Run runner. Expected: 30 passed, 0 failed.**

- [ ] **Step 6: Commit**

```bash
git add js/sync.js js/main.js test/runner.html
git commit -m "feat(p2): add js/sync.js BroadcastChannel pub/sub"
```

---

## Task 4: Bootstrap — restore active project on load

**Files:**
- Modify: `js/main.js`, `js/files.js`

- [ ] **Step 1: Add a `restoreFromCache()` helper in `js/files.js`**

```javascript
// in js/files.js, near the top of the exported helpers:
import { loadActiveProjectFiles } from './projects.js';

export async function restoreFromCache(){
  const cached = await loadActiveProjectFiles();
  for (const row of cached){
    if (row.sessionOnly || !row.content) continue;
    // Replay loadFile path with a synthetic File object built from content.
    const blob = new Blob([row.content], { type: row.ext === 'jsonl' ? 'application/jsonl' : 'application/json' });
    const file = new File([blob], row.name, { type: blob.type });
    await loadFile(file, { folder: row.folder, suppressFlush: true, persistedId: row.id });
  }
}
```

`loadFile` needs two new options: `suppressFlush` (don't re-write to IDB while restoring; we already have it in IDB) and `persistedId` (use this id instead of generating a new one). Add both options to the `loadFile` signature and propagate `suppressFlush` to a module-scoped flag that `flushStructural` consults.

- [ ] **Step 2: Modify `loadFile` to accept the new opts**

In existing `loadFile`:
```javascript
export async function loadFile(file, opts={}){
  const folder = opts.folder || '';
  snapshotCurrent();
  await _parseFileIntoState(file, folder);
  const id = opts.persistedId || newFileId();
  const slot = {id, folder, snapshot:null};
  state.files.push(slot);
  state.activeId = id;
  snapshotCurrent();
  analyzeSchema();
  renderSidebar();
  renderView();
  renderFileTree();
  $drop.classList.add('compact');
  // ... existing drop-area DOM update ...

  // NEW: persist to IDB unless suppressed (suppressFlush is true during cache restore).
  if (!opts.suppressFlush){
    const text = await file.text();
    await flushFile({
      id,
      projectId: getActiveProject().id,
      name: file.name,
      folder,
      ext: file.name.toLowerCase().endsWith('.jsonl') ? 'jsonl' : 'json',
      sizeBytes: file.size,
      sessionOnly: false,
      content: text,
      updatedAt: Date.now()
    });
  }
}
```

`flushFile` and `getActiveProject` are imported from `./projects.js`.

- [ ] **Step 3: Modify `js/main.js` to await `bootProjects()` then call `restoreFromCache()` before initial render**

The current init block:
```javascript
/* Init */
initTheme();
updateStats();
renderSidebar();
renderFileTree();
updateDirtyBadge();
```

Replace with:
```javascript
/* Init */
initTheme();
(async () => {
  await bootProjects();
  await restoreFromCache();
  updateStats();
  renderSidebar();
  renderFileTree();
  updateDirtyBadge();
})();
```

`bootProjects` and `restoreFromCache` are imported.

- [ ] **Step 4: Write a manual smoke test (skipped in browser harness)**

The full restore loop is hard to assert in the runner because it needs a DB-state setup outside the iframe, then a reload. Write a test that:
1. Boots projects in test DB.
2. Calls `flushFile(...)` for two synthetic file rows.
3. Reloads iframe with a query param indicating "use this test DB".
4. Asserts that after iframe load, `state.files` has length 2 and the file tree DOM has two rows.

This is complex. **For P2, defer the end-to-end restore test** and rely on manual smoke instead. Add a small comment in `test/runner.html` documenting the manual test. Add an automated test that calls `restoreFromCache()` directly with a stubbed `loadFile` to verify it iterates the cached rows.

```javascript
test('restoreFromCache: iterates cached rows and calls loadFile for each', async () => {
  const tname = 'jsonlviewer-t-' + Date.now();
  fwin().__projects_setDbName(tname);
  await fwin().__projects_boot();
  const proj = fwin().__projects_active();
  await fwin().__projects_flushFile({
    id:'r1', projectId: proj.id, name:'a.jsonl', folder:'',
    ext:'jsonl', sizeBytes:5, sessionOnly:false, content:'{"a":1}\n',
    updatedAt: Date.now()
  });
  const calls = [];
  fwin().__files_setLoadFileStub((file, opts) => calls.push({name: file.name, opts}));
  await fwin().__files_restoreFromCache();
  assertEq(calls.length, 1);
  assertEq(calls[0].name, 'a.jsonl');
  assertEq(calls[0].opts.persistedId, 'r1');
  fwin().__files_clearLoadFileStub();
  await new Promise(res => { indexedDB.deleteDatabase(tname).onsuccess = res; });
});
```

This requires `js/files.js` to expose:
```javascript
let _loadFileImpl = null;
export function __setLoadFileStub(fn){ _loadFileImpl = fn; }
export function __clearLoadFileStub(){ _loadFileImpl = null; }

// In restoreFromCache, if _loadFileImpl is set, call it instead of loadFile.

window.__files_setLoadFileStub = __setLoadFileStub;
window.__files_clearLoadFileStub = __clearLoadFileStub;
window.__files_restoreFromCache = restoreFromCache;
```

And `projects.js`:
```javascript
window.__projects_active = getActiveProject;
```

- [ ] **Step 5: Run runner. Expected: 31 passed, 0 failed (30 + 1 new).**

- [ ] **Step 6: Manual smoke test**

1. Open `http://localhost:8765/.worktrees/p2-idb-persistence/`.
2. Drag `sample/sample-data.json`. Confirm 3 cards appear.
3. Reload the page (Ctrl+R).
4. **Expected:** the same 3 cards appear without re-dragging.
5. (If you want to reset state for the next iteration: open DevTools → Application → IndexedDB → delete `jsonlviewer`.)

Document the reset path in the plan-execution-log if needed.

- [ ] **Step 7: Commit**

```bash
git add js/files.js js/main.js js/projects.js test/runner.html
git commit -m "feat(p2): bootstrap restoreFromCache on load + flush on file add"
```

---

## Task 5: Edit hook — debounced flush on dirty

**Files:**
- Modify: `js/view-edit.js`, `js/files.js`, `js/projects.js`

- [ ] **Step 1: Add a helper in `js/files.js` to serialize the active file row**

```javascript
// in js/files.js
import { flushFileDebounced } from './projects.js';

export function getActiveFileRow(){
  const slot = state.files.find(s => s.id === state.activeId);
  if (!slot) return null;
  // Live items, excluding deleted, serialized back to text in the original shape.
  const liveItemsArr = state.items.filter(it => !it.deleted);
  let text;
  if (state.sourceShape === 'jsonl'){
    text = liveItemsArr.map(it => exportRawFor(it)).filter(Boolean).join('\n') + '\n';
  } else {
    text = JSON.stringify(liveItemsArr.map(it => it.parsed), null, 2);
  }
  const ext = (state.fileName || '').toLowerCase().endsWith('.jsonl') ? 'jsonl' : 'json';
  return {
    id: slot.id,
    projectId: getActiveProject().id,
    name: state.fileName || 'untitled',
    folder: slot.folder || '',
    ext,
    sizeBytes: text.length,
    sessionOnly: false,
    content: text,
    updatedAt: Date.now()
  };
}

export async function persistActiveFile(){
  const row = getActiveFileRow();
  if (row) await flushFileDebounced(row);
}
```

- [ ] **Step 2: Hook persistActiveFile into markDirty path**

In `js/view-edit.js`, the `markDirty(item)` function — after the existing body, add a call to `persistActiveFile()`:

```javascript
// in view-edit.js
import { persistActiveFile } from './files.js';

export function markDirty(item){
  // existing body...
  persistActiveFile();
}
```

(`markDirty` is called by every edit path; this single hook covers them all.)

- [ ] **Step 3: Write a test**

```javascript
test('edit: persistActiveFile is called after markDirty', async () => {
  const tname = 'jsonlviewer-t-' + Date.now();
  fwin().__projects_setDbName(tname);
  await fwin().__projects_boot();
  // Set up minimal state: one file with one item
  fwin().state.fileName = 'a.jsonl';
  fwin().state.sourceShape = 'jsonl';
  fwin().state.files = [{id: 't1', folder: '', snapshot: null}];
  fwin().state.activeId = 't1';
  fwin().state.items = [{origIdx:0, parsed:{a:1}, dirty:false, deleted:false, _raw: '{"a":1}'}];
  // Mark dirty
  fwin().markDirty(fwin().state.items[0]);
  await sleep(700); // > debounce window
  const files = await fwin().__projects_loadActiveProjectFiles();
  assertEq(files.length, 1);
  assert(files[0].content.includes('"a":1'));
  await new Promise(res => { indexedDB.deleteDatabase(tname).onsuccess = res; });
});
```

- [ ] **Step 4: Run runner. Expected: 32 passed, 0 failed.**

- [ ] **Step 5: Commit**

```bash
git add js/files.js js/view-edit.js js/projects.js test/runner.html
git commit -m "feat(p2): persist active-file content after each edit (debounced)"
```

---

## Task 6: Multi-tab sync — BroadcastChannel wired to file changes

**Files:**
- Modify: `js/projects.js`, `js/files.js`, `js/main.js`

- [ ] **Step 1: Publish on every flush in `projects.js`**

```javascript
// in projects.js, after the actual put in flushFile:
import { publish } from './sync.js';

// Inside flushFile, after dbPut and project-row update:
publish({ type: 'file-changed', fileId: fileRow.id, projectId: _active.id });
```

- [ ] **Step 2: Subscribe in main.js**

```javascript
// in main.js
import { subscribe } from './sync.js';
import { dbGet, dbOpen as _dbOpen } from './db.js';

subscribe(async (msg) => {
  if (msg.type !== 'file-changed') return;
  if (!getActiveProject() || msg.projectId !== getActiveProject().id) return;
  // Reload that single file from IDB and re-render.
  const db = await _dbOpen();
  const row = await dbGet(db, 'files', msg.fileId);
  if (!row) return;
  // Replace in state if loaded; otherwise just refresh tree.
  // For v1: simply trigger a full restore. (Cheap; correctness-first.)
  await restoreFromCache();
  renderView();
  renderSidebar();
});
```

- [ ] **Step 3: Test**

```javascript
test('sync: remote file-changed triggers reload of single file', async () => {
  // This is hard to assert in a single-tab harness. Stub `restoreFromCache`
  // and verify it gets called on remote 'file-changed' for the active project.
  let called = 0;
  fwin().__files_setRestoreStub(() => { called++; });
  const remote = new BroadcastChannel('jsonlviewer-sync');
  remote.postMessage({
    type: 'file-changed',
    fileId: 'whatever',
    projectId: fwin().__projects_active().id,
    senderId: 'OTHER_TAB'
  });
  await sleep(80);
  assertEq(called, 1);
  remote.close();
  fwin().__files_clearRestoreStub();
});
```

This requires `__files_setRestoreStub`/`__files_clearRestoreStub` on `files.js`, similar pattern to Task 4.

- [ ] **Step 4: Run runner. Expected: 33 passed, 0 failed.**

- [ ] **Step 5: Commit**

```bash
git add js/projects.js js/files.js js/main.js test/runner.html
git commit -m "feat(p2): publish file changes + reload on remote sync"
```

---

## Task 7: File close persistence

**Files:**
- Modify: `js/files.js`

- [ ] **Step 1: Hook delete into projects**

Inside `closeFile(id)` in `files.js`, after the existing body, call:
```javascript
import { deleteFile as _projectsDeleteFile } from './projects.js';

// Inside closeFile, after the slot is removed from state.files:
await _projectsDeleteFile(id);
```

- [ ] **Step 2: Test**

```javascript
test('close: removes file row + project.fileIds entry', async () => {
  const tname = 'jsonlviewer-t-' + Date.now();
  fwin().__projects_setDbName(tname);
  await fwin().__projects_boot();
  const proj = fwin().__projects_active();
  await fwin().__projects_flushFile({id:'c1', projectId:proj.id, name:'x.json', folder:'', ext:'json', sizeBytes:1, sessionOnly:false, content:'{}', updatedAt:1});
  await fwin().__projects_deleteFile('c1');
  const files = await fwin().__projects_loadActiveProjectFiles();
  assertEq(files.length, 0);
  await new Promise(res => { indexedDB.deleteDatabase(tname).onsuccess = res; });
});
```

(Expose `__projects_deleteFile` on window via the same pattern.)

- [ ] **Step 3: Run runner. Expected: 34 passed, 0 failed.**

- [ ] **Step 4: Commit**

```bash
git add js/files.js js/projects.js test/runner.html
git commit -m "feat(p2): persist file close (delete row + update project)"
```

---

## Task 8: Final verification

- [ ] **Step 1: All-tests pass**

Run the runner. Expected: `34 passed · 0 failed`.

- [ ] **Step 2: Manual smoke**

1. Open the app, drag `sample/sample-data.json`. Reload. → 3 cards appear (restored).
2. Edit a value. Reload. → edit persists.
3. Open DevTools → Application → IndexedDB → confirm `jsonlviewer` database with 3 stores has 1 project + 1 file row.
4. Open the page in a second tab. Edit in tab 1. → tab 2 reflects the change within ~1s (sync).
5. Close the file (× in file tree). Reload. → file gone. Project remains.
6. Clear IDB → reload → fresh "Untitled" project, empty drop zone.

- [ ] **Step 3: Tag and merge**

```bash
git tag p2-done
git checkout main
git merge --ff-only p2-idb-persistence
git worktree remove .worktrees/p2-idb-persistence
git branch -d p2-idb-persistence
```

---

## Risk log

| Risk | Mitigation |
|---|---|
| `markDirty` is on a hot path; calling `persistActiveFile()` synchronously could janky-ify edits. | `flushFileDebounced` handles the debounce (500ms); the synchronous part is just queueing a setTimeout. Fast. |
| Round-tripping JSON through `JSON.stringify` may not preserve exact whitespace of original file. | Acceptable for v1 — user's edit path already mutates the parsed tree, not raw text. The `_raw` field on items is preserved per-item; full-file content is regenerated. If needed, store the raw source text alongside and only regenerate on edit. |
| `restoreFromCache` opens files via synthetic `File` objects — extension detection and webkitRelativePath behave correctly because we set them explicitly. | The synthesis uses `File` constructor with the original name; `loadFile` reads `file.name` and `webkitRelativePath` (latter is empty, that's fine — we override `folder` via `opts.folder`). |
| Two tabs writing the same file race the debounce. | Documented as "last-writer-wins per file" (per spec Q8 decision). For v1 acceptable. |
| `persistActiveFile` runs on every edit; large files slow IDB writes. | Big-file flow comes in P6. For v1, accept the cost — typical JSONL is < 50MB and IDB writes are async. |
| `loadFile` was extracted in P1 with a specific signature; adding `opts.persistedId`/`opts.suppressFlush` widens it. | Self-contained additions; existing call sites use defaults. |

---

## Self-Review Checklist

After Task 8 passes:

1. **Spec coverage:** P2 covers the spec sections "Data model", "Lifecycle (boot, add, edit, close)", "Multi-tab sync (basic)". UI sections (panels, palette, status bar) are deferred to P3+ — confirmed in Out-of-scope.
2. **Placeholder scan:** Each task has actual code blocks for new modules. The few `(paste body verbatim)` notes from P1 are intentional pointers — irrelevant here since P2 mostly creates new code.
3. **Type/name consistency:**
   - `flushFile` / `flushFileDebounced` / `flushFileImmediate` / `deleteFile` — consistent in projects.js export list and consumer call sites.
   - `restoreFromCache` / `persistActiveFile` / `getActiveFileRow` — consistent across files.js definitions and main.js/view-edit.js consumers.
   - `bootProjects` — same name everywhere.
4. **Cycle hazards:** `files.js` imports from `projects.js`; `projects.js` imports from `db.js` and `sync.js`; `main.js` imports from all of these. No cycle.
5. **Test coverage:** 11 new tests across db (3), projects (2), sync (2), restore (1), edit-persist (1), remote-sync (1), close (1) = 11. Plus 23 P1 tests = 34 expected total.

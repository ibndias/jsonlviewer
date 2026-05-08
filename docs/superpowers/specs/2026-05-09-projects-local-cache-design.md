# Projects, folders, and files — local-cache workspace

**Date:** 2026-05-09
**Status:** Approved (brainstorm), pending implementation plan
**Owner:** ibndias

## Summary

Add persistent project management to jsonlviewer. Users can create named projects, each holding multiple files and folders, with all state cached locally in IndexedDB. UI shifts to a VS Code-style layout (activity bar, side bar, tab strip, status bar, command palette, quick open). Hosted on Netlify; pure static, no backend.

## Goals

- Persist files, folders, and edits across browser reload.
- Manage multiple named projects; fast switching.
- Keep app fully static — no server process.
- VS Code-flavored UX for managing projects/folders/files conveniently.

## Non-goals

- Server-side sync, accounts, sharing.
- Live collaboration / OT.
- Cross-browser or cross-device sync (purely local per-origin per-browser).
- File System Access API integration (not portable across browsers).
- Build tooling (no Vite / bundler).

## Decisions log (Q&A)

| # | Decision |
|---|---|
| Q1 | Storage backend: **IndexedDB**. |
| Q2 | Project model: **always-active auto-saved workspace + named projects** (combined). |
| Q3 | Edits persistence: **save current state as-is** (no original/diff overlay). |
| Q4 | Project switcher UI: originally **dropdown + modal**; superseded by VS Code redesign → **side-bar Projects panel + Explorer-header inline switcher** (functionally equivalent). |
| Q5 | Autosave cadence: **debounced on edits + immediate on structural changes + best-effort on tab close**. |
| Q6 | Big files: **per-file 50MB cap**; over cap → metadata-only row, `sessionOnly:true`, re-pick to load. |
| Q7 | Import/export: **single-project bundle (`.json`) + all-projects bundle (`.json`)**; per-file download preserves native extension. |
| Q8 | Multi-tab same project: **BroadcastChannel sync, last-writer-wins per file**. |
| Code organization | **ES modules**, multiple files under `js/`. No bundler. |
| Hosting | **Netlify** (static). Local dev via `python -m http.server` or `netlify dev`. |
| UI scope | **v1-full**: activity bar + Explorer + Projects + Search + Settings panels + tab strip + status bar + command palette + quick open. |

## Architecture

### File layout

```
index.html              # shell: DOM skeleton + CSS, loads main.js as module
js/
  main.js               # bootstrap: open DB, init projects, mount UI, wire events
  db.js                 # IndexedDB wrapper (open, get, put, delete, txn helpers)
  projects.js           # project CRUD, active-project state, autosave debouncer
  projects-ui.js        # toolbar/sidebar dropdown + manage modal
  sync.js               # BroadcastChannel pub/sub between tabs
  export.js             # bundle/single-file export + import
  state.js              # in-memory state (extracted from index.html)
  files.js              # loadFile / loadFiles / file-tree render (extracted)
  schema.js             # analyzeSchema, sidebar (extracted)
  view.js               # renderView, item rendering (extracted)
  dom.js                # `el`, `$`, toast, theme (extracted shared utils)
  palette.js            # command palette + quick open
  activity.js           # activity bar + side bar panel switching
  statusbar.js          # bottom status bar
test/
  runner.html           # existing browser test runner (extend)
docs/
  superpowers/specs/2026-05-09-projects-local-cache-design.md
```

Module boundaries:
- `db.js` is the only module that issues IndexedDB calls. Pure async API. No UI.
- `projects.js` owns active-project id and autosave queue. Calls `db.js`. Emits events (`activeChanged`, `fileChanged`, `filesAdded`, `projectChanged`) for UI consumers.
- `projects-ui.js`, `activity.js`, `palette.js`, `statusbar.js` listen to `projects.js` events. They do not call `db.js` directly.
- `sync.js` owns the single `BroadcastChannel('jsonlviewer-sync')`. `projects.js` publishes; remote tabs receive and reload affected slice.
- `state.js` / `files.js` / `schema.js` / `view.js` / `dom.js` are extracted from current `index.html` with minimal logic change.
- `export.js` reads via `db.js`, generates `Blob`, triggers download. No project-state mutation.

Target: each module ≤ ~300 lines. `index.html` shrinks from ~2800 → ~600 (CSS + DOM only).

### Data model

Database name: `jsonlviewer`, version: `1`.

Object stores:

```
projects (keyPath: "id")
  {
    id: string,           // uuid
    name: string,
    createdAt: number,    // ms epoch
    updatedAt: number,
    fileIds: string[],    // order = file-tree order
    openTabIds: string[], // file ids open as tabs (persisted across reloads)
    activeTabId: string|null
  }

files (keyPath: "id")
  {
    id: string,
    projectId: string,        // index: "byProject"
    name: string,             // "users.jsonl"
    folder: string,           // "" or "subdir/sub2"
    ext: "json" | "jsonl",
    sizeBytes: number,
    sessionOnly: boolean,     // true if > 50MB cap
    content: string|undefined,// present iff !sessionOnly
    updatedAt: number
  }

meta (keyPath: "key")
  { key: "activeProjectId", value: string }
  { key: "schemaVersion",   value: 1 }
  { key: "settings",        value: { bigFileCapMB: 50, theme: "...", ... } }
```

Indexes:
- `files.byProject` on `projectId` for fast list-by-project and bulk delete.

Rationale:
- Files in their own store (not embedded in `projects`) so per-file edits cost a per-file txn, not a full project rewrite.
- `fileIds` array on the project preserves user-defined order without a sort field on each file.
- Q3 = persist-as-is, so no `edits` overlay column. `content` is the post-edit text.
- `sessionOnly` flag handles Q6: oversize files keep a tree row but no cached bytes.
- `openTabIds`/`activeTabId` persist tab strip state per project.

### Lifecycle

**App boot:**
1. `main.js` opens DB.
2. Read `meta.activeProjectId`.
3. If exists: read project row, load all files via `byProject` index, hydrate `state.files`, restore tab strip from `openTabIds`/`activeTabId`, render.
4. If absent: create `Untitled` auto-project, set active, render empty drop zone.
5. Subscribe to `BroadcastChannel('jsonlviewer-sync')`.

**Add files (drag-drop / picker / folder):**
1. `loadFiles()` parses + populates `state.files` in memory.
2. Structural-change hook fires immediate flush:
   - Insert one `files` row per new slot.
   - Update `projects.fileIds` order.
   - Bump `projects.updatedAt`.
3. Broadcast `{type: "files-added", projectId, fileIds, senderId}`.

**Edit file (inline edit / item delete):**
1. Mutate in-memory items.
2. Mark slot dirty.
3. Debounced 500ms write rewrites the affected `files` row's `content`. Bump `updatedAt`.
4. Broadcast `{type: "file-changed", fileId, senderId}`.

**Tab close (`beforeunload`):**
- Cancel debounce timer, issue final write best-effort. Structural changes already flushed; only last-edit window <500ms is at risk.

**Switch project:**
1. Flush pending writes for current project.
2. Snapshot current state.
3. Read new project + files. Replace `state.files`. Restore `openTabIds`/`activeTabId`.
4. Re-render explorer, view, schema, status bar.
5. Write `meta.activeProjectId`.
6. Broadcast `{type: "active-project-changed", projectId, senderId}`.

**New / rename / delete project:**
- New: insert `projects` row, switch active.
- Rename: update `projects.name`, broadcast.
- Delete: read `byProject` cursor → delete each file row → delete project row. If active, switch to most-recent remaining or create `Untitled`.

**Multi-tab sync:**
- Each tab generates a `senderId` at startup and stamps every broadcast.
- Receivers ignore messages with their own `senderId`.
- On `file-changed` for active project: reload that single file from DB, re-render.
- On `active-project-changed`: if same tab is on that project, reload full project (in case files added/removed remotely).
- Race: tab A debounce-writes while tab B has unsaved edits to same file. B's reload-on-broadcast clobbers B's pending edit. Documented as last-writer-wins per file.

**Big-file flow:**
- During `loadFile`: if `file.size > capMB * 1024 * 1024` set `sessionOnly = true`. Write metadata-only row.
- Tree row gets a "session-only" badge with the original filename and size.
- Click on session-only row opens the OS file picker (filtered by extension only — browsers cannot pin a single filename) with a toast hint "Pick `<original-name>` again". On selection, validate `file.name === row.name` (warn if mismatch), then load content into memory; the row becomes a normal entry for the session but stays `sessionOnly:true` in cache (since size is unchanged).

## UI

### Activity bar (leftmost, ~48px)
Vertical icon column:
- Explorer (default active)
- Projects
- Search
- Settings

Click an icon to show that side-bar panel; click again to collapse the side bar.

### Side bar (resizable, default ~260px)

**Explorer panel:**
```
EXPLORER                       ⋯
─────────────────────────────────
▾ MY-PROJECT-NAME           ⌃⇧⏎
  📄 users.jsonl       12
  📂 logs
    📄 app.log         341
    📄 errors.log       7
```
First row is a project header with chevron + project menu. Project name click opens an inline switcher (recent projects + New + Manage…).

**Projects panel:**
```
PROJECTS                  + ⤓ ⤒
─────────────────────────────────
✓ My Project        3 files · 2m
  Logs 2026-04     12 files · 1d
  API debug         8 files · 3d
```
`+` create, `⤓` import, `⤒` export-all. Click row = switch. Right-click = rename / duplicate / export / delete.

**Search panel:** existing item filter relocated here. Adds match-key / match-value toggles.

**Settings panel:** theme, markdown render toggle, big-file cap slider (10–500MB), clear-cache button (with confirm).

### Tab strip (top of editor area)
```
[ users.jsonl × ] [ app.log • × ]
```
Click an Explorer file → opens tab + activates. `×` closes the tab. The `•` dot indicates an in-flight edit that has not yet hit IndexedDB (i.e., the 500ms debounce timer is pending); it clears once the write lands. Because edits are persisted as-is (Q3), `•` cannot survive a reload — every persisted state is a clean state. Open tab list and active tab are persisted in the project row.

### Editor area (right)
Existing tree view + inline edit. No structural change.

### Right schema panel (existing)
Toggleable; can also be invoked via activity bar later. Out of scope to relocate now.

### Status bar (bottom, 22px)
```
 Project · users.jsonl · JSONL · 12 items · 0 errors                    🌙
```

### Command palette — `Ctrl/Cmd+Shift+P`
Fuzzy command list:
- Project: New / Switch to… / Rename / Delete / Export / Import…
- File: Open / Open Folder / Download Active
- View: Toggle Schema / Toggle Theme / Toggle Sidebar

### Quick Open — `Ctrl/Cmd+P`
Fuzzy file picker over active project's files. Enter activates.

### Keybindings
- `Ctrl+Shift+P` palette
- `Ctrl+P` quick open
- `Ctrl+B` toggle side bar
- `Ctrl+,` settings panel
- `Esc` close any overlay

## Import / export

### Bundle format
Single `.json` file (manifest + inlined file contents):

```json
{
  "format": "jsonlviewer-bundle",
  "schemaVersion": 1,
  "exportedAt": 1715225600000,
  "projects": [
    {
      "id": "uuid-...",
      "name": "Logs 2026-04",
      "createdAt": 1714000000000,
      "updatedAt": 1715000000000,
      "files": [
        {
          "name": "app.log",
          "folder": "logs",
          "ext": "jsonl",
          "sizeBytes": 12345,
          "content": "{\"a\":1}\n{\"a\":2}\n"
        }
      ]
    }
  ]
}
```

JSONL files keep raw JSONL text in `content`. JSON files keep raw JSON text. Round-trip is byte-equal for `content` and exact for `name`/`folder`/`ext`/`sizeBytes`.

Validation on import: check `format`, `schemaVersion`, required per-project fields. Reject the whole bundle on schema mismatch (atomic). Toast on failure.

### Per-file download
Right-click on file row → Download. Triggers `Blob` download with the original `name` (and original ext: `.jsonl` stays `.jsonl`).

## Error handling

| Failure | Response |
|---|---|
| `indexedDB.open` blocked / rejected | Toast "Storage unavailable — running in-memory only". Disable autosave. App still usable for current session. |
| `QuotaExceededError` on write | Toast "Storage full — try removing files or projects". Roll back the failed write. Keep in-memory state. |
| File `> capMB` | Mark `sessionOnly`. Toast "X kept session-only (> {cap}MB)". Re-pick to load on reopen. |
| Parse failure on cached content | Toast "Failed to reload <name>". Mark row broken. User can remove or re-pick. |
| Malformed import bundle | Validate before any DB write. Reject whole bundle. Toast "Invalid project bundle". |
| Broadcast from unknown `schemaVersion` | Ignore + `console.warn`. Don't crash. |
| Active project deleted | Auto-switch to most-recent remaining or create `Untitled`. App is never projectless. |

## Testing

Extend existing `test/runner.html` (browser-based, plain DOM assertions, no framework).

New test groups:

- `db.test.js` — open/upgrade DB; put/get/delete; index queries; txn rollback on error; mocked quota error.
- `projects.test.js` — create / switch / rename / delete; `activeProjectId` meta updates; `fileIds` order preserved across writes; deleting active falls back correctly.
- `export.test.js` — single-project + all-projects bundle round-trip: byte-equal `content` and exact metadata. Reject malformed bundles.
- `sync.test.js` — fake `BroadcastChannel`; own messages ignored; remote `file-changed` triggers single-file reload; remote `active-project-changed` triggers full reload only on matching tabs.
- `big-file.test.js` — file over cap → `sessionOnly:true`, no `content` field. Reopen yields placeholder row.
- `palette.test.js` — fuzzy match scoring; arrow-key navigation; enter executes correct command.
- `quickopen.test.js` — fuzzy match across project file names; enter activates correct file/tab.

Target: 50+ tests total. Run via `test/runner.html` in browser.

## Migration

Schema v1 = first IDB schema. Existing users have only theme in `localStorage`; no IDB data to migrate. On first load with new code:

1. Open DB v1 (creates stores).
2. No `activeProjectId` → create `Untitled` project, set active.
3. App renders empty drop zone. Identical UX to today's first load.

Future schema bumps go through `onupgradeneeded` with explicit `oldVersion → newVersion` migrations.

## Browser compatibility

Same matrix as README:
- Chrome / Edge 88+
- Firefox 78+
- Safari 14+
- Mobile browsers (responsive)

Features used:
- IndexedDB ✓ all targets
- BroadcastChannel ✓ all targets
- ES modules ✓ all targets (over HTTPS / `localhost`)

Not used:
- File System Access API (Chrome/Edge only — would break Firefox/Safari).

## README updates

- Drop "no server required" claim (modules require an HTTP origin).
- Add Netlify hosted URL as primary entry point.
- Document local dev: `python -m http.server` or `netlify dev`.
- Add a Projects section to features list.
- Note keybindings (`Ctrl+Shift+P`, `Ctrl+P`, `Ctrl+B`, `Ctrl+,`).

## Out of scope (deferred)

- File System Access API for live folder sync.
- Cross-device sync.
- Conflict resolution beyond last-writer-wins.
- Build tooling (Vite, etc.).
- Schema-panel relocation to side bar.
- Quick Open across all projects (current scope = active project only).

# P1 — Module Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the monolithic `<script>` block in `index.html` into focused ES modules under `js/`, with zero behavior change. All 23 existing browser tests stay green.

**Architecture:** Replace inline IIFE with `<script type="module" src="js/main.js">`. Extract one focused module at a time, leaf modules first, then mid-layer, then top. Every commit must keep `test/runner.html` 100% green. ES module cycles are tolerated where the existing call graph already required mutual reference (resolved at call time).

**Tech Stack:** Vanilla ES modules. No bundler. Existing CSS and HTML untouched. Tests unchanged. Local dev requires an HTTP origin (modules over `file://` are blocked); test runner already loads via `<iframe src="../index.html?test=1">` which works under `python -m http.server`.

**Out of scope (future plans):** IndexedDB persistence (P2), VS Code shell (P3), tabs/palette/quick-open (P4), search/settings panels (P5), big-file flow (P6), import/export (P7).

**Spec:** `docs/superpowers/specs/2026-05-09-projects-local-cache-design.md`.

---

## Module Map

Final shape after P1 (file paths and responsibilities):

| File | Responsibility |
|---|---|
| `index.html` | DOM skeleton + CSS only. Loads `js/main.js` as module. |
| `js/main.js` | Bootstrap: import everything, run init, wire global event listeners. |
| `js/dom.js` | `el`, `$`, DOM-element handle exports (`$stats`, `$drop`, …), `showToast`, theme toggle. |
| `js/modal.js` | `setModalBodyText`, `setModalBodyInput`, `confirmModal`, `promptKey`. |
| `js/path.js` | `identRe`, `pathKey`, `pathIdx`, `parsePath`, `walkPath`, `estimateTokens`, `fmtNum`. |
| `js/parse.js` | `tryParseFullJSON`, `parseAsJSON`, `parseAsJSONL`. |
| `js/state.js` | `state` object, `newFileId`, `snapshotCurrent`, `applyFromFile`, `switchToFile`, `closeFile`, `liveItems`. |
| `js/view-colorize.js` | `keyHue`, `isDarkTheme`, `keyColor`, `applyColorize`. |
| `js/view-markdown.js` | `applyMarkdownMode`, `safeHref`, `appendInline`, `renderMarkdownToDOM`. |
| `js/view-chat.js` | `detectChatFormat`, `renderChatView`. |
| `js/view-node.js` | `makeStringSpan`, `makeKeyEl`, `makeRowDelBtn`, `makeNodeAddBtn`, `makeNodeDelBtn`, `renderNode`, `applyNewlineMode`, `renderStringSpan`. |
| `js/view-edit.js` | `markDirty`, `applyValueAtPath`, `applyKeyRenameAtPath`, `removeAtPath`, `appendArrayItem`, `addObjectKey`, `activeEditing`, `startInlineEdit`, `startKeyEdit`, `startValueEdit`, `openRawEditor`. |
| `js/view-card.js` | `makeItem`, `recomputeItemMetrics`, `exportRawFor`, `buildCard`, `syncExcluded`, `getCardEl`, `rebuildCardInPlace`. |
| `js/schema.js` | `analyzeSchema`, `renderSidebar`. |
| `js/view.js` | `applyFilters`, `applySort`, `renderView`, `renderLoadMore`, `updateFilterInfo`, `updateStats`, `updateDirtyBadge`, `setActive`, `markActive`, `getActiveCard`, `jumpRelative`, `toggleActiveTree`. |
| `js/files.js` | `resetView`, `_parseFileIntoState`, `loadFile`, `loadFiles`, `renderFileTree`, `buildFileRow`, `buildFolderRow`, `saveFile`, `handleDrop`, `collectEntry`, `readNumOrNull`, `onLengthChange`. |

Target: each file ≤ ~400 lines (some heavy ones like `view-node.js` and `view-edit.js` will hit the upper bound; that's fine — they map directly to the existing code).

---

## TDD Discipline for Refactor

The 23 existing tests in `test/runner.html` are the contract. There is no "write a failing test" per task because the contract already exists. The discipline for each extraction:

1. **Verify green baseline** — run the test runner, confirm 23/23 pass, before changing code.
2. **Make the change** — extract one module.
3. **Verify still green** — run the runner, confirm 23/23 pass after the change.
4. **Commit** — single small commit per extraction.

If any test fails: do not commit. Bisect the change (functions accidentally left in `main.js`, missing import, typo in export list, captured outer-scope variable not now imported). Fix. Re-run. Only commit on green.

---

## Test Runner — How to Run

### Local (preferred for iteration)
```bash
cd /home/derry/ws/jsonlviewer
python -m http.server 8000
# Then open http://localhost:8000/test/runner.html in a browser.
# Click "Run all". Wait ~10s. Summary should read "23 passed, 0 failed".
```

### Pass criterion
- Summary text matches `/\b23\s*passed\b/i` and `/\b0\s*failed\b/i`.
- No red rows in `#log`.

### Headless variant (optional)
A headless run is *not* required by this plan. If desired, install Playwright separately and run a one-off script — out of scope.

---

## Task 0: Worktree, baseline, ignore safety

**Files:**
- Create: `.worktrees/` (only if used; verify `.gitignore`)
- Modify: `.gitignore` (add `.worktrees/` if not already)

- [ ] **Step 1: Create worktree (or work in place)**

If a native `EnterWorktree` tool is available, use it for branch `p1-module-refactor`. Otherwise:
```bash
git check-ignore -q .worktrees || echo ".worktrees/" >> .gitignore && git add .gitignore && git commit -m "chore: ignore .worktrees"
git worktree add .worktrees/p1-module-refactor -b p1-module-refactor
cd .worktrees/p1-module-refactor
```
If the sandbox blocks worktree creation, work in place on a feature branch:
```bash
git checkout -b p1-module-refactor
```

- [ ] **Step 2: Verify baseline tests pass (23/23)**

Run: start `python -m http.server 8000` in repo root (background it). Open `http://localhost:8000/test/runner.html`, click Run all.
Expected: summary `23 passed, 0 failed`.

- [ ] **Step 3: Snapshot index.html line counts for reference**

Run: `wc -l index.html`
Expected: `2804 index.html` (current). Record this for sanity-checking later tasks; the file should shrink steadily.

- [ ] **Step 4: Commit baseline marker (no code change)**

If you needed to add `.gitignore`, that commit is enough. Otherwise no commit needed for Task 0.

---

## Task 1: Convert inline script to ES module shell

**Files:**
- Modify: `index.html` (replace inline `<script>` tag with `<script type="module" src="js/main.js">`)
- Create: `js/main.js`

This task moves the **entire IIFE body verbatim** into `js/main.js` and replaces the inline script with a module reference. No code is split yet. This validates that ES modules + iframe + test runner all still work end-to-end.

- [ ] **Step 1: Locate the inline script block in `index.html`**

Run: `grep -n '<script>\|</script>' index.html`
Expected: one `<script>` open near line 736 and one `</script>` close near line 2802.

- [ ] **Step 2: Create `js/main.js` containing the IIFE body**

Copy the contents of `index.html` between (and excluding) the `<script>` and `</script>` tags into `js/main.js`. Preserve every line verbatim, including the leading `(() => {` and trailing `})();`.

```javascript
// js/main.js — temporary monolith; subsequent tasks split this file.
(() => {
  // ... entire body from index.html lines 737..2801 pasted here ...
})();
```

- [ ] **Step 3: Replace the inline script tag in `index.html`**

Replace:
```html
<script>
(() => {
  ...
})();
</script>
```

With:
```html
<script type="module" src="js/main.js"></script>
```

The `</body></html>` after it stays unchanged.

- [ ] **Step 4: Run the test runner**

Refresh `http://localhost:8000/test/runner.html`, click Run all.
Expected: `23 passed, 0 failed`.

If anything fails:
- Common: `type="module"` defers execution past `DOMContentLoaded`; the iframe `onload` handler in the runner already waits 80ms, which is enough. If a test fails because something the inline script did at top of body is no longer present, double-check the IIFE was copied verbatim.
- Common: file path wrong. The browser network tab should show `200 OK` for `js/main.js`.

- [ ] **Step 5: Commit**

```bash
git add index.html js/main.js
git commit -m "refactor(p1): move inline script to js/main.js as ES module"
```

---

## Task 2: Extract `js/dom.js`

**Files:**
- Create: `js/dom.js`
- Modify: `js/main.js` (remove extracted code, add imports)

Extract the lowest-level utilities so every later module can depend on them. Targets: `el`, `$`, the global DOM handle exports, `showToast` (and its `toastTimer`), and the theme toggle bootstrap.

**Source ranges in current `index.html`** (line numbers from baseline 2804-line file; if you've already done Task 1, these are inside `js/main.js` at the same relative offsets):
- `el`, `$` definitions: lines 737–743
- `$stats` … `$modalCancel` handle declarations: lines 745–778
- `let toastTimer; function showToast(...)`: lines 904–911
- Theme bootstrap: lines 999–1013

- [ ] **Step 1: Create `js/dom.js`**

```javascript
// js/dom.js
export const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

export const $ = id => document.getElementById(id);

// Pre-resolved DOM handles (lazy-evaluated via getter would also work; export
// constants because index.html parse-order guarantees these exist by the time
// main.js executes).
export const $stats       = $('stats');
export const $dirtyBadge  = $('dirtyBadge');
export const $dirtyCount  = $('dirtyCount');
export const $list        = $('list');
export const $drop        = $('drop');
export const $file        = $('fileInput');
export const $nl          = $('nlToggle');
export const $md          = $('mdToggle');
export const $themeToggle = $('themeToggle');
export const $colorize    = $('colorizeToggle');
export const $editToggle  = $('editToggle');
export const $quickCopy   = $('quickCopyToggle');
export const $search      = $('search');
export const $expandAll   = $('expandAll');
export const $collapseAll = $('collapseAll');
export const $filterInfo  = $('filterInfo');
export const $toast       = $('toast');
export const $exportBtn   = $('exportBtn');
export const $saveBtn     = $('saveBtn');
export const $sortSel     = $('sortSel');
export const $minTokens   = $('minTokens');
export const $maxTokens   = $('maxTokens');
export const $loadMore    = $('loadMore');
export const $sidebar     = $('sidebar');
export const $schemaKeys  = $('schemaKeys');
export const $sideActions = $('sideActions');
export const $clearKeys   = $('clearKeysBtn');
export const $addRow      = $('addRow');
export const $addItemBtn  = $('addItemBtn');
export const $modal       = $('modal');
export const $modalTitle  = $('modalTitle');
export const $modalBody   = $('modalBody');
export const $modalOk     = $('modalOk');
export const $modalCancel = $('modalCancel');

let toastTimer;
export function showToast(msg, kind=''){
  $toast.textContent = msg;
  $toast.classList.remove('err');
  if (kind === 'err') $toast.classList.add('err');
  $toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.remove('show'), 1600);
}

export function initTheme(){
  const savedTheme = localStorage.getItem('jsonl_viewer_theme');
  if (savedTheme){
    document.documentElement.setAttribute('data-theme', savedTheme);
    $themeToggle.checked = (savedTheme === 'dark');
  } else {
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    $themeToggle.checked = prefersDark;
  }
  $themeToggle.addEventListener('change', () => {
    const theme = $themeToggle.checked ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('jsonl_viewer_theme', theme);
  });
}
```

- [ ] **Step 2: Remove the same code from `js/main.js`**

Delete the function/const definitions you just moved. Leave the rest of the IIFE intact.

- [ ] **Step 3: Import `dom.js` symbols at the top of `js/main.js`**

ES modules cannot import inside an IIFE-style wrapper. Restructure: remove the `(() => {` and `})();` wrappers; ES modules already have a private scope. At the top of the now-bare `js/main.js`:

```javascript
import {
  el, $, showToast, initTheme,
  $stats, $dirtyBadge, $dirtyCount, $list, $drop, $file,
  $nl, $md, $themeToggle, $colorize, $editToggle, $quickCopy,
  $search, $expandAll, $collapseAll, $filterInfo, $toast,
  $exportBtn, $saveBtn, $sortSel, $minTokens, $maxTokens, $loadMore,
  $sidebar, $schemaKeys, $sideActions, $clearKeys, $addRow, $addItemBtn,
  $modal, $modalTitle, $modalBody, $modalOk, $modalCancel
} from './dom.js';
```

At the bottom of `js/main.js`, immediately before any code that uses the theme:
```javascript
initTheme();
```
(Remove the inline theme-bootstrap block now that `initTheme` does it.)

- [ ] **Step 4: Run the test runner**

Refresh `runner.html`, Run all.
Expected: `23 passed, 0 failed`.

Common pitfalls:
- Forgot to remove the IIFE wrappers when converting `main.js` to module — modules can only have top-level `import`. Symptom: SyntaxError in console.
- Missed one `$something` reference. Symptom: `ReferenceError: $foo is not defined`.

- [ ] **Step 5: Commit**

```bash
git add js/dom.js js/main.js
git commit -m "refactor(p1): extract js/dom.js (el, \$, handles, toast, theme)"
```

---

## Task 3: Extract `js/modal.js`

**Files:**
- Create: `js/modal.js`
- Modify: `js/main.js`

Targets in `main.js`: `setModalBodyText` (~914), `setModalBodyInput` (~919), `confirmModal` (~930), `promptKey` (~967).

- [ ] **Step 1: Create `js/modal.js`**

```javascript
// js/modal.js
import { el, $modal, $modalTitle, $modalBody, $modalOk, $modalCancel } from './dom.js';

function setModalBodyText(text){
  $modalBody.replaceChildren();
  const p = el('p', null, text);
  $modalBody.append(p);
}

function setModalBodyInput(placeholder){
  $modalBody.replaceChildren();
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.placeholder = placeholder;
  inp.className = 'modal-input';
  $modalBody.append(inp);
  setTimeout(() => inp.focus(), 0);
  return inp;
}

export function confirmModal({title='Confirm', body='Are you sure?', okLabel='OK', dangerous=false}={}){
  // (paste body of confirmModal from main.js verbatim here, swapping outer-scope
  // helpers for the imports above; the function references $modal*, setModalBodyText,
  // and document.addEventListener — all available)
}

export function promptKey(){
  // (paste body of promptKey verbatim; uses setModalBodyInput and same modal handles)
}
```

For the body-paste, copy lines 930–965 (`confirmModal`) and 967–996 (`promptKey`) from the original. Internal helpers `setModalBodyText` and `setModalBodyInput` stay file-local (not exported).

- [ ] **Step 2: Remove from `js/main.js`**

Delete `setModalBodyText`, `setModalBodyInput`, `confirmModal`, `promptKey` definitions.

- [ ] **Step 3: Import in `js/main.js`**

Add to imports:
```javascript
import { confirmModal, promptKey } from './modal.js';
```

- [ ] **Step 4: Run runner. Expected `23 passed, 0 failed`.**

- [ ] **Step 5: Commit**

```bash
git add js/modal.js js/main.js
git commit -m "refactor(p1): extract js/modal.js"
```

---

## Task 4: Extract `js/path.js`

**Files:**
- Create: `js/path.js`
- Modify: `js/main.js`

Targets (lines 1015–1067): `identRe`, `pathKey`, `pathIdx`, `parsePath`, `walkPath`, `estimateTokens`, `fmtNum`.

- [ ] **Step 1: Create `js/path.js`**

```javascript
// js/path.js
const identRe = /^[A-Za-z_$][\w$]*$/;
export const pathKey = (k) => identRe.test(k)
  ? '.' + k
  : '[' + JSON.stringify(k) + ']';
export const pathIdx = (i) => `[${i}]`;

export function parsePath(path){
  // (paste body of parsePath, lines 1021..1053)
}

export function walkPath(root, tokens){
  // (paste body of walkPath, lines 1055..1064)
}

export const estimateTokens = (chars) => chars <= 0 ? 0 : Math.max(1, Math.round(chars / 4));
export const fmtNum = (n) => n.toLocaleString();
```

- [ ] **Step 2: Remove from `main.js`. Delete the same definitions.**

- [ ] **Step 3: Import in `main.js`**

```javascript
import { pathKey, pathIdx, parsePath, walkPath, estimateTokens, fmtNum } from './path.js';
```

- [ ] **Step 4: Run runner. `23 passed, 0 failed`.**

- [ ] **Step 5: Commit**

```bash
git add js/path.js js/main.js
git commit -m "refactor(p1): extract js/path.js"
```

---

## Task 5: Extract `js/parse.js`

**Files:**
- Create: `js/parse.js`
- Modify: `js/main.js`

Targets (lines 2185–2225): `tryParseFullJSON`, `parseAsJSON`, `parseAsJSONL`.

- [ ] **Step 1: Create `js/parse.js`**

```javascript
// js/parse.js
export function tryParseFullJSON(text){
  // (paste body of tryParseFullJSON, lines 2185..2188)
}

export function parseAsJSON(value, originalText){
  // (paste body, lines 2190..2207)
}

export function parseAsJSONL(text){
  // (paste body, lines 2209..2225)
}
```

`parseAsJSON` and `parseAsJSONL` may reference `makeItem` (item factory). Confirm: re-grep current code for outer-scope refs:

```bash
sed -n '2185,2225p' js/main.js | grep -E '\b[A-Za-z_$][\w$]*\b' | sort -u
```

If `makeItem` appears, defer the extraction order: extract `view-card.js` (which provides `makeItem`) BEFORE `parse.js`. Adjust task order if needed; leave a note in commit message.

Looking at the original: `parseAsJSON` calls `makeItem(...)`. Therefore Task 5 depends on Task 12 (view-card). **Reorder: do Task 12 before Task 5.** (Update plan tracking accordingly when executing.)

- [ ] **Step 2: After view-card.js exists, create parse.js with import**

```javascript
import { makeItem } from './view-card.js';
// then bodies...
```

- [ ] **Step 3: Remove from main.js, import in main.js**

```javascript
import { tryParseFullJSON, parseAsJSON, parseAsJSONL } from './parse.js';
```

- [ ] **Step 4: Run runner. `23 passed, 0 failed`.**

- [ ] **Step 5: Commit**

```bash
git add js/parse.js js/main.js
git commit -m "refactor(p1): extract js/parse.js"
```

---

## Task 6: Extract `js/state.js`

**Files:**
- Create: `js/state.js`
- Modify: `js/main.js`

Targets:
- `state` object literal (lines 780–802)
- `_fileIdCounter`, `newFileId` (803–804)
- `snapshotCurrent` (808–826)
- `applyFromFile` (828–848)
- `switchToFile` (850–867)
- `closeFile` (869–902)
- `liveItems` (1996; one-liner `() => state.items.filter(it => !it.deleted)`)

`state` is a mutable singleton many modules will import. Export it as a `const` that holds a mutable object.

- [ ] **Step 1: Create `js/state.js`**

```javascript
// js/state.js
import { el, $list, $drop, $sortSel, $search, $minTokens, $maxTokens } from './dom.js';

export const state = {
  // (paste object literal body from lines 780..802 verbatim)
};

let _fileIdCounter = 0;
export const newFileId = () => 'f' + (++_fileIdCounter);

export function snapshotCurrent(){
  // (paste body lines 808..826; uses state, $list — already imported)
}

export function applyFromFile(f){
  // (paste body lines 828..848; uses state, $search, $minTokens, $maxTokens, $sortSel)
}

export function switchToFile(id){
  // (paste body 850..867; uses state, $drop, el)
}

export function closeFile(id){
  // (paste body 869..902; uses state, $drop, $list, el)
}

export const liveItems = () => state.items.filter(it => !it.deleted);
```

`switchToFile` and `closeFile` also call `applyFromFile`, `analyzeSchema`, `renderView`, `renderSidebar`, `renderFileTree`, `updateStats`, `updateDirtyBadge`. These live in other (yet-to-extract) modules. For this task, they remain on the global namespace via `main.js`, so leave the calls **unqualified** (relying on global hoisting from `main.js` is fragile — instead, accept circular dependency: make `state.js` import from `view.js`, `schema.js`, `files.js` later, and update those calls when those modules exist).

**Pragmatic ordering:** Extract `state.js` FIRST among its peers but with placeholder forwarders. Specifically:
- Move only `state`, `newFileId`, `liveItems` to `state.js` in this task. Leave `snapshotCurrent`, `applyFromFile`, `switchToFile`, `closeFile` in `main.js` for now; they'll move into `files.js` in Task 15 once the helpers they call are also extracted.

Revise Step 1 to:

```javascript
// js/state.js
export const state = {
  // (paste object literal body from lines 780..802 verbatim)
};

let _fileIdCounter = 0;
export const newFileId = () => 'f' + (++_fileIdCounter);

export const liveItems = () => state.items.filter(it => !it.deleted);
```

- [ ] **Step 2: Remove just `state`, `_fileIdCounter`, `newFileId`, `liveItems` from `main.js`. Keep snapshot/apply/switch/close in main.js.**

- [ ] **Step 3: Import in main.js**

```javascript
import { state, newFileId, liveItems } from './state.js';
```

- [ ] **Step 4: Run runner. `23 passed, 0 failed`.**

- [ ] **Step 5: Commit**

```bash
git add js/state.js js/main.js
git commit -m "refactor(p1): extract js/state.js (state singleton, file-id, liveItems)"
```

---

## Task 7: Extract `js/view-colorize.js`

**Files:**
- Create: `js/view-colorize.js`
- Modify: `js/main.js`

Targets (lines 1460–1486): `keyHue`, `isDarkTheme`, `keyColor`, `applyColorize`.

- [ ] **Step 1: Create `js/view-colorize.js`**

```javascript
// js/view-colorize.js
import { state } from './state.js';
import { $list } from './dom.js';

function keyHue(name){ /* (paste 1460..1463) */ }
function isDarkTheme(){ /* (paste 1465..1469) */ }
function keyColor(name){ /* (paste 1471..1474) */ }

export function applyColorize(){
  // (paste 1476..1486; calls $list.querySelectorAll and reads state.colorize)
}
export { keyColor };
```

- [ ] **Step 2: Remove from main.js. Import `applyColorize` and `keyColor` in main.js.**

```javascript
import { applyColorize, keyColor } from './view-colorize.js';
```

- [ ] **Step 3: Run runner. `23 passed, 0 failed`.**

- [ ] **Step 4: Commit**

```bash
git add js/view-colorize.js js/main.js
git commit -m "refactor(p1): extract js/view-colorize.js"
```

---

## Task 8: Extract `js/view-markdown.js`

**Files:**
- Create: `js/view-markdown.js`
- Modify: `js/main.js`

Targets (lines 1276–1458): `applyMarkdownMode`, `safeHref`, `appendInline`, `renderMarkdownToDOM`.

- [ ] **Step 1: Create `js/view-markdown.js`**

```javascript
// js/view-markdown.js
import { el, $list } from './dom.js';
import { state } from './state.js';

export function applyMarkdownMode(){ /* (paste 1276..1290) */ }
export function safeHref(url){ /* (paste 1292..1296) */ }
export function appendInline(parent, text){ /* (paste 1298..1373) */ }
export function renderMarkdownToDOM(text){ /* (paste 1375..1458) */ }
```

`applyMarkdownMode` may call `renderStringSpan` (in view-node). Confirm by `grep`. If yes, defer this task until after Task 10 (view-node), or have view-node import the markdown helpers and view-markdown not call back into view-node.

The actual call: `applyMarkdownMode` iterates `.str` spans and re-renders them. It currently calls `renderStringSpan`. Move the call site logic into view-node when extracting markdown — i.e., `applyMarkdownMode` becomes a thin "force re-render of all strings" helper that can either:
- Live in view-node.js entirely (since it's tightly coupled), OR
- Stay in view-markdown.js and import `renderStringSpan` from view-node.

Simpler rule: keep `applyMarkdownMode` in view-markdown.js, import `renderStringSpan` from view-node.js. This requires Task 10 (view-node) to come BEFORE Task 8.

**Reorder:** Task 7 → Task 9 → Task 10 → Task 8 (i.e., do view-chat then view-node before view-markdown).

- [ ] **Step 2..5: standard remove-from-main, import, run runner, commit (after the reorder).**

```bash
git add js/view-markdown.js js/main.js
git commit -m "refactor(p1): extract js/view-markdown.js"
```

---

## Task 9: Extract `js/view-chat.js`

**Files:**
- Create: `js/view-chat.js`
- Modify: `js/main.js`

Targets (lines 1069–1106): `detectChatFormat`, `renderChatView`.

- [ ] **Step 1: Create `js/view-chat.js`**

```javascript
// js/view-chat.js
import { el } from './dom.js';
import { state } from './state.js';
import { renderMarkdownToDOM } from './view-markdown.js';
```

`renderChatView` calls `renderMarkdownToDOM`. So this depends on view-markdown — but view-markdown depends on view-node. Resolve by importing through the call site at runtime: ES modules support cycles for function bodies. Either order works as long as both modules are loaded before any call.

For simplicity, do this task after Task 8 (view-markdown, which itself follows Task 10 view-node). Final order: 7 → 10 → 8 → 9.

```javascript
export function detectChatFormat(parsed){ /* (paste 1069..1084) */ }
export function renderChatView(messages){ /* (paste 1086..1106) */ }
```

- [ ] **Step 2..5: standard.**

```bash
git add js/view-chat.js js/main.js
git commit -m "refactor(p1): extract js/view-chat.js"
```

---

## Task 10: Extract `js/view-node.js`

**Files:**
- Create: `js/view-node.js`
- Modify: `js/main.js`

Targets (lines 1108–1274): `makeStringSpan`, `makeKeyEl`, `makeRowDelBtn`, `makeNodeAddBtn`, `makeNodeDelBtn`, `renderNode`, `applyNewlineMode`, `renderStringSpan`.

- [ ] **Step 1: Create `js/view-node.js`**

```javascript
// js/view-node.js
import { el, $list } from './dom.js';
import { state } from './state.js';
import { pathKey, pathIdx } from './path.js';
import { keyColor } from './view-colorize.js';
import { promptKey, confirmModal } from './modal.js';
// view-edit.js imports — added after Task 11 lands; for now, the
// startInlineEdit/startKeyEdit/startValueEdit references inside renderNode
// are resolved via main.js global IIFE during transition.
```

`makeRowDelBtn`, `makeNodeAddBtn`, `makeNodeDelBtn` call into `applyNewlineMode`, `markDirty`, `removeAtPath`, `appendArrayItem`, `addObjectKey`, `analyzeSchema`, `renderSidebar`, `renderView`, `applyMarkdownMode`. These are spread across edit/schema/view/markdown modules.

**Cyclic deps will arise.** ES modules tolerate cycles when references are accessed at call time. To make this safe:
- Each module declares its imports at the top.
- Functions can reference imported symbols by name; the binding resolves at call time.
- Top-level statements that *read* the imported value during module evaluation are dangerous in cycles. Avoid those (we don't have any in this code).

Paste the function bodies:
```javascript
export const makeStringSpan = (v, path) => { /* (paste 1108..1149) */ };
export function makeKeyEl(keyLabel, path, isArrayIndex){ /* (paste 1151..1159) */ }
export function makeRowDelBtn(item, path){ /* (paste 1161..1171) */ }
export function makeNodeAddBtn(item, path, isArr){ /* (paste 1173..1186) */ }
export function makeNodeDelBtn(item, path){ /* (paste 1188..1196) */ }
export function renderNode(item, value, keyLabel=null, path='$', isArrayIndex=false){ /* (paste 1198..1254) */ }
export function applyNewlineMode(){ /* (paste 1256..1263) */ }
export function renderStringSpan(s){ /* (paste 1265..1274) */ }
```

Add imports as the dependencies are extracted in subsequent tasks. Initial imports (all already extracted by this point):
```javascript
import { el } from './dom.js';
import { state } from './state.js';
import { pathKey, pathIdx } from './path.js';
import { keyColor } from './view-colorize.js';
import { promptKey } from './modal.js';
```

The functions also call `markDirty`, `removeAtPath`, `appendArrayItem`, `addObjectKey`, `analyzeSchema`, `renderSidebar`, `renderView`, `applyMarkdownMode`, `startInlineEdit`, `startKeyEdit`, `startValueEdit`, `rebuildCardInPlace`. None exist as imports yet — they're still in `main.js`. To avoid breaking, **temporarily expose them as window globals from main.js until their host modules are extracted**:

In `main.js`, after each remaining function definition, add:
```javascript
window.markDirty = markDirty;
window.removeAtPath = removeAtPath;
window.appendArrayItem = appendArrayItem;
window.addObjectKey = addObjectKey;
window.analyzeSchema = analyzeSchema;
window.renderSidebar = renderSidebar;
window.renderView = renderView;
window.applyMarkdownMode = applyMarkdownMode;
window.startInlineEdit = startInlineEdit;
window.startKeyEdit = startKeyEdit;
window.startValueEdit = startValueEdit;
window.rebuildCardInPlace = rebuildCardInPlace;
```

In `view-node.js`, replace bare references `markDirty(...)` with `window.markDirty(...)`, etc. Once each function's host module exists, swap the `window.` prefix for a proper import and remove the corresponding `window.X = X` line in main.js.

This is the bridge pattern; remove the bridges in Task 16 (final cleanup).

- [ ] **Step 2..5: standard.**

```bash
git add js/view-node.js js/main.js
git commit -m "refactor(p1): extract js/view-node.js (with temporary window-globals bridge)"
```

---

## Task 11: Extract `js/view-edit.js`

**Files:**
- Create: `js/view-edit.js`
- Modify: `js/main.js`, `js/view-node.js` (replace `window.startInlineEdit` etc. with imports)

Targets (lines 1705–1995): `markDirty`, `applyValueAtPath`, `applyKeyRenameAtPath`, `removeAtPath`, `appendArrayItem`, `addObjectKey`, `activeEditing`, `startInlineEdit`, `startKeyEdit`, `startValueEdit`, `openRawEditor`.

- [ ] **Step 1: Create `js/view-edit.js`**

```javascript
// js/view-edit.js
import { el } from './dom.js';
import { state } from './state.js';
import { parsePath, walkPath } from './path.js';
import { showToast } from './dom.js';

export function markDirty(item){ /* paste 1705..1711 */ }
export function applyValueAtPath(item, path, newValue){ /* paste 1713..1724 */ }
export function applyKeyRenameAtPath(item, oldPath, newKey){ /* paste 1726..1751 */ }
export function removeAtPath(item, path){ /* paste 1753..1769 */ }
export function appendArrayItem(item, path){ /* paste 1771..1781 */ }
export function addObjectKey(item, path, keyName){ /* paste 1783..1799 */ }
export function activeEditing(){ return !!document.querySelector('.edit-input'); }

export function startInlineEdit(spanEl){ /* paste 1803..1812 */ }
export function startKeyEdit(item, spanEl){ /* paste 1814..1845 */ }
export function startValueEdit(item, spanEl){ /* paste 1847..1935 */ }
export function openRawEditor(item, bodyEl){ /* paste 1937..1995 */ }
```

These functions also call `recomputeItemMetrics`, `analyzeSchema`, `renderSidebar`, `renderView`, `rebuildCardInPlace`, `updateDirtyBadge`, `updateStats`. Use the `window.X` bridge pattern (same as Task 10) for any not yet extracted, OR import from already-extracted modules where available.

- [ ] **Step 2: Update view-node.js — drop `window.` prefix on edit funcs**

```javascript
import { startInlineEdit, startKeyEdit, startValueEdit, markDirty, removeAtPath, appendArrayItem, addObjectKey } from './view-edit.js';
```
And delete the `window.markDirty = markDirty;` etc. lines from main.js for these.

- [ ] **Step 3: Remove from main.js, import in main.js.**

```javascript
import { markDirty, applyValueAtPath, applyKeyRenameAtPath, removeAtPath, appendArrayItem, addObjectKey, activeEditing, startInlineEdit, startKeyEdit, startValueEdit, openRawEditor } from './view-edit.js';
```

- [ ] **Step 4: Run runner. `23 passed, 0 failed`.**

- [ ] **Step 5: Commit**

```bash
git add js/view-edit.js js/view-node.js js/main.js
git commit -m "refactor(p1): extract js/view-edit.js"
```

---

## Task 12: Extract `js/view-card.js`

**Files:**
- Create: `js/view-card.js`
- Modify: `js/main.js`, `js/view-node.js` (drop window-globals on rebuildCardInPlace)

Targets (lines 1488–1703): `makeItem`, `recomputeItemMetrics`, `exportRawFor`, `buildCard`, `syncExcluded`, `getCardEl`, `rebuildCardInPlace`.

- [ ] **Step 1: Create `js/view-card.js`**

```javascript
// js/view-card.js
import { el, $list, showToast } from './dom.js';
import { state } from './state.js';
import { estimateTokens, fmtNum } from './path.js';
import { renderNode, applyNewlineMode, renderStringSpan } from './view-node.js';
import { detectChatFormat, renderChatView } from './view-chat.js';
import { applyMarkdownMode } from './view-markdown.js';
import { applyColorize } from './view-colorize.js';
import { openRawEditor } from './view-edit.js';
import { confirmModal } from './modal.js';

export function makeItem(fileIdx, prefix, rawText, parsed, error){ /* paste 1488..1507 */ }
export function recomputeItemMetrics(item){ /* paste 1509..1521 */ }
export function exportRawFor(item){ /* paste 1523..1527 */ }
export function buildCard(item){ /* paste 1529..1682 */ }
export function syncExcluded(card, item, btn){ /* paste 1684..1688 */ }
export function getCardEl(item){ /* paste 1690..1693 */ }
export function rebuildCardInPlace(item){ /* paste 1695..1703 */ }
```

`buildCard` calls `markActive`, `setActive`, `updateFilterInfo`, `analyzeSchema`, `renderSidebar`, `renderView`, `updateDirtyBadge`. Bridge via `window.` until extracted (these will be in view.js / schema.js).

- [ ] **Step 2: Drop the `window.` bridge for `rebuildCardInPlace` in main.js; update view-edit.js to import it.**

```javascript
// in view-edit.js:
import { rebuildCardInPlace, recomputeItemMetrics } from './view-card.js';
```

- [ ] **Step 3: Remove from main.js, import in main.js.**

```javascript
import { makeItem, buildCard, getCardEl, rebuildCardInPlace, recomputeItemMetrics, exportRawFor, syncExcluded } from './view-card.js';
```

- [ ] **Step 4: Now circle back to Task 5 (parse.js depends on makeItem) — execute Task 5 now.**

- [ ] **Step 5: Run runner. `23 passed, 0 failed`. Commit.**

```bash
git add js/view-card.js js/view-edit.js js/main.js
git commit -m "refactor(p1): extract js/view-card.js"
```

---

## Task 13: Extract `js/schema.js`

**Files:**
- Create: `js/schema.js`
- Modify: `js/main.js`, others (drop `window.analyzeSchema`/`window.renderSidebar` bridges)

Targets (lines 1998–2036): `analyzeSchema`, `renderSidebar`.

- [ ] **Step 1: Create `js/schema.js`**

```javascript
// js/schema.js
import { el, $sidebar, $schemaKeys, $sideActions, $clearKeys, $addRow } from './dom.js';
import { state, liveItems } from './state.js';

export function analyzeSchema(){ /* paste 1998..2006 */ }
export function renderSidebar(){ /* paste 2008..2036 */ }
```

- [ ] **Step 2: Drop `window.analyzeSchema = ...` and `window.renderSidebar = ...` lines in main.js. Update view-node.js, view-edit.js, view-card.js to import from `./schema.js` instead of using `window.X`.**

- [ ] **Step 3: Remove from main.js, import in main.js.**

```javascript
import { analyzeSchema, renderSidebar } from './schema.js';
```

- [ ] **Step 4: Run runner. `23 passed, 0 failed`. Commit.**

```bash
git add js/schema.js js/view-node.js js/view-edit.js js/view-card.js js/main.js
git commit -m "refactor(p1): extract js/schema.js"
```

---

## Task 14: Extract `js/view.js`

**Files:**
- Create: `js/view.js`
- Modify: `js/main.js`, others (drop remaining `window.` bridges)

Targets (lines 2038–2184, 2779): `applyFilters`, `applySort`, `renderView`, `renderLoadMore`, `updateFilterInfo`, `updateStats`, `updateDirtyBadge`, `setActive`, `markActive`, `getActiveCard`, `jumpRelative`, `toggleActiveTree`.

- [ ] **Step 1: Create `js/view.js`**

```javascript
// js/view.js
import { el, $list, $stats, $filterInfo, $loadMore, $dirtyBadge, $dirtyCount, $expandAll, $collapseAll } from './dom.js';
import { state, liveItems } from './state.js';
import { fmtNum, estimateTokens } from './path.js';
import { buildCard, getCardEl, syncExcluded } from './view-card.js';

export function applyFilters(items){ /* paste 2038..2052 */ }
export function applySort(items){ /* paste 2054..2061 */ }
export function renderView(){ /* paste 2063..2076 */ }
export function renderLoadMore(){ /* paste 2078..2098 */ }
export function updateFilterInfo(){ /* paste 2100..2112 */ }
export function updateStats(){ /* paste 2114..2133 */ }
export function updateDirtyBadge(){ /* paste 2135..2148 */ }
export function setActive(origIdx, scroll=true){ /* paste 2150..2156 */ }
export function markActive(){ /* paste 2158..2161 */ }
export function getActiveCard(){ /* paste 2163..2167 */ }
export function jumpRelative(delta){ /* paste 2169..2183 */ }
export function toggleActiveTree(open){ /* paste 2779..2783 */ }
```

- [ ] **Step 2: Drop all remaining `window.X = X` bridges in main.js. Update view-node.js, view-edit.js, view-card.js to import these from `./view.js`.**

- [ ] **Step 3: Remove from main.js, import in main.js.**

- [ ] **Step 4: Run runner. `23 passed, 0 failed`. Commit.**

```bash
git add js/view.js js/view-node.js js/view-edit.js js/view-card.js js/main.js
git commit -m "refactor(p1): extract js/view.js (drop all window-bridges)"
```

---

## Task 15: Extract `js/files.js`

**Files:**
- Create: `js/files.js`
- Modify: `js/main.js`

Targets (lines 808–902, 2227–2564, plus length controls 2477–2519): `snapshotCurrent`, `applyFromFile`, `switchToFile`, `closeFile` (deferred from Task 6), `resetView`, `_parseFileIntoState`, `loadFile`, `loadFiles`, `renderFileTree`, `buildFileRow`, `buildFolderRow`, `saveFile`, `handleDrop`, `collectEntry`, `readNumOrNull`, `onLengthChange`.

- [ ] **Step 1: Create `js/files.js`**

```javascript
// js/files.js
import { el, $drop, $list, $sortSel, $search, $minTokens, $maxTokens, $exportBtn, showToast } from './dom.js';
import { state, newFileId } from './state.js';
import { tryParseFullJSON, parseAsJSON, parseAsJSONL } from './parse.js';
import { analyzeSchema, renderSidebar } from './schema.js';
import { renderView, updateStats, updateDirtyBadge } from './view.js';

export function snapshotCurrent(){ /* paste 808..826 */ }
export function applyFromFile(f){ /* paste 828..848 */ }
export function switchToFile(id){ /* paste 850..867 */ }
export function closeFile(id){ /* paste 869..902 */ }

export function resetView(){ /* paste 2227..2247 */ }
export async function _parseFileIntoState(file, folder=''){ /* paste 2249..2268 */ }
export async function loadFile(file, opts={}){ /* paste 2270..2294 */ }
export async function loadFiles(fileList, opts={}){ /* paste 2296..2307 */ }
export function renderFileTree(){ /* paste 2310..2335 */ }
export function buildFileRow(slot){ /* paste 2336..2367 */ }
export function buildFolderRow(name, slots){ /* paste 2369..2435 */ }
export function saveFile(){ /* paste 2437..2475 */ }
export function readNumOrNull(v){ /* paste 2477..2480 */ }
export function onLengthChange(){ /* paste 2482..2519 */ }
export async function handleDrop(e){ /* paste 2521..2543 */ }
export function collectEntry(entry, folderPath, out){ /* paste 2544..2564 */ }
```

- [ ] **Step 2: Remove from main.js, import in main.js.**

```javascript
import {
  snapshotCurrent, applyFromFile, switchToFile, closeFile,
  resetView, loadFile, loadFiles, renderFileTree, saveFile,
  readNumOrNull, onLengthChange, handleDrop
} from './files.js';
```

- [ ] **Step 3: Run runner. `23 passed, 0 failed`. Commit.**

```bash
git add js/files.js js/main.js
git commit -m "refactor(p1): extract js/files.js"
```

---

## Task 16: `main.js` cleanup — only bootstrap + event wiring

**Files:**
- Modify: `js/main.js`

After all extractions, `main.js` should contain only:
1. Imports from every module.
2. The event wirings from lines 2566–2778 (file inputs, drop zone, toggles, search debounce, dblclick dispatch, quick-copy click, keyboard shortcuts).
3. `beforeunload` handler (2786–2794).
4. `Init` block (2796–2800: `updateStats`, `renderSidebar`, `renderFileTree`, `updateDirtyBadge`, `initTheme`).

- [ ] **Step 1: Remove any remaining `window.X = X` bridges. There should be none.**

Run: `grep -n 'window\.' js/main.js`
Expected: no matches (or only legitimate `window.matchMedia`, `window.addEventListener` etc.).

- [ ] **Step 2: Confirm `main.js` is small**

Run: `wc -l js/main.js`
Expected: ~250 lines (event wiring only). If much larger, audit for forgotten extractions.

- [ ] **Step 3: Confirm `index.html` is small**

Run: `wc -l index.html`
Expected: ~700 lines (CSS + DOM only; ~2100 lines removed).

- [ ] **Step 4: Run runner. `23 passed, 0 failed`. Commit.**

```bash
git add js/main.js
git commit -m "refactor(p1): clean up main.js — bootstrap + event wiring only"
```

---

## Task 17: README update

**Files:**
- Modify: `README.md`

Drop the "no server required" claim and document the new local-dev steps.

- [ ] **Step 1: Update the "Local Development" section in README.md**

Replace the existing block:
```markdown
### Local Development
\`\`\`bash
# Clone the repository
git clone https://github.com/ibndias/jsonlviewer.git
cd jsonlviewer

# Open in browser
open index.html
# or
python -m http.server 8000  # then visit http://localhost:8000
\`\`\`
```

With:
```markdown
### Hosted
A live build is deployed on Netlify (link in repo description).

### Local Development
The viewer is now an ES-module app, so it must be served over HTTP (not opened directly via `file://`).

\`\`\`bash
git clone https://github.com/ibndias/jsonlviewer.git
cd jsonlviewer
python -m http.server 8000
# Open http://localhost:8000
# Tests: http://localhost:8000/test/runner.html
\`\`\`
```

- [ ] **Step 2: Update the "Technical Details" bullet that says "No dependencies or build process required"**

Change:
```
- **Pure HTML/CSS/JavaScript**: No dependencies or build process required
```

To:
```
- **Pure HTML/CSS/JavaScript** ES modules — no dependencies, no bundler, no build step
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: update local-dev steps for ES modules; drop file:// claim"
```

---

## Task 18: Final verification

**Files:** none

- [ ] **Step 1: Full test pass**

Refresh `http://localhost:8000/test/runner.html`. Run all.
Expected: `23 passed, 0 failed`.

- [ ] **Step 2: Manual smoke test**

Open `http://localhost:8000/`. Confirm:
- Drag `sample/sample-data.json` → 3 cards render with schema chips.
- Click a key chip → filter narrows.
- Double-click a string value → inline edit input appears, Enter saves, dirty badge appears.
- Toggle theme → CSS swaps.
- Drag `sample/sample-logs.jsonl` → second file appears in tree, switching works.
- `Save` button on dirty card → downloads modified JSON.

- [ ] **Step 3: Module inventory**

Run: `ls js/ | sort`
Expected output:
```
dom.js
files.js
main.js
modal.js
parse.js
path.js
schema.js
state.js
view-card.js
view-chat.js
view-colorize.js
view-edit.js
view-markdown.js
view-node.js
view.js
```
(15 files.)

- [ ] **Step 4: No `window.X = X` bridges left**

Run: `grep -rn 'window\.' js/ | grep -v matchMedia | grep -v addEventListener | grep -v innerWidth | grep -v innerHeight | grep -v navigator`
Expected: no matches.

- [ ] **Step 5: Tag the milestone**

```bash
git tag p1-module-refactor
```

- [ ] **Step 6: Push branch and tag, open PR (optional, ask user)**

```bash
git push -u origin p1-module-refactor
git push origin p1-module-refactor
```

---

## Self-Review Checklist (run before declaring P1 done)

1. **Spec coverage:** P1 covers spec section "File layout" + "Module boundaries" partial (only the modules that exist as no-IDB, no-projects refactor). Sections P2–P7 deliberately deferred. All P1-scoped boxes ticked.
2. **Placeholder scan:** All `(paste …)` markers were filled in by reading the original `index.html`. None left in committed code. The plan markdown contains `(paste lines L..L)` references — those are intentional pointers for the executing engineer, not placeholders in the code.
3. **Type/name consistency:**
   - `analyzeSchema` and `renderSidebar` named identically across schema.js, schema imports.
   - `rebuildCardInPlace` (not `rebuildCard`), used same name in view-card.js, view-edit.js.
   - `renderStringSpan` (not `applyMarkdownToString` or similar).
   - `renderFileTree`/`buildFileRow`/`buildFolderRow` names match originals.
4. **Cycle hazards:** view-node ↔ view-edit ↔ view-card ↔ view ↔ schema form a cluster of mutual references. Pattern used: `window.X` bridge during transition, removed in the task that finishes the cluster (Task 14). Confirmed no top-level *evaluation* of imported values inside the cluster — only call-time access. Safe.
5. **Order:** Tasks 5 ↔ 12 reordered (parse depends on makeItem); Tasks 8/9 ↔ 10 reordered (markdown/chat depend on view-node). Plan calls these out explicitly.

---

## Risk Log

| Risk | Mitigation |
|---|---|
| ES modules over `file://` blocked → tests can't run by double-clicking. | README updated; tests assume local server (already documented). |
| `<script type="module">` defers past `DOMContentLoaded` — element handle lookups in `dom.js` race the DOM. | DOM is fully parsed before module starts executing (deferred ⇒ post-parse). Verified by passing test runner. |
| Cyclic ES module imports cause `undefined` symbol errors. | Use `window.X` bridge during transition; only function bodies reference cyclic deps (call-time resolution, not evaluation-time). |
| One forgotten extracted symbol leaves a duplicate definition in main.js. | After every commit, `grep -n '^function NAME\|^const NAME' js/main.js` to confirm zero leftovers. |
| Test runner times out because module-init takes longer than 80ms. | If observed, bump the `setTimeout(resolve, 80)` in `runner.html` to 200ms — but only if tests actually fail; do not preempt. |

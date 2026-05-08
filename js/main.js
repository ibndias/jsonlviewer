// js/main.js — temporary monolith; subsequent tasks split this file.
(() => {
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const $ = id => document.getElementById(id);

  const $stats       = $('stats');
  const $dirtyBadge  = $('dirtyBadge');
  const $dirtyCount  = $('dirtyCount');
  const $list        = $('list');
  const $drop        = $('drop');
  const $file        = $('fileInput');
  const $nl          = $('nlToggle');
  const $md          = $('mdToggle');
  const $themeToggle = $('themeToggle');
  const $colorize    = $('colorizeToggle');
  const $editToggle  = $('editToggle');
  const $quickCopy   = $('quickCopyToggle');
  const $search      = $('search');
  const $expandAll   = $('expandAll');
  const $collapseAll = $('collapseAll');
  const $filterInfo  = $('filterInfo');
  const $toast       = $('toast');
  const $exportBtn   = $('exportBtn');
  const $saveBtn     = $('saveBtn');
  const $sortSel     = $('sortSel');
  const $minTokens   = $('minTokens');
  const $maxTokens   = $('maxTokens');
  const $loadMore    = $('loadMore');
  const $sidebar     = $('sidebar');
  const $schemaKeys  = $('schemaKeys');
  const $sideActions = $('sideActions');
  const $clearKeys   = $('clearKeysBtn');
  const $addRow      = $('addRow');
  const $addItemBtn  = $('addItemBtn');
  const $modal       = $('modal');
  const $modalTitle  = $('modalTitle');
  const $modalBody   = $('modalBody');
  const $modalOk     = $('modalOk');
  const $modalCancel = $('modalCancel');

  let state = {
    fileName: '',
    mode: 'unknown',
    sourceShape: 'array',
    modeNewlines: true,
    colorize: false,
    quickCopy: false,
    markdown: false,
    editMode: false,
    items: [],
    schema: new Map(),
    selectedKeys: new Set(),
    searchQuery: '',
    minTokens: null,
    maxTokens: null,
    sortMode: 'default',
    pageSize: 200,
    pagesShown: 1,
    viewItems: [],
    activeOrigIdx: -1,
    files: [],          // [{id, folder, snapshot}]
    activeId: null,
  };
  let _fileIdCounter = 0;
  const newFileId = () => 'f' + (++_fileIdCounter);

  /* ---- Per-file snapshot helpers ---- */
  // Save current per-file state into the active file's snapshot.
  function snapshotCurrent(){
    if (!state.activeId) return;
    const f = state.files.find(x => x.id === state.activeId);
    if (!f) return;
    f.snapshot = {
      fileName: state.fileName,
      mode: state.mode,
      sourceShape: state.sourceShape,
      items: state.items,
      schema: state.schema,
      selectedKeys: new Set(state.selectedKeys),
      searchQuery: state.searchQuery,
      minTokens: state.minTokens,
      maxTokens: state.maxTokens,
      sortMode: state.sortMode,
      pagesShown: state.pagesShown,
      viewItems: state.viewItems,
      activeOrigIdx: state.activeOrigIdx,
    };
  }
  function applyFromFile(f){
    const s = f.snapshot;
    if (!s) return;
    state.fileName = s.fileName;
    state.mode = s.mode;
    state.sourceShape = s.sourceShape;
    state.items = s.items;
    state.schema = s.schema;
    state.selectedKeys = new Set(s.selectedKeys);
    state.searchQuery = s.searchQuery;
    state.minTokens = s.minTokens;
    state.maxTokens = s.maxTokens;
    state.sortMode = s.sortMode;
    state.pagesShown = s.pagesShown;
    state.viewItems = s.viewItems;
    state.activeOrigIdx = s.activeOrigIdx;
    state.activeId = f.id;
    $search.value = state.searchQuery || '';
    $minTokens.value = state.minTokens != null ? state.minTokens : '';
    $maxTokens.value = state.maxTokens != null ? state.maxTokens : '';
    $sortSel.value = state.sortMode;
  }
  function switchToFile(id){
    if (!id || state.activeId === id) return;
    snapshotCurrent();
    const f = state.files.find(x => x.id === id);
    if (!f) return;
    applyFromFile(f);
    renderFileTree();
    analyzeSchema();
    renderSidebar();
    renderView();
    // Compact drop banner reflects the active file.
    if ($drop && state.fileName){
      $drop.classList.add('compact');
      const main = $drop.firstElementChild;
      main.replaceChildren();
      main.append(el('strong', null, state.fileName),
                  document.createTextNode(' active — drop or click to load more files.'));
    }
  }
  function closeFile(id){
    const idx = state.files.findIndex(x => x.id === id);
    if (idx < 0) return;
    if (state.activeId === id){
      // Wipe current state; if other files exist, switch to next.
      const next = state.files[idx + 1] || state.files[idx - 1] || null;
      state.files.splice(idx, 1);
      if (next){
        state.activeId = null;
        applyFromFile(next);
        analyzeSchema(); renderSidebar(); renderView();
      } else {
        state.activeId = null;
        resetView();
        state.fileName = '';
        $drop.classList.remove('compact');
        const main = $drop.firstElementChild;
        main.replaceChildren();
        const s = el('strong', null, 'Drag & drop');
        main.append(s,
          document.createTextNode(' a '),
          el('code', null, '.json'),
          document.createTextNode(' or '),
          el('code', null, '.jsonl'),
          document.createTextNode(' file here, or click '),
          el('em', null, 'Open'),
          document.createTextNode('.'));
        analyzeSchema(); renderSidebar(); renderView(); updateStats();
      }
    } else {
      state.files.splice(idx, 1);
    }
    renderFileTree();
  }

  let toastTimer;
  function showToast(msg, kind=''){
    $toast.textContent = msg;
    $toast.classList.remove('err');
    if (kind === 'err') $toast.classList.add('err');
    $toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(()=> $toast.classList.remove('show'), 2300);
  }

  function setModalBodyText(text){
    $modalBody.replaceChildren();
    const p = el('p', null, text);
    $modalBody.append(p);
  }
  function setModalBodyInput(placeholder){
    $modalBody.replaceChildren();
    const inp = document.createElement('input');
    inp.className = 'search';
    inp.style.width = '100%';
    inp.style.boxSizing = 'border-box';
    inp.placeholder = placeholder || '';
    $modalBody.append(inp);
    return inp;
  }

  function confirmModal({title='Confirm', body='Are you sure?', okLabel='OK', dangerous=false}={}){
    return new Promise(resolve => {
      $modalTitle.textContent = title;
      setModalBodyText(body);
      $modalOk.textContent = okLabel;
      $modalOk.className = 'btn primary';
      if (dangerous){
        $modalOk.style.background = 'var(--err)';
        $modalOk.style.borderColor = 'var(--err)';
      } else {
        $modalOk.style.background = '';
        $modalOk.style.borderColor = '';
      }
      $modal.style.display = 'flex';
      const cleanup = (val) => {
        $modal.style.display = 'none';
        $modalOk.removeEventListener('click', okFn);
        $modalCancel.removeEventListener('click', cancelFn);
        $modal.removeEventListener('click', bgFn);
        document.removeEventListener('keydown', keyFn, true);
        resolve(val);
      };
      const okFn = () => cleanup(true);
      const cancelFn = () => cleanup(false);
      const bgFn = (e) => { if (e.target === $modal) cleanup(false); };
      const keyFn = (e) => {
        if (e.key === 'Escape'){ e.stopPropagation(); cleanup(false); }
        else if (e.key === 'Enter'){ e.stopPropagation(); cleanup(true); }
      };
      $modalOk.addEventListener('click', okFn);
      $modalCancel.addEventListener('click', cancelFn);
      $modal.addEventListener('click', bgFn);
      document.addEventListener('keydown', keyFn, true);
      $modalOk.focus();
    });
  }

  function promptKey(){
    return new Promise(resolve => {
      $modalTitle.textContent = 'Add key';
      const inp = setModalBodyInput('key name');
      $modalOk.textContent = 'Add';
      $modalOk.className = 'btn primary';
      $modalOk.style.background = ''; $modalOk.style.borderColor = '';
      $modal.style.display = 'flex';
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
        if (e.key === 'Escape'){ e.stopPropagation(); cleanup(null); }
        else if (e.key === 'Enter'){ e.stopPropagation(); cleanup(inp.value.trim() || null); }
      };
      $modalOk.addEventListener('click', okFn);
      $modalCancel.addEventListener('click', cancelFn);
      $modal.addEventListener('click', bgFn);
      document.addEventListener('keydown', keyFn, true);
      setTimeout(()=>inp.focus(), 0);
    });
  }

  /* Theme */
  const savedTheme = localStorage.getItem('jsonl_viewer_theme');
  if (savedTheme === 'dark' || savedTheme === 'light') {
    document.documentElement.setAttribute('data-theme', savedTheme);
    $themeToggle.checked = (savedTheme === 'dark');
  } else {
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    $themeToggle.checked = prefersDark;
  }
  $themeToggle.addEventListener('change', () => {
    const theme = $themeToggle.checked ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('jsonl_viewer_theme', theme);
    if (state.colorize) applyColorize();
  });

  /* Path helpers */
  const identRe = /^[A-Za-z_$][\w$]*$/;
  const pathKey = (k) => identRe.test(k)
    ? `.${k}`
    : `["${String(k).replaceAll('\\','\\\\').replaceAll('"','\\"')}"]`;
  const pathIdx = (i) => `[${i}]`;

  function parsePath(path){
    if (!path || path[0] !== '$') throw new Error('bad path: ' + path);
    const tokens = [];
    let i = 1;
    while (i < path.length){
      const c = path[i];
      if (c === '.'){
        i++;
        let k = '';
        while (i < path.length && /[A-Za-z0-9_$]/.test(path[i])){ k += path[i]; i++; }
        tokens.push({kind:'key', value:k});
      } else if (c === '['){
        i++;
        if (path[i] === '"'){
          i++;
          let k = '';
          while (i < path.length && path[i] !== '"'){
            if (path[i] === '\\'){ k += path[i+1]; i += 2; }
            else { k += path[i]; i++; }
          }
          i++;
          if (path[i] === ']') i++;
          tokens.push({kind:'key', value:k});
        } else {
          let n = '';
          while (i < path.length && /\d/.test(path[i])){ n += path[i]; i++; }
          if (path[i] === ']') i++;
          tokens.push({kind:'idx', value:Number(n)});
        }
      } else { i++; }
    }
    return tokens;
  }

  function walkPath(root, tokens){
    if (!tokens.length) return {parent:null, lastKey:null, isRoot:true};
    let cur = root;
    for (let i = 0; i < tokens.length - 1; i++){
      cur = cur[tokens[i].value];
      if (cur === undefined || cur === null) throw new Error('path miss at ' + i);
    }
    return {parent:cur, lastKey:tokens[tokens.length-1].value, isRoot:false};
  }

  /* LLM helpers */
  const estimateTokens = (chars) => chars <= 0 ? 0 : Math.max(1, Math.round(chars / 4));
  const fmtNum = (n) => n.toLocaleString();

  function detectChatFormat(parsed){
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    if (Array.isArray(parsed.messages) && parsed.messages.length &&
        parsed.messages.every(m => m && typeof m === 'object' && 'role' in m && 'content' in m)){
      return parsed.messages.map(m => ({ role: m.role, content: m.content }));
    }
    if (Array.isArray(parsed.conversations) && parsed.conversations.length &&
        parsed.conversations.every(m => m && typeof m === 'object' &&
          ('from' in m || 'role' in m) && ('value' in m || 'content' in m))){
      return parsed.conversations.map(m => ({
        role: m.role ?? m.from ?? 'unknown',
        content: m.content ?? m.value
      }));
    }
    return null;
  }

  function renderChatView(messages){
    const wrap = el('div','chat-view');
    for (const m of messages){
      const role = String(m.role ?? 'unknown');
      const turn = el('div','chat-turn');
      const r = el('div','chat-role', role);
      r.classList.add('role-' + role.toLowerCase().replace(/[^a-z0-9_-]/g,''));
      const c = el('div','chat-content');
      const raw = (typeof m.content === 'string') ? m.content : JSON.stringify(m.content, null, 2);
      c.dataset.raw = raw;
      if (state.markdown){
        c.replaceChildren(renderMarkdownToDOM(raw));
      } else {
        c.textContent = raw;
      }
      turn.append(r, c);
      wrap.append(turn);
    }
    return wrap;
  }

  /* JSON tree rendering */
  const makeStringSpan = (v, path) => {
    const s = el('span','str editable');
    s.dataset.raw = v;
    s.dataset.escaped = v.replaceAll('\\', '\\\\').replaceAll('\r','\\r').replaceAll('\n','\\n').replaceAll('\t','\\t');
    s.dataset.json = JSON.stringify(v);
    s.dataset.path = path;
    s.dataset.kind = 'value';
    s.dataset.vtype = 'string';
    if (state.markdown){
      s.classList.add('has-md');
      s.append(renderMarkdownToDOM(v));
    } else {
      s.textContent = state.modeNewlines ? s.dataset.raw : s.dataset.escaped;
    }
    return s;
  };

  const renderPrimitive = (v, path) => {
    if (v === null) {
      const n = el('span','nil editable','null');
      n.dataset.json = 'null'; n.dataset.path = path; n.dataset.kind = 'value'; n.dataset.vtype = 'null';
      return n;
    }
    switch (typeof v){
      case 'string': return makeStringSpan(v, path);
      case 'number': {
        const n = el('span','num editable', String(v));
        n.dataset.json = String(v); n.dataset.path = path; n.dataset.kind = 'value'; n.dataset.vtype = 'number';
        return n;
      }
      case 'boolean': {
        const b = el('span','bool editable', String(v));
        b.dataset.json = String(v); b.dataset.path = path; b.dataset.kind = 'value'; b.dataset.vtype = 'boolean';
        return b;
      }
      default: {
        const p = el('span','pun', String(v));
        p.dataset.json = String(v); p.dataset.path = path; p.dataset.kind = 'value';
        return p;
      }
    }
  };

  function makeKeyEl(keyLabel, path, isArrayIndex){
    const cls = isArrayIndex ? 'idx' : 'key editable';
    const text = isArrayIndex ? String(keyLabel) : ('"' + keyLabel + '"');
    const k = el('span', cls, text);
    k.dataset.key = String(keyLabel);
    k.dataset.path = path;
    k.dataset.kind = 'key';
    return k;
  }

  function makeRowDelBtn(item, path){
    const wrap = el('span','row-actions');
    const del = el('button','row-btn del','×');
    del.title = 'Delete this entry';
    del.addEventListener('click', (e)=>{
      e.stopPropagation();
      removeAtPath(item, path);
    });
    wrap.append(del);
    return wrap;
  }

  function makeNodeAddBtn(item, path, isArr){
    const b = el('button','row-btn add', isArr ? '+ item' : '+ key');
    b.title = isArr ? 'Append item' : 'Add key';
    b.addEventListener('click', async (e)=>{
      e.stopPropagation(); e.preventDefault();
      if (isArr){
        appendArrayItem(item, path);
      } else {
        const key = await promptKey();
        if (key) addObjectKey(item, path, key);
      }
    });
    return b;
  }

  function makeNodeDelBtn(item, path){
    const b = el('button','row-btn del','×');
    b.title = 'Delete this entry';
    b.addEventListener('click', (e)=>{
      e.stopPropagation(); e.preventDefault();
      removeAtPath(item, path);
    });
    return b;
  }

  function renderNode(item, value, keyLabel=null, path='$', isArrayIndex=false){
    const container = el('div','tree');

    if (value === null || typeof value !== 'object'){
      const row = el('div','kv');
      if (keyLabel !== null){
        row.append(makeKeyEl(keyLabel, path, isArrayIndex), el('span','pun',': '));
      }
      row.append(renderPrimitive(value, path));
      if (keyLabel !== null){
        row.append(makeRowDelBtn(item, path));
      }
      container.append(row);
      return container;
    }

    const isArr = Array.isArray(value);
    const entries = isArr ? value.map((v,i)=>[i, v]) : Object.entries(value);

    const details = el('details','tree-node'); details.open = true;
    const summary = el('summary');
    const caret = el('span','caret');
    const headOpen  = isArr ? '[' : '{';
    const headClose = isArr ? ']' : '}';
    const meta = isArr
      ? `${entries.length} item${entries.length!==1?'s':''}`
      : `${entries.length} key${entries.length!==1?'s':''}`;

    if (keyLabel !== null){
      summary.append(caret, makeKeyEl(keyLabel, path, isArrayIndex), el('span','pun',': '));
    } else {
      summary.append(caret);
    }
    summary.dataset.kind = 'node';
    summary.dataset.path = path;
    try { summary.dataset.json = JSON.stringify(value); } catch { /* ignore */ }

    summary.append(
      el('span','pun', headOpen),
      el('span','node-meta',' … ' + meta),
      el('span','pun pun-close', headClose)
    );
    const acts = el('span','row-actions');
    acts.append(makeNodeAddBtn(item, path, isArr));
    if (keyLabel !== null) acts.append(makeNodeDelBtn(item, path));
    summary.append(acts);
    details.append(summary);

    const kids = el('div','children');
    for (let [k, v] of entries){
      const childPath = isArr ? (path + pathIdx(k)) : (path + pathKey(k));
      kids.append(renderNode(item, v, k, childPath, isArr));
    }
    details.append(kids);
    container.append(details);
    return container;
  }

  function applyNewlineMode(){
    document.querySelectorAll('.str').forEach(s => {
      if (s.dataset.raw == null) return;
      if (state.markdown){ renderStringSpan(s); return; }
      s.classList.remove('has-md');
      s.replaceChildren(document.createTextNode(state.modeNewlines ? s.dataset.raw : s.dataset.escaped));
    });
  }

  function renderStringSpan(s){
    if (s.dataset.raw == null) return;
    if (state.markdown){
      s.classList.add('has-md');
      s.replaceChildren(renderMarkdownToDOM(s.dataset.raw));
    } else {
      s.classList.remove('has-md');
      s.replaceChildren(document.createTextNode(state.modeNewlines ? s.dataset.raw : s.dataset.escaped));
    }
  }

  function applyMarkdownMode(){
    document.querySelectorAll('.str').forEach(renderStringSpan);
    document.querySelectorAll('.chat-content').forEach(c => {
      const raw = c.dataset.raw;
      if (raw == null) return;
      if (state.markdown){
        c.replaceChildren(renderMarkdownToDOM(raw));
      } else {
        c.replaceChildren(document.createTextNode(raw));
      }
    });
  }

  /* Tiny Markdown to DOM (safe; no innerHTML; no remote deps).
     Supports: headings, code fences, inline code, bold, italic, links,
     unordered/ordered lists, blockquotes, hr, paragraphs, line breaks. */
  function safeHref(url){
    const u = String(url).trim();
    if (/^(javascript|data|vbscript):/i.test(u)) return '#';
    return u;
  }

  function appendInline(parent, text){
    let buf = '';
    const flush = () => {
      if (!buf) return;
      const parts = buf.split('\n');
      parts.forEach((seg, idx) => {
        if (idx > 0) parent.append(document.createElement('br'));
        if (seg) parent.append(document.createTextNode(seg));
      });
      buf = '';
    };
    let i = 0;
    while (i < text.length){
      const c = text[i];
      // **bold**
      if (c === '*' && text[i+1] === '*'){
        const end = text.indexOf('**', i+2);
        if (end > i+2){
          flush();
          const b = document.createElement('strong');
          appendInline(b, text.slice(i+2, end));
          parent.append(b);
          i = end + 2;
          continue;
        }
      }
      // *italic* or _italic_ (avoid eating ** by checking next char)
      if ((c === '*' || c === '_') && text[i+1] !== c){
        const end = text.indexOf(c, i+1);
        if (end > i+1){
          const inside = text.slice(i+1, end);
          if (inside && !/^\s/.test(inside) && !/\s$/.test(inside)){
            flush();
            const it = document.createElement('em');
            it.textContent = inside;
            parent.append(it);
            i = end + 1;
            continue;
          }
        }
      }
      // `inline code`
      if (c === '`'){
        const end = text.indexOf('`', i+1);
        if (end > i+1){
          flush();
          const cd = document.createElement('code');
          cd.textContent = text.slice(i+1, end);
          parent.append(cd);
          i = end + 1;
          continue;
        }
      }
      // [text](url)
      if (c === '['){
        const close = text.indexOf(']', i+1);
        if (close > i+1 && text[close+1] === '('){
          const urlEnd = text.indexOf(')', close+2);
          if (urlEnd > close+2){
            flush();
            const a = document.createElement('a');
            a.href = safeHref(text.slice(close+2, urlEnd));
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.textContent = text.slice(i+1, close);
            parent.append(a);
            i = urlEnd + 1;
            continue;
          }
        }
      }
      buf += c;
      i++;
    }
    flush();
  }

  function renderMarkdownToDOM(text){
    const root = document.createElement('div');
    root.className = 'md-render';
    const lines = String(text).split('\n');
    const ulRe = /^(\s*)[-*+]\s+(.*)$/;
    const olRe = /^(\s*)(\d+)\.\s+(.*)$/;
    let i = 0;
    while (i < lines.length){
      const line = lines[i];
      if (/^```/.test(line)){
        const lang = line.replace(/^```/,'').trim();
        const buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])){
          buf.push(lines[i]); i++;
        }
        if (i < lines.length) i++;
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        if (lang) code.className = 'lang-' + lang.replace(/[^A-Za-z0-9_-]/g,'');
        code.textContent = buf.join('\n');
        pre.append(code);
        root.append(pre);
        continue;
      }
      const hMatch = line.match(/^(#{1,6})\s+(.*)$/);
      if (hMatch){
        const h = document.createElement('h' + hMatch[1].length);
        appendInline(h, hMatch[2]);
        root.append(h);
        i++;
        continue;
      }
      if (/^\s*(\*\s*\*\s*\*+|-\s*-\s*-+|_\s*_\s*_+)\s*$/.test(line)){
        root.append(document.createElement('hr'));
        i++;
        continue;
      }
      if (/^\s*>\s?/.test(line)){
        const buf = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])){
          buf.push(lines[i].replace(/^\s*>\s?/, ''));
          i++;
        }
        const bq = document.createElement('blockquote');
        appendInline(bq, buf.join('\n'));
        root.append(bq);
        continue;
      }
      if (ulRe.test(line) || olRe.test(line)){
        const isOl = olRe.test(line);
        const re = isOl ? olRe : ulRe;
        const list = document.createElement(isOl ? 'ol' : 'ul');
        while (i < lines.length){
          const m = lines[i].match(re);
          if (!m) break;
          const li = document.createElement('li');
          appendInline(li, isOl ? m[3] : m[2]);
          list.append(li);
          i++;
        }
        root.append(list);
        continue;
      }
      if (line.trim() === ''){ i++; continue; }
      const buf = [line];
      i++;
      while (i < lines.length){
        const next = lines[i];
        if (next.trim() === '') break;
        if (/^```/.test(next)) break;
        if (/^#{1,6}\s/.test(next)) break;
        if (/^\s*>\s?/.test(next)) break;
        if (ulRe.test(next) || olRe.test(next)) break;
        buf.push(next);
        i++;
      }
      const p = document.createElement('p');
      appendInline(p, buf.join('\n'));
      root.append(p);
    }
    return root;
  }

  /* Colorize keys */
  function keyHue(name){
    let h = 5381;
    for (let i = 0; i < name.length; i++) h = ((h << 5) + h + name.charCodeAt(i)) | 0;
    return Math.abs(h) % 360;
  }
  function isDarkTheme(){
    const t = document.documentElement.getAttribute('data-theme');
    if (t === 'dark') return true;
    if (t === 'light') return false;
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }
  function keyColor(name){
    const hue = keyHue(name);
    const lightness = isDarkTheme() ? 72 : 38;
    return `hsl(${hue}, 70%, ${lightness}%)`;
  }
  function applyColorize(){
    document.querySelectorAll('.key').forEach(elx => {
      if (state.colorize){
        const k = elx.dataset.key || '';
        elx.style.color = keyColor(k);
      } else {
        elx.style.color = '';
      }
    });
  }

  /* Item construction */
  function makeItem(fileIdx, prefix, rawText, parsed, error){
    const charCount = error ? rawText.length : JSON.stringify(parsed).length;
    let topKeys = [];
    if (!error && parsed && typeof parsed === 'object' && !Array.isArray(parsed)){
      topKeys = Object.keys(parsed);
    }
    return {
      origIdx: 0,
      fileIdx, prefix, rawText, parsed, error,
      originalParsed: error ? null : structuredClone(parsed),
      dirty: false,
      deleted: false,
      excluded: false,
      _cardEl: null,
      charCount,
      tokens: estimateTokens(charCount),
      searchText: error ? rawText.toLowerCase() : JSON.stringify(parsed).toLowerCase(),
      topKeys,
    };
  }

  function recomputeItemMetrics(item){
    if (item.error){
      item.charCount = item.rawText.length;
      item.searchText = item.rawText.toLowerCase();
    } else {
      const s = JSON.stringify(item.parsed);
      item.charCount = s.length;
      item.searchText = s.toLowerCase();
    }
    item.tokens = estimateTokens(item.charCount);
    item.topKeys = (!item.error && item.parsed && typeof item.parsed === 'object' && !Array.isArray(item.parsed))
      ? Object.keys(item.parsed) : [];
  }

  function exportRawFor(item){
    if (item.error) return item.rawText.replace(/\r?\n/g,' ');
    try { return JSON.stringify(item.parsed); } catch { return ''; }
  }

  /* Card builder */
  function buildCard(item){
    const card = el('div','card');
    card.dataset.origIdx = String(item.origIdx);
    if (item.dirty) card.classList.add('dirty');

    const head = el('div','card-head');
    const left = el('div','row');
    const ln = el('span','ln');
    ln.append(document.createTextNode(item.prefix + ' '), el('strong', null, String(item.fileIdx + 1)));
    left.append(ln);

    const stat = el('span','chip-stat',
      `${fmtNum(item.charCount)} chars • ~${fmtNum(item.tokens)} tok`);
    stat.title = 'Character count and rough token estimate (chars / 4)';
    left.append(stat);

    const dirtyB = el('span','badge-dirty');
    dirtyB.append(el('span','dot'), document.createTextNode(' modified'));
    left.append(dirtyB);

    const toolbar = el('div','toolbar');

    const copyBtn = el('button','mini-btn','Copy raw');
    copyBtn.title = 'Copy the raw text for this item';
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(item.rawText);
        copyBtn.textContent = 'Copied!';
        setTimeout(()=>copyBtn.textContent='Copy raw', 900);
        showToast('Copied raw text');
      } catch {}
    });

    const copyJsonBtn = el('button','mini-btn','Copy JSON');
    copyJsonBtn.title = 'Copy this item as pretty JSON';
    copyJsonBtn.addEventListener('click', async () => {
      try {
        const txt = item.error ? item.rawText : JSON.stringify(item.parsed, null, 2);
        await navigator.clipboard.writeText(txt);
        copyJsonBtn.textContent = 'Copied!';
        setTimeout(()=>copyJsonBtn.textContent='Copy JSON', 900);
        showToast('Copied JSON');
      } catch {}
    });

    const expandBtn = el('button','mini-btn','Expand');
    expandBtn.title = 'Expand all nodes in this item';
    expandBtn.addEventListener('click', () => {
      card.querySelectorAll('details.tree-node').forEach(d => d.open = true);
    });

    const collapseBtn = el('button','mini-btn','Collapse');
    collapseBtn.title = 'Collapse all nodes in this item';
    collapseBtn.addEventListener('click', () => {
      card.querySelectorAll('details.tree-node').forEach(d => d.open = false);
    });

    const editRawBtn = el('button','mini-btn','Edit raw');
    editRawBtn.title = 'Edit the entire item as JSON text';
    editRawBtn.addEventListener('click', () => openRawEditor(item, body));

    const resetBtn = el('button','mini-btn reset','Reset');
    resetBtn.title = 'Revert this item to its original (unedited) state';
    resetBtn.addEventListener('click', async () => {
      if (!item.dirty) return;
      const ok = await confirmModal({
        title:'Reset item?',
        body:'Discard all edits in this item and restore original content.',
        okLabel:'Reset', dangerous:true
      });
      if (!ok) return;
      item.parsed = structuredClone(item.originalParsed);
      item.dirty = false;
      recomputeItemMetrics(item);
      rebuildCardInPlace(item);
      updateDirtyBadge();
      updateStats();
      analyzeSchema(); renderSidebar();
      showToast('Item reset');
    });

    const excludeBtn = el('button','mini-btn warn','Exclude');
    excludeBtn.title = 'Exclude this item from Export (toggle)';
    excludeBtn.addEventListener('click', () => {
      item.excluded = !item.excluded;
      syncExcluded(card, item, excludeBtn);
      updateStats();
      updateFilterInfo();
    });

    const deleteBtn = el('button','mini-btn danger','Delete');
    deleteBtn.title = 'Permanently remove this item from the list';
    deleteBtn.addEventListener('click', async () => {
      const ok = await confirmModal({
        title:'Delete item?',
        body:'This removes the item entirely. It will not be exported or saved.',
        okLabel:'Delete', dangerous:true
      });
      if (!ok) return;
      item.deleted = true;
      analyzeSchema(); renderSidebar();
      renderView();
      updateDirtyBadge();
      showToast('Item deleted');
    });

    toolbar.append(copyBtn, copyJsonBtn, expandBtn, collapseBtn, editRawBtn, excludeBtn, deleteBtn, resetBtn);

    const body = el('div','body');
    let treeContent;
    if (item.error){
      const pre = el('pre','tree');
      pre.textContent = item.rawText;
      treeContent = pre;
    } else {
      treeContent = renderNode(item, item.parsed, null, '$');
    }
    body.append(treeContent);

    if (!item.error){
      const chat = detectChatFormat(item.parsed);
      if (chat && chat.length){
        const chatBtn = el('button','mini-btn','Chat view');
        chatBtn.title = 'Render as a conversation (detected messages/conversations field)';
        let showingChat = false;
        chatBtn.addEventListener('click', () => {
          showingChat = !showingChat;
          if (showingChat){
            const fresh = renderChatView(detectChatFormat(item.parsed) || []);
            body.replaceChildren(fresh);
            chatBtn.textContent = 'Tree view';
            chatBtn.classList.add('active');
          } else {
            body.replaceChildren(treeContent);
            chatBtn.textContent = 'Chat view';
            chatBtn.classList.remove('active');
          }
        });
        toolbar.append(chatBtn);
      }
    }

    head.append(left);
    head.append(item.error ? el('span','badge-err','Parse error') : el('span','badge-ok','OK'));
    head.append(toolbar);

    const headerWrap = el('header'); headerWrap.append(head);
    card.append(headerWrap, body);

    card.addEventListener('mousedown', () => setActive(item.origIdx, false));

    syncExcluded(card, item, excludeBtn);
    return card;
  }

  function syncExcluded(card, item, btn){
    card.classList.toggle('excluded', item.excluded);
    btn.textContent = item.excluded ? 'Include' : 'Exclude';
    btn.classList.toggle('active', item.excluded);
  }

  function getCardEl(item){
    if (!item._cardEl) item._cardEl = buildCard(item);
    return item._cardEl;
  }

  function rebuildCardInPlace(item){
    const old = item._cardEl;
    item._cardEl = null;
    const fresh = getCardEl(item);
    if (old && old.isConnected) old.replaceWith(fresh);
    if (state.colorize) applyColorize();
    if (state.activeOrigIdx === item.origIdx) markActive();
  }

  /* Mutation logic */
  function markDirty(item){
    if (!item.dirty){
      item.dirty = true;
      updateDirtyBadge();
    }
    recomputeItemMetrics(item);
  }

  function applyValueAtPath(item, path, newValue){
    if (item.error) return false;
    const tokens = parsePath(path);
    if (!tokens.length){
      item.parsed = newValue;
    } else {
      const {parent, lastKey} = walkPath(item.parsed, tokens);
      parent[lastKey] = newValue;
    }
    markDirty(item);
    return true;
  }

  function applyKeyRenameAtPath(item, oldPath, newKey){
    const tokens = parsePath(oldPath);
    if (!tokens.length) return false;
    const {parent, lastKey} = walkPath(item.parsed, tokens);
    if (Array.isArray(parent)) return false;
    if (lastKey === newKey) return true;
    if (Object.prototype.hasOwnProperty.call(parent, newKey)){
      showToast('Key "' + newKey + '" already exists', 'err');
      return false;
    }
    const fresh = {};
    for (const k of Object.keys(parent)){
      if (k === lastKey) fresh[newKey] = parent[lastKey];
      else fresh[k] = parent[k];
    }
    if (tokens.length === 1){
      item.parsed = fresh;
    } else {
      const grandTokens = tokens.slice(0, -1);
      const grandLast = grandTokens[grandTokens.length-1].value;
      const grandWalk = walkPath(item.parsed, grandTokens);
      grandWalk.parent[grandLast] = fresh;
    }
    markDirty(item);
    return true;
  }

  function removeAtPath(item, path){
    const tokens = parsePath(path);
    if (!tokens.length){
      showToast('Cannot delete root — use card Delete', 'err');
      return;
    }
    const {parent, lastKey} = walkPath(item.parsed, tokens);
    if (Array.isArray(parent)){
      parent.splice(lastKey, 1);
    } else {
      delete parent[lastKey];
    }
    markDirty(item);
    rebuildCardInPlace(item);
    updateStats();
    analyzeSchema(); renderSidebar();
  }

  function appendArrayItem(item, path){
    const tokens = parsePath(path);
    let target;
    if (!tokens.length){ target = item.parsed; }
    else { const w = walkPath(item.parsed, tokens); target = w.parent[w.lastKey]; }
    if (!Array.isArray(target)) return;
    target.push(null);
    markDirty(item);
    rebuildCardInPlace(item);
    updateStats();
  }

  function addObjectKey(item, path, keyName){
    const tokens = parsePath(path);
    let target;
    if (!tokens.length){ target = item.parsed; }
    else { const w = walkPath(item.parsed, tokens); target = w.parent[w.lastKey]; }
    if (!target || typeof target !== 'object' || Array.isArray(target)) return;
    if (Object.prototype.hasOwnProperty.call(target, keyName)){
      showToast('Key "' + keyName + '" already exists', 'err');
      return;
    }
    target[keyName] = null;
    markDirty(item);
    rebuildCardInPlace(item);
    updateStats();
    analyzeSchema(); renderSidebar();
  }

  /* Inline edit */
  function activeEditing(){ return !!document.querySelector('.edit-input'); }

  function startInlineEdit(spanEl){
    if (activeEditing()) return;
    const card = spanEl.closest('.card');
    if (!card) return;
    const item = state.items[Number(card.dataset.origIdx)];
    if (!item || item.error) return;
    const kind = spanEl.dataset.kind;
    if (kind === 'key') startKeyEdit(item, spanEl);
    else startValueEdit(item, spanEl);
  }

  function startKeyEdit(item, spanEl){
    const oldKey = spanEl.dataset.key;
    const oldPath = spanEl.dataset.path;
    const inp = el('input','edit-input');
    inp.value = oldKey;
    spanEl.replaceWith(inp);
    inp.focus(); inp.select();
    let done = false;
    const finish = (commit) => {
      if (done) return; done = true;
      if (commit){
        const newKey = inp.value;
        if (newKey && newKey !== oldKey){
          const ok = applyKeyRenameAtPath(item, oldPath, newKey);
          if (!ok){ rebuildCardInPlace(item); return; }
          rebuildCardInPlace(item);
          updateStats();
          analyzeSchema(); renderSidebar();
          showToast('Renamed key');
          return;
        }
      }
      const orig = makeKeyEl(oldKey, oldPath, false);
      inp.replaceWith(orig);
      if (state.colorize) applyColorize();
    };
    inp.addEventListener('keydown', (e)=>{
      if (e.key === 'Enter'){ e.preventDefault(); finish(true); }
      else if (e.key === 'Escape'){ e.preventDefault(); finish(false); }
    });
    inp.addEventListener('blur', ()=> finish(true));
  }

  function startValueEdit(item, spanEl){
    const path = spanEl.dataset.path;
    const vtype = spanEl.dataset.vtype;
    const tokens = parsePath(path);
    let oldVal;
    if (!tokens.length) oldVal = item.parsed;
    else { const w = walkPath(item.parsed, tokens); oldVal = w.parent[w.lastKey]; }

    let inp;
    let autosize = null;
    if (vtype === 'string'){
      inp = el('textarea','edit-input');
      inp.value = String(oldVal);
      inp.rows = 1;
      autosize = () => {
        inp.style.height = 'auto';
        inp.style.height = Math.max(inp.scrollHeight + 2, 36) + 'px';
      };
    } else if (vtype === 'number'){
      inp = el('input','edit-input');
      inp.type = 'text'; inp.value = String(oldVal);
    } else if (vtype === 'boolean'){
      inp = el('select','edit-input');
      const tOpt = document.createElement('option'); tOpt.value='true'; tOpt.textContent='true';
      const fOpt = document.createElement('option'); fOpt.value='false'; fOpt.textContent='false';
      if (oldVal === true) tOpt.selected = true; else fOpt.selected = true;
      inp.append(tOpt, fOpt);
    } else {
      inp = el('select','edit-input');
      ['string','number','boolean','null','{}','[]'].forEach(t=>{
        const o = document.createElement('option'); o.value = t; o.textContent = t;
        inp.append(o);
      });
    }
    spanEl.replaceWith(inp);
    inp.focus();
    if (typeof inp.select === 'function') try{inp.select();}catch{}
    if (autosize){
      autosize();
      inp.addEventListener('input', autosize);
      // Re-measure once layout settles (font load / wrapping).
      requestAnimationFrame(autosize);
    }

    let done = false;
    const finish = (commit) => {
      if (done) return; done = true;
      if (!commit){ rebuildCardInPlace(item); return; }
      let newVal;
      try {
        if (vtype === 'string'){ newVal = inp.value; }
        else if (vtype === 'number'){
          const n = Number(inp.value);
          if (!Number.isFinite(n)) throw new Error('not a number');
          newVal = n;
        }
        else if (vtype === 'boolean'){ newVal = (inp.value === 'true'); }
        else {
          const t = inp.value;
          if (t === 'string') newVal = '';
          else if (t === 'number') newVal = 0;
          else if (t === 'boolean') newVal = false;
          else if (t === 'null') newVal = null;
          else if (t === '{}') newVal = {};
          else if (t === '[]') newVal = [];
        }
      } catch (e) {
        showToast('Invalid: ' + e.message, 'err');
        rebuildCardInPlace(item);
        return;
      }
      applyValueAtPath(item, path, newVal);
      rebuildCardInPlace(item);
      updateStats();
      analyzeSchema(); renderSidebar();
    };
    inp.addEventListener('keydown', (e)=>{
      if (e.key === 'Escape'){ e.preventDefault(); finish(false); }
      else if (e.key === 'Enter'){
        if (vtype === 'string'){
          if (!e.shiftKey){ e.preventDefault(); finish(true); }
        } else {
          e.preventDefault(); finish(true);
        }
      }
    });
    inp.addEventListener('blur', ()=> finish(true));
  }

  /* Raw editor */
  function openRawEditor(item, bodyEl){
    const wrap = el('div','raw-editor');
    const ta = document.createElement('textarea');
    ta.value = item.error ? item.rawText : JSON.stringify(item.parsed, null, 2);
    ta.spellcheck = false;
    const bar = el('div','raw-editor-bar');
    const status = el('span','raw-error ok','valid');
    const saveB = el('button','btn primary','Save');
    const cancelB = el('button','btn ghost','Cancel');
    bar.append(status, cancelB, saveB);
    wrap.append(ta, bar);
    bodyEl.replaceChildren(wrap);
    ta.focus();

    const validate = () => {
      try {
        const v = JSON.parse(ta.value);
        ta.classList.remove('error');
        status.classList.add('ok');
        status.textContent = 'valid JSON';
        return {ok:true, value:v};
      } catch (e) {
        ta.classList.add('error');
        status.classList.remove('ok');
        status.textContent = String(e.message || e);
        return {ok:false};
      }
    };
    ta.addEventListener('input', validate);
    validate();

    const restore = () => { rebuildCardInPlace(item); };
    cancelB.addEventListener('click', restore);
    saveB.addEventListener('click', () => {
      const r = validate();
      if (!r.ok){ showToast('Invalid JSON', 'err'); return; }
      item.parsed = r.value;
      item.error = false;
      item.dirty = true;
      recomputeItemMetrics(item);
      rebuildCardInPlace(item);
      analyzeSchema(); renderSidebar();
      updateStats();
      updateDirtyBadge();
      showToast('Item updated');
    });
    ta.addEventListener('keydown', (e)=>{
      if (e.key === 'Escape'){ e.preventDefault(); restore(); }
      else if ((e.ctrlKey || e.metaKey) && e.key === 's'){ e.preventDefault(); saveB.click(); }
      else if (e.key === 'Tab'){
        e.preventDefault();
        const s = ta.selectionStart, en = ta.selectionEnd;
        ta.value = ta.value.slice(0,s) + '  ' + ta.value.slice(en);
        ta.selectionStart = ta.selectionEnd = s + 2;
      }
    });
  }

  /* Schema sidebar */
  function liveItems(){ return state.items.filter(it => !it.deleted); }

  function analyzeSchema(){
    const m = new Map();
    for (const it of liveItems()){
      for (const k of it.topKeys){
        m.set(k, (m.get(k) || 0) + 1);
      }
    }
    state.schema = m;
  }

  function renderSidebar(){
    const m = state.schema;
    if (!m.size){
      $schemaKeys.replaceChildren(el('div','side-empty', state.items.length
        ? 'No top-level object keys (items are arrays/primitives).'
        : 'Load a file to see keys.'));
      $sideActions.style.display = 'none';
      return;
    }
    const keys = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const frag = document.createDocumentFragment();
    for (const [name, count] of keys){
      const chip = el('span','key-chip');
      chip.textContent = name;
      chip.append(el('span','count', String(count)));
      if (state.selectedKeys.has(name)) chip.classList.add('selected');
      chip.addEventListener('click', () => {
        if (state.selectedKeys.has(name)) state.selectedKeys.delete(name);
        else state.selectedKeys.add(name);
        state.pagesShown = 1;
        renderSidebar();
        renderView();
      });
      frag.append(chip);
    }
    $schemaKeys.replaceChildren(frag);
    $sideActions.style.display = state.selectedKeys.size ? '' : 'none';
  }

  /* Filter / sort / paginate */
  function applyFilters(items){
    const q = state.searchQuery.toLowerCase();
    const minT = (state.minTokens != null && Number.isFinite(state.minTokens)) ? state.minTokens : -Infinity;
    const maxT = (state.maxTokens != null && Number.isFinite(state.maxTokens)) ? state.maxTokens : Infinity;
    const reqKeys = state.selectedKeys;
    return items.filter(it => {
      if (it.deleted) return false;
      if (q && !it.searchText.includes(q)) return false;
      if (it.tokens < minT || it.tokens > maxT) return false;
      if (reqKeys.size){
        for (const k of reqKeys) if (!it.topKeys.includes(k)) return false;
      }
      return true;
    });
  }

  function applySort(items){
    if (state.sortMode === 'default') return items;
    const arr = items.slice();
    const dir = state.sortMode.endsWith('-asc') ? 1 : -1;
    const field = state.sortMode.startsWith('tokens') ? 'tokens' : 'charCount';
    arr.sort((a, b) => (a[field] - b[field]) * dir);
    return arr;
  }

  function renderView(){
    state.viewItems = applySort(applyFilters(state.items));
    const limit = state.pageSize * state.pagesShown;
    const slice = state.viewItems.slice(0, limit);
    const frag = document.createDocumentFragment();
    for (const it of slice) frag.append(getCardEl(it));
    $list.replaceChildren(frag);
    renderLoadMore();
    updateFilterInfo();
    updateStats();
    markActive();
    if (state.colorize) applyColorize();
    $addRow.style.display = state.items.length ? '' : 'none';
  }

  function renderLoadMore(){
    $loadMore.replaceChildren();
    const total = state.viewItems.length;
    const shown = Math.min(state.pageSize * state.pagesShown, total);
    if (!liveItems().length) return;
    const status = el('span',null, `Showing ${fmtNum(shown)} of ${fmtNum(total)}`);
    $loadMore.append(status);
    if (shown < total){
      const btn = el('button','btn',`Load next ${Math.min(state.pageSize, total - shown)}`);
      btn.addEventListener('click', () => {
        state.pagesShown++;
        renderView();
      });
      const all = el('button','btn','Load all');
      all.addEventListener('click', () => {
        state.pagesShown = Math.ceil(total / state.pageSize);
        renderView();
      });
      $loadMore.append(btn, all);
    }
  }

  function updateFilterInfo(){
    if (!state.items.length){ $filterInfo.textContent = ''; return; }
    const live = liveItems();
    const total = live.length;
    const match = state.viewItems.length;
    const excluded = state.viewItems.filter(it => it.excluded).length;
    const hidden = total - match;
    const parts = [];
    if (hidden > 0) parts.push(`${fmtNum(hidden)} hidden by filter`);
    if (excluded > 0) parts.push(`${fmtNum(excluded)} excluded`);
    parts.push(`${fmtNum(match - excluded)} will export`);
    $filterInfo.textContent = parts.join(' · ');
  }

  function updateStats(){
    if (!state.fileName){ $stats.textContent = 'No file loaded'; return; }
    const modeTxt = state.mode === 'json' ? 'JSON' : state.mode === 'jsonl' ? 'JSONL' : 'Auto';
    const live = liveItems();
    const total = live.length;
    let ok = 0, err = 0, totalChars = 0;
    for (const it of live){
      if (it.error) err++; else ok++;
      totalChars += it.charCount;
    }
    const totalTokens = estimateTokens(totalChars);
    const itemWord = total === 1 ? 'item' : 'items';
    const errWord = err === 1 ? 'error' : 'errors';
    const deleted = state.items.length - live.length;
    const delPart = deleted ? ` • ${fmtNum(deleted)} deleted` : '';
    $stats.textContent =
      `${state.fileName} • ${modeTxt} • ${fmtNum(total)} ${itemWord} • ` +
      `${fmtNum(ok)} ok • ${fmtNum(err)} ${errWord}${delPart} • ` +
      `${fmtNum(totalChars)} chars • ~${fmtNum(totalTokens)} tok`;
  }

  function updateDirtyBadge(){
    const editedN = state.items.filter(it => it.dirty && !it.deleted).length;
    const delN = state.items.filter(it => it.deleted).length;
    const n = editedN + delN;
    if (n > 0){
      $dirtyBadge.classList.add('show');
      $dirtyCount.textContent = `${fmtNum(n)} unsaved change${n===1?'':'s'}`;
    } else {
      $dirtyBadge.classList.remove('show');
    }
    // Reflect dirty state on the file-tree row.
    renderFileTree();
  }

  /* Active card / keyboard nav */
  function setActive(origIdx, scroll=true){
    state.activeOrigIdx = origIdx;
    markActive();
    if (scroll){
      const card = getActiveCard();
      if (card) card.scrollIntoView({ block:'nearest', behavior:'smooth' });
    }
  }
  function markActive(){
    $list.querySelectorAll('.card.active').forEach(c => c.classList.remove('active'));
    const card = getActiveCard();
    if (card) card.classList.add('active');
  }
  function getActiveCard(){
    if (state.activeOrigIdx < 0) return null;
    const it = state.items[state.activeOrigIdx];
    if (!it || !it._cardEl) return null;
    return it._cardEl.isConnected ? it._cardEl : null;
  }
  function jumpRelative(delta){
    const view = state.viewItems;
    if (!view.length) return;
    let idx = view.findIndex(it => it.origIdx === state.activeOrigIdx);
    if (idx < 0) idx = (delta > 0) ? -1 : view.length;
    let target = idx + delta;
    target = Math.max(0, Math.min(view.length - 1, target));
    const prevPages = state.pagesShown;
    while (target >= state.pageSize * state.pagesShown){
      state.pagesShown++;
    }
    if (state.pagesShown !== prevPages) renderView();
    setActive(view[target].origIdx, true);
  }

  /* Parsing */
  function tryParseFullJSON(text){
    try { return { ok:true, value: JSON.parse(text) }; }
    catch (e){ return { ok:false, error: e }; }
  }

  function parseAsJSON(value, originalText){
    state.mode = 'json';
    const items = [];
    if (Array.isArray(value)){
      state.sourceShape = 'array';
      value.forEach((item, i) => {
        let raw;
        try { raw = JSON.stringify(item); } catch { raw = ''; }
        items.push(makeItem(i, 'Item', raw, item, false));
      });
    } else {
      state.sourceShape = 'single';
      let raw;
      try { raw = JSON.stringify(value); } catch { raw = originalText; }
      items.push(makeItem(0, 'Item', raw, value, false));
    }
    return items;
  }

  function parseAsJSONL(text){
    state.mode = 'jsonl';
    state.sourceShape = 'jsonl';
    const items = [];
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
      if (line.trim() === '') return;
      try {
        const parsed = JSON.parse(line);
        items.push(makeItem(i, 'Line', line, parsed, false));
      } catch {
        items.push(makeItem(i, 'Line', line, null, true));
      }
    });
    return items;
  }

  /* Load file */
  function resetView(){
    state.items = [];
    state.schema = new Map();
    state.selectedKeys = new Set();
    state.viewItems = [];
    state.pagesShown = 1;
    state.activeOrigIdx = -1;
    state.searchQuery = '';
    state.minTokens = null;
    state.maxTokens = null;
    state.sortMode = 'default';
    $search.value = '';
    $minTokens.value = '';
    $maxTokens.value = '';
    $sortSel.value = 'default';
    $list.replaceChildren();
    $loadMore.replaceChildren();
    updateDirtyBadge();
  }

  // Parse a single File into the current state slot. Used by both initial
  // load (no prior file) and append-as-new-file (multi-file mode).
  async function _parseFileIntoState(file, folder=''){
    resetView();
    state.fileName = file.name;
    updateStats();

    const text = await file.text();
    const lower = (file.name || '').toLowerCase();

    let items;
    if (lower.endsWith('.json')) {
      const full = tryParseFullJSON(text);
      items = full.ok ? parseAsJSON(full.value, text) : parseAsJSONL(text);
    } else {
      const full = tryParseFullJSON(text);
      if (full.ok && (typeof full.value !== 'string')) items = parseAsJSON(full.value, text);
      else items = parseAsJSONL(text);
    }
    items.forEach((it, i) => { it.origIdx = i; });
    state.items = items;
  }

  async function loadFile(file, opts={}){
    const folder = opts.folder || '';
    // If we have an active file with edits, snapshot it before parking;
    // we now ALWAYS open additional files as new tabs (no overwrite).
    snapshotCurrent();
    await _parseFileIntoState(file, folder);

    // Register new file slot.
    const id = newFileId();
    const slot = {id, folder, snapshot:null};
    state.files.push(slot);
    state.activeId = id;
    snapshotCurrent();

    analyzeSchema();
    renderSidebar();
    renderView();
    renderFileTree();

    $drop.classList.add('compact');
    const main = $drop.firstElementChild;
    main.replaceChildren();
    main.append(el('strong', null, file.name),
                document.createTextNode(' active — drop more, click ‹+ Files› / ‹+ Folder›, or pick another from the left.'));
  }

  async function loadFiles(fileList, opts={}){
    if (!fileList || !fileList.length) return;
    // For folder upload, use webkitRelativePath as folder source.
    const filtered = [...fileList].filter(f => /\.(json|jsonl|txt|log)$/i.test(f.name));
    if (!filtered.length){ showToast('No .json/.jsonl files found', 'err'); return; }
    for (const f of filtered){
      const rel = f.webkitRelativePath || '';
      const folder = rel ? rel.split('/').slice(0,-1).join('/') : (opts.folder || '');
      await loadFile(f, {folder});
    }
    showToast(`Loaded ${filtered.length} file${filtered.length===1?'':'s'}`);
  }

  /* ---------- File tree render ---------- */
  function renderFileTree(){
    const tree = $('fileTree');
    if (!tree) return;
    if (!state.files.length){
      tree.replaceChildren(el('div','file-tree-empty','No files open. Drop here or use the buttons below.'));
      return;
    }
    // Group by folder path
    const groups = new Map(); // folderPath -> [slots]
    for (const f of state.files){
      const k = f.folder || '';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(f);
    }
    const frag = document.createDocumentFragment();
    // Root files first (no folder)
    if (groups.has('')){
      for (const slot of groups.get('')) frag.append(buildFileRow(slot));
      groups.delete('');
    }
    const folderNames = [...groups.keys()].sort();
    for (const fname of folderNames){
      frag.append(buildFolderRow(fname, groups.get(fname)));
    }
    tree.replaceChildren(frag);
  }
  function buildFileRow(slot){
    const live = (slot.id === state.activeId);
    const s = live ? state : (slot.snapshot || {});
    const row = el('div','file-row');
    row.dataset.id = slot.id;
    if (live) row.classList.add('active');
    const items = s.items || [];
    const dirty = items.some(it => it.dirty || it.deleted);
    if (dirty) row.classList.add('dirty');
    const ext = (s.fileName || '').toLowerCase().endsWith('.jsonl') ? 'JSONL' : 'JSON';
    row.append(
      el('span','file-icon', ext),
      el('span','file-name', s.fileName || '(untitled)'),
      el('span','file-meta', String(items.filter(it=>!it.deleted).length))
    );
    const close = el('button','file-close','×');
    close.title = 'Close file';
    close.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (dirty){
        const ok = await confirmModal({
          title:'Close file with unsaved edits?',
          body:'Edits in “' + (s.fileName || 'this file') + '” will be lost.',
          okLabel:'Close', dangerous:true
        });
        if (!ok) return;
      }
      closeFile(slot.id);
    });
    row.append(close);
    row.addEventListener('click', () => switchToFile(slot.id));
    return row;
  }
  function buildFolderRow(name, slots){
    const wrap = document.createDocumentFragment();
    const head = el('div','folder-row open');
    head.append(
      el('span','folder-caret'),
      el('span','folder-icon','📁'),
      el('span','file-name', name + '/'),
      el('span','file-meta', String(slots.length))
    );
    const kids = el('div','folder-children');
    for (const slot of slots) kids.append(buildFileRow(slot));
    head.addEventListener('click', () => {
      const isOpen = head.classList.toggle('open') === false ? false : head.classList.contains('open');
      kids.classList.toggle('collapsed', !isOpen);
    });
    wrap.append(head, kids);
    return wrap;
  }

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
  function saveFile(){
    const live = state.items.filter(it => !it.deleted);
    if (!live.length){ showToast('Nothing to save'); return; }
    let text, ext, mime;
    if (state.sourceShape === 'array'){
      const arr = live.map(it => it.error ? null : it.parsed);
      text = JSON.stringify(arr, null, 2);
      ext = 'json'; mime = 'application/json';
    } else if (state.sourceShape === 'single'){
      const v = live[0].error ? null : live[0].parsed;
      text = JSON.stringify(v, null, 2);
      ext = 'json'; mime = 'application/json';
    } else {
      const lines = live.map(it => exportRawFor(it)).filter(Boolean);
      text = lines.join('\n') + '\n';
      ext = 'jsonl'; mime = 'application/jsonl';
    }
    const blob = new Blob([text], {type:mime});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const base = (state.fileName || 'export').replace(/\.(json|jsonl|txt|log)$/i, '');
    a.href = url;
    a.download = `${base}-edited.${ext}`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    for (const it of state.items) it.dirty = false;
    state.items = state.items.filter(it => !it.deleted);
    state.items.forEach((it, i)=>{ it.origIdx = i; it.fileIdx = i; it._cardEl = null; it.originalParsed = it.error ? null : structuredClone(it.parsed); });
    analyzeSchema(); renderSidebar();
    renderView();
    updateDirtyBadge();
    showToast(`Saved ${fmtNum(live.length)} item${live.length===1?'':'s'}`);
  }

  /* Sort / length filter */
  $sortSel.addEventListener('change', () => {
    state.sortMode = $sortSel.value;
    state.pagesShown = 1;
    renderView();
  });
  function readNumOrNull(v){
    if (v === '' || v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  function onLengthChange(){
    state.minTokens = readNumOrNull($minTokens.value);
    state.maxTokens = readNumOrNull($maxTokens.value);
    state.pagesShown = 1;
    renderView();
  }
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
  async function handleDrop(e){
    const dt = e.dataTransfer;
    if (!dt) return;
    // Try entry API for folder support
    const entries = [];
    if (dt.items && dt.items.length){
      for (const it of dt.items){
        if (typeof it.webkitGetAsEntry === 'function'){
          const ent = it.webkitGetAsEntry();
          if (ent) entries.push(ent);
        }
      }
    }
    if (entries.length){
      const collected = [];
      for (const ent of entries){
        await collectEntry(ent, '', collected);
      }
      if (collected.length){ await loadFiles(collected); return; }
    }
    // Fallback: plain files list
    if (dt.files && dt.files.length) await loadFiles(dt.files);
  }
  function collectEntry(entry, folderPath, out){
    return new Promise(resolve => {
      if (entry.isFile){
        entry.file(file => {
          // Decorate webkitRelativePath via folderPath
          if (folderPath) try { Object.defineProperty(file, 'webkitRelativePath', {value: folderPath + '/' + file.name}); } catch {}
          out.push(file);
          resolve();
        }, () => resolve());
      } else if (entry.isDirectory){
        const reader = entry.createReader();
        const next = folderPath ? folderPath + '/' + entry.name : entry.name;
        const readBatch = () => reader.readEntries(async (batch) => {
          if (!batch.length){ resolve(); return; }
          for (const child of batch) await collectEntry(child, next, out);
          readBatch();
        }, () => resolve());
        readBatch();
      } else { resolve(); }
    });
  }

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
  function toggleActiveTree(open){
    const card = getActiveCard();
    const target = card || $list;
    target.querySelectorAll('details.tree-node').forEach(d => d.open = open);
  }

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
  updateStats();
  renderSidebar();
  renderFileTree();
  updateDirtyBadge();
})();

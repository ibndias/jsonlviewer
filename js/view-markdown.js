// js/view-markdown.js
import { state } from './state.js';
import { renderStringSpan } from './view-node.js';

export function applyMarkdownMode(){
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
export function safeHref(url){
  const u = String(url).trim();
  if (/^(javascript|data|vbscript):/i.test(u)) return '#';
  return u;
}

export function appendInline(parent, text){
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

export function renderMarkdownToDOM(text){
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

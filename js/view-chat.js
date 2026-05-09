// js/view-chat.js
import { el } from './dom.js';
import { state } from './state.js';
import { renderMarkdownToDOM } from './view-markdown.js';

export function detectChatFormat(parsed){
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

export function renderChatView(messages){
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

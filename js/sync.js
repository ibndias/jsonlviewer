// js/sync.js — BroadcastChannel pub/sub between tabs.
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

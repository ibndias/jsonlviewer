// js/schema.js
import { el, $schemaKeys, $sideActions } from './dom.js';
import { state, liveItems } from './state.js';

export function analyzeSchema(){
  const m = new Map();
  for (const it of liveItems()){
    for (const k of it.topKeys){
      m.set(k, (m.get(k) || 0) + 1);
    }
  }
  state.schema = m;
}

export function renderSidebar(){
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
      window.renderView();
    });
    frag.append(chip);
  }
  $schemaKeys.replaceChildren(frag);
  $sideActions.style.display = state.selectedKeys.size ? '' : 'none';
}

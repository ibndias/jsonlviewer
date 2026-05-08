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
  inp.className = 'search';
  inp.style.width = '100%';
  inp.style.boxSizing = 'border-box';
  inp.placeholder = placeholder || '';
  $modalBody.append(inp);
  return inp;
}

export function confirmModal({title='Confirm', body='Are you sure?', okLabel='OK', dangerous=false}={}){
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

export function promptKey(){
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

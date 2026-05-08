// js/view-colorize.js
import { state } from './state.js';

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

export function keyColor(name){
  const hue = keyHue(name);
  const lightness = isDarkTheme() ? 72 : 38;
  return `hsl(${hue}, 70%, ${lightness}%)`;
}

export function applyColorize(){
  document.querySelectorAll('.key').forEach(elx => {
    if (state.colorize){
      const k = elx.dataset.key || '';
      elx.style.color = keyColor(k);
    } else {
      elx.style.color = '';
    }
  });
}

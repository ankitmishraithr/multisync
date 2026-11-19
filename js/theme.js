// Day / night theme. 'auto' follows the device setting and reacts when it changes.
import { loadSettings, saveSettings } from './store.js';

const media = window.matchMedia('(prefers-color-scheme: dark)');
let mode = loadSettings().theme;
const listeners = new Set();

function resolve() {
  return mode === 'auto' ? (media.matches ? 'dark' : 'light') : mode;
}

function apply() {
  document.documentElement.dataset.theme = resolve();
  listeners.forEach((fn) => fn(mode, resolve()));
}

export function setTheme(next) {
  mode = ['auto', 'light', 'dark'].includes(next) ? next : 'auto';
  saveSettings({ ...loadSettings(), theme: mode });
  apply();
}

export const getTheme = () => mode;
export const resolvedTheme = resolve;
export const cycleTheme = () => setTheme({ auto: 'light', light: 'dark', dark: 'auto' }[mode]);
export function onTheme(fn) {
  listeners.add(fn);
  fn(mode, resolve());
}

media.addEventListener('change', apply);
apply();

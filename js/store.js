// Small localStorage helpers. Everything stays in this browser; nothing is sent anywhere.
// Storage can be unavailable (private mode, blocked cookies) so every call is guarded.

const SETTINGS_KEY = 'multisync.settings';
const RECENT_KEY = 'multisync.recent';
const SAVED_KEY = 'multisync.saved';

export const DEFAULTS = { volume: 100, autoSync: true, threshold: 0.5, theme: 'auto', autoHide: false, stayLive: true };

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore: it just won't persist */
  }
}

const list = (key) => {
  const value = read(key, []);
  return Array.isArray(value) ? value : [];
};

export const loadSettings = () => ({ ...DEFAULTS, ...read(SETTINGS_KEY, {}) });
export const saveSettings = (settings) => write(SETTINGS_KEY, settings);

export const loadRecent = () => list(RECENT_KEY);
/** Remember a session (keyed by its videos so re-tuning offsets doesn't pile up entries). */
export function rememberSession(key, query, label) {
  const items = loadRecent().filter((item) => item.key !== key);
  items.unshift({ key, query, label, at: Date.now() });
  write(RECENT_KEY, items.slice(0, 8));
}
export const clearRecent = () => write(RECENT_KEY, []);

export const loadSaved = () => list(SAVED_KEY);
export function saveNamed(name, query) {
  const items = loadSaved().filter((item) => item.name !== name);
  items.unshift({ name, query, at: Date.now() });
  write(SAVED_KEY, items.slice(0, 30));
}
export const removeSaved = (name) => write(SAVED_KEY, loadSaved().filter((item) => item.name !== name));

// ---------- YouTube search: the user's own API key and recent searches ----------
const KEY_KEY = 'multisync.youtubeKey';
const SEARCHES_KEY = 'multisync.searches';

export const loadApiKey = () => String(read(KEY_KEY, '') || '');
export const saveApiKey = (key) => write(KEY_KEY, String(key || '').trim());
export const loadSearches = () => list(SEARCHES_KEY).filter((s) => typeof s === 'string');
export function rememberSearch(query) {
  const q = query.trim();
  if (!q) return;
  write(SEARCHES_KEY, [q, ...loadSearches().filter((s) => s.toLowerCase() !== q.toLowerCase())].slice(0, 6));
}
export const clearSearches = () => write(SEARCHES_KEY, []);

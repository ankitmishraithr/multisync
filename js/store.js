// Small localStorage helpers. Everything stays in this browser; nothing is sent anywhere.
// Storage can be unavailable (private mode, blocked cookies) so every call is guarded.

const SETTINGS_KEY = 'multisync.settings';
const RECENT_KEY = 'multisync.recent';

export const DEFAULTS = { volume: 100, autoSync: true, threshold: 0.5 };

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
    /* ignore: settings just won't persist */
  }
}

export function loadSettings() {
  return { ...DEFAULTS, ...read(SETTINGS_KEY, {}) };
}

export function saveSettings(settings) {
  write(SETTINGS_KEY, settings);
}

export function loadRecent() {
  const list = read(RECENT_KEY, []);
  return Array.isArray(list) ? list : [];
}

/** Remember a session (keyed by its video IDs so re-tuning offsets doesn't pile up entries). */
export function rememberSession(key, query, label) {
  const list = loadRecent().filter((item) => item.key !== key);
  list.unshift({ key, query, label, at: Date.now() });
  write(RECENT_KEY, list.slice(0, 8));
}

export function clearRecent() {
  try {
    localStorage.removeItem(RECENT_KEY);
  } catch {
    /* ignore */
  }
}

// Site settings.
//
// SEARCH_HELPER: the address of a copy of server.js running online (for example on Render),
// used for keyless YouTube search when the pages themselves come from a plain file host such
// as GitHub Pages. Leave it empty if there is none; search then needs MultiSync to be started
// with "npm start", or a free YouTube key.
const DEFAULT_SEARCH_HELPER = 'https://multisync-kjlo.onrender.com';

export const SEARCH_HELPER = String(globalThis.MULTISYNC_SEARCH_HELPER ?? DEFAULT_SEARCH_HELPER).replace(/\/+$/, '');

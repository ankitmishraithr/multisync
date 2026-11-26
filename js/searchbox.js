// The "find videos" box used on both pages: type to search YouTube (with suggestions),
// or paste links. Results stay open so several videos can be added from one search.
import { parseInput, formatTime } from './parse.js';
import { searchYouTube, searchLocal, localSearchAvailable, suggest, SearchError } from './ytsearch.js';
import { loadApiKey, saveApiKey, loadSearches, rememberSearch, clearSearches } from './store.js';
import { icon } from './icons.js';

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

/**
 * refs: { input, button, suggestBox, panel, error }
 * hooks: { onLinks(videos), onAdd(video), onRemove(video), isAdded(video) }
 * Returns { refresh() } — call refresh() when the session's videos change so "Added" marks stay right.
 */
export function mountSearch(refs, hooks) {
  const { input, button, suggestBox, panel, error } = refs;
  const state = { q: '', live: false, items: [], next: '', loading: false, shown: false, active: -1, options: [], typed: 0, keyless: false };
  const label = button.querySelector('.lbl') || button;

  const looksLikeLinks = () => parseInput(input.value).length > 0;

  function setButton() {
    const links = looksLikeLinks();
    label.textContent = links ? 'Add' : 'Search';
    button.dataset.mode = links ? 'links' : 'search';
  }

  // ---------- suggestions ----------

  function closeSuggest() {
    suggestBox.hidden = true;
    suggestBox.replaceChildren();
    state.options = [];
    state.active = -1;
    input.setAttribute('aria-expanded', 'false');
  }

  function showSuggest(list, heading) {
    state.options = list;
    state.active = -1;
    if (!list.length) return closeSuggest();
    suggestBox.replaceChildren();
    if (heading) {
      const clear = el('button', { className: 'link-btn', textContent: 'Clear', type: 'button' });
      clear.addEventListener('mousedown', (e) => { e.preventDefault(); clearSearches(); closeSuggest(); });
      suggestBox.append(el('li', { className: 'suggest-head', role: 'presentation' }, [el('span', { textContent: heading }), clear]));
    }
    list.forEach((text, i) => {
      const li = el('li', { role: 'option', id: `${suggestBox.id}-${i}`, textContent: text });
      // mousedown, not click: it fires before the input loses focus
      li.addEventListener('mousedown', (e) => { e.preventDefault(); input.value = text; runSearch(text); });
      suggestBox.append(li);
    });
    suggestBox.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  function moveActive(delta) {
    const n = state.options.length;
    if (!n) return;
    state.active = (state.active + delta + n + (state.active < 0 && delta < 0 ? 1 : 0)) % n;
    [...suggestBox.querySelectorAll('[role=option]')].forEach((li, i) => li.classList.toggle('active', i === state.active));
    input.setAttribute('aria-activedescendant', `${suggestBox.id}-${state.active}`);
  }

  let timer;
  function onType() {
    setButton();
    error.textContent = '';
    clearTimeout(timer);
    const text = input.value.trim();
    if (!text) return showSuggest(loadSearches(), 'Recent searches');
    if (looksLikeLinks() || text.length < 2) return closeSuggest();
    const ticket = ++state.typed;
    timer = setTimeout(async () => {
      const list = await suggest(text);
      // Ignore answers that arrive after the user typed more or moved on.
      if (ticket === state.typed && document.activeElement === input && input.value.trim() === text) showSuggest(list);
    }, 180);
  }

  // ---------- results ----------

  function card(item) {
    const video = { kind: 'youtube', id: item.id, start: 0 };
    const added = hooks.isAdded(video);
    const tag = item.live ? el('span', { className: 'badge', textContent: 'LIVE' })
      : item.upcoming ? el('span', { className: 'len', textContent: 'Upcoming' })
      : item.duration ? el('span', { className: 'len', textContent: formatTime(item.duration) }) : '';
    const mark = el('span', { className: 'pick' });
    mark.innerHTML = icon(added ? 'check' : 'plus');
    mark.append(added ? 'Added' : 'Add');
    const shot = el('span', { className: 'shot' }, [tag]);
    if (item.thumb) shot.style.backgroundImage = `url("${item.thumb}")`;
    const b = el('button', { className: 'result', type: 'button', title: item.title }, [
      shot,
      el('span', { className: 'meta' }, [el('strong', { textContent: item.title }), el('small', { textContent: item.channel })]),
      mark,
    ]);
    b.setAttribute('aria-pressed', String(added));
    b.addEventListener('click', () => {
      if (hooks.isAdded(video)) hooks.onRemove(video);
      else if (hooks.onAdd(video) === false) return; // session is full; the page explains
      drawResults();
    });
    return b;
  }

  function closeResults() {
    state.shown = false;
    panel.hidden = true;
    panel.replaceChildren();
  }

  function head() {
    const all = el('button', { type: 'button', textContent: 'All' });
    const live = el('button', { type: 'button', textContent: 'Live now' });
    all.classList.toggle('on', !state.live);
    live.classList.toggle('on', state.live);
    all.addEventListener('click', () => state.live && runSearch(state.q, false));
    live.addEventListener('click', () => !state.live && runSearch(state.q, true));
    const keyBtn = el('button', { className: 'link-btn', type: 'button', textContent: 'Key' , title: 'Change or remove your YouTube key' });
    keyBtn.addEventListener('click', () => drawSetup(''));
    const close = el('button', { className: 'icon-btn', type: 'button', title: 'Close results' });
    close.innerHTML = icon('close');
    close.setAttribute('aria-label', 'Close results');
    close.addEventListener('click', closeResults);
    return el('div', { className: 'results-head' }, [
      el('strong', { textContent: `Results for "${state.q}"` }),
      el('div', { className: 'seg' }, [all, live]),
      ...(state.keyless ? [] : [keyBtn]), // no key in use, so nothing to manage
      close,
    ]);
  }

  function drawResults() {
    if (!state.shown) return;
    panel.hidden = false;
    panel.replaceChildren(head());
    if (state.loading && !state.items.length) {
      panel.append(el('p', { className: 'results-note', textContent: 'Searching…' }));
      return;
    }
    if (!state.items.length) {
      panel.append(el('p', { className: 'results-note', textContent: state.live ? 'No live streams match that right now. Try "All".' : 'No videos found. Try different words.' }));
      return;
    }
    panel.append(el('div', { className: 'results-grid' }, state.items.map(card)));
    const foot = el('div', { className: 'results-foot' });
    if (state.next) {
      const more = el('button', { className: 'btn', type: 'button', textContent: state.loading ? 'Loading…' : 'More results', disabled: state.loading });
      more.addEventListener('click', () => runSearch(state.q, state.live, state.next));
      foot.append(more);
    }
    foot.append(el('span', { className: 'note', textContent: state.keyless
      ? 'Click several to add them all. No key needed.'
      : 'Click several to add them all. Each search or "More" uses 1 of about 100 free searches a day.' }));
    panel.append(foot);
  }

  /** Shown the first time someone searches: how to get the free key, and where to put it. */
  function drawSetup(problem) {
    state.shown = true;
    panel.hidden = false;
    const field = el('input', { type: 'password', placeholder: 'Paste your key here', autocomplete: 'off', spellcheck: false, value: loadApiKey() });
    field.setAttribute('aria-label', 'YouTube API key');
    const save = el('button', { className: 'btn primary', type: 'button', textContent: 'Save key' });
    const remove = el('button', { className: 'btn quiet', type: 'button', textContent: 'Remove key', hidden: !loadApiKey() });
    const close = el('button', { className: 'btn quiet', type: 'button', textContent: 'Not now' });
    const commit = () => {
      const key = field.value.trim();
      if (!/^[\w-]{20,}$/.test(key)) {
        field.focus();
        note.textContent = 'That does not look like a key. It is one long word of letters, numbers, - and _.';
        return;
      }
      saveApiKey(key);
      if (state.q) runSearch(state.q, state.live);
      else closeResults();
    };
    save.addEventListener('click', commit);
    field.addEventListener('keydown', (e) => e.key === 'Enter' && commit());
    remove.addEventListener('click', () => { saveApiKey(''); closeResults(); });
    close.addEventListener('click', closeResults);
    const note = el('p', { className: 'error', textContent: problem || '' });
    note.setAttribute('role', 'alert');
    const link = el('a', { href: 'https://console.cloud.google.com/apis/library/youtube.googleapis.com', target: '_blank', rel: 'noopener', textContent: 'YouTube Data API v3 in Google Cloud' });
    const steps = el('ol', {}, [
      el('li', {}, ['Open ', link, ' and sign in with any Google account.']),
      el('li', { textContent: 'Create a project if asked, then press Enable.' }),
      el('li', { textContent: 'Go to Credentials, press Create credentials, and choose API key.' }),
      el('li', { textContent: 'Copy the key and paste it below.' }),
    ]);
    panel.replaceChildren(
      el('div', { className: 'setup' }, [
        el('strong', { textContent: 'Search is not available here right now' }),
        el('p', { className: 'note', textContent: 'This copy of MultiSync has no search helper answering. Pasting links still works. To search here, add a free YouTube key below (one time, about 5 minutes, about 100 searches a day, saved only in this browser). If you run MultiSync yourself with "npm start", search needs no key.' }),
        steps,
        el('div', { className: 'row' }, [field, save]),
        note,
        el('div', { className: 'row' }, [close, remove]),
      ]),
    );
  }

  async function runSearch(query, live = state.live, pageToken = '') {
    const q = String(query || '').trim();
    if (!q) return;
    closeSuggest();
    state.typed++; // cancel any suggestion still on its way
    const fresh = !pageToken;
    Object.assign(state, { q, live, shown: true });
    if (fresh) Object.assign(state, { items: [], next: '' });
    const key = loadApiKey();
    // Opened from MultiSync's own server? Then search needs no key. A saved key is the backup.
    const local = await localSearchAvailable(() => {
      panel.hidden = false;
      panel.replaceChildren(el('p', { className: 'results-note', textContent: 'Waking up the search helper. After a quiet period this can take up to a minute…' }));
    });
    if (state.q !== q) return; // the user searched for something else while waiting
    if (!local && !key) return drawSetup('');
    state.keyless = local && !pageToken;
    state.loading = true;
    drawResults();
    try {
      let page;
      if (local && !pageToken) {
        try {
          page = await searchLocal({ q, live });
        } catch (failure) {
          if (!key) throw failure;
          state.keyless = false;
          page = await searchYouTube({ q, key, live, pageToken }); // quietly use the key instead
        }
      } else {
        page = await searchYouTube({ q, key, live, pageToken });
      }
      if (state.q !== q || state.live !== live) return; // a newer search replaced this one
      const seen = new Set(state.items.map((i) => i.id));
      state.items = fresh ? page.items : [...state.items, ...page.items.filter((i) => !seen.has(i.id))];
      state.next = page.next;
      rememberSearch(q);
    } catch (e) {
      state.loading = false;
      if (e instanceof SearchError && e.badKey) return drawSetup(e.message);
      if (e instanceof SearchError && e.local && !state.items.length) {
        return drawSetup(`${e.message} YouTube may have changed its page. Try again in a minute, or add a free key so search keeps working.`);
      }
      error.textContent = e instanceof SearchError ? e.message : 'Search failed. Try again.';
      if (!state.items.length) closeResults();
      else drawResults();
      return;
    }
    state.loading = false;
    drawResults();
  }

  function submit() {
    const text = input.value.trim();
    if (!text) return;
    const links = parseInput(text);
    if (links.length) {
      closeSuggest();
      hooks.onLinks(links, text);
      setButton();
      return;
    }
    if (state.active >= 0 && state.options[state.active]) input.value = state.options[state.active];
    runSearch(input.value);
  }

  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', suggestBox.id);
  input.setAttribute('aria-expanded', 'false');
  input.addEventListener('input', onType);
  input.addEventListener('focus', () => !input.value.trim() && showSuggest(loadSearches(), 'Recent searches'));
  input.addEventListener('blur', () => setTimeout(closeSuggest, 120));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && state.options.length) { e.preventDefault(); moveActive(1); }
    else if (e.key === 'ArrowUp' && state.options.length) { e.preventDefault(); moveActive(-1); }
    else if (e.key === 'Escape' && !suggestBox.hidden) { e.stopPropagation(); closeSuggest(); }
    else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  });
  // Pasted links are added straight away; pasted words are left for the user to search.
  input.addEventListener('paste', () => setTimeout(() => looksLikeLinks() && submit(), 0));
  button.addEventListener('click', submit);
  setButton();

  return { refresh: drawResults, close: closeResults };
}

// A tiny inline icon set (no icon font, no network). Usage in HTML: <button data-icon="play">
const stroke = (d) => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
const fill = (d) => `<path d="${d}" fill="currentColor"/>`;

const ICONS = {
  play: fill('M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z'),
  pause: fill('M6 4h4v16H6zM14 4h4v16h-4z'),
  sync: stroke('M20 5v5h-5M4 19v-5h5M19.4 10A8 8 0 0 0 5.2 8M4.6 14a8 8 0 0 0 14.2 2'),
  volume: stroke('M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4zM15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.8 7.8 0 0 1 0 11'),
  mute: stroke('M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4zM16 9.5l5 5M21 9.5l-5 5'),
  plus: stroke('M12 5v14M5 12h14'),
  chat: stroke('M4 5h16v11H10l-5 4v-4H4z'),
  grid: stroke('M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z'),
  focus: stroke('M3 5h12v10H3zM18 7h3M18 11h3M18 15h3M3 19h18'),
  full: stroke('M8 4H4v4M16 4h4v4M8 20H4v-4M16 20h4v-4'),
  more: fill('M5 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm7 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm7 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4z'),
  close: stroke('M6 6l12 12M18 6L6 18'),
  link: stroke('M10 14a4 4 0 0 0 5.7 0l3-3A4 4 0 0 0 13 5.3l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1'),
  sun: stroke('M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4'),
  moon: stroke('M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z'),
  auto: stroke('M12 3a9 9 0 1 0 0 18zM12 3a9 9 0 0 1 0 18'),
  earlier: stroke('M14 6l-6 6 6 6'),
  later: stroke('M10 6l6 6-6 6'),
  up: stroke('M6 14l6-6 6 6'),
  down: stroke('M6 10l6 6 6-6'),
  edit: stroke('M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4'),
  lock: stroke('M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3'),
  keyboard: stroke('M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10'),
  back10: `${stroke('M12 6a7 7 0 1 1-6.58 4.6M14.5 3l-3 3 3 3')}<text x="12" y="16" font-size="7" text-anchor="middle" fill="currentColor" font-weight="700" font-family="system-ui,sans-serif">10</text>`,
  fwd10: `<g transform="translate(24 0) scale(-1 1)">${stroke('M12 6a7 7 0 1 1-6.58 4.6M14.5 3l-3 3 3 3')}</g><text x="12" y="16" font-size="7" text-anchor="middle" fill="currentColor" font-weight="700" font-family="system-ui,sans-serif">10</text>`,
  back: stroke('M11 6l-6 6 6 6M5 12h14'),
};

export function icon(name) {
  return `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`;
}

/** Fill every [data-icon] element. Text inside the element is kept as a label after the icon. */
export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    if (el.dataset.iconDone === el.dataset.icon) return;
    el.querySelector(':scope > svg')?.remove();
    el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon));
    el.dataset.iconDone = el.dataset.icon;
  });
}

export function setIcon(el, name) {
  el.dataset.icon = name;
  hydrateIcons(el.parentNode || document);
}

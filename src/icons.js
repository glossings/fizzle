// Line icons for the on-screen controls: the touch bar in the app and the
// example blocks in the docs draw from the same set.

const svg = (inner, stroke = true) =>
  `<svg viewBox="0 0 24 24" fill="${stroke ? 'none' : 'currentColor'}" ${
    stroke ? 'stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"' : ''
  } aria-hidden="true">${inner}</svg>`;

export const ICON = {
  play: svg('<path d="M7.5 4.7 19.3 12 7.5 19.3z"/>', false),
  pause: svg('<rect x="7" y="5" width="3.6" height="14" rx="1.6"/><rect x="13.4" y="5" width="3.6" height="14" rx="1.6"/>', false),
  stop: svg('<rect x="6" y="6" width="12" height="12" rx="2"/>', false),
  run: svg('<polyline points="21.5 4.5 21.5 10 16 10"/><polyline points="2.5 19.5 2.5 14 8 14"/><path d="M4.6 9.2a8 8 0 0 1 13.2-3L21.5 10M2.5 14l3.7 3.8a8 8 0 0 0 13.2-3"/>'),
  code: svg('<polyline points="15.5 17.5 21 12 15.5 6.5"/><polyline points="8.5 6.5 3 12 8.5 17.5"/>'),
  codeOff: svg('<polyline points="15.5 17.5 21 12 15.5 6.5"/><polyline points="8.5 6.5 3 12 8.5 17.5"/><line x1="3.5" y1="20.5" x2="20.5" y2="3.5"/>'),
  rec: svg('<circle cx="12" cy="12" r="6.5"/>', false),
  recStop: svg('<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>', false),
  back: svg('<polyline points="9.5 5.5 4 11 9.5 16.5"/><path d="M4 11h10a6 6 0 0 1 6 6v2"/>'),
  open: svg('<polyline points="14 3.5 20.5 3.5 20.5 10"/><line x1="20.5" y1="3.5" x2="11.5" y2="12.5"/><path d="M17.5 14.5V19a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 19V8.5A1.5 1.5 0 0 1 5.5 7H10"/>'),
};

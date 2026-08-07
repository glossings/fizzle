// What a phone doesn't have. Everything fizzle leans on for control is a
// keyboard shortcut, so on a touch screen the three that matter — run, pause,
// hide the code — become a small stack of buttons over the picture, pinch
// takes over from the font-size box in the sidebar, and the on-screen keyboard
// gets measured so it can't sit on top of either.
//
// The rule the gestures follow is one surface at a time: a mouse can point at
// the code and the picture at once, a finger can't. With the code up #editor
// takes the whole window and every event in it (see the coarse-pointer block
// in style.css); hidden, it's display: none and the canvas has the lot. So
// nothing here has to guess which of the two a drag or a pinch was aimed at.
//
// A trackpad iPad reports hover, and it has the keys anyway — so the gate is
// coarse *and* hoverless, and on a laptop none of this exists.
export const isTouch = matchMedia('(hover: none) and (pointer: coarse)').matches;

// Prose that names a key has to name something else here.
export const RUN_HINT = isTouch ? 'tap ↻' : 'press ctrl+enter';
export const PLAY_HINT = isTouch ? 'tap ▶' : 'ctrl+.';

const svg = (inner, stroke = true) =>
  `<svg viewBox="0 0 24 24" fill="${stroke ? 'none' : 'currentColor'}" ${
    stroke ? 'stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"' : ''
  } aria-hidden="true">${inner}</svg>`;

const ICON = {
  play: svg('<path d="M7.5 4.7 19.3 12 7.5 19.3z"/>', false),
  pause: svg('<rect x="7" y="5" width="3.6" height="14" rx="1.6"/><rect x="13.4" y="5" width="3.6" height="14" rx="1.6"/>', false),
  run: svg('<polyline points="21.5 4.5 21.5 10 16 10"/><polyline points="2.5 19.5 2.5 14 8 14"/><path d="M4.6 9.2a8 8 0 0 1 13.2-3L21.5 10M2.5 14l3.7 3.8a8 8 0 0 0 13.2-3"/>'),
  code: svg('<polyline points="15.5 17.5 21 12 15.5 6.5"/><polyline points="8.5 6.5 3 12 8.5 17.5"/>'),
  codeOff: svg('<polyline points="15.5 17.5 21 12 15.5 6.5"/><polyline points="8.5 6.5 3 12 8.5 17.5"/><line x1="3.5" y1="20.5" x2="20.5" y2="3.5"/>'),
};

// The three controls, bottom right, over whichever corner of the picture is
// there. `playing`/`codeHidden` are read back after every press rather than
// tracked here — pausing and hiding both have other ways in (a run resumes
// playback), and a button showing the wrong glyph is worse than no button.
export function initTouchBar({ playing, codeHidden, onPlay, onRun, onToggleCode }) {
  const bar = document.createElement('div');
  bar.id = 'touchbar';

  const make = (label, icon, onTap) => {
    const b = document.createElement('button');
    b.className = 'tb-btn';
    b.innerHTML = icon;
    b.setAttribute('aria-label', label);
    b.addEventListener('click', onTap);
    bar.appendChild(b);
    return b;
  };

  const playBtn = make('play / pause', ICON.play, () => { onPlay(); refresh(); });
  const runBtn = make('run the sketch', ICON.run, () => {
    onRun();
    refresh();
    // the status line says what happened; this is just the press landing
    runBtn.classList.add('flash');
    setTimeout(() => runBtn.classList.remove('flash'), 260);
  });
  const codeBtn = make('hide / show the code', ICON.code, () => { onToggleCode(); refresh(); });

  // With the code gone you're watching, not typing, so the buttons get out of
  // the way rather than sitting bright over the picture — but not while
  // they're being used, or hiding the code would fade the hand that did it.
  let sleep;
  const wake = () => {
    bar.classList.remove('dim');
    clearTimeout(sleep);
    sleep = setTimeout(() => bar.classList.toggle('dim', codeHidden()), 2600);
  };

  // Only on a change: replacing the <svg> under a finger that's still on the
  // button is how a press goes missing.
  let wasPlaying = false;
  let wasHidden = false;
  function refresh() {
    const nowPlaying = playing();
    const nowHidden = codeHidden();
    if (nowPlaying !== wasPlaying) playBtn.innerHTML = nowPlaying ? ICON.pause : ICON.play;
    if (nowHidden !== wasHidden) codeBtn.innerHTML = nowHidden ? ICON.codeOff : ICON.code;
    wasPlaying = nowPlaying;
    wasHidden = nowHidden;
    wake();
  }
  bar.addEventListener('touchstart', wake, { passive: true });

  document.body.appendChild(bar);
  refresh();
  return { refresh };
}

// Pinch the code to size it, the way you'd size anything else on a phone.
// `el` is #editor, which on a touch screen covers the window and takes every
// pointer event while the code is up — so a two-finger gesture arriving here
// at all is one that means the code. Hidden, it's display: none and nothing
// reaches it, which is what leaves the pinch to the camera.
export function pinchZoom(el, { get, set }) {
  if (!isTouch) return;
  const gap = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  let from = 0; // finger gap when the pinch started; 0 = not pinching
  let base = 0;
  let size = 0;

  const end = () => { if (from) { from = 0; set(size); } };

  el.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 2) return;
    from = gap(e.touches);
    base = size = get();
  }, { passive: true });

  el.addEventListener('touchmove', (e) => {
    if (!from) return;
    if (e.touches.length !== 2) return end();
    // the browser's own pinch would zoom a fixed, full-screen canvas into one
    // magnified corner and carry the buttons off the edge with it
    e.preventDefault();
    size = base * (gap(e.touches) / from);
    set(size, false);
  }, { passive: false });

  el.addEventListener('touchend', end);
  el.addEventListener('touchcancel', end);
}

// The on-screen keyboard doesn't move a position: fixed element — it just
// covers it, which is exactly where the buttons and the status line are. The
// visual viewport is the part still showing; publish the difference so the CSS
// can sit above it. CodeMirror needs the number rather than the custom
// property, so that its popups don't open under the keyboard either.
let kb = 0;
export const keyboardInset = () => kb;

export function trackKeyboard() {
  const vv = window.visualViewport;
  if (!vv) return;
  const apply = () => {
    kb = Math.round(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    document.documentElement.style.setProperty('--kb', `${kb}px`);
  };
  vv.addEventListener('resize', apply);
  vv.addEventListener('scroll', apply);
  apply();
}

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

// A sketch may carry a header per kind of screen, each its own comment block
// opening with `--- desktop ---` or `--- touch ---`. Only the one that applies
// reaches the editor, and it arrives as an ordinary comment with the marker
// line gone — so the welcome sketch explains the controls you actually have
// instead of both sets. Sketches without them pass through untouched.
const VARIANT = /\/\*[ \t]*-{2,}[ \t]*(desktop|touch)[ \t]*-{2,}[ \t]*\r?\n([\s\S]*?\*\/)\r?\n?/g;

export const forPlatform = (code) =>
  code.replace(VARIANT, (_, kind, body) =>
    kind === (isTouch ? 'touch' : 'desktop') ? `/*\n${body}\n` : '');

// The browser's own pinch has to go, and touch-action isn't enough to send it:
// iOS drives page zoom from its gesture events, which touch-action doesn't
// govern, and it has ignored user-scalable=no since iOS 10. Left alone it
// magnifies a fixed, fullscreen canvas — which reads as the geometry zooming —
// carries the buttons off the edge, and strands you at a scale no amount of
// pinching in the app will undo, because the app was never the thing that
// zoomed. Nothing on this page wants page zoom: the code brings its own.
export function blockPageZoom() {
  if (!isTouch) return;
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
  }
  // double-tap-to-zoom is the same gesture with fewer fingers
  document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
}

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
// there — always, since they're the only way to run, pause or get the code
// back, and hunting for a control that faded out is worse than the pixels it
// was covering. `playing`/`codeHidden` are read back after every press rather
// than tracked here: pausing and hiding both have other ways in (a run resumes
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
  }

  document.body.appendChild(bar);
  refresh();
  return { refresh };
}

// Pinch to zoom the code, the way a page zooms: the layer magnifies about the
// point between your fingers, and the same two fingers drag it around. Only
// the editor is transformed — the picture behind it and the buttons over it
// keep their size and their sharpness, which is the whole reason this isn't
// the browser's own pinch. CodeMirror measures through a scaled editor
// (getScale in @codemirror/view), so the caret still lands where you tap.
//
// One finger stays a scroll (touch-action: pan-y), so reading the code and
// framing it are different gestures and never have to be told apart.
//
// `el` is #editor, which on a touch screen covers the window and takes every
// pointer event while the code is up — so a two-finger gesture arriving here
// at all is one that meant the code. Hidden, it's display: none and nothing
// reaches it, which is what leaves the pinch to the camera.
const MAX_ZOOM = 4;
const SLOP = 10;      // px before a one-finger drag has to say which way it's going
const LOCK_SLOP = 12; // and before a two-finger one has to say what it is

// Two fingers can mean two things: change the distance between them and you
// meant zoom, carry them along together and you meant pan. A hand does some of
// both whichever it intended, so the gesture commits to whichever it did first
// and stays committed until the fingers come up — no drifting sideways while
// you zoom, no creeping scale while you pan. '' until there's enough movement
// to tell.
// Whichever of the two changed more is what the gesture was.
const decideGesture = (dGap, dMove) =>
  (Math.abs(dGap) < LOCK_SLOP && dMove < LOCK_SLOP ? '' : Math.abs(dGap) > dMove ? 'zoom' : 'pan');


export function pinchZoom(el) {
  if (!isTouch) return;
  const gapOf = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const midXOf = (t) => (t[0].clientX + t[1].clientX) / 2;
  const midYOf = (t) => (t[0].clientY + t[1].clientY) / 2;

  let k = 1, tx = 0, ty = 0;              // what the layer is showing now
  let fingers = 0;                        // how many the baseline below assumes
  let gap0 = 1, k0 = 1, cx = 0, cy = 0;   // two-finger baseline
  let mx0 = 0, my0 = 0, ptx = 0, pty = 0, mode = '';
  let x0 = 0, y0 = 0, tx0 = 0, axis = ''; // one-finger baseline

  const apply = () => {
    // Clamped so the layer can never be dragged off the window it covers —
    // at 1× that pins it back to the corner, so pinching in is the way home
    // and there's no separate gesture to remember for it.
    const w = el.clientWidth, h = el.clientHeight;
    tx = Math.min(0, Math.max((1 - k) * w, tx));
    ty = Math.min(0, Math.max((1 - k) * h, ty));
    el.style.transform = k === 1 ? '' : `translate(${tx}px, ${ty}px) scale(${k})`;
  };

  // Square to the window at 1×, from wherever it was. Hiding the code calls
  // this, which makes ⟨/⟩ twice a way out of any zoom at all — worth having
  // when the gesture itself is at the mercy of four different browsers.
  const reset = () => { k = 1; tx = 0; ty = 0; mode = ''; axis = ''; apply(); };

  // Every change in the number of fingers restarts the gesture from where it
  // is now, rather than only a clean two-finger press doing so. A third finger,
  // one lifted early, one that began on a button — none of them can leave a
  // stale baseline behind, and a stale baseline is how a pinch ends up at a
  // scale it won't come back from.
  const rebase = (e) => {
    const t = [...e.touches];
    fingers = t.length;
    axis = '';
    mode = '';
    if (fingers >= 2) {
      gap0 = gapOf(t) || 1;
      k0 = k;
      mx0 = midXOf(t);
      my0 = midYOf(t);
      ptx = tx;
      pty = ty;
      // where the midpoint sits in the layer's own coordinates; holding that
      // still under the fingers is what makes the zoom land where you aimed it
      cx = (mx0 - tx) / k;
      cy = (my0 - ty) / k;
    } else if (fingers === 1) {
      x0 = t[0].clientX;
      y0 = t[0].clientY;
      tx0 = tx;
    }
  };
  for (const ev of ['touchstart', 'touchend', 'touchcancel']) {
    el.addEventListener(ev, rebase, { passive: true });
  }

  el.addEventListener('touchmove', (e) => {
    const t = [...e.touches];
    if (t.length !== fingers) return; // a rebase is on its way; sit this one out

    if (t.length >= 2) {
      e.preventDefault();
      const gap = gapOf(t);
      const mx = midXOf(t), my = midYOf(t);
      if (!mode) {
        mode = decideGesture(gap - gap0, Math.hypot(mx - mx0, my - my0));
        if (!mode) return; // still too small to call
      }
      if (mode === 'zoom') {
        k = Math.min(MAX_ZOOM, Math.max(1, k0 * (gap / gap0)));
        // about where the pinch began, not where the fingers have wandered to
        // since — that wandering is the pan this gesture isn't
        tx = mx0 - cx * k;
        ty = my0 - cy * k;
      } else {
        tx = ptx + (mx - mx0);
        ty = pty + (my - my0);
      }
      apply();
      return;
    }

    // One finger sideways pans the code; one finger up and down is left to the
    // document's own scrolling (touch-action: pan-y), so a long sketch still
    // flicks and coasts the way a page does. Which of the two it is gets
    // decided once, on the first bit of movement, and then held — otherwise a
    // scroll with a wobble in it keeps stealing itself back.
    if (t.length !== 1 || k === 1) return;
    const dx = t[0].clientX - x0;
    if (!axis) {
      const dy = t[0].clientY - y0;
      if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
      axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }
    if (axis !== 'x') return;
    e.preventDefault();
    tx = tx0 + dx;
    apply();
  }, { passive: false });

  return { reset };
}

// The same rule for the camera. OrbitControls maps two fingers to DOLLY_PAN,
// which is both at once by design — so a pinch to come closer slides the scene
// sideways as your hand rolls, and a two-finger drag scales it. It re-reads
// enableZoom and enablePan on every move, so committing the gesture is a
// matter of turning off the half you didn't mean until the fingers come up.
export function lockCameraGesture(controls, canvas) {
  if (!isTouch) return;
  let gap0 = 1, mx0 = 0, my0 = 0, mode = '';

  const free = () => { controls.enableZoom = true; controls.enablePan = true; };

  const rebase = (e) => {
    mode = '';
    free();
    const t = [...e.touches];
    if (t.length < 2) return;
    gap0 = Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY) || 1;
    mx0 = (t[0].clientX + t[1].clientX) / 2;
    my0 = (t[0].clientY + t[1].clientY) / 2;
  };

  // capture, so the decision is in before OrbitControls acts on the same event
  const opts = { capture: true, passive: true };
  for (const ev of ['touchstart', 'touchend', 'touchcancel']) {
    canvas.addEventListener(ev, rebase, opts);
  }
  canvas.addEventListener('touchmove', (e) => {
    const t = [...e.touches];
    if (t.length < 2 || mode) return;
    const gap = Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const mx = (t[0].clientX + t[1].clientX) / 2;
    const my = (t[0].clientY + t[1].clientY) / 2;
    mode = decideGesture(gap - gap0, Math.hypot(mx - mx0, my - my0));
    if (!mode) return;
    controls.enableZoom = mode === 'zoom';
    controls.enablePan = mode === 'pan';
  }, opts);
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

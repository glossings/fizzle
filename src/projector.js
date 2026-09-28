import { EditorState } from '@codemirror/state';
import { EditorView, ViewPlugin, Decoration, WidgetType } from '@codemirror/view';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { colorPicker } from './colorpicker.js';
import { sketchFolding, mirrorFolds } from './fold.js';

// A second, chrome-free window holding just the visuals and the code — drag it
// onto the projector and keep the sidebar, status line and actual typing on the
// laptop. It *mirrors* rather than re-renders: a WebGL canvas belongs to exactly
// one document, so the audience gets the same framebuffer. With a resolution()
// set, that framebuffer is already the right shape and this window is sized to
// match it, so full-screening it on a display of that shape fills it exactly.

// A real same-origin page rather than about:blank, purely so the pop-up's
// location bar names this site — a scripted window always shows one, and
// there's no flag to suppress it. public/projector.html is an empty black
// shell; everything in it is built from here.
const SHELL_URL = 'projector.html';

const PROJECTOR_CSS = `
html, body { margin: 0; height: 100%; overflow: hidden; background: #000; }
/* not one scrollbar anywhere in here — the code pane scrolls to follow the
   cursor, and CodeMirror's own scroller has a horizontal one of its own */
#proj-stage, #proj-stage * { scrollbar-width: none; -ms-overflow-style: none; }
#proj-stage::-webkit-scrollbar,
#proj-stage *::-webkit-scrollbar { display: none; width: 0; height: 0; }
/* the stage is the picture and nothing else — sized to the render's aspect and
   centered, so the code laid over it can't spill past the edge of the image
   into a bar (or off the side of a recording) */
#proj-stage { position: fixed; inset: 0; margin: auto; overflow: hidden; }
#proj-visual { position: absolute; inset: 0; }
#proj-visual > * { width: 100%; height: 100%; display: block; object-fit: contain; background: #000; }
#proj-code { position: absolute; inset: 0; z-index: 10; overflow: hidden auto; }
#proj-code.hidden { display: none; }
/* nothing in this window is interactive — a stray click must never edit the
   mirrored doc out from under the copy the main window is streaming into it */
#proj-code, #proj-code * { pointer-events: none !important; }
.proj-caret {
  display: inline-block;
  width: 0;
  height: 1.15em;
  border-left: 2px solid #fff;
  margin-right: -2px;
  vertical-align: text-bottom;
  animation: proj-blink 1.06s steps(1) infinite;
}
@keyframes proj-blink { 50% { border-left-color: transparent; } }
`;

// The read-only view never gets focus, so CodeMirror won't draw a caret for it.
// Without one the audience can't see where the typing is happening.
class CaretWidget extends WidgetType {
  eq() { return true; }
  toDOM(view) {
    const el = view.dom.ownerDocument.createElement('span');
    el.className = 'proj-caret';
    return el;
  }
}

const caret = Decoration.widget({ widget: new CaretWidget(), side: 1 });
const caretDeco = (state) => Decoration.set([caret.range(state.selection.main.head)]);

const showCaret = ViewPlugin.fromClass(
  class {
    constructor(view) { this.decorations = caretDeco(view.state); }
    update(u) { if (u.docChanged || u.selectionSet) this.decorations = caretDeco(u.state); }
  },
  { decorations: (v) => v.decorations }
);

// Vite serves the app's CSS as <style> in dev and <link> in a build; copy
// whichever is there so the projected code matches the editor exactly.
function copyStyles(doc) {
  for (const node of document.querySelectorAll('link[rel="stylesheet"], style')) {
    if (node.tagName === 'LINK') {
      const link = doc.createElement('link');
      link.rel = 'stylesheet';
      link.href = node.href; // absolute — the popup is about:blank, with no base
      doc.head.appendChild(link);
    } else {
      const style = doc.createElement('style');
      style.textContent = node.textContent;
      doc.head.appendChild(style);
    }
  }
  const own = doc.createElement('style');
  own.textContent = PROJECTOR_CSS;
  doc.head.appendChild(own);
}

const NO_PUSH = () => {};

// Copy the framebuffer across documents once a frame. Costs a texture readback
// per frame, so it's the fallback, not the path.
function blit(canvas, doc, holder) {
  const copy = doc.createElement('canvas');
  const ctx = copy.getContext('2d');
  holder.appendChild(copy);
  let raf = 0;
  const frame = () => {
    if (copy.width !== canvas.width || copy.height !== canvas.height) {
      copy.width = canvas.width;
      copy.height = canvas.height;
    }
    ctx.drawImage(canvas, 0, 0);
    raf = doc.defaultView.requestAnimationFrame(frame);
  };
  frame();
  return { stop: () => doc.defaultView?.cancelAnimationFrame(raf), push: NO_PUSH };
}

// An ImageBitmap is pixels and a size, with no color space riding along, so
// what lands over there is what was in the buffer. captureStream's frames are
// *video* frames and carry one: Chrome tags them linear and the compositor
// sRGB-encodes a second time on the way to the screen, which lifts every
// shadow — side by side on one display, the same frame reads black here and
// washed blue there. Hence this first and the stream only as a fallback.
function mirrorBitmap(canvas, doc, holder) {
  const copy = doc.createElement('canvas');
  const ctx = copy.getContext?.('bitmaprenderer');
  if (!ctx) return null;
  holder.appendChild(copy);
  let pending = false; // one in flight is enough — a frame late is a frame dropped
  let stopped = false;
  return {
    stop() { stopped = true; },
    // Called from inside the render loop with this frame still in the drawing
    // buffer: createImageBitmap snapshots its source at the call, and a later
    // task would find the buffer already cleared.
    push() {
      if (stopped || pending) return;
      pending = true;
      createImageBitmap(canvas).then(
        (bmp) => {
          pending = false;
          if (stopped) return bmp.close();
          // object-fit measures the element's intrinsic ratio, which is these
          // attributes — a transferred bitmap doesn't set them, and the default
          // 300×150 is wider than any screen, so the picture would letterbox
          // inside the stage and come out stretched
          if (copy.width !== bmp.width || copy.height !== bmp.height) {
            copy.width = bmp.width;
            copy.height = bmp.height;
          }
          ctx.transferFromImageBitmap(bmp);
        },
        () => { pending = false; }
      );
    },
  };
}

// captureStream hands the compositor frames the canvas has already drawn — no
// readback, and it follows resizes on its own. Some engines hand back a stream
// that never produces a frame for a WebGL canvas, though, so a stream that has
// shown nothing shortly after opening is abandoned for the blit.
function mirrorStream(canvas, doc, holder) {
  let stop = () => {};
  const stream = canvas.captureStream?.();
  if (!stream) return blit(canvas, doc, holder);

  const video = doc.createElement('video');
  Object.assign(video, { autoplay: true, muted: true, playsInline: true, srcObject: stream });
  holder.appendChild(video);
  video.play?.().catch(() => { /* autoplay policy; a muted video shouldn't hit this */ });
  stop = () => stream.getTracks().forEach((t) => t.stop());

  const guard = doc.defaultView.setTimeout(() => {
    if (video.videoWidth) return;
    stop();
    video.remove();
    stop = blit(canvas, doc, holder).stop;
  }, 1500);

  return { stop: () => { doc.defaultView?.clearTimeout(guard); stop(); }, push: NO_PUSH };
}

const mirrorCanvas = (canvas, doc, holder) =>
  mirrorBitmap(canvas, doc, holder) ?? mirrorStream(canvas, doc, holder);

// Give the window the render's exact size and shape, shrunk to fit the screen.
// resizeTo is *outer* size, so the chrome has to come off first — the pop-up
// keeps a location bar whatever we do, and ignoring its height is exactly the
// few-dozen-pixel mismatch that reads as a seam. Fullscreen — `f` in that
// window — is what actually gets rid of the bar.
function fitWindow(win, res) {
  if (!res || win.closed || !win.innerWidth) return;
  const [w, h] = res;
  const chromeW = win.outerWidth - win.innerWidth;
  const chromeH = win.outerHeight - win.innerHeight;
  const room = Math.min(
    1,
    (win.screen.availWidth - chromeW) / w,
    (win.screen.availHeight - chromeH) / h
  );
  win.resizeTo(Math.round(w * room) + chromeW, Math.round(h * room) + chromeH);
}

// onPointer: { move(clientX, clientY, rect), down(0|1) } — the projector reports
// its own pointer so mouse() keeps working when the visuals are the window
// you're actually looking at.
export function initProjector(canvas, getResolution, onPointer) {
  let win = null;
  let view = null;
  let codeEl = null;
  let stageEl = null;
  let mirror = null;

  const isOpen = () => !!win && !win.closed;

  // A resolution() is the shape the sketch asked for; without one, the shape
  // the main canvas happens to be, which follows the main window around.
  const size = () => getResolution?.() ?? [canvas.width, canvas.height];

  // Fit the stage inside the window — the same contain-fit the canvas gets in
  // the main window, so both show the identical framing.
  function layoutStage() {
    if (!isOpen() || !stageEl) return;
    const [sw, sh] = size();
    const aspect = sw / sh;
    const w = Math.min(win.innerWidth, win.innerHeight * aspect);
    stageEl.style.width = `${Math.round(w)}px`;
    stageEl.style.height = `${Math.round(w / aspect)}px`;
    const res = getResolution?.();
    win.document.title = res ? `fizzle — projector ${res[0]}×${res[1]}` : 'fizzle — projector';
  }

  // the sketch changed resolution() while the window was up
  window.addEventListener('fizzle-resolution', () => {
    if (!isOpen()) return;
    fitWindow(win, getResolution?.());
    layoutStage();
  });
  // with no resolution() the shape tracks the main window
  window.addEventListener('resize', layoutStage);

  function close() {
    mirror?.stop();
    view?.destroy();
    if (isOpen()) win.close();
    mirror = view = win = codeEl = stageEl = null;
  }

  // Scroll is mirrored by line and a fraction of it — see editor.js. Runs on
  // every frame the main window scrolls, so it writes scrollTop straight rather
  // than dispatching a transaction: a scrollIntoView effect can only land on a
  // line boundary, which turns a smooth scroll over there into a step per line,
  // and it drags a measure pass through this window for every frame of it.
  function scrollTo(anchor) {
    if (!isOpen() || !view || !anchor) return;
    const { doc } = view.state;
    const line = doc.line(Math.min(anchor.line, doc.lines));
    const block = view.lineBlockAt(line.from);
    if (!block) return;
    // #proj-code holds the overflow, unless the copied styles put it on the
    // scroller (the touch rules do); whichever actually scrolls is the one
    // whose top edge the anchor line has to meet.
    const scroller = codeEl.scrollHeight > codeEl.clientHeight ? codeEl : view.scrollDOM;
    // block heights are the untransformed ones; documentTop is already on screen
    const target = view.documentTop + (block.top + anchor.frac * block.height) * view.scaleY;
    scroller.scrollTop += target - scroller.getBoundingClientRect().top;
  }

  function open(srcState, anchor) {
    close(); // a window closed from its own title bar may not have unwound yet
    win = window.open(SHELL_URL, 'fizzle-projector', 'popup=yes,width=1280,height=720');
    if (!win) return false;
    // window.open hands back the handle while the pop-up is still on its
    // initial about:blank, and the load swaps the whole Window out from under
    // any listener we'd attach — so watch for our own shell to show up.
    // Poll from *this* window: a timer or listener registered on the pop-up
    // would belong to the about:blank Window the navigation is about to throw
    // away. Bail if it never arrives rather than spin forever.
    const target = win;
    const start = Date.now();
    const waitForShell = () => {
      if (target.closed || win !== target) return;
      if (target.document?.body?.dataset.fizzle === 'projector') return build(srcState, anchor);
      if (Date.now() - start < 5000) setTimeout(waitForShell, 30);
    };
    waitForShell();
    return true;
  }

  function build(srcState, anchor) {
    const doc = win.document;
    copyStyles(doc);
    doc.documentElement.style.setProperty(
      '--editor-font',
      document.documentElement.style.getPropertyValue('--editor-font') || '15px'
    );

    const stage = (stageEl = doc.createElement('div'));
    stage.id = 'proj-stage';
    const visual = doc.createElement('div');
    visual.id = 'proj-visual';
    const code = (codeEl = doc.createElement('div'));
    code.id = 'proj-code';
    stage.append(visual, code);
    doc.body.appendChild(stage);

    mirror = mirrorCanvas(canvas, doc, visual);
    view = new EditorView({
      parent: code,
      state: EditorState.create({
        doc: srcState.doc,
        selection: srcState.selection,
        extensions: [
          javascript(),
          oneDark,
          EditorView.lineWrapping,
          EditorView.editable.of(false),
          colorPicker(), // swatches only; the window can't be clicked
          sketchFolding(),
          showCaret,
        ],
      }),
    });
    mirrorFolds(view, srcState); // the bands chip, and anything else put away

    // Keys for when this window has focus: `f` / double-click fullscreens (the
    // only way to be rid of the pop-up's location bar), F1 or escape closes it,
    // ctrl+h hides the code — the same thing the main window's ctrl+h does from
    // over there, which is the usual way to reach it.
    const fullscreen = () => {
      if (doc.fullscreenElement) doc.exitFullscreen();
      else doc.documentElement.requestFullscreen?.().catch(() => { /* denied */ });
    };
    win.addEventListener('keydown', (e) => {
      if (e.key === 'h' && e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        code.classList.toggle('hidden');
      } else if (e.key === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        fullscreen();
      } else if (e.key === 'F1' || e.key === 'Escape') {
        // escape belongs to fullscreen first — that's what the browser has
        // trained everyone it does, and it's one keypress from closing by
        // accident mid-set otherwise
        if (e.key === 'Escape' && doc.fullscreenElement) return;
        e.preventDefault();
        close();
      }
    });
    win.addEventListener('dblclick', fullscreen);
    win.addEventListener('resize', layoutStage);
    // entering fullscreen usually fires a resize too, but not dependably
    // before the new viewport is readable — the stage would keep the windowed
    // size and sit in the middle of the screen
    doc.addEventListener('fullscreenchange', layoutStage);
    // mouse() over here too: the stage is the mirrored image and nothing else,
    // so its rect normalizes to the same -1..1 the main canvas does
    win.addEventListener('pointermove', (e) =>
      onPointer?.move(e.clientX, e.clientY, visual.getBoundingClientRect()));
    win.addEventListener('pointerdown', () => onPointer?.down(1));
    for (const ev of ['pointerup', 'pointercancel']) {
      win.addEventListener(ev, () => onPointer?.down(0));
    }
    // a reload of the main window orphans the stream; don't leave a frozen frame
    win.addEventListener('pagehide', () => { if (win) close(); });
    fitWindow(win, getResolution?.());
    layoutStage();
    // Open where the main window is looking, not at the top of the file — a
    // frame late, so the view has measured its own lines and the anchor lands
    // on a real height rather than an estimated one.
    win.requestAnimationFrame(() => scrollTo(anchor));
  }

  window.addEventListener('pagehide', close);

  return {
    // 'open' | 'closed' | 'blocked'
    toggle(srcState, anchor) {
      if (isOpen()) return close(), 'closed';
      return open(srcState, anchor) ? 'open' : 'blocked';
    },

    scrollTo,

    isOpen,

    // Hand the audience this frame, from inside the render loop while the
    // drawing buffer still holds it. A no-op with no projector up, and on the
    // fallback paths, which feed themselves.
    frame() { mirror?.push(); },

    // What a recording should lay over the picture, or null when this window's
    // code is hidden. #proj-code fills the stage, and the stage is the picture
    // and nothing else, so the whole element maps onto the frame.
    codeLayer() {
      if (!isOpen() || !codeEl || codeEl.classList.contains('hidden')) return null;
      return {
        el: codeEl,
        clip: { x: 0, y: 0, w: codeEl.clientWidth, h: codeEl.clientHeight },
      };
    },

    // ctrl+h from the main window lands here first: with a projector up it's
    // the audience's copy of the code you mean to hide, not your own. False
    // hands the key back so it toggles the local editor instead.
    toggleCode() {
      if (!isOpen() || !codeEl) return false;
      return codeEl.classList.toggle('hidden') ? 'hidden' : 'shown';
    },

    // Replay the editor's own transactions, so the projected doc stays exactly
    // in step (and scrolls to follow the cursor between the scrollTo calls
    // the main window's own scrolling sends). If it ever drifts — the
    // change set won't apply to a doc of the wrong length — resync wholesale.
    sync(update) {
      if (!isOpen() || !view) return;
      try {
        view.dispatch({
          changes: update.changes,
          selection: update.state.selection,
          scrollIntoView: true,
        });
      } catch {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: update.state.doc.toString() },
          selection: update.state.selection,
          scrollIntoView: true,
        });
      }
      mirrorFolds(view, update.state);
    },
  };
}

// The right-click menus: one over the picture, and one over the code where a
// number or a widget is under the pointer (widgets-editor.js). Anywhere else in
// the code, the browser's own menu.

let menu = null;
const close = () => { if (menu) menu.hidden = true; };

function ensureMenu() {
  if (menu) return menu;
  menu = document.createElement('div');
  menu.id = 'ctx-menu';
  menu.hidden = true;
  // a press on the menu mustn't take the focus out of the editor
  menu.addEventListener('mousedown', (e) => e.preventDefault());
  document.body.appendChild(menu);
  window.addEventListener('pointerdown', (e) => { if (!menu.contains(e.target)) close(); }, true);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); }, true);
  window.addEventListener('blur', close);
  window.addEventListener('resize', close);
  return menu;
}

// items: [{ label, run }]
export function showMenu(x, y, items) {
  const m = ensureMenu();
  m.replaceChildren(...items.map(({ label, run }) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', () => { close(); run(); });
    return b;
  }));
  m.hidden = false;
  m.style.left = `${Math.max(0, Math.min(x, window.innerWidth - m.offsetWidth - 4))}px`;
  m.style.top = `${Math.max(0, Math.min(y, window.innerHeight - m.offsetHeight - 4))}px`;
}

// The picture's menu. Opened on release rather than on the contextmenu event:
// a right-drag pans the camera, and macOS fires contextmenu on the press, before
// anyone knows which of the two this is.
export function initContextMenu(target, items) {
  let down = null;
  target.addEventListener('contextmenu', (e) => e.preventDefault());
  target.addEventListener('pointerdown', (e) => {
    down = e.button === 2 ? { x: e.clientX, y: e.clientY } : null;
  });
  target.addEventListener('pointerup', (e) => {
    if (e.button !== 2 || !down) return;
    const still = Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4;
    down = null;
    if (still) showMenu(e.clientX, e.clientY, items);
  });
}

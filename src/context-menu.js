// The right-click menu over the picture. Code lines keep the browser's own
// menu; everywhere else the click falls through #editor to the canvas.
export function initContextMenu(target, items) {
  const menu = document.createElement('div');
  menu.id = 'ctx-menu';
  menu.hidden = true;
  const close = () => { menu.hidden = true; };
  for (const { label, run } of items) {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', () => { close(); run(); });
    menu.appendChild(b);
  }
  // a press on the menu mustn't take the focus out of the editor
  menu.addEventListener('mousedown', (e) => e.preventDefault());
  document.body.appendChild(menu);

  function open(x, y) {
    menu.hidden = false;
    menu.style.left = `${Math.max(0, Math.min(x, window.innerWidth - menu.offsetWidth - 4))}px`;
    menu.style.top = `${Math.max(0, Math.min(y, window.innerHeight - menu.offsetHeight - 4))}px`;
  }

  // Opened on release rather than on the contextmenu event: a right-drag pans
  // the camera, and macOS fires contextmenu on the press, before anyone knows
  // which of the two this is.
  let down = null;
  target.addEventListener('contextmenu', (e) => e.preventDefault());
  target.addEventListener('pointerdown', (e) => {
    down = e.button === 2 ? { x: e.clientX, y: e.clientY } : null;
  });
  target.addEventListener('pointerup', (e) => {
    if (e.button !== 2 || !down) return;
    const still = Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4;
    down = null;
    if (still) open(e.clientX, e.clientY);
  });

  window.addEventListener('pointerdown', (e) => { if (!menu.contains(e.target)) close(); }, true);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); }, true);
  window.addEventListener('blur', close);
  window.addEventListener('resize', close);
}

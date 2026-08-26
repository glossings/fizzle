// Writes a take into origin-private storage as it's recorded. A sync access
// handle is worker-only, and it's the one file API whose writes land in place:
// whatever has been written is on disk if the page dies mid-take, which is the
// whole reason the take goes here first (see record.js).

let handle = null;
let pos = 0;

const reply = (id, value) => postMessage({ id, ok: true, value });
const fail = (id, e) => postMessage({ id, ok: false, error: e?.message ?? String(e) });

onmessage = async ({ data: { id, op, dir, name, buf } }) => {
  try {
    if (op === 'open') {
      const root = await navigator.storage.getDirectory();
      const folder = await root.getDirectoryHandle(dir, { create: true });
      const file = await folder.getFileHandle(name, { create: true });
      handle = await file.createSyncAccessHandle();
      handle.truncate(0);
      pos = 0;
      reply(id, 0);
    } else if (op === 'write') {
      const n = handle.write(new Uint8Array(buf), { at: pos });
      pos += n;
      handle.flush(); // a second of video; what's flushed survives the tab
      if (n !== buf.byteLength) throw new Error(`short write: ${n} of ${buf.byteLength} bytes`);
      reply(id, pos);
    } else if (op === 'close') {
      handle?.flush();
      handle?.close();
      handle = null;
      reply(id, pos);
    } else {
      throw new Error(`unknown op ${op}`);
    }
  } catch (e) {
    fail(id, e);
  }
};

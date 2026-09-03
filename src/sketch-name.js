// Sketch names become filenames in sketches/user/. Banning slashes keeps a
// name to a single path segment, and banning a leading dot keeps it from being
// `.`/`..` or a hidden file — so it can't escape the directory. Interior dots
// are fine: files like "v1.2.js" list, load, and save. Shared by the editor
// and the dev-server API in vite.config.js — if the two disagree, a save
// passes client validation then 400s at the server.

export const NAME_RULE = 'no slashes or leading dot, 60 characters max';

export const nameOk = (s) => /^(?!\.)[^/\\\x00-\x1f]{1,60}$/.test(s) && s.trim() === s;

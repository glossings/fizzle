// Sketch names become filenames in sketches/user/. Banning dots and slashes
// keeps a name to a single path segment with no `..`, so it can't escape the
// directory. Shared by the editor and the dev-server API in vite.config.js —
// if the two disagree, a save passes client validation then 400s at the server.

export const NAME_RULE = 'no dots or slashes, 60 characters max';

export const nameOk = (s) => /^[^./\\\x00-\x1f]{1,60}$/.test(s) && s.trim() === s;

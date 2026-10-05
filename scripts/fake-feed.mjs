#!/usr/bin/env node
// A stand-in for whatever is actually going to feed text({ url }) — enough of
// one to build against, and to tell a broken ingestor from a broken producer.
//
//   node scripts/fake-feed.mjs [port]
//
//   /events  text/event-stream, a frame on connect and one per change
//   /text    text/plain, for the fetch-once path (poll to keep asking)
//   /json    application/json, one frame, no stream
//
// The cases worth having in a fixture are all here: marks that move, a frame
// with nothing marked, and a mark at offset 0.
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 4000);

const TEXT = 'kick: bd*4   hat: hh*8   bass: saw   pad: warm';
// [start, end) into TEXT, including one at offset 0 and one empty set
const SETS = [
  [[0, 10]],
  [[13, 22]],
  [[13, 22], [25, 34]],
  [],
  [[0, 10], [37, 46]],
];

let i = 0;
const frame = () => JSON.stringify({ text: TEXT, ranges: SETS[i++ % SETS.length] });

const CORS = { 'Access-Control-Allow-Origin': '*' };

createServer((req, res) => {
  const path = req.url.split('?')[0];
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...CORS, 'Access-Control-Allow-Headers': '*' });
    return res.end();
  }
  if (path === '/text') {
    res.writeHead(200, { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(TEXT);
  }
  if (path === '/json') {
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    return res.end(frame());
  }
  if (path !== '/events') {
    res.writeHead(404, CORS);
    return res.end('try /events, /text or /json');
  }
  res.writeHead(200, {
    ...CORS,
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(`data: ${frame()}\n\n`); // the current frame on connect, so a late reader sees the set
  const iv = setInterval(() => res.write(`data: ${frame()}\n\n`), 400);
  req.on('close', () => clearInterval(iv));
}).listen(port, '127.0.0.1', () => {
  // an IP literal, not localhost: that is what lets a browser tell the request
  // is going to the local network before it resolves the name
  console.log(`fake feed on http://127.0.0.1:${port}/events`);
});

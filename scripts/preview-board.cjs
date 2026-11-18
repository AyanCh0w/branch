#!/usr/bin/env node
// Dev preview: show a saved board snapshot on the real canvas without an account or a
// database. The canvas runs in its local mode, so nothing is saved or shared.
//
//   npm run demo:plan-board                               # writes a snapshot, then serves it
//   node scripts/preview-board.cjs /tmp/board.json        # or serve a snapshot you already have
// Open http://127.0.0.1:4399. Add ?variant=older-client for the older-client board.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const snapshot = path.resolve(process.argv[2] || 'board.json');
const port = Number(process.env.PORT || 4399);
const app = path.join(__dirname, '../app');
const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.html': 'text/html', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.ico': 'image/x-icon', '.json': 'application/json' };

// "/?variant=older-client" shows board.older-client.json from the same folder.
function page(variant) {
  const file = /^[a-z-]{1,40}$/.test(variant || '') ? snapshot.replace(/\.json$/, '') + '.' + variant + '.json' : snapshot;
  const board = JSON.parse(fs.readFileSync(file, 'utf8'));
  const state = { title: board.title || 'Board preview', nodes: board.nodes, events: [], tests: [], notes: '' };
  const seed = `<script>localStorage.setItem('branch-workspace-v2', ${JSON.stringify(JSON.stringify(state)).replace(/</g, '\\u003c')});</script>`;
  return fs.readFileSync(path.join(app, 'index.html'), 'utf8')
    .replace('<body class="account-mode">', '<body>')
    .replace('<script src="accounts.bundle.js"></script>', '')
    .replace('<script src="coding.js"></script>', seed + '<script src="coding.js"></script>');
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
    return res.end(page(url.searchParams.get('variant')));
  }
  const file = path.join(app, path.normalize(url.pathname));
  if (!file.startsWith(app + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end('{}');
  }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`Board preview: http://127.0.0.1:${port}`));

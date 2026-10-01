// Local dev server: `npm run dev`, then open http://localhost:3000
// Uses Upstash if the env vars are set, otherwise an in-memory store.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

const routes = {
  '/api/endpoints': './api/endpoints.js',
  '/api/requests': './api/requests.js',
  '/api/preview': './api/preview.js',
  '/api/meta': './api/meta.js',
  '/api/hook': './api/hook.js',
};
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

http.createServer(async (req, res) => {
  try {
    const p = new URL(req.url, 'http://x').pathname;
    const route = p.startsWith('/h/') ? './api/hook.js' : routes[p];
    if (route) return (await import(route)).default(req, res);
    const file = path.join('public', p === '/' ? 'index.html' : path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
    const data = await fs.readFile(file);
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  } catch (e) {
    res.statusCode = e.code === 'ENOENT' ? 404 : 500;
    res.end(e.code === 'ENOENT' ? 'Not found' : String(e.stack));
  }
}).listen(process.env.PORT || 3000, () => console.log(`Mockhook running at http://localhost:${process.env.PORT || 3000}`));

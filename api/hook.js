import { redis, KEYS, HISTORY } from '../lib/redis.js';
import { buildResponse } from '../lib/generate.js';
import { readRaw, newId, validId, MAX_STORED_BODY } from '../lib/http.js';

// Short in-memory cache of endpoint configs. Warm instances reuse it, which
// saves one Upstash command per request. Edits show up within CACHE_MS.
const CACHE_MS = Number(process.env.CONFIG_CACHE_MS || 10000);
const cache = (globalThis.__mhCache ||= new Map());

async function loadConfig(id) {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.cfg;
  const raw = await redis.get(KEYS.ep(id));
  const cfg = raw ? JSON.parse(raw) : null;
  cache.set(id, { cfg, at: Date.now() });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return cfg;
}

function corsHeaders(req) {
  return {
    'Access-Control-Allow-Origin': req.headers.origin || '*',
    ...(req.headers.origin ? { 'Access-Control-Allow-Credentials': 'true', Vary: 'Origin' } : {}),
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD',
    'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] || '*',
    'Access-Control-Expose-Headers': '*',
    'Access-Control-Max-Age': '86400',
  };
}

function parseBody(buf, contentType) {
  if (!buf.length) return null;
  const text = buf.toString('utf8');
  const ct = (contentType || '').toLowerCase();
  try {
    if (ct.includes('json') || /^\s*[[{]/.test(text)) return JSON.parse(text);
  } catch { /* not JSON */ }
  if (ct.includes('x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(text));
  return text;
}

const HIDDEN_HEADERS = /^(x-vercel-|x-real-ip$|forwarded$|x-forwarded-(host|port|proto|for)$|x-matched-path$)/;

export default async function handler(req, res) {
  const u = new URL(req.url, 'http://local');
  const query = Object.fromEntries(u.searchParams);

  // Works whether Vercel hands us the rewritten URL (/api/hook?__id=…) or the original (/h/:id/…)
  let id = query.__id, sub = query.__path;
  if (!id) {
    const m = u.pathname.match(/^\/h\/([^/]+)(\/.*)?$/);
    if (m) { id = m[1]; sub = (m[2] || '').replace(/^\//, ''); }
  }
  delete query.__id; delete query.__path;
  const subPath = sub ? '/' + sub : '';

  const cors = corsHeaders(req);
  const finish = (status, headers, body) => {
    res.statusCode = status;
    for (const [k, v] of Object.entries({ ...cors, ...headers })) res.setHeader(k, v);
    res.end(req.method === 'HEAD' ? undefined : body);
  };

  if (req.method === 'OPTIONS') return finish(204, {}, '');
  if (!validId(id)) return finish(404, { 'Content-Type': 'application/json' }, JSON.stringify({ error: 'Unknown endpoint' }));

  const cfg = await loadConfig(id);
  if (!cfg) return finish(404, { 'Content-Type': 'application/json' }, JSON.stringify({ error: 'Unknown endpoint', id }));

  const { buf, truncated, size } = await readRaw(req);
  const contentType = req.headers['content-type'] || '';
  const body = parseBody(buf, contentType);

  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) if (!HIDDEN_HEADERS.test(k)) headers[k] = v;
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();

  const proto = req.headers['x-forwarded-proto'] || (req.socket?.encrypted ? 'https' : 'http');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const baseUrl = host ? `${proto}://${host}/h/${id}${subPath}` : null;

  let out;
  try {
    out = buildResponse(cfg, {
      baseUrl,
      req: { method: req.method, path: subPath || '/', query, headers: req.headers, body: body ?? {}, ip },
    });
  } catch (e) {
    out = { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Generator failed', detail: String(e.message || e) }) };
  }

  const tasks = [];
  if (cfg.capture !== false) {
    const bodyText = buf.toString('utf8');
    const record = {
      id: newId(12),
      at: Date.now(),
      method: req.method,
      path: subPath || '/',
      query,
      headers,
      ip,
      contentType,
      size: size ?? buf.length,
      body: bodyText.length > MAX_STORED_BODY ? bodyText.slice(0, MAX_STORED_BODY) : bodyText,
      truncated: truncated || bodyText.length > MAX_STORED_BODY,
      responseStatus: out.status,
    };
    tasks.push(
      redis.pipeline()
        .lpush(KEYS.reqs(id), JSON.stringify(record))
        .ltrim(KEYS.reqs(id), 0, HISTORY - 1)
        .incr(KEYS.count(id))
        .exec()
        .catch(() => {}),
    );
  }

  const delay = Math.min(Math.max(Number(cfg.response?.delayMs) || 0, 0), 15000);
  if (delay) tasks.push(new Promise((r) => setTimeout(r, delay)));
  await Promise.all(tasks);

  finish(out.status, out.headers, out.body);
}

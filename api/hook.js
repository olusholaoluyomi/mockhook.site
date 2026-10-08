import { redis, KEYS, HISTORY } from '../lib/redis.js';
import { buildResponse } from '../lib/generate.js';
import { readRaw, newId, validId, clientIp, MAX_STORED_BODY } from '../lib/http.js';

const MAX_STORED_BINARY = 48 * 1024; // bytes of a non-text body kept (about 64 KB once encoded)

// Short in-memory cache of endpoint configs. Warm instances reuse it, which
// saves one Upstash command per request. Edits show up within CACHE_MS.
const CACHE_MS = Number(process.env.CONFIG_CACHE_MS || 10000);
const cache = (globalThis.__mhCache ||= new Map());

async function loadConfig(id) {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.cfg;
  const raw = await redis.get(KEYS.ep(id));
  const cfg = raw ? JSON.parse(raw) : null;
  // Only endpoints that exist are remembered. Remembering "not found" would make a
  // new endpoint answer 404 if its URL had been called just before it was created.
  if (!cfg) { cache.delete(id); return null; }
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

// Endpoint replies are written by whoever owns the endpoint and share a web address with
// the dashboard. These headers make a browser treat any reply opened as a page as a
// stranger to this site: its scripts can't read another person's sign-in or call the
// dashboard as them. Programs calling the endpoint as an API are unaffected.
const ISOLATION = { 'Content-Security-Policy': 'sandbox', 'X-Content-Type-Options': 'nosniff' };

// Query names used only by our own routing, never sent by a caller.
const ROUTING_PARAMS = new Set(['__id', '__path']);

// Headers added by Vercel on the way in, not sent by the caller.
const HIDDEN_HEADERS = /^(x-vercel-|x-real-ip$|forwarded$|x-forwarded-(host|port|proto|for)$|x-matched-path$)/;

export default async function handler(req, res) {
  const u = new URL(req.url, 'http://local');

  // The endpoint ID and sub-path come from the URL the caller used (/h/:id/…).
  // /api/hook?__id=… is still understood, for older routing setups.
  let id, sub;
  const m = u.pathname.match(/^\/h\/([^/]+)(\/.*)?$/);
  if (m) { id = m[1]; sub = (m[2] || '').replace(/^\//, ''); }
  else { id = u.searchParams.get('__id'); sub = u.searchParams.get('__path'); }
  id = String(id || '').toLowerCase(); // IDs are stored in lower case; /h/Orders means /h/orders
  const subPath = sub ? '/' + sub : '';

  // Keep only the query the caller sent. `query` holds one value per name and feeds
  // pagination and "value from the request" fields; `sentQuery` is what gets recorded,
  // with a repeated name (?tag=a&tag=b) kept as a list.
  const query = {}, sentQuery = {};
  for (const [k, v] of u.searchParams) {
    if (ROUTING_PARAMS.has(k)) continue;
    query[k] = v;
    sentQuery[k] = Object.hasOwn(sentQuery, k) ? [].concat(sentQuery[k], v) : v;
  }

  const cors = corsHeaders(req);
  const finish = (status, headers, body) => {
    res.statusCode = status;
    for (const [k, v] of Object.entries({ ...cors, ...headers, ...ISOLATION })) {
      try { res.setHeader(k, v); } catch { /* a header Node refuses is skipped, never fatal */ }
    }
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
  const ip = clientIp(req);

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
    // Text is kept as text. Anything else (a file, an image) is kept as base64 so the
    // exact bytes can be downloaded again instead of being mangled into text.
    const isText = Buffer.from(buf.toString('utf8'), 'utf8').equals(buf);
    const bodyText = isText ? buf.toString('utf8') : buf.subarray(0, MAX_STORED_BINARY).toString('base64');
    const tooLong = isText ? bodyText.length > MAX_STORED_BODY : buf.length > MAX_STORED_BINARY;
    const record = {
      id: newId(12),
      at: Date.now(),
      method: req.method,
      path: subPath || '/',
      query: sentQuery,
      headers,
      ip,
      contentType,
      size: size ?? buf.length,
      body: isText && tooLong ? bodyText.slice(0, MAX_STORED_BODY) : bodyText,
      ...(isText ? {} : { encoding: 'base64' }),
      truncated: truncated || tooLong,
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

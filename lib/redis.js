import { Redis } from '@upstash/redis';

// Works with either set of env var names: the ones Upstash gives you directly,
// or the ones Vercel adds when you connect Upstash from the Vercel Marketplace.
const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

export const usingMemory = !(url && token);

// Tiny in-memory stand-in used for local development when no Upstash is set.
// On Vercel this would lose data between requests, so the dashboard warns about it.
function memoryStore() {
  const kv = new Map();
  const expires = new Map();
  // Drops a key whose time is up, then says whether it is still there.
  const live = (k) => {
    if (expires.has(k) && expires.get(k) <= Date.now()) { kv.delete(k); expires.delete(k); }
    return kv.has(k);
  };
  const list = (k) => { if (!live(k)) kv.set(k, []); return kv.get(k); };
  const set_ = (k) => { if (!live(k)) kv.set(k, new Set()); return kv.get(k); };
  const str = (k) => (live(k) && typeof kv.get(k) === 'string' ? kv.get(k) : null);
  const api = {
    async get(k) { return str(k); },
    async mget(...ks) { return ks.flat().map(str); },
    // opts: { nx: only if the key is new, ex: seconds until it expires }
    async set(k, v, opts = {}) {
      if (opts.nx && live(k)) return null;
      kv.set(k, String(v));
      if (opts.ex) expires.set(k, Date.now() + opts.ex * 1000); else expires.delete(k);
      return 'OK';
    },
    async del(...ks) { ks.flat().forEach((k) => { kv.delete(k); expires.delete(k); }); return 1; },
    async incr(k) { const n = Number(str(k) || 0) + 1; kv.set(k, String(n)); return n; },
    async expire(k, seconds) { if (!live(k)) return 0; expires.set(k, Date.now() + seconds * 1000); return 1; },
    async sadd(k, ...m) { m.flat().forEach((x) => set_(k).add(x)); return 1; },
    async srem(k, ...m) { m.flat().forEach((x) => set_(k).delete(x)); return 1; },
    async smembers(k) { return [...set_(k)]; },
    async scard(k) { return set_(k).size; },
    async lpush(k, ...v) { list(k).unshift(...v.flat().reverse()); return list(k).length; },
    async ltrim(k, a, b) { kv.set(k, list(k).slice(a, b + 1)); return 'OK'; },
    async lrange(k, a, b) { return list(k).slice(a, b === -1 ? undefined : b + 1); },
    pipeline() {
      const ops = [];
      const p = new Proxy({}, {
        get(_, name) {
          if (name === 'exec') return async () => Promise.all(ops.map(([n, a]) => api[n](...a)));
          return (...a) => { ops.push([name, a]); return p; };
        },
      });
      return p;
    },
  };
  return api;
}

const g = globalThis;
export const redis = usingMemory
  ? (g.__mockhookMem ||= memoryStore())
  : new Redis({ url, token, automaticDeserialization: false });

export const KEYS = {
  // Endpoints made before accounts existed. Emptied once someone imports them.
  index: 'mh:endpoints',
  ep: (id) => `mh:ep:${id}`,
  reqs: (id) => `mh:reqs:${id}`,
  count: (id) => `mh:count:${id}`,
  user: (name) => `mh:user:${name}`,
  userEps: (name) => `mh:ueps:${name}`,
  session: (hash) => `mh:sess:${hash}`,
  rate: (kind, who) => `mh:rl:${kind}:${who}`,
};

export const HISTORY = Number(process.env.HISTORY_LIMIT || 100);
export const MAX_ENDPOINTS = Number(process.env.MAX_ENDPOINTS_PER_USER || 25);

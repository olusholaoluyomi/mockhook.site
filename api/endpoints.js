import { redis, KEYS, usingMemory } from '../lib/redis.js';
import { defaultConfig } from '../lib/generate.js';
import { send, getQuery, readJson, newId, validId, requireAuth } from '../lib/http.js';

const MAX_CONFIG = 200 * 1024;

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  const { query } = getQuery(req);
  const id = query.id;

  try {
    if (req.method === 'GET' && id) {
      const raw = await redis.get(KEYS.ep(id));
      return raw ? send(res, 200, JSON.parse(raw)) : send(res, 404, { error: 'Not found' });
    }

    if (req.method === 'GET') {
      const ids = await redis.smembers(KEYS.index);
      if (!ids.length) return send(res, 200, { endpoints: [], memory: usingMemory });
      const [cfgs, counts] = await Promise.all([
        redis.mget(...ids.map(KEYS.ep)),
        redis.mget(...ids.map(KEYS.count)),
      ]);
      const endpoints = ids
        .map((eid, i) => {
          if (!cfgs[i]) return null;
          const c = JSON.parse(cfgs[i]);
          return { id: eid, name: c.name, createdAt: c.createdAt, count: Number(counts[i] || 0) };
        })
        .filter(Boolean)
        .sort((a, b) => b.createdAt - a.createdAt);
      return send(res, 200, { endpoints, memory: usingMemory });
    }

    if (req.method === 'POST') {
      const body = await readJson(req);
      let eid = (body.id || '').trim().toLowerCase();
      if (eid) {
        if (!validId(eid)) return send(res, 400, { error: 'ID can only use a-z, 0-9 and dashes (3–40 chars)' });
        if (await redis.get(KEYS.ep(eid))) return send(res, 409, { error: 'That ID is already taken' });
      } else {
        eid = newId(10);
      }
      let cfg = defaultConfig(eid, body.name);
      if (body.copyFrom && validId(body.copyFrom)) {
        const src = await redis.get(KEYS.ep(body.copyFrom));
        if (src) cfg = { ...JSON.parse(src), id: eid, name: body.name || 'Copy', createdAt: Date.now() };
      }
      await redis.set(KEYS.ep(eid), JSON.stringify(cfg));
      await redis.sadd(KEYS.index, eid);
      return send(res, 201, cfg);
    }

    if (req.method === 'PUT' && validId(id)) {
      const existing = await redis.get(KEYS.ep(id));
      if (!existing) return send(res, 404, { error: 'Not found' });
      const body = await readJson(req);
      const old = JSON.parse(existing);
      const cfg = { ...body, id, createdAt: old.createdAt, updatedAt: Date.now() };
      const text = JSON.stringify(cfg);
      if (text.length > MAX_CONFIG) return send(res, 413, { error: 'Config too large' });
      await redis.set(KEYS.ep(id), text);
      globalThis.__mhCache?.delete(id);
      return send(res, 200, cfg);
    }

    if (req.method === 'DELETE' && validId(id)) {
      await redis.del(KEYS.ep(id), KEYS.reqs(id), KEYS.count(id));
      await redis.srem(KEYS.index, id);
      globalThis.__mhCache?.delete(id);
      return send(res, 200, { ok: true });
    }

    return send(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    return send(res, 500, { error: String(e.message || e) });
  }
}

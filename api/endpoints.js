import { redis, KEYS, usingMemory, MAX_ENDPOINTS } from '../lib/redis.js';
import { defaultConfig } from '../lib/generate.js';
import { send, getQuery, readJson, newId, validId } from '../lib/http.js';
import { requireUser } from '../lib/auth.js';

const MAX_CONFIG = 200 * 1024;

// An endpoint's settings, but only for the person who owns it. Anyone else gets "not found".
async function loadOwned(id, user) {
  if (!validId(id)) return null;
  const raw = await redis.get(KEYS.ep(id));
  const cfg = raw ? JSON.parse(raw) : null;
  return cfg && cfg.owner === user ? cfg : null;
}

export default async function handler(req, res) {
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const { query } = getQuery(req);
    const id = query.id;

    if (req.method === 'GET' && id) {
      const cfg = await loadOwned(id, user);
      return cfg ? send(res, 200, cfg) : send(res, 404, { error: 'Not found' });
    }

    if (req.method === 'GET') {
      const ids = await redis.smembers(KEYS.userEps(user));
      if (!ids.length) return send(res, 200, { endpoints: [], memory: usingMemory });
      const [cfgs, counts] = await Promise.all([
        redis.mget(...ids.map(KEYS.ep)),
        redis.mget(...ids.map(KEYS.count)),
      ]);
      const endpoints = ids
        .map((eid, i) => {
          if (!cfgs[i]) return null;
          const c = JSON.parse(cfgs[i]);
          if (c.owner !== user) return null;
          return { id: eid, name: c.name, createdAt: c.createdAt, count: Number(counts[i] || 0) };
        })
        .filter(Boolean)
        .sort((a, b) => b.createdAt - a.createdAt);
      return send(res, 200, { endpoints, memory: usingMemory });
    }

    if (req.method === 'POST') {
      const body = await readJson(req);
      if (Number(await redis.scard(KEYS.userEps(user))) >= MAX_ENDPOINTS) {
        return send(res, 403, { error: `You have reached the limit of ${MAX_ENDPOINTS} endpoints. Delete one to make room.` });
      }
      const wanted = String(body.id || '').trim().toLowerCase();
      if (wanted && !validId(wanted)) return send(res, 400, { error: 'ID can only use a-z, 0-9 and dashes (3–40 chars)' });

      let base = null;
      if (body.copyFrom) base = await loadOwned(body.copyFrom, user);

      // IDs are shared by everyone, because they are the public URL. "Only if new" makes
      // sure two people can never end up holding the same one.
      let cfg = null;
      for (let tries = 0; tries < 5 && !cfg; tries++) {
        const eid = wanted || newId(10);
        const next = base
          ? { ...base, id: eid, name: body.name || 'Copy', createdAt: Date.now(), owner: user }
          : { ...defaultConfig(eid, body.name), owner: user };
        delete next.updatedAt;
        if (await redis.set(KEYS.ep(eid), JSON.stringify(next), { nx: true })) cfg = next;
        else if (wanted) return send(res, 409, { error: 'That ID is already taken' });
      }
      if (!cfg) return send(res, 500, { error: 'Could not find a free ID. Try again.' });
      await redis.sadd(KEYS.userEps(user), cfg.id);
      return send(res, 201, cfg);
    }

    if (req.method === 'PUT') {
      const old = await loadOwned(id, user);
      if (!old) return send(res, 404, { error: 'Not found' });
      const body = await readJson(req);
      const cfg = { ...body, id, owner: user, createdAt: old.createdAt, updatedAt: Date.now() };
      const text = JSON.stringify(cfg);
      if (text.length > MAX_CONFIG) return send(res, 413, { error: 'Config too large' });
      await redis.set(KEYS.ep(id), text);
      globalThis.__mhCache?.delete(id);
      return send(res, 200, cfg);
    }

    if (req.method === 'DELETE') {
      if (!(await loadOwned(id, user))) return send(res, 404, { error: 'Not found' });
      await redis.del(KEYS.ep(id), KEYS.reqs(id), KEYS.count(id));
      await redis.srem(KEYS.userEps(user), id);
      globalThis.__mhCache?.delete(id);
      return send(res, 200, { ok: true });
    }

    return send(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    return send(res, 500, { error: String(e.message || e) });
  }
}

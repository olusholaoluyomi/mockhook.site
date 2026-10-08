import { redis, KEYS } from '../lib/redis.js';
import { send, readJson, clientIp } from '../lib/http.js';
import {
  signupsOpen, cleanUsername, validUsername, validPassword, hashPassword, passwordMatches, sameSecret,
  startSession, endSession, currentUser, requireUser, allowed,
} from '../lib/auth.js';

const SLOW_DOWN = 'Too many attempts. Wait a few minutes and try again.';

// GET tells the browser who is signed in. POST carries an action:
// register, login, logout, or import (take over endpoints made before accounts existed).
export default async function handler(req, res) {
  try {
    if (req.method === 'GET') return send(res, 200, { user: await currentUser(req) });
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });

    const body = await readJson(req);
    const ip = clientIp(req) || 'unknown';

    if (body.action === 'register') {
      if (!signupsOpen()) return send(res, 403, { error: 'New accounts are switched off on this site.' });
      const username = cleanUsername(body.username);
      if (!validUsername(username)) return send(res, 400, { error: 'Usernames are 3 to 30 characters: letters, numbers, dashes and underscores.' });
      if (!validPassword(body.password)) return send(res, 400, { error: 'Use a password of at least 8 characters.' });
      if (!(await allowed('register', ip, 5, 3600))) return send(res, 429, { error: 'Too many new accounts from this network. Try again in an hour.' });
      const user = { username, ...(await hashPassword(body.password)), createdAt: Date.now() };
      const made = await redis.set(KEYS.user(username), JSON.stringify(user), { nx: true });
      if (!made) return send(res, 409, { error: 'That username is taken.' });
      return send(res, 201, { user: username, token: await startSession(username) });
    }

    if (body.action === 'login') {
      const username = cleanUsername(body.username);
      if (!(await allowed('login', `${username.slice(0, 30)}|${ip}`, 10, 900)) || !(await allowed('login-ip', ip, 40, 900))) return send(res, 429, { error: SLOW_DOWN });
      const raw = validUsername(username) ? await redis.get(KEYS.user(username)) : null;
      const ok = raw && typeof body.password === 'string' && (await passwordMatches(body.password, JSON.parse(raw)));
      if (!ok) return send(res, 401, { error: 'Wrong username or password.' });
      return send(res, 200, { user: username, token: await startSession(username) });
    }

    if (body.action === 'logout') {
      await endSession(req);
      return send(res, 200, { ok: true });
    }

    if (body.action === 'import') {
      const user = await requireUser(req, res);
      if (!user) return;
      const ids = await redis.smembers(KEYS.index);
      if (!ids.length) return send(res, 404, { error: 'There is nothing left to import.' });
      // Sites that had a dashboard password must give it, so only the old owner can take these.
      const old = process.env.DASHBOARD_PASSWORD;
      if (old) {
        if (!(await allowed('import', ip, 10, 900))) return send(res, 429, { error: SLOW_DOWN });
        if (!sameSecret(body.password, old)) return send(res, 401, { error: "That isn't the old dashboard password." });
      }
      const cfgs = await redis.mget(...ids.map(KEYS.ep));
      const mine = [];
      const save = redis.pipeline();
      ids.forEach((id, i) => {
        if (!cfgs[i]) return;
        const cfg = JSON.parse(cfgs[i]);
        if (cfg.owner) return;
        save.set(KEYS.ep(id), JSON.stringify({ ...cfg, owner: user }));
        mine.push(id);
      });
      if (mine.length) { save.sadd(KEYS.userEps(user), ...mine); }
      save.del(KEYS.index);
      await save.exec();
      return send(res, 200, { imported: mine.length });
    }

    return send(res, 400, { error: 'Unknown action' });
  } catch (e) {
    return send(res, 500, { error: String(e.message || e) });
  }
}

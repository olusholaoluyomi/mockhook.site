import {
  fakerEN, fakerEN_NG, fakerEN_GH, fakerEN_ZA, fakerEN_GB, fakerEN_US, fakerEN_IN,
  fakerFR, fakerDE, fakerES, fakerPT_BR,
} from '@faker-js/faker';
import { TYPE_MAP } from './catalog.js';

const FAKERS = {
  en: fakerEN, en_NG: fakerEN_NG, en_GH: fakerEN_GH, en_ZA: fakerEN_ZA, en_GB: fakerEN_GB,
  en_US: fakerEN_US, en_IN: fakerEN_IN, fr: fakerFR, de: fakerDE, es: fakerES, pt_BR: fakerPT_BR,
};

// Safety limits so one request can't burn the CPU allowance.
export const LIMITS = { maxTotal: 100000, maxLimit: 1000, maxArray: 100, maxDepth: 6, maxCount: 1000 };

const clampInt = (v, lo, hi, def) => {
  const x = Number.parseInt(v, 10);
  if (!Number.isFinite(x)) return def;
  return Math.min(hi, Math.max(lo, x));
};
const num = (v, def) => (v === '' || v == null || Number.isNaN(Number(v)) ? def : Number(v));

function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function getPath(obj, path) {
  if (!path) return undefined;
  const parts = String(path).split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    // headers are case-insensitive
    cur = typeof cur === 'object' ? (p in cur ? cur[p] : cur[p.toLowerCase()]) : undefined;
  }
  return cur;
}

function parseFixed(v) {
  if (v == null) return '';
  const t = String(v).trim();
  if (t === '') return '';
  try { return JSON.parse(t); } catch { return v; }
}

function formatDate(d, fmt) {
  switch (fmt) {
    case 'date': return d.toISOString().slice(0, 10);
    case 'unix': return Math.floor(d.getTime() / 1000);
    case 'unixms': return d.getTime();
    default: return d.toISOString();
  }
}

function genValue(f, field, ctx, index, depth) {
  const o = field.opts || {};
  const t = field.type;
  switch (t) {
    case 'object':
      return genObject(f, field.children || [], ctx, index, depth + 1);
    case 'array': {
      const min = clampInt(o.min, 0, LIMITS.maxArray, 1);
      const max = clampInt(o.max, min, LIMITS.maxArray, Math.max(min, 3));
      const count = f.number.int({ min, max });
      const kids = field.children || [];
      const out = [];
      for (let j = 0; j < count; j++) {
        // A list with a single unnamed child becomes a list of plain values.
        if (kids.length === 1 && !kids[0].name) out.push(genValue(f, kids[0], ctx, j, depth + 1));
        else out.push(genObject(f, kids, ctx, j, depth + 1));
      }
      return out;
    }
    case 'seq': return num(o.start, 1) + index;
    case 'number': {
      const min = num(o.min, 0), max = Math.max(min, num(o.max, 1000));
      const dec = clampInt(o.decimals, 0, 8, 0);
      return dec ? f.number.float({ min, max, fractionDigits: dec }) : f.number.int({ min: Math.ceil(min), max: Math.floor(max) });
    }
    case 'amount': {
      const min = num(o.min, 100), max = Math.max(min, num(o.max, 50000));
      return f.number.float({ min, max, fractionDigits: clampInt(o.decimals, 0, 4, 2) });
    }
    case 'age': return f.number.int({ min: num(o.min, 18), max: Math.max(num(o.min, 18), num(o.max, 70)) });
    case 'boolean': return f.number.int({ min: 1, max: 100 }) <= num(o.chanceTrue, 50);
    case 'pick': {
      const vals = String(o.values ?? '').split(',').map((v) => v.trim()).filter(Boolean);
      return vals.length ? parseFixed(f.helpers.arrayElement(vals)) : null;
    }
    case 'fixed': return parseFixed(o.value);
    case 'pattern':
      return String(o.pattern ?? '').replace(/[#?*]/g, (c) =>
        c === '#' ? f.string.numeric(1) : c === '?' ? f.string.alpha({ length: 1, casing: 'upper' }) : f.string.alphanumeric({ length: 1, casing: 'upper' }));
    case 'date': {
      const from = new Date(o.from || '2024-01-01'), to = new Date(o.to || '2026-12-31');
      const ok = !Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime()) && from <= to;
      return formatDate(ok ? f.date.between({ from, to }) : f.date.recent(), o.format);
    }
    case 'null': return null;
    case 'request': {
      const v = getPath(ctx.req, o.path);
      return v === undefined ? parseFixed(o.fallback) : v;
    }
    case 'string.alphanumeric': return f.string.alphanumeric(clampInt(o.length, 1, 256, 24));
    case 'string.uuid': return f.string.uuid();
    default: {
      const def = TYPE_MAP[t];
      if (!def) return null;
      const path = def.fk || t;
      const [ns, fn] = path.split('.');
      const call = f[ns]?.[fn];
      if (typeof call !== 'function') return null;
      try { return call.call(f[ns]); } catch { return null; }
    }
  }
}

function genObject(f, fields, ctx, index, depth) {
  const out = {};
  if (depth > LIMITS.maxDepth) return out;
  for (const field of fields) {
    if (!field || !field.name) continue;
    const nullPct = num(field.nullPct, 0);
    if (nullPct > 0 && f.number.int({ min: 1, max: 100 }) <= nullPct) { out[field.name] = null; continue; }
    out[field.name] = genValue(f, field, ctx, index, depth);
  }
  return out;
}

function makeItem(cfg, ctx, globalIndex) {
  const d = cfg.data || {};
  const f = FAKERS[d.locale] || fakerEN;
  if (d.consistent) f.seed(hashStr(`${cfg.id}:${d.seedSalt || ''}:${globalIndex}`));
  else f.seed(); // fresh randomness every time
  return genObject(f, d.fields || [], ctx, globalIndex, 0);
}

// Builds { status, headers, body } for an endpoint config and a parsed request.
export function buildResponse(cfg, ctx) {
  const r = cfg.response || {};
  const headers = {};
  for (const h of r.headers || []) if (h && h.key) headers[h.key] = String(h.value ?? '');
  const status = clampInt(r.status, 100, 599, 200);

  if (r.mode === 'raw') {
    if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) headers['Content-Type'] = r.contentType || 'application/json';
    return { status, headers, body: String(r.raw ?? '') };
  }

  headers['Content-Type'] ??= 'application/json; charset=utf-8';
  const d = cfg.data || {};
  const p = cfg.pagination || {};
  let body;

  if (d.root === 'object') {
    body = makeItem(cfg, ctx, 0);
  } else if (!p.enabled) {
    const count = clampInt(d.count, 0, LIMITS.maxCount, 10);
    body = Array.from({ length: count }, (_, i) => makeItem(cfg, ctx, i));
  } else {
    const q = ctx.req.query || {};
    const total = clampInt(p.total, 0, LIMITS.maxTotal, 50);
    const maxLimit = clampInt(p.maxLimit, 1, LIMITS.maxLimit, 100);
    const limit = clampInt(q[p.limitParam || 'limit'], 1, maxLimit, clampInt(p.defaultLimit, 1, maxLimit, 10));
    let offset, page;
    if (p.style === 'offset') {
      offset = clampInt(q[p.offsetParam || 'offset'], 0, Number.MAX_SAFE_INTEGER, 0);
      page = Math.floor(offset / limit) + 1;
    } else {
      page = clampInt(q[p.pageParam || 'page'], 1, Number.MAX_SAFE_INTEGER, 1);
      offset = (page - 1) * limit;
    }
    const end = Math.min(total, offset + limit);
    const items = [];
    for (let i = offset; i < end; i++) items.push(makeItem(cfg, ctx, i));
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const hasNext = end < total, hasPrev = offset > 0;

    const link = (pg, off) => {
      if (!ctx.baseUrl) return null;
      const u = new URL(ctx.baseUrl);
      for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
      u.searchParams.set(p.limitParam || 'limit', String(limit));
      if (p.style === 'offset') u.searchParams.set(p.offsetParam || 'offset', String(off));
      else u.searchParams.set(p.pageParam || 'page', String(pg));
      return u.toString();
    };
    const links = {
      self: link(page, offset),
      first: link(1, 0),
      last: link(totalPages, (totalPages - 1) * limit),
      next: hasNext ? link(page + 1, offset + limit) : null,
      prev: hasPrev ? link(Math.max(1, page - 1), Math.max(0, offset - limit)) : null,
    };
    const meta = p.style === 'offset'
      ? { offset, limit, total, count: items.length, hasNext, hasPrev }
      : { page, limit, total, totalPages, count: items.length, hasNext, hasPrev };

    if (p.shape === 'array') {
      body = items;
      headers['X-Total-Count'] = String(total);
      headers['X-Total-Pages'] = String(totalPages);
      headers[p.style === 'offset' ? 'X-Offset' : 'X-Page'] = String(p.style === 'offset' ? offset : page);
      headers['X-Limit'] = String(limit);
      const rel = Object.entries(links).filter(([k, v]) => v && k !== 'self').map(([k, v]) => `<${v}>; rel="${k}"`);
      if (rel.length) headers['Link'] = rel.join(', ');
    } else {
      body = { [p.dataKey || 'data']: items };
      if (p.includeMeta !== false) body[p.metaKey || 'meta'] = meta;
      if (p.includeLinks !== false && ctx.baseUrl) body[p.linksKey || 'links'] = links;
    }
  }

  // Optional outer wrapper, e.g. { status: true, message: "ok", ...body }
  if (d.wrap && d.wrap.enabled && p.shape !== 'array') {
    const extra = {};
    for (const w of d.wrap.fields || []) if (w && w.key) extra[w.key] = parseFixed(w.value);
    const isEnvelope = p.enabled && d.root !== 'object';
    body = isEnvelope ? { ...extra, ...body } : { ...extra, [d.wrap.dataKey || 'data']: body };
  }

  return { status, headers, body: JSON.stringify(body, null, d.pretty === false ? 0 : 2) };
}

export function defaultConfig(id, name) {
  return {
    id,
    name: name || 'Untitled endpoint',
    createdAt: Date.now(),
    response: { status: 200, headers: [], delayMs: 0, mode: 'schema', raw: '{\n  "ok": true\n}', contentType: 'application/json' },
    data: {
      locale: 'en_NG',
      consistent: true,
      root: 'list',
      count: 10,
      pretty: true,
      wrap: { enabled: false, dataKey: 'data', fields: [{ key: 'status', value: 'true' }, { key: 'message', value: 'Users retrieved' }] },
      fields: [
        { name: 'id', type: 'seq', opts: { start: 1 } },
        { name: 'name', type: 'person.fullName' },
        { name: 'email', type: 'internet.email' },
        { name: 'phone', type: 'phone.number' },
        { name: 'city', type: 'location.city' },
        { name: 'status', type: 'pick', opts: { values: 'active, suspended, pending' } },
        { name: 'balance', type: 'amount', opts: { min: 1000, max: 500000, decimals: 2 } },
        { name: 'createdAt', type: 'date', opts: { from: '2024-01-01', to: '2026-09-30', format: 'iso' } },
      ],
    },
    pagination: {
      enabled: true, style: 'page', pageParam: 'page', limitParam: 'limit', offsetParam: 'offset',
      defaultLimit: 10, maxLimit: 100, total: 57, shape: 'envelope', dataKey: 'data', includeMeta: true, includeLinks: true,
    },
    capture: true,
  };
}

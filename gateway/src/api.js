// Web API (/api/*): accounts and sessions, keys, device pairing, nodes and listings, catalog, stats, events.
import crypto from 'node:crypto';
import { bearer, cookie, readJson, send } from './http.js';
import { TokenError, createFirebaseVerifier } from './google.js';
import { clientIp, createLimiter } from './ratelimit.js';
import { licensePolicy, sanitizePrice } from './hub.js';
import { marketPrice, paramsB } from './policy.js';
import { badgeOf, reputation } from './routing.js';
import { ApiError, errors, newSecret, now, p50, sha256 } from './util.js';

const COOKIE = 'ml_session';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const THINKING = /qwen3|qwq|deepseek-r1|glm-4\.[5-9]|gemma4|gpt-oss|magistral|reasoning/i;
const PAIR_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

const unauthorized = (message = 'Sign in first.') => new ApiError(401, 'authentication_error', 'unauthorized', message);
const HOUR = 3600_000;
// Per-IP limits on the unauthenticated endpoints.
const LIMITS = { signup: [5, HOUR], login: [20, 15 * 60_000], pair: [10, HOUR] };
const NO_CREDIT = 'Demo credit goes to the first account created from your network each day, so this one starts at $0.';
const accountView = (a) => ({ id: a.id, email: a.email, name: a.name, handle: a.handle, created_at: a.created_at });

export function createApi(ctx) {
  const { config, db, store, hub, catalog, bus } = ctx;
  const limiter = createLimiter();
  const creditDay = new Map(); // ip -> UTC day its demo credit was handed out
  const verifyGoogle = createFirebaseVerifier({ projectId: config.firebaseProjectId, fetchCerts: config.fetchGoogleCerts });

  // Demo credit for a new account: the first one per IP per UTC day.
  function newAccountCredit(req) {
    const ip = clientIp(req);
    const today = new Date().toISOString().slice(0, 10);
    if (creditDay.get(ip) === today) return 0;
    creditDay.set(ip, today);
    return config.demoCredit;
  }
  const creditFields = (credit) => ({ demo_credit_microusd: credit, ...(!credit && { notice: NO_CREDIT }) });

  function limit(req, name) {
    const [max, windowMs] = LIMITS[name];
    const wait = limiter.take(`${name}:${clientIp(req)}`, max, windowMs);
    if (wait) {
      throw new ApiError(429, 'rate_limit_error', 'rate_limited', `Too many attempts. Try again in ${Math.ceil(wait / 60)} min.`, {
        headers: { 'retry-after': String(wait) },
      });
    }
  }

  // Session cookie, or a Bearer API key / seller token (seed script, CLI).
  function who(req) {
    const s = store.accountBySession(cookie(req, COOKIE));
    if (s) return s;
    return store.bySecret(bearer(req))?.account || null;
  }
  function need(req) {
    const a = who(req);
    if (!a || a.role !== 'user') throw unauthorized();
    return a;
  }

  function setSession(req, res, accountId) {
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    res.setHeader('set-cookie', `${COOKIE}=${store.createSession(accountId)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 86400}${secure}`);
  }

  // ---- accounts ----

  async function signup(req, res) {
    limit(req, 'signup');
    const b = await readJson(req);
    const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
    const password = typeof b.password === 'string' ? b.password : '';
    const name = (typeof b.name === 'string' && b.name.trim()) || email.split('@')[0];
    if (!EMAIL.test(email) || email.length > 200) throw errors.badRequest('Enter a valid email address.');
    if (password.length < 8 || password.length > 200) throw errors.badRequest('Use a password of at least 8 characters.');
    if (store.accountByEmail(email)) throw new ApiError(409, 'invalid_request_error', 'email_taken', 'An account with this email already exists. Sign in instead.');
    const credit = newAccountCredit(req);
    const a = await store.signup({ email, password, name: name.slice(0, 60), credit });
    setSession(req, res, a.id);
    send(res, 201, { account: accountView(a), ...creditFields(credit) });
  }

  async function login(req, res) {
    limit(req, 'login');
    const b = await readJson(req);
    const email = String(b.email || '').trim().toLowerCase();
    const found = store.accountByEmail(email);
    if (found?.google_sub && !found.password_hash) {
      throw new ApiError(401, 'authentication_error', 'google_account', 'This account uses Google sign-in.');
    }
    const a = await store.login(email, String(b.password || ''));
    if (!a) throw new ApiError(401, 'authentication_error', 'bad_credentials', 'Wrong email or password.');
    setSession(req, res, a.id);
    send(res, 200, { account: accountView(a) });
  }

  // Firebase ID token → the account with that Google identity, else the one with that verified email (now
  // linked), else a new password-less account.
  async function google(req, res) {
    limit(req, 'login');
    const b = await readJson(req);
    let claims;
    try {
      claims = await verifyGoogle(b.id_token);
    } catch (err) {
      if (!(err instanceof TokenError)) throw err;
      throw new ApiError(401, 'authentication_error', 'invalid_token', `Google sign-in failed: ${err.message}.`);
    }
    const email = claims.email.trim().toLowerCase();
    let a = store.accountByGoogle(claims.sub);
    if (!a && (a = store.accountByEmail(email))) {
      if (a.google_sub) throw new ApiError(409, 'invalid_request_error', 'email_taken', 'This email is linked to a different Google account.');
      a = store.linkGoogle(a.id, claims.sub);
    }
    if (a) {
      setSession(req, res, a.id);
      return send(res, 200, { account: accountView(a) });
    }
    limit(req, 'signup');
    const credit = newAccountCredit(req);
    const name = (typeof claims.name === 'string' && claims.name.trim()) || email.split('@')[0];
    a = store.insertAccount({ email, name: name.slice(0, 60), googleSub: claims.sub, credit });
    setSession(req, res, a.id);
    send(res, 201, { account: accountView(a), ...creditFields(credit) });
  }

  function logout(req, res) {
    store.deleteSession(cookie(req, COOKIE));
    res.setHeader('set-cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
    send(res, 204);
  }

  // v0 throwaway accounts, kept for the demo seed script: returns an API key (buyer) or seller token (seller).
  // Operator only: needs the admin token.
  async function seedAccount(req, res) {
    if (!config.adminToken || bearer(req) !== config.adminToken) throw errors.forbidden('Seed accounts need the operator token. Sign up instead.');
    const b = await readJson(req);
    const name = typeof b.name === 'string' ? b.name.trim().slice(0, 60) : '';
    if (!name) throw errors.badRequest('`name` is required.');
    if (b.role !== 'buyer' && b.role !== 'seller') throw errors.badRequest('`role` must be buyer or seller.');
    const a = store.insertAccount({ name, handle: typeof b.handle === 'string' ? b.handle : undefined });
    const { secret } = store.createKey(a.id, b.role === 'seller' ? 'seller' : 'api', 'seed');
    send(res, 201, { account: { ...accountView(a), balance_microusd: a.balance }, secret });
  }

  function me(req, res) {
    const a = need(req);
    const requests = db.all(
      `SELECT r.*, s.name AS seller_name, n.name AS node_name FROM requests r
       LEFT JOIN accounts s ON s.id = r.seller_id LEFT JOIN nodes n ON n.id = r.node_id
       WHERE r.buyer_id = ? AND r.verification = 0 ORDER BY r.ts DESC LIMIT 50`, a.id,
    ).map((r) => ({
      request_id: r.id, ts: r.ts, model_id: r.model_id, kind: r.kind, status: r.status,
      seller: { id: r.seller_id, name: r.seller_name }, node: { id: r.node_id, name: r.node_name },
      verification: r.badge, input_tokens: r.input_tokens, output_tokens: r.output_tokens, latency_ms: r.latency_ms, cost_microusd: r.cost,
    }));
    const jobs = db.all(
      "SELECT * FROM requests WHERE seller_id = ? AND status != 'error' ORDER BY ts DESC LIMIT 50", a.id,
    ).map((r) => ({
      job_id: r.job_id, ts: r.ts, listing_id: r.listing_id, model_id: r.model_id, kind: r.kind, node_id: r.node_id,
      input_tokens: r.input_tokens, output_tokens: r.output_tokens, latency_ms: r.latency_ms, earned_microusd: r.earned,
    }));
    const verification_log = db.all(
      `SELECT c.*, l.model_id FROM checks c JOIN listings l ON l.id = c.listing_id WHERE l.seller_id = ? ORDER BY c.id DESC LIMIT 50`, a.id,
    ).map((c) => ({
      ts: c.ts, listing_id: c.listing_id, model_id: c.model_id, method: c.method, passed: !!c.passed, metric: c.metric,
      score: c.score, threshold: c.threshold, state_after: c.state_after,
    }));
    send(res, 200, {
      account: accountView(a), balance_microusd: store.account(a.id).balance, keys: store.keysOf(a.id),
      requests, earnings: store.earnings(a.id), jobs, verification_log,
    });
  }

  async function createKey(req, res) {
    const a = need(req);
    const b = await readJson(req);
    const { key, secret } = store.createKey(a.id, 'api', typeof b.name === 'string' ? b.name.slice(0, 60) : null);
    send(res, 201, { key, secret });
  }

  function deleteKey(req, res, { id }) {
    const a = need(req);
    if (!store.deleteKey(a.id, id)) throw errors.notFound('No such key.');
    send(res, 204);
  }

  // ---- device pairing ----

  const pairCode = () => {
    const r = crypto.randomBytes(8);
    const letters = [...r.subarray(0, 4)].map((b) => PAIR_LETTERS[b % PAIR_LETTERS.length]).join('');
    return `${letters}-${String(r.readUInt32BE(4) % 10_000).padStart(4, '0')}`;
  };
  const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^(.{4})(.{4})$/, '$1-$2');

  async function pair(req, res) {
    limit(req, 'pair');
    const b = await readJson(req);
    const n = b.node && typeof b.node === 'object' ? b.node : {};
    const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : null);
    const num = (v) => (Number.isFinite(v) && v >= 0 ? v : null);
    const info = { name: str(n.name, 80) || 'My computer', os: str(n.os, 40), arch: str(n.arch, 20), cpu: str(n.cpu, 80), ram_gb: num(n.ram_gb), gpu: str(n.gpu, 80), vram_gb: num(n.vram_gb) };
    const t = now();
    db.run('DELETE FROM pairings WHERE expires_at < ?', t - 3600_000);
    let code;
    do code = pairCode();
    while (db.get('SELECT 1 FROM pairings WHERE code = ?', code));
    const pollToken = crypto.randomBytes(24).toString('hex');
    const expires = t + config.pairTtlMs;
    db.run('INSERT INTO pairings (code, poll_hash, info, status, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
      code, sha256(pollToken), JSON.stringify(info), 'pending', t, expires);
    send(res, 201, { pair_code: code, verify_url: `${config.publicUrl}/pair/${code}`, poll_token: pollToken, expires_at: expires });
  }

  const pairStatus = (p) => (p.status === 'approved' ? 'approved' : p.expires_at < now() ? 'expired' : 'pending');

  async function pairPoll(req, res) {
    const b = await readJson(req);
    const p = typeof b.poll_token === 'string' && db.get('SELECT * FROM pairings WHERE poll_hash = ?', sha256(b.poll_token));
    if (!p) throw errors.notFound('Unknown pairing. Start again with `moonlight`.');
    const status = pairStatus(p);
    if (status !== 'approved') return send(res, 200, { status });
    // The node token is handed out once.
    if (!p.node_token) return send(res, 200, { status: 'expired' });
    db.run('UPDATE pairings SET node_token = NULL WHERE code = ?', p.code);
    send(res, 200, { status: 'approved', node_token: p.node_token, node_id: p.node_id });
  }

  function pairInfo(req, res, { code }) {
    const p = db.get('SELECT * FROM pairings WHERE code = ?', normCode(code));
    if (!p) throw errors.notFound('No such pairing code.');
    send(res, 200, { pair_code: p.code, status: pairStatus(p), expires_at: p.expires_at, node: JSON.parse(p.info) });
  }

  function pairApprove(req, res, { code }) {
    const a = store.accountBySession(cookie(req, COOKIE));
    if (!a) throw unauthorized('Sign in to approve this computer.');
    const p = db.get('SELECT * FROM pairings WHERE code = ?', normCode(code));
    if (!p) throw errors.notFound('No such pairing code.');
    const status = pairStatus(p);
    if (status === 'expired') throw new ApiError(410, 'invalid_request_error', 'expired', 'This code has expired. Run `moonlight` again for a new one.');
    if (status === 'approved') throw new ApiError(409, 'invalid_request_error', 'already_approved', 'This computer is already approved.');
    const info = JSON.parse(p.info);
    const token = newSecret('ml_nt');
    const t = now();
    let node = db.get('SELECT * FROM nodes WHERE seller_id = ? AND name = ?', a.id, info.name);
    db.tx(() => {
      if (node) db.run('UPDATE nodes SET token_hash = ?, info = ? WHERE id = ?', sha256(token), JSON.stringify(info), node.id);
      else {
        node = { id: `nod_${crypto.randomBytes(6).toString('hex')}`, name: info.name };
        db.run('INSERT INTO nodes (id, seller_id, name, info, token_hash, trusted, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          node.id, a.id, info.name, JSON.stringify(info), sha256(token), a.trusted, t, t);
      }
      db.run("UPDATE pairings SET status = 'approved', account_id = ?, node_id = ?, node_token = ? WHERE code = ?", a.id, node.id, token, p.code);
    });
    send(res, 200, { node_id: node.id, name: node.name });
  }

  // ---- nodes and listings ----

  // Verification summary for one listing: state, badge, totals, the last 10 results (oldest first), last check time.
  function verificationOf(l) {
    const c = hub.checkCounts(l.id);
    const last = db.all('SELECT passed, ts FROM checks WHERE listing_id = ? ORDER BY id DESC LIMIT 10', l.id);
    return {
      state: l.state, badge: badgeOf(ctx, l), passed: c.passed, failed: c.failed,
      recent: last.map((x) => !!x.passed).reverse(), last_check: last[0]?.ts ?? null,
    };
  }

  function modelRow(l) {
    const stats = db.get("SELECT COUNT(*) AS n, COALESCE(SUM(earned), 0) AS earned FROM requests WHERE listing_id = ? AND status != 'error'", l.id);
    const row = {
      listing_id: l.id, model_id: l.model_id, kind: l.kind, runtime: l.runtime, family: l.family, params_b: paramsB(l), quant: l.quant,
      size_bytes: l.size_bytes, context: l.context, license: { id: l.license_id, source: l.license_source },
      policy: l.policy === 'live' && l.paused ? 'paused' : l.policy,
      price: l.price, market_price: marketPrice(l),
      verify_method: ctx.verifier.methodFor(l),
      verification: verificationOf(l),
      reputation: reputation(ctx, l), requests: stats.n, earned_microusd: stats.earned,
    };
    if (l.dims) row.dims = l.dims;
    if (l.reason && l.policy !== 'live') row.reason = l.reason;
    return row;
  }

  function nodeView(n) {
    const info = JSON.parse(n.info || '{}');
    const conn = hub.conns.get(n.id);
    const e = store.earnings(n.seller_id, n.id);
    return {
      node_id: n.id, name: n.name, os: info.os ?? null, arch: info.arch ?? null, cpu: info.cpu ?? null, ram_gb: info.ram_gb ?? null,
      gpu: info.gpu ?? null, vram_gb: info.vram_gb ?? null, online: !!conn, last_seen: conn ? now() : n.last_seen, agent_version: n.agent_version,
      trusted: !!n.trusted, max_concurrency: conn?.maxConcurrency ?? null, draining: !!conn?.draining,
      paused: !!conn?.paused, reason: conn?.paused ? conn.pauseReason : null, vram: conn?.vram ?? null, vram_budget_gb: info.vram_budget_gb ?? null,
      earnings: { total: e.total, today: e.today }, models: store.listingsOfNode(n.id).map(modelRow),
    };
  }

  function myNodes(req, res) {
    const a = need(req);
    send(res, 200, { nodes: db.all('SELECT * FROM nodes WHERE seller_id = ? ORDER BY first_seen', a.id).map(nodeView) });
  }

  async function patchListing(req, res, { id }) {
    const a = need(req);
    let l = store.listing(id);
    if (!l || l.seller_id !== a.id) throw errors.notFound('No such listing.');
    const b = await readJson(req);
    const fields = {};
    if (b.price !== undefined) {
      const p = sanitizePrice(b.price, config.maxPrice);
      if (!p) throw errors.badRequest('`price` needs in_per_m, out_per_m or per_call in micro-USD.');
      Object.assign(fields, { price: { ...l.price, ...p }, price_source: 'web' });
    }
    if (b.paused !== undefined) fields.paused = !!b.paused;
    if (b.attest === true) {
      fields.attested = true;
      if (l.policy === 'needs_attestation') Object.assign(fields, licensePolicy(l, { attested: true, trusted: false }));
    }
    if (Object.keys(fields).length) l = store.updateListing(id, fields);
    hub.refreshListing(l);
    send(res, 200, modelRow(l));
  }

  // v0: POST /api/listings/:id/pause toggles.
  function togglePause(req, res, { id }) {
    const a = need(req);
    let l = store.listing(id);
    if (!l || l.seller_id !== a.id) throw errors.notFound('No such listing.');
    l = store.updateListing(id, { paused: !l.paused });
    hub.refreshListing(l);
    send(res, 200, modelRow(l));
  }

  // ---- catalog and stats ----

  const summaryText = (m) =>
    [m.kind === 'chat' ? 'Chat model' : m.kind === 'embedding' ? 'Embedding model' : 'Decision model', m.params_b && `${m.params_b}B parameters`, m.quant, m.context && `${Math.round(m.context / 1024)}K context`]
      .filter(Boolean).join(' · ');

  function modelView(m) {
    const s = catalog.summary(m);
    const any = m.auto ? null : db.get("SELECT digest, size_bytes, license_id, license_source FROM listings WHERE model_id = ? AND policy = 'live' ORDER BY updated_at DESC LIMIT 1", m.id);
    let verify_method = 'consistent';
    const conns = [...hub.conns.values()].filter((c) => c.listings.has(m.id));
    if (conns.some((c) => c.trusted)) verify_method = 'trusted';
    else if (m.public && new Set(conns.map((c) => c.sellerId)).size >= 3) verify_method = 'peer';
    return {
      id: m.id, title: m.title, kind: m.kind, auto: !!m.auto, private: !m.public, owner: m.owner || null,
      family: m.family ?? null, params_b: m.params_b ?? null, quant: m.quant ?? null, context: m.context ?? null, dims: m.dims ?? null,
      size_bytes: any?.size_bytes ?? null, digest: any?.digest ?? null, license: any ? { id: any.license_id, source: any.license_source } : null,
      thinking: THINKING.test(`${m.id} ${m.family || ''}`), summary: m.auto ? m.title : summaryText(m), verify_method, ...s,
    };
  }

  function models(req, res) {
    const list = catalog.all().map(modelView).sort((a, b) => b.sellers_online - a.sellers_online || a.id.localeCompare(b.id));
    send(res, 200, { models: list });
  }

  function model(req, res, { id }) {
    const m = catalog.get(id);
    if (!m) throw errors.noModel(id);
    const listings = [];
    const rows = m.auto ? [] : db.all("SELECT l.id FROM listings l WHERE l.model_id = ? AND l.policy = 'live'", m.id);
    for (const { id: lid } of rows) {
      const l = store.listing(lid);
      const seller = store.account(l.seller_id);
      const nodes = db.all('SELECT n.* FROM node_listings x JOIN nodes n ON n.id = x.node_id WHERE x.listing_id = ?', lid);
      for (const n of nodes) {
        const info = JSON.parse(n.info || '{}');
        const conn = hub.conns.get(n.id);
        listings.push({
          listing_id: l.id, model_id: l.model_id, seller: { id: seller.id, name: seller.name, handle: seller.handle },
          node: { ...info, node_id: n.id, name: n.name, online: !!conn, trusted: !!n.trusted },
          paused: l.paused || !!conn?.paused, reason: conn?.paused ? conn.pauseReason : l.paused ? 'manual' : null, vram: conn?.vram ?? null,
          price: l.price, p50_ms: p50(ctx.latency.get(l.id) || []), reputation: reputation(ctx, l),
          verification: verificationOf(l), verify_method: ctx.verifier.methodFor(l),
          held_microusd: l.state === 'flagged' ? db.get("SELECT COALESCE(SUM(amount), 0) AS s FROM ledger WHERE listing_id = ? AND kind = 'earn'", l.id).s : 0,
        });
      }
    }
    send(res, 200, { model: modelView(m), listings });
  }

  function stats(req, res) {
    const t = now();
    const models = new Set();
    const sellers = new Set();
    for (const c of hub.conns.values()) {
      sellers.add(c.sellerId);
      for (const id of c.listings.keys()) models.add(id);
    }
    send(res, 200, {
      nodes_online: hub.conns.size,
      sellers_online: sellers.size,
      models_live: models.size,
      requests_per_min: db.get("SELECT COUNT(*) AS n FROM requests WHERE ts > ? AND verification = 0 AND status = 'ok'", t - 60_000).n,
      paid_to_sellers_microusd: db.get("SELECT COALESCE(SUM(g.amount), 0) AS s FROM ledger g JOIN listings l ON l.id = g.listing_id WHERE g.kind = 'earn' AND l.state != 'flagged'").s,
      verifications_last_hour: db.get('SELECT COUNT(*) AS n FROM checks WHERE ts > ?', t - 3600_000).n,
    });
  }

  function events(req, res) {
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', 'x-accel-buffering': 'no' });
    res.write(': connected\n\n');
    const off = bus.subscribe((type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`));
    const keepalive = setInterval(() => res.write(': ping\n\n'), 15_000);
    res.on('close', () => {
      clearInterval(keepalive);
      off();
    });
  }

  // ---- operator ----

  function admin(req) {
    if (!config.adminToken || bearer(req) !== config.adminToken) throw errors.notFound();
  }

  async function adminListing(req, res, { id }) {
    admin(req);
    const b = await readJson(req);
    if (!store.listing(id)) throw errors.notFound('No such listing.');
    const rate = Number(b.verify_rate);
    if (!(rate >= 0 && rate <= 1)) throw errors.badRequest('`verify_rate` must be between 0 and 1.');
    send(res, 200, modelRow(store.updateListing(id, { verify_rate: rate })));
  }

  async function adminVerify(req, res, { id }) {
    admin(req);
    send(res, 200, { check: await ctx.verifier.check(id) });
  }

  return {
    who, need, signup, login, google, logout, seedAccount, me, createKey, deleteKey,
    pair, pairPoll, pairInfo, pairApprove, myNodes, patchListing, togglePause,
    models, model, stats, events, adminListing, adminVerify,
  };
}

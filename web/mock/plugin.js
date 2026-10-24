// Vite dev-server plugin that answers /api/*, /v1/* and SSE /api/events like the gateway (PROTOCOL.md v0.3).
// Mock-only chat triggers, for demos and screenshots: put #queue, #warm, #failover or #lost in a message.
import * as w from './world.js';
import { chatAnswer, embed, reasoningFor, systemoneAnswer, tokens } from './answers.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const AUTO = {
  'auto/chat-small': (m) => m.kind === 'chat' && (m.params_b ?? 99) <= 9,
  'auto/chat-large': (m) => m.kind === 'chat' && (m.params_b ?? 0) > 9,
  'auto/embedding': (m) => m.kind === 'embedding',
  'auto/decision': (m) => m.kind === 'decision' && !m.private,
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
}
const fail = (res, status, code, message, extra = {}, headers = {}) =>
  send(res, status, { error: { message, type: status === 401 ? 'authentication_error' : 'invalid_request_error', code }, ...extra }, headers);

async function readJson(req) {
  let raw = '';
  for await (const c of req) raw += c;
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return null;
  }
}

function userFrom(req, res) {
  const u = w.sessionUser(req) || w.bearerUser(req);
  if (!u) fail(res, 401, 'invalid_api_key', 'Sign in, or send Authorization: Bearer ml_sk_…');
  return u;
}

// Resolves model (including auto/*) to a listing, or answers with the right error.
function pickListing(res, body, buyer, kind) {
  const filters = body.moonlight || {};
  if (AUTO[body.model]) {
    const ids = w.catalog().filter(AUTO[body.model]).map((m) => m.id);
    const ls = ids.map((id) => w.route(id, filters)).filter(Boolean);
    const best = ls.sort((a, b) => (b.verification.state === 'verified') - (a.verification.state === 'verified') || b.reputation - a.reputation)[0];
    if (best) return best;
    fail(res, 503, 'no_capacity', `No computer is serving ${body.model} right now.`, { moonlight: { suggestions: [] } }, { 'retry-after': '20' });
    return null;
  }
  const meta = w.metaOf(body.model);
  if (!meta || !w.isKnownModel(body.model)) return fail(res, 404, 'model_not_found', `No model named ${body.model}.`);
  if (kind && meta.kind !== kind) return fail(res, 400, 'wrong_kind', `${body.model} is a ${meta.kind} model.`);
  if (buyer.balance <= 0) return fail(res, 402, 'insufficient_balance', 'Balance too low. Top up to continue.');
  const l = w.route(body.model, filters);
  if (!l) {
    const similar = w.catalog().filter((m) => m.kind === meta.kind && m.id !== body.model && m.sellers_online > 0).map((m) => m.id).slice(0, 3);
    const alias = Object.keys(AUTO).find((a) => AUTO[a]({ ...meta }));
    fail(res, 503, 'no_capacity', `No computer is serving ${body.model} right now.`, { moonlight: { suggestions: [...(alias ? [alias] : []), ...similar] } }, { 'retry-after': '20' });
    return null;
  }
  return l;
}

async function chat(req, res) {
  const buyer = userFrom(req, res);
  if (!buyer) return;
  const body = await readJson(req);
  if (!body) return fail(res, 400, 'bad_json', 'Body is not valid JSON.');
  const lastUser = [...(body.messages || [])].reverse().find((m) => m.role === 'user')?.content || '';
  const trigger = /#(queue|failover|lost|warm)\b/.exec(String(lastUser))?.[1];
  await sleep(120);
  let l = pickListing(res, body, buyer, 'chat');
  if (!l) return;
  let node = w.state.nodes.get(l.node_id);
  const meta = w.metaOf(l.model_id);
  const text = chatAnswer(body.messages || [], node.cheat || l.model_id);
  const pieces = tokens(text);
  const thinking = meta.thinking && body.reasoning_effort !== 'none' && !node.cheat;
  const thoughts = thinking ? tokens(reasoningFor(body.messages || [])) : [];
  const input_tokens = Math.round(JSON.stringify(body.messages || []).length / 3.6) + 8;
  const t0 = Date.now();
  const id = 'chatcmpl-' + Math.random().toString(36).slice(2, 12);
  const created = Math.floor(t0 / 1000);
  const ids = { 'x-moonlight-request': id, 'x-moonlight-seller': l.user_id, 'x-moonlight-node': l.node_id };

  if (!body.stream) {
    await sleep(node.ttft + (pieces.length + thoughts.length) * (1000 / node.speed));
    const { cost } = w.settle({ l, buyer, input_tokens, output_tokens: pieces.length + thoughts.length, latency_ms: Date.now() - t0, first_ms: node.ttft });
    return send(res, 200, {
      id, object: 'chat.completion', created, model: l.model_id,
      choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
      usage: { prompt_tokens: input_tokens, completion_tokens: pieces.length, total_tokens: input_tokens + pieces.length },
      moonlight: { cost, seller: l.user_id, node: l.node_id, served_model: l.model_id },
    }, { ...ids, 'x-moonlight-cost-microusd': String(cost) });
  }

  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', ...ids });
  let closed = false;
  req.on('close', () => (closed = true));
  const chunk = (delta, extra = {}, finish = null) =>
    !closed && res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model: l.model_id, choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`);

  if (trigger === 'queue') {
    for (const [pos, eta] of [[3, 9], [2, 6], [1, 3]]) {
      res.write(`: queued position=${pos} eta_s=${eta}\n\n`);
      await sleep(1700);
    }
  }
  const first = Math.round(node.ttft * (0.8 + Math.random() * 0.5));
  res.write(`: waiting model=${l.model_id} elapsed_s=0\n\n`);
  if (trigger === 'warm') {
    for (const s of [5, 10]) {
      await sleep(5000);
      res.write(`: waiting model=${l.model_id} elapsed_s=${s}\n\n`);
    }
    await sleep(2000);
  }
  await sleep(first);
  node.inflight++;
  chunk({ role: 'assistant', content: '' });
  for (const p of thoughts) {
    if (closed) break;
    chunk({ reasoning: p });
    await sleep((1000 / node.speed) * (0.5 + Math.random() * 0.6));
  }
  const failovers = [];
  let sent = 0;
  for (const p of pieces) {
    if (closed) break;
    if (trigger === 'failover' && sent === Math.floor(pieces.length * 0.45)) {
      const next = w.route(l.model_id, { ...body.moonlight }) || l;
      const other = [...w.state.listings.values()].find((x) => x.model_id === l.model_id && x.node_id !== l.node_id && x.policy === 'live' && !x.paused && !x.suspended) || next;
      await sleep(900);
      failovers.push({ from_node: l.node_id, to_node: other.node_id, at_token: sent });
      node.inflight--;
      l = other;
      node = w.state.nodes.get(l.node_id);
      node.inflight++;
    }
    if (trigger === 'lost' && sent === Math.floor(pieces.length * 0.4)) {
      await sleep(1600);
      node.inflight--;
      const { cost } = w.settle({ l, buyer, input_tokens, output_tokens: sent + thoughts.length, latency_ms: Date.now() - t0, first_ms: first });
      chunk({}, { usage: { prompt_tokens: input_tokens, completion_tokens: sent, total_tokens: input_tokens + sent }, moonlight: { cost, seller: l.user_id, node: l.node_id, verified: l.verification.state === 'verified', served_model: l.model_id, error: 'seller_lost' } }, 'length');
      return res.end('data: [DONE]\n\n');
    }
    chunk({ content: p });
    sent++;
    await sleep((1000 / node.speed) * (0.6 + Math.random() * 0.8));
  }
  node.inflight = Math.max(0, node.inflight - 1);
  const output_tokens = sent + thoughts.length;
  const { cost } = w.settle({ l, buyer, input_tokens, output_tokens, latency_ms: Date.now() - t0, first_ms: first });
  if (closed) return;
  chunk({}, {
    usage: { prompt_tokens: input_tokens, completion_tokens: output_tokens, total_tokens: input_tokens + output_tokens },
    moonlight: { cost, seller: l.user_id, node: l.node_id, verified: l.verification.state === 'verified', served_model: l.model_id, ...(failovers.length ? { failovers } : {}) },
  }, 'stop');
  res.end('data: [DONE]\n\n');
}

function meteredHeaders(l, cost, request_id) {
  return { 'x-moonlight-request': request_id, 'x-moonlight-seller': l.user_id, 'x-moonlight-node': l.node_id, 'x-moonlight-cost-microusd': String(cost) };
}

async function systemone(req, res) {
  const buyer = userFrom(req, res);
  if (!buyer) return;
  const body = await readJson(req);
  if (!body) return fail(res, 400, 'bad_json', 'Body is not valid JSON.');
  const l = pickListing(res, body, buyer, 'decision');
  if (!l) return;
  const node = w.state.nodes.get(l.node_id);
  const t0 = Date.now();
  const first = Math.round(node.ttft * (0.7 + Math.random() * 0.4));
  await sleep(first + 60);
  const out = systemoneAnswer({ ...body, model: l.model_id });
  const { cost, request_id } = w.settle({ l, buyer, input_tokens: out.usage.input_tokens, output_tokens: 0, latency_ms: Date.now() - t0, first_ms: first });
  send(res, 200, out, meteredHeaders(l, cost, request_id));
}

async function embeddings(req, res) {
  const buyer = userFrom(req, res);
  if (!buyer) return;
  const body = await readJson(req);
  if (!body) return fail(res, 400, 'bad_json', 'Body is not valid JSON.');
  const l = pickListing(res, body, buyer, 'embedding');
  if (!l) return;
  const node = w.state.nodes.get(l.node_id);
  const inputs = Array.isArray(body.input) ? body.input : [String(body.input ?? '')];
  const t0 = Date.now();
  await sleep(Math.round(node.ttft * 0.6) + 40);
  const dims = w.metaOf(l.model_id).dims;
  const prompt_tokens = inputs.reduce((a, s) => a + Math.ceil(String(s).length / 4), 0);
  const { cost, request_id } = w.settle({ l, buyer, input_tokens: prompt_tokens, output_tokens: 0, latency_ms: Date.now() - t0, first_ms: Date.now() - t0 });
  send(res, 200, {
    object: 'list', model: l.model_id,
    data: inputs.map((s, index) => ({ object: 'embedding', index, embedding: embed(String(s), dims) })),
    usage: { prompt_tokens, total_tokens: prompt_tokens },
  }, meteredHeaders(l, cost, request_id));
}

function events(req, res) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  res.write(': moonlight mock\n\n');
  for (const ev of [...w.state.feed].reverse().slice(-20)) res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev.data)}\n\n`);
  w.state.clients.add(res);
  const beat = setInterval(() => res.write(': ping\n\n'), 15_000);
  req.on('close', () => {
    clearInterval(beat);
    w.state.clients.delete(res);
  });
}

// Per-IP limits and once-a-day demo credit, like the gateway.
const LIMITS = { signup: [5, 3_600_000], login: [200, 900_000], pair: [10, 3_600_000] }; // login is looser than prod so screenshot runs fit
const hits = new Map();
const creditDay = new Map();
const ipOf = (req) => req.socket.remoteAddress || 'local';
function limited(req, res, name) {
  const [max, windowMs] = LIMITS[name];
  const key = `${name}:${ipOf(req)}`;
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    const wait = Math.ceil((recent[0] + windowMs - now) / 1000);
    fail(res, 429, 'rate_limited', `Too many attempts. Try again in ${Math.ceil(wait / 60)} min.`, {}, { 'retry-after': String(wait) });
    return true;
  }
  hits.set(key, [...recent, now]);
  return false;
}
const NO_CREDIT = 'Demo credit goes to the first account created from your network each day, so this one starts at $0.';

const cookie = (sid) => `ml_session=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`;
const accountOf = (u) => ({ id: u.id, email: u.email, name: u.name, handle: u.handle, created_at: u.created_at });

async function handle(req, res, next) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const m = req.method;
  if (!p.startsWith('/api/') && !p.startsWith('/v1/')) return next();
  const origin = `http://${req.headers.host}`;

  // ---- public
  if (m === 'GET' && p === '/api/stats') return send(res, 200, w.stats());
  if (m === 'GET' && p === '/api/events') return events(req, res);
  if (m === 'GET' && p === '/api/models') return send(res, 200, { models: w.catalog() });
  if (m === 'GET' && p.startsWith('/api/models/')) {
    const id = decodeURIComponent(p.slice('/api/models/'.length));
    if (!w.isKnownModel(id)) return fail(res, 404, 'model_not_found', `Nobody lists ${id} right now.`);
    const listings = [...w.state.listings.values()].filter((l) => l.model_id === id && l.policy === 'live').map(w.listingView);
    return send(res, 200, { model: w.modelSummary(id), listings });
  }

  // ---- auth
  if (m === 'POST' && p === '/api/auth/signup') {
    if (limited(req, res, 'signup')) return;
    const body = (await readJson(req)) || {};
    const r = w.signup(body);
    if (r.error) return fail(res, r.code === 'email_taken' ? 409 : 400, r.code, r.error);
    const today = new Date().toISOString().slice(0, 10);
    const credit = creditDay.get(ipOf(req)) === today ? 0 : 5_000_000;
    if (credit) creditDay.set(ipOf(req), today);
    r.user.balance = credit;
    return send(res, 201, { account: accountOf(r.user), demo_credit_microusd: credit, ...(!credit && { notice: NO_CREDIT }) }, { 'set-cookie': cookie(w.newSession(r.user)) });
  }
  if (m === 'POST' && p === '/api/auth/google') {
    if (limited(req, res, 'login')) return;
    const { id_token } = (await readJson(req)) || {};
    let claims = null;
    try {
      claims = JSON.parse(Buffer.from(String(id_token).split('.')[1], 'base64url').toString());
    } catch {
      /* not a JWT */
    }
    if (!claims?.sub || !claims?.email || claims.email_verified !== true) return fail(res, 401, 'invalid_token', 'Google sign-in failed: the token could not be verified.');
    const r = w.googleAccount(claims);
    if (r.error) return fail(res, 409, 'email_taken', r.error);
    const head = { 'set-cookie': cookie(w.newSession(r.user)) };
    if (!r.created) return send(res, 200, { account: accountOf(r.user) }, head);
    const today = new Date().toISOString().slice(0, 10);
    const credit = creditDay.get(ipOf(req)) === today ? 0 : 5_000_000;
    if (credit) creditDay.set(ipOf(req), today);
    r.user.balance = credit;
    return send(res, 201, { account: accountOf(r.user), demo_credit_microusd: credit, ...(!credit && { notice: NO_CREDIT }) }, head);
  }
  if (m === 'POST' && p === '/api/auth/login') {
    if (limited(req, res, 'login')) return;
    const u = w.login((await readJson(req)) || {});
    if (u?.google) return fail(res, 401, 'google_account', 'This account uses Google sign-in.');
    if (!u) return fail(res, 401, 'bad_credentials', 'That email and password do not match.');
    return send(res, 200, { account: accountOf(u) }, { 'set-cookie': cookie(w.newSession(u)) });
  }
  if (m === 'POST' && p === '/api/auth/logout') {
    res.writeHead(204, { 'set-cookie': 'ml_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' });
    return res.end();
  }

  // ---- pairing (the agent side is unauthenticated)
  if (m === 'POST' && p === '/api/devices/pair') {
    if (limited(req, res, 'pair')) return;
    const body = (await readJson(req)) || {};
    if (!body.node?.name) return fail(res, 400, 'bad_node', 'node.name is required.');
    return send(res, 201, w.createPair(body.node, origin));
  }
  if (m === 'POST' && p === '/api/devices/pair/poll') {
    const r = w.pollPair(((await readJson(req)) || {}).poll_token);
    return r ? send(res, 200, r) : fail(res, 404, 'not_found', 'Unknown poll token.');
  }
  const dm = /^\/api\/devices\/([A-Z]{4}-\d{4})(\/approve)?$/.exec(p);
  if (dm) {
    const view = w.pairView(dm[1]);
    if (!view) return fail(res, 404, 'not_found', 'That code does not match any computer. Check it and try again.');
    if (m === 'GET' && !dm[2]) return send(res, 200, view);
    if (m === 'POST' && dm[2]) {
      const u = w.sessionUser(req);
      if (!u) return fail(res, 401, 'unauthorized', 'Sign in to approve this computer.');
      if (view.status !== 'pending') return fail(res, 409, view.status, view.status === 'expired' ? 'This code has expired. Run moonlight again for a new one.' : 'This computer was already approved.');
      return send(res, 200, w.approvePair(dm[1], u));
    }
  }

  // ---- signed in
  if (p === '/api/me' || p.startsWith('/api/me/') || p.startsWith('/api/playground/')) {
    const u = w.sessionUser(req);
    if (!u) return fail(res, 401, 'unauthorized', 'Not signed in.');
    if (m === 'GET' && p === '/api/me') return send(res, 200, w.meView(u));
    if (m === 'GET' && p === '/api/me/nodes') return send(res, 200, w.myNodes(u));
    if (m === 'POST' && p === '/api/me/keys') {
      const { key, secret } = w.addKey(u);
      return send(res, 201, { key, secret });
    }
    const km = /^\/api\/me\/keys\/([^/]+)$/.exec(p);
    if (m === 'DELETE' && km) {
      u.keys = u.keys.filter((k) => k.id !== km[1]);
      for (const [s, k] of w.state.apiKeys) if (k.key_id === km[1]) w.state.apiKeys.delete(s);
      res.writeHead(204);
      return res.end();
    }
    const lm = /^\/api\/me\/listings\/([^/]+)$/.exec(p);
    if (m === 'PATCH' && lm) {
      const r = w.editListing(u, lm[1], (await readJson(req)) || {});
      return r.error ? fail(res, r.status, 'bad_request', r.error) : send(res, 200, r.row);
    }
    if (m === 'POST' && p === '/api/playground/chat') return chat(req, res);
    if (m === 'POST' && p === '/api/playground/systemone') return systemone(req, res);
    if (m === 'POST' && p === '/api/playground/embeddings') return embeddings(req, res);
  }

  // ---- buyer API
  if (m === 'GET' && p === '/v1/models') {
    return send(res, 200, {
      object: 'list',
      data: w.catalog().map((s) => ({ id: s.id, object: 'model', created: 1761350400, owned_by: s.owner || 'moonlight', moonlight: { kind: s.kind, sellers_online: s.sellers_online, price_from: s.price_from, verified: s.verified_share } })),
    });
  }
  if (m === 'POST' && p === '/v1/chat/completions') return chat(req, res);
  if (m === 'POST' && p === '/v1/systemone') return systemone(req, res);
  if (m === 'POST' && p === '/v1/embeddings') return embeddings(req, res);
  fail(res, 404, 'not_found', `No route ${m} ${p}`);
}

export default function moonlightMock() {
  const use = (server) => {
    w.startTraffic();
    server.middlewares.use((req, res, next) => handle(req, res, next).catch(next));
  };
  return { name: 'moonlight-mock', configureServer: use, configurePreviewServer: use };
}

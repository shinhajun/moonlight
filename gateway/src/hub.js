// Seller agents over the /agent WebSocket: hello/welcome, listings and policy, capacity, jobs, heartbeats.
import { BANNED_MODEL, licenseClass, marketPrice } from './policy.js';
import { canonicalModel, newId, normalizeDigest, now } from './util.js';

export class JobError extends Error {
  constructor(code, message = code) {
    super(message);
    this.code = code;
  }
}

// One job on one node, consumed as an async iterator of {type:'chunk', data} then {type:'done', ...}.
// Throws JobError on agent error, timeout, disconnect or cancel.
class Job {
  constructor(hub, conn, id, kind, config) {
    Object.assign(this, { hub, conn, id, config, items: [], wake: null, ended: false, error: null });
    this.timer = setTimeout(() => this.timeout('no first chunk'), kind === 'chat' ? config.firstChunkTimeoutMs : config.jobDeadlineMs);
    this.deadline = setTimeout(() => this.timeout('deadline'), config.jobDeadlineMs);
  }

  notify() {
    const w = this.wake;
    this.wake = null;
    w?.();
  }

  chunk(data) {
    if (this.ended) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.timeout('stalled'), this.config.idleTimeoutMs);
    this.items.push({ type: 'chunk', data });
    this.notify();
  }

  done(msg) {
    if (this.ended) return;
    this.items.push({ type: 'done', usage: msg.usage || {}, result: msg.result, timing: msg.timing || {} });
    this.end(null);
  }

  fail(err) {
    if (!this.ended) this.end(err);
  }

  timeout(why) {
    if (this.ended) return;
    this.conn.send({ t: 'cancel', job_id: this.id });
    this.end(new JobError('timeout', `node ${this.conn.id}: ${why}`));
  }

  cancel() {
    if (this.ended) return;
    this.conn.send({ t: 'cancel', job_id: this.id });
    this.end(new JobError('cancelled'));
  }

  end(err) {
    this.ended = true;
    this.error = err;
    clearTimeout(this.timer);
    clearTimeout(this.deadline);
    this.conn.inflight.delete(this.id);
    this.notify();
    this.hub.capacityChanged();
  }

  async *[Symbol.asyncIterator]() {
    try {
      for (;;) {
        if (this.items.length) yield this.items.shift();
        else if (this.ended) {
          if (this.error) throw this.error;
          return;
        } else await new Promise((r) => (this.wake = r));
      }
    } finally {
      this.cancel();
    }
  }
}

const RUNTIMES = new Set(['ollama', 'lmstudio', 'llamacpp', 'vllm', 'jan', 'localai', 'kobold', 'openai', 'laya']);
const KINDS = new Set(['chat', 'embedding', 'decision']);
const str = (v, max = 80) => (typeof v === 'string' ? v.slice(0, max) : v == null ? null : String(v).slice(0, max));
const nonNeg = (v) => (Number.isFinite(v) && v >= 0 ? v : null);
const posInt = (v) => (Number.isInteger(v) && v > 0 ? v : null);

export function sanitizePrice(p, cap) {
  const out = {};
  for (const k of ['in_per_m', 'out_per_m', 'per_call']) {
    const v = p?.[k];
    if (Number.isFinite(v) && v >= 0) out[k] = Math.min(Math.round(v), k === 'per_call' ? cap.per_call : cap.per_m);
  }
  return Object.keys(out).length ? out : null;
}

// License policy for one listing: 'live' | 'needs_attestation' | 'blocked:license', with a reason.
export function licensePolicy(l, { attested, trusted }) {
  const lic = licenseClass({ id: l.license_id });
  if (lic === 'blocked') return { policy: 'blocked:license', reason: l.license_id };
  if (lic === 'unknown' && !attested && !trusted) {
    return { policy: 'needs_attestation', reason: l.license_id ? `unrecognized license: ${l.license_id}` : 'no license found' };
  }
  return { policy: 'live', reason: null };
}

export function createHub(ctx) {
  const { config, db, store, bus } = ctx;
  const conns = new Map(); // node_id -> conn (online only)
  let pumpQueued = false;

  const log = (s) => config.log?.(s);

  // Accepted digests for a public model: fixed ones from config, every digest a trusted node has reported,
  // and the public source's (Ollama registry or Hugging Face).
  async function acceptedDigests(modelId, runtime) {
    const set = new Set(config.fixedDigests[modelId] || []);
    for (const r of db.all('SELECT digest FROM refs WHERE model_id = ?', modelId)) set.add(r.digest);
    for (const d of await ctx.digests.lookup(modelId, runtime)) set.add(d);
    return set;
  }

  // Listing fields + policy for one advertised model.
  function admit(seller, conn, m, accepted) {
    const model_id = canonicalModel(m?.model_id);
    const runtime = RUNTIMES.has(m?.runtime) ? m.runtime : 'openai';
    const kind = KINDS.has(m?.kind) ? m.kind : runtime === 'laya' ? 'decision' : 'chat';
    const isPrivate = !!m?.private;
    const digest = normalizeDigest(m?.digest) || null;
    const l = {
      model_id: model_id || str(m?.model_id) || '?',
      kind, runtime, digest,
      size_bytes: nonNeg(m?.size_bytes),
      quant: str(m?.quant, 40),
      family: str(m?.family, 60),
      params_b: nonNeg(m?.params_b),
      context: posInt(m?.context),
      dims: posInt(m?.dims),
      license_id: str(m?.license?.id, 120),
      license_source: str(m?.license?.source, 40),
      source_registry: str(m?.source?.registry, 20),
      source_ref: str(m?.source?.ref, 200),
      private: isPrivate,
    };
    const hello = sanitizePrice(m?.price, config.maxPrice);
    Object.assign(l, hello ? { price: hello, price_source: 'hello' } : { price: marketPrice(l), price_source: 'market' });

    const block = (reason) => Object.assign(l, { policy: 'blocked:policy', reason });
    if (!model_id || model_id.length > 160 || /\s/.test(model_id)) return block('invalid_model_id');
    if (BANNED_MODEL.test(`${model_id} ${l.source_ref || ''} ${l.family || ''}`)) return block('uncensored variant');
    if (isPrivate) {
      const parts = model_id.split('/');
      if (parts.length !== 2 || parts[0] !== seller.handle || !parts[1]) return block('namespace');
    } else if (conn.trusted && digest) {
      db.run('INSERT OR IGNORE INTO refs (model_id, digest, node_id, set_at) VALUES (?, ?, ?, ?)', model_id, digest, conn.id, now());
    } else if (accepted.size && (digest || runtime === 'ollama') && !accepted.has(digest)) {
      return block('digest_mismatch');
    }
    const existing = db.get('SELECT attested FROM listings WHERE seller_id = ? AND model_id = ?', seller.id, l.model_id);
    return Object.assign(l, licensePolicy(l, { attested: !!existing?.attested, trusted: conn.trusted }));
  }

  // hello and t:"models": (re)list everything the node advertises.
  async function applyModels(conn, models) {
    models = (Array.isArray(models) ? models : []).slice(0, 200);
    const pub = new Map();
    for (const m of models) {
      const id = canonicalModel(m?.model_id);
      if (id && !m?.private && !pub.has(id)) pub.set(id, m?.runtime);
    }
    const sets = new Map(await Promise.all([...pub].map(async ([id, rt]) => [id, await acceptedDigests(id, rt)])));
    if (conn.ws.readyState !== 1) return null;

    const listings = [];
    conn.listings.clear();
    db.tx(() => {
      db.run('DELETE FROM node_listings WHERE node_id = ?', conn.id);
      for (const m of models) {
        let l = store.upsertListing(conn.sellerId, admit(conn.seller, conn, m, sets.get(canonicalModel(m?.model_id)) || new Set()));
        // Reference nodes are the yardstick, not something to check.
        if (conn.trusted && l.state !== 'verified') l = store.updateListing(l.id, { state: 'verified' });
        db.run('INSERT OR IGNORE INTO node_listings (node_id, listing_id) VALUES (?, ?)', conn.id, l.id);
        if (l.policy === 'live') conn.listings.set(l.model_id, l.id);
        listings.push(welcomeEntry(l));
      }
    });
    return listings;
  }

  function welcomeEntry(l) {
    const e = { listing_id: l.id, model_id: l.model_id, status: l.policy === 'live' ? 'live' : 'rejected' };
    if (l.policy !== 'live') e.reason = l.policy === 'blocked:policy' && l.reason ? l.reason : l.policy;
    if (l.paused) e.paused = true;
    return e;
  }

  async function hello(conn, msg) {
    let seller = null;
    let node = null;
    const n = msg.node || {};
    const info = {
      name: str(n.name) || 'node', os: str(n.os, 40), arch: str(n.arch, 20), cpu: str(n.cpu),
      ram_gb: nonNeg(n.ram_gb), gpu: str(n.gpu), vram_gb: nonNeg(n.vram_gb),
    };
    if (typeof msg.token === 'string' && msg.token.startsWith('ml_nt_')) {
      node = store.nodeByToken(msg.token);
      seller = node && store.account(node.seller_id);
    } else {
      const found = store.bySecret(msg.token);
      if (found?.kind === 'seller') seller = found.account;
    }
    if (!seller) {
      conn.send({ t: 'error', code: 'unauthorized', message: 'Unknown token. Pair this computer again or check --token.' });
      conn.ws.close(4001, 'unauthorized');
      return;
    }
    const t = now();
    if (!node) {
      node = db.get('SELECT * FROM nodes WHERE seller_id = ? AND name = ?', seller.id, info.name);
      if (!node) {
        node = { id: newId('nod'), name: info.name };
        db.run('INSERT INTO nodes (id, seller_id, name, info, trusted, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)',
          node.id, seller.id, info.name, '{}', seller.trusted, t, t);
      }
    }
    info.name = node.name;
    db.run('UPDATE nodes SET info = ?, agent_version = ?, trusted = ?, last_seen = ? WHERE id = ?',
      JSON.stringify(info), str(msg.agent_version, 40), seller.trusted, t, node.id);

    // Same node reconnecting: the new socket replaces the old one.
    const old = conns.get(node.id);
    if (old && old !== conn) old.ws.close(4000, 'replaced');
    Object.assign(conn, {
      id: node.id, sellerId: seller.id, seller, trusted: !!seller.trusted, info, connectedAt: t,
      maxConcurrency: Math.min(posInt(n.max_concurrency) || 1, config.maxConcurrencyCap),
    });
    const listings = await applyModels(conn, msg.models);
    if (!listings) return;
    conns.set(node.id, conn);
    conn.send({ t: 'welcome', node_id: node.id, seller_id: seller.id, listings });
    log(`node ${node.id} online (${seller.handle}${conn.trusted ? ', trusted' : ''}, x${conn.maxConcurrency}): ${listings.map((l) => `${l.model_id}=${l.reason || l.status}`).join(' ')}`);
    bus.publish('node', { ts: t, node_id: node.id, node_name: info.name, seller_id: seller.id, online: true });
    pushStats(conn);
    capacityChanged();
  }

  function onClose(conn) {
    clearInterval(conn.pingTimer);
    for (const job of conn.inflight.values()) job.fail(new JobError('node_disconnected', `node ${conn.id} disconnected`));
    if (!conn.id || conns.get(conn.id) !== conn) return;
    conns.delete(conn.id);
    const t = now();
    db.run('UPDATE nodes SET last_seen = ?, online_ms = online_ms + ? WHERE id = ?', t, t - conn.connectedAt, conn.id);
    log(`node ${conn.id} offline`);
    bus.publish('node', { ts: t, node_id: conn.id, node_name: conn.info.name, seller_id: conn.sellerId, online: false });
  }

  async function onFrame(conn, msg) {
    conn.lastFrame = now();
    if (msg.t === 'ping') return conn.send({ t: 'pong', ts: msg.ts });
    if (msg.t === 'hello') return hello(conn, msg);
    if (!conn.id || conns.get(conn.id) !== conn) return;
    const job = typeof msg.job_id === 'string' ? conn.inflight.get(msg.job_id) : null;
    switch (msg.t) {
      case 'chunk':
        if (job && msg.data && typeof msg.data === 'object') job.chunk(msg.data);
        break;
      case 'done':
        job?.done(msg);
        break;
      case 'error':
        job?.fail(new JobError('agent_error', `${str(msg.code, 40)}: ${str(msg.message, 200)}`));
        break;
      case 'status':
        conn.paused = !!msg.paused;
        capacityChanged();
        break;
      case 'drain':
        // Graceful shutdown: no new jobs; in-flight ones finish, then the agent disconnects.
        conn.draining = true;
        log(`node ${conn.id} draining (${conn.inflight.size} in flight)`);
        break;
      case 'models': {
        const listings = await applyModels(conn, msg.models);
        if (!listings) return;
        conn.send({ t: 'welcome', node_id: conn.id, seller_id: conn.sellerId, listings });
        pushStats(conn);
        capacityChanged();
        break;
      }
    }
  }

  function attach(ws) {
    const conn = {
      ws, id: null, inflight: new Map(), reserved: 0, listings: new Map(), paused: false, draining: false, lastFrame: now(), maxConcurrency: 1,
      send: (m) => ws.readyState === 1 && ws.send(JSON.stringify(m)),
    };
    conn.pingTimer = setInterval(() => {
      const idle = now() - conn.lastFrame;
      if (!conn.id ? idle > config.helloTimeoutMs : idle > config.heartbeatTimeoutMs) ws.terminate();
      else conn.send({ t: 'ping', ts: now() });
    }, Math.min(config.pingIntervalMs, config.helloTimeoutMs));
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (!msg || typeof msg.t !== 'string') return;
      Promise.resolve(onFrame(conn, msg)).catch((err) => log(`agent frame ${msg.t} failed: ${err.stack || err}`));
    });
    ws.on('close', () => onClose(conn));
    ws.on('error', () => {});
  }

  // Free capacity changed: let queued requests take it. Batched so a burst of events pumps once.
  function capacityChanged() {
    if (pumpQueued) return;
    pumpQueued = true;
    setImmediate(() => {
      pumpQueued = false;
      ctx.scheduler?.pump();
    });
  }

  const hasCapacity = (conn) => !conn.paused && !conn.draining && conn.inflight.size + conn.reserved < conn.maxConcurrency;

  function run(conn, { kind, model_id, body }, { reserved = false } = {}) {
    if (reserved) conn.reserved--;
    const job = new Job(api, conn, newId('job'), kind, config);
    conn.inflight.set(job.id, job);
    conn.send({ t: 'job', job_id: job.id, kind, model_id, body, deadline_ms: config.jobDeadlineMs });
    return job;
  }

  // A web edit (attest, pause) changed whether a listing may serve; update the online nodes that advertise it.
  function refreshListing(l) {
    for (const r of db.all('SELECT node_id FROM node_listings WHERE listing_id = ?', l.id)) {
      const conn = conns.get(r.node_id);
      if (!conn) continue;
      if (l.policy === 'live') conn.listings.set(l.model_id, l.id);
      else conn.listings.delete(l.model_id);
      pushStats(conn);
    }
    capacityChanged();
  }

  function checkCounts(listingId) {
    return db.get('SELECT COALESCE(SUM(passed), 0) AS passed, COUNT(*) - COALESCE(SUM(passed), 0) AS failed FROM checks WHERE listing_id = ?', listingId);
  }

  // The CLI's live status line.
  function pushStats(conn) {
    if (!conn?.id) return;
    const rank = { flagged: 2, new: 1, verified: 0 };
    let state = 'verified';
    let passed = 0;
    let failed = 0;
    const listings = [];
    for (const lid of conn.listings.values()) {
      const l = store.listing(lid);
      const c = checkCounts(lid);
      passed += c.passed;
      failed += c.failed;
      if (rank[l.state] > rank[state]) state = l.state;
      listings.push({ listing_id: lid, model_id: l.model_id, state: l.state, paused: l.paused, passed: c.passed, failed: c.failed });
    }
    if (!listings.length) state = 'new';
    const requests = db.get("SELECT COUNT(*) AS n FROM requests WHERE node_id = ? AND status = 'ok'", conn.id).n;
    conn.send({ t: 'stats', earned_microusd: store.earnings(conn.sellerId).total, requests, verification: { passed, failed, state }, listings });
  }

  const api = {
    conns,
    attach,
    run,
    hasCapacity,
    capacityChanged,
    refreshListing,
    pushStats,
    checkCounts,
    close() {
      for (const c of conns.values()) c.ws.terminate();
    },
  };
  return api;
}

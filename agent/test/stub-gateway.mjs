#!/usr/bin/env node
// A tiny stand-in for the Moonlight gateway, for testing the agent without the real one.
// Zero dependencies: a minimal RFC 6455 WebSocket server on node:http.
//
//   node test/stub-gateway.mjs [--port 8787] [--auto-approve 2] [--traffic] [--reference http://127.0.0.1:11434]
//
// - Pairing: POST /api/devices/pair, /api/devices/pair/poll, GET /pair/:code (approve page), POST /api/devices/:code/approve
// - Agent socket: /agent (hello -> welcome with a simple listing policy, jobs, stats, ping)
// - Buyer API: POST /v1/chat/completions (stream or not), /v1/embeddings, /v1/systemone (no auth)
// - --traffic sends a buyer job every few seconds; --reference runs teacher-forced canaries against that Ollama.

import { createHash, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import http from 'node:http';

const NC_LICENSES = { 'qwen-research': 'Qwen RESEARCH license (non-commercial)', 'CC-BY-NC-4.0': 'CC-BY-NC (non-commercial)',
  'CC-BY-NC-SA-4.0': 'CC-BY-NC-SA (non-commercial)', 'MNPL-0.1': 'Mistral non-production license', 'MRL-0.1': 'Mistral research license' };
const POLICY_RE = /abliterat|uncensor|heretic|decensor/i;
const CANARIES = [
  'Write two sentences about a lighthouse keeper who collects seashells.',
  'Explain in one short paragraph why the sky is blue.',
  'Give a one-sentence definition of photosynthesis.',
  'Name four planets and one fact about each.',
  'Describe how a bicycle gear works in two sentences.',
  'Write a short note thanking a neighbor for watering your plants.',
];
const id = (prefix) => `${prefix}_${randomBytes(6).toString('hex')}`;
const firstWords = (s, k = 3) => (String(s).toLowerCase().match(/\w+|[^\w\s]/g) ?? []).slice(0, k).join(' ');

// ---------------------------------------------------------------------------------------------
// Minimal WebSocket server side
// ---------------------------------------------------------------------------------------------

class WsConn extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.parts = [];
    this.open = true;
    socket.on('data', (d) => { this.buf = Buffer.concat([this.buf, d]); this.parse(); });
    socket.on('close', () => this.closed(1006));
    socket.on('error', () => this.closed(1006));
  }

  parse() {
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0], b1 = this.buf[1];
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      const masked = b1 & 0x80;
      const need = off + (masked ? 4 : 0) + len;
      if (this.buf.length < need) return;
      let payload = this.buf.subarray(off + (masked ? 4 : 0), need);
      if (masked) {
        const mask = this.buf.subarray(off, off + 4);
        payload = Buffer.from(payload.map((x, i) => x ^ mask[i % 4]));
      }
      this.buf = this.buf.subarray(need);
      const op = b0 & 0x0f;
      if (op === 0x8) { this.close(payload.length >= 2 ? payload.readUInt16BE(0) : 1000); return; }
      if (op === 0x9) { this.frame(0xa, payload); continue; }
      if (op === 0xa) continue;
      this.parts.push(payload);
      if (b0 & 0x80) {
        const text = Buffer.concat(this.parts).toString('utf8');
        this.parts = [];
        try { this.emit('message', JSON.parse(text)); } catch {}
      }
    }
  }

  frame(op, payload) {
    if (!this.open) return;
    const len = payload.length;
    const head = len < 126 ? Buffer.from([0x80 | op, len])
      : len < 65536 ? Buffer.from([0x80 | op, 126, len >> 8, len & 0xff])
        : Buffer.concat([Buffer.from([0x80 | op, 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(len)); return b; })()]);
    this.socket.write(Buffer.concat([head, payload]));
  }

  send(obj) { this.frame(0x1, Buffer.from(JSON.stringify(obj))); }

  close(code = 1000) {
    if (!this.open) return;
    const b = Buffer.alloc(2);
    b.writeUInt16BE(code);
    this.frame(0x8, b);
    this.socket.end();
    this.closed(code);
  }

  // Drop the TCP connection without a close frame, like a network loss.
  kill() { this.socket.destroy(); this.closed(1006); }

  closed(code) {
    if (!this.open) return;
    this.open = false;
    this.emit('close', code);
  }
}

// ---------------------------------------------------------------------------------------------
// Gateway behavior
// ---------------------------------------------------------------------------------------------

function policyFor(m, attested) {
  if (POLICY_RE.test(m.model_id)) return { policy: 'blocked:policy', reason: 'uncensored/abliterated variant' };
  if (NC_LICENSES[m.license?.id]) return { policy: 'blocked:license', reason: NC_LICENSES[m.license.id] };
  if (m.license?.id === 'unknown' && !attested.has(m.model_id)) return { policy: 'needs_attestation', reason: 'license unknown' };
  return { policy: 'live' };
}

function marketPrice(m) {
  if (m.kind === 'decision') return { per_call: 100 };
  if (m.kind === 'embedding') return { in_per_m: 20_000 };
  const big = (m.params_b ?? 7) > 9;
  return big ? { in_per_m: 150_000, out_per_m: 600_000 } : { in_per_m: 50_000, out_per_m: 200_000 };
}

export function startStub({ port = 0, autoApprove = 2, traffic = false, reference = null, canaryEvery = 6000, log = () => {} } = {}) {
  const events = new EventEmitter();
  const pairs = new Map(); // poll_token -> {code, status, polls, node, token}
  const nodes = new Map(); // node_id -> node session
  const attested = new Set();
  let server;

  function nodeFor(model_id) {
    const live = [...nodes.values()].filter((n) => n.ws.open && !n.paused && !n.draining && n.listings.get(model_id)?.policy === 'live');
    return live.sort((a, b) => a.inflight.size - b.inflight.size)[0];
  }

  // Same wire shape as the real gateway: live, or rejected with the policy (or a policy reason) as reason.
  function welcomeListings(n) {
    return n.models.map((m) => {
      const prev = n.listings.get(m.model_id);
      const l = { listing_id: prev?.listing_id ?? id('lst'), model_id: m.model_id, ...policyFor(m, attested),
        price: m.price ?? marketPrice(m) };
      n.listings.set(m.model_id, l);
      return l.policy === 'live' ? { listing_id: l.listing_id, model_id: l.model_id, status: 'live' }
        : { listing_id: l.listing_id, model_id: l.model_id, status: 'rejected', reason: l.policy === 'blocked:policy' ? l.reason : l.policy };
    });
  }

  function pushStats(n) {
    n.ws.send({
      t: 'stats', earned_microusd: n.earned, requests: n.requests,
      verification: n.verification(),
      listings: [...n.listings.values()].filter((l) => l.policy === 'live').map((l) => ({ listing_id: l.listing_id, model_id: l.model_id, paused: false, ...(n.checks.get(l.model_id) ?? { state: 'new', passed: 0, failed: 0 }) })),
    });
  }

  // Send one job to a node. Resolves with {chunks, done} or {error}; onChunk streams chunk data.
  function dispatch(n, kind, model_id, body, { onChunk, billable = true } = {}) {
    const job_id = id('job');
    return new Promise((resolve) => {
      const job = { job_id, kind, model_id, chunks: [], onChunk, resolve, billable, started: Date.now() };
      n.inflight.set(job_id, job);
      n.ws.send({ t: 'job', job_id, kind, model_id, body, deadline_ms: 120_000 });
      events.emit('job', { node: n, job_id, kind, model_id, body });
    });
  }

  function settle(n, job, outcome) {
    n.inflight.delete(job.job_id);
    if (outcome.done && job.billable) {
      const price = n.listings.get(job.model_id)?.price ?? {};
      const u = outcome.done.usage ?? {};
      const cost = price.per_call ?? Math.round(((u.input_tokens ?? 0) * (price.in_per_m ?? 0) + (u.output_tokens ?? 0) * (price.out_per_m ?? 0)) / 1e6);
      n.earned += Math.round(cost * 0.9);
      n.requests++;
      pushStats(n);
    }
    job.resolve({ ...outcome, chunks: job.chunks });
  }

  function onAgentMessage(n, msg) {
    events.emit('frame', { node: n, msg });
    const job = msg.job_id && n.inflight.get(msg.job_id);
    switch (msg.t) {
      case 'chunk':
        if (!job) return;
        job.chunks.push(msg.data);
        job.onChunk?.(msg.data);
        break;
      case 'done':
        if (job) settle(n, job, { done: msg });
        break;
      case 'error':
        if (job) settle(n, job, { error: msg });
        break;
      case 'status':
        n.paused = msg.paused;
        break;
      case 'models':
        n.models = msg.models;
        n.ws.send({ t: 'welcome', node_id: n.node_id, seller_id: 'slr_stub', listings: welcomeListings(n) });
        break;
      case 'drain':
        n.draining = true;
        break;
      case 'ping':
        n.ws.send({ t: 'pong', ts: msg.ts });
        break;
      default:
        break;
    }
  }

  function onConnection(ws) {
    let n = null;
    ws.on('message', (msg) => {
      if (!n) {
        if (msg.t !== 'hello') return ws.close(4400);
        if (!/^ml_(nt|st)_[0-9a-f]{32}$/.test(msg.token ?? '')) {
          ws.send({ t: 'error', code: 'unauthorized', message: 'unknown token' });
          return ws.close(4401);
        }
        const existing = [...nodes.values()].find((x) => x.token === msg.token);
        n = existing ?? {
          node_id: id('nod'), token: msg.token, listings: new Map(), inflight: new Map(), checks: new Map(), history: new Map(),
          earned: 0, requests: 0,
          verification() {
            const all = [...this.checks.values()];
            const passed = all.reduce((s, c) => s + c.passed, 0), failed = all.reduce((s, c) => s + c.failed, 0);
            return { passed, failed, state: all.some((c) => c.state === 'flagged') ? 'flagged' : all.some((c) => c.state === 'verified') ? 'verified' : 'new' };
          },
        };
        Object.assign(n, { ws, hello: msg, models: msg.models, node: msg.node, trusted: !!msg.trusted, paused: false, draining: false });
        for (const job of n.inflight.values()) job.resolve({ error: { code: 'disconnected' }, chunks: job.chunks });
        n.inflight.clear();
        nodes.set(n.node_id, n);
        ws.send({ t: 'welcome', node_id: n.node_id, seller_id: 'slr_stub', listings: welcomeListings(n) });
        log(`node ${n.node_id} (${msg.node?.name}) online with ${msg.models.length} models`);
        events.emit('hello', { node: n, msg });
        return;
      }
      onAgentMessage(n, msg);
    });
    ws.on('close', (code) => {
      if (!n || n.ws !== ws) return;
      for (const job of n.inflight.values()) settle(n, job, { error: { code: 'disconnected' } });
      log(`node ${n.node_id} offline (${code})`);
      events.emit('close', { node: n, code });
    });
  }

  // ---- teacher-forced canaries (see PROTOCOL.md "Verification") ----

  async function refChat(model, messages, max_tokens) {
    const r = await fetch(`${reference}/v1/chat/completions`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, messages, temperature: 0, seed: 42, max_tokens, reasoning_effort: 'none' }),
    }).then((x) => x.json());
    return r.choices?.[0]?.message?.content ?? '';
  }

  async function runCanary(n, model_id) {
    const prompt = CANARIES[Math.floor(Math.random() * CANARIES.length)];
    const messages = [{ role: 'user', content: prompt }];
    const answer = await refChat(model_id, messages, 48);
    const bounds = [...answer.matchAll(/ \w/g)].map((m) => m.index);
    const step = Math.max(1, Math.floor(bounds.length / 9));
    const picks = bounds.filter((_, i) => i > 0 && i % step === 0).slice(0, 8); // the first boundary is too easy
    let agree = 0;
    for (const b of picks) {
      const prefill = [...messages, { role: 'assistant', content: answer.slice(0, b) }];
      const body = { model: model_id, messages: prefill, temperature: 0, seed: 42, max_tokens: 8, reasoning_effort: 'none', stream: true };
      const [res, ref] = await Promise.all([dispatch(n, 'chat', model_id, body, { billable: false }), refChat(model_id, prefill, 8)]);
      if (res.error) return null;
      const text = res.chunks.map((c) => c.choices?.[0]?.delta?.content ?? '').join('');
      if (firstWords(text) === firstWords(ref)) agree++; // the first 3 words must match the reference node's
    }
    const passed = agree >= Math.ceil(picks.length * 6 / 8);
    const hist = [...(n.history.get(model_id) ?? []), passed].slice(-10);
    n.history.set(model_id, hist);
    const c = n.checks.get(model_id) ?? { passed: 0, failed: 0 };
    c[passed ? 'passed' : 'failed']++;
    const fails = hist.filter((x) => !x).length;
    c.state = fails >= 2 ? 'flagged' : hist.length >= 3 && fails === 0 ? 'verified' : 'new';
    n.checks.set(model_id, c);
    log(`canary ${model_id} on ${n.node_id}: ${agree}/${picks.length} -> ${passed ? 'pass' : 'FAIL'} (${c.state})`);
    events.emit('canary', { node: n, model_id, agree, of: picks.length, passed, state: c.state });
    pushStats(n);
    return { agree, of: picks.length, passed, state: c.state };
  }

  // ---- HTTP: pairing + buyer API ----

  async function readJSON(req) {
    let s = '';
    for await (const c of req) s += c;
    try { return JSON.parse(s || '{}'); } catch { return {}; }
  }

  function json(res, status, body) {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    if (req.method === 'POST' && p === '/api/devices/pair') {
      const body = await readJSON(req);
      const code = `${randomBytes(2).toString('hex').toUpperCase()}-${String(Math.floor(Math.random() * 1e4)).padStart(4, '0')}`;
      const poll_token = randomBytes(16).toString('hex');
      pairs.set(poll_token, { code, status: 'pending', polls: 0, node: body.node });
      events.emit('pair', { code, node: body.node });
      return json(res, 200, { pair_code: code, verify_url: `http://${req.headers.host}/pair/${code}`, poll_token, expires_at: Date.now() + 600_000, interval: 1 });
    }
    if (req.method === 'POST' && p === '/api/devices/pair/poll') {
      const { poll_token } = await readJSON(req);
      const pr = pairs.get(poll_token);
      if (!pr) return json(res, 404, { error: { message: 'unknown poll token', code: 'not_found' } });
      pr.polls++;
      if (pr.status === 'pending' && autoApprove && pr.polls >= autoApprove) pr.status = 'approved';
      if (pr.status !== 'approved') return json(res, 200, { status: pr.status });
      pr.token ??= `ml_nt_${randomBytes(16).toString('hex')}`;
      return json(res, 200, { status: 'approved', node_token: pr.token });
    }
    const approve = p.match(/^\/api\/devices\/([\w-]+)\/approve$/);
    if (req.method === 'POST' && approve) {
      const pr = [...pairs.values()].find((x) => x.code === approve[1]);
      if (!pr) return json(res, 404, { error: { message: 'no such code' } });
      pr.status = 'approved';
      return json(res, 200, { node_id: 'nod_pending', name: pr.node?.name });
    }
    const page = p.match(/^\/pair\/([\w-]+)$/);
    if (req.method === 'GET' && page) {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(`<!doctype html><title>Approve</title><body style="font-family:system-ui;padding:3rem">
        <h1>Approve this computer?</h1><p>Code <b>${page[1]}</b></p>
        <button onclick="fetch('/api/devices/${page[1]}/approve',{method:'POST'}).then(()=>document.body.innerHTML='<h1>Approved</h1>')">Approve</button></body>`);
    }
    if (req.method === 'POST' && p === '/api/stub/attest') {
      const { model_id } = await readJSON(req);
      attested.add(model_id);
      for (const n of nodes.values()) if (n.ws.open) n.ws.send({ t: 'welcome', node_id: n.node_id, seller_id: 'slr_stub', listings: welcomeListings(n) });
      return json(res, 200, { ok: true });
    }
    const buyer = { '/v1/chat/completions': 'chat', '/v1/embeddings': 'embedding', '/v1/systemone': 'decision' }[p];
    if (req.method === 'POST' && buyer) {
      const body = await readJSON(req);
      const n = nodeFor(body.model);
      if (!n) return json(res, 503, { error: { message: `no seller online for ${body.model}`, type: 'unavailable', code: 'no_capacity' } });
      if (buyer !== 'chat') {
        const r = await dispatch(n, buyer, body.model, body);
        if (r.error) return json(res, 502, { error: { message: r.error.message ?? r.error.code, code: r.error.code } });
        return json(res, 200, r.done.result);
      }
      const stream = !!body.stream;
      if (stream) res.writeHead(200, { 'content-type': 'text/event-stream' });
      const r = await dispatch(n, 'chat', body.model, { ...body, stream: true },
        { onChunk: stream ? (c) => res.write(`data: ${JSON.stringify(c)}\n\n`) : undefined });
      if (stream) return res.end(r.error ? `data: ${JSON.stringify({ error: r.error })}\n\n` : 'data: [DONE]\n\n');
      if (r.error) return json(res, 502, { error: { message: r.error.message ?? r.error.code, code: r.error.code } });
      const content = r.chunks.map((c) => c.choices?.[0]?.delta?.content ?? '').join('');
      return json(res, 200, { id: r.done.job_id, object: 'chat.completion', model: body.model,
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: r.done.usage.input_tokens, completion_tokens: r.done.usage.output_tokens, total_tokens: r.done.usage.input_tokens + r.done.usage.output_tokens } });
    }
    json(res, 404, { error: { message: 'not found' } });
  }

  server = http.createServer((req, res) => handle(req, res).catch((e) => json(res, 500, { error: { message: e.message } })));
  server.on('upgrade', (req, socket) => {
    if (new URL(req.url, 'http://x').pathname !== '/agent') return socket.destroy();
    const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    onConnection(new WsConn(socket));
  });

  const timers = [];
  if (traffic) {
    const prompts = ['Give me a haiku about the moon.', 'What is a good name for a bakery?', 'Explain recursion to a child in two sentences.',
      'Suggest three weekend hobbies.', 'Summarize the plot of Romeo and Juliet in one sentence.'];
    timers.push(setInterval(() => {
      for (const n of nodes.values()) {
        if (!n.ws.open || n.paused || n.draining || n.inflight.size >= (n.node?.max_concurrency ?? 1)) continue;
        const live = n.models.filter((m) => n.listings.get(m.model_id)?.policy === 'live' && (m.kind !== 'chat' || (m.params_b ?? 99) <= 9));
        const m = live[Math.floor(Math.random() * live.length)];
        if (!m) continue;
        const prompt = prompts[Math.floor(Math.random() * prompts.length)];
        const body = m.kind === 'chat' ? { model: m.model_id, messages: [{ role: 'user', content: prompt }], max_tokens: 80, stream: true }
          : m.kind === 'embedding' ? { model: m.model_id, input: prompt }
            : { model: m.model_id, state: { message: prompt }, questions: { route: { type: 'choice', instructions: 'Which team should answer `message`?', criteria: { support: 'help with a product', sales: 'buying', other: 'anything else' } } } };
        dispatch(n, m.kind, m.model_id, body);
      }
    }, 2500));
  }
  if (reference) {
    let busy = false;
    timers.push(setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        for (const n of nodes.values()) {
          if (!n.ws.open || n.draining) continue;
          for (const m of n.models.filter((x) => x.kind === 'chat' && n.listings.get(x.model_id)?.policy === 'live' && (x.params_b ?? 99) <= 9)) {
            await runCanary(n, m.model_id).catch((e) => log(`canary error: ${e.message}`));
          }
        }
      } finally { busy = false; }
    }, canaryEvery));
  }

  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => {
    const actual = server.address().port;
    resolve({
      port: actual, url: `ws://127.0.0.1:${actual}/agent`, http: `http://127.0.0.1:${actual}`, events, nodes, pairs, dispatch, runCanary,
      nodeFor, attest: (model_id) => attested.add(model_id),
      close: () => new Promise((r) => { timers.forEach(clearInterval); for (const n of nodes.values()) n.ws.kill(); server.close(() => r()); }),
    });
  }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
  const stub = await startStub({
    port: Number(arg('port', 8787)),
    autoApprove: Number(arg('auto-approve', 2)),
    traffic: process.argv.includes('--traffic'),
    reference: arg('reference', null),
    log: (s) => console.log(`[stub ${new Date().toTimeString().slice(0, 8)}] ${s}`),
  });
  console.log(`stub gateway on ${stub.url}  (pairing auto-approves after ${arg('auto-approve', 2)} polls; 0 = approve at ${stub.http}/pair/<code>)`);
}

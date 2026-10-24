// Test harness: a gateway on a random port with in-memory SQLite, plus scripted in-process fake agents
// that speak the /agent protocol over a real WebSocket.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createGateway } from '../src/app.js';
import { loadConfig } from '../src/config.js';

export const TRUSTED_TOKEN = 'ml_st_00000000000000000000000000000001';
export const ADMIN = 'admin-test-token';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(fn, { timeout = 3000, every = 10 } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('waitFor timed out');
    await sleep(every);
  }
}

export async function startGateway(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-gw-'));
  fs.mkdirSync(path.join(dir, 'web/assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'web/index.html'), '<!doctype html><title>Moonlight web</title>');
  fs.writeFileSync(path.join(dir, 'web/assets/app.js'), 'console.log(1)');
  fs.writeFileSync(path.join(dir, 'agent.mjs'), '// agent');
  fs.mkdirSync(path.join(dir, 'release'));
  fs.writeFileSync(path.join(dir, 'release/install.sh'), '#!/bin/sh\necho install');
  fs.writeFileSync(path.join(dir, 'release/moonlight-linux-x64'), 'BINARY');

  const config = loadConfig({
    dbPath: ':memory:',
    registryUrl: null,
    trustedTokens: [TRUSTED_TOKEN],
    adminToken: ADMIN,
    webDist: path.join(dir, 'web'),
    agentFile: path.join(dir, 'agent.mjs'),
    releaseDir: path.join(dir, 'release'),
    firstChunkTimeoutMs: 400,
    idleTimeoutMs: 400,
    jobDeadlineMs: 5000,
    maxWaitS: 0,
    ...overrides,
    verify: { canaryTickMs: 0, rate: 0, ...overrides.verify },
  });
  const gw = createGateway(config);
  const { port } = await gw.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${port}`;
  const agents = [];

  const g = {
    gw, ctx: gw.ctx, base, config,
    async close() {
      for (const a of agents) a.close();
      await gw.close();
    },
    async req(method, p, { body, key, cookie, headers = {} } = {}) {
      const h = { ...headers };
      if (body !== undefined) h['content-type'] = 'application/json';
      if (key) h.authorization = `Bearer ${key}`;
      if (cookie) h.cookie = cookie;
      const res = await fetch(base + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {}
      return { status: res.status, headers: Object.fromEntries(res.headers), body: json, text };
    },
    post: (p, body, opts) => g.req('POST', p, { ...opts, body }),
    get: (p, opts) => g.req('GET', p, opts),
    async account(role, name = `${role}-${Math.random().toString(36).slice(2, 7)}`) {
      const r = await g.post('/api/accounts', { name, role });
      return { ...r.body.account, secret: r.body.secret };
    },
    buyer: (name) => g.account('buyer', name),
    seller: (name) => g.account('seller', name),
    async agent(opts) {
      const token = opts.token || (opts.seller || (await g.seller())).secret;
      const a = new FakeAgent(`ws://127.0.0.1:${port}/agent`, { ...opts, token });
      agents.push(a);
      await a.connect();
      return a;
    },
    chat: (key, body) => g.post('/v1/chat/completions', body, { key }),
    async stream(key, body) {
      const res = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify({ ...body, stream: true }),
      });
      const raw = await res.text();
      const headers = Object.fromEntries(res.headers);
      if (!headers['content-type']?.includes('event-stream')) return { status: res.status, headers, body: JSON.parse(raw) };
      const comments = [];
      const chunks = [];
      for (const block of raw.split('\n\n')) {
        if (block.startsWith(':')) comments.push(block);
        else if (block.startsWith('data: ') && block !== 'data: [DONE]') chunks.push(JSON.parse(block.slice(6)));
      }
      const final = chunks.at(-1);
      const text = chunks.map((c) => c.choices?.[0]?.delta?.content || '').join('');
      return { status: res.status, headers, chunks, comments, final, text, done: raw.trimEnd().endsWith('data: [DONE]') };
    },
    // Session cookie for a new email/password account.
    async user(email = `u${Math.random().toString(36).slice(2, 8)}@example.com`, password = 'correct-horse', name = 'Test User') {
      const r = await g.post('/api/auth/signup', { email, password, name });
      return { ...r.body.account, cookie: r.headers['set-cookie'].split(';')[0], password };
    },
    listing: (id) => gw.ctx.store.listing(id),
  };
  return g;
}

export const chatModel = (model_id, extra = {}) => ({
  model_id, kind: 'chat', runtime: 'ollama', digest: `digest-${model_id}`, license: { id: 'Apache-2.0', source: 'ollama' },
  price: { in_per_m: 50_000, out_per_m: 200_000 }, ...extra,
});

// Splits text into word-ish pieces the way Ollama streams tokens.
export const pieces = (text) => text.match(/\s*\S+/g) || [];

const lastUser = (body) => [...(body.messages || [])].reverse().find((m) => m.role === 'user')?.content || '';
const prefillOf = (body) => {
  const last = body.messages?.at(-1);
  return last?.role === 'assistant' ? last.content : null;
};

// A deterministic "language model": answer(prompt) is the greedy answer. With a prefill it continues the
// answer from that point (or, with restart:true, ignores the prefill like gemma4/glm do). max_tokens is honoured.
export function model(answer, { restart = false, usage = null, delayMs = 0 } = {}) {
  return async (job, io) => {
    const full = answer(lastUser(job.body), job);
    const prefix = prefillOf(job.body);
    let text = full;
    if (prefix && !restart) {
      if (full.startsWith(prefix)) text = full.slice(prefix.length);
      else {
        // Teacher-forced on someone else's text: continue with our own word at that position.
        const k = pieces(prefix).length;
        text = pieces(full).slice(k).join('');
      }
    }
    let parts = pieces(text);
    if (job.body.max_tokens) parts = parts.slice(0, job.body.max_tokens);
    for (const p of parts) {
      if (delayMs) await sleep(delayMs);
      if (io.closed) return;
      io.chunk(p);
    }
    io.done(usage ?? { input_tokens: 20, output_tokens: parts.length });
  };
}

export const say = (text, opts) => model(() => text, opts);

// Stable pseudo-random words per (seed, prompt), so honest nodes agree and a cheater does not.
export function wordsFor(seed, prompt, n = 24) {
  let h = 2166136261;
  for (const ch of `${seed}|${prompt}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const vocab = ['the', 'sun', 'light', 'water', 'plants', 'energy', 'make', 'food', 'from', 'air', 'and', 'grow', 'green', 'leaves', 'sugar',
    'oxygen', 'roots', 'soil', 'warm', 'days', 'night', 'cells', 'tiny', 'world', 'every', 'living', 'thing', 'needs', 'it', 'too'];
  const out = [];
  for (let i = 0; i < n; i++) {
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    out.push(vocab[h % vocab.length]);
  }
  return out.join(' ');
}

export class FakeAgent {
  constructor(url, { token, name = 'node', models = [], maxConcurrency = 1, behavior = say('ok'), trusted = false }) {
    Object.assign(this, { url, token, name, models, maxConcurrency, behavior, trusted });
    this.jobs = [];
    this.frames = [];
    this.stats = null;
    this.open = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.ws.onopen = () => this.send({
        t: 'hello', token: this.token, agent_version: 'fake/1',
        node: { name: this.name, os: 'linux', arch: 'x64', cpu: 'test', ram_gb: 16, gpu: 'Fake GPU', vram_gb: 8, max_concurrency: this.maxConcurrency },
        models: this.models,
      });
      this.ws.onerror = (e) => reject(e);
      this.ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        this.frames.push(m);
        if (m.t === 'welcome') {
          this.welcome = m;
          this.nodeId = m.node_id;
          this.sellerId = m.seller_id;
          resolve(m);
        } else if (m.t === 'stats') this.stats = m;
        else if (m.t === 'job') this.run(m);
        else if (m.t === 'cancel') {
          const io = this.open.get(m.job_id);
          if (io) io.closed = true;
        } else if (m.t === 'error') reject(new Error(m.message));
      };
      this.ws.onclose = () => {
        this.closed = true;
        for (const io of this.open.values()) io.closed = true;
      };
    });
  }

  listing(modelId) {
    return this.welcome.listings.find((l) => l.model_id === modelId);
  }

  send(m) {
    if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m));
  }

  async run(job) {
    this.jobs.push(job);
    let first = true;
    const io = {
      closed: false,
      job,
      chunk: (content, extra = {}) => {
        const delta = first ? { role: 'assistant', content } : { content };
        first = false;
        this.send({ t: 'chunk', job_id: job.job_id, data: { id: 'chatcmpl-x', object: 'chat.completion.chunk', model: job.model_id, choices: [{ index: 0, delta: { ...delta, ...extra }, finish_reason: null }] } });
      },
      reasoning: (text) => {
        first = false;
        this.send({ t: 'chunk', job_id: job.job_id, data: { choices: [{ index: 0, delta: { reasoning: text }, finish_reason: null }] } });
      },
      done: (usage, result) => {
        if (io.closed) return;
        this.send({ t: 'chunk', job_id: job.job_id, data: { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] } });
        this.send({ t: 'done', job_id: job.job_id, usage, result, timing: { first_ms: 1, total_ms: 2 } });
        this.open.delete(job.job_id);
      },
      result: (result, usage = { input_tokens: 30, output_tokens: 0 }) => {
        this.send({ t: 'done', job_id: job.job_id, usage, result, timing: { first_ms: 1, total_ms: 2 } });
        this.open.delete(job.job_id);
      },
      error: (code = 'boom', message = 'failed') => this.send({ t: 'error', job_id: job.job_id, code, message }),
      drop: () => this.ws.close(),
    };
    this.open.set(job.job_id, io);
    try {
      await this.behavior(job, io, this);
    } catch {}
  }

  close() {
    try {
      this.ws?.close();
    } catch {}
  }
}

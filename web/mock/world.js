// Simulated Moonlight network for local development (PROTOCOL.md v0.2). Money is micro-USD, times are epoch ms.
import { createHash, randomBytes } from 'node:crypto';

const now = () => Date.now();
const rid = (prefix, n = 6) => `${prefix}_${randomBytes(n).toString('hex')}`;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const sha = (s) => createHash('sha256').update(s).digest('hex');

// Demo logins for screenshots and local testing.
export const DEMO_LOGIN = { email: 'demo@moonlight.dev', password: 'moonlight' };
export const CHEAT_LOGIN = { email: 'cheat@moonlight.dev', password: 'moonlight' };
export const DEMO_API_KEY = 'ml_sk_' + 'de'.repeat(16);

// What the gateway knows about a model id once someone lists it. Everything else comes from discovery.
const META = {
  'qwen3.5:35b-a3b': { kind: 'chat', family: 'Qwen 3.5', params_b: 35, quant: 'Q4_K_M', context: 262144, size_bytes: 21.4e9, thinking: true, license: { id: 'Apache-2.0', source: 'ollama' }, summary: 'Mixture-of-experts, 35B total / 3B active. Strong general chat and code.', digest: 'sha256:7c1f0e2a9b4d83e65a1f2c9d0b7e4a3f6c58d21e9a0b4c7d3e2f1a9b8c7d6e5f' },
  'gemma4:26b': { kind: 'chat', family: 'Gemma 4', params_b: 26, quant: 'Q4_K_M', context: 131072, size_bytes: 16.8e9, thinking: true, license: { id: 'Gemma', source: 'ollama' }, summary: 'Careful writing, long context, many languages.', digest: 'sha256:2b9e4c1d7a0f3e8b5c6d9a2e1f4b7c0d3a6e9f2b5c8d1e4a7b0c3f6e9d2a5b8c' },
  'qwen2.5:3b': { kind: 'chat', family: 'Qwen 2.5', params_b: 3, quant: 'Q4_K_M', context: 32768, size_bytes: 1.9e9, license: { id: 'Qwen', source: 'ollama' }, summary: 'Small and quick. Runs on nearly any laptop.', digest: 'sha256:357c53fb659c5076de1d65ccb0b397446227b71a42be9d1603d46168015c9e4b' },
  'llama3.2:3b': { kind: 'chat', family: 'Llama 3.2', params_b: 3, quant: 'Q4_K_M', context: 131072, size_bytes: 2.0e9, license: { id: 'Llama 3.2', source: 'ollama' }, summary: "Meta's small model. Good at short tasks and tool calls.", digest: 'sha256:a80c4f17acd55265feec403c7aef86be0c25983ab279d83f3bcd3abbcb5b8b72' },
  'nomic-embed-text:v1.5': { kind: 'embedding', family: 'Nomic Embed', params_b: 0.137, quant: 'F16', context: 8192, size_bytes: 274e6, dims: 768, license: { id: 'Apache-2.0', source: 'ollama' }, summary: 'Text embeddings for search and clustering. 768 dimensions.', digest: 'sha256:0a109f422b47e3a30ba2b10eca18548e944e8a23073ee3f3e947efcf3c45e59f' },
  'mxbai-embed-large': { kind: 'embedding', family: 'mxbai', params_b: 0.335, quant: 'F16', context: 512, size_bytes: 670e6, dims: 1024, license: { id: 'Apache-2.0', source: 'ollama' }, summary: 'Larger English embedding model. 1024 dimensions.', digest: 'sha256:819c2adf5ce6df2b6bd2ae4ca90d2a69f060afeb438d0c171db57daa02e39c3d' },
  'laya-base': { kind: 'decision', family: 'Laya', params_b: 0.6, quant: 'BF16', size_bytes: 1.2e9, license: { id: 'Apache-2.0', source: 'hf' }, summary: 'Open System-1 model. Typed answers with calibrated probabilities.', digest: 'sha256:891102d372688fc2a094dac56a384bc537b87c63f21f9f3dac0be2b7cbc8d86c' },
  'laya-multilingual': { kind: 'decision', family: 'Laya', params_b: 0.8, quant: 'BF16', size_bytes: 1.6e9, license: { id: 'Apache-2.0', source: 'hf' }, summary: 'Laya trained on 40 languages. Same typed answers.', digest: 'sha256:9d628fd971b700382ac6f65920a86f149777b2e748e0c955fb3b19695aa8f204' },
  'hajun/support-triage': { kind: 'decision', family: 'Laya fine-tune', params_b: 0.6, quant: 'BF16', size_bytes: 1.2e9, private: true, license: { id: 'Private', source: 'local' }, summary: 'Laya fine-tuned on support tickets: refund, bug, billing, urgency.', digest: null },
  'codestral:22b': { kind: 'chat', family: 'Codestral', params_b: 22, quant: 'Q4_0', context: 32768, size_bytes: 12.6e9, license: { id: 'MNPL-0.1', source: 'ollama' }, summary: 'Mistral code model.' },
  'command-r:35b': { kind: 'chat', family: 'Command R', params_b: 35, quant: 'Q4_0', context: 131072, size_bytes: 18.8e9, license: { id: 'CC-BY-NC-4.0', source: 'ollama' }, summary: 'Cohere retrieval model.' },
  'llama3.1-abliterated:8b': { kind: 'chat', family: 'Llama 3.1', params_b: 8, quant: 'Q4_K_M', context: 131072, size_bytes: 4.9e9, license: { id: 'Llama 3.1', source: 'hf' }, summary: 'Refusal-removed fine-tune.' },
  'nemo-storyteller-12b': { kind: 'chat', family: 'Mistral Nemo merge', params_b: 12, quant: 'Q5_K_M', context: 32768, size_bytes: 8.7e9, license: { id: 'unknown', source: 'local' }, summary: 'Community merge for long-form fiction.' },
};

const NC_LICENSES = { 'MNPL-0.1': 'Mistral AI Non-Production License: no commercial use.', 'CC-BY-NC-4.0': 'Creative Commons Non-Commercial: no selling access.' };
const POLICY_PATTERN = /uncensored|abliterat|heretic/i;

// Suggested ("market") price from size and kind: embedding < small chat < large chat.
export function marketPrice(meta) {
  if (meta.kind === 'decision') return { per_call: meta.private ? 60 : 40 };
  if (meta.kind === 'embedding') return { in_per_m: Math.round(8_000 + meta.params_b * 30_000) };
  const p = meta.params_b ?? 7;
  const out = p <= 4 ? 80_000 : p <= 14 ? 180_000 : p <= 30 ? 340_000 : 420_000;
  return { in_per_m: Math.round(out / 4), out_per_m: out };
}

const jitter = (p, k) => Object.fromEntries(Object.entries(p).map(([key, v]) => [key, Math.max(1, Math.round((v * k) / (key === 'per_call' ? 1 : 1000)) * (key === 'per_call' ? 1 : 1000))]));

function policyFor(model_id, meta, attested) {
  if (POLICY_PATTERN.test(model_id)) return { policy: 'blocked:policy', reason: 'Uncensored and abliterated variants cannot be listed on Moonlight.' };
  const nc = NC_LICENSES[meta.license?.id];
  if (nc) return { policy: 'blocked:license', reason: nc };
  if (meta.license?.id === 'unknown' && !attested) return { policy: 'needs_attestation', reason: 'No license found in the model files.' };
  return { policy: 'live' };
}

// ---------------------------------------------------------------- state

export const state = {
  users: new Map(),
  byEmail: new Map(),
  sessions: new Map(), // sid -> user id
  apiKeys: new Map(), // secret -> {user_id, key_id}
  nodes: new Map(),
  listings: new Map(),
  pairs: new Map(), // code -> pairing
  ledger: { paid_to_sellers: 18_426_310 },
  recent: [],
  verifications: [],
  feed: [],
  clients: new Set(),
};

function makeUser({ email, name, handle, password = randomBytes(8).toString('hex'), balance = 5_000_000, age = randInt(2, 40) * 86_400_000 }) {
  const u = {
    id: rid('acc'), email, name, handle, pass: sha(password), created_at: now() - age, balance,
    keys: [], requests: [], earnings: { total: 0, today: 0, held: 0 }, jobs: [], vlog: [],
  };
  state.users.set(u.id, u);
  state.byEmail.set(email.toLowerCase(), u);
  return u;
}

// API keys as the gateway shows them: a name (trimmed, 60 chars, empty is null), the secret's ends, and usage.
export const KEY_LIMIT = 20;
export const keyName = (name) => (typeof name === 'string' ? name.trim().slice(0, 60) : '') || null;
export function addKey(u, secret = 'ml_sk_' + randomBytes(16).toString('hex'), name = null) {
  const key = { id: rid('key', 4), name: keyName(name), prefix: `${secret.slice(0, 10)}…${secret.slice(-4)}`, created_at: now(), last_used: null, requests: 0, spend_microusd: 0 };
  u.keys.push(key);
  state.apiKeys.set(secret, { user_id: u.id, key_id: key.id });
  return { key, secret };
}

function makeNode(u, spec) {
  const node = {
    node_id: rid('nod'), user_id: u.id, name: spec.name, os: spec.os, arch: spec.arch, cpu: spec.cpu,
    ram_gb: spec.ram_gb, gpu: spec.gpu, vram_gb: spec.vram_gb, online: spec.online ?? true, inflight: 0, trusted: !!spec.trusted,
    agent_version: '0.2.0', last_seen: now(), speed: spec.speed ?? 50, ttft: spec.ttft ?? 300, flaky: !!spec.flaky, cheat: spec.cheat || null,
    earnings: { total: 0, today: 0 },
    // v0.5: spare-VRAM accounting. Apple Silicon reports no free/others numbers.
    paused: false, reason: null, busyCycle: !!spec.busyCycle,
    vram_budget_gb: spec.vram_gb ? (spec.budget === undefined ? Math.round(spec.vram_gb * 0.75) : spec.budget) : null,
    others: spec.vram_gb ? +(spec.vram_gb * rand(0.12, 0.35)).toFixed(1) : 0,
  };
  state.nodes.set(node.node_id, node);
  return node;
}

function makeListing(u, node, model_id, { runtime = 'ollama', price, fresh = false, cheat = false, attested = false, paused = false } = {}) {
  const meta = META[model_id];
  const { policy, reason } = policyFor(model_id, meta, attested);
  const live = policy === 'live';
  const passed = !live ? 0 : cheat ? 1 : fresh ? 0 : randInt(9, 60);
  const failed = cheat ? 4 : 0;
  const l = {
    listing_id: rid('lst'), user_id: u.id, node_id: node.node_id, model_id, kind: meta.kind, runtime, attested,
    policy, reason: reason || null, paused, suspended: cheat,
    price: price || jitter(marketPrice(meta), fresh ? 1 : rand(0.78, 1.18)), market_price: marketPrice(meta),
    verification: {
      state: cheat ? 'flagged' : passed >= 3 ? 'verified' : 'new',
      passed, failed,
      recent: cheat ? [false, false, true, false, false].reverse() : Array.from({ length: Math.min(10, passed) }, () => true),
      last_check: passed + failed ? now() - randInt(1, 12) * 60_000 : null,
    },
    reputation: cheat ? 12 : fresh ? 50 : randInt(84, 99),
    p50_ms: Math.round(node.ttft + (meta.kind === 'chat' ? 260 : 90) * (90 / node.speed)),
    requests: cheat ? 41 : fresh || !live ? 0 : randInt(120, 4200), earned: 0, held: cheat ? 21_340 : 0,
  };
  l.earned = Math.round(l.requests * (l.kind === 'chat' ? 70 : 20) * 0.9);
  node.earnings.total += l.earned;
  state.listings.set(l.listing_id, l);
  return l;
}

// The people and machines already on the network.
const SEED = [
  { handle: 'hajun', name: 'Hajun Shin', login: DEMO_LOGIN, nodes: [
    { name: "Hajun's MacBook Pro", os: 'darwin', arch: 'arm64', cpu: 'Apple M3 Max', ram_gb: 64, gpu: 'M3 Max 40-core', vram_gb: 48, speed: 62, ttft: 280,
      models: [['qwen3.5:35b-a3b'], ['qwen2.5:3b'], ['nomic-embed-text:v1.5'], ['laya-base', { runtime: 'laya' }], ['hajun/support-triage', { runtime: 'laya' }], ['codestral:22b'], ['nemo-storyteller-12b', { runtime: 'lmstudio' }]] },
    { name: 'Basement Linux box', os: 'linux', arch: 'x64', cpu: 'Ryzen 5 5600', ram_gb: 32, gpu: 'RTX 3060', vram_gb: 12, speed: 55, ttft: 300, busyCycle: true, budget: 8,
      models: [['gemma4:26b', { paused: true }], ['llama3.2:3b'], ['llama3.1-abliterated:8b', { runtime: 'llamacpp' }]] },
  ] },
  { handle: 'vada', name: 'vada-ai', nodes: [
    { name: 'vada-ai reference', os: 'linux', arch: 'x64', cpu: 'Ryzen 9 7950X', ram_gb: 128, gpu: 'RTX 4090', vram_gb: 24, speed: 120, ttft: 160, trusted: true,
      models: [['qwen3.5:35b-a3b'], ['gemma4:26b'], ['qwen2.5:3b'], ['laya-base', { runtime: 'laya' }], ['laya-multilingual', { runtime: 'laya' }]] },
  ] },
  { handle: 'priya', name: 'Priya R.', nodes: [{ name: "Priya's gaming rig", os: 'windows', arch: 'x64', cpu: 'Core i7-13700K', ram_gb: 32, gpu: 'RTX 4080', vram_gb: 16, speed: 88, ttft: 210, models: [['gemma4:26b'], ['qwen2.5:3b'], ['nomic-embed-text:v1.5', { runtime: 'lmstudio' }]] }] },
  { handle: 'dorm4b', name: 'Dorm 4B', nodes: [{ name: 'Dorm 4B tower', os: 'linux', arch: 'x64', cpu: 'Ryzen 7 5800X', ram_gb: 64, gpu: 'RTX 3090', vram_gb: 24, speed: 95, ttft: 230, models: [['qwen3.5:35b-a3b', { runtime: 'vllm' }], ['gemma4:26b']] }] },
  { handle: 'ruth', name: 'Ruth K.', nodes: [{ name: "Ruth's old ThinkPad", os: 'linux', arch: 'x64', cpu: 'Core i5-8350U', ram_gb: 16, gpu: null, vram_gb: 0, speed: 14, ttft: 900, models: [['qwen2.5:3b', { runtime: 'llamacpp' }], ['llama3.2:3b']] }] },
  { handle: 'marcus', name: 'Marcus O.', nodes: [{ name: "Marcus's Mac mini", os: 'darwin', arch: 'arm64', cpu: 'Apple M4 Pro', ram_gb: 48, gpu: 'M4 Pro 20-core', vram_gb: 36, speed: 70, ttft: 250, models: [['laya-base', { runtime: 'laya' }], ['laya-multilingual', { runtime: 'laya' }], ['mxbai-embed-large'], ['nomic-embed-text:v1.5']] }] },
  { handle: 'lumen', name: 'Studio Lumen', nodes: [{ name: 'Lumen render box', os: 'linux', arch: 'x64', cpu: 'Threadripper 7960X', ram_gb: 128, gpu: 'RX 7900 XTX', vram_gb: 24, speed: 84, ttft: 260, models: [['gemma4:26b'], ['qwen3.5:35b-a3b']] }] },
  { handle: 'nightowl', name: 'Night Owl', nodes: [{ name: "Night Owl's NUC", os: 'linux', arch: 'x64', cpu: 'Core Ultra 7 155H', ram_gb: 32, gpu: 'Arc iGPU', vram_gb: 0, speed: 30, ttft: 420, models: [['laya-base', { runtime: 'laya' }], ['mxbai-embed-large', { runtime: 'localai' }]] }] },
  { handle: 'kenji', name: 'Kenji T.', nodes: [{ name: "Kenji's desktop", os: 'linux', arch: 'x64', cpu: 'Core i5-13600K', ram_gb: 32, gpu: 'RTX 4070 Ti', vram_gb: 12, speed: 92, ttft: 200, models: [['qwen2.5:3b', { fresh: true }], ['llama3.2:3b', { fresh: true, runtime: 'jan' }]] }] },
  { handle: 'ana', name: 'Ana M.', nodes: [{ name: "Ana's MacBook Air", os: 'darwin', arch: 'arm64', cpu: 'Apple M2', ram_gb: 24, gpu: 'M2 10-core', vram_gb: 16, speed: 38, ttft: 380, flaky: true, models: [['qwen2.5:3b', { runtime: 'lmstudio' }], ['llama3.2:3b']] }] },
  // The demo cheater: advertises the 35B model, actually serves the 3B one.
  { handle: 'gpubargains', name: 'GPU Bargains', login: CHEAT_LOGIN, nodes: [{ name: 'bargain-box-01', os: 'linux', arch: 'x64', cpu: 'Xeon E5-2680 v4', ram_gb: 64, gpu: 'RTX 4090', vram_gb: 24, speed: 140, ttft: 120, cheat: 'qwen2.5:3b',
    models: [['qwen3.5:35b-a3b', { cheat: true, price: { in_per_m: 30_000, out_per_m: 120_000 } }]] }] },
];

for (const s of SEED) {
  const u = makeUser({ email: s.login?.email || `${s.handle}@example.org`, name: s.name, handle: s.handle, password: s.login?.password });
  for (const spec of s.nodes) {
    const node = makeNode(u, spec);
    for (const [model_id, opts] of spec.models) makeListing(u, node, model_id, opts);
  }
  u.earnings.total = [...state.listings.values()].filter((l) => l.user_id === u.id).reduce((a, l) => a + l.earned, 0);
  u.earnings.today = Math.round(u.earnings.total * 0.12);
  u.earnings.held = [...state.listings.values()].filter((l) => l.user_id === u.id).reduce((a, l) => a + l.held, 0);
}

const demo = state.byEmail.get(DEMO_LOGIN.email);
for (const [name, days, used, requests, spend, secret] of [
  ['Demo key', 12, 0.002, 1284, 3_412_560, DEMO_API_KEY],
  ['CI', 3, 0.09, 86, 104_220],
  [null, 30, null, 0, 0],
]) {
  const { key } = addKey(demo, secret, name);
  Object.assign(key, { created_at: now() - days * 864e5, last_used: used == null ? null : now() - used * 864e5, requests, spend_microusd: spend });
}
demo.balance = 4_981_204;
seedHistory(demo);

function seedHistory(u) {
  const mine = [...state.listings.values()].filter((l) => l.user_id === u.id && l.policy === 'live');
  for (const l of mine) {
    for (let i = 0; i < 3; i++) u.vlog.push(vlogEntry(l, true, now() - randInt(3, 90) * 60_000));
    for (let i = 0; i < 3; i++) u.jobs.push(jobEntry(l, now() - randInt(10, 900) * 1000));
  }
  u.vlog.sort((a, b) => b.ts - a.ts);
  u.jobs.sort((a, b) => b.ts - a.ts);
  const others = [...state.listings.values()].filter((l) => l.user_id !== u.id && l.policy === 'live' && !l.suspended);
  for (let i = 0; i < 9; i++) {
    const l = pick(others);
    const node = state.nodes.get(l.node_id);
    const owner = state.users.get(l.user_id);
    const output_tokens = l.kind === 'chat' ? randInt(40, 500) : 0;
    const input_tokens = randInt(30, 900);
    u.requests.push({
      request_id: rid('req'), ts: now() - (i + 1) * randInt(60, 400) * 1000, model_id: l.model_id, kind: l.kind,
      seller: { id: owner.id, name: owner.name }, node: { id: node.node_id, name: node.name }, verification: l.verification.state,
      input_tokens, output_tokens, latency_ms: randInt(200, 3200), first_ms: randInt(150, 600), cost_microusd: costOf(l, input_tokens, output_tokens),
    });
  }
}

// ---------------------------------------------------------------- views

function isServing(l) {
  const n = state.nodes.get(l.node_id);
  return l.policy === 'live' && !l.paused && !l.suspended && n.online && !n.paused;
}
function isListed(l) {
  return l.policy === 'live';
}

// What the agent would report: your apps, Moonlight's loaded models (largest live one, kept warm), spare, budget.
export function vramOf(n) {
  if (!n.vram_gb) return null;
  const apple = n.os === 'darwin';
  const sizes = [...state.listings.values()].filter((l) => l.node_id === n.node_id && l.policy === 'live' && !l.paused).map((l) => (META[l.model_id]?.size_bytes || 0) / 1e9);
  const cap = n.vram_budget_gb ?? n.vram_gb;
  const ml = n.paused ? 0 : Math.min(cap, Math.max(0, ...sizes) * 1.08);
  const others = Math.min(n.vram_gb - ml, n.others);
  return {
    total_gb: n.vram_gb,
    free_gb: apple ? null : +Math.max(0, n.vram_gb - others - ml).toFixed(1),
    moonlight_gb: +ml.toFixed(1),
    others_gb: apple ? null : +others.toFixed(1),
    budget_gb: n.vram_budget_gb,
  };
}

export const publicNode = (n) => ({
  node_id: n.node_id, name: n.name, os: n.os, arch: n.arch, cpu: n.cpu, ram_gb: n.ram_gb, gpu: n.gpu, vram_gb: n.vram_gb,
  online: n.online, inflight: n.inflight, trusted: n.trusted, agent_version: n.agent_version, last_seen: n.last_seen,
  paused: n.paused, reason: n.reason, vram: vramOf(n), vram_budget_gb: n.vram_budget_gb,
});
const sellerOf = (l) => {
  const u = state.users.get(l.user_id);
  return { id: u.id, handle: u.handle, name: u.name };
};

// Behavior reference: a trusted node, else peers (2+ sellers), else none.
export function verifyMethod(model_id) {
  const ls = [...state.listings.values()].filter((l) => l.model_id === model_id && isListed(l));
  if (META[model_id]?.private) return 'consistent';
  if (ls.some((l) => state.nodes.get(l.node_id).trusted)) return 'trusted';
  if (new Set(ls.map((l) => l.user_id)).size >= 2) return 'peer';
  return 'consistent';
}

function displayState(l) {
  const s = l.verification.state;
  if (s === 'verified' && verifyMethod(l.model_id) === 'consistent') return 'consistent';
  return s;
}

const priceKey = (p) => p.out_per_m ?? p.per_call ?? p.in_per_m;

export function catalog() {
  const ids = [...new Set([...state.listings.values()].filter(isListed).map((l) => l.model_id))];
  return ids.map(modelSummary);
}

export function modelSummary(id) {
  const meta = META[id];
  const live = [...state.listings.values()].filter((l) => l.model_id === id && isServing(l));
  const ok = live.filter((l) => ['verified', 'consistent'].includes(displayState(l)));
  const p50s = live.map((l) => l.p50_ms).sort((a, b) => a - b);
  return {
    id, kind: meta.kind, private: !!meta.private, owner: meta.private ? id.split('/')[0] : null, family: meta.family, summary: meta.summary,
    params_b: meta.params_b, quant: meta.quant, context: meta.context, dims: meta.dims, thinking: !!meta.thinking, license: meta.license,
    digest: meta.digest ?? null, size_bytes: meta.size_bytes,
    verify_method: verifyMethod(id),
    sellers_online: new Set(live.map((l) => l.user_id)).size,
    price_from: live.length ? Math.min(...live.map((l) => priceKey(l.price))) : null,
    p50_ms: p50s.length ? p50s[Math.floor(p50s.length / 2)] : null,
    verified_share: live.length ? ok.length / live.length : 0,
  };
}

export function listingView(l) {
  const v = l.verification;
  return {
    listing_id: l.listing_id, model_id: l.model_id, kind: l.kind, runtime: l.runtime,
    seller: sellerOf(l), node: publicNode(state.nodes.get(l.node_id)),
    price: l.price, p50_ms: l.p50_ms, reputation: l.reputation,
    status: l.suspended ? 'suspended' : l.paused ? 'paused' : 'live', paused: l.paused,
    verification: { state: v.state, badge: displayState(l), passed: v.passed, failed: v.failed, recent: v.recent, last_check: v.last_check },
    held_microusd: l.held,
  };
}

export function myModelRow(l) {
  const meta = META[l.model_id];
  return {
    listing_id: l.listing_id, model_id: l.model_id, kind: l.kind, runtime: l.runtime, family: meta.family,
    params_b: meta.params_b, quant: meta.quant, size_bytes: meta.size_bytes, context: meta.context, dims: meta.dims, license: meta.license,
    policy: l.policy === 'live' && l.paused ? 'paused' : l.policy, reason: l.reason, attested: l.attested,
    price: l.price, market_price: l.market_price, verify_method: verifyMethod(l.model_id),
    verification: { state: l.verification.state, badge: displayState(l), passed: l.verification.passed, failed: l.verification.failed, recent: l.verification.recent, last_check: l.verification.last_check },
    suspended: l.suspended, reputation: l.reputation, requests: l.requests, earned_microusd: l.earned, held_microusd: l.held,
  };
}

export function stats() {
  const t = now();
  state.recent = state.recent.filter((x) => t - x < 60_000);
  state.verifications = state.verifications.filter((x) => t - x < 3_600_000);
  const online = [...state.nodes.values()].filter((n) => n.online);
  return {
    nodes_online: online.length,
    sellers_online: new Set(online.map((n) => n.user_id)).size,
    models_live: new Set([...state.listings.values()].filter(isServing).map((l) => l.model_id)).size,
    requests_per_min: state.recent.length,
    paid_to_sellers_microusd: state.ledger.paid_to_sellers,
    verifications_last_hour: state.verifications.length + 214,
  };
}

export function meView(u) {
  return {
    account: { id: u.id, email: u.email, name: u.name, handle: u.handle, created_at: u.created_at },
    balance_microusd: u.balance,
    keys: u.keys,
    requests: u.requests.slice(0, 50),
    earnings: { ...u.earnings },
    jobs: u.jobs.slice(0, 40),
    verification_log: u.vlog.slice(0, 40),
  };
}

export function myNodes(u) {
  const nodes = [...state.nodes.values()].filter((n) => n.user_id === u.id);
  return {
    nodes: nodes.map((n) => ({
      ...publicNode(n),
      earnings: { ...n.earnings },
      models: [...state.listings.values()].filter((l) => l.node_id === n.node_id).map(myModelRow),
    })),
  };
}

// ---------------------------------------------------------------- accounts + sessions

export function signup({ email, password, name }) {
  if (!/^\S+@\S+\.\S+$/.test(email || '')) return { error: 'Enter a valid email address.', code: 'bad_email' };
  if ((password || '').length < 8) return { error: 'Use at least 8 characters for the password.', code: 'weak_password' };
  if (state.byEmail.has(email.toLowerCase())) return { error: 'An account with that email already exists. Sign in instead.', code: 'email_taken' };
  const base = (name || email.split('@')[0]).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20) || 'seller';
  const u = makeUser({ email, password, name: name || email.split('@')[0], handle: base, age: 0 });
  return { user: u };
}

export function login({ email, password }) {
  const u = state.byEmail.get(String(email || '').toLowerCase());
  if (u?.google_sub && !u.pass) return { google: true };
  if (!u || u.pass !== sha(password || '')) return null;
  return u;
}

// Google sign-in: existing Google account, else link by email, else a new account.
export function googleAccount({ sub, email, name }) {
  const byGoogle = [...state.users.values()].find((u) => u.google_sub === sub);
  if (byGoogle) return { user: byGoogle, created: false };
  const byEmail = state.byEmail.get(email.toLowerCase());
  if (byEmail) {
    if (byEmail.google_sub) return { error: 'This email is linked to a different Google account.' };
    byEmail.google_sub = sub;
    return { user: byEmail, created: false };
  }
  const u = makeUser({ email, name: name || email.split('@')[0], handle: email.split('@')[0].replace(/[^a-z0-9]+/gi, '-').toLowerCase(), age: 0 });
  u.pass = null;
  u.google_sub = sub;
  return { user: u, created: true };
}

export function newSession(u) {
  const sid = randomBytes(18).toString('base64url');
  state.sessions.set(sid, u.id);
  return sid;
}

export function sessionUser(req) {
  const m = /(?:^|;\s*)ml_session=([^;]+)/.exec(req.headers.cookie || '');
  const id = m && state.sessions.get(m[1]);
  return id ? state.users.get(id) : null;
}

export function bearerUser(req) {
  const m = /^Bearer\s+(\S+)/i.exec(req.headers.authorization || '');
  const k = m && state.apiKeys.get(m[1]);
  if (!k) return null;
  const u = state.users.get(k.user_id);
  const key = u.keys.find((x) => x.id === k.key_id);
  if (key) key.last_used = now();
  req.moonlightKey = key;
  return u;
}

// ---------------------------------------------------------------- pairing

const PAIR_ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export function createPair(node, origin) {
  const code = Array.from({ length: 4 }, () => pick(PAIR_ALPHA.split(''))).join('') + '-' + String(randInt(0, 9999)).padStart(4, '0');
  const p = { pair_code: code, node, poll_token: randomBytes(16).toString('hex'), expires_at: now() + 10 * 60_000, status: 'pending' };
  state.pairs.set(code, p);
  return { pair_code: code, verify_url: `${origin}/pair/${code}`, poll_token: p.poll_token, expires_at: p.expires_at };
}

export function pairView(code) {
  const p = state.pairs.get(code);
  if (!p) return null;
  if (p.status === 'pending' && p.expires_at < now()) p.status = 'expired';
  return { pair_code: p.pair_code, status: p.status, expires_at: p.expires_at, node: p.node, node_id: p.node_id ?? null };
}

// What discovery finds on a freshly paired computer.
const DISCOVERY = [
  ['qwen3.5:35b-a3b'], ['qwen2.5:3b'], ['nomic-embed-text:v1.5'], ['laya-base', { runtime: 'laya' }],
  ['nemo-storyteller-12b', { runtime: 'lmstudio' }], ['codestral:22b'], ['llama3.1-abliterated:8b', { runtime: 'llamacpp' }],
];

export function approvePair(code, u) {
  const p = state.pairs.get(code);
  if (!p || p.status !== 'pending') return null;
  const node = makeNode(u, { ...p.node, online: false, speed: 60, ttft: 300 });
  p.status = 'approved';
  p.node_id = node.node_id;
  p.user_id = u.id;
  // The agent picks up its token on the next poll, connects, and reports what it found.
  setTimeout(() => {
    node.online = true;
    node.last_seen = now();
    for (const [model_id, opts] of DISCOVERY) makeListing(u, node, model_id, { ...opts, fresh: true });
    broadcast('node', nodeEvent(node));
  }, 2600);
  return { node_id: node.node_id, name: node.name };
}

export function pollPair(poll_token) {
  const p = [...state.pairs.values()].find((x) => x.poll_token === poll_token);
  if (!p) return null;
  if (p.status === 'approved') return { status: 'approved', node_token: 'ml_nt_' + randomBytes(16).toString('hex') };
  return { status: p.expires_at < now() ? 'expired' : 'pending' };
}

// ---------------------------------------------------------------- listing edits

export function editListing(u, id, { price, paused, attest }) {
  const l = state.listings.get(id);
  if (!l || l.user_id !== u.id) return { error: 'No such listing.', status: 404 };
  if (price) {
    if (!Object.values(price).every((v) => Number.isInteger(v) && v >= 0)) return { error: 'Prices are integer micro-USD.', status: 400 };
    l.price = { ...l.price, ...price };
  }
  if (attest === true && l.policy === 'needs_attestation') {
    l.attested = true;
    l.policy = 'live';
    l.reason = null;
  }
  if (typeof paused === 'boolean' && l.policy === 'live') l.paused = paused;
  return { row: myModelRow(l) };
}

// ---------------------------------------------------------------- routing + metering

export function route(model_id, { verified_only, max_price_out_per_m, seller } = {}) {
  let c = [...state.listings.values()].filter((l) => l.model_id === model_id && isServing(l));
  if (verified_only) c = c.filter((l) => ['verified', 'consistent'].includes(displayState(l)));
  if (max_price_out_per_m) c = c.filter((l) => (l.price.out_per_m ?? 0) <= max_price_out_per_m);
  if (seller) c = c.filter((l) => l.user_id === seller);
  if (!c.length) return null;
  const score = (l) => priceKey(l.price) / (l.kind === 'chat' ? 1e5 : l.kind === 'decision' ? 20 : 1e4) + l.p50_ms / 400 + state.nodes.get(l.node_id).inflight - l.reputation / 30 + Math.random() * 1.5;
  return c.sort((a, b) => score(a) - score(b))[0];
}

export const isKnownModel = (id) => [...state.listings.values()].some((l) => l.model_id === id && isListed(l));
export const metaOf = (id) => META[id];

export function costOf(l, input_tokens, output_tokens) {
  if (l.price.per_call != null) return l.price.per_call;
  return Math.max(1, Math.round((input_tokens * (l.price.in_per_m || 0) + output_tokens * (l.price.out_per_m || 0)) / 1e6));
}

// Books one finished request: buyer debit, seller credit (90%) or hold, events.
export function settle({ l, buyer, key, input_tokens, output_tokens, latency_ms, first_ms }) {
  const cost = costOf(l, input_tokens, output_tokens);
  const seller = state.users.get(l.user_id);
  const node = state.nodes.get(l.node_id);
  const credit = Math.round(cost * 0.9);
  const held = l.verification.state === 'flagged';
  const request_id = rid('req');
  const ts = now();
  if (key) {
    key.requests++;
    key.spend_microusd += cost;
  }
  if (buyer) {
    buyer.balance -= cost;
    buyer.requests.unshift({
      request_id, ts, model_id: l.model_id, kind: l.kind,
      seller: { id: seller.id, name: seller.name }, node: { id: node.node_id, name: node.name },
      verification: displayState(l), input_tokens, output_tokens, latency_ms, first_ms, cost_microusd: cost,
    });
  }
  if (held) {
    seller.earnings.held += credit;
    l.held += credit;
  } else {
    seller.earnings.total += credit;
    seller.earnings.today += credit;
    node.earnings.total += credit;
    node.earnings.today += credit;
    l.earned += credit;
    state.ledger.paid_to_sellers += credit;
  }
  l.requests += 1;
  seller.jobs.unshift(jobEntry(l, ts, { input_tokens, output_tokens, latency_ms, earned: credit }));
  seller.jobs.length = Math.min(seller.jobs.length, 60);
  state.recent.push(ts);
  broadcast('request', {
    ts, request_id, model_id: l.model_id, kind: l.kind, listing_id: l.listing_id,
    seller_id: seller.id, seller_name: seller.name, node_id: node.node_id, node_name: node.name,
    cost_microusd: cost, latency_ms, output_tokens, verification: displayState(l),
  });
  broadcast('earning', { ts, seller_id: seller.id, listing_id: l.listing_id, node_id: node.node_id, amount_microusd: credit, held });
  return { cost, request_id, seller, node };
}

function jobEntry(l, ts, o = {}) {
  const output_tokens = o.output_tokens ?? (l.kind === 'chat' ? randInt(40, 600) : 0);
  const input_tokens = o.input_tokens ?? randInt(30, 900);
  return {
    job_id: rid('job'), ts, listing_id: l.listing_id, model_id: l.model_id, kind: l.kind, node_id: l.node_id,
    input_tokens, output_tokens, latency_ms: o.latency_ms ?? randInt(200, 3000),
    earned_microusd: o.earned ?? Math.round(costOf(l, input_tokens, output_tokens) * 0.9),
  };
}

function vlogEntry(l, passed, ts = now()) {
  const vm = verifyMethod(l.model_id);
  const method = vm === 'consistent' ? 'consistency' : vm === 'peer' ? 'peer' : l.kind === 'decision' ? 'replay' : 'canary';
  const metric = method === 'consistency' ? 'match' : l.kind === 'chat' ? 'agreement' : l.kind === 'embedding' ? 'cosine' : 'max_dp';
  const score = {
    match: passed ? 1 : 0,
    agreement: passed ? pick([0.875, 1, 1, 0.875]) : pick([0.25, 0.375, 0.5, 0.625]),
    cosine: passed ? +rand(0.991, 0.999).toFixed(3) : +rand(0.6, 0.9).toFixed(3),
    max_dp: passed ? +rand(0.003, 0.03).toFixed(3) : +rand(0.09, 0.3).toFixed(3),
  }[metric];
  const threshold = { match: 1, agreement: 0.875, cosine: 0.99, max_dp: 0.05 }[metric];
  return { ts, listing_id: l.listing_id, model_id: l.model_id, method, passed, metric, score, threshold, state_after: displayState(l) };
}

const nodeEvent = (n) => ({ ts: now(), node_id: n.node_id, node_name: n.name, seller_id: n.user_id, seller_name: state.users.get(n.user_id).name, online: n.online, gpu: n.gpu, paused: n.paused, reason: n.reason, vram: vramOf(n) });

// Runs one verification check on a listing and updates its state like the gateway would.
export function verify(l, forcePass) {
  const node = state.nodes.get(l.node_id);
  const passed = forcePass ?? (node.cheat ? Math.random() < 0.1 : Math.random() > 0.02);
  const v = l.verification;
  v.recent = [...v.recent, passed].slice(-10);
  passed ? v.passed++ : v.failed++;
  v.last_check = now();
  if (v.recent.filter((x) => !x).length >= 2) {
    v.state = 'flagged';
    l.suspended = true;
  } else if (v.passed + v.failed >= 3) {
    v.state = 'verified';
  }
  l.reputation = Math.max(5, Math.min(99, l.reputation + (passed ? 1 : -18)));
  const entry = vlogEntry(l, passed);
  state.users.get(l.user_id).vlog.unshift(entry);
  state.verifications.push(now());
  broadcast('verification', { ...entry, seller_id: l.user_id, seller_name: state.users.get(l.user_id).name, node_id: l.node_id, state: displayState(l) });
}

// ---------------------------------------------------------------- SSE

export function broadcast(type, data) {
  state.feed.unshift({ type, data });
  state.feed.length = Math.min(state.feed.length, 40);
  const frame = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of state.clients) res.write(frame);
}

// ---------------------------------------------------------------- background traffic

function fakeRequest() {
  const live = [...state.listings.values()].filter(isServing);
  const weights = { chat: 5, embedding: 2, decision: 2 };
  const total = live.reduce((a, l) => a + weights[l.kind], 0);
  let r = Math.random() * total;
  const seed = live.find((l) => (r -= weights[l.kind]) < 0) || live[0];
  const l = seed && route(seed.model_id);
  if (!l) return;
  const node = state.nodes.get(l.node_id);
  const chat = l.kind === 'chat';
  const output_tokens = chat ? randInt(60, 520) : 0;
  const input_tokens = randInt(40, 1200);
  const first_ms = Math.round(node.ttft * rand(0.8, 1.4));
  const latency_ms = chat ? Math.round(first_ms + (output_tokens / node.speed) * 1000) : Math.round(first_ms + rand(30, 160));
  node.inflight++;
  setTimeout(() => (node.inflight = Math.max(0, node.inflight - 1)), Math.min(latency_ms, 6000));
  settle({ l, input_tokens, output_tokens, latency_ms, first_ms });
}

let started = false;
export function startTraffic() {
  if (started) return;
  started = true;
  for (let i = 0; i < 58; i++) state.recent.push(now() - randInt(0, 59_000));
  const loop = () => {
    fakeRequest();
    setTimeout(loop, rand(350, 1500));
  };
  loop();
  setInterval(() => {
    const l = pick([...state.listings.values()].filter((x) => isServing(x)));
    if (l) verify(l);
  }, 5200);
  // New listings get their first checks quickly, so badges flip from New to Verified while you watch.
  setInterval(() => {
    for (const l of state.listings.values()) if (isServing(l) && l.verification.state === 'new' && Math.random() < 0.35) verify(l, true);
  }, 7000);
  // Your apps' VRAM drifts; the demo seller's Linux box is sometimes busy with its owner's own work.
  setInterval(() => {
    for (const n of state.nodes.values()) {
      if (!n.vram_gb) continue;
      n.others = +Math.min(n.vram_gb * 0.6, Math.max(n.vram_gb * 0.08, n.others + (Math.random() - 0.5) * n.vram_gb * 0.06)).toFixed(1);
    }
  }, 3000);
  let busy = false;
  setInterval(() => {
    busy = !busy;
    for (const n of state.nodes.values()) {
      if (!n.busyCycle) continue;
      n.paused = busy;
      n.reason = busy ? 'owner_busy' : null;
      if (busy) n.others = +(n.vram_gb * 0.8).toFixed(1);
      broadcast('node', nodeEvent(n));
    }
  }, 35_000);
  // Ana's laptop lid opens and closes.
  setInterval(() => {
    for (const n of state.nodes.values()) {
      if (!n.flaky) continue;
      n.online = !n.online;
      n.last_seen = now();
      broadcast('node', nodeEvent(n));
    }
  }, 45_000);
  setInterval(() => {
    for (const n of state.nodes.values()) if (n.online) n.last_seen = now();
  }, 15_000);
}

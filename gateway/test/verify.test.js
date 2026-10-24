import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { test } from 'node:test';
import { FIXED_DIGESTS } from '../src/config.js';
import { ADMIN, TRUSTED_TOKEN, chatModel, model, pieces, startGateway, wordsFor } from './harness.js';

const honest = model((prompt) => wordsFor('qwen2.5:7b', prompt));
const cheater = model((prompt) => wordsFor('qwen2.5:0.5b', prompt));
const ask = (m) => ({ model: m, messages: [{ role: 'user', content: 'Explain photosynthesis briefly.' }] });

async function checkTimes(g, listingId, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(await g.ctx.verifier.check(listingId));
  return out;
}

test('digest sets: registry manifest, Hugging Face LFS sha256, trusted-node digests, Laya weights', async (t) => {
  const manifest = '{"schemaVersion":2,"layers":["llama3.2:3b"]}';
  const reg = http.createServer((req, res) => {
    if (req.url === '/v2/library/llama3.2/manifests/3b') return res.end(manifest);
    if (req.url.startsWith('/api/models/bartowski/Some-GGUF/tree/main')) {
      return res.end(JSON.stringify([{ path: 'Some-Q4_K_M.gguf', lfs: { oid: 'aa'.repeat(32) } }, { path: 'Some-Q8_0.gguf', lfs: { oid: 'bb'.repeat(32) } }, { path: 'README.md' }]));
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise((r) => reg.listen(0, '127.0.0.1', r));
  t.after(() => reg.close());
  const url = `http://127.0.0.1:${reg.address().port}`;
  const g = await startGateway({ registryUrl: url, hfUrl: url });
  t.after(g.close);

  await g.agent({ token: TRUSTED_TOKEN, name: 'ref', models: [chatModel('qwen2.5:7b', { digest: 'cc'.repeat(32) })] });
  const a = await g.agent({
    name: 'mixed',
    models: [
      chatModel('llama3.2:3b', { digest: crypto.createHash('sha256').update(manifest).digest('hex'), license: { id: 'Llama 3.2 Community License' } }),
      chatModel('qwen2.5:7b', { digest: 'sha256:' + 'cc'.repeat(32) }),
      chatModel('hf.co/bartowski/Some-GGUF:Q4_K_M', { digest: 'aa'.repeat(32) }),
      { model_id: 'laya-base', kind: 'decision', runtime: 'laya', digest: FIXED_DIGESTS['laya-base'][0], license: { id: 'apache-2.0' } },
      chatModel('mistral-local', { runtime: 'lmstudio', digest: null }),
    ],
  });
  for (const l of a.welcome.listings) assert.equal(l.status, 'live', l.model_id);

  const b = await g.agent({
    name: 'liar',
    models: [
      chatModel('llama3.2:3b', { digest: 'ee'.repeat(32), license: { id: 'Llama 3.2 Community License' } }),
      chatModel('qwen2.5:7b', { digest: 'dd'.repeat(32) }),
      chatModel('hf.co/bartowski/Some-GGUF:Q4_K_M', { digest: 'bb'.repeat(32) }),
      { model_id: 'laya-base', kind: 'decision', runtime: 'laya', digest: 'ff'.repeat(32), license: { id: 'apache-2.0' } },
    ],
  });
  for (const l of b.welcome.listings) assert.deepEqual([l.status, l.reason], ['rejected', 'digest_mismatch'], l.model_id);
});

test('listing policy: banned variants, licenses, attestation, private namespaces', async (t) => {
  const g = await startGateway();
  t.after(g.close);
  const seller = await g.seller('policy-seller');
  const a = await g.agent({
    seller, name: 'n',
    models: [
      chatModel('huihui_ai/qwen3.5-abliterated:35b-a3b'),
      chatModel('codestral:22b', { license: { id: 'Mistral AI Non-Production License' } }),
      chatModel('qwen2.5:3b', { license: { id: 'Qwen RESEARCH LICENSE AGREEMENT' } }),
      chatModel('cc-model', { license: { id: 'CC-BY-NC-4.0' } }),
      chatModel('gemma3:4b', { license: { id: 'Gemma Terms of Use' } }),
      chatModel('mystery:7b', { license: { id: 'Some Custom License v1' } }),
      chatModel('nolicense:1b', { license: undefined }),
      chatModel(`${seller.handle}/support-triage`, { private: true, license: undefined }),
      chatModel('someone-else/model', { private: true }),
    ],
  });
  const st = Object.fromEntries(a.welcome.listings.map((l) => [l.model_id, l.reason || l.status]));
  assert.deepEqual(st, {
    'huihui_ai/qwen3.5-abliterated:35b-a3b': 'uncensored variant',
    'codestral:22b': 'blocked:license',
    'qwen2.5:3b': 'blocked:license',
    'cc-model': 'blocked:license',
    'gemma3:4b': 'live',
    'mystery:7b': 'needs_attestation',
    'nolicense:1b': 'needs_attestation',
    [`${seller.handle}/support-triage`]: 'needs_attestation',
    'someone-else/model': 'namespace',
  });

  const buyer = await g.buyer();
  assert.equal((await g.chat(buyer.secret, ask('mystery:7b'))).status, 404);

  // Ticking "I have the right to sell access" makes it live at once.
  const id = a.listing('mystery:7b').listing_id;
  const row = await g.req('PATCH', `/api/me/listings/${id}`, { key: seller.secret, body: { attest: true } });
  assert.equal(row.status, 200);
  assert.equal(row.body.policy, 'live');
  assert.equal((await g.chat(buyer.secret, ask('mystery:7b'))).status, 200);

  const nodes = await g.get('/api/me/nodes', { key: seller.secret });
  const policies = Object.fromEntries(nodes.body.nodes[0].models.map((m) => [m.model_id, m.policy]));
  assert.equal(policies['huihui_ai/qwen3.5-abliterated:35b-a3b'], 'blocked:policy');
  assert.equal(policies['qwen2.5:3b'], 'blocked:license');
  assert.equal(policies['mystery:7b'], 'live');
});

test('chat canaries against a trusted node: honest seller becomes verified', async (t) => {
  const g = await startGateway();
  t.after(g.close);
  await g.agent({ token: TRUSTED_TOKEN, name: 'ref', maxConcurrency: 4, models: [chatModel('qwen2.5:7b')], behavior: honest });
  const good = await g.agent({ name: 'good', models: [chatModel('qwen2.5:7b')], behavior: honest });
  const id = good.listing('qwen2.5:7b').listing_id;

  const checks = await checkTimes(g, id, 3);
  for (const c of checks) {
    assert.equal(c.method, 'canary');
    assert.equal(c.metric, 'agreement');
    assert.equal(c.score, 1);
    assert.ok(c.passed);
  }
  assert.equal(g.listing(id).state, 'verified');
  // Probes are prefilled, short, greedy and reasoning-free.
  const probe = good.jobs.at(-1).body;
  assert.equal(probe.messages.at(-1).role, 'assistant');
  assert.equal(probe.max_tokens, 8);
  assert.equal(probe.temperature, 0);
  assert.equal(probe.seed, 42);
  assert.equal(probe.reasoning_effort, 'none');
  assert.equal(good.jobs.length, 3 * 8);
});

test('a --cheat-serve seller is flagged within a few checks, suspended, and its earnings held', async (t) => {
  const g = await startGateway();
  t.after(g.close);
  await g.agent({ token: TRUSTED_TOKEN, name: 'ref', maxConcurrency: 4, models: [chatModel('qwen2.5:7b')], behavior: honest });
  const cheat = await g.agent({ name: 'cheat', models: [chatModel('qwen2.5:7b', { price: { out_per_m: 1 } })], behavior: cheater });
  const id = cheat.listing('qwen2.5:7b').listing_id;
  const buyer = await g.buyer();
  await g.chat(buyer.secret, ask('qwen2.5:7b'));

  // Through the operator endpoint, as in the demo.
  const first = await g.post(`/api/admin/verify/${id}`, {}, { key: ADMIN });
  assert.equal(first.body.check.passed, false);
  assert.ok(first.body.check.score < 0.85);
  const second = await g.ctx.verifier.check(id);
  assert.equal(second.passed, false);
  assert.equal(second.state, 'flagged');
  assert.equal(g.listing(id).state, 'flagged');

  // Buyers now go to the reference node instead of the cheaper cheater.
  const r = await g.chat(buyer.secret, ask('qwen2.5:7b'));
  assert.notEqual(r.headers['x-moonlight-node'], cheat.nodeId);
  const earnings = g.ctx.store.earnings(cheat.sellerId);
  assert.equal(earnings.total, 0);
  assert.ok(earnings.held > 0);
  assert.equal(cheat.stats.verification.state, 'flagged');
});

// A small model of the same family: it guesses the big model's next word, then drifts. A one-word check
// passes it; the three-word check must not.
const sameFamily = (job, io) => {
  const prompt = job.body.messages.find((m) => m.role === 'user').content;
  const prefix = job.body.messages.at(-1).role === 'assistant' ? job.body.messages.at(-1).content : '';
  const k = pieces(prefix).length;
  const right = pieces(wordsFor('qwen2.5:7b', prompt));
  const own = pieces(wordsFor('qwen2.5:0.5b', prompt));
  for (const p of [right[k], ...own.slice(k + 1)].filter(Boolean).slice(0, job.body.max_tokens || 64)) io.chunk(p);
  io.done({ input_tokens: 20, output_tokens: 8 });
};

test('a same-family cheater that gets the next word right still fails the three-word check', async (t) => {
  const g = await startGateway();
  t.after(g.close);
  await g.agent({ token: TRUSTED_TOKEN, name: 'ref', maxConcurrency: 4, models: [chatModel('qwen2.5:7b')], behavior: honest });
  const good = await g.agent({ name: 'good', models: [chatModel('qwen2.5:7b')], behavior: honest });
  const cheat = await g.agent({ name: 'cheat', models: [chatModel('qwen2.5:7b')], behavior: sameFamily });

  const goodChecks = await checkTimes(g, good.listing('qwen2.5:7b').listing_id, 3);
  assert.ok(goodChecks.every((c) => c.passed && c.score === 1));
  assert.equal(g.listing(good.listing('qwen2.5:7b').listing_id).state, 'verified');

  const id = cheat.listing('qwen2.5:7b').listing_id;
  const cheatChecks = await checkTimes(g, id, 2);
  assert.ok(cheatChecks.every((c) => !c.passed && c.score < 0.75));
  assert.equal(g.listing(id).state, 'flagged');
});

test('models that restart instead of continuing a prefill still verify honestly', async (t) => {
  const g = await startGateway();
  t.after(g.close);
  const restart = (seed) => model((p) => wordsFor(seed, p), { restart: true });
  await g.agent({ token: TRUSTED_TOKEN, name: 'ref', maxConcurrency: 4, models: [chatModel('gemma4:26b')], behavior: restart('gemma4') });
  const good = await g.agent({ name: 'good', models: [chatModel('gemma4:26b')], behavior: restart('gemma4') });
  const c = await g.ctx.verifier.check(good.listing('gemma4:26b').listing_id);
  assert.equal(c.passed, true);
});

test('without a trusted node, peers cross-check and the one that disagrees with the majority fails', async (t) => {
  const g = await startGateway();
  t.after(g.close);
  const peers = [];
  for (const name of ['p1', 'p2', 'p3']) peers.push(await g.agent({ name, maxConcurrency: 4, models: [chatModel('qwen2.5:7b')], behavior: honest }));
  const cheat = await g.agent({ name: 'cheat', maxConcurrency: 4, models: [chatModel('qwen2.5:7b')], behavior: cheater });

  const bad = await g.ctx.verifier.check(cheat.listing('qwen2.5:7b').listing_id);
  assert.equal(bad.method, 'peer');
  assert.equal(bad.passed, false);
  const good = await g.ctx.verifier.check(peers[0].listing('qwen2.5:7b').listing_id);
  assert.equal(good.method, 'peer');
  assert.equal(good.passed, true);
});

test('private models get self-consistency checks and the "consistent" badge', async (t) => {
  const g = await startGateway();
  t.after(g.close);
  const seller = await g.seller('hajun');
  const a = await g.agent({ seller, name: 'n', models: [chatModel('hajun/support-triage', { private: true, license: { id: 'apache-2.0' } })], behavior: honest });
  const id = a.listing('hajun/support-triage').listing_id;
  const checks = await checkTimes(g, id, 3);
  assert.ok(checks.every((c) => c.method === 'consistency' && c.metric === 'match' && c.passed));
  const detail = await g.get(`/api/models/${encodeURIComponent('hajun/support-triage')}`);
  assert.equal(detail.body.listings[0].verification.state, 'verified');
  assert.equal(detail.body.listings[0].verification.badge, 'consistent');
  assert.equal(detail.body.model.verify_method, 'consistent');
});

// systemone answers derived from the input; a cheater's probabilities are 0.4 off.
const hash = (s) => [...s].reduce((h, c) => (Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0), 2166136261);
const decide = (cheat = false) => (job, io) => {
  const answers = {};
  for (const [name, q] of Object.entries(job.body.questions)) {
    let p = (hash(JSON.stringify(job.body.state) + name) % 100) / 100;
    if (cheat) p = p > 0.5 ? p - 0.4 : p + 0.4;
    if (q.type === 'noul') answers[name] = { type: 'noul', noul: p };
    else {
      const keys = Object.keys(q.criteria);
      answers[name] = { type: 'choice', choice: keys[0], confidence: p, probabilities: Object.fromEntries(keys.map((k, i) => [k, i ? (1 - p) / (keys.length - 1) : p])) };
    }
  }
  io.result({ model: job.model_id, answers, usage: { input_tokens: 40, output_tokens: 0 } });
};
const laya = { model_id: 'laya-base', kind: 'decision', runtime: 'laya', digest: FIXED_DIGESTS['laya-base'][0], license: { id: 'apache-2.0' }, price: { per_call: 20 } };
const question = {
  model: 'laya-base',
  state: { ticket: 'My order arrived broken, I want a refund' },
  questions: {
    is_complaint: { type: 'noul', instructions: 'Is `ticket` a complaint?' },
    category: { type: 'choice', instructions: 'Which team?', criteria: { billing: 'refunds', shipping: 'delivery', tech: 'bugs' } },
  },
};

test('decision jobs: Jev-shaped response, and real jobs replayed on the reference pass or fail by max |Δp|', async (t) => {
  const g = await startGateway();
  t.after(g.close);
  await g.agent({ token: TRUSTED_TOKEN, name: 'ref', maxConcurrency: 4, models: [laya], behavior: decide() });
  const good = await g.agent({ name: 'good', models: [{ ...laya, price: { per_call: 1 } }], behavior: decide() });
  const buyer = await g.buyer();
  const gid = good.listing('laya-base').listing_id;
  await g.post(`/api/admin/listings/${gid}`, { verify_rate: 1 }, { key: ADMIN });

  const r = await g.post('/v1/systemone', question, { key: buyer.secret });
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body), ['model', 'answers', 'usage', 'moonlight']);
  assert.equal(r.body.answers.is_complaint.type, 'noul');
  assert.deepEqual(Object.keys(r.body.answers.category), ['type', 'choice', 'confidence', 'probabilities']);
  assert.deepEqual(r.body.usage, { input_tokens: r.body.usage.input_tokens, output_tokens: 0 });
  assert.equal(r.headers['x-moonlight-node'], good.nodeId);
  await g.ctx.verifier.idle();
  const pass = g.ctx.db.get('SELECT * FROM checks WHERE listing_id = ?', gid);
  assert.deepEqual([pass.method, pass.metric, pass.passed], ['replay', 'max_dp', 1]);

  good.behavior = decide(true);
  await g.post('/v1/systemone', question, { key: buyer.secret });
  await g.ctx.verifier.idle();
  const fail = g.ctx.db.get('SELECT * FROM checks WHERE listing_id = ? ORDER BY id DESC', gid);
  assert.equal(fail.passed, 0);
  assert.ok(fail.score >= 0.39);

  const bad = await g.post('/v1/systemone', { ...question, questions: { s: { type: 'score', instructions: 'x', criteria: { a: 'b' } } } }, { key: buyer.secret });
  assert.equal(bad.status, 400);
});

const embed = (seed) => (job, io) => {
  const inputs = typeof job.body.input === 'string' ? [job.body.input] : job.body.input;
  const data = inputs.map((s, index) => ({ object: 'embedding', index, embedding: Array.from({ length: 16 }, (_, i) => Math.sin(hash(s) + i * seed)) }));
  io.result({ object: 'list', data, usage: { prompt_tokens: 8 } }, { input_tokens: 8, output_tokens: 0 });
};
const bge = { model_id: 'bge-m3', kind: 'embedding', runtime: 'ollama', digest: 'bge', license: { id: 'MIT' }, dims: 16 };

test('embeddings: OpenAI shape, and cosine against the reference catches a different model', async (t) => {
  const g = await startGateway();
  t.after(g.close);
  await g.agent({ token: TRUSTED_TOKEN, name: 'ref', maxConcurrency: 4, models: [bge], behavior: embed(1) });
  const good = await g.agent({ name: 'good', models: [{ ...bge, price: { in_per_m: 1 } }], behavior: embed(1) });
  const bad = await g.agent({ name: 'bad', models: [{ ...bge, price: { in_per_m: 2 } }], behavior: embed(2) });
  const buyer = await g.buyer();

  const r = await g.post('/v1/embeddings', { model: 'bge-m3', input: ['hello', 'world'] }, { key: buyer.secret });
  assert.equal(r.status, 200);
  assert.equal(r.body.object, 'list');
  assert.equal(r.body.data.length, 2);
  assert.equal(r.body.data[1].index, 1);
  assert.equal(r.body.data[0].embedding.length, 16);
  assert.ok(r.body.usage.prompt_tokens > 0);

  const ok = await g.ctx.verifier.check(good.listing('bge-m3').listing_id);
  assert.deepEqual([ok.metric, ok.passed], ['cosine', true]);
  const no = await g.ctx.verifier.check(bad.listing('bge-m3').listing_id);
  assert.deepEqual([no.metric, no.passed], ['cosine', false]);
});

test('canary jobs carry nothing that tells them apart from buyer jobs', async (t) => {
  const g = await startGateway();
  t.after(g.close);
  await g.agent({ token: TRUSTED_TOKEN, name: 'ref', maxConcurrency: 4, models: [chatModel('qwen2.5:7b')], behavior: honest });
  const node = await g.agent({ name: 'n', models: [chatModel('qwen2.5:7b', { price: { out_per_m: 1 } })], behavior: honest });
  const buyer = await g.buyer();
  await g.chat(buyer.secret, { model: 'qwen2.5:7b', messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'the' }], temperature: 0, seed: 42, max_tokens: 4, reasoning_effort: 'none' });
  await g.ctx.verifier.check(node.listing('qwen2.5:7b').listing_id);

  const [buyerJob, canaryJob] = [node.jobs[0], node.jobs[1]];
  assert.deepEqual(Object.keys(canaryJob).sort(), Object.keys(buyerJob).sort());
  assert.deepEqual(Object.keys(canaryJob.body), Object.keys(buyerJob.body));
  assert.equal(canaryJob.deadline_ms, buyerJob.deadline_ms);
  assert.match(canaryJob.job_id, /^job_[0-9a-f]{12}$/);
});

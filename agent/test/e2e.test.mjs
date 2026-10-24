// End-to-end tests: the real agent against the stub gateway, serving from the local Ollama
// (and laya-runner, when one is running). Run with: node --test test/
//
// Env: OLLAMA_URL (default http://127.0.0.1:11434), LAYA_URL (default http://127.0.0.1:8765),
//      TEST_CHAT_MODEL (qwen2.5:0.5b), TEST_EMBED_MODEL (nomic-embed-text), TEST_BIG_MODEL (qwen2.5:7b, for the cheat test)

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { startStub } from './stub-gateway.mjs';

const AGENT = fileURLToPath(new URL('../agent.mjs', import.meta.url));
const OLLAMA = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
const LAYA = process.env.LAYA_URL ?? 'http://127.0.0.1:8765';
const CHAT = process.env.TEST_CHAT_MODEL ?? 'qwen2.5:0.5b';
const EMBED = process.env.TEST_EMBED_MODEL ?? 'nomic-embed-text';
const BIG = process.env.TEST_BIG_MODEL ?? 'qwen2.5:7b';

const tags = await fetch(`${OLLAMA}/api/tags`).then((r) => r.json()).catch(() => ({ models: [] }));
const installed = new Map(tags.models.map((m) => [m.name.replace(/:latest$/, ''), m.digest]));
const haveLaya = await fetch(`${LAYA}/health`).then((r) => r.ok, () => false);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeout = 10_000, what = 'condition') {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(50);
  }
}
const once = (emitter, name, pred = () => true, timeout = 15_000) => new Promise((resolve, reject) => {
  const t = setTimeout(() => { emitter.off(name, on); reject(new Error(`timed out waiting for ${name}`)); }, timeout);
  const on = (e) => { if (pred(e)) { clearTimeout(t); emitter.off(name, on); resolve(e); } };
  emitter.on(name, on);
});

// AGENT_BIN=release/moonlight-linux-x64 runs the same tests against a compiled binary.
const BIN = process.env.AGENT_BIN ? [path.resolve(process.env.AGENT_BIN)] : [process.execPath, AGENT];

function startAgent(stub, home, args = [], env = {}) {
  const proc = spawn(BIN[0], [...BIN.slice(1), '--plain', '--no-browser', '--gateway', stub.url, '--laya', LAYA, ...args], {
    env: { ...process.env, MOONLIGHT_HOME: home, OLLAMA_NUM_PARALLEL: '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  proc.stdout.on('data', (d) => { out += d; });
  proc.stderr.on('data', (d) => { out += d; });
  const exited = new Promise((resolve) => proc.on('exit', (code) => resolve(code)));
  return { proc, out: () => out, exited };
}

const chatBody = (content, max_tokens = 24) => ({ model: CHAT, messages: [{ role: 'user', content }], max_tokens, temperature: 0, seed: 42, stream: true });

let stub, home, agent, node;

before(async () => {
  assert.ok(installed.has(CHAT), `Ollama at ${OLLAMA} needs ${CHAT} (ollama pull ${CHAT})`);
  stub = await startStub({ autoApprove: 2 });
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'moonlight-test-'));
});

after(async () => {
  agent?.proc.kill('SIGKILL');
  await stub?.close();
  fs.rmSync(home, { recursive: true, force: true });
});

test('pairs on first run, stores the node token with mode 0600, and says hello', async () => {
  const models = [CHAT, installed.has(EMBED) && EMBED, haveLaya && 'laya-base'].filter(Boolean).join(',');
  const hello = once(stub.events, 'hello');
  agent = startAgent(stub, home, ['--models', models]);
  ({ node } = await hello);
  const cfg = JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8'));
  const token = cfg.tokens[stub.http];
  assert.match(token, /^ml_nt_[0-9a-f]{32}$/);
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(home, 'config.json')).mode & 0o777, 0o600);
  assert.equal(node.hello.token, token);
  assert.equal(node.hello.node.max_concurrency, 1);
  const m = node.hello.models.find((x) => x.model_id === CHAT);
  assert.equal(m.kind, 'chat');
  assert.equal(m.runtime, 'ollama');
  assert.equal(m.digest, installed.get(CHAT));
  assert.equal(m.source.registry, 'ollama');
  assert.ok(m.license.id);
  assert.ok(!agent.out().includes(token), 'the token is never printed');
});

test('serves a streamed chat job with OpenAI chunks, usage and timing', async () => {
  const r = await stub.dispatch(node, 'chat', CHAT, chatBody('Say hello in three words.'));
  assert.ok(!r.error, JSON.stringify(r.error));
  assert.ok(r.chunks.length > 1);
  assert.equal(r.chunks[0].object, 'chat.completion.chunk');
  assert.ok(r.chunks.every((c) => c.model === CHAT));
  assert.ok(r.done.usage.output_tokens > 0 && r.done.usage.input_tokens > 0);
  assert.ok(r.done.timing.total_ms >= r.done.timing.first_ms);
});

test('serves embedding jobs', { skip: !installed.has(EMBED) && `${EMBED} not installed` }, async () => {
  const r = await stub.dispatch(node, 'embedding', EMBED, { model: EMBED, input: ['moonlight', 'sunlight'] });
  assert.ok(!r.error, JSON.stringify(r.error));
  assert.equal(r.done.result.data.length, 2);
  assert.ok(r.done.result.data[0].embedding.length >= 128);
  assert.equal(r.done.result.model, EMBED);
});

test('serves decision jobs in the Jev shape', { skip: !haveLaya && `no laya-runner at ${LAYA}` }, async () => {
  const body = { model: 'laya-base', state: { ticket: 'I was charged twice, please refund me' }, questions: {
    billing: { type: 'noul', instructions: 'Is `ticket` about billing?' },
    team: { type: 'choice', instructions: 'Which team should take `ticket`?', criteria: { billing: 'payments', tech: 'bugs' } },
    urgency: { type: 'score', instructions: 'How urgent is `ticket`?', criteria: ['low', 'medium', 'high'] },
  } };
  const r = await stub.dispatch(node, 'decision', 'laya-base', body);
  assert.ok(!r.error, JSON.stringify(r.error));
  const { answers, usage, model } = r.done.result;
  assert.equal(model, 'laya-base');
  assert.deepEqual(Object.keys(answers.billing), ['type', 'noul']);
  assert.deepEqual(Object.keys(answers.team), ['type', 'choice', 'confidence', 'probabilities']);
  assert.deepEqual(Object.keys(answers.urgency), ['type', 'score', 'confidence', 'legend', 'probabilities']);
  assert.equal(answers.team.choice, 'billing');
  assert.ok(usage.input_tokens > 0 && r.done.usage.input_tokens === usage.input_tokens);
});

test('reports an error for a model it does not serve', async () => {
  const r = await stub.dispatch(node, 'chat', 'nope:1b', { ...chatBody('hi'), model: 'nope:1b' });
  assert.equal(r.error.code, 'model_not_found');
});

test('stops a job when the gateway cancels it', async () => {
  let job_id;
  const started = once(stub.events, 'job', (e) => e.model_id === CHAT).then((e) => { job_id = e.job_id; });
  const pending = stub.dispatch(node, 'chat', CHAT, chatBody('Write a long story about a dragon.', 600), {
    onChunk: () => { if (job_id) node.ws.send({ t: 'cancel', job_id }); },
  });
  await started;
  const r = await pending;
  assert.equal(r.error?.code, 'cancelled');
  assert.ok(r.chunks.length < 100, `stopped early (${r.chunks.length} chunks)`);
});

test('reconnects and says hello again after the connection drops', async () => {
  const token = node.hello.token;
  const hello = once(stub.events, 'hello', (e) => e.msg.token === token, 8000);
  node.ws.kill();
  ({ node } = await hello);
  assert.equal(node.hello.token, token);
  const r = await stub.dispatch(node, 'chat', CHAT, chatBody('One word: hi'));
  assert.ok(!r.error, JSON.stringify(r.error));
});

test('drains on SIGTERM: sends drain, finishes the in-flight job, exits 0', async () => {
  const drain = once(stub.events, 'frame', (e) => e.msg.t === 'drain');
  let signalled = false;
  const pending = stub.dispatch(node, 'chat', CHAT, chatBody('List ten fruits, one per line.', 120), {
    onChunk: () => { if (!signalled) { signalled = true; agent.proc.kill('SIGTERM'); } },
  });
  await drain;
  const r = await pending;
  assert.ok(!r.error, `job finished during drain: ${JSON.stringify(r.error)}`);
  assert.ok(r.done.usage.output_tokens > 5);
  assert.equal(await agent.exited, 0);
  assert.match(agent.out(), /Finishing 1 job before stopping/);
});

test('`moonlight stop` asks the running agent to drain and exit', async () => {
  const hello = once(stub.events, 'hello');
  agent = startAgent(stub, home, ['--models', CHAT]);
  await hello; // reuses the saved token: no pairing this time
  assert.doesNotMatch(agent.out(), /Add this computer/);
  await waitFor(() => /Connected/.test(agent.out()), 5000, 'connected');
  const drain = once(stub.events, 'frame', (e) => e.msg.t === 'drain');
  const stop = spawn(BIN[0], [...BIN.slice(1), 'stop'], { env: { ...process.env, MOONLIGHT_HOME: home } });
  await new Promise((r) => stop.on('exit', r));
  await drain;
  assert.equal(await agent.exited, 0);
});

test('exits with a clear message when the token is rejected', async () => {
  const bad = startAgent(stub, home, ['--models', CHAT, '--token', 'ml_nt_not-a-real-token']);
  assert.equal(await bad.exited, 1);
  assert.match(bad.out(), /rejected this computer's token/);
});

test('`moonlight logout` forgets the saved token', async () => {
  const out = await new Promise((resolve) => {
    let s = '';
    const p = spawn(BIN[0], [...BIN.slice(1), 'logout', '--gateway', stub.url], { env: { ...process.env, MOONLIGHT_HOME: home } });
    p.stdout.on('data', (d) => { s += d; });
    p.on('exit', () => resolve(s));
  });
  assert.match(out, /Forgot this computer's token/);
  const cfg = JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8'));
  assert.equal(cfg.tokens[stub.http], undefined);
});

test('--cheat-serve advertises the real digest but fails teacher-forced canaries; the honest node passes',
  { skip: !installed.has(BIG) && `${BIG} not installed`, timeout: 240_000 }, async () => {
    const ref = await startStub({ reference: OLLAMA, canaryEvery: 1e9 });
    const runPair = async (args, label) => {
      const h = fs.mkdtempSync(path.join(os.tmpdir(), `moonlight-${label}-`));
      const hello = once(ref.events, 'hello');
      const a = startAgent(ref, h, ['--token', `ml_st_${label === 'cheat' ? 'c' : 'a'}${'0'.repeat(31)}`, ...args]);
      const { node: n } = await hello;
      return { a, n, h };
    };
    const honest = await runPair(['--models', BIG], 'honest');
    const cheat = await runPair(['--models', BIG, '--cheat-serve', CHAT], 'cheat');
    try {
      const adv = cheat.n.hello.models.find((m) => m.model_id === BIG);
      assert.equal(adv.digest, installed.get(BIG), 'the cheater reports the real digest, so the digest check passes');
      const results = { honest: [], cheat: [] };
      for (let i = 0; i < 3; i++) {
        results.honest.push(await ref.runCanary(honest.n, BIG));
        results.cheat.push(await ref.runCanary(cheat.n, BIG));
      }
      const summary = JSON.stringify(results);
      assert.ok(results.honest.every((r) => r.passed), `honest node passes: ${summary}`);
      assert.equal(results.honest.at(-1).state, 'verified');
      assert.ok(results.cheat.filter((r) => !r.passed).length >= 2, `cheater fails: ${summary}`);
      assert.equal(results.cheat.at(-1).state, 'flagged');
      console.log(`canary agreement  honest: ${results.honest.map((r) => `${r.agree}/${r.of}`).join(' ')}  cheat: ${results.cheat.map((r) => `${r.agree}/${r.of}`).join(' ')}`);
    } finally {
      for (const x of [honest, cheat]) { x.a.proc.kill('SIGKILL'); fs.rmSync(x.h, { recursive: true, force: true }); }
      await ref.close();
    }
  });

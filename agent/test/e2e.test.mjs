// End-to-end tests: the real agent against the stub gateway, serving from the local Ollama
// (and laya-runner, when one is running). Run with: node --test test/
//
// Env: OLLAMA_URL (default http://127.0.0.1:11434), LAYA_URL (default http://127.0.0.1:8765),
//      TEST_CHAT_MODEL (qwen2.5:0.5b), TEST_EMBED_MODEL (nomic-embed-text), TEST_BIG_MODEL (qwen2.5:1.5b, for the cheat test)

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
const BIG = process.env.TEST_BIG_MODEL ?? 'qwen2.5:1.5b';

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
  // --no-yield unless a test is about yielding: other users' GPU work on a shared box must not pause test agents.
  const yieldArgs = args.includes('--yield-test') ? [] : ['--no-yield'];
  args = args.filter((x) => x !== '--yield-test');
  const proc = spawn(BIN[0], [...BIN.slice(1), '--plain', '--no-browser', '--gateway', stub.url, '--laya', LAYA, ...yieldArgs, ...args], {
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
  // Hand the shared GPU back: unload the small chat model the tests used.
  await fetch(`${OLLAMA}/api/generate`, { method: 'POST', body: JSON.stringify({ model: CHAT, keep_alive: 0 }) }).catch(() => {});
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

test('is back within ~2 s of a gateway restart, even after the gateway was down for a while', { timeout: 60_000 }, async () => {
  const first = await startStub();
  const { port } = first;
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'moonlight-restart-'));
  const hello = once(first.events, 'hello');
  const a = startAgent(first, h, ['--token', `ml_st_${'f'.repeat(32)}`, '--models', CHAT]);
  try {
    await hello;
    await waitFor(() => /Connected/.test(a.out()), 5000, 'connected');
    // A deploy: the gateway closes sockets with 1012 (service restart), stays down for 8 s, comes back.
    // The old 1-2-4-8 s backoff would have retried at about 1, 3, 7 and 15 s, so it got back 7 s late.
    for (const n of first.nodes.values()) n.ws.close(1012);
    await first.close();
    await sleep(8000);
    const second = await startStub({ port });
    try {
      const t0 = Date.now();
      await once(second.events, 'hello', () => true, 10_000).catch((e) => { throw new Error(`${e.message}\n${a.out()}`); });
      const ms = Date.now() - t0;
      assert.ok(ms < 2000, `reconnected ${ms} ms after the gateway came back`);
    } finally {
      await second.close();
    }
  } finally {
    a.proc.kill('SIGKILL');
    fs.rmSync(h, { recursive: true, force: true });
  }
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

test('--keep-warm loads a cold model, then backs off when something else evicts it',
  { timeout: 60_000 }, async () => {
    const ps = async () => (await fetch(`${OLLAMA}/api/ps`).then((r) => r.json())).models.map((m) => m.name.replace(/:latest$/, ''));
    const unload = (model) => fetch(`${OLLAMA}/api/generate`, { method: 'POST', body: JSON.stringify({ model, keep_alive: 0 }) });
    await unload(CHAT);
    await waitFor(async () => !(await ps()).includes(CHAT), 10_000, `${CHAT} unloaded`);
    const h = fs.mkdtempSync(path.join(os.tmpdir(), 'moonlight-warm-'));
    const hello = once(stub.events, 'hello');
    const a = startAgent(stub, h, ['--token', `ml_st_${'d'.repeat(32)}`, '--models', CHAT, '--keep-warm', CHAT],
      { MOONLIGHT_WARM_MS: '1500' });
    try {
      await hello;
      // Other workloads share this Ollama and may load it first; either way it is warm and the agent tracks it.
      await waitFor(async () => (await ps()).includes(CHAT), 20_000, `${CHAT} warm`);
      await sleep(2000);
      await unload(CHAT); // stands in for another workload evicting it
      await waitFor(() => a.out().includes('was unloaded to make room'), 15_000, 'back-off notice');
      const after = a.out().length;
      await sleep(2000); // the first back-off is 2x the warm interval (3 s here; 8 min for real)
      assert.ok(!a.out().slice(after).includes(`Loaded ${CHAT}`), 'does not fight to reload it during the back-off');
    } finally {
      a.proc.kill('SIGKILL');
      fs.rmSync(h, { recursive: true, force: true });
    }
  });

test('--vram-budget leaves out big models; the agent yields while the owner needs the GPU and resumes after quiet',
  { skip: process.platform === 'win32' && 'uses a shell-script nvidia-smi', timeout: 60_000 }, async () => {
    // A stand-in nvidia-smi whose numbers the test controls: a 24 GB card, quiet or busy.
    const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'moonlight-gpu-'));
    const state = path.join(fake, 'gpu.csv');
    const quiet = '24564, 2000, 22564, 0';
    const busy = '24564, 23000, 1564, 95';
    fs.writeFileSync(state, quiet);
    fs.writeFileSync(path.join(fake, 'nvidia-smi'), `#!/bin/sh
case "$*" in
  *name,memory.total*) echo "Fake GPU 24GB, 24564" ;;
  *query-gpu*) cat "${state}" ;;
  *) ;;
esac
`, { mode: 0o755 });
    const h = fs.mkdtempSync(path.join(os.tmpdir(), 'moonlight-yield-'));
    const hello = once(stub.events, 'hello');
    const models = [CHAT, installed.has(BIG) && BIG].filter(Boolean).join(',');
    const a = startAgent(stub, h, ['--yield-test', '--token', `ml_st_${'e'.repeat(32)}`, '--models', models, '--vram-budget', '1'],
      { PATH: `${fake}:${process.env.PATH}`, MOONLIGHT_YIELD_QUIET_MS: '2000' });
    try {
      const { node: n } = await hello;
      assert.equal(n.hello.node.gpu, 'Fake GPU 24GB');
      assert.equal(n.hello.node.vram_budget_gb, 1);
      assert.equal(n.hello.node.vram_free_gb, 22);
      const listed = n.hello.models.map((m) => m.model_id);
      assert.ok(listed.includes(CHAT), 'a 0.4 GB model fits a 1 GB budget');
      if (installed.has(BIG)) assert.ok(!listed.includes(BIG), `${BIG} needs more than 1 GB, so it is not listed`);
      const paused = once(stub.events, 'frame', (e) => e.node === n && e.msg.t === 'status' && e.msg.paused && e.msg.reason === 'owner_busy', 20_000);
      fs.writeFileSync(state, busy);
      const p = await paused;
      assert.equal(p.msg.vram.budget_gb, 1);
      const r = await stub.dispatch(n, 'chat', CHAT, chatBody('hi'));
      assert.equal(r.error?.code, 'paused', 'no new jobs while yielding');
      const resumed = once(stub.events, 'frame', (e) => e.node === n && e.msg.t === 'status' && !e.msg.paused, 20_000);
      fs.writeFileSync(state, quiet);
      await resumed;
      assert.match(a.out(), /Pausing: only 1\.5 GB of GPU memory free/);
      await waitFor(() => /quiet again/.test(a.out()), 5000, 'resume notice'); // printed just after the status frame
    } finally {
      a.proc.kill('SIGKILL');
      fs.rmSync(h, { recursive: true, force: true });
      fs.rmSync(fake, { recursive: true, force: true });
    }
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

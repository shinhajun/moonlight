// One buyer (or verification) request end to end: model lookup, balance, queueing, routing with retry and
// mid-stream failover, metering, billing, the request record and live events.
import { JobError } from './hub.js';
import { clampUsage, estimateOutput, estimatePrompt, estimateTokens, priceCost } from './metering.js';
import { AUTO_MODELS, autoAliasOf } from './policy.js';
import { badgeOf, eligible, rank } from './routing.js';
import { ApiError, canonicalModel, errors, newId, now, pushRing } from './util.js';

const CHAT_KEYS = ['model', 'messages', 'temperature', 'top_p', 'max_tokens', 'stop', 'seed', 'presence_penalty', 'frequency_penalty',
  'reasoning_effort', 'response_format', 'tools', 'tool_choice'];
const ROLES = new Set(['system', 'developer', 'user', 'assistant', 'tool']);
const ENDPOINT = { chat: '/v1/chat/completions', decision: '/v1/systemone', embedding: '/v1/embeddings' };
const ANSWER_KEYS = ['type', 'noul', 'choice', 'score', 'confidence', 'legend', 'probabilities'];

// Every chat job body (buyer, canary or failover) is built here, so verification jobs have the same shape.
export function chatJobBody(body, modelId, config) {
  const out = {};
  for (const k of CHAT_KEYS) {
    let v = k === 'model' ? modelId : body[k];
    if (k === 'max_tokens') {
      const asked = [body.max_tokens, body.max_completion_tokens].find((x) => Number.isInteger(x) && x > 0);
      v = Math.min(asked ?? config.maxTokensCap, config.maxTokensCap);
    }
    if (v !== undefined && v !== null) out[k] = v;
  }
  out.stream = true;
  return out;
}

function resolveModel(ctx, raw, kind) {
  if (typeof raw !== 'string' || !raw.trim()) throw errors.badRequest('`model` is required.');
  const model = ctx.catalog.get(canonicalModel(raw));
  if (!model) throw errors.noModel(raw);
  if (model.kind !== kind) throw errors.badRequest(`\`${model.id}\` is a ${model.kind} model; call ${ENDPOINT[model.kind]}.`);
  return model;
}

function validateMessages(messages) {
  if (!Array.isArray(messages) || !messages.length || messages.length > 2000) throw errors.badRequest('`messages` must be a non-empty array.');
  for (const m of messages) {
    if (!m || typeof m !== 'object' || !ROLES.has(m.role)) throw errors.badRequest('Each message needs a role: system, user, assistant or tool.');
    if (m.content != null && typeof m.content !== 'string' && !Array.isArray(m.content)) throw errors.badRequest('Message content must be a string or an array of parts.');
  }
}

function validateQuestions(q) {
  if (!q || typeof q !== 'object' || Array.isArray(q) || !Object.keys(q).length) throw errors.badRequest('`questions` must be an object of named questions.');
  if (Object.keys(q).length > 64) throw errors.badRequest('At most 64 questions per call.');
  for (const [name, v] of Object.entries(q)) {
    if (!v || !['noul', 'choice', 'score'].includes(v.type)) throw errors.badRequest(`questions.${name}.type must be noul, choice or score.`);
    if (v.instructions == null) throw errors.badRequest(`questions.${name}.instructions is required.`);
    if (v.type === 'choice' && (!v.criteria || typeof v.criteria !== 'object' || Array.isArray(v.criteria))) {
      throw errors.badRequest(`questions.${name}.criteria must map each choice to its description.`);
    }
    if (v.type === 'score' && !Array.isArray(v.criteria)) throw errors.badRequest(`questions.${name}.criteria must be a list for score questions.`);
  }
}

// Shared per-request state.
function begin(ctx, { buyer, model, body, pin, verification, signal, onQueued }) {
  const account = ctx.store.account(buyer.id);
  if (!verification && account.balance <= 0) throw errors.balance();
  const m = body.moonlight && typeof body.moonlight === 'object' ? body.moonlight : {};
  const { maxWaitS, maxWaitCapS } = ctx.config;
  const waitS = verification ? 60 : Math.min(maxWaitCapS, Math.max(0, Number.isFinite(m.max_wait_s) ? m.max_wait_s : maxWaitS));
  return {
    id: newId('req'), buyer: account, model, pin, verification, signal, onQueued, maxWaitMs: waitS * 1000, queuedMs: 0,
    filters: {
      verified_only: m.verified_only === true,
      max_price_out_per_m: Number.isFinite(m.max_price_out_per_m) ? m.max_price_out_per_m : null,
      seller: typeof m.seller === 'string' ? m.seller : null,
    },
  };
}

// Other live models a buyer could use instead: same kind, similar size, plus auto/* aliases of that kind that
// have a seller online (the matching-size one first). An auto/* request leads with the other aliases.
export function suggestions(ctx, model) {
  const size = model.params_b ?? (model.id === 'auto/chat-large' ? 35 : 7);
  const online = (m) => ctx.catalog.summary(m).sellers_online > 0;
  const others = ctx.catalog.all()
    .filter((m) => !m.auto && m.kind === model.kind && m.id !== model.id && m.public && online(m))
    .sort((a, b) => Math.abs(Math.log((a.params_b ?? 7) / size)) - Math.abs(Math.log((b.params_b ?? 7) / size)))
    .slice(0, 3)
    .map((m) => m.id);
  const match = autoAliasOf({ kind: model.kind, params_b: size, model_id: model.id });
  const aliases = Object.keys(AUTO_MODELS)
    .filter((id) => id !== model.id && AUTO_MODELS[id].kind === model.kind && online(ctx.catalog.get(id)))
    .sort((a, b) => (b === match) - (a === match));
  return model.auto ? [...aliases, ...others] : [...others, ...aliases];
}

function noCapacity(ctx, model) {
  const msg = `Every seller of \`${model.id}\` is busy or offline. Try again shortly or use one of the suggested models.`;
  return new ApiError(503, 'server_error', 'no_capacity', msg, {
    extra: { moonlight: { suggestions: suggestions(ctx, model) } },
    headers: { 'retry-after': '10' },
  });
}

// Next candidate, waiting in the model's fair queue if nobody has capacity. Queue time is counted, never billed.
// Verification jobs yield: on a single-slot node they wait while any buyer is queued for that node's models.
async function acquire(ctx, r, exclude) {
  const find = () => {
    const cand = rank(ctx, eligible(ctx, r.model, { filters: r.filters, pin: r.pin, exclude }))[0] || null;
    if (cand && r.verification && cand.conn.maxConcurrency === 1 && ctx.scheduler.buyersWaiting(cand.conn)) return null;
    return cand;
  };
  try {
    const { cand, queuedMs } = await ctx.scheduler.acquire({
      key: r.model.id, buyerId: r.buyer.id, find, maxWaitMs: Math.max(0, r.maxWaitMs - r.queuedMs), signal: r.signal, onQueued: r.onQueued,
      background: r.verification,
    });
    r.queuedMs += queuedMs;
    return cand;
  } catch (err) {
    if (err.code === 'no_capacity') throw noCapacity(ctx, r.model);
    throw err;
  }
}

// Settle and record a finished request. Returns the fields every response carries.
function finish(ctx, r, { cand, jobId, status, usage, ttft = null, latency, attempts, failovers = 0, error = null }) {
  const { listing, conn } = cand;
  const t = now();
  const cost = priceCost(listing.price, usage.in, usage.out);
  const { share } = ctx.store.settle({ requestId: r.id, buyerId: r.buyer.id, sellerId: listing.seller_id, listingId: listing.id, nodeId: conn.id, cost });
  const badge = badgeOf(ctx, listing);
  ctx.db.run(
    `INSERT INTO requests (id, ts, buyer_id, model_id, requested_model, kind, listing_id, seller_id, node_id, job_id, status, input_tokens,
       output_tokens, cost, earned, ttft_ms, latency_ms, queue_ms, attempts, failovers, verification, badge, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    r.id, t, r.buyer.id, listing.model_id, r.model.id, listing.kind, listing.id, listing.seller_id, conn.id, jobId, status, usage.in,
    usage.out, cost, share, ttft, latency, r.queuedMs, attempts, failovers, r.verification ? 1 : 0, badge, error,
  );
  if (status === 'ok') {
    pushRing(ctx.latency, listing.id, ttft ?? latency);
    pushRing(ctx.durations, listing.model_id, latency);
  }
  if (!r.verification) {
    ctx.bus.publish('request', {
      ts: t, model_id: listing.model_id, kind: listing.kind, seller_id: listing.seller_id, seller_name: conn.seller.name,
      node_id: conn.id, node_name: conn.info.name, cost_microusd: cost, latency_ms: latency,
    });
  }
  if (share) ctx.bus.publish('earning', { ts: t, seller_id: listing.seller_id, listing_id: listing.id, amount_microusd: share, held: listing.state === 'flagged' });
  ctx.hub.pushStats(conn);
  return {
    request_id: r.id, model: listing.model_id, listing, cost, seller_id: listing.seller_id, node_id: conn.id,
    verified: listing.state === 'verified' || badge === 'verified', badge, usage,
  };
}

function recordFailure(ctx, r, attempts, error) {
  ctx.db.run(
    `INSERT INTO requests (id, ts, buyer_id, model_id, requested_model, kind, status, queue_ms, attempts, verification, error)
     VALUES (?, ?, ?, ?, ?, ?, 'error', ?, ?, ?, ?)`,
    r.id, now(), r.buyer.id, r.model.id, r.model.id, r.model.kind, r.queuedMs, attempts, r.verification ? 1 : 0, String(error).slice(0, 300),
  );
}

// After a failover the next node may continue the prefill or restart from scratch. Hold its output while it
// still repeats what the buyer already has; once it passes that text, emit only the new part; if it diverges,
// it is a continuation and goes out as is.
function dedupe(sent) {
  let buf = '';
  let open = !sent;
  return (text) => {
    if (open || !text) return text;
    buf += text;
    if (sent.startsWith(buf)) return '';
    open = true;
    return buf.startsWith(sent) ? buf.slice(sent.length) : buf;
  };
}

const reasoningOf = (d) => (typeof d.reasoning === 'string' ? d.reasoning : typeof d.reasoning_content === 'string' ? d.reasoning_content : '');

// onChunk(chunk, meta) streams OpenAI chunks as they arrive; the caller writes the final chunk from the result.
// onDispatch(meta) fires each time the job goes to a node, before its first token (to open the stream early).
// Returns null when the buyer went away.
export async function serveChat(ctx, { buyer, body, pin = null, verification = false, signal = null, onChunk = null, onQueued = null, onDispatch = null }) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw errors.badRequest('Request body must be a JSON object.');
  const model = resolveModel(ctx, body.model, 'chat');
  validateMessages(body.messages);
  const r = begin(ctx, { buyer, model, body, pin, verification, signal, onQueued });
  const tol = ctx.config.usageTolerance;
  const jobBody = chatJobBody(body, model.id, ctx.config);
  const promptEst = estimatePrompt(jobBody.messages);
  const created = Math.floor(now() / 1000);
  const out = { content: '', reasoning: '', toolCalls: [], chunks: 0, finish: null };
  const failovers = [];
  const exclude = new Set();
  let cand = null;
  let job = null;
  let done = null;
  let attempts = 0;
  let ttft = null;
  let t0 = null;
  let sentRole = false;

  const result = (status, extra = {}) => {
    const estOut = estimateOutput(out.chunks, out.content + out.reasoning + (out.toolCalls.length ? JSON.stringify(out.toolCalls) : ''));
    const clean = status === 'ok' && !failovers.length;
    const usage = {
      in: clean ? clampUsage(done.usage.input_tokens, promptEst, tol) : promptEst,
      out: clean ? clampUsage(done.usage.output_tokens, estOut, tol) : estOut,
    };
    const rec = finish(ctx, r, { cand, jobId: job.id, status, usage, ttft, latency: now() - t0, attempts, failovers: failovers.length, error: extra.error });
    return {
      ...rec, created, content: out.content, reasoning: out.reasoning, tool_calls: out.toolCalls, failovers,
      finish_reason: extra.finish_reason || out.finish || (out.toolCalls.length ? 'tool_calls' : 'stop'), error: extra.error || null,
    };
  };

  while (!done) {
    let next;
    try {
      next = await acquire(ctx, r, exclude);
    } catch (err) {
      if (signal?.aborted) {
        if (out.chunks) result('cancelled');
        return null;
      }
      // Nobody left to continue a stream that already started: the buyer keeps the partial answer.
      if (out.chunks && err.code === 'no_capacity') return result('seller_lost', { finish_reason: 'length', error: 'seller_lost' });
      if (attempts) recordFailure(ctx, r, attempts, err.message);
      throw err;
    }
    if (cand && out.chunks) failovers.push({ from_node: cand.conn.id, to_node: next.conn.id, at_token: out.chunks });
    cand = next;
    attempts++;
    t0 ??= now();
    const served = cand.listing.model_id;
    const messages = out.content ? [...jobBody.messages, { role: 'assistant', content: out.content }] : jobBody.messages;
    const keep = { content: dedupe(out.content), reasoning: dedupe(out.reasoning) };
    out.finish = null;
    // A slow first token (a cold model load) only fails over when another seller could take the job.
    const tried = new Set([...exclude, cand.conn]);
    const waitLonger = () => !eligible(ctx, r.model, { filters: r.filters, pin: r.pin, exclude: tried, capacity: false }).length;
    job = ctx.hub.run(cand.conn, { kind: 'chat', model_id: served, body: { ...jobBody, model: served, messages } }, { reserved: true, waitLonger });
    onDispatch?.({ request_id: r.id, seller_id: cand.listing.seller_id, node_id: cand.conn.id, model: served });
    const abort = () => job.cancel();
    signal?.addEventListener('abort', abort);
    try {
      for await (const ev of job) {
        if (ev.type === 'done') {
          done = ev;
          continue;
        }
        const choice = ev.data?.choices?.[0];
        if (!choice) continue;
        ttft ??= now() - t0;
        if (choice.finish_reason) out.finish = choice.finish_reason;
        const delta = choice.delta || {};
        const content = keep.content(typeof delta.content === 'string' ? delta.content : '');
        const reasoning = keep.reasoning(reasoningOf(delta));
        const tools = Array.isArray(delta.tool_calls) && delta.tool_calls.length ? delta.tool_calls : null;
        if (!content && !reasoning && !tools && sentRole) continue;
        const d = sentRole ? {} : { role: 'assistant' };
        sentRole = true;
        if (content || (!reasoning && !tools)) d.content = content;
        if (reasoning) d.reasoning = reasoning;
        if (tools) {
          d.tool_calls = tools;
          out.toolCalls.push(...tools);
        }
        out.content += content;
        out.reasoning += reasoning;
        if (content || reasoning || tools) out.chunks++;
        onChunk?.(
          { id: `chatcmpl-${r.id}`, object: 'chat.completion.chunk', created, model: served, choices: [{ index: 0, delta: d, finish_reason: null }] },
          { request_id: r.id, seller_id: cand.listing.seller_id, node_id: cand.conn.id },
        );
      }
    } catch (err) {
      if (signal?.aborted) {
        if (out.chunks) result('cancelled');
        return null;
      }
      if (!(err instanceof JobError)) throw err;
      ctx.config.log?.(`${r.id} ${served} on ${cand.conn.id} failed after ${out.chunks} chunks: ${err.message}`);
      exclude.add(cand.conn);
      if (attempts >= ctx.config.maxAttempts) {
        if (out.chunks) return result('seller_lost', { finish_reason: 'length', error: 'seller_lost' });
        recordFailure(ctx, r, attempts, err.message);
        throw errors.upstream(`Sellers of \`${model.id}\` kept failing. Try again.`);
      }
    } finally {
      signal?.removeEventListener('abort', abort);
    }
  }
  return result('ok');
}

// Decision (systemone) and embedding jobs: one result, retried on another seller until one answers.
async function serveOnce(ctx, r, kind, jobBody, signal, parse) {
  const exclude = new Set();
  let attempts = 0;
  let t0 = null;
  for (;;) {
    let cand;
    try {
      cand = await acquire(ctx, r, exclude);
    } catch (err) {
      if (signal?.aborted) return null;
      if (attempts) recordFailure(ctx, r, attempts, err.message);
      throw err;
    }
    attempts++;
    t0 ??= now();
    const served = cand.listing.model_id;
    const job = ctx.hub.run(cand.conn, { kind, model_id: served, body: { ...jobBody, model: served } }, { reserved: true });
    const abort = () => job.cancel();
    signal?.addEventListener('abort', abort);
    try {
      let done = null;
      for await (const ev of job) if (ev.type === 'done') done = ev;
      const parsed = parse(done);
      if (!parsed) throw new JobError('bad_result', `${kind} result is malformed`);
      const rec = finish(ctx, r, { cand, jobId: job.id, status: 'ok', usage: parsed.usage, latency: now() - t0, attempts });
      return { ...rec, ...parsed.body, cand };
    } catch (err) {
      if (signal?.aborted) return null;
      if (!(err instanceof JobError)) throw err;
      ctx.config.log?.(`${r.id} ${served} on ${cand.conn.id} failed: ${err.message}`);
      exclude.add(cand.conn);
      if (attempts >= ctx.config.maxAttempts) {
        recordFailure(ctx, r, attempts, err.message);
        throw errors.upstream(`Sellers of \`${r.model.id}\` kept failing. Try again.`);
      }
    } finally {
      signal?.removeEventListener('abort', abort);
    }
  }
}

function cleanAnswers(answers, questions) {
  if (!answers || typeof answers !== 'object') return null;
  const out = {};
  for (const name of Object.keys(questions)) {
    const a = answers[name];
    if (!a || typeof a !== 'object') return null;
    out[name] = Object.fromEntries(ANSWER_KEYS.filter((k) => a[k] !== undefined).map((k) => [k, a[k]]));
  }
  return out;
}

export async function serveDecision(ctx, { buyer, body, pin = null, verification = false, signal = null, onQueued = null }) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw errors.badRequest('Request body must be a JSON object.');
  const model = resolveModel(ctx, body.model, 'decision');
  validateQuestions(body.questions);
  const r = begin(ctx, { buyer, model, body, pin, verification, signal, onQueued });
  const tol = ctx.config.usageTolerance;
  const jobBody = { model: model.id, state: body.state ?? {}, questions: body.questions };
  if (body.assets !== undefined) jobBody.assets = body.assets;
  const promptEst = estimateTokens(JSON.stringify({ state: jobBody.state, questions: jobBody.questions }));
  const res = await serveOnce(ctx, r, 'decision', jobBody, signal, (done) => {
    const answers = cleanAnswers(done?.result?.answers, jobBody.questions);
    if (!answers) return null;
    const u = { ...done.result.usage, ...done.usage };
    // Output tokens are not estimated for decisions (Laya reports 0); only capped.
    const outCap = Math.ceil(estimateTokens(JSON.stringify(answers)) * (1 + tol));
    return {
      usage: { in: clampUsage(u.input_tokens, promptEst, tol), out: Math.min(Math.max(0, Math.round(Number(u.output_tokens) || 0)), outCap) },
      body: { answers },
    };
  });
  if (res && !verification) ctx.verifier?.afterDecision({ listing: res.cand.listing, conn: res.cand.conn, body: jobBody, answers: res.answers });
  return res;
}

export async function serveEmbeddings(ctx, { buyer, body, pin = null, verification = false, signal = null, onQueued = null }) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw errors.badRequest('Request body must be a JSON object.');
  const model = resolveModel(ctx, body.model, 'embedding');
  const inputs = typeof body.input === 'string' ? [body.input] : body.input;
  if (!Array.isArray(inputs) || !inputs.length || inputs.length > 2048 || !inputs.every((x) => typeof x === 'string')) {
    throw errors.badRequest('`input` must be a string or a non-empty array of up to 2048 strings.');
  }
  const r = begin(ctx, { buyer, model, body, pin, verification, signal, onQueued });
  const tol = ctx.config.usageTolerance;
  const jobBody = { model: model.id, input: body.input };
  if (Number.isInteger(body.dimensions) && body.dimensions > 0) jobBody.dimensions = body.dimensions;
  const promptEst = inputs.reduce((n, s) => n + estimateTokens(s), 0);
  return serveOnce(ctx, r, 'embedding', jobBody, signal, (done) => {
    const data = done?.result?.data;
    if (!Array.isArray(data) || data.length !== inputs.length) return null;
    const vectors = [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((d) => d?.embedding);
    if (!vectors.every((v) => Array.isArray(v) && v.length && v.every(Number.isFinite))) return null;
    const reported = done.usage?.input_tokens ?? done.result.usage?.prompt_tokens;
    return {
      usage: { in: clampUsage(reported, promptEst, tol), out: 0 },
      body: { data: vectors.map((embedding, index) => ({ object: 'embedding', index, embedding })) },
    };
  });
}

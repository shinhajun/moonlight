// Buyer API (/v1/*). The web playground calls the same handlers with the session's account.
import { errorBody, readJson, send } from './http.js';
import { serveChat, serveDecision, serveEmbeddings } from './serve.js';
import { p50 } from './util.js';

export function listModels(ctx, req, res) {
  const data = ctx.catalog.all().map((m) => {
    const s = ctx.catalog.summary(m);
    return {
      id: m.id, object: 'model', created: 0, owned_by: m.owner || 'moonlight',
      moonlight: { kind: m.kind, sellers_online: s.sellers_online, price_from: s.price_from, verified: s.verified },
    };
  });
  send(res, 200, { object: 'list', data });
}

// Rough wait for queue position `pos`: typical job time × position ÷ parallel slots serving the model.
function queueEta(ctx, modelId, pos) {
  let slots = 0;
  for (const c of ctx.hub.conns.values()) if (c.listings.has(modelId)) slots += c.maxConcurrency;
  const typical = p50(ctx.durations.get(modelId) || []) ?? 10_000;
  return Math.ceil((pos * typical) / 1000 / Math.max(1, slots));
}

const headersOf = (r) => ({
  'x-moonlight-request': r.request_id, 'x-moonlight-seller': r.seller_id, 'x-moonlight-node': r.node_id, 'x-moonlight-cost-microusd': String(r.cost),
});

const moonlightOf = (r) => ({
  request: r.request_id, cost: r.cost, seller: r.seller_id, node: r.node_id, verified: r.verified, badge: r.badge, served_model: r.model,
});

// Abort the job if the buyer disconnects before we finish.
function abortOnClose(res) {
  const ac = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) ac.abort();
  });
  return ac.signal;
}

export async function chatCompletions(ctx, req, res, buyer) {
  const body = await readJson(req);
  const stream = body?.stream === true;
  const signal = abortOnClose(res);
  let open = false;
  let waiting = null; // keepalive while the node loads the model / produces its first token
  const stopWaiting = () => clearInterval(waiting);
  res.on('close', stopWaiting);
  const openStream = (meta) => {
    if (open) return;
    open = true;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', 'x-accel-buffering': 'no',
      ...(meta && { 'x-moonlight-request': meta.request_id, 'x-moonlight-seller': meta.seller_id, 'x-moonlight-node': meta.node_id }),
    });
  };
  try {
    const r = await serveChat(ctx, {
      buyer, body, signal,
      onQueued: stream
        ? (pos) => {
            openStream(null);
            res.write(`: queued position=${pos} eta_s=${queueEta(ctx, body.model, pos)}\n\n`);
          }
        : null,
      onDispatch: stream
        ? (meta) => {
            openStream(meta);
            stopWaiting();
            const t0 = Date.now();
            const tick = () => res.write(`: waiting model=${meta.model} elapsed_s=${Math.round((Date.now() - t0) / 1000)}\n\n`);
            tick();
            waiting = setInterval(tick, ctx.config.waitingKeepaliveMs);
          }
        : null,
      onChunk: stream
        ? (chunk, meta) => {
            stopWaiting();
            openStream(meta);
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          }
        : null,
    });
    stopWaiting();
    if (!r) return;
    const usage = { prompt_tokens: r.usage.in, completion_tokens: r.usage.out, total_tokens: r.usage.in + r.usage.out };
    const moonlight = { ...moonlightOf(r), failovers: r.failovers, ...(r.error && { error: r.error }) };
    if (stream) {
      openStream(r);
      const last = { id: `chatcmpl-${r.request_id}`, object: 'chat.completion.chunk', created: r.created, model: r.model, choices: [{ index: 0, delta: {}, finish_reason: r.finish_reason }], usage, moonlight };
      res.write(`data: ${JSON.stringify(last)}\n\n`);
      res.end('data: [DONE]\n\n');
      return;
    }
    const message = { role: 'assistant', content: r.content };
    if (r.reasoning) message.reasoning = r.reasoning;
    if (r.tool_calls.length) message.tool_calls = r.tool_calls;
    send(res, 200, {
      id: `chatcmpl-${r.request_id}`, object: 'chat.completion', created: r.created, model: r.model,
      choices: [{ index: 0, message, finish_reason: r.finish_reason }], usage, moonlight,
    }, headersOf(r));
  } catch (err) {
    stopWaiting();
    if (!open) throw err;
    // The stream is already open (queued keepalives or partial output): report the error in-band.
    res.write(`data: ${JSON.stringify(errorBody(err.status ? err : { message: 'Something went wrong on our side.', type: 'server_error', code: 'internal_error' }))}\n\n`);
    res.end('data: [DONE]\n\n');
  }
}

export async function systemone(ctx, req, res, buyer) {
  const body = await readJson(req);
  const r = await serveDecision(ctx, { buyer, body, signal: abortOnClose(res) });
  if (!r) return;
  send(res, 200, { model: r.model, answers: r.answers, usage: { input_tokens: r.usage.in, output_tokens: r.usage.out }, moonlight: moonlightOf(r) }, headersOf(r));
}

export async function embeddings(ctx, req, res, buyer) {
  const body = await readJson(req);
  const r = await serveEmbeddings(ctx, { buyer, body, signal: abortOnClose(res) });
  if (!r) return;
  send(res, 200, {
    object: 'list', data: r.data, model: r.model, usage: { prompt_tokens: r.usage.in, total_tokens: r.usage.in }, moonlight: moonlightOf(r),
  }, headersOf(r));
}

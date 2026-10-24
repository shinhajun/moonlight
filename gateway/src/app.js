// Wires the gateway together: one HTTP server for the web app, /v1, /api, downloads, and the /agent WebSocket.
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { createApi } from './api.js';
import { createCatalog } from './catalog.js';
import { openDb } from './db.js';
import { createDigests } from './digests.js';
import { bearer, router, send, sendError, serveDownloads, serveStatic } from './http.js';
import { createHub } from './hub.js';
import { createScheduler } from './queue.js';
import { createStore } from './store.js';
import { errors } from './util.js';
import { chatCompletions, embeddings, listModels, systemone } from './v1.js';
import { createVerifier } from './verify.js';

function createBus() {
  const subs = new Set();
  return {
    publish(type, data) {
      for (const fn of subs) fn(type, data);
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-expose-headers': 'x-moonlight-request, x-moonlight-seller, x-moonlight-node, x-moonlight-cost-microusd, retry-after',
};

export function createGateway(config) {
  const db = openDb(config.dbPath);
  const ctx = { config, db, bus: createBus(), latency: new Map(), durations: new Map() };
  ctx.store = createStore(db, config);
  ctx.store.bootstrap();
  ctx.digests = createDigests(config);
  ctx.hub = createHub(ctx);
  ctx.catalog = createCatalog(ctx);
  ctx.scheduler = createScheduler(ctx);
  ctx.verifier = createVerifier(ctx);
  const api = createApi(ctx);

  // /v1 takes an API key; the playground the same handlers with the signed-in account.
  function buyer(req) {
    const found = ctx.store.bySecret(bearer(req));
    if (!found) throw errors.unauthorized();
    if (found.kind !== 'api') throw errors.unauthorized('Use an API key (ml_sk_…), not a seller token.');
    return found.account;
  }
  const v1 = (fn) => (req, res) => fn(ctx, req, res, buyer(req));
  const playground = (fn) => (req, res) => fn(ctx, req, res, api.need(req));

  const route = router([
    ['GET', '/healthz', (req, res) => send(res, 200, { ok: true, nodes_online: ctx.hub.conns.size })],
    ['GET', '/v1/models', (req, res) => listModels(ctx, req, res)],
    ['POST', '/v1/chat/completions', v1(chatCompletions)],
    ['POST', '/v1/systemone', v1(systemone)],
    ['POST', '/v1/embeddings', v1(embeddings)],

    ['POST', '/api/auth/signup', api.signup],
    ['POST', '/api/auth/login', api.login],
    ['POST', '/api/auth/logout', api.logout],
    ['POST', '/api/accounts', api.seedAccount],
    ['GET', '/api/me', api.me],
    ['POST', '/api/me/keys', api.createKey],
    ['DELETE', '/api/me/keys/:id', api.deleteKey],
    ['GET', '/api/me/nodes', api.myNodes],
    ['PATCH', '/api/me/listings/:id', api.patchListing],
    ['PATCH', '/api/listings/:id', api.patchListing],
    ['POST', '/api/listings/:id/pause', api.togglePause],

    ['POST', '/api/devices/pair', api.pair],
    ['POST', '/api/devices/pair/poll', api.pairPoll],
    ['GET', '/api/devices/:code', api.pairInfo],
    ['POST', '/api/devices/:code/approve', api.pairApprove],

    ['GET', '/api/stats', api.stats],
    ['GET', '/api/models', api.models],
    ['GET', '/api/models/:id*', api.model],
    ['POST', '/api/playground/chat', playground(chatCompletions)],
    ['POST', '/api/playground/systemone', playground(systemone)],
    ['POST', '/api/playground/embeddings', playground(embeddings)],
    ['GET', '/api/events', api.events],

    ['POST', '/api/admin/listings/:id', api.adminListing],
    ['POST', '/api/admin/verify/:id', api.adminVerify],
  ]);

  const log = (s) => config.log?.(s);

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    const isApi = p.startsWith('/v1/') || p.startsWith('/api/') || p === '/healthz';
    if (p.startsWith('/v1/')) for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
    if (req.method === 'OPTIONS' && p.startsWith('/v1/')) return send(res, 204);
    if (isApi) {
      const t0 = Date.now();
      if (p !== '/api/events') res.on('finish', () => log(`${req.method} ${p} ${res.statusCode} ${Date.now() - t0}ms`));
      const m = route(req.method, p);
      try {
        if (!m) throw errors.notFound(`No route for ${req.method} ${p}.`);
        if (m.notAllowed) throw errors.notFound(`${req.method} is not supported on ${p}.`);
        await m.handler(req, res, m.params);
      } catch (err) {
        sendError(res, err, log);
      }
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: { message: 'Method not allowed.' } });
    if (serveDownloads(config, req, res, p)) return;
    serveStatic(config, req, res, p);
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => sendError(res, err, log));
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url, 'http://x').pathname !== '/agent') return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => ctx.hub.attach(ws));
  });

  return {
    ctx,
    server,
    listen(port = config.port, host = config.host) {
      ctx.verifier.start();
      return new Promise((resolve) => server.listen(port, host, () => resolve(server.address())));
    },
    async close() {
      ctx.verifier.stop();
      ctx.scheduler.close();
      await ctx.hub.close();
      ctx.closed = true;
      wss.close();
      server.closeAllConnections?.();
      await new Promise((r) => server.close(r));
      await new Promise((r) => setImmediate(r));
      db.close();
    },
  };
}

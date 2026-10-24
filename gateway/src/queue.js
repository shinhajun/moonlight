// Per-model fair queue. When no listing has free capacity, requests wait here (up to their max_wait) and are
// served round-robin across buyers, FIFO within a buyer. Capacity changes (a job ends, a seller connects or
// resumes) pump the queues. A request takes a capacity reservation on the node it is handed.
import { JobError } from './hub.js';
import { AUTO_MODELS } from './policy.js';
import { now } from './util.js';

export function createScheduler(ctx) {
  const queues = new Map(); // key (requested model id) -> {waiters: []}
  const lastBuyer = new Map(); // key -> buyer served most recently, queued or not
  const ticker = setInterval(() => !ctx.closed && pump(), 2000);
  ticker.unref();

  // Waiters in service order: round-robin across buyers starting after the last one served;
  // background (verification) waiters after every buyer.
  function fairOrder(q) {
    const byBuyer = new Map();
    for (const w of q.waiters.filter((x) => !x.background)) {
      if (!byBuyer.has(w.buyerId)) byBuyer.set(w.buyerId, []);
      byBuyer.get(w.buyerId).push(w);
    }
    const buyers = [...byBuyer.keys()];
    const start = buyers.indexOf(lastBuyer.get(q.key)) + 1;
    const lists = [...buyers.slice(start), ...buyers.slice(0, start)].map((b) => byBuyer.get(b));
    const order = [];
    const fg = q.waiters.length - q.waiters.filter((x) => x.background).length;
    for (let i = 0; order.length < fg; i++) for (const l of lists) if (l[i]) order.push(l[i]);
    return [...order, ...q.waiters.filter((x) => x.background)];
  }

  // Is any buyer queued for a model this node lists (directly or through an auto/* alias)?
  function buyersWaiting(conn) {
    for (const [key, q] of queues) {
      if (!q.waiters.some((w) => !w.background)) continue;
      if (conn.listings.has(key)) return true;
      const auto = AUTO_MODELS[key];
      if (auto && [...conn.listings.values()].some((lid) => auto.match(ctx.store.listing(lid)))) return true;
    }
    return false;
  }

  function remove(key, w) {
    const q = queues.get(key);
    if (!q) return;
    const i = q.waiters.indexOf(w);
    if (i >= 0) q.waiters.splice(i, 1);
    clearTimeout(w.timer);
    if (!q.waiters.length) queues.delete(key);
    depth(key);
  }

  function depth(key) {
    const n = queues.get(key)?.waiters.length || 0;
    ctx.bus.publish('queue', { ts: now(), model_id: key, depth: n });
  }

  function hand(key, w, cand) {
    cand.conn.reserved++;
    lastBuyer.set(key, w.buyerId);
    w.resolve({ cand, queuedMs: now() - w.at });
  }

  function pump() {
    for (const [key, q] of [...queues]) {
      for (let served = true; served && q.waiters.length; ) {
        served = false;
        for (const w of fairOrder(q)) {
          const cand = w.find();
          if (!cand) continue;
          remove(key, w);
          hand(key, w, cand);
          served = true;
          break;
        }
      }
      fairOrder(q).forEach((w, i) => w.onQueued?.(i + 1));
    }
  }

  // Resolves {cand, queuedMs} with a reservation on cand.conn (hub.run(..., {reserved:true}) consumes it).
  // Rejects JobError('no_capacity') after maxWaitMs, or JobError('cancelled') if the buyer goes away.
  function acquire({ key, buyerId, find, maxWaitMs, signal, onQueued, background = false }) {
    if (!queues.get(key)?.waiters.length) {
      const cand = find();
      if (cand) {
        cand.conn.reserved++;
        lastBuyer.set(key, buyerId);
        return Promise.resolve({ cand, queuedMs: 0 });
      }
    }
    if (maxWaitMs <= 0) return Promise.reject(new JobError('no_capacity'));
    if (signal?.aborted) return Promise.reject(new JobError('cancelled'));
    return new Promise((resolve, reject) => {
      const w = { buyerId, find, onQueued, background, at: now(), resolve, reject };
      w.timer = setTimeout(() => {
        remove(key, w);
        reject(new JobError('no_capacity'));
      }, maxWaitMs);
      signal?.addEventListener('abort', () => {
        if (!queues.get(key)?.waiters.includes(w)) return;
        remove(key, w);
        reject(new JobError('cancelled'));
      }, { once: true });
      if (!queues.has(key)) queues.set(key, { key, waiters: [] });
      queues.get(key).waiters.push(w);
      depth(key);
      onQueued?.(fairOrder(queues.get(key)).indexOf(w) + 1);
      ctx.hub.capacityChanged();
    });
  }

  return {
    acquire,
    pump,
    buyersWaiting,
    depth: (key) => queues.get(key)?.waiters.length || 0,
    release: (cand) => cand.conn.reserved--,
    close: () => clearInterval(ticker),
  };
}

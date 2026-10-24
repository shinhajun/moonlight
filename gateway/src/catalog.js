// The catalog is dynamic: a model exists while at least one seller lists it (policy live), plus the auto/* aliases.
import { AUTO_MODELS, paramsB } from './policy.js';
import { p50 } from './util.js';

const PRICE_UNIT = { chat: 'out_per_m', decision: 'per_call', embedding: 'in_per_m' };

export function createCatalog(ctx) {
  const { db } = ctx;

  function get(id) {
    if (!id) return null;
    const auto = AUTO_MODELS[id];
    if (auto) return { id, kind: auto.kind, title: auto.title, auto: true, public: true };
    const l = db.get(
      "SELECT l.*, a.handle FROM listings l JOIN accounts a ON a.id = l.seller_id WHERE l.model_id = ? AND l.policy = 'live' ORDER BY l.updated_at DESC LIMIT 1",
      id,
    );
    if (!l) return null;
    return {
      id, kind: l.kind, title: id, auto: false, public: !l.private, owner: l.private ? l.handle : null,
      family: l.family, params_b: paramsB(l), quant: l.quant, context: l.context, dims: l.dims, license: l.license_id,
    };
  }

  function all() {
    const ids = db.all("SELECT DISTINCT model_id FROM listings WHERE policy = 'live' ORDER BY model_id").map((r) => r.model_id);
    return [...ids.map(get), ...Object.keys(AUTO_MODELS).map(get)].filter(Boolean);
  }

  // Live numbers across online, unpaused listings. Flagged listings count as online (they lower
  // verified_share) but are not routable, so they are not "sellers online".
  function summary(model) {
    const seen = new Map();
    for (const conn of ctx.hub.conns.values()) {
      if (conn.paused || conn.draining) continue;
      const ids = model.auto ? [...conn.listings.values()] : [conn.listings.get(model.id)].filter(Boolean);
      for (const id of ids) if (!seen.has(id)) seen.set(id, ctx.store.listing(id));
    }
    const online = [...seen.values()].filter((l) => !l.paused && (!model.auto || AUTO_MODELS[model.id].match(l)));
    const routable = online.filter((l) => l.state !== 'flagged');
    const unit = PRICE_UNIT[model.kind];
    const prices = routable.map((l) => l.price[unit]).filter((p) => p != null);
    return {
      sellers_online: new Set(routable.map((l) => l.seller_id)).size,
      price_from: prices.length ? Math.min(...prices) : null,
      price_unit: unit,
      p50_ms: p50(routable.flatMap((l) => ctx.latency.get(l.id) || [])),
      verified_share: online.length ? online.filter((l) => l.state === 'verified').length / online.length : 0,
      verified: routable.some((l) => l.state === 'verified'),
    };
  }

  return { get, all, summary };
}

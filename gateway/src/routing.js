// Candidate listings for a request, scored: price + p50 latency + load − reputation (lowest wins).
import { AUTO_MODELS, paramsB } from './policy.js';
import { p50, now } from './util.js';
import { unitPrice } from './metering.js';

// Online (listing, node) pairs that can take a job for `model` now and pass the buyer's filters.
// `model` is a catalog entry; an auto/* alias matches every listing of its class, preferring verified ones.
// A pinned pair (verification) may be flagged, so a flagged listing can still recover.
export function eligible(ctx, model, { filters = {}, pin = null, exclude = null, capacity = true } = {}) {
  const out = [];
  for (const conn of ctx.hub.conns.values()) {
    if (exclude?.has(conn) || (pin && pin.node_id !== conn.id)) continue;
    if (capacity ? !ctx.hub.hasCapacity(conn) : conn.paused || conn.draining) continue;
    const ids = model.auto ? [...conn.listings.values()] : [conn.listings.get(model.id)].filter(Boolean);
    for (const lid of ids) {
      if (pin && pin.listing_id !== lid) continue;
      const listing = ctx.store.listing(lid);
      if (listing.policy !== 'live' || listing.paused) continue;
      if (model.auto && !AUTO_MODELS[model.id].match(listing)) continue;
      if (listing.state === 'flagged' && !pin) continue;
      if (filters.verified_only && listing.state !== 'verified') continue;
      if (filters.seller && listing.seller_id !== filters.seller) continue;
      if (filters.max_price_out_per_m != null && (listing.price.out_per_m ?? 0) > filters.max_price_out_per_m) continue;
      out.push({ listing, conn });
    }
  }
  if (model.auto) {
    const verified = out.filter((c) => c.listing.state === 'verified');
    if (verified.length) return verified;
  }
  return out;
}

// For an auto/* alias, quality comes first (verified, then the larger model of the class); price, latency and
// load break ties.
export function rank(ctx, cands, model = null) {
  const w = ctx.config.weights;
  const f = cands.map((c) => ({
    c,
    price: unitPrice(c.listing.price),
    lat: p50(ctx.latency.get(c.listing.id) || []),
    load: c.conn.inflight.size / c.conn.maxConcurrency,
    rep: reputation(ctx, c.listing),
  }));
  const max = (k) => Math.max(0, ...f.map((x) => x[k] ?? 0));
  const [mp, ml, mi] = [max('price'), max('lat'), max('load')];
  for (const x of f) {
    // Unknown latency counts as middling, so new sellers still get traffic.
    const lat = x.lat == null ? 0.5 : ml ? x.lat / ml : 0;
    x.score = w.price * (mp ? x.price / mp : 0) + w.lat * lat + w.load * (mi ? x.load / mi : 0) - (w.rep * x.rep) / 100;
  }
  const quality = (x) => (model?.auto ? [x.c.listing.state === 'verified' ? 1 : 0, paramsB(x.c.listing) ?? 0] : [0, 0]);
  f.sort((a, b) => {
    const [qa, qb] = [quality(a), quality(b)];
    return qb[0] - qa[0] || qb[1] - qa[1] || a.score - b.score || a.c.listing.id.localeCompare(b.c.listing.id);
  });
  return f.map((x) => x.c);
}

// 0–100 from pass rate (last 20 checks), seller uptime and latency stability.
export function reputation(ctx, listing) {
  const checks = ctx.db.all('SELECT passed FROM checks WHERE listing_id = ? ORDER BY id DESC LIMIT 20', listing.id);
  const trusted = !!ctx.store.account(listing.seller_id)?.trusted;
  const pass = checks.length ? checks.filter((c) => c.passed).length / checks.length : trusted ? 1 : 0.5;
  const uptime = sellerUptime(ctx, listing.seller_id);
  const lats = ctx.latency.get(listing.id) || [];
  let stability = 0.5;
  if (lats.length >= 3) {
    const mean = lats.reduce((a, b) => a + b, 0) / lats.length;
    const sd = Math.sqrt(lats.reduce((a, b) => a + (b - mean) ** 2, 0) / lats.length);
    stability = mean ? 1 - Math.min(1, sd / mean) : 1;
  }
  return Math.round(100 * (0.6 * pass + 0.25 * uptime + 0.15 * stability));
}

export function sellerUptime(ctx, sellerId) {
  const t = now();
  let online = 0;
  let total = 0;
  for (const n of ctx.db.all('SELECT id, first_seen, online_ms FROM nodes WHERE seller_id = ?', sellerId)) {
    const conn = ctx.hub.conns.get(n.id);
    online += n.online_ms + (conn ? t - conn.connectedAt : 0);
    total += t - n.first_seen;
  }
  return total > 0 ? Math.min(1, online / total) : 1;
}

// Buyer-facing badge. "verified" needs a pass against a trusted node or peers; self-consistency alone
// (private models, or nobody to compare with) reads "consistent".
export function badgeOf(ctx, listing) {
  if (listing.state === 'flagged') return 'flagged';
  if (ctx.store.account(listing.seller_id)?.trusted) return 'verified';
  if (listing.state !== 'verified') return 'new';
  if (listing.private) return 'consistent';
  const independent = ctx.db.get(
    "SELECT COUNT(*) AS n FROM (SELECT method, passed FROM checks WHERE listing_id = ? ORDER BY id DESC LIMIT 10) WHERE passed = 1 AND method != 'consistency'",
    listing.id,
  ).n;
  return independent ? 'verified' : 'consistent';
}

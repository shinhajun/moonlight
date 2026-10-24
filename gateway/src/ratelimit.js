// In-memory, per-key fixed-window counters. Good enough for one gateway process.
export function createLimiter() {
  const windows = new Map(); // key -> {count, resetAt}
  return {
    // Counts one hit; returns 0 if allowed, else the seconds until the window resets.
    take(key, limit, windowMs) {
      const t = Date.now();
      if (windows.size > 50_000) for (const [k, w] of windows) if (w.resetAt <= t) windows.delete(k);
      let w = windows.get(key);
      if (!w || w.resetAt <= t) windows.set(key, (w = { count: 0, resetAt: t + windowMs }));
      return ++w.count > limit ? Math.ceil((w.resetAt - t) / 1000) : 0;
    },
  };
}

// The client's address. Behind Caddy (a loopback peer) it is the last X-Forwarded-For entry, the one Caddy set.
export function clientIp(req) {
  const peer = req.socket.remoteAddress || '';
  const xff = req.headers['x-forwarded-for'];
  if (xff && /^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(peer)) return xff.split(',').pop().trim();
  return peer;
}

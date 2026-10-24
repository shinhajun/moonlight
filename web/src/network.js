// Whole-network view built from the catalog: every listing and the home machine behind it.
import { useEffect, useState } from 'react';
import { api, badgeOf, listOf, useEvents } from './api.js';

export function useNetwork({ refresh = 30_000 } = {}) {
  const [net, setNet] = useState({ models: [], listings: [], nodes: [], loading: true, error: null });

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const models = listOf(await api('/api/models'), 'models').filter((m) => !m.auto);
        const details = await Promise.all(models.map((m) => api(`/api/models/${encodeURIComponent(m.id)}`).catch(() => ({ listings: [] }))));
        const listings = details.flatMap((d, i) => (d.listings || []).map((l) => ({ ...l, model_id: l.model_id || models[i].id, private: models[i].private })));
        const byNode = new Map();
        for (const l of listings) {
          const n = byNode.get(l.node.node_id) || { ...l.node, seller: l.seller, models: [], flagged: false };
          n.models.push(l.model_id);
          if (badgeOf(l.verification) === 'flagged') n.flagged = true;
          byNode.set(n.node_id, n);
        }
        if (alive) setNet({ models, listings, nodes: [...byNode.values()], loading: false, error: null });
      } catch (error) {
        if (alive) setNet((s) => ({ ...s, loading: false, error }));
      }
    };
    load();
    const id = setInterval(load, refresh);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [refresh]);

  useEvents((type, d) => {
    if (type === 'node') {
      setNet((s) => {
        const known = s.nodes.some((n) => n.node_id === d.node_id);
        const nodes = known
          ? s.nodes.map((n) => (n.node_id === d.node_id ? { ...n, online: d.online, last_seen: d.ts } : n))
          : [...s.nodes, { node_id: d.node_id, name: d.node_name, gpu: d.gpu, online: d.online, seller: { id: d.seller_id, name: d.seller_name }, models: [], flagged: false }];
        return { ...s, nodes };
      });
    } else if (type === 'verification') {
      setNet((s) => ({
        ...s,
        listings: s.listings.map((l) => (l.listing_id === d.listing_id ? { ...l, verification: { ...l.verification, state: d.state, last_check: d.ts } } : l)),
        nodes: d.state === 'flagged' ? s.nodes.map((n) => (n.node_id === d.node_id ? { ...n, flagged: true } : n)) : s.nodes,
      }));
    }
  });

  return net;
}

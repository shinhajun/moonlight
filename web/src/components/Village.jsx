// The hero scene: home machines on a hillside, the exchange tower that routes work to them,
// and the datacenter factory on the horizon. Live requests travel the wires as parcels.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { usd, useEvents, hardware, clock } from '../api.js';

const H = 360;
const SVGNS = 'http://www.w3.org/2000/svg';

function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function strHash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

// House silhouettes. Coordinates are relative to the bottom-left corner.
const TYPES = [
  { w: 46, body: 'M0 0V-30H46V0Z', roof: 'M-4 -30L23 -52L50 -30Z', chimney: [32, -50, 6, 14], win: [9, -22, 11, 10], win2: [27, -22, 8, 10], apex: [23, -52] },
  { w: 34, body: 'M0 0V-62H34V0Z', roof: 'M-3 -62L17 -80L37 -62Z', chimney: [24, -80, 5, 12], win: [12, -27, 10, 11], win2: [6, -53, 8, 9], win3: [20, -53, 8, 9], apex: [17, -80] },
  { w: 64, body: 'M0 0V-28H64V0Z', roof: 'M-3 -27V-32H67V-27Z', chimney: [48, -45, 7, 13], win: [9, -20, 14, 9], win2: [38, -20, 14, 9], apex: [32, -32] },
  { w: 40, body: 'M0 0V-26H40V0Z', roof: 'M-5 -26L20 -56L45 -26Z', chimney: [8, -48, 6, 16], win: [14, -19, 12, 10], dot: [20, -37, 3.4], apex: [20, -56] },
  { w: 56, body: 'M0 0V-36H56V0Z', roof: 'M-3 -36L6 -52L28 -62L50 -52L59 -36Z', chimney: [40, -64, 6, 12], win: [22, -27, 12, 12], win2: [6, -24, 8, 9], apex: [28, -62] },
];

function buildScene(W) {
  const r = rng(7);
  const narrow = W < 900;
  const s = Math.min(1.3, Math.max(0.7, W / 1150));
  const hs = Math.min(1.75, Math.max(1.2, W / 950));
  const ts = Math.min(1.3, Math.max(1, W / 1200));
  const ground = (x) => 322 - 12 * Math.sin((x / W) * Math.PI * 1.25 + 0.5) - 6 * Math.sin(x / 150);
  const fw = 300 * s;
  const fx = W - fw + 40 * s;
  const exX = Math.round(W * (narrow ? 0.22 : 0.47));
  const houses = [];
  let x = 18 + r() * 14;
  while (x < fx - 70) {
    if (x > exX - 64 * ts && x < exX + 44 * ts) {
      x = exX + 48 * ts;
      continue;
    }
    const type = Math.floor(r() * TYPES.length);
    const T = TYPES[type];
    const k = (0.86 + r() * 0.3) * hs;
    const base = ground(x + (T.w * k) / 2) + 2;
    houses.push({ i: houses.length, x, base, type, k });
    x += T.w * k + 14 + r() * (narrow ? 16 : 34);
  }
  const stars = Array.from({ length: Math.round(W / 26) }, () => ({ x: r() * W, y: 10 + r() * 190, r: r() < 0.15 ? 1.4 : 0.8, tw: r() < 0.2 }));
  const ex = { x: exX, base: ground(exX) + 2, s: ts };
  ex.port = [exX, ex.base - 176 * ts];
  const far = `M0 ${H}V${ground(0) - 46}` + Array.from({ length: 33 }, (_, i) => {
    const px = (i / 32) * W;
    return `L${px.toFixed(1)} ${(ground(px) - 40 - 26 * Math.sin(px / 210 + 1) - 10 * Math.sin(px / 67)).toFixed(1)}`;
  }).join('') + `V${H}Z`;
  const near = `M0 ${H}` + Array.from({ length: 49 }, (_, i) => {
    const px = (i / 48) * W;
    return `L${px.toFixed(1)} ${ground(px).toFixed(1)}`;
  }).join('') + `V${H}Z`;
  const factory = { x: fx, w: fw, s, base: ground(W - fw / 2) + 4 };
  return { W, houses, stars, ex, far, near, factory };
}

// Wire from the tower to a roof, sagging under its own weight.
function wirePath(ex, h) {
  const T = TYPES[h.type];
  const ax = h.x + T.apex[0] * h.k;
  const ay = h.base + T.apex[1] * h.k;
  const [sx, sy] = ex.port;
  const mx = (sx + ax) / 2;
  const sag = 18 + Math.abs(ax - sx) * 0.07;
  return `M${sx} ${sy}Q${mx.toFixed(1)} ${(Math.max(sy, ay) + sag).toFixed(1)} ${ax.toFixed(1)} ${ay.toFixed(1)}`;
}

function HouseShape({ h, node, refCb, onEnter, onLeave }) {
  const T = TYPES[h.type];
  const lit = node?.online;
  const boarded = node?.flagged;
  const [cx, cy, cw, ch] = T.chimney;
  const win = (w, key, main) => w && <rect key={key} className={main ? 'win main' : 'win'} x={w[0]} y={w[1]} width={w[2]} height={w[3]} />;
  return (
    <g
      ref={refCb}
      className={`vh ${node ? 'node' : 'empty'} ${lit ? 'lit' : ''} ${boarded ? 'boarded' : ''}`}
      transform={`translate(${h.x.toFixed(1)} ${h.base.toFixed(1)}) scale(${h.k.toFixed(3)})`}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onClick={onEnter}
      tabIndex={node ? 0 : -1}
      onFocus={onEnter}
      onBlur={onLeave}
      aria-label={node ? `${node.name}: ${hardware(node)}${boarded ? ', flagged' : ''}` : undefined}
      role={node ? 'img' : undefined}
    >
      <rect className="chim" x={cx} y={cy} width={cw} height={ch} />
      <path className="roof" d={T.roof} />
      <path className="body" d={T.body} />
      {win(T.win, 'w', true)}
      {win(T.win2, 'w2')}
      {win(T.win3, 'w3')}
      {T.dot && <circle className="win" cx={T.dot[0]} cy={T.dot[1]} r={T.dot[2]} />}
      {boarded && (
        <g className="planks">
          <path d={`M${T.win[0] - 2} ${T.win[1] - 1}L${T.win[0] + T.win[2] + 2} ${T.win[1] + T.win[3] + 1}`} />
          <path d={`M${T.win[0] + T.win[2] + 2} ${T.win[1] - 1}L${T.win[0] - 2} ${T.win[1] + T.win[3] + 1}`} />
        </g>
      )}
      <g className="fx" data-chim={`${cx + cw / 2},${cy}`} />
    </g>
  );
}

function Tower({ ex }) {
  const { x, base, s } = ex;
  const now = new Date();
  const hA = ((now.getHours() % 12) + now.getMinutes() / 60) * 30;
  const mA = now.getMinutes() * 6;
  return (
    <g className="tower" transform={`translate(${x} ${base}) scale(${s}) translate(${-x} ${-base})`}>
      <path className="body" d={`M${x - 26} ${base}V${base - 138}H${x + 26}V${base}Z`} />
      <path className="body" d={`M${x - 19} ${base - 138}V${base - 176}H${x + 19}V${base - 138}Z`} />
      <path className="roof" d={`M${x - 24} ${base - 176}L${x} ${base - 214}L${x + 24} ${base - 176}Z`} />
      <path className="roof" d={`M${x - 30} ${base - 136}H${x + 30}V${base - 140}H${x - 30}Z`} />
      <circle className="clock" cx={x} cy={base - 157} r="12.5" />
      <g className="hands" transform={`translate(${x} ${base - 157})`}>
        <line x1="0" y1="0" x2="0" y2="-6.5" transform={`rotate(${hA})`} />
        <line x1="0" y1="0" x2="0" y2="-10" transform={`rotate(${mA})`} />
      </g>
      {[-13, 0, 13].map((dx) => (
        <path key={dx} className="win lit-always" d={`M${x + dx - 4} ${base - 92}v-14a4 4 0 0 1 8 0v14z`} />
      ))}
      {[-13, 0, 13].map((dx) => (
        <path key={`b${dx}`} className="win lit-always" d={`M${x + dx - 4} ${base - 44}v-14a4 4 0 0 1 8 0v14z`} />
      ))}
      <text className="scene-label" x={x} y={base + 24} textAnchor="middle">
        the exchange
      </text>
    </g>
  );
}

function Factory({ f }) {
  const { x, w, s, base } = f;
  const h = 118 * s;
  const top = base - h;
  const teeth = 6;
  const tw = w / teeth;
  let roof = `M${x} ${top}`;
  for (let i = 0; i < teeth; i++) roof += `L${x + i * tw} ${top - 22 * s}L${x + (i + 1) * tw} ${top}`;
  roof += 'Z';
  const stacks = [0.16, 0.36, 0.56].map((p, i) => ({ x: x + w * p, top: top - (128 + i * 18) * s, w: 17 * s }));
  const wins = [];
  for (let row = 0; row < 3; row++) for (let c = 0; c < 9; c++) wins.push([x + 16 * s + c * (w - 30 * s) / 9, top + 20 * s + row * 30 * s]);
  return (
    <g className="factory">
      {stacks.map((st, i) => (
        <g key={i}>
          <path className="body" d={`M${st.x} ${top}V${st.top}H${st.x + st.w}V${top}Z`} />
          <rect className="band" x={st.x - 2} y={st.top + 10 * s} width={st.w + 4} height={3.5 * s} />
          {[0, 1, 2].map((k) => (
            <circle key={k} className="smoke" cx={st.x + st.w / 2} cy={st.top - 6} r={14 * s} style={{ animationDelay: `${-(i * 2.3 + k * 2.6)}s` }} />
          ))}
        </g>
      ))}
      <path className="body" d={`M${x} ${base}V${top}H${x + w}V${base}Z`} />
      <path className="body" d={roof} />
      {wins.map(([wx, wy], i) => (
        <rect key={i} className="fwin" x={wx} y={wy} width={13 * s} height={14 * s} />
      ))}
      <text className="scene-label" x={x + w * 0.42} y={base + 24} textAnchor="middle">
        the datacenter
      </text>
    </g>
  );
}

export default function Village({ nodes = [], height = 340 }) {
  const wrap = useRef(null);
  const [W, setW] = useState(1440);
  const [tip, setTip] = useState(null);
  const houseEls = useRef(new Map());
  const wireEls = useRef(new Map());
  const fxLayer = useRef(null);
  const parcels = useRef([]);
  const raf = useRef(0);
  const reduced = useRef(false);

  useLayoutEffect(() => {
    const el = wrap.current;
    const measure = () => setW(Math.round((el.clientWidth * H) / el.clientHeight));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    reduced.current = matchMedia('(prefers-reduced-motion: reduce)').matches;
    return () => ro.disconnect();
  }, []);

  const scene = useMemo(() => buildScene(W), [W]);

  // Stable node → house assignment by hashed id, so a node keeps its house across reloads.
  const assignment = useMemo(() => {
    const map = new Map();
    const free = new Set(scene.houses.map((h) => h.i));
    const order = [...nodes].sort((a, b) => strHash(a.node_id) - strHash(b.node_id));
    const n = scene.houses.length;
    for (const node of order) {
      if (!free.size) break;
      let slot = strHash(node.node_id + 'slot') % n;
      while (!free.has(slot)) slot = (slot + 1) % n;
      free.delete(slot);
      map.set(slot, node);
    }
    return map;
  }, [nodes, scene]);
  const slotOf = useMemo(() => new Map([...assignment].map(([slot, node]) => [node.node_id, slot])), [assignment]);

  const step = () => {
    const t = performance.now();
    parcels.current = parcels.current.filter((p) => {
      const k = Math.min(1, (t - p.start) / p.dur);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      const pt = p.path.getPointAtLength(e * p.len);
      p.el.setAttribute('transform', `translate(${pt.x.toFixed(1)} ${pt.y.toFixed(1)})`);
      if (k >= 1) {
        p.el.remove();
        p.done();
        return false;
      }
      return true;
    });
    raf.current = parcels.current.length ? requestAnimationFrame(step) : 0;
  };

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const spawn = (parent, tag, attrs, life) => {
    const el = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    parent.appendChild(el);
    setTimeout(() => el.remove(), life);
    return el;
  };

  const arrive = (slot, d) => {
    const g = houseEls.current.get(slot);
    if (!g) return;
    const fx = g.querySelector('.fx');
    const [cx, cy] = fx.dataset.chim.split(',').map(Number);
    g.dataset.working = '1';
    clearTimeout(g._t);
    g._t = setTimeout(() => delete g.dataset.working, Math.min(2600, Math.max(900, d.latency_ms || 900)));
    if (!reduced.current) {
      for (let i = 0; i < 3; i++) spawn(fx, 'circle', { class: 'puff', cx, cy: cy - 2, r: 4 + i, style: `animation-delay:${i * 260}ms` }, 2600);
      const coin = spawn(fx, 'text', { class: 'coin', x: cx - 6, y: -70, 'text-anchor': 'middle' }, 2000);
      coin.textContent = `+${usd(d.cost_microusd)}`;
    }
  };

  useEvents((type, d) => {
    if (type === 'request') {
      const slot = slotOf.get(d.node_id);
      if (slot == null) return;
      const path = wireEls.current.get(slot);
      if (!path || reduced.current || document.hidden || parcels.current.length > 24) return arrive(slot, d);
      const el = spawn(fxLayer.current, 'circle', { class: 'parcel', r: 3.4 }, 4000);
      const len = path.getTotalLength();
      parcels.current.push({ el, path, len, start: performance.now(), dur: 650 + len * 0.9, done: () => arrive(slot, d) });
      if (!raf.current) raf.current = requestAnimationFrame(step);
    } else if (type === 'verification') {
      const slot = slotOf.get(d.node_id);
      const g = slot != null && houseEls.current.get(slot);
      if (!g || reduced.current) return;
      const fx = g.querySelector('.fx');
      const T = TYPES[scene.houses[slot].type];
      const mark = spawn(fx, 'text', { class: `vmark ${d.passed ? 'pass' : 'fail'}`, x: T.apex[0], y: T.apex[1] - 10, 'text-anchor': 'middle' }, 2400);
      mark.textContent = d.passed ? '✓' : '✕';
    }
  });

  const showTip = (slot) => () => {
    const node = assignment.get(slot);
    const g = houseEls.current.get(slot);
    if (!node || !g) return;
    const box = g.getBoundingClientRect();
    const host = wrap.current.getBoundingClientRect();
    setTip({ node, x: box.left - host.left + box.width / 2, y: box.top - host.top });
  };

  return (
    <div className="village" ref={wrap} style={{ '--vh': `${height}px` }}>
      <svg viewBox={`0 0 ${scene.W} ${H}`} preserveAspectRatio="xMidYMax meet" role="img" aria-label={`Live map: ${nodes.filter((n) => n.online).length} home machines online around the Moonlight exchange`}>
        <g className="stars">
          {scene.stars.map((st, i) => (
            <circle key={i} cx={st.x} cy={st.y} r={st.r} className={st.tw ? 'tw' : ''} style={st.tw ? { animationDelay: `${(i % 7) * 0.6}s` } : undefined} />
          ))}
        </g>
        <path className="hill-far" d={scene.far} />
        <Factory f={scene.factory} />
        <g className="wires">
          {scene.houses.map((h) =>
            assignment.has(h.i) ? (
              <path key={h.i} d={wirePath(scene.ex, h)} ref={(el) => (el ? wireEls.current.set(h.i, el) : wireEls.current.delete(h.i))} />
            ) : null,
          )}
        </g>
        <path className="hill" d={scene.near} />
        <Tower ex={scene.ex} />
        {scene.houses.map((h) => (
          <HouseShape
            key={h.i}
            h={h}
            node={assignment.get(h.i)}
            refCb={(el) => (el ? houseEls.current.set(h.i, el) : houseEls.current.delete(h.i))}
            onEnter={showTip(h.i)}
            onLeave={() => setTip(null)}
          />
        ))}
        <g ref={fxLayer} className="fxlayer" />
      </svg>
      {tip && (
        <div className="village-tip" style={{ left: tip.x, top: tip.y }} role="status">
          <b>{tip.node.name}</b>
          <span>{hardware(tip.node)}</span>
          {tip.node.models?.length > 0 && <span className="tip-models">{tip.node.models.join(' · ')}</span>}
          {tip.node.flagged ? <span className="tip-flag">Flagged · boarded up</span> : !tip.node.online && <span>Offline since {clock(tip.node.last_seen || Date.now())}</span>}
        </div>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { ago } from '../api.js';

// ---------------------------------------------------------------- icons

// Rosette seal: a notched circle, like the stamp on an inspection certificate.
const seal = (() => {
  const pts = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const r = i % 2 ? 7 : 8;
    pts.push(`${(8 + r * Math.cos(a)).toFixed(2)},${(8 + r * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
})();

export function Icon({ name, size = 16, ...rest }) {
  const common = { width: size, height: size, viewBox: '0 0 16 16', 'aria-hidden': true, ...rest };
  switch (name) {
    case 'verified':
      return (
        <svg {...common}>
          <path d={seal} fill="currentColor" />
          <path d="M5 8.2l2 2 4-4.3" fill="none" stroke="var(--badge-ink, var(--bg))" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'consistent':
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M4.8 6.4h6.4M4.8 9.6h6.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case 'new':
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.4 2" />
          <circle cx="8" cy="8" r="1.8" fill="currentColor" />
        </svg>
      );
    case 'flagged':
      return (
        <svg {...common}>
          <path d="M8 1.2l7 12.6H1z" fill="currentColor" />
          <path d="M8 5.6v4M8 11.6v.4" stroke="var(--badge-ink, var(--bg))" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );
    case 'copy':
      return (
        <svg {...common}>
          <rect x="5" y="5" width="8.5" height="8.5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M3 10.5V3.2c0-.4.3-.7.7-.7H10" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      );
    case 'check':
      return (
        <svg {...common}>
          <path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'arrow':
      return (
        <svg {...common}>
          <path d="M2 8h11M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'eye':
      return (
        <svg {...common}>
          <path d="M1 8s2.6-4.8 7-4.8S15 8 15 8s-2.6 4.8-7 4.8S1 8 1 8z" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <circle cx="8" cy="8" r="2.1" fill="currentColor" />
        </svg>
      );
    case 'pause':
      return (
        <svg {...common}>
          <path d="M5.5 3.5v9M10.5 3.5v9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case 'play':
      return (
        <svg {...common}>
          <path d="M5 3.2v9.6L12.6 8z" fill="currentColor" />
        </svg>
      );
    default:
      return null;
  }
}

// ---------------------------------------------------------------- verification badge

const BADGE = {
  verified: { label: 'Verified', tip: 'Passed hidden test jobs against a reference machine. No failures in the last 10 checks.' },
  consistent: { label: 'Consistent', tip: 'Private model, so there is no reference to compare to. Gives the same answer to the same question, with steady uptime.' },
  new: { label: 'New', tip: 'Fewer than 3 checks so far. Not yet verified.' },
  flagged: { label: 'Flagged', tip: 'Failed 2 or more of the last 10 checks. Suspended, and its earnings are held.' },
};

export function Badge({ state = 'new', verification, size = 'md', withTip = true }) {
  const b = BADGE[state] || BADGE.new;
  const detail = verification ? ` ${verification.passed ?? 0} passed · ${verification.failed ?? 0} failed · last check ${ago(verification.last_check)}.` : '';
  return (
    <span className={`badge badge-${state} badge-${size}`} title={withTip ? b.tip + detail : undefined}>
      <Icon name={state} size={size === 'lg' ? 18 : 14} />
      {b.label}
    </span>
  );
}

export const BADGE_COPY = BADGE;

// Last 10 checks as a strip of ticks, oldest to newest. Reads like a punch card.
export function CheckStrip({ recent }) {
  if (!recent?.length) return null;
  const cells = recent.slice(-10);
  while (cells.length < 10) cells.unshift(null);
  return (
    <span className="checkstrip" aria-label={`${recent.filter(Boolean).length} of last ${recent.length} checks passed`}>
      {cells.map((c, i) => (
        <i key={i} className={c == null ? 'none' : c ? 'pass' : 'fail'} />
      ))}
    </span>
  );
}

// ---------------------------------------------------------------- odometer

// Rolling drum digits. Each character keeps its position counted from the right so drums persist.
export function Odometer({ value, className = '' }) {
  const chars = String(value).split('');
  return (
    <span className={`odo ${className}`} aria-label={value} role="text">
      {chars.map((ch, i) => {
        const key = chars.length - i;
        if (!/\d/.test(ch)) return <span key={`s${key}`} className="odo-sep" aria-hidden>{ch}</span>;
        return (
          <span key={`d${key}`} className="odo-cell" aria-hidden>
            <span className="odo-drum" style={{ transform: `translateY(${-Number(ch) * 10}%)` }}>
              {'0123456789'.split('').map((d) => (
                <span key={d}>{d}</span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}

// Interpolates toward a target so counters climb smoothly between events.
export function useTween(target, ms = 900) {
  const [v, setV] = useState(target);
  const from = useRef(target);
  const raf = useRef(0);
  useEffect(() => {
    if (target == null) return;
    const start = performance.now();
    const a = from.current ?? target;
    cancelAnimationFrame(raf.current);
    const step = (t) => {
      const k = Math.min(1, (t - start) / ms);
      const e = 1 - Math.pow(1 - k, 4);
      const cur = a + (target - a) * e;
      from.current = cur;
      setV(cur);
      if (k < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [target, ms]);
  return v;
}

// ---------------------------------------------------------------- gauges

// Pressure gauge for a 0–100 reputation score.
export function RepGauge({ value = 0, size = 34 }) {
  const a = Math.PI * (1 - Math.max(0, Math.min(100, value)) / 100);
  const x = 20 + 13 * Math.cos(a);
  const y = 21 - 13 * Math.sin(a);
  const tone = value >= 80 ? 'good' : value >= 50 ? 'mid' : 'bad';
  return (
    <span className={`repgauge rep-${tone}`} title={`Reputation ${value} / 100`}>
      <svg width={size} height={size * 0.62} viewBox="0 0 40 25" aria-hidden>
        <path d="M4 21a16 16 0 0 1 32 0" fill="none" stroke="var(--rule-strong)" strokeWidth="3" />
        <path d="M4 21a16 16 0 0 1 32 0" fill="none" stroke="currentColor" strokeWidth="3" pathLength="100" strokeDasharray={`${value} 100`} />
        <line x1="20" y1="21" x2={x} y2={y} stroke="var(--ink)" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="20" cy="21" r="2.2" fill="var(--ink)" />
      </svg>
      <b>{value}</b>
    </span>
  );
}

// Share of live sellers that are verified, as a row of rivets.
export function VerifiedRivets({ share = 0, total = 0 }) {
  const n = Math.max(1, Math.min(total || 1, 12));
  const ok = Math.round(share * n);
  return (
    <span className="rivets" aria-label={`${Math.round(share * 100)}% of sellers verified`}>
      {Array.from({ length: n }, (_, i) => (
        <i key={i} className={i < ok ? 'on' : ''} />
      ))}
    </span>
  );
}

// ---------------------------------------------------------------- copy box

export function CopyBox({ code, label, step, lang = 'sh', compact = false }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      const t = document.createElement('textarea');
      t.value = code;
      document.body.appendChild(t);
      t.select();
      document.execCommand('copy');
      t.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <div className={`copybox ${compact ? 'compact' : ''}`}>
      {(label || step) && (
        <div className="copybox-head">
          {step && <span className="copybox-step">{step}</span>}
          <span>{label}</span>
          <span className="copybox-lang">{lang}</span>
        </div>
      )}
      <div className="copybox-body">
        <pre>
          <code>{code}</code>
        </pre>
        <button type="button" className={`copybtn ${copied ? 'done' : ''}`} onClick={copy} aria-label={copied ? 'Copied' : 'Copy to clipboard'}>
          <Icon name={copied ? 'check' : 'copy'} size={15} />
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- small house glyph

export function House({ lit = false, boarded = false, size = 18, title }) {
  return (
    <svg className={`house ${lit ? 'lit' : ''} ${boarded ? 'boarded' : ''}`} width={size} height={size} viewBox="0 0 18 18" aria-hidden={!title} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      <path d="M2 8.2L9 2l7 6.2V16H2z" fill="currentColor" />
      <rect x="11.8" y="2.6" width="2.2" height="3.6" fill="currentColor" />
      <rect className="win" x="6.2" y="9" width="5.6" height="4.4" />
      {boarded && <path d="M5.4 8.6l7.2 5.2M12.6 8.6l-7.2 5.2" stroke="var(--oxide)" strokeWidth="1.6" />}
    </svg>
  );
}

export function LiveDot({ status = 'live', label }) {
  return (
    <span className={`livedot ${status}`}>
      <i />
      {label ?? (status === 'live' ? 'Live' : status === 'reconnecting' ? 'Reconnecting' : 'Connecting')}
    </span>
  );
}

export function Stamp({ children, small = false }) {
  return <span className={`stamp ${small ? 'small' : ''}`}>{children}</span>;
}

// Re-renders every `ms` so relative times stay fresh.
export function useNow(ms = 5000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

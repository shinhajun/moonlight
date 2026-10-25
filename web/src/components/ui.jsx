import { useEffect, useRef, useState } from 'react';
import { ago } from '../api.js';

// ---------------------------------------------------------------- icons (16px grid, 1.5 stroke)

const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' };

export function Icon({ name, size = 16, ...rest }) {
  const common = { width: size, height: size, viewBox: '0 0 16 16', 'aria-hidden': true, ...rest };
  switch (name) {
    case 'verified':
      return (
        <svg {...common}>
          <path {...P} d="M8 1.5l1.7 1.2 2.1-.1.6 2 1.7 1.3-.7 2 .7 2-1.7 1.3-.6 2-2.1-.1L8 14.5l-1.7-1.2-2.1.1-.6-2-1.7-1.3.7-2-.7-2 1.7-1.3.6-2 2.1.1z" />
          <path {...P} d="M5.6 8.2l1.6 1.6 3.2-3.4" />
        </svg>
      );
    case 'consistent':
      return (
        <svg {...common}>
          <circle {...P} cx="8" cy="8" r="6.2" />
          <path {...P} d="M5.2 6.6h5.6M5.2 9.4h5.6" />
        </svg>
      );
    case 'new':
      return (
        <svg {...common}>
          <circle {...P} cx="8" cy="8" r="6.2" strokeDasharray="2.2 2" />
          <circle cx="8" cy="8" r="1.7" fill="currentColor" />
        </svg>
      );
    case 'flagged':
      return (
        <svg {...common}>
          <path {...P} d="M8 2L14.5 13.5h-13z" />
          <path {...P} d="M8 6.3v3.3M8 11.6v.2" />
        </svg>
      );
    case 'copy':
      return (
        <svg {...common}>
          <rect {...P} x="5" y="5" width="8.5" height="8.5" rx="1.5" />
          <path {...P} d="M3 10.5V3.8C3 3.1 3.6 2.5 4.3 2.5H11" />
        </svg>
      );
    case 'check':
      return (
        <svg {...common}>
          <path {...P} d="M3 8.5l3.2 3L13 4.5" strokeWidth="1.8" />
        </svg>
      );
    case 'arrow':
      return (
        <svg {...common}>
          <path {...P} d="M3 8h10M9 4l4 4-4 4" />
        </svg>
      );
    case 'eye':
      return (
        <svg {...common}>
          <path {...P} d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
          <circle {...P} cx="8" cy="8" r="2" />
        </svg>
      );
    case 'gpu':
      return (
        <svg {...common}>
          <rect {...P} x="1.5" y="4" width="13" height="7" rx="1.2" />
          <circle {...P} cx="5.5" cy="7.5" r="1.8" />
          <circle {...P} cx="10.5" cy="7.5" r="1.8" />
          <path {...P} d="M3 11v1.6M5 11v1.6M7 11v1.6" />
        </svg>
      );
    case 'bolt':
      return (
        <svg {...common}>
          <path {...P} d="M9 1.5L3.5 9h4L7 14.5 12.5 7h-4z" />
        </svg>
      );
    case 'shield':
      return (
        <svg {...common}>
          <path {...P} d="M8 1.8l5 1.9v4c0 3.1-2.1 5.4-5 6.5-2.9-1.1-5-3.4-5-6.5v-4z" />
          <path {...P} d="M5.8 8l1.5 1.5L10.4 6.4" />
        </svg>
      );
    case 'code':
      return (
        <svg {...common}>
          <path {...P} d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5" />
        </svg>
      );
    case 'chat':
      return (
        <svg {...common}>
          <path {...P} d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" />
        </svg>
      );
    case 'sun':
      return (
        <svg {...common}>
          <circle {...P} cx="8" cy="8" r="2.8" />
          <path {...P} d="M8 1.5v1.3M8 13.2v1.3M1.5 8h1.3M13.2 8h1.3M3.4 3.4l.9.9M11.7 11.7l.9.9M3.4 12.6l.9-.9M11.7 4.3l.9-.9" />
        </svg>
      );
    case 'moon':
      return (
        <svg {...common}>
          <path {...P} d="M13.2 10.1A5.8 5.8 0 0 1 5.9 2.8a5.8 5.8 0 1 0 7.3 7.3z" />
        </svg>
      );
    case 'pause':
      return (
        <svg {...common}>
          <path {...P} d="M5.5 3.5v9M10.5 3.5v9" strokeWidth="2" />
        </svg>
      );
    case 'pencil':
      return (
        <svg {...common}>
          <path {...P} d="M10.5 3l2.5 2.5L6 12.5l-3 .5.5-3z" />
        </svg>
      );
    case 'retry':
      return (
        <svg {...common}>
          <path {...P} d="M13 8a5 5 0 1 1-1.5-3.6" />
          <path {...P} d="M13 2.5v3h-3" />
        </svg>
      );
    case 'down':
      return (
        <svg {...common}>
          <path {...P} d="M8 3v10M4 9l4 4 4-4" />
        </svg>
      );
    case 'search':
      return (
        <svg {...common}>
          <circle {...P} cx="7" cy="7" r="4.5" />
          <path {...P} d="M10.5 10.5L14 14" />
        </svg>
      );
    default:
      return null;
  }
}

// ---------------------------------------------------------------- verification badge

const BADGE = {
  verified: { label: 'Verified', tip: 'We secretly test this seller all the time, and it passed every recent test.' },
  consistent: { label: 'Consistent', tip: 'One of a kind, so there is nothing to compare it to. We check that it answers the same way every time and stays online.' },
  new: { label: 'New', tip: 'Just joined. Not enough tests yet to say either way.' },
  flagged: { label: 'Flagged', tip: 'Caught failing our tests. Blocked from new work, and its pay is frozen.' },
};

export function Badge({ state = 'new', verification, size = 'md', withTip = true }) {
  const b = BADGE[state] || BADGE.new;
  const detail = verification?.passed != null ? ` ${verification.passed} passed · ${verification.failed ?? 0} failed · last check ${ago(verification.last_check)}.` : '';
  return (
    <span className={`badge badge-${state} badge-${size}`} title={withTip ? b.tip + detail : undefined}>
      <Icon name={state} size={size === 'lg' ? 16 : 13} />
      {b.label}
    </span>
  );
}

export const BADGE_COPY = BADGE;

// Last 10 checks as ticks, oldest to newest.
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

// ---------------------------------------------------------------- numbers

// Digits roll into place; each keeps its position counted from the right so it animates in place.
export function RollingNumber({ value, className = '' }) {
  const chars = String(value).split('');
  return (
    <span className={`roll ${className}`} aria-label={value} role="text">
      {chars.map((ch, i) => {
        const key = chars.length - i;
        if (!/\d/.test(ch)) return <span key={`s${key}`} className="roll-sep" aria-hidden>{ch}</span>;
        return (
          <span key={`d${key}`} className="roll-cell" aria-hidden>
            <span className="roll-drum" style={{ transform: `translateY(${-Number(ch) * 10}%)` }}>
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

// Eases toward a target so counters climb smoothly between updates.
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
      const cur = a + (target - a) * (1 - Math.pow(1 - k, 4));
      from.current = cur;
      setV(cur);
      if (k < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [target, ms]);
  return v;
}

// ---------------------------------------------------------------- meters

// Reputation 0–100 as a slim bar with its number.
export function RepMeter({ value = 0 }) {
  const tone = value >= 80 ? 'good' : value >= 50 ? 'mid' : 'bad';
  return (
    <span className={`rep rep-${tone}`} title={`Reputation ${value} / 100`}>
      <span className="rep-bar" aria-hidden>
        <span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </span>
      <b className="num">{value}</b>
    </span>
  );
}

// Share of live sellers that are verified, as segments.
export function ShareBar({ share = 0, total = 0 }) {
  const n = Math.max(1, Math.min(total || 1, 10));
  const ok = Math.round(share * n);
  return (
    <span className="sharebar" aria-label={`${Math.round(share * 100)}% of sellers verified`}>
      {Array.from({ length: n }, (_, i) => (
        <i key={i} className={i < ok ? 'on' : ''} />
      ))}
    </span>
  );
}

// ---------------------------------------------------------------- copy box

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = document.createElement('textarea');
    t.value = text;
    document.body.appendChild(t);
    t.select();
    document.execCommand('copy');
    t.remove();
  }
}

// A copy action that flips to a check for a moment.
export function useCopied() {
  const [copied, setCopied] = useState(false);
  const copy = async (text) => {
    await copyText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return [copied, copy];
}

export function CopyBox({ code, label, step, lang = 'sh', compact = false }) {
  const [copied, copyCode] = useCopied();
  const copy = () => copyCode(code);
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
          <Icon name={copied ? 'check' : 'copy'} size={14} />
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- machine glyph

// A GPU in a rounded tile, with a status dot: online, offline or flagged.
export function Machine({ online = false, flagged = false, size = 32, title }) {
  const state = flagged ? 'flagged' : online ? 'online' : 'offline';
  return (
    <span className={`machine machine-${state}`} style={{ '--m': `${size}px` }} title={title} role={title ? 'img' : undefined} aria-label={title}>
      <Icon name="gpu" size={Math.round(size * 0.56)} />
      <i aria-hidden />
    </span>
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

// Re-renders every `ms` so relative times stay fresh.
export function useNow(ms = 5000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

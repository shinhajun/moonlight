// Minimal history router. The gateway serves index.html for unknown paths (SPA fallback).
import { useSyncExternalStore } from 'react';

const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());
if (typeof window !== 'undefined') window.addEventListener('popstate', notify);

export function navigate(to, { replace = false } = {}) {
  if (to === location.pathname + location.search) return;
  history[replace ? 'replaceState' : 'pushState'](null, '', to);
  notify();
  if (!to.includes('#')) window.scrollTo({ top: 0 });
}

export function usePath() {
  return useSyncExternalStore(
    (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    () => location.pathname,
  );
}

export function Link({ to, children, onClick, ...rest }) {
  return (
    <a
      href={to}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        navigate(to);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}

export const modelPath = (id) => `/models/${id.split('/').map((s) => encodeURIComponent(s).replace(/%3A/gi, ':')).join('/')}`;

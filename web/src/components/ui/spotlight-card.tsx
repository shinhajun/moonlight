import { useEffect, useRef, type ReactNode } from 'react';

interface GlowCardProps {
  children?: ReactNode;
  className?: string;
  glowColor?: 'blue' | 'purple' | 'green' | 'red';
}

// A card whose border and backdrop light up under the pointer. Size it with className; colors and the glow layers live in ui.css (.glow-card).
export function GlowCard({ children, className = '', glowColor = 'blue' }: GlowCardProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sync = (e: PointerEvent) => {
      const el = ref.current;
      if (!el) return;
      // Card-relative, not background-attachment: fixed, which breaks under a transformed ancestor (.page-enter) and on iOS.
      const r = el.getBoundingClientRect();
      el.style.setProperty('--x', (e.clientX - r.left).toFixed(2));
      el.style.setProperty('--y', (e.clientY - r.top).toFixed(2));
      el.style.setProperty('--xp', (e.clientX / window.innerWidth).toFixed(2));
    };
    document.addEventListener('pointermove', sync);
    return () => document.removeEventListener('pointermove', sync);
  }, []);

  return (
    <div ref={ref} className={`glow-card glow-${glowColor} ${className}`}>
      <div className="glow-blur" aria-hidden />
      {children}
    </div>
  );
}

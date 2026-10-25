import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import { useTween } from '../ui.jsx';

// A big number that counts up to its value once the card scrolls into view, a title, and a footer: an icon chip
// with a note. With `change` (a percent against an earlier period) the chip turns into a green or red trend, so
// only pass it when there is a real earlier figure to compare with. Styles live in ui.css (.stat-card).

interface StatCardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title: string;
  value: number;
  format?: (n: number) => string;
  suffix?: string;
  icon?: ReactNode;
  note?: ReactNode;
  change?: number;
  changeDescription?: string;
}

const int = (n: number) => Math.round(n).toLocaleString('en-US');

export function StatCard({ title, value, format = int, suffix, icon, note, change, changeDescription, className = '', ...rest }: StatCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => e.isIntersecting && (setSeen(true), io.disconnect()), { threshold: 0.4 });
    io.observe(ref.current!);
    return () => io.disconnect();
  }, []);
  const shown = useTween(seen ? value : 0, 1400);
  const trend = change == null ? null : change >= 0 ? 'up' : 'down';
  // Screen readers get the final value, not the count-up; the footer stays readable (it can hold links).
  return (
    <div ref={ref} className={`stat-card ${className}`} {...rest}>
      <p className="stat-card-value num">
        <span aria-hidden>
          {format(shown)}
          {suffix && <span className="stat-card-suffix">{suffix}</span>}
        </span>
        <span className="sr-only">{`${format(value)}${suffix ?? ''}`}</span>
      </p>
      <p className="stat-card-title">{title}</p>
      {(icon || note || trend) && (
        <div className="stat-card-foot">
          {(icon || trend) && (
            <span className={`stat-card-chip ${trend ?? ''}`} aria-hidden>
              {icon}
            </span>
          )}
          <p>
            {trend && (
              <b className={`stat-card-change ${trend}`}>
                {change! > 0 ? '+' : ''}
                {change}%
              </b>
            )}
            {trend ? ` from ${changeDescription}` : note}
          </p>
        </div>
      )}
    </div>
  );
}

import { useEffect, useState, useRef } from 'react';

interface Props {
  to: number;
  /** Total duration of the count-up animation, in ms. */
  duration?: number;
  /** Decimal places to render. Default 0. */
  decimals?: number;
  /** Optional prefix (e.g. "₹") and suffix (e.g. "%"). */
  prefix?: string;
  suffix?: string;
  /** className applied to the wrapping span. */
  className?: string;
}

// easeOutCubic — fast start, gentle finish, feels alive without overshooting
const ease = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Animates a number from 0 → `to` on mount. When `to` changes later,
 * re-runs the animation from the previous value to the new value.
 */
export default function CountUp({ to, duration = 900, decimals = 0, prefix = '', suffix = '', className = '' }: Props) {
  const [value, setValue] = useState(0);
  const startRef = useRef<number | null>(null);
  const fromRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!Number.isFinite(to)) { setValue(to); return; }
    fromRef.current = value;
    startRef.current = null;
    const tick = (ts: number) => {
      if (startRef.current === null) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const t = Math.min(elapsed / duration, 1);
      const eased = ease(t);
      const next = fromRef.current + (to - fromRef.current) * eased;
      setValue(next);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to, duration]);

  const display = decimals > 0 ? value.toFixed(decimals) : Math.round(value).toLocaleString('en-IN');
  return <span className={className}>{prefix}{display}{suffix}</span>;
}

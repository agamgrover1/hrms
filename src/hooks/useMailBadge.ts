import { useEffect, useState } from 'react';

// Global "new mail arrived while you weren't looking" badge count.
// Set by the Mail page's mail stream listener; consumed by the
// Sidebar to render a red dot on the Mail entry. Also cleared when
// the user actually opens Mail (Mail.tsx calls resetMailBadge on
// mount + on refresh).
//
// Kept as a tiny module-scope store so we don't need a full context
// provider — every subscriber gets pushed updates via a set of
// listeners.

let count = 0;
const listeners = new Set<(n: number) => void>();

function emit() { for (const l of listeners) l(count); }

export function bumpMailBadge(by = 1) { count = Math.max(0, count + by); emit(); }
export function resetMailBadge() { if (count !== 0) { count = 0; emit(); } }

export function useMailBadge(): number {
  const [n, setN] = useState(count);
  useEffect(() => {
    listeners.add(setN);
    setN(count);
    return () => { listeners.delete(setN); };
  }, []);
  return n;
}

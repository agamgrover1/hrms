import { useEffect, useRef } from 'react';

// Page-level refresh helper. Calls the provided refetch on:
//   1. Tab focus (window 'focus' event)
//   2. Tab visibility regained ('visibilitychange' → visible)
//   3. Mount, if opts.initial is true (most callers do their own mount
//      fetch via a separate useEffect, so this is opt-in)
//
// The polling interval was REMOVED. Each tick used to be a fetch() →
// edge request, and at 40 users × multiple tabs × 8h workday it was
// dominating the Vercel edge-request quota. The two event listeners
// catch every realistic "I just came back to this tab" case — for a
// dashboard / list page that's plenty of freshness.
//
// `intervalMs` is accepted-but-ignored for backwards compatibility so
// existing callers don't break. If you ever genuinely need polling
// somewhere, use a dedicated setInterval inline and accept the cost.
//
// `enabled: false` skips both listeners — useful for SPA tabs that
// aren't currently visible inside the page.
//
// Pass a stable refetch (useCallback or module-level function) so the
// effect doesn't tear down + reattach on every render.

export function useLiveRefresh(
  refetch: () => void,
  opts: { intervalMs?: number; enabled?: boolean; initial?: boolean } = {}
) {
  const { enabled = true, initial = false } = opts;
  const refetchRef = useRef(refetch);
  useEffect(() => { refetchRef.current = refetch; }, [refetch]);

  useEffect(() => {
    if (!enabled) return;
    if (initial) refetchRef.current();
    const onFocus = () => refetchRef.current();
    const onVisible = () => { if (document.visibilityState === 'visible') refetchRef.current(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, initial]);
}

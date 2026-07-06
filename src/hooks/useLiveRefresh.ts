import { useEffect, useRef } from 'react';

// Page-level refresh helper. Calls the provided refetch on:
//   1. Tab focus (window 'focus' event)
//   2. Tab visibility regained ('visibilitychange' → visible)
//   3. Mount, if opts.initial is true (most callers do their own mount
//      fetch via a separate useEffect, so this is opt-in)
//
// Throttled — if `throttleMs` (default 60s) hasn't elapsed since the
// previous refetch, the incoming focus/visibility event is dropped.
// Someone flipping between Chrome tabs 20× an hour used to trigger 20
// refetches per page × N pages open; the same activity now fires at
// most once per throttle window. The "came back after coffee / lunch"
// case (which is what freshness is actually for) is well past the
// window and still hits the network.
//
// The polling interval was REMOVED. Each tick used to be a fetch() →
// edge request, and at 40 users × multiple tabs × 8h workday it was
// dominating the Vercel edge-request quota.
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
  opts: { intervalMs?: number; enabled?: boolean; initial?: boolean; throttleMs?: number } = {}
) {
  const { enabled = true, initial = false, throttleMs = 60_000 } = opts;
  const refetchRef = useRef(refetch);
  const lastFiredRef = useRef(0);
  useEffect(() => { refetchRef.current = refetch; }, [refetch]);

  useEffect(() => {
    if (!enabled) return;
    // Fires if the throttle window has elapsed since the last hit.
    // Anchor the timestamp on both mount-initial and every accepted
    // focus/visibility event.
    const maybeFire = () => {
      const now = Date.now();
      if (now - lastFiredRef.current < throttleMs) return;
      lastFiredRef.current = now;
      refetchRef.current();
    };
    if (initial) { lastFiredRef.current = Date.now(); refetchRef.current(); }
    const onFocus = () => maybeFire();
    const onVisible = () => { if (document.visibilityState === 'visible') maybeFire(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, initial, throttleMs]);
}

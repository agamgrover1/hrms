import { useEffect, useRef } from 'react';

// Page-level "feels live" helper. Calls the provided refetch:
//   1. Immediately on mount (most callers also do this themselves — safe
//      to omit the initial call here if it would double-fetch).
//   2. On a polling interval (default 45s — was 12s, which was burning
//      Vercel Active CPU on every signed-in tab. The focus +
//      visibilitychange handlers below mean returning to the tab still
//      refetches instantly, so the only delay is for users who STAY on
//      the same tab for 45s — fine for the surfaces that use this).
//   3. The moment the tab regains focus / visibility (via the focus +
//      visibilitychange events). If the user was on a different tab for
//      five minutes, they get fresh state IMMEDIATELY on return — no
//      "wait for the next poll" pause.
//
// Pass a stable refetch (useCallback or a module-level function) so the
// effect doesn't tear down + reattach on every render.
//
// Skip the poll entirely by passing `enabled: false` — useful for tabs
// that aren't currently visible inside the page (a SPA tab switcher), so
// background pages don't waste cycles.

export function useLiveRefresh(
  refetch: () => void,
  opts: { intervalMs?: number; enabled?: boolean; initial?: boolean } = {}
) {
  const { intervalMs = 45000, enabled = true, initial = false } = opts;
  const refetchRef = useRef(refetch);
  // Keep the latest callback without re-subscribing the effect each render.
  useEffect(() => { refetchRef.current = refetch; }, [refetch]);

  useEffect(() => {
    if (!enabled) return;
    if (initial) refetchRef.current();
    const id = window.setInterval(() => refetchRef.current(), intervalMs);
    const onFocus = () => refetchRef.current();
    const onVisible = () => { if (document.visibilityState === 'visible') refetchRef.current(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, intervalMs, initial]);
}

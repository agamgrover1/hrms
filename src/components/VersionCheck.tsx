import { useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';

// In-app "a new version is live, reload to get it" banner.
//
// Vite bakes the build's git commit SHA into __APP_VERSION__ via the
// `define` block in vite.config.ts. The serverless API exposes the same
// SHA at GET /api/version (Vercel's VERCEL_GIT_COMMIT_SHA env var). We
// poll once a minute, plus on tab focus, and surface a sticky banner the
// moment they diverge — that's the user's signal that a deploy went out
// past what their tab is running. One-click Refresh forces a hard reload
// (`location.reload()` re-fetches index.html which pulls the new bundle
// hashes). The "Maybe later" close just hides the banner — next mismatch
// detection re-shows it, so we never permanently silence an update.
//
// We deliberately avoid auto-reloading. Users in the middle of typing a
// leave reason or filing an hour log shouldn't have the tab yanked out
// from under them. Show + let them choose.

const POLL_MS = 60_000;

export default function VersionCheck() {
  const [stale, setStale] = useState(false);
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const baked = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : null;
    if (!baked || baked === 'dev' || baked.startsWith('dev-')) return; // skip in dev

    const check = async () => {
      try {
        const r = await fetch('/api/version', { cache: 'no-store' });
        if (!r.ok) return;
        const j = await r.json() as { version?: string };
        if (cancelled) return;
        const live = j?.version;
        if (!live || live === 'dev') return;
        if (live !== baked && live !== dismissedFor) setStale(true);
      } catch {/* network blip — try again next tick */}
    };

    check();
    const id = window.setInterval(check, POLL_MS);
    // Re-check when the tab regains focus; an open tab left overnight is
    // exactly the case that benefits most from this prompt.
    const onFocus = () => check();
    window.addEventListener('focus', onFocus);

    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [dismissedFor]);

  if (!stale) return null;

  const reload = () => {
    // Force a fresh network fetch of index.html so the cached SPA shell
    // gets replaced by the deploy that's actually live.
    window.location.reload();
  };
  const dismiss = async () => {
    // Stash the live version we just saw so we don't re-pop the banner
    // until something newer than THAT lands.
    try {
      const r = await fetch('/api/version', { cache: 'no-store' });
      const j = await r.json() as { version?: string };
      setDismissedFor(j?.version ?? null);
    } catch {/* fine — banner reappears next check */}
    setStale(false);
  };

  return (
    <div className="fixed bottom-4 right-4 z-[100] max-w-sm animate-fade-up">
      <div className="rounded-xl-2 border border-accent/40 bg-surface shadow-elev-3 px-4 py-3 flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center flex-shrink-0">
          <RefreshCw size={16} className="text-accent" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-on-surface">Update available</p>
          <p className="text-xs text-on-surface-muted mt-0.5">
            A new version of the portal just went live. Refresh to pick up the latest changes.
          </p>
          <div className="flex gap-2 mt-2">
            <button onClick={reload}
              className="px-3 py-1.5 text-xs font-semibold bg-accent text-on-accent rounded-lg hover:opacity-90">
              Refresh now
            </button>
            <button onClick={dismiss}
              className="px-3 py-1.5 text-xs font-semibold text-on-surface-muted hover:bg-surface-2 rounded-lg">
              Maybe later
            </button>
          </div>
        </div>
        <button onClick={dismiss} className="text-on-surface-subtle hover:text-on-surface p-0.5" aria-label="Dismiss">
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

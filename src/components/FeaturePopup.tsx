import { useEffect, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { api } from '../services/api';
import type { FeatureAnnouncement } from '../services/api';
import { useAuth } from '../context/AuthContext';

// Global "What's new" modal. Mounted once near the app root. On mount /
// auth-change, fetches the FIRST unseen published feature for the
// current user. If there is one, renders it as a centered modal. Acking
// it both POSTs to the server (so it never appears again) and refetches —
// so if multiple features were published in a row, the next one pops
// immediately after dismissing the current one.
//
// This component handles its own "next-login" semantics: it only fires
// when a user is signed in, so the popup naturally appears the first
// time they land anywhere after a feature goes live.
export default function FeaturePopup() {
  const { user } = useAuth();
  const [feature, setFeature] = useState<FeatureAnnouncement | null>(null);
  const [busy, setBusy] = useState(false);

  const fetchNext = () => {
    if (!user) { setFeature(null); return; }
    // Only fetch when the modal isn't already showing one. Otherwise a
    // poll that comes in during a popup would replace the title under
    // the user's nose.
    if (feature) return;
    api.getUnseenFeature().then(setFeature).catch(() => setFeature(null));
  };
  useEffect(() => {
    // Mount fetch + focus refetch — no setInterval. Every poll counted
    // as an edge request, and the popup is a passive surface (it pops
    // when there's something new; it doesn't need to feel "live"). A
    // freshly-published feature surfaces the next time the user opens
    // the tab or switches back to it, which is usually within minutes.
    fetchNext();
    const onFocus = () => fetchNext();
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, !!feature]);

  const dismiss = async () => {
    if (!feature) return;
    setBusy(true);
    try {
      await api.ackFeature(feature.id);
      // Pull the next one immediately — chains multiple announcements
      // without forcing a page reload between them.
      api.getUnseenFeature().then(setFeature).catch(() => setFeature(null));
    } catch { /* ignore — server-side ack failure shouldn't trap the user */ }
    finally { setBusy(false); }
  };

  if (!feature) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fade-in"
         onClick={busy ? undefined : dismiss}>
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-outline animate-fade-up relative"
           onClick={e => e.stopPropagation()}>
        {/* Hero — either the uploaded image or a gradient banner with the
            sparkle motif so unimaged announcements still feel celebratory */}
        {feature.image_url ? (
          <img src={feature.image_url} alt="" className="w-full h-44 object-cover bg-surface-2" />
        ) : (
          <div className="relative h-32 bg-gradient-to-br from-accent via-brand to-accent flex items-center justify-center overflow-hidden">
            <div className="absolute -top-12 -left-12 w-44 h-44 rounded-full bg-white/15 blur-3xl" />
            <div className="absolute -bottom-12 -right-12 w-44 h-44 rounded-full bg-white/15 blur-3xl" />
            <Sparkles size={42} className="relative text-white drop-shadow-lg" />
          </div>
        )}
        <button onClick={dismiss} disabled={busy}
          className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/30 hover:bg-black/50 text-white flex items-center justify-center disabled:opacity-50">
          <X size={14} />
        </button>

        <div className="p-6">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-accent inline-flex items-center gap-1">
            <Sparkles size={10} /> What's new
          </p>
          <h2 className="font-display text-xl font-bold tracking-tight text-on-surface mt-1">{feature.title}</h2>
          <p className="text-sm text-on-surface-muted leading-relaxed mt-2 whitespace-pre-line">{feature.body}</p>

          <div className="flex items-center gap-2 mt-5">
            {feature.cta_label && feature.cta_url ? (
              <a href={feature.cta_url}
                 onClick={dismiss}
                 className="flex-1 inline-flex items-center justify-center px-4 py-2.5 rounded-lg bg-accent text-on-accent text-sm font-semibold hover:opacity-90 transition-opacity">
                {feature.cta_label}
              </a>
            ) : null}
            <button onClick={dismiss} disabled={busy}
              className={`${feature.cta_label && feature.cta_url ? 'flex-1' : 'w-full'} px-4 py-2.5 rounded-lg text-sm font-semibold ${
                feature.cta_label && feature.cta_url
                  ? 'border border-outline text-on-surface-muted hover:bg-surface-2'
                  : 'bg-accent text-on-accent hover:opacity-90'
              } disabled:opacity-50`}>
              {busy ? '…' : 'Got it'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

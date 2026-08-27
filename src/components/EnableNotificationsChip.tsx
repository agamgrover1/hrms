import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { getPushStatus, subscribeToPush } from '../lib/pushSubscription';
import { toast } from './Toaster';

// Small "Enable OS notifications" pill that lives next to the bell in
// TopBar. Renders only when:
//   • push is supported by the browser,
//   • the user hasn't already granted permission + subscribed,
//   • the user hasn't dismissed it (localStorage flag).
//
// Once clicked, we request Notification permission, subscribe, and
// stash a flag so the pill doesn't come back. Everything else — the
// SW registration, VAPID key fetch, push send — lives elsewhere.

const DISMISS_KEY = 'hrms_push_prompt_dismissed';

export default function EnableNotificationsChip() {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const status = await getPushStatus();
      if (!mounted) return;
      if (!status.supported) return;
      if (status.subscribed) return;
      if (status.permission === 'denied') return;
      try {
        if (localStorage.getItem(DISMISS_KEY) === '1') return;
      } catch { /* private mode */ }
      setShow(true);
    })();
    return () => { mounted = false; };
  }, []);

  const enable = async () => {
    setBusy(true);
    try {
      const r = await subscribeToPush();
      if (r.ok) {
        toast.success('Notifications enabled', 'You will get an alert even when this tab is closed.');
        setShow(false);
      } else {
        toast.error('Could not enable notifications', r.error);
      }
    } finally { setBusy(false); }
  };

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* noop */ }
    setShow(false);
  };

  if (!show) return null;

  return (
    <div className="inline-flex items-center gap-1 h-9 pl-2.5 pr-1 rounded-full border border-accent/40 bg-accent-container/40 text-accent text-xs sm:text-sm font-semibold">
      <Bell size={12} />
      <button onClick={enable} disabled={busy}
        className="px-1.5 hover:underline disabled:opacity-50">
        {busy ? 'Enabling…' : 'Enable notifications'}
      </button>
      <button onClick={dismiss} title="Not now"
        className="px-1.5 text-accent/70 hover:text-accent text-[10px]">
        ×
      </button>
    </div>
  );
}

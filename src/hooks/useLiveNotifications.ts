import { useEffect, useRef } from 'react';
import { api } from '../services/api';

// useLiveNotifications
//
// Opens an SSE connection to the mail service's /events/hrms channel
// so new notifications land in the browser within milliseconds, not
// on the next 30-second poll. The mail-token endpoint returns the
// same short-lived JWT the mail service already trusts (audience
// scoped to hrms-mail-service), and the SSE relay verifies it before
// wiring the subscriber into the pub-sub.
//
// The polling fallback in TopBar stays in place — SSE dropouts,
// mid-flight deploys, or corporate proxies that kill long-lived
// connections are all still covered by the 30s poll.
//
// The hook doesn't touch React state directly. It dispatches a
// window event `hrms-notification` with the row payload; TopBar
// (and any other listener) picks it up and merges into local state.
// Keeps the hook framework-agnostic and side-effect-free at the
// component tree.

export interface LiveNotificationPayload {
  id: number;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  is_read: boolean;
  created_at: string;
}

export function useLiveNotifications(enabled: boolean) {
  const esRef = useRef<EventSource | null>(null);
  const backoffRef = useRef<number>(1000);
  const stoppedRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    stoppedRef.current = false;

    const open = async () => {
      if (stoppedRef.current) return;
      try {
        // Reuse the mail-token — same JWT, same audience. Short-lived
        // so a stolen token can't linger.
        const t = await api.getMailToken();
        const url = `${t.api_base}/events/hrms?t=${encodeURIComponent(t.token)}`;
        const es = new EventSource(url);
        esRef.current = es;
        es.onopen = () => { backoffRef.current = 1000; };
        es.onmessage = (evt) => {
          try {
            const data = JSON.parse(evt.data);
            if (data?.kind === 'notification' && data.notification) {
              const n = data.notification;
              const payload: LiveNotificationPayload = {
                id: Number(n.id ?? 0),
                type: String(n.type ?? ''),
                title: String(n.title ?? ''),
                body: n.body ?? null,
                link: n.link ?? null,
                is_read: !!n.is_read,
                created_at: String(n.created_at ?? new Date().toISOString()),
              };
              window.dispatchEvent(new CustomEvent('hrms-notification', { detail: payload }));
            }
          } catch { /* ignore malformed frames */ }
        };
        es.onerror = () => {
          try { es.close(); } catch { /* noop */ }
          esRef.current = null;
          if (stoppedRef.current) return;
          // Exponential backoff up to 30s so we don't hammer the VPS
          // during a rolling deploy.
          const wait = Math.min(30_000, backoffRef.current);
          backoffRef.current = Math.min(30_000, backoffRef.current * 2);
          setTimeout(open, wait);
        };
      } catch {
        if (stoppedRef.current) return;
        const wait = Math.min(30_000, backoffRef.current);
        backoffRef.current = Math.min(30_000, backoffRef.current * 2);
        setTimeout(open, wait);
      }
    };

    open();

    return () => {
      stoppedRef.current = true;
      try { esRef.current?.close(); } catch { /* noop */ }
      esRef.current = null;
    };
  }, [enabled]);
}

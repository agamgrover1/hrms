import { useEffect, useRef, useState } from 'react';
import { api } from '../services/api';

// Real-time mail push (M5). Opens an EventSource against the VPS
// mail service, subscribes to all of the caller's connected accounts,
// and fires the passed callback for every incoming new_mail event.
// Auto-reconnects with exponential backoff on drop; token refreshes
// on 401.

export interface NewMailPush {
  type: 'new_mail';
  account_id: string;
  folder: string;
  uid: number;
  subject: string;
  from: { name: string; address: string } | null;
  date: string | null;
  seen: boolean;
}

// accountIds is null while the caller hasn't loaded them yet — in
// that state we don't attempt to subscribe. Reconnect happens whenever
// the id list changes.
export function useMailStream(accountIds: string[] | null, onMail: (evt: NewMailPush) => void) {
  const cbRef = useRef(onMail);
  cbRef.current = onMail;
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!accountIds || accountIds.length === 0) { setConnected(false); return; }
    let cancelled = false;
    let src: EventSource | null = null;
    let backoff = 1000;

    const open = async () => {
      if (cancelled) return;
      try {
        const tb = await api.getMailToken();
        const url = `${tb.api_base}/events?accounts=${encodeURIComponent(accountIds.join(','))}&t=${encodeURIComponent(tb.token)}`;
        src = new EventSource(url);
        src.onopen = () => { setConnected(true); backoff = 1000; };
        src.onmessage = (ev) => {
          try {
            const data = JSON.parse(ev.data);
            if (data?.type === 'new_mail') cbRef.current(data);
          } catch { /* malformed frame, ignore */ }
        };
        src.onerror = () => {
          setConnected(false);
          try { src?.close(); } catch { /* already closed */ }
          if (cancelled) return;
          // Reconnect with capped exponential backoff.
          setTimeout(open, backoff);
          backoff = Math.min(30_000, backoff * 2);
        };
      } catch (err) {
        if (cancelled) return;
        setTimeout(open, backoff);
        backoff = Math.min(30_000, backoff * 2);
      }
    };
    open();
    return () => {
      cancelled = true;
      try { src?.close(); } catch { /* already closed */ }
      setConnected(false);
    };
  }, [accountIds ? accountIds.join(',') : null]);

  return { connected };
}

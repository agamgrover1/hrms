import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { mailApi } from '../services/mailApi';
import { useMailStream, type NewMailPush } from '../hooks/useMailStream';
import { bumpMailBadge } from '../hooks/useMailBadge';
import { toast } from './Toaster';

// Runs at Layout level so mail push notifications work on every page,
// not just when the user has /mail open. When they ARE on /mail, this
// stays quiet (that page has its own listener that updates the list
// directly).

export default function GlobalMailStream() {
  const { user } = useAuth();
  const location = useLocation();
  const [accountIds, setAccountIds] = useState<string[] | null>(null);

  // Load account IDs once per session. Refresh every 10 minutes so
  // adding a mailbox in another tab picks up in this one without a
  // full reload.
  useEffect(() => {
    if (!user?.id) { setAccountIds(null); return; }
    let cancelled = false;
    const load = () => {
      mailApi.listAccounts()
        .then(list => { if (!cancelled) setAccountIds(list.map(a => a.id)); })
        .catch(() => { /* mail service down or user has no accounts — no push, no toast */ });
    };
    load();
    const t = setInterval(load, 10 * 60 * 1000);
    return () => { cancelled = true; clearInterval(t); };
  }, [user?.id]);

  useMailStream(accountIds, (evt: NewMailPush) => {
    // Never push a duplicate notification for the user's own outgoing
    // mail — Sent folder is not INBOX, but be defensive anyway.
    if (evt.folder !== 'INBOX') return;
    // Skip when the user is already on /mail — that page shows the new
    // message directly in its list, so a toast is redundant.
    const onMail = location.pathname.startsWith('/mail');
    if (onMail) return;
    bumpMailBadge(1);
    const senderLabel = evt.from?.name || evt.from?.address || 'New mail';
    toast.info(senderLabel, evt.subject);
  });

  return null;
}

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  CalendarDays, Plus, Loader2, Link2Off, ExternalLink, Video, MapPin,
  RefreshCw, AlertTriangle, CheckCircle2, Mail,
} from 'lucide-react';
import { api } from '../services/api';
import { toast } from '../components/Toaster';

// Calendar page: connect Google / Microsoft calendars via OAuth,
// list connected accounts, show the next 7 days of events per
// account. Every action deep-links back here (?connected=1 / ?error=…)
// so the OAuth round-trip is transparent to the user.

type Connection = Awaited<ReturnType<typeof api.listCalendarConnections>>[number];
type CalendarEvent = Awaited<ReturnType<typeof api.getCalendarEvents>>['events'][number];

const PROVIDER_LABEL: Record<string, string> = {
  google: 'Google Calendar',
  microsoft: 'Outlook / Microsoft 365',
};

export default function CalendarPage() {
  const [params, setParams] = useSearchParams();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<'google' | 'microsoft' | null>(null);
  const [eventsByConn, setEventsByConn] = useState<Record<string, CalendarEvent[]>>({});
  const [eventsLoading, setEventsLoading] = useState<Record<string, boolean>>({});

  const load = () => {
    setLoading(true);
    api.listCalendarConnections()
      .then(setConnections)
      .catch(e => toast.error('Could not load calendars', e?.body?.error ?? e?.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  // Handle OAuth redirect back — show a toast and clean the URL.
  useEffect(() => {
    const err = params.get('error');
    const ok  = params.get('connected');
    if (err) {
      toast.error('Calendar connect failed', friendlyError(err));
      const next = new URLSearchParams(params);
      next.delete('error');
      setParams(next, { replace: true });
    } else if (ok) {
      toast.success('Calendar connected', 'You can now see its events below.');
      const next = new URLSearchParams(params);
      next.delete('connected');
      setParams(next, { replace: true });
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = async (provider: 'google' | 'microsoft') => {
    setConnecting(provider);
    try {
      const r = await api.connectCalendar(provider);
      // Full-window redirect. Popup was tempting but many corporate
      // networks + Google's iframe rules make popups flaky; full nav
      // is the simplest reliable path.
      window.location.href = r.url;
    } catch (e: any) {
      toast.error('Could not start connect flow', e?.body?.error ?? e?.message);
      setConnecting(null);
    }
  };

  const disconnect = async (c: Connection) => {
    if (!window.confirm(`Disconnect ${c.account_email}? HRMS will forget its access token.`)) return;
    try {
      await api.disconnectCalendar(c.id);
      toast.success('Calendar disconnected');
      setConnections(prev => prev.filter(x => x.id !== c.id));
      setEventsByConn(prev => {
        const next = { ...prev }; delete next[c.id]; return next;
      });
    } catch (e: any) { toast.error('Disconnect failed', e?.body?.error ?? e?.message); }
  };

  const loadEvents = async (c: Connection) => {
    setEventsLoading(prev => ({ ...prev, [c.id]: true }));
    try {
      const from = new Date().toISOString();
      const to = new Date(Date.now() + 7 * 86400000).toISOString();
      const r = await api.getCalendarEvents(c.id, { from, to });
      setEventsByConn(prev => ({ ...prev, [c.id]: r.events }));
    } catch (e: any) { toast.error('Could not load events', e?.body?.error ?? e?.message); }
    finally { setEventsLoading(prev => ({ ...prev, [c.id]: false })); }
  };

  // Autoload events for every active connection on first render.
  useEffect(() => {
    connections.forEach(c => {
      if (c.status === 'active' && eventsByConn[c.id] === undefined) void loadEvents(c);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connections]);

  const activeCount = useMemo(() => connections.filter(c => c.status === 'active').length, [connections]);

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-on-surface flex items-center gap-2">
            <CalendarDays size={20} className="text-accent" /> Calendar accounts
          </h1>
          <p className="text-sm text-on-surface-muted mt-0.5">
            Connect Gmail or Outlook so HRMS can show your upcoming meetings alongside the ones scheduled inside the portal.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => connect('google')} disabled={connecting !== null}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent text-on-accent text-xs font-semibold disabled:opacity-60">
            {connecting === 'google' ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
            Add Google Calendar
          </button>
          <button onClick={() => connect('microsoft')} disabled={connecting !== null}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-outline text-xs font-semibold text-on-surface hover:bg-surface-2 disabled:opacity-60">
            {connecting === 'microsoft' ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
            Add Outlook / Microsoft
          </button>
        </div>
      </div>

      {loading && (
        <div className="p-10 text-center text-sm text-on-surface-muted">
          <Loader2 size={14} className="inline animate-spin mr-1" /> Loading connected calendars…
        </div>
      )}

      {!loading && connections.length === 0 && (
        <div className="rounded-xl-2 border border-dashed border-outline bg-surface p-10 text-center">
          <Mail size={28} className="mx-auto text-on-surface-subtle mb-2" />
          <p className="text-sm font-semibold text-on-surface">No calendars connected yet</p>
          <p className="text-xs text-on-surface-muted mt-1 max-w-md mx-auto">
            Click <b>Add Google Calendar</b> above — you'll be redirected to Google to pick your account and grant read access.
            You can disconnect at any time.
          </p>
        </div>
      )}

      {!loading && connections.length > 0 && (
        <div className="space-y-4">
          {connections.map(c => (
            <div key={c.id} className="rounded-xl-2 border border-outline bg-surface">
              <div className="px-4 py-3 border-b border-outline flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-on-surface">{c.display_name || c.account_email}</p>
                    <span className="text-[10px] uppercase tracking-wider font-bold bg-surface-2 text-on-surface-muted px-1.5 py-0.5 rounded">
                      {PROVIDER_LABEL[c.provider] ?? c.provider}
                    </span>
                    <StatusPill status={c.status} />
                  </div>
                  <p className="text-[11px] text-on-surface-muted mt-0.5">
                    {c.account_email}
                    {c.last_synced_at && <> · Last synced {new Date(c.last_synced_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</>}
                  </p>
                </div>
                <button onClick={() => loadEvents(c)} disabled={eventsLoading[c.id]}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-outline text-xs font-semibold text-on-surface-muted hover:bg-surface-2 disabled:opacity-60">
                  {eventsLoading[c.id] ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Refresh
                </button>
                <button onClick={() => disconnect(c)}
                  title="Disconnect this calendar"
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-danger/30 text-xs font-semibold text-danger hover:bg-danger/10">
                  <Link2Off size={11} /> Disconnect
                </button>
              </div>

              <div className="p-3">
                {c.status !== 'active' ? (
                  <p className="text-[11px] text-warning italic">This connection is {c.status}. Reconnect to see events again.</p>
                ) : eventsLoading[c.id] && !eventsByConn[c.id] ? (
                  <p className="text-[11px] text-on-surface-subtle italic"><Loader2 size={10} className="inline animate-spin mr-1" /> Loading events…</p>
                ) : (eventsByConn[c.id] ?? []).length === 0 ? (
                  <p className="text-[11px] text-on-surface-subtle italic">No events in the next 7 days.</p>
                ) : (
                  <ul className="divide-y divide-outline">
                    {(eventsByConn[c.id] ?? []).map(e => <EventRow key={e.id} e={e} />)}
                  </ul>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {activeCount === 0 && !loading && connections.length > 0 && (
        <p className="text-[11px] text-on-surface-subtle italic">All your connections are inactive. Add a new one or reconnect above.</p>
      )}
    </div>
  );
}

function EventRow({ e }: { e: CalendarEvent }) {
  const start = e.start ? new Date(e.start) : null;
  const end   = e.end   ? new Date(e.end)   : null;
  return (
    <li className="py-2 flex items-start gap-3">
      <div className="w-16 text-right flex-shrink-0">
        {start && (
          <>
            <p className="text-[11px] font-mono font-semibold text-on-surface">
              {start.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
            </p>
            {!e.all_day && (
              <p className="text-[10px] text-on-surface-muted">
                {start.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })}
              </p>
            )}
          </>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-on-surface truncate">{e.summary}</p>
        <div className="text-[11px] text-on-surface-muted flex flex-wrap gap-x-2 gap-y-0.5 mt-0.5">
          {end && !e.all_day && start && (
            <span>{start.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })} – {end.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })}</span>
          )}
          {e.location && <span className="inline-flex items-center gap-1"><MapPin size={10} />{e.location}</span>}
          {e.conference_uri && (
            <a href={e.conference_uri} target="_blank" rel="noopener noreferrer"
              className="text-accent hover:underline inline-flex items-center gap-1">
              <Video size={10} /> Join
            </a>
          )}
          {e.attendees.length > 0 && <span>{e.attendees.length} 👥</span>}
        </div>
      </div>
      {e.html_link && (
        <a href={e.html_link} target="_blank" rel="noopener noreferrer"
          title="Open in Google Calendar"
          className="text-on-surface-subtle hover:text-on-surface p-1"><ExternalLink size={12} /></a>
      )}
    </li>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; tone: string; icon: any }> = {
    active:  { label: 'Connected', tone: 'bg-success-container text-success', icon: CheckCircle2 },
    expired: { label: 'Expired',   tone: 'bg-warning-container text-warning', icon: AlertTriangle },
    revoked: { label: 'Revoked',   tone: 'bg-danger-container text-danger',   icon: AlertTriangle },
  };
  const s = map[status] ?? map.active;
  const Icon = s.icon;
  return <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${s.tone}`}><Icon size={9} /> {s.label}</span>;
}

function friendlyError(code: string): string {
  const m: Record<string, string> = {
    unknown_provider: 'That provider isn\'t supported.',
    missing_code: 'Google/Microsoft didn\'t return an authorisation code — please try again.',
    bad_state: 'The connect flow expired or was tampered with. Try again from the button above.',
    server_not_configured: 'Server is missing the OAuth client id/secret. Ask an admin to configure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on Vercel.',
    token_exchange_failed: 'The token exchange with Google/Microsoft failed. Try again; if it persists, check that the redirect URI matches what\'s registered on the OAuth app.',
    userinfo_failed: 'Could not read the account\'s email from the provider. Try again.',
    no_access_token: 'The provider returned no access token.',
    encryption_key_missing: 'Server is missing CALENDAR_ENCRYPTION_KEY. Ask an admin to configure it on Vercel.',
    callback_failed: 'Something went wrong finishing the connect flow. Try again.',
  };
  return m[code] ?? `Error: ${code}`;
}

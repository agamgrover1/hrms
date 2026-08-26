import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Calendar, Video, MapPin, Users2, Plus, X, Link2, ExternalLink,
  Check, XCircle, CircleDashed, Loader2, ChevronLeft, ChevronRight,
  LayoutList, LayoutGrid, Trash2, Pencil, Briefcase,
} from 'lucide-react';
import { api } from '../services/api';
import type { Meeting, MeetingAttendee } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { toast } from '../components/Toaster';

// Meetings — office / virtual / hybrid meetings with per-attendee
// RSVP + optional project tag. Two views: chronological list and a
// day/week calendar grid. Everyone sees only what they organize or
// were invited to; admin / HR / project_coordinator can toggle to an
// "all meetings" scope.

type View = 'list' | 'calendar';
type Scope = 'mine' | 'all';

const PRIVILEGED_ROLES = ['admin', 'hr_manager', 'hr_intern', 'project_coordinator'];

function toLocalDateInput(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0'), mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day}T${hh}:${mm}`;
}
function fromLocalDateInput(local: string): string {
  const d = new Date(local);
  return d.toISOString();
}
function fmtRange(m: Meeting): string {
  const s = new Date(m.start_at), e = new Date(m.end_at);
  const sameDay = s.toDateString() === e.toDateString();
  const day = s.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  const t = (d: Date) => d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
  return sameDay ? `${day} · ${t(s)} – ${t(e)}` : `${day} ${t(s)} → ${e.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} ${t(e)}`;
}
function relativeCountdown(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff < 0) return 'past';
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `in ${hrs}h`;
  const days = Math.round(hrs / 24);
  return `in ${days}d`;
}

export default function Meetings() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const openMeetingId = params.get('meeting');
  const isPrivileged = PRIVILEGED_ROLES.includes(user?.role ?? '');
  const myEmpId = user?.employee_id_ref ?? null;

  const [view, setView] = useState<View>('list');
  const [scope, setScope] = useState<Scope>('mine');
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [employees, setEmployees] = useState<Array<{ id: string; name: string; department?: string | null }>>([]);
  const [projectFilter, setProjectFilter] = useState<string>('');
  const [composerOpen, setComposerOpen] = useState<{ mode: 'new'; seed?: Partial<Meeting> } | { mode: 'edit'; meeting: Meeting } | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api.listMeetings({ scope, project_id: projectFilter || undefined })
      .then(setMeetings)
      .catch(e => toast.error('Failed to load meetings', e?.body?.error ?? e?.message))
      .finally(() => setLoading(false));
  }, [scope, projectFilter]);
  useEffect(load, [load]);

  useEffect(() => {
    api.getProjects({ status: 'active' }).then(p => setProjects(p as any)).catch(() => {});
    api.getEmployeesSlim().then(e => setEmployees(e as any)).catch(() => {});
  }, []);

  const now = Date.now();
  const today = useMemo(() => meetings.filter(m => {
    const s = new Date(m.start_at).getTime(); const e = new Date(m.end_at).getTime();
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999);
    return m.status !== 'cancelled' && e >= startOfDay.getTime() && s <= endOfDay.getTime();
  }), [meetings]);
  const upcoming = useMemo(() => meetings.filter(m => {
    const startOfTomorrow = new Date(); startOfTomorrow.setHours(0, 0, 0, 0); startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
    return m.status !== 'cancelled' && new Date(m.start_at).getTime() >= startOfTomorrow.getTime();
  }), [meetings]);
  const past = useMemo(() => meetings.filter(m => m.status === 'cancelled' || new Date(m.end_at).getTime() < now), [meetings, now]);

  const openMeeting = openMeetingId ? meetings.find(m => m.id === openMeetingId) : null;

  const setOpenMeeting = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('meeting', id); else next.delete('meeting');
    setParams(next, { replace: true });
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-on-surface flex items-center gap-2">
            <Calendar size={20} className="text-accent" /> Meetings
          </h1>
          <p className="text-sm text-on-surface-muted mt-0.5">
            {today.length} today · {upcoming.length} upcoming · {past.length} past
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center gap-0.5 bg-surface-2 border border-outline rounded-lg p-0.5">
            <button onClick={() => setView('list')}
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-semibold ${view === 'list' ? 'bg-accent text-on-accent' : 'text-on-surface-muted hover:text-on-surface'}`}>
              <LayoutList size={12} /> List
            </button>
            <button onClick={() => setView('calendar')}
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-semibold ${view === 'calendar' ? 'bg-accent text-on-accent' : 'text-on-surface-muted hover:text-on-surface'}`}>
              <LayoutGrid size={12} /> Calendar
            </button>
          </div>
          {isPrivileged && (
            <div className="inline-flex items-center gap-0.5 bg-surface-2 border border-outline rounded-lg p-0.5">
              <button onClick={() => setScope('mine')}
                className={`px-2.5 py-1.5 rounded text-xs font-semibold ${scope === 'mine' ? 'bg-accent text-on-accent' : 'text-on-surface-muted hover:text-on-surface'}`}>Mine</button>
              <button onClick={() => setScope('all')}
                className={`px-2.5 py-1.5 rounded text-xs font-semibold ${scope === 'all' ? 'bg-accent text-on-accent' : 'text-on-surface-muted hover:text-on-surface'}`}>All</button>
            </div>
          )}
          <select value={projectFilter} onChange={e => setProjectFilter(e.target.value)}
            className="text-xs px-2 py-1.5 rounded-lg border border-outline bg-surface text-on-surface">
            <option value="">All projects</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {myEmpId && (
            <button onClick={() => setComposerOpen({ mode: 'new' })}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent text-on-accent text-xs font-semibold hover:opacity-90">
              <Plus size={13} /> New meeting
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="p-10 text-center text-sm text-on-surface-muted"><Loader2 size={14} className="inline animate-spin mr-1" /> Loading meetings…</div>
      ) : view === 'list' ? (
        <div className="space-y-6">
          <MeetingSection title="Today" meetings={today} emptyLabel="Nothing on your calendar today." onOpen={id => setOpenMeeting(id)} myEmpId={myEmpId} highlight />
          <MeetingSection title="Upcoming" meetings={upcoming} emptyLabel="No upcoming meetings." onOpen={id => setOpenMeeting(id)} myEmpId={myEmpId} />
          <MeetingSection title="Past" meetings={past.slice(0, 30)} emptyLabel="No past meetings." onOpen={id => setOpenMeeting(id)} myEmpId={myEmpId} muted collapsible />
        </div>
      ) : (
        <CalendarGrid meetings={meetings.filter(m => m.status !== 'cancelled')} onOpen={id => setOpenMeeting(id)} />
      )}

      {composerOpen && (
        <MeetingComposer
          mode={composerOpen.mode}
          initial={composerOpen.mode === 'edit' ? composerOpen.meeting : (composerOpen.seed as any)}
          employees={employees}
          projects={projects}
          onClose={() => setComposerOpen(null)}
          onSaved={() => { setComposerOpen(null); load(); }}
        />
      )}

      {openMeeting && (
        <MeetingDetailDrawer
          meeting={openMeeting}
          myEmpId={myEmpId}
          canEdit={!!myEmpId && (openMeeting.organizer_id === myEmpId || user?.role === 'admin')}
          onClose={() => setOpenMeeting(null)}
          onEdit={() => { setComposerOpen({ mode: 'edit', meeting: openMeeting }); }}
          onCancel={async () => {
            if (!window.confirm(`Cancel "${openMeeting.title}"? Invitees will be notified.`)) return;
            try { await api.cancelMeeting(openMeeting.id); toast.success('Meeting cancelled'); setOpenMeeting(null); load(); }
            catch (e: any) { toast.error('Cancel failed', e?.body?.error ?? e?.message); }
          }}
          onRsvp={async (s) => {
            try {
              await api.rsvpMeeting(openMeeting.id, s);
              toast.success(`Marked ${s}`);
              load();
            } catch (e: any) { toast.error('RSVP failed', e?.body?.error ?? e?.message); }
          }}
          onDataChanged={load}
        />
      )}
    </div>
  );
}

// ── Sections ────────────────────────────────────────────────────
function MeetingSection({ title, meetings, emptyLabel, onOpen, myEmpId, highlight, muted, collapsible }: {
  title: string; meetings: Meeting[]; emptyLabel: string; onOpen: (id: string) => void; myEmpId: string | null;
  highlight?: boolean; muted?: boolean; collapsible?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(!!collapsible);
  return (
    <section>
      <button
        onClick={() => collapsible && setCollapsed(c => !c)}
        className={`flex items-center gap-2 mb-2 ${collapsible ? 'cursor-pointer hover:text-on-surface' : ''}`}>
        <h2 className={`text-sm font-bold uppercase tracking-wider ${highlight ? 'text-accent' : 'text-on-surface-muted'}`}>{title}</h2>
        <span className="text-[10px] font-mono text-on-surface-subtle">{meetings.length}</span>
        {collapsible && <ChevronRight size={12} className={`text-on-surface-subtle transition-transform ${collapsed ? '' : 'rotate-90'}`} />}
      </button>
      {!collapsed && (
        meetings.length === 0 ? (
          <p className="text-xs text-on-surface-subtle italic">{emptyLabel}</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
            {meetings.map(m => <MeetingCard key={m.id} m={m} onOpen={onOpen} myEmpId={myEmpId} muted={muted} highlight={highlight} />)}
          </div>
        )
      )}
    </section>
  );
}

function MeetingCard({ m, onOpen, myEmpId, muted, highlight }: { m: Meeting; onOpen: (id: string) => void; myEmpId: string | null; muted?: boolean; highlight?: boolean }) {
  const cancelled = m.status === 'cancelled';
  const myRsvp = myEmpId ? m.attendees.find(a => a.employee_id === myEmpId)?.rsvp_status ?? null : null;
  const accepted = m.attendees.filter(a => a.rsvp_status === 'accepted').length;
  return (
    <button onClick={() => onOpen(m.id)}
      className={`text-left rounded-xl-2 border p-3 hover:shadow-elev-1 transition ${
        cancelled ? 'border-outline bg-surface opacity-60 line-through' :
        highlight ? 'border-accent/40 bg-accent/5 hover:border-accent' :
        muted ? 'border-outline bg-surface' : 'border-outline bg-surface hover:border-outline-strong'
      }`}>
      <div className="flex items-baseline gap-2 mb-1">
        <p className="text-[11px] font-mono font-semibold text-on-surface-muted">{fmtRange(m)}</p>
        {!cancelled && !muted && (
          <span className="ml-auto text-[10px] font-semibold text-accent">{relativeCountdown(m.start_at)}</span>
        )}
        {cancelled && <span className="ml-auto text-[10px] font-semibold text-danger">Cancelled</span>}
      </div>
      <p className="text-sm font-semibold text-on-surface truncate">{m.title}</p>
      <div className="flex items-center gap-2 text-[11px] text-on-surface-muted mt-1.5">
        {m.location_kind === 'virtual' ? (
          <span className="inline-flex items-center gap-1"><Video size={11} /> Virtual</span>
        ) : m.location_kind === 'hybrid' ? (
          <span className="inline-flex items-center gap-1"><Video size={11} /> Hybrid · {m.location ?? '—'}</span>
        ) : (
          <span className="inline-flex items-center gap-1"><MapPin size={11} /> {m.location ?? 'In office'}</span>
        )}
        {m.project_name && <><span className="text-on-surface-subtle">·</span><span className="inline-flex items-center gap-1"><Briefcase size={11} /> {m.project_name}</span></>}
      </div>
      <div className="mt-2 flex items-center gap-1.5 flex-wrap">
        <span className="inline-flex items-center gap-1 text-[10px] text-on-surface-muted">
          <Users2 size={10} /> {accepted}/{m.attendees.length}
        </span>
        <span className="text-[10px] text-on-surface-subtle">by {m.organizer_name}</span>
        {myRsvp && myRsvp !== 'accepted' && (
          <span className={`ml-auto text-[10px] font-semibold px-1.5 py-0.5 rounded ${
            myRsvp === 'declined' ? 'bg-danger/10 text-danger'
            : myRsvp === 'tentative' ? 'bg-warning/10 text-warning'
            : 'bg-info/10 text-info'
          }`}>You: {myRsvp}</span>
        )}
      </div>
    </button>
  );
}

// ── Composer (new + edit) ───────────────────────────────────────
function MeetingComposer({ mode, initial, employees, projects, onClose, onSaved }: {
  mode: 'new' | 'edit';
  initial?: Partial<Meeting>;
  employees: Array<{ id: string; name: string; department?: string | null }>;
  projects: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const nowRoundedTo30 = () => {
    const d = new Date(); d.setMinutes(Math.ceil(d.getMinutes() / 30) * 30, 0, 0); return d;
  };
  const defaultStart = initial?.start_at ? new Date(initial.start_at) : nowRoundedTo30();
  const defaultEnd = initial?.end_at ? new Date(initial.end_at) : new Date(defaultStart.getTime() + 30 * 60_000);
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [startAt, setStartAt] = useState(toLocalDateInput(defaultStart.toISOString()));
  const [endAt, setEndAt] = useState(toLocalDateInput(defaultEnd.toISOString()));
  const [locationKind, setLocationKind] = useState<'in_office' | 'virtual' | 'hybrid'>(initial?.location_kind ?? 'in_office');
  const [location, setLocation] = useState(initial?.location ?? '');
  const [meetingLink, setMeetingLink] = useState(initial?.meeting_link ?? '');
  const [projectId, setProjectId] = useState<string>(initial?.project_id ?? '');
  const [attendeeIds, setAttendeeIds] = useState<Set<string>>(new Set(
    initial && Array.isArray((initial as any).attendees)
      ? (initial as any).attendees.map((a: MeetingAttendee) => a.employee_id)
      : []
  ));
  const [empSearch, setEmpSearch] = useState('');
  const [saving, setSaving] = useState(false);

  const filteredEmps = useMemo(() => {
    const q = empSearch.trim().toLowerCase();
    return employees.filter(e => !q || e.name.toLowerCase().includes(q)).slice(0, 200);
  }, [employees, empSearch]);
  const toggle = (id: string) => {
    setAttendeeIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const remove = (id: string) => setAttendeeIds(prev => { const n = new Set(prev); n.delete(id); return n; });

  const save = async () => {
    if (!title.trim()) { toast.error('Title required'); return; }
    if (!startAt || !endAt) { toast.error('Start and end required'); return; }
    if (new Date(endAt) <= new Date(startAt)) { toast.error('End must be after start'); return; }
    setSaving(true);
    try {
      const body = {
        title: title.trim(),
        description: description?.trim() || null,
        start_at: fromLocalDateInput(startAt),
        end_at: fromLocalDateInput(endAt),
        location_kind: locationKind,
        location: location?.trim() || null,
        meeting_link: meetingLink?.trim() || null,
        project_id: projectId || null,
        attendee_ids: Array.from(attendeeIds),
      };
      if (mode === 'new') await api.createMeeting(body);
      else await api.patchMeeting((initial as Meeting).id, body);
      toast.success(mode === 'new' ? 'Meeting scheduled' : 'Meeting updated');
      onSaved();
    } catch (e: any) { toast.error('Save failed', e?.body?.error ?? e?.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-start justify-center p-4 overflow-y-auto" onMouseDown={onClose}>
      <div className="bg-surface rounded-xl-2 w-full max-w-xl shadow-elev-4 border border-outline my-8" onMouseDown={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-outline flex items-center justify-between">
          <h2 className="text-lg font-display font-bold text-on-surface">{mode === 'new' ? 'New meeting' : 'Edit meeting'}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-surface-2 text-on-surface-muted"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-on-surface-muted">Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)} autoFocus
              placeholder="Kick-off · Website redesign brief · Sprint planning"
              className="mt-1 w-full px-3 py-2 rounded-lg border border-outline bg-surface-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30" />
          </div>
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-on-surface-muted">Agenda / notes <span className="normal-case font-normal text-on-surface-subtle">(optional)</span></label>
            <textarea value={description ?? ''} onChange={e => setDescription(e.target.value)} rows={2}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-outline bg-surface-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-on-surface-muted">Start</label>
              <input type="datetime-local" value={startAt} onChange={e => setStartAt(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-outline bg-surface-2 text-sm" />
            </div>
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-on-surface-muted">End</label>
              <input type="datetime-local" value={endAt} onChange={e => setEndAt(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-outline bg-surface-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-on-surface-muted">Location</label>
            <div className="mt-1 grid grid-cols-3 gap-1">
              {([
                { key: 'in_office' as const, icon: MapPin, label: 'In office' },
                { key: 'virtual' as const,   icon: Video,  label: 'Virtual' },
                { key: 'hybrid' as const,    icon: Link2,  label: 'Hybrid' },
              ]).map(opt => {
                const Icon = opt.icon; const active = locationKind === opt.key;
                return (
                  <button key={opt.key} onClick={() => setLocationKind(opt.key)}
                    className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold ${active ? 'border-accent bg-accent/10 text-accent' : 'border-outline text-on-surface-muted hover:bg-surface-2'}`}>
                    <Icon size={12} /> {opt.label}
                  </button>
                );
              })}
            </div>
            {(locationKind === 'in_office' || locationKind === 'hybrid') && (
              <input value={location ?? ''} onChange={e => setLocation(e.target.value)}
                placeholder={locationKind === 'in_office' ? 'Room name — Think Tank, Conference Room A…' : 'Room name (for in-person attendees)'}
                className="mt-2 w-full px-3 py-2 rounded-lg border border-outline bg-surface-2 text-sm" />
            )}
            {(locationKind === 'virtual' || locationKind === 'hybrid') && (
              <input value={meetingLink ?? ''} onChange={e => setMeetingLink(e.target.value)}
                placeholder="Paste Google Meet / Zoom / Teams link"
                className="mt-2 w-full px-3 py-2 rounded-lg border border-outline bg-surface-2 text-sm" />
            )}
          </div>
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-on-surface-muted">Project <span className="normal-case font-normal text-on-surface-subtle">(optional — tags the meeting to a project)</span></label>
            <select value={projectId} onChange={e => setProjectId(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-outline bg-surface-2 text-sm">
              <option value="">— none —</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-on-surface-muted flex items-center gap-1">
              <Users2 size={11} /> Attendees <span className="normal-case font-normal text-on-surface-subtle">({attendeeIds.size} invited)</span>
            </label>
            {attendeeIds.size > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {Array.from(attendeeIds).map(id => {
                  const e = employees.find(x => x.id === id);
                  return (
                    <span key={id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/10 text-accent text-[11px] font-semibold">
                      {e?.name ?? id}
                      <button onClick={() => remove(id)} className="text-accent/70 hover:text-accent"><X size={9} /></button>
                    </span>
                  );
                })}
              </div>
            )}
            <input value={empSearch} onChange={e => setEmpSearch(e.target.value)}
              placeholder="Search employees…"
              className="mt-2 w-full px-3 py-2 rounded-lg border border-outline bg-surface-2 text-sm" />
            {empSearch.trim() && (
              <div className="mt-1 max-h-52 overflow-y-auto rounded-lg border border-outline divide-y divide-outline">
                {filteredEmps.length === 0 && <p className="p-3 text-xs text-on-surface-subtle italic">No matches.</p>}
                {filteredEmps.map(e => (
                  <label key={e.id} className="flex items-center gap-2 px-3 py-2 hover:bg-surface-2 cursor-pointer">
                    <input type="checkbox" checked={attendeeIds.has(e.id)} onChange={() => toggle(e.id)} className="rounded border-outline" />
                    <span className="text-sm text-on-surface flex-1 truncate">{e.name}</span>
                    <span className="text-[10px] text-on-surface-subtle">{e.department ?? ''}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="px-5 py-3 border-t border-outline flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-sm text-on-surface-muted hover:text-on-surface">Cancel</button>
          <button onClick={save} disabled={saving}
            className="inline-flex items-center gap-1 px-4 py-1.5 rounded-lg bg-accent text-on-accent text-sm font-semibold disabled:opacity-60">
            {saving && <Loader2 size={12} className="animate-spin" />}
            {mode === 'new' ? 'Schedule meeting' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Detail drawer ────────────────────────────────────────────
function MeetingDetailDrawer({ meeting, myEmpId, canEdit, onClose, onEdit, onCancel, onRsvp, onDataChanged }: {
  meeting: Meeting;
  myEmpId: string | null;
  canEdit: boolean;
  onClose: () => void;
  onEdit: () => void;
  onCancel: () => void;
  onRsvp: (s: 'accepted' | 'declined' | 'tentative') => void;
  onDataChanged: () => void;
}) {
  const myAttendance = myEmpId ? meeting.attendees.find(a => a.employee_id === myEmpId) : null;
  const canWriteNotes = !!myEmpId && (meeting.organizer_id === myEmpId || !!myAttendance);
  const [notes, setNotes] = useState(meeting.notes ?? '');
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesEdited, setNotesEdited] = useState(false);
  useEffect(() => { setNotes(meeting.notes ?? ''); setNotesEdited(false); }, [meeting.id, meeting.notes]);
  const saveNotes = async () => {
    if (!canWriteNotes) return;
    const trimmed = notes.trim();
    const original = (meeting.notes ?? '').trim();
    if (trimmed === original) { setNotesEdited(false); return; }
    setSavingNotes(true);
    try {
      await api.patchMeetingNotes(meeting.id, trimmed || null);
      setNotesEdited(false);
      onDataChanged();
    } catch (e: any) { toast.error('Could not save notes', e?.body?.error ?? e?.message); }
    finally { setSavingNotes(false); }
  };
  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-start justify-end" onMouseDown={onClose}>
      <div className="bg-surface w-full max-w-md h-full shadow-elev-4 border-l border-outline flex flex-col" onMouseDown={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-outline flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold text-on-surface-muted uppercase tracking-wider">{fmtRange(meeting)}</p>
            <h2 className={`text-lg font-display font-bold text-on-surface ${meeting.status === 'cancelled' ? 'line-through opacity-60' : ''}`}>{meeting.title}</h2>
            <p className="text-[11px] text-on-surface-muted mt-0.5">organised by {meeting.organizer_name}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-surface-2 text-on-surface-muted"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4 flex-1 overflow-y-auto">
          {meeting.description && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-muted mb-1">Agenda</p>
              <p className="text-sm text-on-surface whitespace-pre-wrap">{meeting.description}</p>
            </div>
          )}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-muted mb-1">Where</p>
            {meeting.location_kind === 'in_office' && <p className="text-sm text-on-surface inline-flex items-center gap-1.5"><MapPin size={12} /> {meeting.location ?? 'In office'}</p>}
            {meeting.location_kind === 'virtual' && meeting.meeting_link && (
              <a href={meeting.meeting_link} target="_blank" rel="noopener noreferrer"
                className="text-sm text-accent inline-flex items-center gap-1.5 hover:underline break-all">
                <Video size={12} /> Join virtual meeting <ExternalLink size={11} />
              </a>
            )}
            {meeting.location_kind === 'hybrid' && (
              <div className="space-y-1">
                {meeting.location && <p className="text-sm text-on-surface inline-flex items-center gap-1.5"><MapPin size={12} /> {meeting.location}</p>}
                {meeting.meeting_link && (
                  <a href={meeting.meeting_link} target="_blank" rel="noopener noreferrer"
                    className="text-sm text-accent inline-flex items-center gap-1.5 hover:underline break-all">
                    <Video size={12} /> Or join virtually <ExternalLink size={11} />
                  </a>
                )}
              </div>
            )}
          </div>
          {meeting.project_name && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-muted mb-1">Project</p>
              <p className="text-sm text-on-surface inline-flex items-center gap-1.5"><Briefcase size={12} /> {meeting.project_name}{meeting.project_client && <span className="text-on-surface-muted"> · {meeting.project_client}</span>}</p>
            </div>
          )}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-muted mb-1">Attendees ({meeting.attendees.length})</p>
            <div className="space-y-1">
              {meeting.attendees.map(a => (
                <div key={a.employee_id} className="flex items-center gap-2 text-sm">
                  <span className={`w-2 h-2 rounded-full ${a.rsvp_status === 'accepted' ? 'bg-success' : a.rsvp_status === 'declined' ? 'bg-danger' : a.rsvp_status === 'tentative' ? 'bg-warning' : 'bg-on-surface-subtle'}`} />
                  <span className="flex-1 truncate text-on-surface">{a.employee_name}</span>
                  <span className="text-[10px] uppercase font-semibold tracking-wider text-on-surface-muted">{a.rsvp_status}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Meeting notes — any attendee can edit. Ships as a
              collaborative surface: whoever took the minutes types
              them in, everyone else sees them. */}
          <div>
            <div className="flex items-center gap-2 mb-1">
              <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-muted">Notes</p>
              {savingNotes && <span className="text-[10px] text-accent inline-flex items-center gap-1"><Loader2 size={9} className="animate-spin" /> Saving…</span>}
              {!savingNotes && notesEdited && <span className="text-[10px] text-warning">Unsaved</span>}
              {!savingNotes && !notesEdited && meeting.notes_updated_by_name && (
                <span className="text-[10px] text-on-surface-subtle">
                  edited by {meeting.notes_updated_by_name}
                  {meeting.notes_updated_at && ` · ${new Date(meeting.notes_updated_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`}
                </span>
              )}
            </div>
            {canWriteNotes ? (
              <textarea
                value={notes}
                onChange={e => { setNotes(e.target.value); setNotesEdited(true); }}
                onBlur={saveNotes}
                placeholder="Decisions · action items · anything worth remembering after the meeting"
                rows={6}
                className="w-full px-3 py-2 rounded-lg border border-outline bg-surface-2 text-sm text-on-surface placeholder:text-on-surface-subtle focus:outline-none focus:ring-2 focus:ring-accent/30" />
            ) : meeting.notes ? (
              <p className="text-sm text-on-surface whitespace-pre-wrap">{meeting.notes}</p>
            ) : (
              <p className="text-[11px] text-on-surface-subtle italic">No notes yet.</p>
            )}
            {canWriteNotes && (
              <p className="text-[10px] text-on-surface-subtle mt-1">Notes save automatically when you click away.</p>
            )}
          </div>

          {/* RSVP controls — for invitees, when not cancelled */}
          {myAttendance && meeting.status !== 'cancelled' && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-muted mb-1">Your RSVP</p>
              <div className="grid grid-cols-3 gap-1">
                <button onClick={() => onRsvp('accepted')}
                  className={`inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg border text-xs font-semibold ${myAttendance.rsvp_status === 'accepted' ? 'bg-success text-white border-success' : 'border-outline hover:bg-surface-2 text-on-surface-muted'}`}>
                  <Check size={11} /> Accept
                </button>
                <button onClick={() => onRsvp('tentative')}
                  className={`inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg border text-xs font-semibold ${myAttendance.rsvp_status === 'tentative' ? 'bg-warning text-white border-warning' : 'border-outline hover:bg-surface-2 text-on-surface-muted'}`}>
                  <CircleDashed size={11} /> Tentative
                </button>
                <button onClick={() => onRsvp('declined')}
                  className={`inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg border text-xs font-semibold ${myAttendance.rsvp_status === 'declined' ? 'bg-danger text-white border-danger' : 'border-outline hover:bg-surface-2 text-on-surface-muted'}`}>
                  <XCircle size={11} /> Decline
                </button>
              </div>
            </div>
          )}
        </div>

        {canEdit && meeting.status !== 'cancelled' && (
          <div className="px-5 py-3 border-t border-outline flex items-center gap-2">
            <button onClick={onEdit}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold border border-outline hover:bg-surface-2 text-on-surface-muted">
              <Pencil size={11} /> Edit
            </button>
            <button onClick={onCancel}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-danger border border-danger/30 hover:bg-danger/10">
              <Trash2 size={11} /> Cancel meeting
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Calendar grid (week view) ────────────────────────────────
function CalendarGrid({ meetings, onOpen }: { meetings: Meeting[]; onOpen: (id: string) => void }) {
  const [anchor, setAnchor] = useState(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; });
  const startOfWeek = useMemo(() => {
    const d = new Date(anchor); const dow = d.getDay(); const diff = (dow === 0 ? -6 : 1 - dow);  // Monday start
    d.setDate(d.getDate() + diff); return d;
  }, [anchor]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = new Date(startOfWeek); d.setDate(d.getDate() + i); return d;
  }), [startOfWeek]);
  const nudge = (n: number) => { const d = new Date(anchor); d.setDate(d.getDate() + n * 7); setAnchor(d); };
  const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); setAnchor(d); };

  // Group meetings by day (YYYY-MM-DD)
  const byDay = useMemo(() => {
    const m = new Map<string, Meeting[]>();
    for (const meet of meetings) {
      const k = new Date(meet.start_at).toDateString();
      const arr = m.get(k) ?? [];
      arr.push(meet);
      m.set(k, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.start_at.localeCompare(b.start_at));
    return m;
  }, [meetings]);

  const hours = Array.from({ length: 14 }, (_, i) => 8 + i);   // 8am – 9pm
  const rowHeight = 40;   // px per hour
  const dayColMinWidth = 140;

  const laneCount = 1;   // trivial layout; overlapping meetings just stack visually.

  const posFor = (m: Meeting): { top: number; height: number } => {
    const s = new Date(m.start_at), e = new Date(m.end_at);
    const startHours = s.getHours() + s.getMinutes() / 60;
    const endHours   = e.getHours() + e.getMinutes() / 60;
    const top    = Math.max(0, (startHours - hours[0]) * rowHeight);
    const height = Math.max(20, (endHours - startHours) * rowHeight - 2);
    return { top, height };
  };

  const isToday = (d: Date) => d.toDateString() === new Date().toDateString();

  return (
    <div className="rounded-xl-2 border border-outline bg-surface overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-outline">
        <button onClick={() => nudge(-1)} className="p-1 rounded hover:bg-surface-2 text-on-surface-muted"><ChevronLeft size={14} /></button>
        <button onClick={today} className="text-xs font-semibold px-2 py-1 rounded hover:bg-surface-2 text-on-surface-muted">Today</button>
        <button onClick={() => nudge(1)} className="p-1 rounded hover:bg-surface-2 text-on-surface-muted"><ChevronRight size={14} /></button>
        <p className="ml-2 text-sm font-semibold text-on-surface">
          {days[0].toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – {days[6].toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
        </p>
      </div>
      <div className="overflow-x-auto">
        <div className="grid" style={{ gridTemplateColumns: `56px repeat(7, minmax(${dayColMinWidth}px, 1fr))` }}>
          {/* Header row */}
          <div />
          {days.map((d, i) => (
            <div key={i} className={`px-2 py-2 border-b border-outline text-center text-[11px] ${isToday(d) ? 'bg-accent/5' : ''}`}>
              <p className="uppercase tracking-wider font-bold text-on-surface-muted">{d.toLocaleDateString('en-IN', { weekday: 'short' })}</p>
              <p className={`text-lg font-mono ${isToday(d) ? 'text-accent font-bold' : 'text-on-surface'}`}>{d.getDate()}</p>
            </div>
          ))}
          {/* Hour rail */}
          <div className="border-r border-outline">
            {hours.map(h => (
              <div key={h} style={{ height: rowHeight }} className="text-right pr-2 pt-1 text-[10px] font-mono text-on-surface-subtle border-b border-outline/40">
                {h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`}
              </div>
            ))}
          </div>
          {/* 7 day columns */}
          {days.map((d, i) => {
            const dayMeetings = byDay.get(d.toDateString()) ?? [];
            return (
              <div key={i} className="relative border-r border-outline last:border-r-0" style={{ height: hours.length * rowHeight }}>
                {/* Hour grid lines */}
                {hours.map(h => (
                  <div key={h} style={{ height: rowHeight }} className="border-b border-outline/40" />
                ))}
                {/* Meeting blocks */}
                {dayMeetings.map(m => {
                  const p = posFor(m);
                  return (
                    <button key={m.id} onClick={() => onOpen(m.id)}
                      className="absolute left-1 right-1 rounded border border-accent/40 bg-accent/10 hover:bg-accent/20 text-accent text-left px-1.5 py-0.5 overflow-hidden"
                      style={{ top: p.top, height: p.height }}>
                      <p className="text-[10px] font-mono">{new Date(m.start_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })}</p>
                      <p className="text-[11px] font-semibold truncate">{m.title}</p>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

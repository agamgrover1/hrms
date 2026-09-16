import { useEffect, useMemo, useState } from 'react';
import { Search, MessageSquare, Trash2, Loader2, ChevronLeft } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { toast } from '../components/Toaster';

// Team Notes — dedicated private-notes surface. Two-pane layout:
//   left  — searchable list of active employees (name / designation /
//           department only; no salary or PII beyond what a colleague
//           already sees in a person picker)
//   right — the selected employee's notes list + a composer
//
// Deliberately separate from the /employees route: coord doesn't
// need — and shouldn't get — the full profile page (compensation,
// warnings, salary history, edit button). This surface exposes only
// the notes flow and nothing else, matching the "private notes for
// each employee, nothing more" scope.
//
// Backend permission (canManagePerformanceNotesFor) is authoritative;
// the client only paints what the API returns. A plain employee
// hitting this URL directly gets bounced by ProtectedRoute.

type EmpSlim = {
  id: string;
  employee_id: string;
  name: string;
  designation?: string | null;
  department?: string | null;
  status?: string | null;
  avatar?: string | null;
};

type Note = {
  id: number | string;
  employee_id: string;
  note_date: string;
  note_text: string;
  note_type: 'positive' | 'neutral' | 'concern';
  created_by_id?: string | null;
  created_by_name?: string | null;
};

const NOTE_TYPE_META: Record<Note['note_type'], { label: string; className: string }> = {
  positive: { label: '👍 Positive', className: 'bg-success-container text-success border-success/30' },
  neutral:  { label: '➜ Neutral',  className: 'bg-surface-2 text-on-surface-muted border-outline' },
  concern:  { label: '⚠ Concern',  className: 'bg-warning-container text-warning border-warning/30' },
};

export default function Notes() {
  const { user } = useAuth();

  const [employees, setEmployees] = useState<EmpSlim[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [search, setSearch] = useState('');

  const [selected, setSelected] = useState<EmpSlim | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(false);

  const [draft, setDraft] = useState('');
  const [draftType, setDraftType] = useState<Note['note_type']>('neutral');
  const [draftDate, setDraftDate] = useState(new Date().toISOString().slice(0, 10));
  const [savingNote, setSavingNote] = useState(false);

  // Two-pane collapse on mobile — same drill pattern used on /mail.
  // Below lg: list is visible until someone taps a row, then the
  // detail slides in; back arrow returns to the list.
  const [mobileView, setMobileView] = useState<'list' | 'detail'>('list');

  useEffect(() => {
    setLoadingList(true);
    api.getEmployeesSlim()
      .then(rows => {
        // Active-only, alphabetical. Slim payload has no salary, no
        // PII — same shape used by every person-picker in the app.
        const active = (rows as EmpSlim[])
          .filter(e => (e.status ?? 'active') === 'active')
          .sort((a, b) => a.name.localeCompare(b.name));
        setEmployees(active);
      })
      .catch(e => toast.error('Failed to load employees', e?.body?.error ?? e?.message))
      .finally(() => setLoadingList(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter(e =>
      e.name.toLowerCase().includes(q)
      || (e.employee_id ?? '').toLowerCase().includes(q)
      || (e.designation ?? '').toLowerCase().includes(q)
      || (e.department ?? '').toLowerCase().includes(q)
    );
  }, [employees, search]);

  const openEmployee = (emp: EmpSlim) => {
    setSelected(emp);
    setMobileView('detail');
    setLoadingNotes(true);
    setNotes([]);
    api.getPerformanceNotes(emp.id)
      .then(rs => setNotes((Array.isArray(rs) ? rs : []) as Note[]))
      .catch(e => toast.error('Failed to load notes', e?.body?.error ?? e?.message))
      .finally(() => setLoadingNotes(false));
  };

  const addNote = async () => {
    if (!selected || !draft.trim()) return;
    setSavingNote(true);
    try {
      const saved = await api.addPerformanceNote({
        employee_id: selected.id,
        note_date: draftDate,
        note_text: draft.trim(),
        note_type: draftType,
        created_by_id: user?.id,
        created_by_name: user?.name,
      });
      setNotes(rs => [saved as Note, ...rs]);
      setDraft('');
      setDraftType('neutral');
    } catch (e: any) {
      toast.error('Save failed', e?.body?.error ?? e?.message ?? 'Please try again.');
    } finally {
      setSavingNote(false);
    }
  };

  const removeNote = async (id: number | string) => {
    if (!confirm('Delete this note?')) return;
    try {
      await api.deletePerformanceNote(String(id));
      setNotes(rs => rs.filter(n => n.id !== id));
    } catch (e: any) {
      toast.error('Delete failed', e?.body?.error ?? e?.message);
    }
  };

  const initials = (name: string) => name.split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="mb-4">
        <h1 className="font-display text-2xl font-bold text-on-surface flex items-center gap-2">
          <MessageSquare size={20} className="text-accent" /> Team notes
        </h1>
        <p className="text-xs text-on-surface-muted mt-1">
          Private observations on team members — visible to admin, HR, and coordinators. Never visible to the employee.
        </p>
      </div>

      {/* Two-pane: list left, detail right; mobile collapses to one at a time */}
      <div className="flex-1 min-h-0 lg:grid lg:grid-cols-[320px_1fr] gap-3 flex flex-col">
        {/* List */}
        <aside className={`rounded-xl-2 border border-outline bg-surface flex-col flex-1 min-h-0 overflow-hidden ${mobileView === 'list' ? 'flex' : 'hidden'} lg:flex`}>
          <div className="px-3 py-2 border-b border-outline flex items-center gap-2">
            <Search size={12} className="text-on-surface-subtle flex-shrink-0" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search name, code, department…"
              className="flex-1 bg-transparent border-0 text-xs focus:outline-none placeholder:text-on-surface-subtle" />
            <span className="text-[10px] font-mono text-on-surface-subtle">{filtered.length}</span>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {loadingList ? (
              <div className="p-8 text-center text-xs text-on-surface-subtle">
                <Loader2 size={14} className="inline animate-spin mr-1" /> Loading…
              </div>
            ) : filtered.length === 0 ? (
              <p className="p-8 text-center text-xs text-on-surface-subtle italic">
                {search ? 'No match.' : 'No employees yet.'}
              </p>
            ) : filtered.map(emp => {
              const active = selected?.id === emp.id;
              return (
                <button key={emp.id} onClick={() => openEmployee(emp)}
                  className={`w-full text-left px-3 py-2.5 border-b border-outline flex items-center gap-2.5 hover:bg-surface-2 transition-colors ${active ? 'bg-brand-container/40 border-l-2 border-l-brand' : ''}`}>
                  <div className="w-7 h-7 rounded-full bg-accent/15 text-accent text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                    {initials(emp.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm truncate ${active ? 'font-semibold text-on-surface' : 'text-on-surface'}`}>{emp.name}</p>
                    <p className="text-[11px] text-on-surface-subtle truncate">
                      {emp.designation ?? '—'}{emp.department ? ` · ${emp.department}` : ''}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Detail */}
        <section className={`rounded-xl-2 border border-outline bg-surface flex-col flex-1 min-h-0 overflow-hidden ${mobileView === 'detail' ? 'flex' : 'hidden'} lg:flex`}>
          {!selected ? (
            <div className="p-10 flex-1 flex items-center justify-center text-center">
              <div>
                <MessageSquare size={28} className="mx-auto text-on-surface-subtle mb-2" />
                <p className="text-sm text-on-surface-muted">Pick someone on the left to view or add private notes.</p>
              </div>
            </div>
          ) : (
            <>
              {/* Detail header */}
              <div className="px-5 py-3 border-b border-outline flex items-center gap-3">
                <button onClick={() => setMobileView('list')}
                  className="lg:hidden p-1 -ml-1 rounded hover:bg-surface-2 text-on-surface-muted"
                  aria-label="Back to list">
                  <ChevronLeft size={14} />
                </button>
                <div className="w-9 h-9 rounded-full bg-accent/15 text-accent text-xs font-bold flex items-center justify-center flex-shrink-0">
                  {initials(selected.name)}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-on-surface truncate">{selected.name}</p>
                  <p className="text-[11px] text-on-surface-subtle truncate">
                    {selected.designation ?? '—'}{selected.department ? ` · ${selected.department}` : ''} · {selected.employee_id}
                  </p>
                </div>
                <span className="ml-auto text-[10px] text-on-surface-subtle italic whitespace-nowrap">
                  not visible to the employee
                </span>
              </div>

              {/* Composer */}
              <div className="px-5 py-4 border-b border-outline space-y-2 bg-surface-2/40 flex-shrink-0">
                <div className="flex flex-wrap items-center gap-2">
                  <input type="date" value={draftDate} onChange={e => setDraftDate(e.target.value)}
                    className="text-xs bg-surface border border-outline rounded-lg px-2 py-1.5 focus:outline-none focus:border-accent" />
                  <select value={draftType} onChange={e => setDraftType(e.target.value as Note['note_type'])}
                    className="text-xs bg-surface border border-outline rounded-lg px-2 py-1.5 focus:outline-none focus:border-accent">
                    <option value="positive">👍 Positive</option>
                    <option value="neutral">➜ Neutral</option>
                    <option value="concern">⚠ Concern</option>
                  </select>
                  <span className="text-[11px] text-on-surface-subtle italic ml-auto">Recorded by {user?.name ?? 'you'}</span>
                </div>
                <textarea value={draft} onChange={e => setDraft(e.target.value)}
                  rows={2} placeholder="One-line observation — what happened, what's next…"
                  className="w-full text-sm bg-surface border border-outline rounded-lg px-3 py-2 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 resize-y" />
                <div className="flex justify-end">
                  <button onClick={addNote} disabled={!draft.trim() || savingNote}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-on-accent text-xs font-semibold hover:opacity-90 disabled:opacity-50">
                    {savingNote ? 'Saving…' : 'Add note'}
                  </button>
                </div>
              </div>

              {/* Notes list */}
              <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-outline">
                {loadingNotes ? (
                  <p className="px-5 py-8 text-center text-xs text-on-surface-subtle">
                    <Loader2 size={14} className="inline animate-spin mr-1" /> Loading notes…
                  </p>
                ) : notes.length === 0 ? (
                  <p className="px-5 py-10 text-center text-xs text-on-surface-subtle italic">
                    No notes yet for {selected.name.split(' ')[0]}.
                  </p>
                ) : notes.map(n => {
                  const meta = NOTE_TYPE_META[n.note_type] ?? NOTE_TYPE_META.neutral;
                  return (
                    <div key={n.id} className="px-5 py-3 flex items-start gap-3">
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${meta.className} flex-shrink-0 mt-0.5 whitespace-nowrap`}>
                        {meta.label}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] text-on-surface-subtle num-mono">
                          {new Date(n.note_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                          {n.created_by_name && <> · {n.created_by_name}</>}
                        </p>
                        <p className="text-sm text-on-surface mt-1 whitespace-pre-line leading-relaxed">{n.note_text}</p>
                      </div>
                      <button onClick={() => removeNote(n.id)}
                        className="p-1 rounded text-on-surface-subtle hover:text-danger hover:bg-danger/10"
                        title="Delete note">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

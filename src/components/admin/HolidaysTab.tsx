import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Pencil, X, PartyPopper, AlertCircle, Calendar } from 'lucide-react';
import { api } from '../../services/api';

interface Holiday {
  id: number;
  date: string;
  name: string;
  type: string;
  notes: string | null;
}

const TYPE_OPTIONS = [
  { value: 'public',   label: 'Public · everyone off' },
  { value: 'regional', label: 'Regional · location-specific' },
  { value: 'optional', label: 'Optional · employee choice' },
];

const TYPE_CLS: Record<string, string> = {
  public:   'bg-brand-container text-brand',
  regional: 'bg-accent-container text-accent',
  optional: 'bg-warning-container text-warning',
};

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function fmtDate(d: string): string {
  try {
    const dt = new Date(d.slice(0, 10) + 'T12:00:00Z');
    return dt.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return d; }
}

const BLANK = { date: '', name: '', type: 'public', notes: '' };

export default function HolidaysTab() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [draft, setDraft] = useState<{ id?: number } & typeof BLANK | null>(null);
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true); setErr('');
    api.getHolidays(year)
      .then(d => setHolidays(d as Holiday[]))
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, [year]);

  // Group by month
  const grouped = useMemo(() => {
    const out = new Map<number, Holiday[]>();
    for (const h of holidays) {
      const m = new Date(h.date.slice(0, 10) + 'T12:00:00Z').getMonth();
      const arr = out.get(m);
      if (arr) arr.push(h); else out.set(m, [h]);
    }
    return Array.from(out.entries()).sort((a, b) => a[0] - b[0]);
  }, [holidays]);

  const save = async () => {
    if (!draft) return;
    if (!draft.date || !draft.name.trim()) { setErr('Date and name are required'); return; }
    setSaving(true); setErr('');
    try {
      const payload = {
        date: draft.date,
        name: draft.name.trim(),
        type: draft.type || 'public',
        notes: draft.notes.trim() || undefined,
      };
      if (draft.id) await api.updateHoliday(draft.id, payload);
      else await api.addHoliday(payload);
      setDraft(null);
      load();
    } catch (e: any) { setErr(e.message); }
    finally { setSaving(false); }
  };

  const remove = async (h: Holiday) => {
    if (!confirm(`Delete holiday "${h.name}" on ${fmtDate(h.date)}?`)) return;
    try { await api.deleteHoliday(h.id); load(); } catch (e: any) { setErr(e.message); }
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Calendar size={14} className="text-on-surface-subtle" />
          <select value={year} onChange={e => setYear(Number(e.target.value))}
            className="text-sm bg-surface border border-outline rounded-lg px-3 py-1.5 focus:outline-none focus:border-accent num-mono">
            {[year - 1, year, year + 1, year + 2].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <span className="text-xs text-on-surface-muted">{holidays.length} {holidays.length === 1 ? 'holiday' : 'holidays'}</span>
        </div>
        <button onClick={() => setDraft({ ...BLANK, date: `${year}-${String(now.getMonth() + 1).padStart(2, '0')}-01` })}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-accent text-on-accent hover:opacity-90">
          <Plus size={13} /> Add holiday
        </button>
      </div>

      <div className="rounded-xl-2 border border-outline bg-surface-2/40 p-3 text-xs text-on-surface-muted">
        <p className="text-on-surface font-semibold text-sm mb-0.5 inline-flex items-center gap-1.5">
          <PartyPopper size={13} className="text-brand" /> Org-wide non-working days
        </p>
        <p>
          Visible to every employee in their portal / team calendar. On these dates, attendance is automatically marked as <b>Holiday</b> — no one needs to be present.
        </p>
      </div>

      {err && <div className="rounded-xl-2 border border-danger/30 bg-danger-container/40 p-3 text-sm text-danger inline-flex items-center gap-2"><AlertCircle size={13} />{err}</div>}

      {loading ? (
        <div className="py-16 text-center text-sm text-on-surface-subtle">Loading…</div>
      ) : holidays.length === 0 ? (
        <div className="bg-surface rounded-xl-2 border border-outline py-16 text-center">
          <PartyPopper size={28} className="mx-auto text-on-surface-subtle mb-2" />
          <p className="text-sm text-on-surface-muted">No holidays set for {year}.</p>
          <button onClick={() => setDraft({ ...BLANK, date: `${year}-01-01` })}
            className="mt-2 text-xs font-semibold text-accent hover:underline">
            Add the first one →
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {grouped.map(([monthIdx, rows]) => (
            <div key={monthIdx} className="bg-surface rounded-xl-2 border border-outline overflow-hidden">
              <div className="px-4 py-2.5 bg-surface-2/40 border-b border-outline">
                <h4 className="font-display text-sm font-bold tracking-tight text-on-surface">{MONTHS[monthIdx]}</h4>
              </div>
              <div className="divide-y divide-outline">
                {rows.map(h => (
                  <div key={h.id} className="px-4 py-3 hover:bg-surface-2/30 flex items-center gap-3">
                    <div className="w-12 text-center shrink-0">
                      <p className="num-mono text-xl font-bold text-on-surface leading-none">{new Date(h.date.slice(0, 10) + 'T12:00:00Z').getDate()}</p>
                      <p className="text-[10px] text-on-surface-subtle uppercase tracking-wide mt-0.5">
                        {new Date(h.date.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-IN', { weekday: 'short' })}
                      </p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-on-surface truncate">{h.name}</p>
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold ${TYPE_CLS[h.type] ?? 'bg-surface-3 text-on-surface-muted'}`}>{h.type}</span>
                      </div>
                      {h.notes && <p className="text-xs text-on-surface-muted mt-0.5">{h.notes}</p>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => setDraft({ id: h.id, date: h.date.slice(0, 10), name: h.name, type: h.type, notes: h.notes ?? '' })}
                        className="p-1.5 rounded hover:bg-surface-2 text-on-surface-muted hover:text-on-surface" title="Edit">
                        <Pencil size={13} />
                      </button>
                      <button onClick={() => remove(h)}
                        className="p-1.5 rounded hover:bg-danger-container text-on-surface-muted hover:text-danger" title="Delete">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {draft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setDraft(null)}>
          <div className="bg-surface rounded-xl-3 border border-outline shadow-elev-3 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-outline flex items-center justify-between">
              <h3 className="text-base font-bold text-on-surface">{draft.id ? 'Edit holiday' : 'New holiday'}</h3>
              <button onClick={() => setDraft(null)} className="p-1.5 rounded-lg hover:bg-surface-2"><X size={16} className="text-on-surface-muted" /></button>
            </div>
            <div className="p-5 space-y-3">
              <Field label="Date" required>
                <input type="date" value={draft.date} onChange={e => setDraft({ ...draft!, date: e.target.value })}
                  className={inputCls + ' num-mono'} />
              </Field>
              <Field label="Name" required>
                <input value={draft.name} onChange={e => setDraft({ ...draft!, name: e.target.value })}
                  placeholder="e.g. Diwali"
                  className={inputCls} />
              </Field>
              <Field label="Type">
                <select value={draft.type} onChange={e => setDraft({ ...draft!, type: e.target.value })} className={inputCls}>
                  {TYPE_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </Field>
              <Field label="Notes (optional)">
                <textarea value={draft.notes} onChange={e => setDraft({ ...draft!, notes: e.target.value })} rows={2}
                  placeholder="Anything employees should know"
                  className={inputCls} />
              </Field>
            </div>
            <div className="px-5 py-3 border-t border-outline flex items-center justify-end gap-2 bg-surface-2/30">
              <button onClick={() => setDraft(null)} className="px-3 py-2 rounded-lg text-sm font-medium text-on-surface-muted hover:bg-surface-2">Cancel</button>
              <button onClick={save} disabled={saving}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-accent text-on-accent disabled:opacity-50">
                {saving ? 'Saving…' : (draft.id ? 'Save changes' : 'Add holiday')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inputCls = 'w-full text-sm bg-surface-2 border border-outline focus:border-accent focus:ring-2 focus:ring-accent/20 rounded-lg px-3 py-2 focus:outline-none text-on-surface placeholder:text-on-surface-subtle transition-colors';

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-on-surface-subtle mb-1">
        {label}{required && <span className="text-danger ml-0.5">*</span>}
      </span>
      {children}
    </label>
  );
}

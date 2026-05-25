import { useState, useEffect, useMemo, useCallback } from 'react';
import { Plus, Trash2, X, Search, Copy, ExternalLink, Flag, ClipboardCheck } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

interface Assignment {
  id: string;
  project_id: string;
  employee_id: string;
  employee_name: string | null;
  month: number;
  year: number;
  monthly_hours: number;
  w1_hours: number;
  w2_hours: number;
  w3_hours: number;
  w4_hours: number;
  w5_hours: number;
  notes: string | null;
  project_name?: string;
  project_client_name?: string | null;
  project_type?: string | null;
  dashboard_url?: string | null;
  project_flag?: string | null;
  project_reporting_id?: string | null;
  project_reporting_name?: string | null;
  project_lead_name?: string | null;
}

interface SummaryEmployee {
  employee_id: string;
  employee_name: string;
  w1: number; w2: number; w3: number; w4: number; w5: number; monthly: number;
  variance_w1: number; variance_w2: number; variance_w3: number; variance_w4: number; variance_w5: number;
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const WEEK_KEYS: Array<keyof Assignment> = ['w1_hours', 'w2_hours', 'w3_hours', 'w4_hours', 'w5_hours'];
const TARGET_WEEKLY = 35;

function varianceClass(weeklyAlloc: number) {
  // Color the allocation against the 35h target
  if (weeklyAlloc === 0) return 'text-on-surface-subtle';
  if (weeklyAlloc >= 33 && weeklyAlloc <= 37) return 'text-success bg-success-container';
  if ((weeklyAlloc >= 28 && weeklyAlloc <= 32) || (weeklyAlloc >= 38 && weeklyAlloc <= 40)) return 'text-warning bg-warning-container';
  return 'text-danger bg-danger-container';
}

function num(v: any) { return Number(v ?? 0); }

export default function ProjectHours() {
  const { user } = useAuth();
  const today = new Date();
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [year, setYear] = useState(today.getFullYear());
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [summary, setSummary] = useState<{ employees: SummaryEmployee[]; total_allocated: number; pending_review_count: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [savingCell, setSavingCell] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.getProjectAssignments({ month, year }).then(d => setAssignments(d as Assignment[])).catch(() => {}),
      api.getProjects({ status: 'active' }).then(setProjects).catch(() => {}),
      api.getEmployees().then(setEmployees).catch(() => {}),
      api.getHoursSummary(month, year).then(s => setSummary(s)).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [month, year]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const term = search.toLowerCase();
    if (!term) return assignments;
    return assignments.filter(a =>
      (a.project_name ?? '').toLowerCase().includes(term) ||
      (a.employee_name ?? '').toLowerCase().includes(term) ||
      (a.project_reporting_name ?? '').toLowerCase().includes(term)
    );
  }, [assignments, search]);

  const updateCell = async (a: Assignment, key: keyof Assignment, value: number) => {
    setSavingCell(`${a.id}_${key}`);
    const updated = { ...a, [key]: value };
    const sum = num(updated.w1_hours) + num(updated.w2_hours) + num(updated.w3_hours) + num(updated.w4_hours) + num(updated.w5_hours);
    updated.monthly_hours = sum;
    setAssignments(prev => prev.map(p => p.id === a.id ? updated : p));
    try {
      await api.updateProjectAssignment(a.id, {
        w1_hours: num(updated.w1_hours),
        w2_hours: num(updated.w2_hours),
        w3_hours: num(updated.w3_hours),
        w4_hours: num(updated.w4_hours),
        w5_hours: num(updated.w5_hours),
        notes: updated.notes ?? undefined,
      });
      // Refresh summary so right-rail recalculates
      api.getHoursSummary(month, year).then(s => setSummary(s)).catch(() => {});
    } catch {
      // best-effort: reload all
      load();
    } finally {
      setSavingCell(null);
    }
  };

  const handleDelete = async (a: Assignment) => {
    if (!confirm(`Remove assignment for ${a.employee_name} on ${a.project_name}?`)) return;
    await api.deleteProjectAssignment(a.id).catch(() => {});
    load();
  };

  const handleCopyPrev = async () => {
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    if (!confirm(`Copy all assignments from ${MONTHS[prevMonth-1]} ${prevYear} into ${MONTHS[month-1]} ${year}? Hours will be blanked so you can refill them.`)) return;
    try {
      const res = await api.copyAssignmentsMonth({
        from_month: prevMonth, from_year: prevYear,
        to_month: month, to_year: year,
        blank_hours: true, created_by: user?.name,
      });
      alert(`Copied ${res.copied} assignments.`);
      load();
    } catch (err: any) {
      alert(err.message ?? 'Copy failed.');
    }
  };

  return (
    <div className="space-y-5">
      {/* Header / toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 bg-surface rounded-lg border border-outline px-2 py-1">
          <select value={month} onChange={e => setMonth(Number(e.target.value))}
            className="text-sm bg-transparent focus:outline-none px-1 py-1">
            {MONTHS.map((m, i) => <option key={m} value={i+1}>{m}</option>)}
          </select>
          <select value={year} onChange={e => setYear(Number(e.target.value))}
            className="text-sm bg-transparent focus:outline-none px-1 py-1">
            {[year-1, year, year+1].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-subtle" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter project, employee, reporting…"
            className="w-full pl-9 pr-4 py-2.5 text-sm bg-surface border border-outline rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
        </div>
        <button onClick={handleCopyPrev}
          className="inline-flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium border border-outline bg-surface-2 text-on-surface hover:bg-surface-3 transition-colors">
          <Copy size={14} /> Copy from previous month
        </button>
        <button onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold bg-accent text-on-accent">
          <Plus size={15} /> Add Assignment
        </button>
      </div>

      {/* Summary strip */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <SummaryTile label="Allocated this month" value={`${summary.total_allocated} h`} blobClass="bg-brand/15" stagger={1} />
          <SummaryTile label="Pending review" value={String(summary.pending_review_count)} blobClass="bg-warning/20" stagger={2} accentClass={summary.pending_review_count > 0 ? 'text-danger' : undefined} />
          <SummaryTile label="Active assignments" value={String(filtered.length)} blobClass="bg-brand-container" stagger={3} />
          <SummaryTile label="Employees on plan" value={String(summary.employees.length)} blobClass="bg-accent-container" stagger={4} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">
        {/* Main grid */}
        <div className="bg-surface rounded-xl-2 border border-outline shadow-elev-1 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 border-b border-outline sticky top-0">
              <tr className="text-left text-xs font-semibold text-on-surface-muted uppercase tracking-wider">
                <th className="px-3 py-3">Project</th>
                <th className="px-3 py-3">Employee</th>
                <th className="px-3 py-3">Reporting</th>
                <th className="px-3 py-3 text-center bg-surface-3">M</th>
                <th className="px-3 py-3 text-center">W1</th>
                <th className="px-3 py-3 text-center">W2</th>
                <th className="px-3 py-3 text-center">W3</th>
                <th className="px-3 py-3 text-center">W4</th>
                <th className="px-3 py-3 text-center">W5</th>
                <th className="px-3 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline">
              {loading ? (
                <tr><td colSpan={10} className="px-3 py-8 text-center text-on-surface-subtle">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={10} className="px-3 py-12 text-center">
                  <ClipboardCheck size={28} className="mx-auto text-on-surface-subtle mb-2" />
                  <p className="text-sm text-on-surface-muted">No assignments for {MONTHS[month-1]} {year}.</p>
                  <p className="text-xs text-on-surface-subtle mt-0.5">Use "Add Assignment" or "Copy from previous month".</p>
                </td></tr>
              ) : filtered.map(a => {
                const flagBg = a.project_flag === 'red' ? 'rgb(var(--danger-container) / 0.4)' : a.project_flag === 'yellow' ? 'rgb(var(--warning-container) / 0.4)' : 'transparent';
                return (
                  <tr key={a.id} style={{ background: flagBg }}>
                    <td className="px-3 py-2">
                      <div className="flex items-start gap-2">
                        {a.project_flag && (
                          <Flag size={12} className={`mt-0.5 ${a.project_flag === 'red' ? 'text-danger' : 'text-warning'}`} />
                        )}
                        <div>
                          <p className="font-medium text-on-surface leading-tight">{a.project_name}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            {a.project_client_name && <span className="text-[11px] text-on-surface-muted">{a.project_client_name}</span>}
                            {a.dashboard_url && (
                              <a href={a.dashboard_url} target="_blank" rel="noopener noreferrer"
                                className="text-[11px] text-brand hover:underline inline-flex items-center gap-0.5">
                                <ExternalLink size={9} />
                              </a>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-on-surface-muted">{a.employee_name}</td>
                    <td className="px-3 py-2 text-on-surface-muted text-xs">{a.project_reporting_name ?? '—'}</td>
                    <td className="px-3 py-2 text-center font-semibold text-on-surface bg-surface-2">
                      <span className="num-mono">{num(a.monthly_hours)}</span>
                    </td>
                    {WEEK_KEYS.map(k => (
                      <HoursCell key={k}
                        value={num(a[k])}
                        saving={savingCell === `${a.id}_${k}`}
                        onCommit={v => updateCell(a, k, v)}
                      />
                    ))}
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => handleDelete(a)} className="p-1.5 rounded hover:bg-danger-container" title="Delete">
                        <Trash2 size={13} className="text-danger" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Right rail */}
        <aside className="group relative bg-surface rounded-xl-2 border border-outline shadow-elev-1 overflow-hidden h-fit lg:sticky lg:top-4">
          <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-brand/15 blur-2xl opacity-50" />
          <div className="relative px-4 py-3 border-b border-outline bg-surface-2">
            <p className="font-display text-xl font-bold tracking-tight text-on-surface">Per-employee weekly</p>
            <p className="text-[11px] text-on-surface-subtle mt-0.5">Target: <span className="num-mono">{TARGET_WEEKLY}</span>h/week</p>
          </div>
          <div className="relative overflow-auto max-h-[70vh]">
            <table className="w-full text-xs">
              <thead className="bg-surface-2 text-on-surface-muted">
                <tr>
                  <th className="px-2 py-2 text-left">Employee</th>
                  <th className="px-1 py-2 text-center">W1</th>
                  <th className="px-1 py-2 text-center">W2</th>
                  <th className="px-1 py-2 text-center">W3</th>
                  <th className="px-1 py-2 text-center">W4</th>
                  <th className="px-1 py-2 text-center">W5</th>
                  <th className="px-1 py-2 text-center bg-surface-3">M</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline">
                {!summary || summary.employees.length === 0 ? (
                  <tr><td colSpan={7} className="px-3 py-6 text-center text-on-surface-subtle text-xs">No data yet.</td></tr>
                ) : summary.employees.map(e => (
                  <tr key={e.employee_id}>
                    <td className="px-2 py-1.5 font-medium text-on-surface whitespace-nowrap">{e.employee_name || '—'}</td>
                    {([e.w1, e.w2, e.w3, e.w4, e.w5] as number[]).map((w, i) => (
                      <td key={i} className={`px-1 py-1.5 text-center font-medium ${varianceClass(w)}`}>
                        <span className="num-mono">{w}</span>
                      </td>
                    ))}
                    <td className="px-1 py-1.5 text-center font-bold text-on-surface bg-surface-2">
                      <span className="num-mono">{e.monthly}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="relative px-3 py-2 border-t border-outline bg-surface-2 text-[10px] text-on-surface-muted flex items-center gap-3">
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-success" />33–37</span>
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-warning" />28–32 / 38–40</span>
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-danger" />other</span>
          </div>
        </aside>
      </div>

      {showAdd && (
        <AssignmentForm
          projects={projects}
          employees={employees}
          month={month}
          year={year}
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); load(); }}
          createdBy={user?.name}
        />
      )}
    </div>
  );
}

function SummaryTile({ label, value, accentClass, blobClass, stagger }: { label: string; value: string; accentClass?: string; blobClass?: string; stagger?: number }) {
  return (
    <div className={`group relative bg-surface rounded-xl-2 p-4 border border-outline shadow-elev-1 overflow-hidden animate-fade-up stagger-${stagger ?? 1}`}>
      <div className={`absolute -top-8 -right-8 w-28 h-28 rounded-full ${blobClass ?? 'bg-brand/15'} blur-2xl opacity-50`} />
      <div className="relative">
        <p className={`num-mono text-2xl font-bold ${accentClass ?? 'text-on-surface'}`}>{value}</p>
        <p className="text-xs text-on-surface-muted mt-0.5">{label}</p>
      </div>
    </div>
  );
}

function HoursCell({ value, saving, onCommit }: { value: number; saving: boolean; onCommit: (v: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  const commit = () => {
    setEditing(false);
    const n = Number(draft);
    if (!Number.isNaN(n) && n !== value) onCommit(Math.max(0, n));
  };
  return (
    <td className={`px-1 py-1 text-center ${saving ? 'opacity-60' : ''}`}>
      {editing ? (
        <input
          autoFocus
          type="number"
          step="0.5"
          min="0"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setEditing(false); setDraft(String(value)); } }}
          className="num-mono w-14 text-center text-sm border border-accent rounded px-1 py-1 focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
      ) : (
        <button
          onClick={() => setEditing(true)}
          className={`num-mono w-14 px-2 py-1 rounded text-sm font-medium hover:bg-surface-2 ${value === 0 ? 'text-on-surface-subtle' : 'text-on-surface'}`}
        >
          {value}
        </button>
      )}
    </td>
  );
}

function AssignmentForm({
  projects, employees, month, year, onClose, onSaved, createdBy,
}: {
  projects: any[];
  employees: any[];
  month: number;
  year: number;
  onClose: () => void;
  onSaved: () => void;
  createdBy?: string;
}) {
  const [form, setForm] = useState({
    project_id: projects[0]?.id ?? '',
    employee_id: '',
    w1_hours: '0', w2_hours: '0', w3_hours: '0', w4_hours: '0', w5_hours: '0',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const setF = (k: keyof typeof form, v: string) => setForm(f => ({ ...f, [k]: v }));

  const total = num(form.w1_hours) + num(form.w2_hours) + num(form.w3_hours) + num(form.w4_hours) + num(form.w5_hours);

  const handleSave = async () => {
    if (!form.project_id || !form.employee_id) { setError('Project and employee are required.'); return; }
    setSaving(true);
    const emp = employees.find(e => e.id === form.employee_id);
    try {
      await api.createProjectAssignment({
        project_id: form.project_id,
        employee_id: form.employee_id,
        employee_name: emp?.name ?? null,
        month, year,
        w1_hours: num(form.w1_hours), w2_hours: num(form.w2_hours),
        w3_hours: num(form.w3_hours), w4_hours: num(form.w4_hours),
        w5_hours: num(form.w5_hours),
        notes: form.notes || undefined,
        created_by: createdBy,
      });
      onSaved();
    } catch (err: any) {
      setError(err.message ?? 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/55 backdrop-blur-sm p-4">
      <div className="bg-surface rounded-2xl shadow-elev-4 border border-outline w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-5 border-b border-outline">
          <h3 className="font-display text-xl font-bold tracking-tight text-on-surface">New Assignment · {MONTHS[month-1]} {year}</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-surface-2 rounded-lg"><X size={16} className="text-on-surface-muted" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="text-xs font-medium text-on-surface-muted mb-1.5 block">Project *</label>
            <select value={form.project_id} onChange={e => setF('project_id', e.target.value)}
              className="w-full border border-outline rounded-lg px-3 py-2.5 text-sm bg-surface">
              <option value="">— Select project —</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}{p.client_name ? ` (${p.client_name})` : ''}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-on-surface-muted mb-1.5 block">Employee *</label>
            <select value={form.employee_id} onChange={e => setF('employee_id', e.target.value)}
              className="w-full border border-outline rounded-lg px-3 py-2.5 text-sm bg-surface">
              <option value="">— Select employee —</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-on-surface-muted mb-1.5 block">Weekly hours</label>
            <div className="grid grid-cols-5 gap-2">
              {(['w1_hours','w2_hours','w3_hours','w4_hours','w5_hours'] as Array<keyof typeof form>).map((k, i) => (
                <div key={k}>
                  <p className="text-[10px] text-on-surface-subtle mb-1">W{i+1}</p>
                  <input
                    type="number" step="0.5" min="0"
                    value={form[k]} onChange={e => setF(k, e.target.value)}
                    className="num-mono w-full border border-outline rounded-lg px-2 py-2 text-sm text-center bg-surface"
                  />
                </div>
              ))}
            </div>
            <p className="text-xs text-on-surface-muted mt-2">Monthly total: <span className="num-mono font-semibold text-on-surface">{total} h</span></p>
          </div>
          <div>
            <label className="text-xs font-medium text-on-surface-muted mb-1.5 block">Notes</label>
            <textarea value={form.notes} onChange={e => setF('notes', e.target.value)} rows={2}
              className="w-full border border-outline rounded-lg px-3 py-2.5 text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-accent/20 resize-none" />
          </div>
          {error && <p className="text-sm text-danger bg-danger-container px-3 py-2 rounded-lg">{error}</p>}
        </div>
        <div className="px-6 py-4 border-t border-outline flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-on-surface-muted hover:bg-surface-2 rounded-lg">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-2 text-sm font-semibold bg-accent text-on-accent rounded-lg disabled:opacity-50">
            {saving ? 'Saving…' : 'Create Assignment'}
          </button>
        </div>
      </div>
    </div>
  );
}

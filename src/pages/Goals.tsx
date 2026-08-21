import { useEffect, useMemo, useState } from 'react';
import { Target, Plus, Trash2, ChevronDown, ChevronRight, Check, X, Loader2, Calendar, User } from 'lucide-react';
import { api, type Goal, type GoalStatus, type KeyResult } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { toast } from '../components/Toaster';

const STATUS_META: Record<Goal['health'], { label: string; badge: string }> = {
  on_track: { label: 'On track',   badge: 'bg-success/15 text-success' },
  at_risk:  { label: 'At risk',    badge: 'bg-warning/15 text-warning' },
  off_track:{ label: 'Off track',  badge: 'bg-danger/15 text-danger' },
  complete: { label: 'Complete',   badge: 'bg-brand/15 text-brand' },
  archived: { label: 'Archived',   badge: 'bg-surface-2 text-on-surface-subtle' },
};
const STATUS_OPTIONS: GoalStatus[] = ['active', 'on_track', 'at_risk', 'off_track', 'complete', 'archived'];

type Scope = 'all' | 'mine';

export default function Goals() {
  const { user } = useAuth();
  const canManage = ['admin', 'hr_manager', 'project_coordinator'].includes(user?.role ?? '');
  const [scope, setScope] = useState<Scope>(user?.employee_id_ref ? 'mine' : 'all');
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api.listGoals({ scope })
      .then(setGoals)
      .catch((e: any) => toast.error('Failed to load goals', e?.message ?? 'Please try again.'))
      .finally(() => setLoading(false));
  };
  useEffect(load, [scope]);

  const grouped = useMemo(() => {
    const map = new Map<string, Goal[]>();
    for (const g of goals) {
      const key = g.project_name ?? 'Org-wide';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(g);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a === 'Org-wide' ? -1 : b === 'Org-wide' ? 1 : a.localeCompare(b));
  }, [goals]);

  const summary = useMemo(() => {
    const total = goals.length;
    const done  = goals.filter(g => g.health === 'complete').length;
    const risk  = goals.filter(g => g.health === 'at_risk').length;
    const off   = goals.filter(g => g.health === 'off_track').length;
    const avg   = total ? Math.round(goals.reduce((a, g) => a + g.progress, 0) / total) : 0;
    return { total, done, risk, off, avg };
  }, [goals]);

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="inline-flex items-center gap-2">
            <Target className="text-accent" size={22} />
            <h1 className="font-display text-2xl font-bold text-on-surface">Goals</h1>
          </div>
          <p className="text-xs text-on-surface-muted mt-0.5">
            Objectives + measurable key results. Progress rolls up as KR values move.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {user?.employee_id_ref && (
            <div className="inline-flex items-center gap-1 rounded-lg border border-outline bg-surface p-1">
              {(['mine', 'all'] as Scope[]).map(s => (
                <button key={s} onClick={() => setScope(s)}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap ${scope === s ? 'bg-accent text-on-accent' : 'text-on-surface-muted hover:bg-surface-2'}`}>
                  {s === 'mine' ? 'My goals' : 'All goals'}
                </button>
              ))}
            </div>
          )}
          <button onClick={() => setShowNew(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent text-on-accent text-sm font-semibold hover:opacity-90">
            <Plus size={14} /> New goal
          </button>
        </div>
      </div>

      {goals.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <SummaryCard label="Goals" value={summary.total} />
          <SummaryCard label="Avg progress" value={`${summary.avg}%`} />
          <SummaryCard label="Complete" value={summary.done} tone="success" />
          <SummaryCard label="At risk" value={summary.risk} tone="warning" />
          <SummaryCard label="Off track" value={summary.off} tone="danger" />
        </div>
      )}

      {loading && goals.length === 0 && (
        <div className="p-10 text-center text-sm text-on-surface-muted">Loading…</div>
      )}
      {!loading && goals.length === 0 && (
        <div className="rounded-xl-2 border border-dashed border-outline bg-surface p-10 text-center">
          <Target className="mx-auto text-on-surface-subtle" size={32} />
          <p className="mt-2 text-sm font-semibold text-on-surface">No goals yet</p>
          <p className="text-xs text-on-surface-subtle mt-1">Set a first objective — you can add measurable key results after creating it.</p>
          <button onClick={() => setShowNew(true)}
            className="inline-flex items-center gap-1.5 mt-4 px-3 py-2 rounded-lg bg-accent text-on-accent text-sm font-semibold hover:opacity-90">
            <Plus size={14} /> Create goal
          </button>
        </div>
      )}

      {grouped.map(([groupName, list]) => (
        <div key={groupName} className="space-y-2">
          <div className="flex items-baseline gap-2 mt-2">
            <h3 className="text-[10px] uppercase tracking-wider text-on-surface-muted font-bold">{groupName}</h3>
            <span className="text-[10px] font-mono text-on-surface-subtle">{list.length}</span>
          </div>
          <div className="space-y-2">
            {list.map(g => (
              <GoalRow key={g.id} goal={g}
                expanded={expanded === g.id}
                onToggle={() => setExpanded(v => v === g.id ? null : g.id)}
                canManage={canManage || g.owner_id === (user?.employee_id_ref ?? null)}
                onChanged={load} />
            ))}
          </div>
        </div>
      ))}

      {showNew && (
        <NewGoalModal onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load(); }} />
      )}
    </div>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: number | string; tone?: 'success' | 'warning' | 'danger' }) {
  const toneCls = tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : tone === 'danger' ? 'text-danger' : 'text-on-surface';
  return (
    <div className="rounded-xl-2 border border-outline bg-surface p-3">
      <p className="text-[10px] uppercase tracking-wider text-on-surface-subtle font-semibold">{label}</p>
      <p className={`font-display text-2xl font-bold mt-1 ${toneCls}`}>{value}</p>
    </div>
  );
}

function GoalRow({ goal, expanded, onToggle, canManage, onChanged }: {
  goal: Goal; expanded: boolean; onToggle: () => void; canManage: boolean; onChanged: () => void;
}) {
  const meta = STATUS_META[goal.health];
  const tone = goal.health === 'off_track' ? 'bg-danger' : goal.health === 'at_risk' ? 'bg-warning' : goal.health === 'complete' ? 'bg-brand' : 'bg-success';
  const overdue = goal.target_date && new Date(goal.target_date) < new Date() && goal.health !== 'complete';
  return (
    <div className="rounded-xl-2 border border-outline bg-surface overflow-hidden">
      <button onClick={onToggle} className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-surface-2">
        {expanded ? <ChevronDown size={16} className="text-on-surface-subtle flex-shrink-0" /> : <ChevronRight size={16} className="text-on-surface-subtle flex-shrink-0" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-sm text-on-surface truncate">{goal.title}</p>
            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${meta.badge}`}>{meta.label}</span>
          </div>
          <div className="flex items-center gap-3 mt-1 text-[11px] text-on-surface-subtle">
            {goal.owner_name && <span className="inline-flex items-center gap-1"><User size={11} />{goal.owner_name}</span>}
            {goal.target_date && (
              <span className={`inline-flex items-center gap-1 ${overdue ? 'text-danger font-semibold' : ''}`}>
                <Calendar size={11} />
                {new Date(goal.target_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                {overdue && ' · past due'}
              </span>
            )}
            <span className="font-mono">{goal.key_results.length} KR{goal.key_results.length === 1 ? '' : 's'}</span>
          </div>
        </div>
        <div className="w-40 flex-shrink-0">
          <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${tone} transition-all`} style={{ width: `${goal.progress}%` }} />
          </div>
          <p className="text-[11px] font-mono text-on-surface-muted text-right mt-0.5">{goal.progress}%</p>
        </div>
      </button>
      {expanded && (
        <GoalDetail goal={goal} canManage={canManage} onChanged={onChanged} />
      )}
    </div>
  );
}

function GoalDetail({ goal, canManage, onChanged }: { goal: Goal; canManage: boolean; onChanged: () => void }) {
  const [showAddKr, setShowAddKr] = useState(false);
  const [krTitle, setKrTitle] = useState('');
  const [krUnit, setKrUnit] = useState('');
  const [krStart, setKrStart] = useState('0');
  const [krTarget, setKrTarget] = useState('');
  const [busy, setBusy] = useState(false);

  const addKr = async () => {
    const target = Number(krTarget);
    if (!krTitle.trim()) { toast.error('Title required'); return; }
    if (!Number.isFinite(target)) { toast.error('Target value must be a number'); return; }
    setBusy(true);
    try {
      await api.createKeyResult(goal.id, {
        title: krTitle.trim(),
        unit: krUnit.trim() || undefined,
        start_value: Number(krStart) || 0,
        current_value: Number(krStart) || 0,
        target_value: target,
      });
      setKrTitle(''); setKrUnit(''); setKrStart('0'); setKrTarget('');
      setShowAddKr(false);
      onChanged();
    } catch (e: any) { toast.error('Could not add KR', e?.body?.error ?? e?.message ?? 'Please try again.'); }
    finally { setBusy(false); }
  };

  const setStatus = async (status: GoalStatus) => {
    try { await api.patchGoal(goal.id, { status }); onChanged(); }
    catch (e: any) { toast.error('Could not update', e?.message ?? 'Please try again.'); }
  };
  const removeGoal = async () => {
    if (!window.confirm(`Delete "${goal.title}"? Its ${goal.key_results.length} key result${goal.key_results.length === 1 ? '' : 's'} go with it.`)) return;
    try { await api.deleteGoal(goal.id); onChanged(); }
    catch (e: any) { toast.error('Could not delete', e?.message ?? 'Please try again.'); }
  };

  return (
    <div className="border-t border-outline bg-surface-2/40 p-4 space-y-4">
      {goal.description && (
        <p className="text-sm text-on-surface-muted whitespace-pre-line max-w-3xl">{goal.description}</p>
      )}

      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] uppercase tracking-wider text-on-surface-muted font-semibold">Key results</p>
          {canManage && !showAddKr && (
            <button onClick={() => setShowAddKr(true)} className="inline-flex items-center gap-1 text-[11px] text-accent hover:opacity-80 font-semibold">
              <Plus size={11} /> Add KR
            </button>
          )}
        </div>
        {goal.key_results.length === 0 && !showAddKr && (
          <p className="text-xs text-on-surface-subtle italic">No key results yet. Add one to start tracking progress.</p>
        )}
        <div className="space-y-1.5">
          {goal.key_results.map(kr => (
            <KrRow key={kr.id} kr={kr} canEdit={canManage} onChanged={onChanged} />
          ))}
        </div>
        {showAddKr && (
          <div className="mt-2 p-3 rounded-lg border border-accent/40 bg-accent/5 grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_1fr_auto] gap-2 items-end">
            <input value={krTitle} onChange={e => setKrTitle(e.target.value)} placeholder="Key result title" className="px-2 py-1.5 rounded border border-outline bg-surface text-sm" autoFocus />
            <input value={krUnit} onChange={e => setKrUnit(e.target.value)} placeholder="Unit (visits, %, …)" className="px-2 py-1.5 rounded border border-outline bg-surface text-sm" />
            <input value={krStart} onChange={e => setKrStart(e.target.value)} placeholder="Start" type="number" className="px-2 py-1.5 rounded border border-outline bg-surface text-sm font-mono" />
            <input value={krTarget} onChange={e => setKrTarget(e.target.value)} placeholder="Target" type="number" className="px-2 py-1.5 rounded border border-outline bg-surface text-sm font-mono" />
            <div className="flex gap-1">
              <button onClick={() => setShowAddKr(false)} className="px-2 py-1.5 rounded text-xs text-on-surface-muted hover:bg-surface">Cancel</button>
              <button onClick={addKr} disabled={busy} className="px-2 py-1.5 rounded bg-accent text-on-accent text-xs font-semibold hover:opacity-90 disabled:opacity-60 inline-flex items-center gap-1">
                {busy && <Loader2 size={11} className="animate-spin" />} Add
              </button>
            </div>
          </div>
        )}
      </div>

      {canManage && (
        <div className="flex items-center gap-2 pt-2 border-t border-outline">
          <span className="text-[10px] uppercase tracking-wider text-on-surface-muted font-semibold">Status</span>
          <select value={goal.status} onChange={e => setStatus(e.target.value as GoalStatus)}
            className="px-2 py-1 rounded border border-outline bg-surface text-xs">
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
          <button onClick={removeGoal} className="ml-auto inline-flex items-center gap-1 text-[11px] text-danger hover:opacity-80">
            <Trash2 size={11} /> Delete goal
          </button>
        </div>
      )}
    </div>
  );
}

function KrRow({ kr, canEdit, onChanged }: { kr: KeyResult; canEdit: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState<'current' | null>(null);
  const [value, setValue] = useState(String(kr.current_value));
  const save = async () => {
    const v = Number(value);
    if (!Number.isFinite(v)) { toast.error('Invalid number'); return; }
    try {
      await api.patchKeyResult(kr.id, { current_value: v });
      setEditing(null);
      onChanged();
    } catch (e: any) { toast.error('Could not save', e?.message ?? 'Please try again.'); }
  };
  const remove = async () => {
    if (!window.confirm(`Delete "${kr.title}"?`)) return;
    try { await api.deleteKeyResult(kr.id); onChanged(); }
    catch (e: any) { toast.error('Could not delete', e?.message ?? 'Please try again.'); }
  };
  const tone = kr.progress >= 100 ? 'bg-brand' : kr.progress >= 60 ? 'bg-success' : kr.progress >= 30 ? 'bg-warning' : 'bg-danger';
  return (
    <div className="group grid grid-cols-[1fr_auto_120px_60px_16px] items-center gap-3 px-3 py-2 rounded-lg bg-surface border border-outline">
      <div className="min-w-0">
        <p className="text-sm text-on-surface truncate">{kr.title}</p>
        <p className="text-[10px] text-on-surface-subtle font-mono">
          {Number(kr.start_value)}{kr.unit ? ` ${kr.unit}` : ''} → {Number(kr.target_value)}{kr.unit ? ` ${kr.unit}` : ''}
        </p>
      </div>
      {editing === 'current' && canEdit ? (
        <div className="inline-flex items-center gap-1">
          <input type="number" autoFocus value={value} onChange={e => setValue(e.target.value)}
            onBlur={save}
            onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setEditing(null); setValue(String(kr.current_value)); } }}
            className="w-20 px-2 py-1 rounded border border-accent bg-surface text-xs font-mono text-right" />
        </div>
      ) : (
        <button onClick={() => canEdit && setEditing('current')}
          disabled={!canEdit}
          className={`inline-flex items-center gap-1 px-2 py-1 rounded font-mono text-xs ${canEdit ? 'hover:bg-surface-2 cursor-text' : 'cursor-default'}`}>
          <span className="font-bold text-on-surface">{Number(kr.current_value)}</span>
          {kr.unit && <span className="text-on-surface-subtle">{kr.unit}</span>}
        </button>
      )}
      <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
        <div className={`h-full ${tone}`} style={{ width: `${kr.progress}%` }} />
      </div>
      <span className={`font-mono text-xs text-right font-semibold ${kr.progress >= 100 ? 'text-brand' : ''}`}>{kr.progress}%</span>
      {canEdit ? (
        <button onClick={remove}
          className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-on-surface-subtle hover:text-danger hover:bg-danger/10 transition">
          <X size={11} />
        </button>
      ) : <span />}
    </div>
  );
}

function NewGoalModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [projectId, setProjectId] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [projects, setProjects] = useState<any[]>([]);
  const [ownerId, setOwnerId] = useState('');
  const [employees, setEmployees] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getProjects({ status: 'active' }).then((rows: any) => setProjects(Array.isArray(rows) ? rows : (rows.projects ?? []))).catch(() => setProjects([]));
    api.getEmployeesSlim().then(setEmployees).catch(() => setEmployees([]));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      await api.createGoal({
        title: title.trim(),
        description: description.trim() || undefined,
        project_id: projectId || undefined,
        target_date: targetDate || undefined,
        owner_id: ownerId || undefined,
      });
      toast.success('Goal created', 'Add key results next.');
      onCreated();
    } catch (err: any) { toast.error('Could not create goal', err?.body?.error ?? err?.message ?? 'Please try again.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()}
        className="w-full max-w-lg rounded-xl-3 bg-surface border border-outline shadow-elev-4 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-on-surface">New goal</h2>
          <button type="button" onClick={onClose} className="text-on-surface-subtle hover:text-on-surface"><X size={18} /></button>
        </div>
        <div>
          <label className="block text-xs font-semibold text-on-surface-muted mb-1">Objective</label>
          <input autoFocus value={title} onChange={e => setTitle(e.target.value)}
            placeholder="e.g. Grow organic traffic to 100k/mo by Q4"
            className="w-full px-3 py-2 rounded-lg border border-outline bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-accent/30" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-on-surface-muted mb-1">Description (optional)</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
            placeholder="Why this matters + what winning looks like"
            className="w-full px-3 py-2 rounded-lg border border-outline bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 resize-y" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-on-surface-muted mb-1">Owner</label>
            <select value={ownerId} onChange={e => setOwnerId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-outline bg-surface text-sm">
              <option value="">Me</option>
              {employees.map((e: any) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-on-surface-muted mb-1">Target date</label>
            <input type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-outline bg-surface text-sm" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-on-surface-muted mb-1">Project (optional)</label>
          <select value={projectId} onChange={e => setProjectId(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-outline bg-surface text-sm">
            <option value="">Org-wide (no project)</option>
            {projects.map((p: any) => (
              <option key={p.id} value={p.id}>{p.name}{p.client_name ? ` · ${p.client_name}` : ''}</option>
            ))}
          </select>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-outline text-sm font-semibold text-on-surface hover:bg-surface-2">Cancel</button>
          <button type="submit" disabled={busy || !title.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-on-accent text-sm font-semibold hover:opacity-90 disabled:opacity-60">
            {busy && <Loader2 size={14} className="animate-spin" />} Create goal
          </button>
        </div>
      </form>
    </div>
  );
}

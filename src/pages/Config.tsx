import { useState, useEffect } from 'react';
import { Settings, Plus, Trash2, Edit3, Check, X, Clock, Briefcase, Building2, CalendarDays } from 'lucide-react';
import { api } from '../services/api';

type Tab = 'departments' | 'designations' | 'shifts' | 'optional_leave';

function fmt12(t: string) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export default function Config() {
  const [tab, setTab] = useState<Tab>('departments');
  const now = new Date();

  // ── Departments ───────────────────────────────────────────────────────────
  const [departments, setDepartments] = useState<any[]>([]);
  const [newDept, setNewDept] = useState('');
  const [addingDept, setAddingDept] = useState(false);

  // ── Designations ──────────────────────────────────────────────────────────
  const [designations, setDesignations] = useState<any[]>([]);
  const [newDesig, setNewDesig] = useState('');
  const [addingDesig, setAddingDesig] = useState(false);

  // ── Shifts ────────────────────────────────────────────────────────────────
  const [shifts, setShifts] = useState<any[]>([]);
  const [editingShift, setEditingShift] = useState<any | null>(null);
  const [newShift, setNewShift] = useState({ name: '', start_time: '09:00', end_time: '18:00', late_after: '10:00' });
  const [showAddShift, setShowAddShift] = useState(false);
  const [savingShift, setSavingShift] = useState(false);

  // ── Optional Leave Dates ──────────────────────────────────────────────────
  const [olYear, setOlYear] = useState(now.getFullYear());
  const [olDates, setOlDates] = useState<any[]>([]);
  const [olLoading, setOlLoading] = useState(false);
  const [newOlDate, setNewOlDate] = useState('');
  const [newOlLabel, setNewOlLabel] = useState('');
  const [addingOl, setAddingOl] = useState(false);
  const [olError, setOlError] = useState('');

  const [error, setError] = useState('');

  useEffect(() => {
    api.getConfigDepartments().then(setDepartments).catch(() => {});
    api.getConfigDesignations().then(setDesignations).catch(() => {});
    api.getConfigShifts().then(setShifts).catch(() => {});
  }, []);

  // Load optional leave dates when tab or year changes
  useEffect(() => {
    if (tab !== 'optional_leave') return;
    setOlLoading(true); setOlError('');
    api.getOptionalLeaveDates(olYear).then(setOlDates).catch(() => setOlError('Failed to load dates'))
      .finally(() => setOlLoading(false));
  }, [tab, olYear]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleAddDept = async () => {
    if (!newDept.trim()) return;
    setAddingDept(true); setError('');
    try {
      const d = await api.addConfigDepartment(newDept.trim());
      setDepartments(prev => [...prev, d].sort((a, b) => a.name.localeCompare(b.name)));
      setNewDept('');
    } catch (e: any) { setError(e.message ?? 'Failed'); }
    finally { setAddingDept(false); }
  };

  const handleDeleteDept = async (id: string) => {
    if (!confirm('Delete this department?')) return;
    await api.deleteConfigDepartment(id).catch(() => {});
    setDepartments(prev => prev.filter(d => d.id !== id));
  };

  const handleAddDesig = async () => {
    if (!newDesig.trim()) return;
    setAddingDesig(true); setError('');
    try {
      const d = await api.addConfigDesignation(newDesig.trim());
      setDesignations(prev => [...prev, d].sort((a, b) => a.name.localeCompare(b.name)));
      setNewDesig('');
    } catch (e: any) { setError(e.message ?? 'Failed'); }
    finally { setAddingDesig(false); }
  };

  const handleDeleteDesig = async (id: string) => {
    if (!confirm('Delete this designation?')) return;
    await api.deleteConfigDesignation(id).catch(() => {});
    setDesignations(prev => prev.filter(d => d.id !== id));
  };

  const handleAddShift = async () => {
    if (!newShift.name.trim()) return;
    setSavingShift(true); setError('');
    try {
      const s = await api.addConfigShift(newShift);
      setShifts(prev => [...prev, s]);
      setNewShift({ name: '', start_time: '09:00', end_time: '18:00', late_after: '10:00' });
      setShowAddShift(false);
    } catch (e: any) { setError(e.message ?? 'Failed'); }
    finally { setSavingShift(false); }
  };

  const handleUpdateShift = async () => {
    if (!editingShift) return;
    setSavingShift(true); setError('');
    try {
      const updated = await api.updateConfigShift(editingShift.id, {
        name: editingShift.name, start_time: editingShift.start_time,
        end_time: editingShift.end_time, late_after: editingShift.late_after,
      });
      setShifts(prev => prev.map(s => s.id === updated.id ? updated : s));
      setEditingShift(null);
    } catch (e: any) { setError(e.message ?? 'Failed'); }
    finally { setSavingShift(false); }
  };

  const handleDeleteShift = async (id: string) => {
    if (!confirm('Delete this shift?')) return;
    await api.deleteConfigShift(id).catch(() => {});
    setShifts(prev => prev.filter(s => s.id !== id));
  };

  const handleAddOlDate = async () => {
    if (!newOlDate || !newOlLabel.trim()) { setOlError('Both date and label are required'); return; }
    // Prevent past dates
    if (newOlDate < `${olYear}-01-01` || newOlDate > `${olYear}-12-31`) {
      setOlError(`Date must be within ${olYear}`); return;
    }
    setAddingOl(true); setOlError('');
    try {
      const d = await api.addOptionalLeaveDate({ date: newOlDate, label: newOlLabel.trim(), year: olYear });
      const norm = (v: any) => { const s = typeof v === 'string' ? v : String(v); return s.includes('T') ? (() => { const x = new Date(s); x.setMinutes(x.getMinutes()+330); return x.toISOString().slice(0,10); })() : s.slice(0,10); };
      setOlDates(prev => [...prev.filter(x => x.id !== d.id), { ...d, date: norm(d.date) }].sort((a,b) => a.date.localeCompare(b.date)));
      setNewOlDate(''); setNewOlLabel('');
    } catch (e: any) { setOlError(e.message ?? 'Failed to add date'); }
    finally { setAddingOl(false); }
  };

  const handleDeleteOlDate = async (id: string) => {
    if (!confirm('Remove this optional leave date?')) return;
    await api.deleteOptionalLeaveDate(id).catch(() => {});
    setOlDates(prev => prev.filter(d => d.id !== id));
  };

  const inputCls = 'text-sm bg-surface border border-outline focus:border-accent focus:ring-2 focus:ring-accent/20 rounded-lg px-3 py-2 focus:outline-none text-on-surface placeholder:text-on-surface-subtle w-full transition-colors';

  const TABS: { key: Tab; label: string; icon: any }[] = [
    { key: 'departments',   label: 'Departments',    icon: Building2   },
    { key: 'designations',  label: 'Designations',   icon: Briefcase   },
    { key: 'shifts',        label: 'Shifts',         icon: Clock       },
    { key: 'optional_leave',label: 'Optional Leaves',icon: CalendarDays},
  ];

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="flex flex-wrap gap-1 bg-surface rounded-xl-2 p-1 border border-outline shadow-elev-1 w-fit">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => { setTab(key); setError(''); }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              tab === key
                ? 'bg-accent text-on-accent shadow-elev-1'
                : 'text-on-surface-muted hover:text-on-surface hover:bg-surface-2'
            }`}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-danger-container border border-danger/20 text-danger text-sm font-medium px-4 py-2.5 rounded-xl-2">
          {error}
        </div>
      )}

      {/* ── Departments ── */}
      {tab === 'departments' && (
        <div className="group relative bg-surface rounded-xl-2 border border-outline shadow-elev-1 overflow-hidden max-w-lg">
          <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-brand/15 blur-2xl opacity-50 pointer-events-none" />
          <div className="relative px-5 py-4 border-b border-outline flex items-center justify-between">
            <div>
              <h3 className="font-display text-xl font-bold tracking-tight text-on-surface">Departments</h3>
              <p className="text-xs text-on-surface-subtle mt-0.5"><span className="num-mono">{departments.length}</span> configured</p>
            </div>
            <span className="num-mono text-xs font-semibold px-2.5 py-1 rounded-full bg-brand-container text-on-brand-container">{departments.length}</span>
          </div>
          <div className="relative divide-y divide-outline">
            {departments.map(d => (
              <div key={d.id} className="flex items-center justify-between px-5 py-3 group/row hover:bg-surface-2">
                <span className="text-sm font-medium text-on-surface">{d.name}</span>
                <button onClick={() => handleDeleteDept(d.id)} className="opacity-0 group-hover/row:opacity-100 p-1.5 rounded-lg text-on-surface-subtle hover:text-danger hover:bg-danger-container transition-all">
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
          <div className="relative px-5 py-4 border-t border-outline flex gap-2 bg-surface-2">
            <input value={newDept} onChange={e => setNewDept(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddDept()}
              placeholder="New department name…" className={inputCls}/>
            <button onClick={handleAddDept} disabled={addingDept || !newDept.trim()}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-accent text-on-accent rounded-lg disabled:opacity-50 hover:opacity-90 shadow-elev-1 transition-all flex-shrink-0">
              <Plus size={13} /> {addingDept ? '…' : 'Add'}
            </button>
          </div>
        </div>
      )}

      {/* ── Designations ── */}
      {tab === 'designations' && (
        <div className="group relative bg-surface rounded-xl-2 border border-outline shadow-elev-1 overflow-hidden max-w-lg">
          <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-brand/15 blur-2xl opacity-50 pointer-events-none" />
          <div className="relative px-5 py-4 border-b border-outline flex items-center justify-between">
            <div>
              <h3 className="font-display text-xl font-bold tracking-tight text-on-surface">Job Designations</h3>
              <p className="text-xs text-on-surface-subtle mt-0.5"><span className="num-mono">{designations.length}</span> configured</p>
            </div>
            <span className="num-mono text-xs font-semibold px-2.5 py-1 rounded-full bg-brand-container text-on-brand-container">{designations.length}</span>
          </div>
          <div className="relative divide-y divide-outline max-h-72 overflow-y-auto">
            {designations.length === 0 && <p className="text-sm text-on-surface-subtle text-center py-8">No designations yet</p>}
            {designations.map(d => (
              <div key={d.id} className="flex items-center justify-between px-5 py-3 group/row hover:bg-surface-2">
                <span className="text-sm font-medium text-on-surface">{d.name}</span>
                <button onClick={() => handleDeleteDesig(d.id)} className="opacity-0 group-hover/row:opacity-100 p-1.5 rounded-lg text-on-surface-subtle hover:text-danger hover:bg-danger-container transition-all">
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
          <div className="relative px-5 py-4 border-t border-outline flex gap-2 bg-surface-2">
            <input value={newDesig} onChange={e => setNewDesig(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddDesig()}
              placeholder="e.g. Senior Software Engineer…" className={inputCls}/>
            <button onClick={handleAddDesig} disabled={addingDesig || !newDesig.trim()}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-accent text-on-accent rounded-lg disabled:opacity-50 hover:opacity-90 shadow-elev-1 transition-all flex-shrink-0">
              <Plus size={13} /> {addingDesig ? '…' : 'Add'}
            </button>
          </div>
        </div>
      )}

      {/* ── Shifts ── */}
      {tab === 'shifts' && (
        <div className="space-y-4 max-w-2xl">
          {shifts.map(s => (
            <div key={s.id} className="group relative bg-surface rounded-xl-2 border border-outline shadow-elev-1 overflow-hidden">
              <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-brand/15 blur-2xl opacity-50 pointer-events-none" />
              {editingShift?.id === s.id ? (
                <div className="relative p-5 space-y-4 bg-surface-2">
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="text-xs font-semibold text-on-surface-muted block mb-1.5">Shift Name</label>
                      <input value={editingShift.name} onChange={e => setEditingShift((p: any) => ({ ...p, name: e.target.value }))} className={inputCls}/></div>
                    <div><label className="text-xs font-semibold text-on-surface-muted block mb-1.5">Late After</label>
                      <input type="time" value={editingShift.late_after} onChange={e => setEditingShift((p: any) => ({ ...p, late_after: e.target.value }))} className={inputCls}/></div>
                    <div><label className="text-xs font-semibold text-on-surface-muted block mb-1.5">Start Time</label>
                      <input type="time" value={editingShift.start_time} onChange={e => setEditingShift((p: any) => ({ ...p, start_time: e.target.value }))} className={inputCls}/></div>
                    <div><label className="text-xs font-semibold text-on-surface-muted block mb-1.5">End Time</label>
                      <input type="time" value={editingShift.end_time} onChange={e => setEditingShift((p: any) => ({ ...p, end_time: e.target.value }))} className={inputCls}/></div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => setEditingShift(null)} className="flex-1 py-2 border border-outline bg-surface rounded-lg text-sm font-medium text-on-surface-muted hover:bg-surface-2 hover:text-on-surface transition-colors">Cancel</button>
                    <button onClick={handleUpdateShift} disabled={savingShift} className="flex-1 py-2 bg-accent text-on-accent rounded-lg text-sm font-semibold disabled:opacity-60 hover:opacity-90 shadow-elev-1 transition-all">
                      {savingShift ? 'Saving…' : 'Save Shift'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="relative flex items-center gap-4 px-5 py-4">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${s.id === 'night' ? 'bg-brand text-on-brand' : 'bg-warning-container text-warning'}`}>
                    <Clock size={18} />
                  </div>
                  <div className="flex-1">
                    <p className="font-display text-xl font-bold tracking-tight text-on-surface">{s.name}</p>
                    <p className="num-mono text-xs text-on-surface-subtle mt-0.5">{fmt12(s.start_time)} – {fmt12(s.end_time)} · Late if after {fmt12(s.late_after)}</p>
                  </div>
                  <div className="flex gap-1.5">
                    <button onClick={() => setEditingShift({ ...s })} className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-outline text-on-surface hover:bg-surface-2 transition-colors">
                      <Edit3 size={11} /> Edit
                    </button>
                    <button onClick={() => handleDeleteShift(s.id)} className="p-1.5 rounded-lg text-on-surface-subtle hover:text-danger hover:bg-danger-container transition-colors">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {showAddShift ? (
            <div className="group relative bg-surface rounded-xl-2 border border-outline shadow-elev-1 p-5 space-y-4 overflow-hidden">
              <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-accent/15 blur-2xl opacity-50 pointer-events-none" />
              <h4 className="relative font-display text-xl font-bold tracking-tight text-on-surface">New Shift</h4>
              <div className="relative grid grid-cols-2 gap-4">
                <div><label className="text-xs font-semibold text-on-surface-muted block mb-1.5">Shift Name</label>
                  <input value={newShift.name} onChange={e => setNewShift(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Morning Shift" className={inputCls}/></div>
                <div><label className="text-xs font-semibold text-on-surface-muted block mb-1.5">Late After (grace cutoff)</label>
                  <input type="time" value={newShift.late_after} onChange={e => setNewShift(p => ({ ...p, late_after: e.target.value }))} className={inputCls}/></div>
                <div><label className="text-xs font-semibold text-on-surface-muted block mb-1.5">Start Time</label>
                  <input type="time" value={newShift.start_time} onChange={e => setNewShift(p => ({ ...p, start_time: e.target.value }))} className={inputCls}/></div>
                <div><label className="text-xs font-semibold text-on-surface-muted block mb-1.5">End Time</label>
                  <input type="time" value={newShift.end_time} onChange={e => setNewShift(p => ({ ...p, end_time: e.target.value }))} className={inputCls}/></div>
              </div>
              <div className="relative flex gap-2">
                <button onClick={() => setShowAddShift(false)} className="flex-1 py-2 border border-outline bg-surface rounded-lg text-sm font-medium text-on-surface-muted hover:bg-surface-2 hover:text-on-surface transition-colors">
                  <X size={14} className="inline mr-1" /> Cancel
                </button>
                <button onClick={handleAddShift} disabled={savingShift || !newShift.name.trim()} className="flex-1 py-2 bg-accent text-on-accent rounded-lg text-sm font-semibold disabled:opacity-60 hover:opacity-90 shadow-elev-1 transition-all">
                  {savingShift ? 'Saving…' : <><Check size={14} className="inline mr-1"/>Create Shift</>}
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setShowAddShift(true)} className="w-full py-3 border-2 border-dashed border-outline rounded-xl-2 text-sm font-semibold text-on-surface-subtle hover:border-accent hover:text-accent hover:bg-surface-2 transition-colors">
              <Plus size={15} className="inline mr-1.5" /> Add New Shift
            </button>
          )}
        </div>
      )}

      {/* ── Optional Leave Dates ── */}
      {tab === 'optional_leave' && (
        <div className="space-y-5 max-w-2xl">
          {/* Info card */}
          <div className="bg-brand-container border border-brand/20 rounded-xl-2 p-4 text-sm text-on-brand-container">
            <p className="font-semibold mb-1">How Optional Leave Works</p>
            <ul className="text-xs text-on-brand-container/80 space-y-1 list-disc list-inside">
              <li>HR sets a pool of dates each year (festivals, company holidays, etc.)</li>
              <li>Each employee's birthday is automatically added as an optional leave date</li>
              <li>Employees can apply for <strong>any 2 dates</strong> from the pool per calendar year</li>
              <li>Only available after the employee's probation period ends</li>
              <li>Follows the same manager → HR approval workflow as other leaves</li>
            </ul>
          </div>

          {/* Year selector */}
          <div className="group relative bg-surface rounded-xl-2 border border-outline shadow-elev-1 p-5 overflow-hidden">
            <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-brand/15 blur-2xl opacity-50 pointer-events-none" />
            <div className="relative flex items-center justify-between mb-5">
              <div>
                <h3 className="font-display text-xl font-bold tracking-tight text-on-surface">Optional Leave Date Pool</h3>
                <p className="text-xs text-on-surface-subtle mt-0.5"><span className="num-mono">{olDates.length}</span> date{olDates.length !== 1 ? 's' : ''} set for <span className="num-mono">{olYear}</span></p>
              </div>
              <select value={olYear} onChange={e => setOlYear(Number(e.target.value))}
                className="num-mono text-sm bg-surface border border-outline focus:border-accent focus:ring-2 focus:ring-accent/20 rounded-lg px-3 py-1.5 text-on-surface focus:outline-none transition-colors">
                {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>

            {olError && <p className="relative text-xs text-danger font-medium mb-3 bg-danger-container border border-danger/20 rounded-lg px-3 py-2">{olError}</p>}

            {/* Date list */}
            {olLoading ? (
              <div className="relative flex items-center justify-center py-8">
                <div className="w-5 h-5 border-4 border-outline border-t-accent rounded-full animate-spin"/>
              </div>
            ) : olDates.length === 0 ? (
              <p className="relative text-sm text-on-surface-subtle text-center py-6">No optional leave dates for {olYear} yet</p>
            ) : (
              <div className="relative divide-y divide-outline mb-4">
                {olDates.map(d => {
                  const dateObj = new Date(d.date + 'T12:00:00Z');
                  const isPast = d.date < new Date().toISOString().slice(0,10);
                  return (
                    <div key={d.id} className="flex items-center gap-3 py-3 group/row">
                      <div className={`w-12 h-12 rounded-xl-2 flex flex-col items-center justify-center flex-shrink-0 ${isPast ? 'bg-surface-2' : 'bg-accent/10'}`}>
                        <span className={`text-[10px] font-bold uppercase ${isPast ? 'text-on-surface-subtle' : 'text-accent'}`}>
                          {MONTH_NAMES[dateObj.getUTCMonth()]}
                        </span>
                        <span className={`num-mono text-lg font-black leading-none ${isPast ? 'text-on-surface-subtle' : 'text-on-surface'}`}>
                          {dateObj.getUTCDate()}
                        </span>
                      </div>
                      <div className="flex-1">
                        <p className={`text-sm font-semibold ${isPast ? 'text-on-surface-subtle' : 'text-on-surface'}`}>{d.label}</p>
                        <p className="text-xs text-on-surface-subtle">{dateObj.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
                      </div>
                      {isPast && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-surface-2 text-on-surface-subtle">Past</span>}
                      <button onClick={() => handleDeleteOlDate(d.id)}
                        className="opacity-0 group-hover/row:opacity-100 p-1.5 rounded-lg text-on-surface-subtle hover:text-danger hover:bg-danger-container transition-all">
                        <Trash2 size={13}/>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Add new date */}
            <div className="relative border-t border-outline pt-4 space-y-3">
              <p className="text-xs font-semibold text-on-surface-muted uppercase tracking-wide">Add a date to <span className="num-mono">{olYear}</span> pool</p>
              <div className="bg-surface-2 border border-outline rounded-xl-2 p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-on-surface-muted mb-1 block">Date</label>
                  <input type="date" value={newOlDate}
                    min={`${olYear}-01-01`} max={`${olYear}-12-31`}
                    onChange={e => { setNewOlDate(e.target.value); setOlError(''); }}
                    className={inputCls}/>
                </div>
                <div className="sm:col-span-2">
                  <label className="text-xs text-on-surface-muted mb-1 block">Label / Festival name</label>
                  <div className="flex gap-2">
                    <input value={newOlLabel} onChange={e => { setNewOlLabel(e.target.value); setOlError(''); }}
                      onKeyDown={e => e.key === 'Enter' && handleAddOlDate()}
                      placeholder="e.g. Diwali, Eid, Republic Day…"
                      className={inputCls}/>
                    <button onClick={handleAddOlDate} disabled={addingOl || !newOlDate || !newOlLabel.trim()}
                      className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-accent text-on-accent rounded-lg disabled:opacity-50 hover:opacity-90 shadow-elev-1 transition-all flex-shrink-0">
                      <Plus size={13}/> {addingOl ? '…' : 'Add'}
                    </button>
                  </div>
                </div>
              </div>
              <p className="text-xs text-on-surface-subtle">
                Tip: Employee birthdays are added automatically — you only need to add company-wide or regional holidays here.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

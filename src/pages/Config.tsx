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

  const inputCls = 'text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-200 bg-white w-full';

  const TABS: { key: Tab; label: string; icon: any }[] = [
    { key: 'departments',   label: 'Departments',    icon: Building2   },
    { key: 'designations',  label: 'Designations',   icon: Briefcase   },
    { key: 'shifts',        label: 'Shifts',         icon: Clock       },
    { key: 'optional_leave',label: 'Optional Leaves',icon: CalendarDays},
  ];

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="flex flex-wrap gap-1 bg-white rounded-xl p-1 border border-gray-100 shadow-sm w-fit">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => { setTab(key); setError(''); }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all"
            style={tab === key ? { background: '#192250', color: '#fff' } : { color: '#6b7280' }}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 text-red-600 text-sm font-medium px-4 py-2.5 rounded-xl">
          {error}
        </div>
      )}

      {/* ── Departments ── */}
      {tab === 'departments' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden max-w-lg">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h3 className="font-bold text-sm" style={{ color: '#192250' }}>Departments</h3>
              <p className="text-xs text-gray-400 mt-0.5">{departments.length} configured</p>
            </div>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: 'rgba(25,34,80,0.07)', color: '#192250' }}>{departments.length}</span>
          </div>
          <div className="divide-y divide-gray-50">
            {departments.map(d => (
              <div key={d.id} className="flex items-center justify-between px-5 py-3 group hover:bg-gray-50/50">
                <span className="text-sm font-medium text-gray-800">{d.name}</span>
                <button onClick={() => handleDeleteDept(d.id)} className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-50 rounded-lg transition-all">
                  <Trash2 size={13} className="text-red-400" />
                </button>
              </div>
            ))}
          </div>
          <div className="px-5 py-4 border-t border-gray-100 flex gap-2">
            <input value={newDept} onChange={e => setNewDept(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddDept()}
              placeholder="New department name…" className={inputCls}/>
            <button onClick={handleAddDept} disabled={addingDept || !newDept.trim()}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white rounded-lg disabled:opacity-50 flex-shrink-0" style={{ background: '#192250' }}>
              <Plus size={13} /> {addingDept ? '…' : 'Add'}
            </button>
          </div>
        </div>
      )}

      {/* ── Designations ── */}
      {tab === 'designations' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden max-w-lg">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h3 className="font-bold text-sm" style={{ color: '#192250' }}>Job Designations</h3>
              <p className="text-xs text-gray-400 mt-0.5">{designations.length} configured</p>
            </div>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: 'rgba(25,34,80,0.07)', color: '#192250' }}>{designations.length}</span>
          </div>
          <div className="divide-y divide-gray-50 max-h-72 overflow-y-auto">
            {designations.length === 0 && <p className="text-sm text-gray-400 text-center py-8">No designations yet</p>}
            {designations.map(d => (
              <div key={d.id} className="flex items-center justify-between px-5 py-3 group hover:bg-gray-50/50">
                <span className="text-sm font-medium text-gray-800">{d.name}</span>
                <button onClick={() => handleDeleteDesig(d.id)} className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-50 rounded-lg transition-all">
                  <Trash2 size={13} className="text-red-400" />
                </button>
              </div>
            ))}
          </div>
          <div className="px-5 py-4 border-t border-gray-100 flex gap-2">
            <input value={newDesig} onChange={e => setNewDesig(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddDesig()}
              placeholder="e.g. Senior Software Engineer…" className={inputCls}/>
            <button onClick={handleAddDesig} disabled={addingDesig || !newDesig.trim()}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white rounded-lg disabled:opacity-50 flex-shrink-0" style={{ background: '#192250' }}>
              <Plus size={13} /> {addingDesig ? '…' : 'Add'}
            </button>
          </div>
        </div>
      )}

      {/* ── Shifts ── */}
      {tab === 'shifts' && (
        <div className="space-y-4 max-w-2xl">
          {shifts.map(s => (
            <div key={s.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              {editingShift?.id === s.id ? (
                <div className="p-5 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="text-xs font-semibold text-gray-500 block mb-1.5">Shift Name</label>
                      <input value={editingShift.name} onChange={e => setEditingShift((p: any) => ({ ...p, name: e.target.value }))} className={inputCls}/></div>
                    <div><label className="text-xs font-semibold text-gray-500 block mb-1.5">Late After</label>
                      <input type="time" value={editingShift.late_after} onChange={e => setEditingShift((p: any) => ({ ...p, late_after: e.target.value }))} className={inputCls}/></div>
                    <div><label className="text-xs font-semibold text-gray-500 block mb-1.5">Start Time</label>
                      <input type="time" value={editingShift.start_time} onChange={e => setEditingShift((p: any) => ({ ...p, start_time: e.target.value }))} className={inputCls}/></div>
                    <div><label className="text-xs font-semibold text-gray-500 block mb-1.5">End Time</label>
                      <input type="time" value={editingShift.end_time} onChange={e => setEditingShift((p: any) => ({ ...p, end_time: e.target.value }))} className={inputCls}/></div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => setEditingShift(null)} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
                    <button onClick={handleUpdateShift} disabled={savingShift} className="flex-1 py-2 text-white rounded-lg text-sm font-semibold disabled:opacity-60" style={{ background: '#192250' }}>
                      {savingShift ? 'Saving…' : 'Save Shift'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-4 px-5 py-4">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: s.id === 'night' ? '#1e1b4b' : '#fef3c7' }}>
                    <Clock size={18} style={{ color: s.id === 'night' ? '#a5b4fc' : '#d97706' }} />
                  </div>
                  <div className="flex-1">
                    <p className="font-bold text-sm" style={{ color: '#192250' }}>{s.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{fmt12(s.start_time)} – {fmt12(s.end_time)} · Late if after {fmt12(s.late_after)}</p>
                  </div>
                  <div className="flex gap-1.5">
                    <button onClick={() => setEditingShift({ ...s })} className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-colors hover:bg-gray-50" style={{ color: '#192250', borderColor: '#e2e4ed' }}>
                      <Edit3 size={11} /> Edit
                    </button>
                    <button onClick={() => handleDeleteShift(s.id)} className="p-1.5 hover:bg-red-50 rounded-lg transition-colors">
                      <Trash2 size={14} className="text-red-400" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {showAddShift ? (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
              <h4 className="font-bold text-sm" style={{ color: '#192250' }}>New Shift</h4>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="text-xs font-semibold text-gray-500 block mb-1.5">Shift Name</label>
                  <input value={newShift.name} onChange={e => setNewShift(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Morning Shift" className={inputCls}/></div>
                <div><label className="text-xs font-semibold text-gray-500 block mb-1.5">Late After (grace cutoff)</label>
                  <input type="time" value={newShift.late_after} onChange={e => setNewShift(p => ({ ...p, late_after: e.target.value }))} className={inputCls}/></div>
                <div><label className="text-xs font-semibold text-gray-500 block mb-1.5">Start Time</label>
                  <input type="time" value={newShift.start_time} onChange={e => setNewShift(p => ({ ...p, start_time: e.target.value }))} className={inputCls}/></div>
                <div><label className="text-xs font-semibold text-gray-500 block mb-1.5">End Time</label>
                  <input type="time" value={newShift.end_time} onChange={e => setNewShift(p => ({ ...p, end_time: e.target.value }))} className={inputCls}/></div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setShowAddShift(false)} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50">
                  <X size={14} className="inline mr-1" /> Cancel
                </button>
                <button onClick={handleAddShift} disabled={savingShift || !newShift.name.trim()} className="flex-1 py-2 text-white rounded-lg text-sm font-semibold disabled:opacity-60" style={{ background: 'linear-gradient(135deg,#EE2770 0%,#d11f62 100%)' }}>
                  {savingShift ? 'Saving…' : <><Check size={14} className="inline mr-1"/>Create Shift</>}
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setShowAddShift(true)} className="w-full py-3 border-2 border-dashed rounded-2xl text-sm font-semibold text-gray-400 hover:border-primary-300 hover:text-primary-500 transition-colors" style={{ borderColor: '#e2e4ed' }}>
              <Plus size={15} className="inline mr-1.5" /> Add New Shift
            </button>
          )}
        </div>
      )}

      {/* ── Optional Leave Dates ── */}
      {tab === 'optional_leave' && (
        <div className="space-y-5 max-w-2xl">
          {/* Info card */}
          <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 text-sm text-blue-700">
            <p className="font-semibold mb-1">How Optional Leave Works</p>
            <ul className="text-xs text-blue-600 space-y-1 list-disc list-inside">
              <li>HR sets a pool of dates each year (festivals, company holidays, etc.)</li>
              <li>Each employee's birthday is automatically added as an optional leave date</li>
              <li>Employees can apply for <strong>any 2 dates</strong> from the pool per calendar year</li>
              <li>Only available after the employee's probation period ends</li>
              <li>Follows the same manager → HR approval workflow as other leaves</li>
            </ul>
          </div>

          {/* Year selector */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="font-bold text-sm" style={{ color: '#192250' }}>Optional Leave Date Pool</h3>
                <p className="text-xs text-gray-400 mt-0.5">{olDates.length} date{olDates.length !== 1 ? 's' : ''} set for {olYear}</p>
              </div>
              <select value={olYear} onChange={e => setOlYear(Number(e.target.value))}
                className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-primary-200">
                {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>

            {olError && <p className="text-xs text-red-500 font-medium mb-3 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{olError}</p>}

            {/* Date list */}
            {olLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-5 h-5 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin"/>
              </div>
            ) : olDates.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">No optional leave dates for {olYear} yet</p>
            ) : (
              <div className="divide-y divide-gray-50 mb-4">
                {olDates.map(d => {
                  const dateObj = new Date(d.date + 'T12:00:00Z');
                  const isPast = d.date < new Date().toISOString().slice(0,10);
                  return (
                    <div key={d.id} className="flex items-center gap-3 py-3 group">
                      <div className="w-12 h-12 rounded-xl flex flex-col items-center justify-center flex-shrink-0"
                        style={{ background: isPast ? '#f3f4f6' : 'rgba(238,39,112,0.08)' }}>
                        <span className="text-[10px] font-bold uppercase" style={{ color: isPast ? '#9ca3af' : '#EE2770' }}>
                          {MONTH_NAMES[dateObj.getUTCMonth()]}
                        </span>
                        <span className="text-lg font-black leading-none" style={{ color: isPast ? '#9ca3af' : '#192250' }}>
                          {dateObj.getUTCDate()}
                        </span>
                      </div>
                      <div className="flex-1">
                        <p className={`text-sm font-semibold ${isPast ? 'text-gray-400' : 'text-gray-800'}`}>{d.label}</p>
                        <p className="text-xs text-gray-400">{dateObj.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
                      </div>
                      {isPast && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-400">Past</span>}
                      <button onClick={() => handleDeleteOlDate(d.id)}
                        className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-50 rounded-lg transition-all">
                        <Trash2 size={13} className="text-red-400"/>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Add new date */}
            <div className="border-t border-gray-100 pt-4 space-y-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Add a date to {olYear} pool</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Date</label>
                  <input type="date" value={newOlDate}
                    min={`${olYear}-01-01`} max={`${olYear}-12-31`}
                    onChange={e => { setNewOlDate(e.target.value); setOlError(''); }}
                    className={inputCls}/>
                </div>
                <div className="sm:col-span-2">
                  <label className="text-xs text-gray-500 mb-1 block">Label / Festival name</label>
                  <div className="flex gap-2">
                    <input value={newOlLabel} onChange={e => { setNewOlLabel(e.target.value); setOlError(''); }}
                      onKeyDown={e => e.key === 'Enter' && handleAddOlDate()}
                      placeholder="e.g. Diwali, Eid, Republic Day…"
                      className={inputCls}/>
                    <button onClick={handleAddOlDate} disabled={addingOl || !newOlDate || !newOlLabel.trim()}
                      className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white rounded-lg disabled:opacity-50 flex-shrink-0"
                      style={{ background: 'linear-gradient(135deg,#192250 0%,#141c43 100%)' }}>
                      <Plus size={13}/> {addingOl ? '…' : 'Add'}
                    </button>
                  </div>
                </div>
              </div>
              <p className="text-xs text-gray-400">
                Tip: Employee birthdays are added automatically — you only need to add company-wide or regional holidays here.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

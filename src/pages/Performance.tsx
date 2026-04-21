import { useState, useEffect, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell
} from 'recharts';
import {
  Target, TrendingUp, Award, Calendar, Plus, X, Trash2,
  ChevronDown, MessageSquare, Edit3, CheckCircle, AlertCircle, Info
} from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import TopBar from '../components/layout/TopBar';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CATEGORIES = [
  { key: 'productivity', label: 'Productivity' },
  { key: 'quality', label: 'Quality of Work' },
  { key: 'teamwork', label: 'Teamwork' },
  { key: 'attendance_score', label: 'Attendance' },
  { key: 'initiative', label: 'Initiative' },
] as const;

function scoreColor(score: number) {
  if (score >= 85) return '#16a34a';
  if (score >= 70) return '#192250';
  if (score >= 50) return '#d97706';
  return '#dc2626';
}

function scoreBadge(score: number) {
  if (score >= 85) return { bg: '#dcfce7', text: '#15803d', label: 'Excellent' };
  if (score >= 70) return { bg: '#e0e4f5', text: '#192250', label: 'Good' };
  if (score >= 50) return { bg: '#fef3c7', text: '#92400e', label: 'Average' };
  return { bg: '#fee2e2', text: '#991b1b', label: 'Needs Work' };
}

// ─── Add Review Modal ────────────────────────────────────────────────────────
function AddReviewModal({
  employee, month, year, existing, reviewer, onSave, onClose,
}: {
  employee: any; month: number; year: number; existing?: any; reviewer: any;
  onSave: (data: any) => void; onClose: () => void;
}) {
  const [scores, setScores] = useState({
    productivity: existing?.productivity ?? 75,
    quality: existing?.quality ?? 75,
    teamwork: existing?.teamwork ?? 75,
    attendance_score: existing?.attendance_score ?? 75,
    initiative: existing?.initiative ?? 75,
  });
  const [comments, setComments] = useState(existing?.comments ?? '');
  const [saving, setSaving] = useState(false);

  const overall = Math.round(Object.values(scores).reduce((a, b) => a + b, 0) / 5);

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await api.saveMonthlyPerformance({
        employee_id: employee.id,
        reviewer_id: reviewer?.id,
        reviewer_name: reviewer?.name,
        month, year,
        ...scores,
        overall_score: overall,
        comments,
      });
      onSave(result);
      onClose();
    } catch { /* ignore */ } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div>
            <h3 className="font-bold text-base" style={{ color: '#192250' }}>
              {existing ? 'Edit Review' : 'Add Review'}
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              {employee.name} · {MONTHS[month - 1]} {year}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg">
            <X size={16} className="text-gray-400" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Overall score preview */}
          <div className="rounded-xl p-4 text-center" style={{ background: 'rgba(25,34,80,0.04)', border: '1px solid rgba(25,34,80,0.08)' }}>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Overall Score</p>
            <p className="text-4xl font-bold" style={{ color: scoreColor(overall) }}>{overall}</p>
            <p className="text-xs font-semibold mt-1" style={{ color: scoreBadge(overall).text }}>{scoreBadge(overall).label}</p>
          </div>

          {/* Category sliders */}
          {CATEGORIES.map(({ key, label }) => (
            <div key={key}>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm font-semibold" style={{ color: '#192250' }}>{label}</label>
                <span className="text-sm font-bold tabular-nums" style={{ color: scoreColor(scores[key]) }}>{scores[key]}</span>
              </div>
              <input
                type="range" min={0} max={100} value={scores[key]}
                onChange={e => setScores(s => ({ ...s, [key]: Number(e.target.value) }))}
                className="w-full h-2 rounded-full appearance-none cursor-pointer"
                style={{ accentColor: scoreColor(scores[key]) }}
              />
              <div className="flex justify-between mt-0.5">
                <span className="text-xs text-gray-300">0</span>
                <span className="text-xs text-gray-300">100</span>
              </div>
            </div>
          ))}

          <div>
            <label className="text-sm font-semibold mb-1.5 block" style={{ color: '#192250' }}>Comments (optional)</label>
            <textarea
              value={comments}
              onChange={e => setComments(e.target.value)}
              rows={3}
              placeholder="Overall feedback for this month..."
              className="w-full border rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none"
              style={{ borderColor: '#e2e4ed' }}
              onFocus={e => { e.target.style.borderColor = '#192250'; }}
              onBlur={e => { e.target.style.borderColor = '#e2e4ed'; }}
            />
          </div>
        </div>

        <div className="flex gap-3 p-5 border-t border-gray-100">
          <button onClick={onClose} className="flex-1 py-2.5 border rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-50" style={{ borderColor: '#e2e4ed' }}>
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 py-2.5 text-white rounded-xl text-sm font-semibold disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg, #EE2770 0%, #d11f62 100%)' }}
          >
            {saving ? 'Saving…' : 'Save Review'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Add Note Modal ──────────────────────────────────────────────────────────
function AddNoteModal({ employee, reviewer, onSave, onClose }: {
  employee: any; reviewer: any; onSave: (note: any) => void; onClose: () => void;
}) {
  const [noteText, setNoteText] = useState('');
  const [noteType, setNoteType] = useState<'positive' | 'negative' | 'neutral'>('neutral');
  const [noteDate, setNoteDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!noteText.trim()) return;
    setSaving(true);
    try {
      const result = await api.addPerformanceNote({
        employee_id: employee.id,
        note_date: noteDate,
        note_text: noteText.trim(),
        note_type: noteType,
        created_by_id: reviewer?.id,
        created_by_name: reviewer?.name,
      });
      onSave(result);
      onClose();
    } catch { /* ignore */ } finally { setSaving(false); }
  };

  const typeConfig = {
    positive: { label: 'Positive', color: '#15803d', bg: '#dcfce7', border: '#86efac' },
    neutral:  { label: 'Neutral',  color: '#192250', bg: '#e0e4f5', border: '#c7cde8' },
    negative: { label: 'Negative', color: '#991b1b', bg: '#fee2e2', border: '#fca5a5' },
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div>
            <h3 className="font-bold text-base" style={{ color: '#192250' }}>Add Private Note</h3>
            <p className="text-xs text-gray-400 mt-0.5">{employee.name} · Not visible to employee</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg"><X size={16} className="text-gray-400" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide mb-2 block" style={{ color: '#192250' }}>Note Type</label>
            <div className="flex gap-2">
              {(['positive', 'neutral', 'negative'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setNoteType(t)}
                  className="flex-1 py-2 rounded-xl text-xs font-semibold border transition-all"
                  style={noteType === t
                    ? { background: typeConfig[t].bg, color: typeConfig[t].color, borderColor: typeConfig[t].border }
                    : { background: '#f9fafb', color: '#9ca3af', borderColor: '#e5e7eb' }}
                >
                  {typeConfig[t].label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide mb-1.5 block" style={{ color: '#192250' }}>Date</label>
            <input
              type="date" value={noteDate}
              max={new Date().toISOString().slice(0, 10)}
              onChange={e => setNoteDate(e.target.value)}
              className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none"
              style={{ borderColor: '#e2e4ed' }}
              onFocus={e => { e.target.style.borderColor = '#192250'; }}
              onBlur={e => { e.target.style.borderColor = '#e2e4ed'; }}
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide mb-1.5 block" style={{ color: '#192250' }}>Note</label>
            <textarea
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              rows={4}
              placeholder="Write your observation here..."
              className="w-full border rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none"
              style={{ borderColor: '#e2e4ed' }}
              onFocus={e => { e.target.style.borderColor = '#192250'; }}
              onBlur={e => { e.target.style.borderColor = '#e2e4ed'; }}
            />
          </div>
        </div>
        <div className="flex gap-3 p-5 border-t border-gray-100">
          <button onClick={onClose} className="flex-1 py-2.5 border rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-50" style={{ borderColor: '#e2e4ed' }}>Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving || !noteText.trim()}
            className="flex-1 py-2.5 text-white rounded-xl text-sm font-semibold disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg, #EE2770 0%, #d11f62 100%)' }}
          >
            {saving ? 'Saving…' : 'Save Note'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Custom tooltip for bar chart ────────────────────────────────────────────
function CustomBarTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const score = payload[0]?.value;
  if (score == null) return null;
  const badge = scoreBadge(score);
  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-lg px-4 py-3 text-sm">
      <p className="font-bold" style={{ color: '#192250' }}>{label}</p>
      <p className="text-2xl font-black mt-0.5" style={{ color: scoreColor(score) }}>{score}</p>
      <p className="text-xs font-semibold mt-0.5" style={{ color: badge.text }}>{badge.label}</p>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────
export default function Performance() {
  const { user } = useAuth();
  const isHROrAdmin = user?.role === 'admin' || user?.role === 'hr_manager';

  const currentYear = new Date().getFullYear();
  const [employees, setEmployees] = useState<any[]>([]);
  const [selectedEmpId, setSelectedEmpId] = useState('');
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [monthlyData, setMonthlyData] = useState<any[]>([]);
  const [notes, setNotes] = useState<any[]>([]);
  const [loadingPerf, setLoadingPerf] = useState(false);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [showAddReview, setShowAddReview] = useState<{ month: number; existing?: any } | null>(null);
  const [showAddNote, setShowAddNote] = useState(false);

  useEffect(() => {
    api.getEmployees().then(emps => {
      setEmployees(emps);
      if (emps.length) setSelectedEmpId(emps[0].id);
    });
  }, []);

  const loadPerformance = useCallback(() => {
    if (!selectedEmpId) return;
    setLoadingPerf(true);
    api.getMonthlyPerformance(selectedEmpId, selectedYear)
      .then(setMonthlyData)
      .finally(() => setLoadingPerf(false));
  }, [selectedEmpId, selectedYear]);

  const loadNotes = useCallback(() => {
    if (!selectedEmpId || !isHROrAdmin) return;
    setLoadingNotes(true);
    api.getPerformanceNotes(selectedEmpId)
      .then(setNotes)
      .finally(() => setLoadingNotes(false));
  }, [selectedEmpId, isHROrAdmin]);

  useEffect(() => { loadPerformance(); }, [loadPerformance]);
  useEffect(() => { loadNotes(); }, [loadNotes]);

  const selectedEmp = employees.find(e => e.id === selectedEmpId);

  // Build 12-month chart data
  const chartData = MONTHS.map((m, idx) => {
    const record = monthlyData.find(r => r.month === idx + 1);
    return { month: m, score: record ? record.overall_score : null, record };
  });

  const reviewedMonths = monthlyData.length;
  const avgScore = reviewedMonths > 0
    ? Math.round(monthlyData.reduce((a, r) => a + r.overall_score, 0) / reviewedMonths)
    : 0;
  const bestMonth = monthlyData.length
    ? monthlyData.reduce((a, b) => a.overall_score > b.overall_score ? a : b)
    : null;

  const currentMonth = new Date().getMonth() + 1;
  const currentMonthRecord = monthlyData.find(r => r.month === currentMonth && r.year === currentYear);

  const handleDeleteNote = async (id: string) => {
    if (!confirm('Delete this note?')) return;
    await api.deletePerformanceNote(id);
    setNotes(n => n.filter(x => x.id !== id));
  };

  const noteTypeConfig: Record<string, { icon: any; color: string; bg: string; border: string }> = {
    positive: { icon: CheckCircle, color: '#15803d', bg: '#f0fdf4', border: '#bbf7d0' },
    neutral:  { icon: Info,         color: '#192250', bg: '#f5f6fb', border: '#d8dced' },
    negative: { icon: AlertCircle,  color: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
  };

  const yearOptions = Array.from({ length: 4 }, (_, i) => currentYear - i);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-auto bg-gray-50">
      <TopBar title="Performance Management" />

      <div className="p-6 space-y-6">
        {/* ── Filters ── */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <select
              value={selectedEmpId}
              onChange={e => setSelectedEmpId(e.target.value)}
              className="appearance-none bg-white border border-gray-200 rounded-xl px-4 pr-9 py-2.5 text-sm font-semibold focus:outline-none shadow-sm"
              style={{ color: '#192250', minWidth: 200 }}
            >
              {employees.map(e => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>

          <div className="relative">
            <select
              value={selectedYear}
              onChange={e => setSelectedYear(Number(e.target.value))}
              className="appearance-none bg-white border border-gray-200 rounded-xl px-4 pr-9 py-2.5 text-sm font-semibold focus:outline-none shadow-sm"
              style={{ color: '#192250' }}
            >
              {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>

          <div className="ml-auto flex gap-2">
            {isHROrAdmin && (
              <>
                <button
                  onClick={() => setShowAddNote(true)}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border transition-all hover:bg-gray-50"
                  style={{ color: '#192250', borderColor: '#e2e4ed' }}
                >
                  <MessageSquare size={15} /> Add Note
                </button>
                <button
                  onClick={() => setShowAddReview({ month: currentMonth })}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-all"
                  style={{ background: 'linear-gradient(135deg, #EE2770 0%, #d11f62 100%)' }}
                >
                  <Plus size={15} /> Add Review
                </button>
              </>
            )}
          </div>
        </div>

        {/* ── KPI Cards ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            {
              label: 'Avg YTD Score', value: reviewedMonths ? avgScore : '—',
              sub: reviewedMonths ? scoreBadge(avgScore).label : 'No reviews yet',
              icon: TrendingUp, color: '#192250',
            },
            {
              label: 'Reviews Done', value: `${reviewedMonths}/12`,
              sub: `${12 - reviewedMonths} remaining`,
              icon: Target, color: '#EE2770',
            },
            {
              label: 'Best Month', value: bestMonth ? MONTHS[bestMonth.month - 1] : '—',
              sub: bestMonth ? `Score: ${bestMonth.overall_score}` : 'No data',
              icon: Award, color: '#16a34a',
            },
            {
              label: 'This Month', value: currentMonthRecord ? currentMonthRecord.overall_score : '—',
              sub: currentMonthRecord ? scoreBadge(currentMonthRecord.overall_score).label : 'Not reviewed',
              icon: Calendar, color: '#d97706',
            },
          ].map(({ label, value, sub, icon: Icon, color }) => (
            <div key={label} className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${color}18` }}>
                  <Icon size={18} style={{ color }} />
                </div>
              </div>
              <p className="text-2xl font-black" style={{ color: '#192250' }}>{value}</p>
              <p className="text-xs text-gray-400 mt-1">{label}</p>
              <p className="text-xs font-semibold mt-0.5" style={{ color }}>{sub}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* ── Monthly Bar Chart ── */}
          <div className="xl:col-span-2 bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="font-bold text-sm" style={{ color: '#192250' }}>Monthly Performance — {selectedYear}</h2>
                <p className="text-xs text-gray-400 mt-0.5">Overall score out of 100 per month</p>
              </div>
              <div className="flex gap-3 text-xs">
                {[['#16a34a','Excellent (≥85)'],['#192250','Good (70-84)'],['#d97706','Average (50-69)'],['#dc2626','Needs Work']].map(([c, l]) => (
                  <div key={l} className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-sm" style={{ background: c }} />
                    <span className="text-gray-500">{l}</span>
                  </div>
                ))}
              </div>
            </div>
            {loadingPerf ? (
              <div className="h-56 flex items-center justify-center text-gray-300 text-sm">Loading…</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData} barSize={28}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={28} />
                  <Tooltip content={<CustomBarTooltip />} cursor={{ fill: 'rgba(25,34,80,0.04)' }} />
                  <Bar dataKey="score" radius={[6, 6, 0, 0]}>
                    {chartData.map((entry, idx) => (
                      <Cell key={idx} fill={entry.score != null ? scoreColor(entry.score) : '#e5e7eb'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* ── Private Notes Panel ── */}
          {isHROrAdmin ? (
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="font-bold text-sm" style={{ color: '#192250' }}>Private Notes</h2>
                  <p className="text-xs text-gray-400 mt-0.5">Not visible to employee</p>
                </div>
                <button
                  onClick={() => setShowAddNote(true)}
                  className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                  title="Add note"
                >
                  <Plus size={15} style={{ color: '#EE2770' }} />
                </button>
              </div>

              {loadingNotes ? (
                <div className="flex-1 flex items-center justify-center text-gray-300 text-sm">Loading…</div>
              ) : notes.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center py-6">
                  <MessageSquare size={28} className="text-gray-200 mb-2" />
                  <p className="text-sm text-gray-400">No notes yet</p>
                  <p className="text-xs text-gray-300 mt-1">Add observations for future reference</p>
                </div>
              ) : (
                <div className="space-y-3 overflow-y-auto flex-1" style={{ maxHeight: 260 }}>
                  {notes.map(note => {
                    const cfg = noteTypeConfig[note.note_type] ?? noteTypeConfig.neutral;
                    const Icon = cfg.icon;
                    return (
                      <div key={note.id} className="rounded-xl p-3 border" style={{ background: cfg.bg, borderColor: cfg.border }}>
                        <div className="flex items-start gap-2">
                          <Icon size={14} style={{ color: cfg.color, flexShrink: 0, marginTop: 1 }} />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold" style={{ color: cfg.color }}>
                              {new Date(note.note_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                            </p>
                            <p className="text-xs text-gray-600 mt-1 leading-relaxed">{note.note_text}</p>
                            {note.created_by_name && (
                              <p className="text-xs text-gray-400 mt-1.5">— {note.created_by_name}</p>
                            )}
                          </div>
                          <button
                            onClick={() => handleDeleteNote(note.id)}
                            className="flex-shrink-0 p-1 hover:bg-white/60 rounded transition-colors"
                          >
                            <Trash2 size={12} style={{ color: cfg.color }} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 flex flex-col">
              <h2 className="font-bold text-sm mb-4" style={{ color: '#192250' }}>Category Breakdown</h2>
              {monthlyData.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-gray-300 text-sm">No reviews yet</div>
              ) : (
                <div className="space-y-3">
                  {CATEGORIES.map(({ key, label }) => {
                    const avg = Math.round(monthlyData.reduce((a, r) => a + (r[key] ?? 0), 0) / monthlyData.length);
                    return (
                      <div key={key}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="font-medium text-gray-600">{label}</span>
                          <span className="font-bold tabular-nums" style={{ color: scoreColor(avg) }}>{avg}</span>
                        </div>
                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all" style={{ width: `${avg}%`, background: scoreColor(avg) }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Monthly Reviews Table ── */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h2 className="font-bold text-sm" style={{ color: '#192250' }}>Monthly Reviews — {selectedYear}</h2>
            <span className="text-xs text-gray-400">{reviewedMonths} of 12 months reviewed</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: '#f8f9fc' }}>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Month</th>
                  {CATEGORIES.map(c => (
                    <th key={c.key} className="text-center px-3 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">{c.label.split(' ')[0]}</th>
                  ))}
                  <th className="text-center px-3 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Overall</th>
                  <th className="text-left px-3 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Reviewer</th>
                  {isHROrAdmin && <th className="text-right px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Action</th>}
                </tr>
              </thead>
              <tbody>
                {MONTHS.map((m, idx) => {
                  const record = monthlyData.find(r => r.month === idx + 1);
                  const monthNum = idx + 1;
                  const isFuture = selectedYear === currentYear && monthNum > currentMonth;
                  return (
                    <tr key={m} className="border-t border-gray-50 hover:bg-gray-50/50 transition-colors">
                      <td className="px-5 py-3.5 font-semibold" style={{ color: '#192250' }}>{m} {selectedYear}</td>
                      {CATEGORIES.map(c => (
                        <td key={c.key} className="px-3 py-3.5 text-center">
                          {record ? (
                            <span className="font-bold tabular-nums" style={{ color: scoreColor(record[c.key]) }}>{record[c.key]}</span>
                          ) : <span className="text-gray-300">—</span>}
                        </td>
                      ))}
                      <td className="px-3 py-3.5 text-center">
                        {record ? (
                          <span
                            className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold"
                            style={{ background: scoreBadge(record.overall_score).bg, color: scoreBadge(record.overall_score).text }}
                          >
                            {record.overall_score}
                          </span>
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-3.5 text-xs text-gray-400">{record?.reviewer_name ?? '—'}</td>
                      {isHROrAdmin && (
                        <td className="px-5 py-3.5 text-right">
                          {!isFuture && (
                            <button
                              onClick={() => setShowAddReview({ month: monthNum, existing: record })}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border hover:bg-gray-50 transition-colors"
                              style={{ color: '#192250', borderColor: '#e2e4ed' }}
                            >
                              <Edit3 size={11} />
                              {record ? 'Edit' : 'Add'}
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Modals */}
      {showAddReview && selectedEmp && (
        <AddReviewModal
          employee={selectedEmp}
          month={showAddReview.month}
          year={selectedYear}
          existing={showAddReview.existing}
          reviewer={{ id: user?.id, name: user?.name }}
          onSave={() => loadPerformance()}
          onClose={() => setShowAddReview(null)}
        />
      )}
      {showAddNote && selectedEmp && (
        <AddNoteModal
          employee={selectedEmp}
          reviewer={{ id: user?.id, name: user?.name }}
          onSave={note => setNotes(n => [note, ...n])}
          onClose={() => setShowAddNote(false)}
        />
      )}
    </div>
  );
}

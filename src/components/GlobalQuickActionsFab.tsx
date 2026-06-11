import { useState } from 'react';
import { Plus, X, Calendar, Briefcase, Monitor, DollarSign, ListChecks } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { toast } from './Toaster';

// Global Quick Actions FAB. Renders on every page (inside Layout) for any
// signed-in user. Actions that need a host page (Apply Leave / Apply WFH /
// Log Hours / Submit Expense) navigate to My Portal with a query param the
// host reads and auto-opens. Add To-Do is self-contained — opens its own
// quick-capture modal here.
//
// On the Login page this component isn't mounted because Layout itself
// only renders for protected routes.

export default function GlobalQuickActionsFab() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [showQuickTodo, setShowQuickTodo] = useState(false);

  // Only signed-in users get the FAB. Layout already gates the whole
  // protected tree on auth, but this is a defensive belt-and-braces.
  if (!user) return null;

  const close = () => setOpen(false);
  // Wrap each action so clicking it also closes the speed dial. Navigation
  // and modal-open happen first, close last — order matters because closing
  // can briefly steal focus.
  const wrap = (fn: () => void) => () => { fn(); close(); };

  // Navigation helpers — each goes to My Portal with the right tab + an
  // `apply=1` flag that MyPortal's mount effect picks up to auto-open the
  // matching modal. Using setSearchParams instead of a manual ?tab=… build
  // would also work; this is just direct navigate so the host can blow away
  // the query string after consuming it.
  const goLeave   = () => navigate('/my?tab=leave&apply=1');
  const goHours   = () => navigate('/my?tab=my-hours');
  const goWfh     = () => navigate('/my?tab=wfh&apply=1');
  const goExpense = () => navigate('/my?tab=expenses&apply=1');

  const actions = [
    { key: 'todo',    label: 'Add To-Do',      sub: 'Quick task capture',   icon: ListChecks, color: 'bg-on-surface text-surface',  ringColor: 'rgba(15,23,42,0.30)',   onClick: () => setShowQuickTodo(true) },
    { key: 'leave',   label: 'Apply Leave',    sub: 'Full / Half / Short',  icon: Calendar,   color: 'bg-brand text-on-brand',      ringColor: 'rgba(238,39,112,0.35)', onClick: goLeave },
    { key: 'hours',   label: 'Log Hours',      sub: 'Enter daily hours',    icon: Briefcase,  color: 'bg-accent text-on-accent',    ringColor: 'rgba(124,92,255,0.35)', onClick: goHours },
    { key: 'wfh',     label: 'Apply WFH',      sub: 'Work from home',       icon: Monitor,    color: 'bg-success text-on-accent',   ringColor: 'rgba(34,197,94,0.35)',  onClick: goWfh },
    { key: 'expense', label: 'Submit Expense', sub: 'Reimbursement claim',  icon: DollarSign, color: 'bg-warning text-on-accent',   ringColor: 'rgba(234,179,8,0.35)',  onClick: goExpense },
  ];

  // Hide the FAB while a feature popup or other full-screen overlay is
  // likely active. We can't introspect them from here, so the heuristic is
  // "hide on Login" — and Login isn't inside Layout anyway. Left as a no-op
  // hook for future suppression.
  void location;

  return (
    <>
      {/* Backdrop — click anywhere to close */}
      {open && (
        <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px] animate-fade-up" style={{ animationDuration: '120ms' }} onClick={close} />
      )}

      <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
        {/* Action chips, rendered in reverse so the first action appears nearest the FAB */}
        {open && (
          <div className="flex flex-col items-end gap-3">
            {actions.slice().reverse().map((a, i) => {
              const Icon = a.icon;
              return (
                <div key={a.key} className="flex items-center gap-3 animate-fade-up" style={{ animationDuration: '180ms', animationDelay: `${i * 35}ms`, animationFillMode: 'backwards' }}>
                  <div className="bg-surface border border-outline rounded-xl-2 shadow-elev-2 px-3 py-2 text-right">
                    <p className="text-sm font-bold text-on-surface leading-tight">{a.label}</p>
                    {a.sub && <p className="text-[11px] text-on-surface-muted leading-tight mt-0.5">{a.sub}</p>}
                  </div>
                  <button onClick={wrap(a.onClick)}
                    title={a.label}
                    className={`w-12 h-12 rounded-full ${a.color} shadow-elev-3 hover:scale-110 active:scale-95 transition-transform flex items-center justify-center`}
                    style={{ boxShadow: `0 6px 20px ${a.ringColor}` }}>
                    <Icon size={18} strokeWidth={2.25} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Main FAB */}
        <button onClick={() => setOpen(o => !o)}
          aria-label={open ? 'Close quick actions' : 'Open quick actions'}
          className="w-14 h-14 rounded-full bg-accent text-on-accent shadow-elev-3 hover:scale-110 active:scale-95 transition-all flex items-center justify-center"
          style={{ boxShadow: '0 8px 28px rgba(238,39,112,0.45)' }}>
          <Plus size={22} strokeWidth={2.5} className={`transition-transform duration-200 ${open ? 'rotate-45' : ''}`} />
        </button>
      </div>

      {showQuickTodo && (
        <QuickTodoModal
          onClose={() => setShowQuickTodo(false)}
          onAdded={() => setShowQuickTodo(false)}
        />
      )}
    </>
  );
}

// Quick-capture modal for a personal to-do. Always self-assigned. For
// assigning to someone else, the user opens the To-Do tab on My Portal —
// hint at the bottom of the modal points there.
function QuickTodoModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<'low' | 'normal' | 'high'>('normal');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    if (!title.trim()) { setError('Title is required'); return; }
    setBusy(true); setError('');
    try {
      await api.createTodo({
        title: title.trim(),
        description: description.trim() || undefined,
        due_date: dueDate || undefined,
        priority,
      });
      toast.success('To-do added', title.trim());
      onAdded();
    } catch (e: any) { setError(e?.message ?? 'Failed to add'); }
    finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline">
          <h2 className="font-bold text-base text-on-surface">Add a To-Do</h2>
          <button onClick={onClose}><X size={16} className="text-on-surface-subtle" /></button>
        </div>
        <div className="p-6 space-y-3">
          <div>
            <label className="text-[10px] uppercase tracking-wide font-semibold text-on-surface-subtle mb-1 block">Title *</label>
            <input value={title} onChange={e => setTitle(e.target.value)} autoFocus
              placeholder="What needs to happen?"
              className="w-full text-sm border border-outline rounded-lg px-3 py-2 bg-surface focus:outline-none focus:ring-2 focus:ring-accent/20" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wide font-semibold text-on-surface-subtle mb-1 block">Notes</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2}
              placeholder="Optional context…"
              className="w-full text-sm border border-outline rounded-lg px-3 py-2 bg-surface resize-none focus:outline-none focus:ring-2 focus:ring-accent/20" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-wide font-semibold text-on-surface-subtle mb-1 block">Due</label>
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                className="w-full text-sm border border-outline rounded-lg px-3 py-2 bg-surface focus:outline-none focus:ring-2 focus:ring-accent/20" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wide font-semibold text-on-surface-subtle mb-1 block">Priority</label>
              <select value={priority} onChange={e => setPriority(e.target.value as any)}
                className="w-full text-sm border border-outline rounded-lg px-3 py-2 bg-surface focus:outline-none focus:ring-2 focus:ring-accent/20">
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
              </select>
            </div>
          </div>
          {error && <p className="text-xs text-danger bg-danger-container/40 border border-danger/20 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button onClick={onClose}
              className="flex-1 py-2.5 border border-outline rounded-lg text-sm font-medium text-on-surface-muted hover:bg-surface-2">Cancel</button>
            <button onClick={submit} disabled={busy || !title.trim()}
              className="flex-1 py-2.5 bg-accent text-on-accent rounded-lg text-sm font-semibold disabled:opacity-50">
              {busy ? 'Adding…' : 'Add'}
            </button>
          </div>
          <p className="text-[10px] text-on-surface-subtle text-center pt-1">
            For assigning to someone else, open the To-Do tab.
          </p>
        </div>
      </div>
    </div>
  );
}

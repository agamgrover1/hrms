import { useEffect, useMemo, useState } from 'react';
import { X, Award, Search, Send } from 'lucide-react';
import { api } from '../../services/api';
import { toast } from '../Toaster';
import { useAuth } from '../../context/AuthContext';

// Compose a new praise. Person picker + optional category chip + a
// prompt-style textarea. Self-praise is blocked at the server; we
// filter the picker locally too so it doesn't even offer the option.

const CATEGORIES: Array<{ id: string; label: string; emoji: string }> = [
  { id: 'ownership',  label: 'Ownership',   emoji: '🎯' },
  { id: 'teamwork',   label: 'Teamwork',    emoji: '🤝' },
  { id: 'quality',    label: 'Quality',     emoji: '✨' },
  { id: 'client_win', label: 'Client win',  emoji: '🏆' },
  { id: 'grit',       label: 'Grit',        emoji: '💪' },
  { id: 'other',      label: 'Just a thanks', emoji: '💛' },
];

interface EmpSlim {
  id: string; employee_id: string; name: string;
  designation?: string | null; department?: string | null; status?: string | null;
}

export default function GivePraiseModal({
  onClose, onSaved, seedRecipientId,
}: {
  onClose: () => void;
  onSaved: () => void;
  seedRecipientId?: string;
}) {
  const { user } = useAuth();
  const [employees, setEmployees] = useState<EmpSlim[]>([]);
  const [loadingEmps, setLoadingEmps] = useState(true);
  const [search, setSearch] = useState('');
  const [recipientId, setRecipientId] = useState<string | null>(seedRecipientId ?? null);
  const [category, setCategory] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [selfEmpId, setSelfEmpId] = useState<string | null>(null);

  useEffect(() => {
    setLoadingEmps(true);
    api.getEmployeesSlim()
      .then(rs => {
        const active = (rs as EmpSlim[]).filter(e => (e.status ?? 'active') === 'active');
        active.sort((a, b) => a.name.localeCompare(b.name));
        setEmployees(active);
        // Resolve caller's own employee id so we can exclude them
        // from the picker. Falls back to matching by employee_id_ref
        // (the human code, e.g. DL0026) → internal id.
        const mine = active.find(e => e.employee_id === user?.employee_id_ref || e.id === user?.employee_id_ref);
        if (mine) setSelfEmpId(mine.id);
      })
      .catch(() => setEmployees([]))
      .finally(() => setLoadingEmps(false));
  }, [user?.employee_id_ref]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const pool = employees.filter(e => e.id !== selfEmpId);
    if (!q) return pool.slice(0, 24);
    return pool.filter(e =>
      e.name.toLowerCase().includes(q)
      || (e.employee_id ?? '').toLowerCase().includes(q)
      || (e.department ?? '').toLowerCase().includes(q)
    ).slice(0, 24);
  }, [employees, search, selfEmpId]);

  const recipient = employees.find(e => e.id === recipientId) || null;

  const submit = async () => {
    if (!recipientId) { toast.error('Pick someone', 'Choose a recipient first.'); return; }
    if (!message.trim()) { toast.error('Add a note', 'Say what they did well.'); return; }
    setBusy(true);
    try {
      await api.createPraise({
        recipient_id: recipientId,
        message: message.trim(),
        category: category ?? undefined,
      });
      toast.success('Shout-out sent', `${recipient?.name.split(' ')[0] ?? 'They'} will see it on their bell.`);
      onSaved();
    } catch (e: any) {
      toast.error('Send failed', e?.body?.error ?? e?.message ?? 'Please try again.');
    } finally { setBusy(false); }
  };

  const initials = (name: string) =>
    name.split(/\s+/).filter(Boolean).map(p => p[0]).slice(0, 2).join('').toUpperCase() || '?';

  return (
    <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className="bg-surface rounded-xl-3 border border-outline shadow-elev-4 w-full max-w-lg overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-outline flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Award size={18} className="text-accent" />
            <h3 className="font-display text-lg font-bold text-on-surface">Give a shout-out</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-surface-2 text-on-surface-muted">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Recipient picker */}
          <div>
            <label className="text-xs font-semibold text-on-surface-muted mb-1.5 block">To</label>
            {recipient ? (
              <div className="flex items-center gap-2 p-2.5 rounded-lg border border-accent/40 bg-accent/5">
                <div className="w-8 h-8 rounded-full bg-accent/15 text-accent text-xs font-bold flex items-center justify-center">
                  {initials(recipient.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-on-surface truncate">{recipient.name}</p>
                  <p className="text-[11px] text-on-surface-subtle truncate">
                    {recipient.designation ?? '—'}{recipient.department ? ` · ${recipient.department}` : ''}
                  </p>
                </div>
                <button onClick={() => setRecipientId(null)}
                  className="p-1 text-on-surface-subtle hover:text-on-surface rounded" title="Change">
                  <X size={12} />
                </button>
              </div>
            ) : (
              <div>
                <div className="relative">
                  <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface-subtle" />
                  <input value={search} onChange={e => setSearch(e.target.value)}
                    autoFocus
                    placeholder="Search name, code, department…"
                    className="w-full text-sm pl-8 pr-2 py-2 bg-surface border border-outline rounded-lg focus:outline-none focus:border-accent" />
                </div>
                <div className="mt-2 max-h-52 overflow-y-auto border border-outline rounded-lg divide-y divide-outline bg-surface-2/30">
                  {loadingEmps ? (
                    <p className="p-4 text-center text-xs text-on-surface-subtle">Loading…</p>
                  ) : filtered.length === 0 ? (
                    <p className="p-4 text-center text-xs text-on-surface-subtle italic">No match.</p>
                  ) : filtered.map(e => (
                    <button key={e.id} onClick={() => setRecipientId(e.id)}
                      className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-surface-2">
                      <div className="w-7 h-7 rounded-full bg-accent/15 text-accent text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                        {initials(e.name)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-on-surface truncate">{e.name}</p>
                        <p className="text-[11px] text-on-surface-subtle truncate">
                          {e.designation ?? '—'}{e.department ? ` · ${e.department}` : ''}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Category — optional. Chips instead of a dropdown so
              picking one is one tap, and it's a fun visual cue. */}
          <div>
            <label className="text-xs font-semibold text-on-surface-muted mb-1.5 block">Category (optional)</label>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map(c => (
                <button key={c.id} onClick={() => setCategory(category === c.id ? null : c.id)}
                  className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full border transition-all ${
                    category === c.id
                      ? 'bg-accent/10 border-accent/50 text-accent-ink font-semibold'
                      : 'bg-surface border-outline text-on-surface-muted hover:border-accent/40'
                  }`}>
                  <span>{c.emoji}</span> {c.label}
                </button>
              ))}
            </div>
          </div>

          {/* Message */}
          <div>
            <label className="text-xs font-semibold text-on-surface-muted mb-1.5 block">What they did</label>
            <textarea value={message} onChange={e => setMessage(e.target.value)}
              rows={4}
              placeholder="Concrete beats generic — “Nailed the Anshum launch review and stayed till 9 to close feedback” lands harder than “great work”."
              className="w-full text-sm bg-surface border border-outline rounded-lg px-3 py-2.5 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 resize-y" />
            <p className="text-[10px] text-on-surface-subtle mt-1">
              Everyone will see this on the dashboard for a week — react and comment welcome.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-outline bg-surface-2/30 flex items-center justify-end gap-2">
          <button onClick={onClose}
            className="px-3 py-2 rounded-lg border border-outline text-sm font-semibold text-on-surface hover:bg-surface-2">
            Cancel
          </button>
          <button onClick={submit} disabled={!recipient || !message.trim() || busy}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-on-accent text-sm font-semibold hover:opacity-90 disabled:opacity-50">
            <Send size={13} /> {busy ? 'Sending…' : 'Send shout-out'}
          </button>
        </div>
      </div>
    </div>
  );
}

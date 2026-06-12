import { useState } from 'react';
import { X } from 'lucide-react';
import { api } from '../services/api';
import { toast } from './Toaster';

// Inline note editor for a short / incomplete attendance day. Used by both
// the employee (self-reporting from My Portal) AND the HR / admin / manager
// (annotating someone else's day from the HR Attendance page). The server
// enforces who can touch which row; this component is identical regardless
// of viewer. Empty save = delete the existing note. ⌘/Ctrl-Enter sends.

export default function AttendanceNoteModal({
  employeeId, date, existing, authorName = null, authorRole = null, onClose, onSaved,
}: {
  employeeId: string;
  date: string;
  existing: string;
  authorName?: string | null;
  authorRole?: string | null;
  onClose: () => void;
  onSaved: (noteText: string) => void;
}) {
  const [text, setText] = useState(existing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const friendlyDate = new Date(date + 'T12:00:00Z').toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  const submit = async () => {
    setBusy(true); setError('');
    try {
      await api.upsertAttendanceNote({ employee_id: employeeId, date, note: text.trim() });
      toast.success(text.trim() ? 'Note saved' : 'Note deleted', friendlyDate);
      onSaved(text.trim());
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save');
      toast.error('Failed to save note', e?.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-outline">
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline">
          <div>
            <h3 className="font-display text-base font-bold text-on-surface">Note for {friendlyDate}</h3>
            <p className="text-[11px] text-on-surface-muted mt-0.5">
              {authorName
                ? <>Saving as <b>{authorName}</b>{authorRole ? ` (${authorRole})` : ''}. Blank + save deletes the note.</>
                : <>Add context for HR / your manager. Leave it blank and save to clear.</>}
            </p>
          </div>
          <button onClick={onClose}><X size={16} className="text-on-surface-subtle" /></button>
        </div>
        <div className="p-6 space-y-3">
          <textarea value={text} onChange={e => setText(e.target.value)} rows={4} autoFocus
            placeholder="e.g. Left early for a doctor's appointment. Will make up the hours on Saturday."
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); }}
            className="w-full text-sm border border-outline rounded-lg px-3 py-2 bg-surface resize-none focus:outline-none focus:ring-2 focus:ring-accent/30" />
          {error && <p className="text-xs text-danger bg-danger-container/40 border border-danger/20 rounded-lg px-3 py-2">{error}</p>}
          <p className="text-[10px] text-on-surface-subtle">⌘/Ctrl-Enter to save.</p>
        </div>
        <div className="px-6 py-3 border-t border-outline flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-on-surface-muted hover:bg-surface-2 rounded-lg">Cancel</button>
          <button onClick={submit} disabled={busy}
            className="px-4 py-2 text-sm font-semibold bg-accent text-on-accent rounded-lg disabled:opacity-50">
            {busy ? 'Saving…' : (existing && !text.trim()) ? 'Delete note' : existing ? 'Update' : 'Save note'}
          </button>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { FileText, Plus, ExternalLink, XCircle, X, ShieldAlert } from 'lucide-react';
import { api, type HrDocument } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { toast } from '../Toaster';

// Per-employee HR-documents panel — mounted from the Documents tab on
// EmployeeProfile. HR (admin + hr_manager) can issue + void; hr_intern
// and other roles get read-only.

interface Props {
  employeeId: string;
  employeeName?: string;
}

type DocTypeMeta = { key: string; code: string; label: string };

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(String(iso).slice(0, 10) + 'T12:00:00Z')
    .toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function DocumentsPanel({ employeeId, employeeName }: Props) {
  const { user } = useAuth();
  const canIssue = user?.role === 'admin' || user?.role === 'hr_manager';
  const [docs, setDocs] = useState<HrDocument[]>([]);
  const [types, setTypes] = useState<DocTypeMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [showIssue, setShowIssue] = useState(false);

  const load = () => {
    setLoading(true);
    api.getHrDocuments({ employee_id: employeeId })
      .then(setDocs)
      .catch(() => setDocs([]))
      .finally(() => setLoading(false));
  };
  useEffect(load, [employeeId]);
  useEffect(() => { api.getHrDocumentTypes().then(setTypes).catch(() => setTypes([])); }, []);

  const typeByKey = useMemo(() => {
    const m: Record<string, DocTypeMeta> = {};
    for (const t of types) m[t.key] = t;
    return m;
  }, [types]);

  const onIssued = (doc: HrDocument) => {
    setDocs(prev => [doc, ...prev]);
    setShowIssue(false);
    toast.success('Document issued', `Number ${doc.doc_number} — use this on the file name.`);
  };

  const voidDoc = async (doc: HrDocument) => {
    const reason = window.prompt(`Void ${doc.doc_number}? Enter a reason (visible in the audit trail):`);
    if (!reason?.trim()) return;
    try {
      const updated = await api.voidHrDocument(doc.id, reason.trim());
      setDocs(prev => prev.map(d => d.id === doc.id ? updated : d));
      toast.success('Document voided', `${doc.doc_number} is now marked void. The number stays reserved.`);
    } catch (e: any) { toast.error('Void failed', e?.message); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="font-display text-lg font-bold text-on-surface flex items-center gap-2">
            <FileText className="w-5 h-5 text-accent" /> Documents
          </h3>
          <p className="text-xs text-on-surface-muted mt-0.5">
            Formal letters HR has issued to {employeeName ?? 'this employee'}. Each has a unique number that stays reserved forever — voided rows preserve the sequence.
          </p>
        </div>
        {canIssue && (
          <button
            onClick={() => setShowIssue(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent text-on-accent text-sm font-semibold hover:opacity-90">
            <Plus className="w-4 h-4" /> Issue Document
          </button>
        )}
      </div>

      {loading ? (
        <div className="h-40 rounded-xl-2 bg-surface-2 animate-pulse" />
      ) : docs.length === 0 ? (
        <div className="rounded-xl-2 border border-outline bg-surface p-8 text-center">
          <FileText className="w-8 h-8 mx-auto text-on-surface-subtle mb-2" />
          <p className="text-sm text-on-surface-muted">No documents issued yet.</p>
          {canIssue && (
            <p className="text-xs text-on-surface-subtle mt-1">Click "Issue Document" to record one.</p>
          )}
        </div>
      ) : (
        <div className="rounded-xl-2 border border-outline bg-surface overflow-hidden">
          <ul className="divide-y divide-outline">
            {docs.map(doc => {
              const meta = typeByKey[doc.doc_type];
              const typeLabel = doc.doc_type === 'other' && doc.doc_type_label
                ? doc.doc_type_label
                : (meta?.label ?? doc.doc_type);
              return (
                <li key={doc.id} className={`px-4 py-3 flex items-start gap-4 ${doc.voided ? 'bg-surface-2/40' : 'hover:bg-surface-2/40'}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`num-mono text-sm font-bold ${doc.voided ? 'line-through text-on-surface-subtle' : 'text-on-surface'}`}>
                        {doc.doc_number}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent border border-accent/20 uppercase tracking-wider">
                        {meta?.code ?? doc.doc_type}
                      </span>
                      {doc.voided && (
                        <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-danger/15 text-danger border border-danger/30 uppercase tracking-wider">
                          <ShieldAlert className="w-2.5 h-2.5" /> Voided
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-on-surface mt-0.5">{typeLabel}{doc.subject ? ` — ${doc.subject}` : ''}</p>
                    <p className="text-[11px] text-on-surface-muted mt-0.5">
                      Issued {fmtDate(doc.issued_on)}
                      {doc.issued_by_name && <> · by {doc.issued_by_name}</>}
                    </p>
                    {doc.notes && (
                      <p className="text-[11px] text-on-surface-muted mt-1 whitespace-pre-wrap italic">"{doc.notes}"</p>
                    )}
                    {doc.voided && doc.voided_reason && (
                      <p className="text-[11px] text-danger mt-1 italic">
                        Void reason: "{doc.voided_reason}"
                        {doc.voided_by_name && <span className="text-on-surface-subtle not-italic ml-1">— {doc.voided_by_name}</span>}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    {doc.external_ref && (
                      <a href={doc.external_ref} target="_blank" rel="noreferrer"
                        title="Open PDF"
                        className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
                        <ExternalLink className="w-3.5 h-3.5" /> PDF
                      </a>
                    )}
                    {canIssue && !doc.voided && (
                      <button onClick={() => voidDoc(doc)}
                        title="Void this document"
                        className="text-on-surface-muted hover:text-danger p-1.5 rounded-md hover:bg-danger-container/40">
                        <XCircle className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {showIssue && (
        <IssueDocumentModal
          employeeId={employeeId}
          employeeName={employeeName ?? ''}
          types={types}
          onClose={() => setShowIssue(false)}
          onIssued={onIssued}
        />
      )}
    </div>
  );
}

function IssueDocumentModal({ employeeId, employeeName, types, onClose, onIssued }: {
  employeeId: string;
  employeeName: string;
  types: DocTypeMeta[];
  onClose: () => void;
  onIssued: (doc: HrDocument) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    doc_type: types[0]?.key ?? 'appointment_letter',
    doc_type_label: '',
    issued_on: today,
    subject: '',
    notes: '',
    external_ref: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isOther = form.doc_type === 'other';

  const submit = async () => {
    setError('');
    if (isOther && !form.doc_type_label.trim()) { setError('Give the "Other" doc a label (e.g. "Reference letter").'); return; }
    setBusy(true);
    try {
      const doc = await api.issueHrDocument({
        doc_type: form.doc_type,
        doc_type_label: isOther ? form.doc_type_label.trim() : undefined,
        employee_id: employeeId,
        issued_on: form.issued_on,
        subject: form.subject.trim() || undefined,
        notes: form.notes.trim() || undefined,
        external_ref: form.external_ref.trim() || undefined,
      });
      onIssued(doc);
    } catch (e: any) {
      setError(e?.message ?? 'Save failed');
    } finally { setBusy(false); }
  };

  const inputCls = 'w-full text-sm bg-surface border border-outline focus:border-accent focus:ring-2 focus:ring-accent/20 rounded-lg px-3 py-2 focus:outline-none text-on-surface';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/55 backdrop-blur-sm p-4">
      <div className="bg-surface rounded-2xl shadow-elev-4 border border-outline w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline">
          <div>
            <h3 className="font-display text-lg font-semibold text-on-surface">Issue document</h3>
            <p className="text-xs text-on-surface-muted mt-0.5">for {employeeName}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-surface-2 rounded-lg"><X className="w-4 h-4 text-on-surface-muted" /></button>
        </div>
        <div className="p-6 space-y-3">
          {error && (
            <div className="rounded-lg border border-danger/30 bg-danger-container/40 p-3 text-sm text-danger">{error}</div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-muted">Document type</label>
              <select value={form.doc_type} onChange={e => setForm(f => ({ ...f, doc_type: e.target.value }))} className={inputCls}>
                {types.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-muted">Issued on</label>
              <input type="date" value={form.issued_on}
                onChange={e => setForm(f => ({ ...f, issued_on: e.target.value }))}
                className={inputCls} />
            </div>
          </div>
          {isOther && (
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-muted">Custom label *</label>
              <input value={form.doc_type_label}
                onChange={e => setForm(f => ({ ...f, doc_type_label: e.target.value }))}
                placeholder="e.g. Reference letter, LOI…"
                className={inputCls} />
            </div>
          )}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-muted">Subject</label>
            <input value={form.subject}
              onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
              placeholder="Brief one-liner shown on the row"
              className={inputCls} />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-muted">PDF link (Drive / SharePoint)</label>
            <input type="url" value={form.external_ref}
              onChange={e => setForm(f => ({ ...f, external_ref: e.target.value }))}
              placeholder="https://…"
              className={inputCls} />
            <p className="text-[10px] text-on-surface-subtle mt-1">Paste the shareable link to the PDF. Employees see it as an "PDF" open-in-new-tab button.</p>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-muted">Notes</label>
            <textarea value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              rows={2}
              placeholder="Any context that helps the audit trail"
              className={inputCls + ' resize-none'} />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-outline flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-on-surface-muted hover:bg-surface-2 rounded-lg">Cancel</button>
          <button onClick={submit} disabled={busy}
            className="px-4 py-2 text-sm font-semibold bg-accent text-on-accent rounded-lg hover:opacity-90 disabled:opacity-50">
            {busy ? 'Issuing…' : 'Issue & allocate number'}
          </button>
        </div>
      </div>
    </div>
  );
}

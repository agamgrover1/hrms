import { useEffect, useMemo, useState } from 'react';
import { X, User, UserPlus } from 'lucide-react';
import { api, type HrDocument } from '../../services/api';

// Shared "Issue document" modal used from two places:
//   1. EmployeeProfile → Documents tab — mode fixed to 'employee', tied to
//      the profile owner. No recipient toggle.
//   2. HRDocumentsRegister (global) — mode is togglable so HR can issue
//      to an existing employee OR to an external recipient (intern before
//      onboarding, candidate, contractor, ex-employee).
// External docs share the same DL-{TYPE}-{YEAR}-#### sequence as employee
// docs — the number space is unified so a register-wide count still
// matches "how many appointment letters did we issue this year".

export type DocTypeMeta = { key: string; code: string; label: string };
export type EmployeeOption = { id: string; name: string; employee_id?: string };

interface Props {
  types: DocTypeMeta[];
  onClose: () => void;
  onIssued: (doc: HrDocument) => void;
  // Employee mode: pre-fill the recipient and lock it.
  lockedEmployee?: { id: string; name: string };
  // External / mixed mode: pass the employee list so the picker works;
  // the modal shows a toggle between Employee and External.
  employees?: EmployeeOption[];
  // Force initial mode. Defaults to 'employee' when lockedEmployee is set,
  // otherwise 'employee' with the toggle visible.
  initialMode?: 'employee' | 'external';
}

export default function IssueDocumentModal({
  types, onClose, onIssued, lockedEmployee, employees, initialMode,
}: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const canToggleMode = !lockedEmployee;
  const [mode, setMode] = useState<'employee' | 'external'>(
    initialMode ?? (lockedEmployee ? 'employee' : 'employee')
  );
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>(lockedEmployee?.id ?? '');
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [form, setForm] = useState({
    doc_type: types[0]?.key ?? 'appointment_letter',
    doc_type_label: '',
    recipient_name: '',
    recipient_email: '',
    issued_on: today,
    subject: '',
    notes: '',
    external_ref: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isOther = form.doc_type === 'other';

  // Once types load, snap doc_type onto a valid key.
  useEffect(() => {
    if (types.length && !types.find(t => t.key === form.doc_type)) {
      setForm(f => ({ ...f, doc_type: types[0].key }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [types]);

  const filteredEmployees = useMemo(() => {
    if (!employees) return [] as EmployeeOption[];
    const q = employeeSearch.trim().toLowerCase();
    if (!q) return employees.slice(0, 50);
    return employees.filter(e =>
      e.name.toLowerCase().includes(q) ||
      (e.employee_id ?? '').toLowerCase().includes(q)
    ).slice(0, 50);
  }, [employees, employeeSearch]);

  const selectedEmployee = useMemo(() =>
    lockedEmployee ?? employees?.find(e => e.id === selectedEmployeeId) ?? null,
    [lockedEmployee, employees, selectedEmployeeId]
  );

  const submit = async () => {
    setError('');
    if (isOther && !form.doc_type_label.trim()) {
      setError('Give the "Other" doc a label (e.g. "Reference letter").'); return;
    }
    if (mode === 'employee' && !selectedEmployee) {
      setError('Pick an employee.'); return;
    }
    if (mode === 'external' && !form.recipient_name.trim()) {
      setError('Recipient name is required for an external doc.'); return;
    }
    setBusy(true);
    try {
      const payload: Parameters<typeof api.issueHrDocument>[0] = {
        doc_type: form.doc_type,
        doc_type_label: isOther ? form.doc_type_label.trim() : undefined,
        issued_on: form.issued_on,
        subject: form.subject.trim() || undefined,
        notes: form.notes.trim() || undefined,
        external_ref: form.external_ref.trim() || undefined,
      };
      if (mode === 'employee') {
        payload.employee_id = selectedEmployee!.id;
      } else {
        payload.recipient_name = form.recipient_name.trim();
        if (form.recipient_email.trim()) payload.recipient_email = form.recipient_email.trim();
      }
      const doc = await api.issueHrDocument(payload);
      onIssued(doc);
    } catch (e: any) {
      setError(e?.message ?? 'Save failed');
    } finally { setBusy(false); }
  };

  const inputCls = 'w-full text-sm bg-surface border border-outline focus:border-accent focus:ring-2 focus:ring-accent/20 rounded-lg px-3 py-2 focus:outline-none text-on-surface';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/55 backdrop-blur-sm p-4">
      <div className="bg-surface rounded-2xl shadow-elev-4 border border-outline w-full max-w-lg max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline">
          <div>
            <h3 className="font-display text-lg font-semibold text-on-surface">Issue document</h3>
            {lockedEmployee && (
              <p className="text-xs text-on-surface-muted mt-0.5">for {lockedEmployee.name}</p>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-surface-2 rounded-lg"><X className="w-4 h-4 text-on-surface-muted" /></button>
        </div>
        <div className="p-6 space-y-3">
          {error && (
            <div className="rounded-lg border border-danger/30 bg-danger-container/40 p-3 text-sm text-danger">{error}</div>
          )}

          {canToggleMode && (
            <div className="inline-flex items-center gap-0.5 bg-surface-2 rounded-lg border border-outline p-0.5">
              <button onClick={() => setMode('employee')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 ${mode === 'employee' ? 'bg-accent text-on-accent' : 'text-on-surface-muted hover:text-on-surface'}`}>
                <User className="w-3.5 h-3.5" /> Employee
              </button>
              <button onClick={() => setMode('external')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 ${mode === 'external' ? 'bg-accent text-on-accent' : 'text-on-surface-muted hover:text-on-surface'}`}>
                <UserPlus className="w-3.5 h-3.5" /> External
              </button>
            </div>
          )}

          {mode === 'employee' && !lockedEmployee && (
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-muted">Employee *</label>
              <input list="issue-doc-emp-list" value={employeeSearch}
                onChange={e => {
                  const v = e.target.value; setEmployeeSearch(v);
                  const match = employees?.find(x => `${x.name}${x.employee_id ? ` (${x.employee_id})` : ''}` === v);
                  setSelectedEmployeeId(match?.id ?? '');
                }}
                placeholder="Type to search…"
                className={inputCls} />
              <datalist id="issue-doc-emp-list">
                {filteredEmployees.map(e => (
                  <option key={e.id} value={`${e.name}${e.employee_id ? ` (${e.employee_id})` : ''}`} />
                ))}
              </datalist>
              {selectedEmployee && (
                <p className="text-[11px] text-success mt-1">✓ {selectedEmployee.name}</p>
              )}
            </div>
          )}

          {mode === 'external' && (
            <div className="rounded-lg border border-accent/30 bg-accent/5 p-3 space-y-3">
              <p className="text-[11px] text-on-surface-muted">
                Use this for anyone NOT in the employee list — interns pre-onboarding, candidates receiving an offer, contractors, or ex-employees needing a fresh letter.
              </p>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-muted">Recipient name *</label>
                <input value={form.recipient_name}
                  onChange={e => setForm(f => ({ ...f, recipient_name: e.target.value }))}
                  placeholder="Full name as it should appear on the letter"
                  className={inputCls} />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-muted">Recipient email</label>
                <input type="email" value={form.recipient_email}
                  onChange={e => setForm(f => ({ ...f, recipient_email: e.target.value }))}
                  placeholder="Optional — for your own records"
                  className={inputCls} />
              </div>
            </div>
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
            <p className="text-[10px] text-on-surface-subtle mt-1">Paste the shareable link to the PDF. Renders as an open-in-new-tab button on the register.</p>
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

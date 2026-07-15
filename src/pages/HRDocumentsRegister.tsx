import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Search, ExternalLink, ShieldAlert, X, Filter, Plus, UserPlus } from 'lucide-react';
import { api, type HrDocument } from '../services/api';
import { useAuth } from '../context/AuthContext';
import IssueDocumentModal, { type EmployeeOption } from '../components/hr/IssueDocumentModal';
import { toast } from '../components/Toaster';

// Global HR-document register — admin/HR view of every letter ever
// issued. Filter by employee / type / date range / free-text search
// (hits doc_number, subject, notes, employee name via ILIKE on the
// backend).

type DocTypeMeta = { key: string; code: string; label: string };

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(String(iso).slice(0, 10) + 'T12:00:00Z')
    .toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function HRDocumentsRegister() {
  const { user } = useAuth();
  const isAllowed = user?.role === 'admin' || user?.role === 'hr_manager' || user?.role === 'hr_intern';
  const canIssue = user?.role === 'admin' || user?.role === 'hr_manager';

  const [types, setTypes] = useState<DocTypeMeta[]>([]);
  const [docs, setDocs] = useState<HrDocument[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<string>('');
  const [filterFrom, setFilterFrom] = useState<string>('');
  const [filterTo, setFilterTo] = useState<string>('');
  const [query, setQuery] = useState('');
  // Debounce free-text search so every keystroke doesn't hit the API.
  const [debouncedQ, setDebouncedQ] = useState('');
  // Issue modal — starts in the requested mode when opened.
  const [issueMode, setIssueMode] = useState<null | 'employee' | 'external'>(null);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => { api.getHrDocumentTypes().then(setTypes).catch(() => setTypes([])); }, []);
  // Employees list for the picker inside the modal. Slim endpoint keeps
  // the payload small.
  useEffect(() => {
    if (!canIssue) return;
    api.getEmployeesSlim()
      .then(rows => setEmployees((rows as any[]).map(e => ({ id: e.id, name: e.name, employee_id: e.employee_id }))))
      .catch(() => setEmployees([]));
  }, [canIssue]);

  useEffect(() => {
    if (!isAllowed) return;
    setLoading(true);
    api.getHrDocuments({
      doc_type: filterType || undefined,
      from: filterFrom || undefined,
      to: filterTo || undefined,
      q: debouncedQ || undefined,
    })
      .then(setDocs)
      .catch(() => setDocs([]))
      .finally(() => setLoading(false));
  }, [filterType, filterFrom, filterTo, debouncedQ, isAllowed]);

  const typeByKey = useMemo(() => {
    const m: Record<string, DocTypeMeta> = {};
    for (const t of types) m[t.key] = t;
    return m;
  }, [types]);

  const clearFilters = () => {
    setFilterType(''); setFilterFrom(''); setFilterTo(''); setQuery('');
  };
  const filtersActive = filterType || filterFrom || filterTo || query;

  if (!isAllowed) {
    return (
      <div className="rounded-xl-2 border border-outline bg-surface p-12 text-center">
        <ShieldAlert className="w-8 h-8 mx-auto text-on-surface-subtle mb-2" />
        <p className="text-sm text-on-surface-muted">This page is HR + admin only.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold text-on-surface flex items-center gap-2">
            <FileText className="w-6 h-6 text-accent" /> HR Documents
          </h1>
          <p className="text-sm text-on-surface-muted mt-1">
            Every letter issued — employees + external recipients (interns pre-onboarding, candidates, ex-employees).
            Numbers reset per (type, year); voided numbers are never reused.
          </p>
        </div>
        {canIssue && (
          <div className="inline-flex items-center gap-2 shrink-0">
            <button onClick={() => setIssueMode('external')}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-accent border border-accent/40 hover:bg-accent/10 transition-colors"
              title="Issue a letter to someone NOT on HRMS (intern, candidate, contractor)">
              <UserPlus className="w-4 h-4" /> Issue to external
            </button>
            <button onClick={() => setIssueMode('employee')}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-accent text-on-accent hover:opacity-90">
              <Plus className="w-4 h-4" /> Issue to employee
            </button>
          </div>
        )}
      </div>

      {/* Filter bar */}
      <div className="rounded-xl-2 border border-outline bg-surface p-3 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface-subtle" />
          <input value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search doc number, subject, notes, employee…"
            className="w-full pl-8 pr-2 py-2 text-sm bg-surface-2 border border-outline rounded-lg focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20" />
        </div>
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          className="text-sm bg-surface-2 border border-outline rounded-lg px-3 py-2 focus:outline-none focus:border-accent">
          <option value="">All types</option>
          {types.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)}
          title="Issued on or after"
          className="text-sm bg-surface-2 border border-outline rounded-lg px-3 py-2 focus:outline-none focus:border-accent" />
        <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)}
          title="Issued on or before"
          className="text-sm bg-surface-2 border border-outline rounded-lg px-3 py-2 focus:outline-none focus:border-accent" />
        {filtersActive && (
          <button onClick={clearFilters} title="Clear filters"
            className="p-2 text-on-surface-muted hover:text-on-surface hover:bg-surface-2 rounded-lg">
            <X className="w-4 h-4" />
          </button>
        )}
        <span className="ml-auto text-xs text-on-surface-subtle">
          <Filter className="w-3 h-3 inline mr-1" />
          {loading ? 'Loading…' : `${docs.length} result${docs.length === 1 ? '' : 's'}`}
        </span>
      </div>

      {/* Table */}
      <div className="rounded-xl-2 border border-outline bg-surface overflow-hidden">
        {loading ? (
          <div className="h-40 bg-surface-2 animate-pulse" />
        ) : docs.length === 0 ? (
          <div className="p-12 text-center">
            <FileText className="w-8 h-8 mx-auto text-on-surface-subtle mb-2" />
            <p className="text-sm text-on-surface-muted">
              {filtersActive ? 'No documents match your filters.' : 'No documents issued yet.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 border-b border-outline text-left text-xs font-semibold text-on-surface-muted uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-2">Doc number</th>
                  <th className="px-4 py-2">Type</th>
                  <th className="px-4 py-2">Employee</th>
                  <th className="px-4 py-2">Issued on</th>
                  <th className="px-4 py-2">Issued by</th>
                  <th className="px-4 py-2">Subject</th>
                  <th className="px-4 py-2 text-right">PDF</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline">
                {docs.map(doc => {
                  const meta = typeByKey[doc.doc_type];
                  const typeLabel = doc.doc_type === 'other' && doc.doc_type_label
                    ? doc.doc_type_label
                    : (meta?.label ?? doc.doc_type);
                  return (
                    <tr key={doc.id} className={`hover:bg-surface-2/50 ${doc.voided ? 'opacity-60' : ''}`}>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className={`num-mono text-xs font-bold ${doc.voided ? 'line-through text-on-surface-subtle' : 'text-on-surface'}`}>
                            {doc.doc_number}
                          </span>
                          {doc.voided && (
                            <span className="text-[9px] px-1 py-0.5 rounded bg-danger/15 text-danger border border-danger/30 uppercase tracking-wider">
                              Void
                            </span>
                          )}
                        </div>
                        {doc.voided && doc.voided_reason && (
                          <p className="text-[10px] text-danger italic mt-0.5">"{doc.voided_reason}"</p>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-xs px-1.5 py-0.5 rounded bg-accent/10 text-accent border border-accent/20 uppercase tracking-wider">
                          {meta?.code ?? doc.doc_type}
                        </span>
                        <p className="text-[11px] text-on-surface-muted mt-0.5">{typeLabel}</p>
                      </td>
                      <td className="px-4 py-2.5">
                        {doc.employee_id ? (
                          <>
                            <Link to={`/employees/${doc.employee_code || doc.employee_id}?tab=Documents`}
                              className="text-sm text-on-surface font-medium hover:text-accent">
                              {doc.employee_name ?? '—'}
                            </Link>
                            {doc.employee_code && (
                              <p className="text-[10px] text-on-surface-subtle num-mono">{doc.employee_code}</p>
                            )}
                          </>
                        ) : (
                          <>
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm text-on-surface font-medium">{doc.recipient_name ?? '—'}</span>
                              <span className="text-[9px] px-1 py-0.5 rounded bg-warning-container text-warning border border-warning/30 uppercase tracking-wider font-bold">Ext</span>
                            </div>
                            {doc.recipient_email && (
                              <p className="text-[10px] text-on-surface-subtle">{doc.recipient_email}</p>
                            )}
                          </>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-on-surface-muted whitespace-nowrap">{fmtDate(doc.issued_on)}</td>
                      <td className="px-4 py-2.5 text-xs text-on-surface-muted">{doc.issued_by_name ?? '—'}</td>
                      <td className="px-4 py-2.5 text-xs text-on-surface-muted max-w-md truncate" title={doc.subject ?? ''}>
                        {doc.subject ?? '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {doc.external_ref ? (
                          <a href={doc.external_ref} target="_blank" rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
                            <ExternalLink className="w-3.5 h-3.5" /> Open
                          </a>
                        ) : (
                          <span className="text-xs text-on-surface-subtle">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {issueMode && (
        <IssueDocumentModal
          types={types}
          employees={employees}
          initialMode={issueMode}
          onClose={() => setIssueMode(null)}
          onIssued={doc => {
            setIssueMode(null);
            setDocs(prev => [doc, ...prev]);
            toast.success('Document issued', `Number ${doc.doc_number} allocated.`);
          }}
        />
      )}
    </div>
  );
}

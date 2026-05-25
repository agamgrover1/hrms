import { useState, useEffect, useMemo } from 'react';
import { Plus, Pencil, Trash2, X, Search, Briefcase, ExternalLink, Flag, AlertTriangle } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

interface Project {
  id: string;
  name: string;
  client_name: string | null;
  project_type: string | null;
  dashboard_url: string | null;
  project_reporting_id: string | null;
  project_reporting_name: string | null;
  project_lead_id: string | null;
  project_lead_name: string | null;
  status: string;
  flag: string | null;
  flag_reason: string | null;
  notes: string | null;
}

const PROJECT_TYPES = [
  { value: 'full', label: 'Full SEO' },
  { value: 'onpage', label: 'On-page SEO' },
  { value: 'offpage', label: 'Off-page SEO' },
  { value: 'technical', label: 'Technical SEO' },
  { value: 'local', label: 'Local SEO' },
  { value: 'web_dev', label: 'Web Development' },
  { value: 'other', label: 'Other' },
];

const FLAGS = [
  { value: '', label: 'No flag' },
  { value: 'yellow', label: 'Yellow — needs attention' },
  { value: 'red', label: 'Red — at risk' },
];

const STATUS_PILL: Record<string, { label: string; bg: string; color: string }> = {
  active:   { label: 'Active',   bg: '#f0fdf4', color: '#15803d' },
  on_hold:  { label: 'On Hold',  bg: '#fffbeb', color: '#b45309' },
  archived: { label: 'Archived', bg: '#f3f4f6', color: '#6b7280' },
};

function typeLabel(v: string | null) {
  return PROJECT_TYPES.find(t => t.value === v)?.label ?? v ?? '—';
}

export default function Projects() {
  const { user } = useAuth();
  const role = user?.role ?? 'employee';
  const canEdit = role === 'admin' || role === 'hr_manager' || role === 'project_coordinator';

  const [projects, setProjects] = useState<Project[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);

  const load = () => {
    setLoading(true);
    Promise.all([
      api.getProjects().then(setProjects).catch(() => {}),
      api.getEmployees().then(setEmployees).catch(() => {}),
    ]).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const term = search.toLowerCase();
    return projects.filter(p => {
      if (statusFilter && p.status !== statusFilter) return false;
      if (typeFilter && p.project_type !== typeFilter) return false;
      if (!term) return true;
      return (
        p.name.toLowerCase().includes(term) ||
        (p.client_name ?? '').toLowerCase().includes(term) ||
        (p.project_reporting_name ?? '').toLowerCase().includes(term)
      );
    });
  }, [projects, search, typeFilter, statusFilter]);

  const counts = {
    active: projects.filter(p => p.status === 'active').length,
    on_hold: projects.filter(p => p.status === 'on_hold').length,
    archived: projects.filter(p => p.status === 'archived').length,
    flagged: projects.filter(p => p.flag).length,
  };

  const handleDelete = async (p: Project) => {
    if (!confirm(`Archive project "${p.name}"? It will be hidden but history of hour logs is preserved.`)) return;
    await api.deleteProject(p.id).catch(() => {});
    load();
  };

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Active', value: counts.active, color: 'text-emerald-600' },
          { label: 'On Hold', value: counts.on_hold, color: 'text-amber-600' },
          { label: 'Archived', value: counts.archived, color: 'text-gray-600' },
          { label: 'Flagged', value: counts.flagged, color: 'text-rose-600' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search project, client, reporting…"
            className="w-full pl-9 pr-4 py-2.5 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-200"
          />
        </div>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2.5 bg-white text-gray-700">
          <option value="">All Types</option>
          {PROJECT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2.5 bg-white text-gray-700">
          <option value="active">Active</option>
          <option value="on_hold">On Hold</option>
          <option value="archived">Archived</option>
          <option value="">All Statuses</option>
        </select>
        {canEdit && (
          <button
            onClick={() => { setEditing(null); setShowForm(true); }}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white"
            style={{ background: '#EE2770' }}
          >
            <Plus size={15} /> New Project
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
              <th className="px-4 py-3">Project</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Reporting</th>
              <th className="px-4 py-3">Lead</th>
              <th className="px-4 py-3">Status</th>
              {canEdit && <th className="px-4 py-3 text-right">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={canEdit ? 6 : 5} className="px-4 py-8 text-center text-gray-400">Loading projects…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={canEdit ? 6 : 5} className="px-4 py-12 text-center">
                <Briefcase size={28} className="mx-auto text-gray-300 mb-2" />
                <p className="text-sm text-gray-500">No projects match your filters.</p>
              </td></tr>
            ) : filtered.map(p => {
              const archived = p.status === 'archived';
              const flagBg = p.flag === 'red' ? '#fef2f2' : p.flag === 'yellow' ? '#fffbeb' : 'transparent';
              const pill = STATUS_PILL[p.status] ?? STATUS_PILL.active;
              return (
                <tr key={p.id} className={archived ? 'opacity-60' : ''} style={{ background: flagBg }}>
                  <td className="px-4 py-3">
                    <div className="flex items-start gap-2">
                      {p.flag && (
                        <Flag size={14}
                          className="mt-0.5"
                          style={{ color: p.flag === 'red' ? '#dc2626' : '#d97706' }} />
                      )}
                      <div>
                        <p className={`font-semibold text-gray-900 ${archived ? 'line-through' : ''}`}>{p.name}</p>
                        <div className="flex flex-wrap items-center gap-2 mt-0.5">
                          {p.client_name && <span className="text-xs text-gray-500">{p.client_name}</span>}
                          {p.dashboard_url && (
                            <a href={p.dashboard_url} target="_blank" rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-primary-600 hover:underline">
                              Dashboard <ExternalLink size={10} />
                            </a>
                          )}
                        </div>
                        {p.flag_reason && (
                          <p className="text-xs text-rose-700 mt-1 flex items-center gap-1">
                            <AlertTriangle size={11} /> {p.flag_reason}
                          </p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{typeLabel(p.project_type)}</td>
                  <td className="px-4 py-3 text-gray-600">{p.project_reporting_name ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{p.project_lead_name ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium"
                      style={{ background: pill.bg, color: pill.color }}>
                      {pill.label}
                    </span>
                  </td>
                  {canEdit && (
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button onClick={() => { setEditing(p); setShowForm(true); }}
                          className="p-1.5 rounded hover:bg-gray-100" title="Edit">
                          <Pencil size={14} className="text-gray-500" />
                        </button>
                        {!archived && (
                          <button onClick={() => handleDelete(p)}
                            className="p-1.5 rounded hover:bg-rose-50" title="Archive">
                            <Trash2 size={14} className="text-rose-500" />
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showForm && (
        <ProjectForm
          existing={editing}
          employees={employees}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); load(); }}
          createdBy={user?.name}
        />
      )}
    </div>
  );
}

function ProjectForm({
  existing, employees, onClose, onSaved, createdBy,
}: {
  existing: Project | null;
  employees: any[];
  onClose: () => void;
  onSaved: () => void;
  createdBy?: string;
}) {
  const [form, setForm] = useState({
    name: existing?.name ?? '',
    client_name: existing?.client_name ?? '',
    project_type: existing?.project_type ?? 'full',
    dashboard_url: existing?.dashboard_url ?? '',
    project_reporting_id: existing?.project_reporting_id ?? '',
    project_lead_id: existing?.project_lead_id ?? '',
    status: existing?.status ?? 'active',
    flag: existing?.flag ?? '',
    flag_reason: existing?.flag_reason ?? '',
    notes: existing?.notes ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const setF = (k: keyof typeof form, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.name.trim()) { setError('Project name is required.'); return; }
    setSaving(true);
    setError('');
    const reportingEmp = employees.find(e => e.id === form.project_reporting_id);
    const leadEmp = employees.find(e => e.id === form.project_lead_id);
    const payload = {
      name: form.name.trim(),
      client_name: form.client_name.trim() || null,
      project_type: form.project_type || null,
      dashboard_url: form.dashboard_url.trim() || null,
      project_reporting_id: form.project_reporting_id || null,
      project_reporting_name: reportingEmp?.name ?? null,
      project_lead_id: form.project_lead_id || null,
      project_lead_name: leadEmp?.name ?? null,
      status: form.status,
      flag: form.flag || null,
      flag_reason: form.flag ? form.flag_reason.trim() || null : null,
      notes: form.notes.trim() || null,
      created_by: createdBy ?? null,
    };
    try {
      if (existing) await api.updateProject(existing.id, payload);
      else await api.createProject(payload);
      onSaved();
    } catch (err: any) {
      setError(err.message ?? 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900">{existing ? 'Edit Project' : 'New Project'}</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg"><X size={16} className="text-gray-500" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1.5 block">Project Name *</label>
            <input value={form.name} onChange={e => setF('name', e.target.value)}
              placeholder='e.g. "Anatoliy Chistov - Sarab"'
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-200" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1.5 block">Client Name</label>
              <input value={form.client_name} onChange={e => setF('client_name', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-200" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1.5 block">Project Type</label>
              <select value={form.project_type} onChange={e => setF('project_type', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm bg-white">
                {PROJECT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1.5 block">Dashboard URL</label>
            <input value={form.dashboard_url} onChange={e => setF('dashboard_url', e.target.value)}
              placeholder="https://…"
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-200" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1.5 block">Project Reporting</label>
              <select value={form.project_reporting_id} onChange={e => setF('project_reporting_id', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm bg-white">
                <option value="">— None —</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
              <p className="text-[11px] text-gray-400 mt-1">Approves hour logs on this project.</p>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1.5 block">Project Lead</label>
              <select value={form.project_lead_id} onChange={e => setF('project_lead_id', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm bg-white">
                <option value="">— None —</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1.5 block">Status</label>
              <select value={form.status} onChange={e => setF('status', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm bg-white">
                <option value="active">Active</option>
                <option value="on_hold">On Hold</option>
                <option value="archived">Archived</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1.5 block">Flag</label>
              <select value={form.flag} onChange={e => setF('flag', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm bg-white">
                {FLAGS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>
          </div>
          {form.flag && (
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1.5 block">Flag Reason</label>
              <input value={form.flag_reason} onChange={e => setF('flag_reason', e.target.value)}
                placeholder="Why is this flagged?"
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-200" />
            </div>
          )}
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1.5 block">Notes</label>
            <textarea value={form.notes} onChange={e => setF('notes', e.target.value)} rows={3}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-200 resize-none" />
          </div>
          {error && <p className="text-sm text-rose-600 bg-rose-50 px-3 py-2 rounded-lg">{error}</p>}
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 rounded-lg">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-50"
            style={{ background: '#EE2770' }}>
            {saving ? 'Saving…' : (existing ? 'Save Changes' : 'Create Project')}
          </button>
        </div>
      </div>
    </div>
  );
}

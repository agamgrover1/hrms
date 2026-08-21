import { useEffect, useState } from 'react';
import { Settings2, X, Plus, Trash2, Loader2, Layers, Bookmark, Download, Upload } from 'lucide-react';
import { api, type TaskBoard, type TaskCustomField, type ProjectTemplate } from '../../services/api';
import { toast } from '../Toaster';

// Toolbar entry point for the two Phase 5b actions.
//   • Fields  → per-project (or per-board) custom-field manager
//   • Templates → capture the current project as a template, or apply
//                 an existing template to it
//
// Both require a project-scoped board (list_id + project_id known).
// For internal boards without a project, only the field manager works
// (bound to the list). Templates need a project id to be useful.

export default function TaskFieldsAndTemplatesMenu({ board, canManage, onApplied }: {
  board: TaskBoard | null;
  canManage: boolean;
  onApplied: () => void;
}) {
  const [openModal, setOpenModal] = useState<'fields' | 'templates' | 'save-template' | null>(null);
  if (!board || !canManage) return null;

  return (
    <>
      <div className="inline-flex items-center gap-1">
        <button onClick={() => setOpenModal('fields')}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-outline text-xs font-semibold text-on-surface-muted hover:bg-surface-2"
          title="Manage custom fields for this project">
          <Settings2 size={13} /> Fields
        </button>
        <button onClick={() => setOpenModal('templates')}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-outline text-xs font-semibold text-on-surface-muted hover:bg-surface-2"
          title="Apply a template to this project or save this as one">
          <Layers size={13} /> Templates
        </button>
      </div>
      {openModal === 'fields' && (
        <FieldsModal board={board} onClose={() => setOpenModal(null)} />
      )}
      {openModal === 'templates' && (
        <TemplatesModal board={board} onClose={() => setOpenModal(null)}
          onApplied={() => { setOpenModal(null); onApplied(); }}
          onSaveNew={() => setOpenModal('save-template')} />
      )}
      {openModal === 'save-template' && board.project_id && (
        <SaveTemplateModal projectId={board.project_id} projectName={board.project_name ?? board.name}
          onClose={() => setOpenModal(null)}
          onSaved={() => setOpenModal('templates')} />
      )}
    </>
  );
}

// ── Fields ────────────────────────────────────────────────────────────

function FieldsModal({ board, onClose }: { board: TaskBoard; onClose: () => void }) {
  const scope = board.project_id ? { project_id: board.project_id } : { list_id: board.id };
  const [fields, setFields] = useState<TaskCustomField[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<TaskCustomField['kind']>('text');
  const [choices, setChoices] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    api.listTaskFields(scope).then(setFields).catch(() => setFields([])).finally(() => setLoading(false));
  };
  useEffect(load, [board.id, board.project_id]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const opts = kind === 'dropdown'
        ? { choices: choices.split(',').map(s => s.trim()).filter(Boolean) }
        : {};
      await api.createTaskField({ ...scope, name: name.trim(), kind, options: opts });
      setName(''); setChoices('');
      load();
    } catch (e: any) { toast.error('Could not add', e?.body?.error ?? e?.message ?? 'Please try again.'); }
    finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    if (!window.confirm('Delete this field? All values on all tasks are removed.')) return;
    try { await api.deleteTaskField(id); load(); }
    catch (e: any) { toast.error('Could not delete', e?.message ?? 'Please try again.'); }
  };

  return (
    <Modal title="Custom fields" onClose={onClose} width="max-w-lg">
      <p className="text-xs text-on-surface-muted mb-3">
        {board.project_id ? <>Scoped to project <b className="text-on-surface">{board.project_name ?? '—'}</b>.</> : <>Scoped to board <b className="text-on-surface">{board.name}</b>.</>}
        {' '}Fields appear on every task's detail drawer.
      </p>

      {loading ? (
        <div className="p-6 text-sm text-on-surface-muted text-center">Loading…</div>
      ) : (
        <div className="space-y-1">
          {fields.length === 0 && (
            <p className="text-xs text-on-surface-subtle italic px-2 py-3">No fields yet — add one below.</p>
          )}
          {fields.map(f => (
            <div key={f.id} className="group flex items-center gap-3 px-3 py-2 rounded-lg border border-outline bg-surface hover:bg-surface-2 text-sm">
              <span className="flex-1 truncate">{f.name}</span>
              <span className="text-[10px] font-mono uppercase tracking-wider text-on-surface-muted px-1.5 py-0.5 rounded bg-surface-2 border border-outline">{f.kind}</span>
              {f.kind === 'dropdown' && f.options?.choices?.length ? (
                <span className="text-[10px] text-on-surface-subtle truncate max-w-[160px]">{f.options.choices.join(' · ')}</span>
              ) : null}
              <button onClick={() => remove(f.id)} className="opacity-0 group-hover:opacity-100 p-1 rounded text-on-surface-subtle hover:text-danger hover:bg-danger/10">
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={add} className="mt-4 p-3 rounded-lg border border-dashed border-outline bg-surface-2/40 space-y-2">
        <p className="text-[10px] uppercase tracking-wider text-on-surface-muted font-semibold">Add a field</p>
        <div className="grid grid-cols-[2fr_1fr] gap-2">
          <input autoFocus value={name} onChange={e => setName(e.target.value)}
            placeholder="e.g. Client tier, Target keyword, MRR"
            className="px-2 py-1.5 rounded border border-outline bg-surface text-sm" />
          <select value={kind} onChange={e => setKind(e.target.value as any)}
            className="px-2 py-1.5 rounded border border-outline bg-surface text-sm">
            <option value="text">Text</option>
            <option value="number">Number</option>
            <option value="date">Date</option>
            <option value="checkbox">Checkbox</option>
            <option value="dropdown">Dropdown</option>
          </select>
        </div>
        {kind === 'dropdown' && (
          <input value={choices} onChange={e => setChoices(e.target.value)}
            placeholder="Choices — comma-separated (e.g. Tier A, Tier B, Tier C)"
            className="w-full px-2 py-1.5 rounded border border-outline bg-surface text-sm" />
        )}
        <div className="flex justify-end">
          <button type="submit" disabled={busy || !name.trim()}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-accent text-on-accent text-xs font-semibold hover:opacity-90 disabled:opacity-60">
            {busy && <Loader2 size={11} className="animate-spin" />} <Plus size={11} /> Add field
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ── Templates ─────────────────────────────────────────────────────────

function TemplatesModal({ board, onClose, onApplied, onSaveNew }: {
  board: TaskBoard; onClose: () => void; onApplied: () => void; onSaveNew: () => void;
}) {
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { api.listProjectTemplates().then(setTemplates).catch(() => setTemplates([])).finally(() => setLoading(false)); }, []);

  const apply = async (t: ProjectTemplate) => {
    if (!board.project_id) { toast.error('This board isn\'t tied to a project — templates need one.'); return; }
    const listCount = (t.structure?.lists ?? []).length;
    const taskCount = (t.structure?.lists ?? []).reduce((a: number, l: any) => a + (l.tasks?.length ?? 0), 0);
    if (!window.confirm(`Apply "${t.name}" to ${board.project_name ?? 'this project'}?\n\nCreates ${listCount} list${listCount === 1 ? '' : 's'} and ${taskCount} task${taskCount === 1 ? '' : 's'}. Existing lists aren't overwritten — duplicates get a " (copy)" suffix.`)) return;
    setBusy(t.id);
    try {
      const res = await api.applyProjectTemplate(t.id, board.project_id);
      toast.success('Template applied', `${res.lists_created} lists · ${res.tasks_created} tasks · ${res.subtasks_created} subtasks`);
      onApplied();
    } catch (e: any) { toast.error('Could not apply', e?.body?.error ?? e?.message ?? 'Please try again.'); }
    finally { setBusy(null); }
  };
  const remove = async (t: ProjectTemplate) => {
    if (!window.confirm(`Delete template "${t.name}"?`)) return;
    try {
      await api.deleteProjectTemplate(t.id);
      setTemplates(prev => prev.filter(x => x.id !== t.id));
    } catch (e: any) { toast.error('Could not delete', e?.message ?? 'Please try again.'); }
  };

  return (
    <Modal title="Project templates" onClose={onClose} width="max-w-2xl">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-on-surface-muted">
          {board.project_id
            ? <>Apply a template to <b className="text-on-surface">{board.project_name ?? '—'}</b>, or save this project's current shape as one.</>
            : <>Templates need a project — this board isn't tied to one.</>}
        </p>
        {board.project_id && (
          <button onClick={onSaveNew} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-accent text-on-accent text-xs font-semibold hover:opacity-90">
            <Upload size={11} /> Save this project as template
          </button>
        )}
      </div>

      {loading ? (
        <div className="p-6 text-sm text-on-surface-muted text-center">Loading…</div>
      ) : templates.length === 0 ? (
        <div className="p-8 text-center text-xs text-on-surface-subtle border border-dashed border-outline rounded-lg">
          No templates saved yet. Save this project as a template to reuse it.
        </div>
      ) : (
        <div className="space-y-2">
          {templates.map(t => {
            const listCount = (t.structure?.lists ?? []).length;
            const taskCount = (t.structure?.lists ?? []).reduce((a: number, l: any) => a + (l.tasks?.length ?? 0), 0);
            return (
              <div key={t.id} className="group flex items-start gap-3 p-3 rounded-lg border border-outline bg-surface hover:border-outline-strong">
                <Bookmark size={16} className="text-brand mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-on-surface">{t.name}</p>
                  {t.description && <p className="text-xs text-on-surface-muted mt-0.5">{t.description}</p>}
                  <p className="text-[10px] font-mono text-on-surface-subtle mt-1">{listCount} list{listCount === 1 ? '' : 's'} · {taskCount} task{taskCount === 1 ? '' : 's'}{t.created_by_name ? ` · by ${t.created_by_name}` : ''}</p>
                </div>
                {board.project_id && (
                  <button onClick={() => apply(t)} disabled={busy === t.id}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-accent text-on-accent text-xs font-semibold hover:opacity-90 disabled:opacity-60">
                    {busy === t.id ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />} Apply
                  </button>
                )}
                <button onClick={() => remove(t)} className="opacity-0 group-hover:opacity-100 p-1 rounded text-on-surface-subtle hover:text-danger hover:bg-danger/10">
                  <Trash2 size={11} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

function SaveTemplateModal({ projectId, projectName, onClose, onSaved }: {
  projectId: string; projectName: string; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(`${projectName} template`);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api.captureProjectTemplate({ project_id: projectId, name: name.trim(), description: description.trim() || undefined });
      toast.success('Template saved', `${name.trim()} is now available under Templates`);
      onSaved();
    } catch (e: any) { toast.error('Could not save', e?.body?.error ?? e?.message ?? 'Please try again.'); }
    finally { setBusy(false); }
  };
  return (
    <Modal title="Save as template" onClose={onClose} width="max-w-md">
      <p className="text-xs text-on-surface-muted mb-3">
        Freezes the lists + tasks + subtasks of <b className="text-on-surface">{projectName}</b>. Assignees + due dates + comments are not captured.
      </p>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="block text-xs font-semibold text-on-surface-muted mb-1">Template name</label>
          <input autoFocus value={name} onChange={e => setName(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-outline bg-surface text-sm" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-on-surface-muted mb-1">Description (optional)</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
            placeholder="When to reach for this template"
            className="w-full px-3 py-2 rounded-lg border border-outline bg-surface text-sm resize-y" />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg border border-outline text-xs font-semibold hover:bg-surface-2">Cancel</button>
          <button type="submit" disabled={busy || !name.trim()}
            className="inline-flex items-center gap-1 px-4 py-2 rounded-lg bg-accent text-on-accent text-xs font-semibold hover:opacity-90 disabled:opacity-60">
            {busy && <Loader2 size={12} className="animate-spin" />} Save template
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Modal({ title, onClose, width, children }: { title: string; onClose: () => void; width: string; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className={`w-full ${width} max-h-[85vh] rounded-xl-3 bg-surface border border-outline shadow-elev-4 p-5 overflow-y-auto`}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display text-lg font-bold text-on-surface">{title}</h2>
          <button type="button" onClick={onClose} className="text-on-surface-subtle hover:text-on-surface"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

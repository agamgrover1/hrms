import { useEffect, useMemo, useState } from 'react';
import { BookOpen, MapPin, Info } from 'lucide-react';
import { api } from '../services/api';

interface RoleItem {
  id: number;
  role: string;
  section_name: string;
  section_order: number;
  item_order: number;
  title: string;
  details: string | null;
  frequency: string | null;
  where_to_do: string | null;
}

const FREQ_LABEL: Record<string, { label: string; cls: string }> = {
  daily:     { label: 'Daily',     cls: 'bg-accent-container text-accent' },
  weekly:    { label: 'Weekly',    cls: 'bg-brand-container text-brand' },
  monthly:   { label: 'Monthly',   cls: 'bg-warning-container text-warning' },
  one_time:  { label: 'One-time',  cls: 'bg-success-container text-success' },
  as_needed: { label: 'Ad-hoc',    cls: 'bg-surface-3 text-on-surface-muted' },
};

const ROLE_LABEL: Record<string, string> = {
  admin: 'Admin',
  hr_manager: 'HR Manager',
  project_coordinator: 'Project Coordinator',
  employee: 'Employee',
};

interface PersonalItem {
  id: number;
  section_name: string;
  section_order: number;
  item_order: number;
  title: string;
  details: string | null;
  frequency: string | null;
  where_to_do: string | null;
}

export default function MyRoleTab({ role, employeeId }: { role: string | undefined; employeeId?: string | null }) {
  const [items, setItems] = useState<RoleItem[] | null>(null);
  const [personal, setPersonal] = useState<PersonalItem[] | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!role) return;
    setItems(null); setErr('');
    api.getRoleResponsibilities(role)
      .then(d => setItems(d as RoleItem[]))
      .catch(e => setErr(e.message));
  }, [role]);

  useEffect(() => {
    if (!employeeId) { setPersonal([]); return; }
    api.getEmployeeResponsibilities(employeeId)
      .then(r => setPersonal(r.items as PersonalItem[]))
      .catch(() => setPersonal([]));
  }, [employeeId]);

  // Group by section_name preserving section_order
  const sections = useMemo(() => {
    if (!items) return null;
    const map = new Map<string, { order: number; rows: RoleItem[] }>();
    for (const it of items) {
      const ex = map.get(it.section_name);
      if (ex) ex.rows.push(it);
      else map.set(it.section_name, { order: it.section_order, rows: [it] });
    }
    return Array.from(map.entries())
      .sort((a, b) => a[1].order - b[1].order)
      .map(([name, v]) => ({ name, rows: v.rows.sort((a, b) => a.item_order - b.item_order) }));
  }, [items]);

  if (!role) return null;

  return (
    <div className="space-y-5">
      {/* Header card */}
      <div className="bg-surface rounded-xl-3 border border-outline shadow-elev-2 overflow-hidden">
        <div className="px-5 py-4 border-b border-outline bg-gradient-to-r from-brand-container/40 to-surface flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-brand-container/60 flex items-center justify-center shrink-0">
            <BookOpen size={18} className="text-brand" />
          </div>
          <div>
            <h3 className="font-display text-lg font-bold tracking-tight text-on-surface">
              Roles & responsibilities
            </h3>
            <p className="text-sm text-on-surface-muted mt-0.5">
              Your playbook as a <b className="text-on-surface">{ROLE_LABEL[role] ?? role}</b>. Save this page — read it on your first day, then come back when something feels unclear.
            </p>
          </div>
        </div>
        <div className="px-5 py-3 bg-surface-2/40 border-b border-outline text-xs text-on-surface-muted inline-flex items-center gap-2">
          <Info size={12} className="text-brand shrink-0" />
          <span>Tap a section to expand. Each item shows where to go in the app and how often it needs to be done.</span>
        </div>
      </div>

      {err && <div className="rounded-xl-2 border border-danger/30 bg-danger-container/40 p-3 text-sm text-danger">{err}</div>}

      {items === null ? (
        <div className="bg-surface rounded-xl-2 border border-outline py-16 text-center text-sm text-on-surface-subtle">Loading…</div>
      ) : items.length === 0 ? (
        <div className="bg-surface rounded-xl-2 border border-outline py-16 text-center">
          <BookOpen size={28} className="mx-auto text-on-surface-subtle mb-2" />
          <p className="text-sm text-on-surface-muted">No playbook configured for {ROLE_LABEL[role] ?? role} yet.</p>
          <p className="text-xs text-on-surface-subtle mt-1">Ask admin to add items under Settings → Configuration → Roles & Responsibilities.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sections!.map(section => (
            <Section key={section.name} name={section.name} rows={section.rows} />
          ))}
        </div>
      )}

      {/* Personal additions overlay — items added specifically for this
          employee by their admin / HR / reporting manager. Always shown
          below the role template so the baseline-vs-overlay distinction
          stays visible. */}
      {personal && personal.length > 0 && <PersonalSection items={personal} />}
    </div>
  );
}

function PersonalSection({ items }: { items: PersonalItem[] }) {
  const sections = useMemo(() => {
    const map = new Map<string, { order: number; rows: PersonalItem[] }>();
    for (const it of items) {
      const ex = map.get(it.section_name);
      if (ex) ex.rows.push(it);
      else map.set(it.section_name, { order: it.section_order, rows: [it] });
    }
    return Array.from(map.entries())
      .sort((a, b) => a[1].order - b[1].order)
      .map(([name, v]) => ({ name, rows: v.rows.sort((a, b) => a.item_order - b.item_order) }));
  }, [items]);

  return (
    <div className="space-y-3 pt-2">
      <div className="rounded-xl-2 border border-accent/30 bg-accent-container/30 px-4 py-2.5 flex items-center gap-2">
        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-accent text-on-accent uppercase tracking-wide">Specific to you</span>
        <span className="text-xs text-on-surface-muted">{items.length} item{items.length === 1 ? '' : 's'} added by your reporting manager or HR.</span>
      </div>
      {sections.map(section => (
        <Section key={`p-${section.name}`} name={section.name} rows={section.rows as any} personal />
      ))}
    </div>
  );
}

function Section({ name, rows, personal }: { name: string; rows: RoleItem[]; personal?: boolean }) {
  const [open, setOpen] = useState(true);
  return (
    <div className={`bg-surface rounded-xl-2 shadow-elev-1 overflow-hidden ${personal ? 'border border-accent/30' : 'border border-outline'}`}>
      <button onClick={() => setOpen(o => !o)}
        className={`w-full px-5 py-3 flex items-center justify-between gap-3 transition-colors ${personal ? 'bg-accent-container/30 hover:bg-accent-container/50' : 'bg-surface-2/40 hover:bg-surface-2'}`}>
        <div className="flex items-center gap-2 min-w-0">
          <span className={`num-mono text-[10px] font-bold px-1.5 py-0.5 rounded-full ${personal ? 'bg-accent text-on-accent' : 'bg-brand-container/60 text-brand'}`}>{rows.length}</span>
          <h4 className="font-display text-base font-bold tracking-tight text-on-surface truncate">{name}</h4>
        </div>
        <span className={`text-on-surface-subtle text-xs transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
      </button>
      {open && (
        <ol className="divide-y divide-outline">
          {rows.map((it, idx) => (
            <li key={it.id} className="px-5 py-3 hover:bg-surface-2/40">
              <div className="flex items-start gap-3">
                <span className="num-mono shrink-0 text-[11px] font-bold w-6 h-6 rounded-full bg-surface-3 text-on-surface-muted inline-flex items-center justify-center mt-0.5">
                  {idx + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-on-surface">{it.title}</p>
                    {it.frequency && FREQ_LABEL[it.frequency] && (
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold ${FREQ_LABEL[it.frequency].cls}`}>
                        {FREQ_LABEL[it.frequency].label}
                      </span>
                    )}
                  </div>
                  {it.where_to_do && (
                    <p className="text-[11px] text-on-surface-muted mt-1 inline-flex items-center gap-1">
                      <MapPin size={10} className="text-brand shrink-0" />
                      <span className="num-mono">{it.where_to_do}</span>
                    </p>
                  )}
                  {it.details && (
                    <p className="text-sm text-on-surface-muted mt-1.5 leading-relaxed">{it.details}</p>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

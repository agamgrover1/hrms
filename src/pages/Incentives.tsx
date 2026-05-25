import { useState, useEffect } from 'react';
import { TrendingUp, CheckCircle, XCircle, Clock, DollarSign, X, Check, Receipt } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const STATUS_BADGE: Record<string,{label:string;cls:string}> = {
  pending:  {label:'Pending',  cls:'bg-warning-container text-warning'},
  approved: {label:'Approved', cls:'bg-success-container text-success'},
  rejected: {label:'Rejected', cls:'bg-danger-container text-danger'},
  paid:     {label:'Paid',     cls:'bg-brand-container text-on-brand-container'},
};
const fmtAmt = (n: any) => n!=null && n!=='' ? `₹${Number(n).toLocaleString('en-IN')}` : '—';

// Chart styling — match Dashboard
const CHART_AXIS = '#94a3b8';
const CHART_GRID = 'rgba(148, 163, 184, 0.18)';
const CHART_TOOLTIP_STYLE = {
  background: 'rgb(var(--surface-3))',
  borderRadius: 12,
  border: '1px solid rgb(var(--outline))',
  boxShadow: 'var(--elev-3)',
  color: 'rgb(var(--on-surface))',
  fontSize: 12,
} as const;
const CHART_TOOLTIP_TEXT = 'rgb(var(--on-surface))';

// ── Shared action modal ───────────────────────────────────────────────────────
function ActionModal({ target, type, onClose, onConfirm, requireAmount, errorMsg }: {
  target: any; type: 'approve'|'reject'|'pay'; onClose: ()=>void;
  onConfirm: (data: any)=>void; requireAmount?: boolean; errorMsg?: string;
}) {
  // Always start empty for approvals — avoids HR accidentally approving deal_value as incentive
  const [amt, setAmt] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const handleSave = async () => {
    setSaving(true);
    try {
      const data: any = { status: type==='approve'?'approved':type==='pay'?'paid':'rejected' };
      if (type==='approve' && amt) data.approved_amount = Number(amt);
      if (type==='reject') data.rejection_reason = reason;
      if (type==='pay') data.payment_note = note;
      await onConfirm(data);
    } finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="bg-surface rounded-xl-2 shadow-elev-3 border border-outline w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-base font-bold tracking-tight text-on-surface">
            {type==='approve'?'Approve & Set Amount':type==='reject'?'Reject Request':'Mark as Paid'}
          </h3>
          <button onClick={onClose}><X size={16} className="text-on-surface-subtle"/></button>
        </div>
        <div className="p-3 rounded-xl-2 mb-4 bg-surface-2 border border-outline">
          <p className="text-sm font-semibold text-on-surface">{target?.employee_name}</p>
          <p className="text-xs text-on-surface-subtle mt-0.5">
            {target?.client_name ?? `${target?.category} — ${target?.description}`}
          </p>
          {target?.deal_value && <p className="num-mono text-xs text-on-surface-subtle mt-0.5">Deal: {fmtAmt(target.deal_value)}</p>}
          {target?.amount && <p className="num-mono text-xs text-on-surface-subtle mt-0.5">Claimed: {fmtAmt(target.amount)}</p>}
        </div>
        <div className="space-y-3">
          {type==='approve' && (
            <div>
              <label className="text-xs font-semibold text-on-surface-muted block mb-1.5">
                {requireAmount ? 'Incentive Amount for Employee (₹) *' : 'Approved Amount (₹)'}
              </label>
              <input type="number" value={amt} onChange={e=>setAmt(e.target.value)}
                placeholder="Enter the amount employee will receive"
                className="w-full text-sm bg-surface border border-outline rounded-lg px-3 py-2.5 text-on-surface placeholder:text-on-surface-subtle focus:outline-none focus:ring-2 focus:ring-accent/30"/>
              {requireAmount && <p className="text-xs text-on-surface-subtle mt-1">Employee will be notified with this amount.</p>}
            </div>
          )}
          {type==='reject' && (
            <div>
              <label className="text-xs font-semibold text-on-surface-muted block mb-1.5">Reason (optional)</label>
              <textarea value={reason} onChange={e=>setReason(e.target.value)} rows={3}
                placeholder="Explain why this wasn't approved…"
                className="w-full text-sm bg-surface border border-outline rounded-lg px-3 py-2.5 text-on-surface placeholder:text-on-surface-subtle resize-none focus:outline-none focus:ring-2 focus:ring-accent/30"/>
            </div>
          )}
          {type==='pay' && (
            <div>
              <label className="text-xs font-semibold text-on-surface-muted block mb-1.5">Payment Note (optional)</label>
              <input value={note} onChange={e=>setNote(e.target.value)} placeholder="e.g. Paid via May payroll"
                className="w-full text-sm bg-surface border border-outline rounded-lg px-3 py-2.5 text-on-surface placeholder:text-on-surface-subtle focus:outline-none focus:ring-2 focus:ring-accent/30"/>
            </div>
          )}
          {errorMsg && <p className="text-xs font-medium text-danger bg-danger-container border border-danger/20 rounded-lg px-3 py-2">{errorMsg}</p>}
          <div className="flex gap-3 pt-1">
            <button onClick={onClose} className="flex-1 py-2.5 border border-outline rounded-xl-2 text-sm font-medium text-on-surface-muted hover:bg-surface-2 transition-colors">Cancel</button>
            {type==='reject' ? (
              <button onClick={handleSave} disabled={saving}
                className="flex-1 py-2.5 border border-danger/30 text-danger hover:bg-danger-container rounded-xl-2 text-sm font-semibold disabled:opacity-60 flex items-center justify-center gap-2 transition-colors">
                {saving?'Saving…':<><XCircle size={14}/>Reject</>}
              </button>
            ) : (
              <button onClick={handleSave} disabled={saving||(type==='approve'&&requireAmount&&!(Number(amt)>0))}
                className="flex-1 py-2.5 bg-accent text-on-accent hover:opacity-90 rounded-xl-2 text-sm font-semibold disabled:opacity-60 flex items-center justify-center gap-2 shadow-elev-1 hover:shadow-elev-2 transition-all">
                {saving?'Saving…':type==='approve'?<><Check size={14}/>Approve</>:'Mark Paid'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Table component ───────────────────────────────────────────────────────────
function RequestTable({ rows, onAction, isIncentive }: { rows: any[]; onAction:(r:any,t:'approve'|'reject'|'pay',isInc:boolean)=>void; isIncentive:boolean }) {
  if (!rows.length) return (
    <div className="flex flex-col items-center py-16 gap-2">
      <p className="text-on-surface-subtle font-medium">No requests</p>
    </div>
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-surface-2">
            {['Employee', isIncentive?'Client':'Category', isIncentive?'Service':'Description',
              isIncentive?'Deal Value':'Claimed', 'Incentive/Approved', 'Date', 'Status', 'Action'
            ].map(h=>(
              <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-on-surface-subtle uppercase tracking-wide whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r=>{
            const cfg=STATUS_BADGE[r.status]??STATUS_BADGE.pending;
            return (
              <tr key={r.id} className="border-t border-outline hover:bg-surface-2/50 transition-colors">
                <td className="px-4 py-3.5 font-medium text-on-surface">{r.employee_name??'—'}</td>
                <td className="px-4 py-3.5 text-on-surface-muted font-medium">{isIncentive?r.client_name:r.category}</td>
                <td className="px-4 py-3.5 text-on-surface-subtle max-w-[140px] truncate">{isIncentive?r.service_description:r.description}</td>
                <td className="px-4 py-3.5 num-mono text-sm tabular-nums text-on-surface-muted">{fmtAmt(isIncentive?r.deal_value:r.amount)}</td>
                <td className={`px-4 py-3.5 num-mono text-sm tabular-nums font-semibold ${r.approved_amount?'text-success':'text-on-surface-subtle'}`}>{fmtAmt(r.approved_amount)}</td>
                <td className="px-4 py-3.5 text-xs text-on-surface-subtle whitespace-nowrap">
                  {new Date(r.created_at).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}
                </td>
                <td className="px-4 py-3.5">
                  <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${cfg.cls}`}>{cfg.label}</span>
                  {r.rejection_reason&&<p className="text-[10px] text-danger mt-0.5 italic max-w-[100px] truncate">"{r.rejection_reason}"</p>}
                </td>
                <td className="px-4 py-3.5">
                  <div className="flex gap-1.5 flex-wrap">
                    {r.status==='pending'&&<>
                      <button onClick={()=>onAction(r,'approve',isIncentive)} className="text-xs px-2.5 py-1 rounded-lg font-semibold bg-accent text-on-accent hover:opacity-90 shadow-elev-1 hover:shadow-elev-2 transition-all">Approve</button>
                      <button onClick={()=>onAction(r,'reject',isIncentive)} className="text-xs px-2.5 py-1 rounded-lg font-semibold border border-danger/30 text-danger hover:bg-danger-container transition-colors">Reject</button>
                    </>}
                    {r.status==='approved'&&<button onClick={()=>onAction(r,'pay',isIncentive)} className="text-xs px-2.5 py-1 rounded-lg font-semibold bg-brand text-white hover:opacity-90 shadow-elev-1 hover:shadow-elev-2 transition-all">Mark Paid</button>}
                    {r.status==='paid'&&<span className="text-xs text-on-surface-subtle italic">Completed</span>}
                    {r.status==='rejected'&&<span className="text-xs text-on-surface-subtle italic">Closed</span>}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function FinancePage() {
  const {user} = useAuth();
  const [pageTab, setPageTab] = useState<'incentives'|'expenses'>('incentives');
  const [statusTab, setStatusTab] = useState<'all'|'pending'|'approved'|'rejected'|'paid'>('all');
  const [upsells, setUpsells] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<{target:any;type:'approve'|'reject'|'pay';isIncentive:boolean}|null>(null);
  const currentYear = new Date().getFullYear();

  useEffect(()=>{
    Promise.all([api.getUpsellRequests(), api.getExpenses()]).then(([u,e])=>{
      setUpsells(u); setExpenses(e);
    }).finally(()=>setLoading(false));
  },[]);

  const rows = pageTab==='incentives' ? upsells : expenses;
  const displayed = statusTab==='all' ? rows : rows.filter(r=>r.status===statusTab);

  // ── Monthly chart data ────────────────────────────────────────────────────
  const monthlyData = MONTHS.map((m,i)=>{
    const month = i+1;
    const incPaid = upsells.filter(r=>r.status==='paid'&&r.approved_amount&&new Date(r.created_at).getMonth()===i&&new Date(r.created_at).getFullYear()===currentYear).reduce((s,r)=>s+Number(r.approved_amount),0);
    const expPaid = expenses.filter(r=>r.status==='paid'&&r.approved_amount&&new Date(r.created_at).getMonth()===i&&new Date(r.created_at).getFullYear()===currentYear).reduce((s,r)=>s+Number(r.approved_amount),0);
    const incPend = upsells.filter(r=>r.status==='pending'&&new Date(r.created_at).getMonth()===i&&new Date(r.created_at).getFullYear()===currentYear).length;
    const expPend = expenses.filter(r=>r.status==='pending'&&new Date(r.created_at).getMonth()===i&&new Date(r.created_at).getFullYear()===currentYear).length;
    return {month:m, 'Incentives Paid':incPaid, 'Expenses Paid':expPaid, 'Pending':incPend+expPend};
  }).filter(d=>d['Incentives Paid']||d['Expenses Paid']||d['Pending']);

  const totalIncPaid = upsells.filter(r=>r.status==='paid').reduce((s,r)=>s+Number(r.approved_amount??0),0);
  const totalExpPaid = expenses.filter(r=>r.status==='paid').reduce((s,r)=>s+Number(r.approved_amount??r.amount??0),0);

  const [actionError, setActionError] = useState('');
  const handleAction = async (data: any) => {
    setActionError('');
    try {
      const isInc = action!.isIncentive;
      const updated = isInc
        ? await api.reviewUpsell(action!.target.id, {...data, reviewed_by: user?.name})
        : await api.reviewExpense(action!.target.id, {...data, reviewed_by: user?.name});
      if (isInc) setUpsells(prev=>prev.map(r=>r.id===updated.id?updated:r));
      else setExpenses(prev=>prev.map(r=>r.id===updated.id?updated:r));
      setAction(null);
    } catch (err: any) {
      setActionError(err.message ?? 'Action failed');
    }
  };

  return (
    <div className="space-y-5">
      {/* Summary KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          {label:'Pending Requests', value:rows.filter(r=>r.status==='pending').length, iconBg:'bg-warning-container', iconColor:'text-warning', blob:'bg-warning/15', icon:Clock, stagger:'stagger-1'},
          {label:'Approved',         value:rows.filter(r=>r.status==='approved').length, iconBg:'bg-success-container', iconColor:'text-success', blob:'bg-success/15', icon:CheckCircle, stagger:'stagger-2'},
          {label:'Total Incentives Paid', value:fmtAmt(totalIncPaid||null), iconBg:'bg-brand-container', iconColor:'text-on-brand-container', blob:'bg-brand/15', icon:TrendingUp, stagger:'stagger-3'},
          {label:'Total Expenses Paid',   value:fmtAmt(totalExpPaid||null), iconBg:'bg-accent-container', iconColor:'text-on-accent-container', blob:'bg-accent/15', icon:Receipt, stagger:'stagger-4'},
        ].map(({label,value,iconBg,iconColor,blob,icon:Icon,stagger})=>(
          <div key={label} className={`group relative bg-surface rounded-xl-2 p-5 border border-outline shadow-elev-1 hover:shadow-elev-2 transition-all duration-300 overflow-hidden animate-fade-up ${stagger}`}>
            <div className={`absolute -top-8 -right-8 w-28 h-28 rounded-full ${blob} blur-2xl opacity-50 group-hover:opacity-80 transition-opacity duration-500`} />
            <div className="relative">
              <div className={`w-10 h-10 rounded-2xl ${iconBg} flex items-center justify-center mb-3 shadow-elev-1 group-hover:scale-110 transition-transform duration-300`}>
                <Icon size={18} className={iconColor} strokeWidth={1.75}/>
              </div>
              <p className="num-mono text-2xl font-semibold text-on-surface leading-none">{value}</p>
              <p className="text-[10px] font-bold text-on-surface-muted uppercase tracking-[0.16em] mt-2">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Monthly chart */}
      {monthlyData.length > 0 && (
        <div className="relative bg-surface rounded-xl-2 border border-outline shadow-elev-1 p-5 overflow-hidden group hover:shadow-elev-2 transition-shadow">
          <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-brand/15 blur-2xl opacity-50 group-hover:opacity-80 transition-opacity duration-500" />
          <div className="relative">
            <p className="font-display text-xl font-bold tracking-tight text-on-surface mb-1">Monthly Finance Overview — {currentYear}</p>
            <p className="text-xs text-on-surface-muted mb-4">Paid incentives & expenses by month (₹)</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={monthlyData} barSize={20}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false}/>
                <XAxis dataKey="month" tick={{fontSize:11,fill:CHART_AXIS,fontFamily:'IBM Plex Mono'}} axisLine={false} tickLine={false}/>
                <YAxis tick={{fontSize:11,fill:CHART_AXIS,fontFamily:'IBM Plex Mono'}} axisLine={false} tickLine={false} width={28} tickFormatter={v=>v>=1000?`${(v/1000).toFixed(0)}k`:v}/>
                <Tooltip cursor={{fill:CHART_GRID}} contentStyle={CHART_TOOLTIP_STYLE} itemStyle={{color:CHART_TOOLTIP_TEXT}} labelStyle={{color:CHART_TOOLTIP_TEXT}} formatter={(v:any,n:string)=>[`₹${Number(v).toLocaleString('en-IN')}`,n]}/>
                <Legend iconSize={10} wrapperStyle={{fontSize:11,color:CHART_TOOLTIP_TEXT}}/>
                <Bar dataKey="Incentives Paid" fill="#7c5cff" radius={[4,4,0,0]}/>
                <Bar dataKey="Expenses Paid"   fill="#EE2770" radius={[4,4,0,0]}/>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Page tabs: Incentives | Expenses */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-1 bg-surface rounded-xl-2 p-1 border border-outline shadow-elev-1">
          {([{key:'incentives',label:'Upsell Incentives'},{key:'expenses',label:'Expenses'}] as const).map(t=>(
            <button key={t.key} onClick={()=>{setPageTab(t.key);setStatusTab('all');}}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${pageTab===t.key?'bg-accent text-on-accent shadow-elev-1':'text-on-surface-muted hover:text-on-surface'}`}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1 bg-surface-2 p-1 rounded-lg border border-outline">
          {(['all','pending','approved','rejected','paid'] as const).map(t=>(
            <button key={t} onClick={()=>setStatusTab(t)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md capitalize transition-all ${statusTab===t?'bg-surface text-on-surface shadow-elev-1':'text-on-surface-muted hover:text-on-surface'}`}>
              {t}{t!=='all'&&<span className="ml-1 num-mono text-xs font-bold">{rows.filter(r=>r.status===t).length}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-surface rounded-xl-2 border border-outline shadow-elev-1 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16"><div className="w-6 h-6 border-4 border-outline border-t-accent rounded-full animate-spin"/></div>
        ) : (
          <RequestTable rows={displayed} onAction={(r,t,isInc)=>{setActionError('');setAction({target:r,type:t,isIncentive:isInc});}} isIncentive={pageTab==='incentives'}/>
        )}
      </div>

      {action && (
        <ActionModal target={action.target} type={action.type}
          requireAmount={action.isIncentive && action.type==='approve'}
          onClose={()=>{setAction(null);setActionError('');}} onConfirm={handleAction}
          errorMsg={actionError}/>
      )}
    </div>
  );
}

import { useState, useEffect } from 'react';
import { TrendingUp, CheckCircle, XCircle, Clock, DollarSign, X, Check, Receipt } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const STATUS_CFG: Record<string,{label:string;color:string;bg:string;border:string}> = {
  pending:  {label:'Pending',    color:'#d97706',bg:'#fffbeb',border:'#fde68a'},
  approved: {label:'Approved',   color:'#15803d',bg:'#f0fdf4',border:'#bbf7d0'},
  rejected: {label:'Rejected',   color:'#dc2626',bg:'#fef2f2',border:'#fecaca'},
  paid:     {label:'Paid',       color:'#7c3aed',bg:'#f5f3ff',border:'#ddd6fe'},
};
const fmtAmt = (n: any) => n!=null && n!=='' ? `₹${Number(n).toLocaleString('en-IN')}` : '—';

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
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold" style={{color:'#192250'}}>
            {type==='approve'?'Approve & Set Amount':type==='reject'?'Reject Request':'Mark as Paid'}
          </h3>
          <button onClick={onClose}><X size={16} className="text-gray-400"/></button>
        </div>
        <div className="p-3 rounded-xl mb-4" style={{background:'rgba(25,34,80,0.04)'}}>
          <p className="text-sm font-semibold text-gray-800">{target?.employee_name}</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {target?.client_name ?? `${target?.category} — ${target?.description}`}
          </p>
          {target?.deal_value && <p className="text-xs text-gray-500 mt-0.5">Deal: {fmtAmt(target.deal_value)}</p>}
          {target?.amount && <p className="text-xs text-gray-500 mt-0.5">Claimed: {fmtAmt(target.amount)}</p>}
        </div>
        <div className="space-y-3">
          {type==='approve' && (
            <div>
              <label className="text-xs font-semibold text-gray-500 block mb-1.5">
                {requireAmount ? 'Incentive Amount for Employee (₹) *' : 'Approved Amount (₹)'}
              </label>
              <input type="number" value={amt} onChange={e=>setAmt(e.target.value)}
                placeholder="Enter the amount employee will receive"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary-200"/>
              {requireAmount && <p className="text-xs text-gray-400 mt-1">Employee will be notified with this amount.</p>}
            </div>
          )}
          {type==='reject' && (
            <div>
              <label className="text-xs font-semibold text-gray-500 block mb-1.5">Reason (optional)</label>
              <textarea value={reason} onChange={e=>setReason(e.target.value)} rows={3}
                placeholder="Explain why this wasn't approved…"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 resize-none focus:outline-none"/>
            </div>
          )}
          {type==='pay' && (
            <div>
              <label className="text-xs font-semibold text-gray-500 block mb-1.5">Payment Note (optional)</label>
              <input value={note} onChange={e=>setNote(e.target.value)} placeholder="e.g. Paid via May payroll"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none"/>
            </div>
          )}
          {errorMsg && <p className="text-xs font-medium text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{errorMsg}</p>}
          <div className="flex gap-3 pt-1">
            <button onClick={onClose} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
            <button onClick={handleSave} disabled={saving||(type==='approve'&&requireAmount&&!(Number(amt)>0))}
              className="flex-1 py-2.5 text-white rounded-xl text-sm font-semibold disabled:opacity-60 flex items-center justify-center gap-2"
              style={{background:type==='reject'?'#dc2626':type==='pay'?'#7c3aed':'#15803d'}}>
              {saving?'Saving…':type==='approve'?<><Check size={14}/>Approve</>:type==='pay'?'Mark Paid':<><XCircle size={14}/>Reject</>}
            </button>
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
      <p className="text-gray-400 font-medium">No requests</p>
    </div>
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr style={{background:'#f8f9fc'}}>
            {['Employee', isIncentive?'Client':'Category', isIncentive?'Service':'Description',
              isIncentive?'Deal Value':'Claimed', 'Incentive/Approved', 'Date', 'Status', 'Action'
            ].map(h=>(
              <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r=>{
            const cfg=STATUS_CFG[r.status]??STATUS_CFG.pending;
            return (
              <tr key={r.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                <td className="px-4 py-3.5 font-medium text-gray-800">{r.employee_name??'—'}</td>
                <td className="px-4 py-3.5 text-gray-700 font-medium">{isIncentive?r.client_name:r.category}</td>
                <td className="px-4 py-3.5 text-gray-500 max-w-[140px] truncate">{isIncentive?r.service_description:r.description}</td>
                <td className="px-4 py-3.5 text-gray-600">{fmtAmt(isIncentive?r.deal_value:r.amount)}</td>
                <td className="px-4 py-3.5 font-semibold" style={{color:r.approved_amount?'#15803d':'#9ca3af'}}>{fmtAmt(r.approved_amount)}</td>
                <td className="px-4 py-3.5 text-xs text-gray-400 whitespace-nowrap">
                  {new Date(r.created_at).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}
                </td>
                <td className="px-4 py-3.5">
                  <span className="text-xs px-2.5 py-1 rounded-full font-semibold border"
                    style={{background:cfg.bg,color:cfg.color,borderColor:cfg.border}}>{cfg.label}</span>
                  {r.rejection_reason&&<p className="text-[10px] text-red-400 mt-0.5 italic max-w-[100px] truncate">"{r.rejection_reason}"</p>}
                </td>
                <td className="px-4 py-3.5">
                  <div className="flex gap-1.5 flex-wrap">
                    {r.status==='pending'&&<>
                      <button onClick={()=>onAction(r,'approve',isIncentive)} className="text-xs px-2.5 py-1 rounded-lg font-semibold text-white" style={{background:'#15803d'}}>Approve</button>
                      <button onClick={()=>onAction(r,'reject',isIncentive)} className="text-xs px-2.5 py-1 rounded-lg font-semibold" style={{background:'#fee2e2',color:'#dc2626'}}>Reject</button>
                    </>}
                    {r.status==='approved'&&<button onClick={()=>onAction(r,'pay',isIncentive)} className="text-xs px-2.5 py-1 rounded-lg font-semibold text-white" style={{background:'#7c3aed'}}>Mark Paid</button>}
                    {r.status==='paid'&&<span className="text-xs text-gray-400 italic">Completed</span>}
                    {r.status==='rejected'&&<span className="text-xs text-gray-400 italic">Closed</span>}
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
          {label:'Pending Requests', value:rows.filter(r=>r.status==='pending').length, color:'#d97706', bg:'rgba(217,119,6,0.08)', icon:Clock},
          {label:'Approved',         value:rows.filter(r=>r.status==='approved').length,color:'#15803d', bg:'rgba(22,163,74,0.08)', icon:CheckCircle},
          {label:'Total Incentives Paid', value:fmtAmt(totalIncPaid||null), color:'#0d9488',bg:'rgba(13,148,136,0.08)', icon:TrendingUp},
          {label:'Total Expenses Paid',   value:fmtAmt(totalExpPaid||null), color:'#7c3aed',bg:'rgba(124,58,237,0.08)', icon:Receipt},
        ].map(({label,value,color,bg,icon:Icon})=>(
          <div key={label} className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{background:bg}}>
              <Icon size={18} style={{color}}/>
            </div>
            <p className="text-2xl font-black" style={{color}}>{value}</p>
            <p className="text-xs text-gray-400 mt-1">{label}</p>
          </div>
        ))}
      </div>

      {/* Monthly chart */}
      {monthlyData.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <p className="font-bold text-sm mb-1" style={{color:'#192250'}}>Monthly Finance Overview — {currentYear}</p>
          <p className="text-xs text-gray-400 mb-4">Paid incentives & expenses by month (₹)</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={monthlyData} barSize={20}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false}/>
              <XAxis dataKey="month" tick={{fontSize:11,fill:'#9ca3af'}} axisLine={false} tickLine={false}/>
              <YAxis tick={{fontSize:11,fill:'#9ca3af'}} axisLine={false} tickLine={false} width={28} tickFormatter={v=>v>=1000?`${(v/1000).toFixed(0)}k`:v}/>
              <Tooltip contentStyle={{borderRadius:10,border:'1px solid #e5e7eb',fontSize:12}} formatter={(v:any,n:string)=>[`₹${Number(v).toLocaleString('en-IN')}`,n]}/>
              <Legend iconSize={10} wrapperStyle={{fontSize:11}}/>
              <Bar dataKey="Incentives Paid" fill="#0d9488" radius={[4,4,0,0]}/>
              <Bar dataKey="Expenses Paid"   fill="#7c3aed" radius={[4,4,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Page tabs: Incentives | Expenses */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-1 bg-white rounded-xl p-1 border border-gray-100 shadow-sm">
          {([{key:'incentives',label:'Upsell Incentives'},{key:'expenses',label:'Expenses'}] as const).map(t=>(
            <button key={t.key} onClick={()=>{setPageTab(t.key);setStatusTab('all');}}
              className="px-4 py-2 rounded-lg text-sm font-semibold transition-all"
              style={pageTab===t.key?{background:'#192250',color:'#fff'}:{color:'#6b7280'}}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
          {(['all','pending','approved','rejected','paid'] as const).map(t=>(
            <button key={t} onClick={()=>setStatusTab(t)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md capitalize transition-all ${statusTab===t?'bg-white text-gray-900 shadow-sm':'text-gray-500 hover:text-gray-700'}`}>
              {t}{t!=='all'&&<span className="ml-1 text-xs font-bold">{rows.filter(r=>r.status===t).length}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16"><div className="w-6 h-6 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin"/></div>
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

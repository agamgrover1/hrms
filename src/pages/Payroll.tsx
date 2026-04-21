import { useState, useEffect } from 'react';
import { Download, Search, TrendingUp, DollarSign } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '../services/api';

const monthlyTrend = [
  { month: 'Oct', total: 11.8 }, { month: 'Nov', total: 12.0 }, { month: 'Dec', total: 12.2 },
  { month: 'Jan', total: 12.1 }, { month: 'Feb', total: 12.3 }, { month: 'Mar', total: 12.4 },
];

function SlipModal({ record, onClose }: { record: any; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="bg-primary-500 px-6 py-5 text-white">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-lg">Salary Slip</h3>
              <p className="text-primary-100 text-sm">{record.month} {record.year}</p>
            </div>
            <button onClick={onClose} className="text-white/70 hover:text-white text-2xl font-light leading-none">×</button>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-sm font-bold">{record.avatar}</div>
            <div>
              <p className="font-semibold">{record.name}</p>
              <p className="text-primary-100 text-xs">{record.emp_id} · {record.designation}</p>
            </div>
          </div>
        </div>
        <div className="p-6">
          <div className="space-y-2.5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Earnings</p>
            {[
              { label: 'Basic Pay', value: record.basic },
              { label: 'HRA', value: record.hra },
              { label: 'Special Allowance', value: record.special_allowance },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between text-sm border-b border-gray-50 pb-2">
                <span className="text-gray-600">{label}</span>
                <span className="font-medium text-gray-800">₹{Number(value).toLocaleString('en-IN')}</span>
              </div>
            ))}
            <div className="flex justify-between text-sm font-semibold pt-1 pb-3 border-b border-dashed border-gray-200">
              <span>Gross Pay</span>
              <span>₹{Number(record.gross_pay).toLocaleString('en-IN')}</span>
            </div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2 pt-1">Deductions</p>
            {[
              { label: 'Provident Fund', value: record.provident_fund },
              { label: 'Professional Tax', value: record.professional_tax },
              { label: 'Income Tax (TDS)', value: record.income_tax },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between text-sm border-b border-gray-50 pb-2">
                <span className="text-gray-600">{label}</span>
                <span className="font-medium text-red-500">−₹{Number(value).toLocaleString('en-IN')}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 bg-primary-50 rounded-xl p-4 flex justify-between items-center">
            <span className="font-bold text-gray-800">Net Pay</span>
            <span className="text-xl font-bold text-primary-600">₹{Number(record.net_pay).toLocaleString('en-IN')}</span>
          </div>
          <button className="w-full mt-4 flex items-center justify-center gap-2 py-2.5 border border-gray-200 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-50">
            <Download size={14} /> Download PDF
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Payroll() {
  const [payroll, setPayroll] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedSlip, setSelectedSlip] = useState<any | null>(null);

  useEffect(() => {
    api.getPayroll({ month: 'March', year: 2026 }).then(setPayroll).finally(() => setLoading(false));
  }, []);

  const totalNetPay = payroll.reduce((s, r) => s + Number(r.net_pay), 0);
  const avgSalary = payroll.length ? Math.round(totalNetPay / payroll.length) : 0;

  const filtered = payroll.filter(p =>
    p.name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-5">
      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-gradient-to-br from-primary-500 to-primary-600 rounded-xl p-5 text-white">
          <DollarSign size={18} className="text-primary-200 mb-2" />
          <p className="text-3xl font-bold">₹{(totalNetPay / 100000).toFixed(1)}L</p>
          <p className="text-primary-100 text-sm mt-1">Total Net Payroll · March 2026</p>
        </div>
        <div className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm">
          <p className="text-sm text-gray-500 font-medium">Average Salary</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">₹{avgSalary.toLocaleString('en-IN')}</p>
          <p className="text-xs text-gray-400 mt-0.5">Per employee / month (net)</p>
        </div>
        <div className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp size={14} className="text-green-500" />
            <p className="text-sm text-gray-500 font-medium">MoM Growth</p>
          </div>
          <p className="text-2xl font-bold text-gray-900 mt-1">+0.8%</p>
          <p className="text-xs text-green-500 mt-0.5">vs February 2026</p>
        </div>
      </div>

      {/* Chart */}
      <div className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm">
        <h3 className="font-semibold text-gray-800 mb-4">Monthly Payroll Trend (₹L)</h3>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={monthlyTrend} barSize={32}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 12, fill: '#9ca3af' }} axisLine={false} tickLine={false} domain={[11, 13]} tickFormatter={v => `₹${v}L`} />
            <Tooltip formatter={v => [`₹${v}L`, 'Net Payroll']} contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }} />
            <Bar dataKey="total" fill="#5C4BDA" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold text-gray-800">Employee Payroll · March 2026</h3>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..."
              className="pl-8 pr-4 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-200" />
          </div>
        </div>
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-6 h-6 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin" />
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                {['Employee', 'Gross Pay', 'PF', 'TDS', 'Net Pay', 'Status', 'Slip'].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-gray-500 px-4 py-3 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(record => (
                <tr key={record.employee_id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center text-xs font-semibold">{record.avatar}</div>
                      <div>
                        <p className="text-sm font-medium text-gray-800">{record.name}</p>
                        <p className="text-xs text-gray-400">{record.designation}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">₹{Number(record.gross_pay).toLocaleString('en-IN')}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">₹{Number(record.provident_fund).toLocaleString('en-IN')}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">₹{Number(record.income_tax).toLocaleString('en-IN')}</td>
                  <td className="px-4 py-3 text-sm font-semibold text-gray-900">₹{Number(record.net_pay).toLocaleString('en-IN')}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs px-2.5 py-1 bg-green-50 text-green-600 rounded-full font-medium border border-green-100">Paid</span>
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => setSelectedSlip(record)} className="text-xs text-primary-600 hover:text-primary-700 font-medium hover:underline">View Slip</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selectedSlip && <SlipModal record={selectedSlip} onClose={() => setSelectedSlip(null)} />}
    </div>
  );
}

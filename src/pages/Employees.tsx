import { useState, useEffect } from 'react';
import { Search, Filter, Plus, Mail, Phone, MapPin, ChevronRight, X } from 'lucide-react';
import { api } from '../services/api';
import { departments } from '../data/mockData';

const avatarColors = [
  'bg-primary-100 text-primary-600',
  'bg-green-100 text-green-700',
  'bg-blue-100 text-blue-700',
  'bg-amber-100 text-amber-700',
  'bg-pink-100 text-pink-700',
  'bg-teal-100 text-teal-700',
];

function EmployeeCard({ emp, index, onClick }: { emp: any; index: number; onClick: () => void }) {
  const colorClass = avatarColors[index % avatarColors.length];
  return (
    <div
      onClick={onClick}
      className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm hover:shadow-md hover:border-primary-200 transition-all cursor-pointer group"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-11 h-11 rounded-full ${colorClass} flex items-center justify-center text-sm font-bold`}>
            {emp.avatar}
          </div>
          <div>
            <p className="font-semibold text-gray-900 group-hover:text-primary-600 transition-colors">{emp.name}</p>
            <p className="text-xs text-gray-500 mt-0.5">{emp.designation}</p>
          </div>
        </div>
        <ChevronRight size={16} className="text-gray-300 group-hover:text-primary-400 transition-colors mt-1" />
      </div>
      <div className="mt-4 space-y-1.5">
        <div className="flex items-center gap-2 text-xs text-gray-500"><Mail size={12} className="text-gray-400" /> {emp.email}</div>
        <div className="flex items-center gap-2 text-xs text-gray-500"><Phone size={12} className="text-gray-400" /> {emp.phone}</div>
        <div className="flex items-center gap-2 text-xs text-gray-500"><MapPin size={12} className="text-gray-400" /> {emp.location}</div>
      </div>
      <div className="mt-4 flex items-center justify-between">
        <span className="text-xs px-2.5 py-1 bg-gray-100 text-gray-600 rounded-full font-medium">{emp.department}</span>
        <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${emp.status === 'active' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-500'}`}>
          {emp.status}
        </span>
      </div>
    </div>
  );
}

function EmployeeDetail({ emp, onClose }: { emp: any; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="relative h-28 bg-gradient-to-r from-primary-500 to-primary-400 rounded-t-2xl">
          <button onClick={onClose} className="absolute top-4 right-4 p-1.5 bg-white/20 hover:bg-white/30 rounded-lg transition-colors">
            <X size={16} className="text-white" />
          </button>
        </div>
        <div className="px-6 pb-6">
          <div className="-mt-10 mb-4">
            <div className="w-20 h-20 rounded-2xl bg-primary-100 text-primary-600 flex items-center justify-center text-xl font-bold border-4 border-white shadow-md">
              {emp.avatar}
            </div>
          </div>
          <h2 className="text-xl font-bold text-gray-900">{emp.name}</h2>
          <p className="text-primary-600 font-medium text-sm">{emp.designation}</p>
          <p className="text-gray-400 text-xs mt-0.5">{emp.employee_id} · {emp.department}</p>
          <div className="mt-6 grid grid-cols-2 gap-4">
            {[
              { label: 'Email', value: emp.email },
              { label: 'Phone', value: emp.phone },
              { label: 'Location', value: emp.location },
              { label: 'Manager', value: emp.manager },
              { label: 'Join Date', value: emp.join_date ? new Date(emp.join_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—' },
              { label: 'Status', value: emp.status?.charAt(0).toUpperCase() + emp.status?.slice(1) },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-xs text-gray-400 font-medium">{label}</p>
                <p className="text-sm text-gray-800 mt-0.5">{value}</p>
              </div>
            ))}
          </div>
          <div className="mt-6 p-4 bg-gray-50 rounded-xl">
            <p className="text-xs font-semibold text-gray-500 mb-3 uppercase tracking-wide">Compensation</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-gray-400">Monthly Gross</p>
                <p className="text-sm font-semibold text-gray-800 mt-0.5">₹{Number(emp.salary).toLocaleString('en-IN')}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Annual CTC</p>
                <p className="text-sm font-semibold text-gray-800 mt-0.5">₹{(Number(emp.ctc) / 100000).toFixed(1)}L</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Employees() {
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [selected, setSelected] = useState<any | null>(null);

  useEffect(() => {
    api.getEmployees().then(setEmployees).finally(() => setLoading(false));
  }, []);

  const filtered = employees.filter(e => {
    const matchSearch = e.name.toLowerCase().includes(search.toLowerCase()) ||
      e.email.toLowerCase().includes(search.toLowerCase()) ||
      e.designation.toLowerCase().includes(search.toLowerCase());
    const matchDept = deptFilter === 'All' || e.department === deptFilter;
    const matchStatus = statusFilter === 'All' || e.status === statusFilter;
    return matchSearch && matchDept && matchStatus;
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search employees..."
            className="w-full pl-9 pr-4 py-2.5 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-400" />
        </div>
        <div className="flex items-center gap-2">
          <Filter size={14} className="text-gray-400" />
          <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-primary-200 text-gray-700">
            <option>All</option>
            {departments.map(d => <option key={d}>{d}</option>)}
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-primary-200 text-gray-700">
            <option>All</option>
            <option>active</option>
            <option>inactive</option>
          </select>
        </div>
        <button className="ml-auto flex items-center gap-2 px-4 py-2.5 bg-primary-500 hover:bg-primary-600 text-white text-sm font-medium rounded-lg transition-colors shadow-sm">
          <Plus size={15} /> Add Employee
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin" />
        </div>
      ) : (
        <>
          <p className="text-sm text-gray-500">{filtered.length} employee{filtered.length !== 1 ? 's' : ''} found</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((emp, i) => (
              <EmployeeCard key={emp.id} emp={emp} index={i} onClick={() => setSelected(emp)} />
            ))}
          </div>
        </>
      )}

      {selected && <EmployeeDetail emp={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

import { useState, useEffect } from 'react';
import { Star, Target, TrendingUp, Award, ChevronRight } from 'lucide-react';
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer, Tooltip } from 'recharts';
import { api } from '../services/api';

const statusConfig = {
  'on-track': { label: 'On Track', color: 'bg-green-50 text-green-600 border-green-200' },
  'at-risk': { label: 'At Risk', color: 'bg-amber-50 text-amber-600 border-amber-200' },
  'completed': { label: 'Completed', color: 'bg-primary-50 text-primary-600 border-primary-200' },
  'not-started': { label: 'Not Started', color: 'bg-gray-50 text-gray-500 border-gray-200' },
};

const radarData = [
  { subject: 'Delivery', A: 4.2 }, { subject: 'Quality', A: 4.5 },
  { subject: 'Teamwork', A: 3.8 }, { subject: 'Initiative', A: 4.0 },
  { subject: 'Communication', A: 3.5 }, { subject: 'Leadership', A: 3.2 },
];

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5 items-center">
      {[1, 2, 3, 4, 5].map(s => (
        <Star key={s} size={14} className={s <= Math.round(rating) ? 'text-amber-400 fill-amber-400' : 'text-gray-200 fill-gray-200'} />
      ))}
      <span className="ml-1.5 text-sm font-semibold text-gray-700">{rating}</span>
    </div>
  );
}

export default function Performance() {
  const [employees, setEmployees] = useState<any[]>([]);
  const [selectedEmpId, setSelectedEmpId] = useState('e1');
  const [goals, setGoals] = useState<any[]>([]);
  const [reviews, setReviews] = useState<any[]>([]);
  const [allGoals, setAllGoals] = useState<any[]>([]);
  const [allReviews, setAllReviews] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.getEmployees(),
      api.getGoals(),
      api.getReviews(),
    ]).then(([emps, g, r]) => {
      setEmployees(emps);
      setAllGoals(g);
      setAllReviews(r);
      if (emps.length) setSelectedEmpId(emps[0].id);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setGoals(allGoals.filter(g => g.employee_id === selectedEmpId));
    setReviews(allReviews.filter(r => r.employee_id === selectedEmpId));
  }, [selectedEmpId, allGoals, allReviews]);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <select value={selectedEmpId} onChange={e => setSelectedEmpId(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-primary-200 text-gray-700">
          {employees.filter(e => e.status === 'active').map(e => (
            <option key={e.id} value={e.id}>{e.name} — {e.designation}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm">
          <h3 className="font-semibold text-gray-800 mb-1">Competency Scores</h3>
          <p className="text-xs text-gray-400 mb-4">H2 2025 Review</p>
          <ResponsiveContainer width="100%" height={200}>
            <RadarChart data={radarData}>
              <PolarGrid stroke="#e5e7eb" />
              <PolarAngleAxis dataKey="subject" tick={{ fontSize: 11, fill: '#6b7280' }} />
              <Radar name="Score" dataKey="A" stroke="#5C4BDA" fill="#5C4BDA" fillOpacity={0.15} strokeWidth={2} />
              <Tooltip contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }} />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        <div className="lg:col-span-2 bg-white rounded-xl p-5 border border-gray-100 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Award size={16} className="text-primary-500" />
            <h3 className="font-semibold text-gray-800">Performance Reviews</h3>
          </div>
          {reviews.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400">
              <Star size={32} className="mb-2 text-gray-200" />
              <p className="text-sm">No reviews yet for this employee</p>
            </div>
          ) : (
            <div className="space-y-4">
              {reviews.map(review => (
                <div key={review.id} className="p-4 bg-gray-50 rounded-xl">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="text-sm font-semibold text-gray-800">{review.period} Review</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        by {review.reviewer_name} · {new Date(review.review_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </p>
                    </div>
                    <StarRating rating={Number(review.rating)} />
                  </div>
                  <p className="text-sm text-gray-600 leading-relaxed">{review.feedback}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Goals */}
      <div className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Target size={16} className="text-primary-500" />
            <h3 className="font-semibold text-gray-800">Goals & OKRs</h3>
          </div>
          <span className="text-xs text-gray-400">{goals.length} goals</span>
        </div>
        {goals.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400">
            <Target size={32} className="mb-2 text-gray-200" />
            <p className="text-sm">No goals set for this employee</p>
          </div>
        ) : (
          <div className="space-y-4">
            {goals.map(goal => {
              const cfg = statusConfig[goal.status as keyof typeof statusConfig];
              return (
                <div key={goal.id}>
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="text-sm font-semibold text-gray-800">{goal.title}</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${cfg?.color}`}>{cfg?.label}</span>
                      </div>
                      <p className="text-xs text-gray-400">{goal.description}</p>
                    </div>
                    <div className="text-right ml-4 flex-shrink-0">
                      <p className="text-lg font-bold text-gray-900">{goal.progress}%</p>
                      <p className="text-xs text-gray-400">Due {new Date(goal.due_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</p>
                    </div>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all duration-500 ${
                      goal.status === 'completed' ? 'bg-primary-500' : goal.status === 'at-risk' ? 'bg-amber-400' :
                      goal.status === 'not-started' ? 'bg-gray-300' : 'bg-green-500'
                    }`} style={{ width: `${goal.progress}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Team Overview */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
          <TrendingUp size={16} className="text-primary-500" />
          <h3 className="font-semibold text-gray-800">Team Performance Overview</h3>
        </div>
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              {['Employee', 'Department', 'Goals', 'Completed', 'Last Rating', ''].map(h => (
                <th key={h} className="text-left text-xs font-semibold text-gray-500 px-4 py-3 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {employees.filter(e => e.status === 'active').map(e => {
              const empGoals = allGoals.filter(g => g.employee_id === e.id);
              const completed = empGoals.filter(g => g.status === 'completed').length;
              const review = allReviews.find(r => r.employee_id === e.id);
              return (
                <tr key={e.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors cursor-pointer" onClick={() => setSelectedEmpId(e.id)}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center text-xs font-semibold">{e.avatar}</div>
                      <span className="text-sm font-medium text-gray-800">{e.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">{e.department}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">{empGoals.length}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">{completed}</td>
                  <td className="px-4 py-3">
                    {review ? <StarRating rating={Number(review.rating)} /> : <span className="text-xs text-gray-400">Not reviewed</span>}
                  </td>
                  <td className="px-4 py-3"><ChevronRight size={14} className="text-gray-300" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

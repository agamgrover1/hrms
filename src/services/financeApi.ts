// Finance module API client. All endpoints are admin-only on the server, so we
// send the signed-in user's id in the `x-user-id` header (the app keeps its
// session in localStorage rather than using bearer tokens).
const BASE = '/api/finance';
const SESSION_KEY = 'digitalleap_hrms_session';

function currentUserId(): string {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw).id ?? '') : '';
  } catch {
    return '';
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', 'x-user-id': currentUserId() },
    ...options,
  });
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new Error(
      res.status === 403 ? 'Admins only — you do not have access to Finance.' :
      res.status === 500 ? 'Server error — check the API / database.' :
      `Unexpected response (${res.status}).`
    );
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data as T;
}

export interface FinSettings {
  working_hours_per_month: number;
  overhead_method: 'direct_hours' | 'revenue' | 'headcount' | 'none';
  currency: string;
  include_bench_in_overhead: boolean;
}

export interface FinTotals {
  revenue: number; directCost: number; benchCost: number; indirectSalaries: number; otherCosts: number;
  overheadPool: number; grossProfit: number; grossMargin: number; netProfit: number; netMargin: number;
  totalSalary: number; totalCost: number; directCapacityHours: number; allocatedDirectHours: number;
  utilization: number | null; headcount: number; directHeadcount: number; indirectHeadcount: number; activeProjects: number;
}

export interface FinProjectRow {
  id: string; name: string; client_name: string | null;
  billing_type: 'fixed' | 'hourly'; hourly_rate: number; billable_hours: number; fixed_amount: number;
  revenue: number; directCost: number; directHours: number; grossProfit: number; grossMargin: number;
  overhead: number; netProfit: number; netMargin: number; effectiveCostPerHour: number; revenuePerHour: number;
  team: { id: string; name: string; designation: string | null; hours: number; rate: number; cost: number }[];
}

export interface FinEmployeeRow {
  id: string; name: string; designation: string | null; department: string | null; cost_type: 'direct' | 'indirect';
  salary: number; rate: number; capacity: number; allocatedHours: number; benchHours: number;
  allocatedCost: number; benchCost: number; utilization: number | null;
}

export interface FinModel {
  month: number; year: number; settings: FinSettings;
  employeeRows: FinEmployeeRow[]; projectRows: FinProjectRow[];
  otherCosts: { id: number; name: string; amount: number; category: string }[];
  byDept: { department: string; headcount: number; salary: number }[];
  totals: FinTotals;
}

export type FinTrendPoint = FinTotals & { month: number; year: number };

export const financeApi = {
  getDashboard: (month: number, year: number) => request<FinModel>(`/dashboard?month=${month}&year=${year}`),
  getTrends: (month: number, year: number) => request<FinTrendPoint[]>(`/trends?month=${month}&year=${year}`),

  getSettings: () => request<FinSettings>('/settings'),
  saveSettings: (data: FinSettings) => request<FinSettings>('/settings', { method: 'PUT', body: JSON.stringify(data) }),

  getEmployees: () => request<Array<{
    id: string; name: string; designation: string | null; department: string | null; salary: number;
    cost_type: 'direct' | 'indirect' | null; capacity_hours: number | null; active: boolean | null;
  }>>('/employees'),
  saveEmployee: (id: string, data: { cost_type: string | null; capacity_hours?: number | null; active?: boolean }) =>
    request<any>(`/employees/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  getRevenue: (month: number, year: number) => request<Array<{
    id: string; name: string; client_name: string | null;
    billing_type: 'fixed' | 'hourly' | null; fixed_amount: number | null; hourly_rate: number | null; billable_hours: number | null;
  }>>(`/revenue?month=${month}&year=${year}`),
  saveRevenue: (data: { project_id: string; month: number; year: number; billing_type: string; fixed_amount: number; hourly_rate: number; billable_hours: number }) =>
    request<any>('/revenue', { method: 'PUT', body: JSON.stringify(data) }),
  createProject: (data: { name: string; client_name?: string; month: number; year: number; billing_type: string; fixed_amount: number; hourly_rate: number; billable_hours: number; created_by?: string }) =>
    request<any>('/projects', { method: 'POST', body: JSON.stringify(data) }),
  copyMonth: (from_month: number, from_year: number, to_month: number, to_year: number) =>
    request<any>('/copy-month', { method: 'POST', body: JSON.stringify({ from_month, from_year, to_month, to_year }) }),

  getOverhead: (month: number, year: number) => request<Array<{ id: number; name: string; amount: number; category: string }>>(`/overhead?month=${month}&year=${year}`),
  addOverhead: (data: { month: number; year: number; name: string; amount: number; category: string }) =>
    request<any>('/overhead', { method: 'POST', body: JSON.stringify(data) }),
  updateOverhead: (id: number, data: { name: string; amount: number; category: string }) =>
    request<any>(`/overhead/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteOverhead: (id: number) => request<any>(`/overhead/${id}`, { method: 'DELETE' }),
};

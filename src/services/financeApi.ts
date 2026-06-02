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
  revenue: number; directCost: number; projectExpenses: number;
  totalInvoiced: number; totalReceived: number; totalPending: number;
  pendingInvoiceCount: number; clearedInvoiceCount: number;
  benchCost: number; indirectSalaries: number;
  supervisionCost: number; supervisorHeadcount: number; otherCosts: number;
  overheadPool: number; grossProfit: number; grossMargin: number; netProfit: number; netMargin: number;
  totalSalary: number; totalCost: number; directCapacityHours: number; allocatedDirectHours: number;
  utilization: number | null; headcount: number; directHeadcount: number; indirectHeadcount: number; activeProjects: number;
}

export interface FinProjectRow {
  id: string; name: string; client_name: string | null;
  billing_type: 'fixed' | 'hourly'; hourly_rate: number; billable_hours: number; fixed_amount: number;
  revenue: number; directCost: number; directHours: number; projectExpenses: number;
  invoiced: number; received: number; pendingCount: number; clearedCount: number; invoiceCount: number;
  grossProfit: number; grossMargin: number;
  overhead: number; supervision: number; supervisorNames: string[];
  supervisorBreakdown: { id: string; name: string; salary: number; share: number; amount: number }[];
  overheadShare: number;
  overheadMethod: 'direct_hours' | 'revenue' | 'headcount' | 'none';
  overheadPool: number;
  netProfit: number; netMargin: number; effectiveCostPerHour: number; revenuePerHour: number;
  team: { id: string; name: string; designation: string | null; hours: number; rate: number; cost: number }[];
}

export interface FinInvoice {
  id: number;
  project_id: string;
  project_name?: string;
  project_client_name?: string | null;
  month: number;
  year: number;
  invoice_number: string | null;
  invoice_date: string | null;
  amount_invoiced: number;
  amount_received: number | null;
  status: 'pending' | 'cleared' | 'cancelled';
  cleared_date: string | null;
  cleared_by: string | null;
  cleared_by_name: string | null;
  notes: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_by_role: string | null;
  created_at: string;
}

export interface FinProjectExpense {
  id: number;
  project_id: string;
  project_name?: string;
  project_client_name?: string | null;
  month: number;
  year: number;
  vendor: string | null;
  description: string;
  amount: number;
  category: string;
  created_by: string | null;
  created_by_role: string | null;
  created_at: string;
}

export interface FinEmployeeRow {
  id: string; name: string; designation: string | null; department: string | null; cost_type: 'direct' | 'indirect' | 'supervisor';
  reporting_manager_id: string | null;
  reporting_manager_name: string | null;
  salary: number; rate: number; capacity: number; allocatedHours: number; benchHours: number;
  allocatedCost: number; benchCost: number; utilization: number | null; managedProjects?: number;
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
    cost_type: 'direct' | 'indirect' | 'supervisor' | null; capacity_hours: number | null; active: boolean | null;
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

  // ── Per-project expenses (outsourced services, content, ad spend, etc.) ──
  getProjectExpenses: (params: { project_id?: string; month?: number; year?: number }) => {
    const qs = new URLSearchParams();
    if (params.project_id) qs.set('project_id', params.project_id);
    if (params.month) qs.set('month', String(params.month));
    if (params.year) qs.set('year', String(params.year));
    return request<FinProjectExpense[]>(`/project-expenses?${qs}`);
  },
  addProjectExpense: (data: { project_id: string; month: number; year: number; vendor?: string; description: string; amount: number; category?: string }) =>
    request<FinProjectExpense>('/project-expenses', { method: 'POST', body: JSON.stringify(data) }),
  updateProjectExpense: (id: number, data: { vendor?: string; description?: string; amount?: number; category?: string; month?: number; year?: number }) =>
    request<FinProjectExpense>(`/project-expenses/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteProjectExpense: (id: number) => request<any>(`/project-expenses/${id}`, { method: 'DELETE' }),

  // ── Invoices (coordinator raises → admin clears) ──
  getInvoices: (params: { project_id?: string; month?: number; year?: number; status?: 'pending' | 'cleared' | 'cancelled' }) => {
    const qs = new URLSearchParams();
    if (params.project_id) qs.set('project_id', params.project_id);
    if (params.month) qs.set('month', String(params.month));
    if (params.year) qs.set('year', String(params.year));
    if (params.status) qs.set('status', params.status);
    return request<FinInvoice[]>(`/invoices?${qs}`);
  },
  addInvoice: (data: { project_id: string; month: number; year: number; invoice_number?: string; invoice_date?: string; amount_invoiced: number; notes?: string }) =>
    request<FinInvoice>('/invoices', { method: 'POST', body: JSON.stringify(data) }),
  updateInvoice: (id: number, data: { invoice_number?: string; invoice_date?: string; amount_invoiced?: number; amount_received?: number | null; notes?: string; month?: number; year?: number; status?: 'pending' | 'cleared' | 'cancelled' }) =>
    request<FinInvoice>(`/invoices/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  clearInvoice: (id: number, data: { amount_received?: number; cleared_date?: string; notes?: string }) =>
    request<FinInvoice>(`/invoices/${id}/clear`, { method: 'PATCH', body: JSON.stringify(data) }),
  reopenInvoice: (id: number) =>
    request<FinInvoice>(`/invoices/${id}/reopen`, { method: 'PATCH', body: JSON.stringify({}) }),
  deleteInvoice: (id: number) => request<any>(`/invoices/${id}`, { method: 'DELETE' }),
};

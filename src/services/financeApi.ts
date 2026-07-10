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
  currency: string;
  fx_rate: number | null;
  amount_invoiced_inr: number;
  amount_received: number | null;
  status: 'pending' | 'cleared_pending' | 'cleared' | 'cancelled';
  cleared_date: string | null;
  cleared_by: string | null;
  cleared_by_name: string | null;
  notes: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_by_role: string | null;
  created_at: string;
}

export interface FxRate {
  date: string;
  from: string;
  to: string;
  rate: number;
  source: 'cache' | 'frankfurter' | 'fallback';
  effective_date: string;
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

export interface FinManagerPnl {
  month: number; year: number;
  scope: 'direct' | 'subtree';
  currency: string;
  total: {
    manager_count: number; report_count: number;
    manager_salary_total: number; team_salary_total: number;
    team_revenue_total: number;
    org_leverage: number; org_net_contribution: number;
  };
  managers: Array<{
    manager_id: string; manager_name: string;
    manager_designation: string | null; manager_department: string | null;
    manager_cost_type: 'direct' | 'indirect' | 'supervisor';
    manager_salary: number; manager_revenue_produced: number;
    manager_hours: number; manager_capacity: number;
    is_billing_manager: boolean;
    reports_count: number;
    team_salary: number; team_revenue_produced: number;
    team_allocated_hours: number; team_capacity: number; team_utilization: number;
    all_in_cost: number; total_revenue: number;
    net_contribution: number; leverage: number;
    verdict: 'great' | 'ok' | 'underused' | 'bench';
    reports: Array<{
      id: string; name: string; designation: string | null; department: string | null;
      cost_type: string;
      salary: number; rate: number;
      hours_allocated: number; capacity: number; utilization: number;
      revenue_produced: number; leverage: number;
    }>;
  }>;
}

export interface FinOptimization {
  month: number; year: number; currency: string; threshold: number;
  bleed: {
    rows: Array<{
      assignment_id: string;
      employee_id: string; employee_name: string; employee_designation: string | null; employee_rate: number;
      project_id: string; project_name: string; project_client_name: string | null;
      project_revenue_per_hour: number; project_revenue: number;
      hours: number; margin_per_hour: number; monthly_margin: number;
      best_swap: null | {
        candidate_employee_id: string; candidate_employee_name: string;
        candidate_designation: string | null; candidate_rate: number;
        candidate_margin_per_hour: number; candidate_monthly_margin: number;
        candidate_free_hours: number; net_gain: number;
      };
    }>;
    actionable_count: number;
    total_potential_gain: number;
  };
  matrix: {
    employees: Array<{ id: string; name: string; rate: number; salary: number; designation: string | null }>;
    projects: Array<{ id: string; name: string; client_name: string | null; revenue_per_hour: number; revenue: number; direct_hours: number }>;
    cells: Array<{ employee_id: string; project_id: string; hours: number; margin_per_hour: number; monthly_margin: number; assigned: boolean }>;
  };
  leverage: Array<{
    employee_id: string; name: string; designation: string | null; department: string | null;
    salary: number; rate: number;
    hours_allocated: number; capacity: number; utilization: number;
    projects_on: number; revenue_produced: number; margin_produced: number;
    leverage: number;
    verdict: 'great' | 'ok' | 'underused' | 'bench';
    projects: Array<{
      project_id: string;
      project_name: string;
      client_name: string | null;
      hours: number;
      revenue_per_hour: number;
      revenue_produced: number;
      cost: number;
      margin: number;
      leverage: number;
    }>;
  }>;
}

export const financeApi = {
  getDashboard: (month: number, year: number) => request<FinModel>(`/dashboard?month=${month}&year=${year}`),
  getTrends: (month: number, year: number) => request<FinTrendPoint[]>(`/trends?month=${month}&year=${year}`),
  getOptimization: (month: number, year: number, threshold?: number) =>
    request<FinOptimization>(`/optimization?month=${month}&year=${year}${threshold ? `&threshold=${threshold}` : ''}`),
  getManagerPnl: (month: number, year: number, scope: 'direct' | 'subtree' = 'direct') =>
    request<FinManagerPnl>(`/manager-pnl?month=${month}&year=${year}&scope=${scope}`),

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
    billing_source?: string | null;
    billing_type: 'fixed' | 'hourly' | null; fixed_amount: number | null; hourly_rate: number | null; billable_hours: number | null;
    currency?: string | null; fx_rate?: number | null; revenue_inr?: number | null;
    status?: 'pending' | 'cleared' | null;
    amount_received?: number | null; received_inr?: number | null; received_fx_rate?: number | null;
    cleared_at?: string | null; cleared_by?: string | null; cleared_by_name?: string | null;
    clearance_note?: string | null;
  }>>(`/revenue?month=${month}&year=${year}`),
  saveRevenue: (data: { project_id: string; month: number; year: number; billing_type: string; fixed_amount: number; hourly_rate: number; billable_hours: number; currency?: string; fx_rate?: number }) =>
    request<any>('/revenue', { method: 'PUT', body: JSON.stringify(data) }),
  clearRevenue: (project_id: string, month: number, year: number, data: { amount_received?: number; clearance_note?: string; fx_rate?: number }) =>
    request<any>(`/revenue/${encodeURIComponent(project_id)}/${month}/${year}/clear`, { method: 'PATCH', body: JSON.stringify(data) }),
  approveRevenueClearance: (project_id: string, month: number, year: number) =>
    request<any>(`/revenue/${encodeURIComponent(project_id)}/${month}/${year}/approve-clearance`, { method: 'PATCH', body: JSON.stringify({}) }),
  rejectRevenueClearance: (project_id: string, month: number, year: number, rejection_reason: string) =>
    request<any>(`/revenue/${encodeURIComponent(project_id)}/${month}/${year}/reject-clearance`, { method: 'PATCH', body: JSON.stringify({ rejection_reason }) }),
  reopenRevenue: (project_id: string, month: number, year: number) =>
    request<any>(`/revenue/${encodeURIComponent(project_id)}/${month}/${year}/reopen`, { method: 'PATCH' }),
  getRevenueAudit: (params?: { month?: number; year?: number; project_id?: string; actor_id?: string; action?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.month) qs.set('month', String(params.month));
    if (params?.year)  qs.set('year',  String(params.year));
    if (params?.project_id) qs.set('project_id', params.project_id);
    if (params?.actor_id)   qs.set('actor_id',   params.actor_id);
    if (params?.action)     qs.set('action',     params.action);
    if (params?.limit) qs.set('limit', String(params.limit));
    return request<any[]>(`/revenue/audit${qs.toString() ? `?${qs}` : ''}`);
  },
  cleanupDirectRevenue: (dry_run = false) =>
    request<{ deleted?: number; would_delete?: number; sample?: any[] }>(
      '/revenue/cleanup-direct',
      { method: 'POST', body: JSON.stringify({ dry_run }) },
    ),
  createProject: (data: { name: string; client_name?: string; month: number; year: number; billing_type: string; fixed_amount: number; hourly_rate: number; billable_hours: number; created_by?: string }) =>
    request<any>('/projects', { method: 'POST', body: JSON.stringify(data) }),
  copyMonth: (from_month: number, from_year: number, to_month: number, to_year: number) =>
    request<any>('/copy-month', { method: 'POST', body: JSON.stringify({ from_month, from_year, to_month, to_year }) }),

  getOverhead: (month: number, year: number) =>
    request<Array<{ id: number; name: string; amount: number; category: string; paid_on: string | null; payment_mode: string | null }>>(
      `/overhead?month=${month}&year=${year}`),
  addOverhead: (data: { month: number; year: number; name: string; amount: number; category: string; paid_on?: string | null; payment_mode?: string | null }) =>
    request<any>('/overhead', { method: 'POST', body: JSON.stringify(data) }),
  updateOverhead: (id: number, data: { name: string; amount: number; category: string; paid_on?: string | null; payment_mode?: string | null }) =>
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
  // Bulk template download — returns CSV text seeded with active
  // projects for the period. Admin fills the amount column and
  // re-uploads via uploadProjectExpenses below. Uses the same
  // currentUserId() helper as `request` above so the
  // requireAdminOrCoord gate on the backend resolves. Previous
  // implementation read from localStorage['user'] which doesn't
  // exist (the session is stored at digitalleap_hrms_session), so
  // the x-user-id header went out empty and the server returned
  // "Not authenticated."
  downloadProjectExpenseTemplate: async (month: number, year: number): Promise<string> => {
    const r = await fetch(`${BASE}/project-expenses/template?month=${month}&year=${year}`, {
      headers: { 'x-user-id': currentUserId() },
    });
    if (!r.ok) {
      const errBody = await r.json().catch(() => ({}));
      throw new Error(errBody?.error || `HTTP ${r.status}`);
    }
    return await r.text();
  },
  uploadProjectExpenses: (rows: Array<{ project_id: string; month?: number; year?: number; vendor?: string; description: string; amount: number; category?: string }>) =>
    request<{ inserted: number; skipped: number; errors: string[] }>(
      '/project-expenses/bulk',
      { method: 'POST', body: JSON.stringify({ rows }) },
    ),

  // ── Invoices (coordinator raises → admin clears) ──
  getInvoices: (params: { project_id?: string; month?: number; year?: number; status?: 'pending' | 'cleared' | 'cancelled' }) => {
    const qs = new URLSearchParams();
    if (params.project_id) qs.set('project_id', params.project_id);
    if (params.month) qs.set('month', String(params.month));
    if (params.year) qs.set('year', String(params.year));
    if (params.status) qs.set('status', params.status);
    return request<FinInvoice[]>(`/invoices?${qs}`);
  },
  addInvoice: (data: { project_id: string; month: number; year: number; invoice_number?: string; invoice_date?: string; amount_invoiced: number; currency?: string; fx_rate?: number; notes?: string }) =>
    request<FinInvoice>('/invoices', { method: 'POST', body: JSON.stringify(data) }),
  updateInvoice: (id: number, data: { invoice_number?: string; invoice_date?: string; amount_invoiced?: number; currency?: string; fx_rate?: number; amount_received?: number | null; notes?: string; month?: number; year?: number; status?: 'pending' | 'cleared' | 'cancelled' }) =>
    request<FinInvoice>(`/invoices/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  getFxRate: (params: { date?: string; from?: string; to?: string }) => {
    const qs = new URLSearchParams();
    if (params.date) qs.set('date', params.date);
    if (params.from) qs.set('from', params.from);
    if (params.to) qs.set('to', params.to);
    return request<FxRate>(`/fx-rate?${qs}`);
  },
  clearInvoice: (id: number, data: { amount_received?: number; cleared_date?: string; notes?: string }) =>
    request<FinInvoice>(`/invoices/${id}/clear`, { method: 'PATCH', body: JSON.stringify(data) }),
  approveClearance: (id: number) =>
    request<FinInvoice>(`/invoices/${id}/approve-clearance`, { method: 'PATCH', body: JSON.stringify({}) }),
  rejectClearance: (id: number, rejection_reason: string) =>
    request<FinInvoice>(`/invoices/${id}/reject-clearance`, { method: 'PATCH', body: JSON.stringify({ rejection_reason }) }),
  reopenInvoice: (id: number) =>
    request<FinInvoice>(`/invoices/${id}/reopen`, { method: 'PATCH', body: JSON.stringify({}) }),
  deleteInvoice: (id: number) => request<any>(`/invoices/${id}`, { method: 'DELETE' }),
  copyInvoiceMonth: (from_month: number, from_year: number, to_month: number, to_year: number) =>
    request<{ copied: number; skipped: number; total?: number; message?: string }>(
      '/invoices/copy-month',
      { method: 'POST', body: JSON.stringify({ from_month, from_year, to_month, to_year }) },
    ),
  getInvoiceAudit: (params?: { month?: number; year?: number; project_id?: string; actor_id?: string; action?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.month) qs.set('month', String(params.month));
    if (params?.year)  qs.set('year',  String(params.year));
    if (params?.project_id) qs.set('project_id', params.project_id);
    if (params?.actor_id)   qs.set('actor_id',   params.actor_id);
    if (params?.action)     qs.set('action',     params.action);
    if (params?.limit) qs.set('limit', String(params.limit));
    return request<any[]>(`/invoices/audit${qs.toString() ? `?${qs}` : ''}`);
  },
};

const BASE = '/api';
const SESSION_KEY = 'digitalleap_hrms_session';

export interface FeatureAnnouncement {
  id: string;
  title: string; body: string;
  image_url: string | null;
  cta_label: string | null; cta_url: string | null;
  status: 'draft' | 'published';
  // Audience targeting. null/[] = everyone. Otherwise any of:
  // 'admin', 'hr_manager', 'project_coordinator', 'employee', 'manager'.
  target_roles: string[] | null;
  drafted_by_id: string | null; drafted_by_name: string | null;
  approved_by_id: string | null; approved_by_name: string | null;
  approved_at: string | null;
  published_at: string | null;
  created_at: string; updated_at: string;
  // Only set on the GET /api/features list for non-admin viewers — true
  // if the current user has already dismissed the popup for this item.
  seen?: boolean;
}

export interface TodoTask {
  id: string;
  assignee_id: string; assignee_name: string | null;
  created_by_id: string | null; created_by_name: string | null; created_by_role: string | null;
  title: string; description: string | null;
  due_date: string | null;
  priority: 'low' | 'normal' | 'high';
  status: 'pending' | 'in_progress' | 'done' | 'cancelled';
  completed_at: string | null;
  completion_note: string | null;
  // User-defined tags/categories the assignee (or creator) attaches to
  // organize their list. Always lowercase, deduped, max 8 per task.
  tags: string[] | null;
  created_at: string; updated_at: string;
}

// ── Performance Pulse types ─────────────────────────────────────────────
export interface PulseSnapshot {
  employee_id: string;
  snapshot_date: string;
  discipline: number | null;
  hours_hygiene: number | null;
  output: number | null;
  contribution: number | null;
  manager_pulse: number | null;
  team_stewardship: number | null;
  project_hygiene: number | null;
  client_handling: number | null;
  total_score: number;
  band: 'excellent' | 'strong' | 'building' | 'needs_support' | 'baseline';
  is_baseline: boolean;
  breakdown: any;
}
export interface PulseTeamRow {
  id: string; name: string; avatar?: string | null;
  department?: string | null; designation?: string | null;
  reporting_manager_id?: string | null; reporting_manager_name?: string | null;
  total_score: number | null; band: string | null;
  discipline: number | null; hours_hygiene: number | null;
  output: number | null; contribution: number | null;
  manager_pulse: number | null; team_stewardship: number | null; project_hygiene: number | null; client_handling: number | null;
  is_baseline: boolean | null; snapshot_date: string | null;
  pulse_rated_this_week?: boolean; week_start?: string;
}
export interface PulseWeights {
  department: string;
  discipline: number; hours_hygiene: number; output: number; contribution: number;
  manager_pulse: number; team_stewardship: number; project_hygiene: number;
  updated_at?: string; updated_by?: string | null;
}

function currentUserId(): string {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw).id ?? '') : '';
  } catch { return ''; }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const uid = currentUserId();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(uid ? { 'x-user-id': uid } : {}),
    ...((options?.headers as Record<string, string>) ?? {}),
  };
  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  // Guard against non-JSON responses (e.g. Vercel HTML error pages when a
  // serverless function crashes due to missing env vars or build errors)
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    const text = await res.text().catch(() => '');
    throw new Error(
      res.status === 500 ? 'Server error — check Vercel environment variables (DATABASE_URL).' :
      res.status === 404 ? 'API route not found.' :
      `Unexpected response (${res.status}): server returned HTML instead of JSON.`
    );
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data as T;
}

export const api = {
  // Auth
  login: (email: string, password: string) =>
    // Response is either { user } when 2FA is off, or
    // { requires_2fa: true, challenge_token } when the account has TOTP
    // enabled and needs the second-factor step.
    request<{ user: any } | { requires_2fa: true; challenge_token: string }>(
      '/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  loginTwoFactor: (data: { challenge_token: string; code?: string; backup_code?: string }) =>
    request<{ user: any }>('/auth/login/2fa', { method: 'POST', body: JSON.stringify(data) }),
  twoFactorStatus: () =>
    request<{ enabled: boolean; enrolled_at: string | null; backup_codes_remaining: number }>('/auth/2fa/status'),
  twoFactorSetup: () =>
    request<{ secret: string; otpauth_url: string }>('/auth/2fa/setup', { method: 'POST', body: '{}' }),
  twoFactorVerify: (code: string) =>
    request<{ ok: true; backup_codes: string[] }>('/auth/2fa/verify', { method: 'POST', body: JSON.stringify({ code }) }),
  twoFactorDisable: (code: string) =>
    request<{ ok: true }>('/auth/2fa/disable', { method: 'POST', body: JSON.stringify({ code }) }),
  twoFactorResetForUser: (userId: string) =>
    request<{ ok: true; target: { id: string; name: string } }>(`/auth/2fa/reset/${userId}`, { method: 'POST', body: '{}' }),

  // Employees
  getEmployees: () => request<any[]>('/employees'),
  // Slim variant — 10 columns instead of ~25. Use this from pickers,
  // sidebars, mentions lookups, and any place that just needs
  // { id, employee_id, name, designation, department, status, shift,
  //   reporting_manager_id, email, avatar }. The full endpoint should be
  // reserved for the Employees directory + individual profile screens.
  getEmployeesSlim: () => request<any[]>('/employees?fields=slim'),
  getTeamMembers: (reporting_manager_id: string, includeDescendants = false) =>
    request<any[]>(`/employees?reporting_manager_id=${reporting_manager_id}${includeDescendants ? '&descendants=true' : ''}`),
  createEmployee: (data: any) => request<any>('/employees', { method: 'POST', body: JSON.stringify(data) }),
  updateEmployee: (id: string, data: any) => request<any>(`/employees/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteEmployee: (id: string) => request<any>(`/employees/${id}`, { method: 'DELETE' }),
  updateEmployeeProbation: (id: string, probation_end_date: string | null) =>
    request<any>(`/employees/${id}/probation`, { method: 'PATCH', body: JSON.stringify({ probation_end_date }) }),

  // Attendance
  getAttendance: (params?: { employee_id?: string; month?: number; year?: number }) => {
    const qs = new URLSearchParams();
    if (params?.employee_id) qs.set('employee_id', params.employee_id);
    if (params?.month) qs.set('month', String(params.month));
    if (params?.year) qs.set('year', String(params.year));
    return request<any[]>(`/attendance?${qs}`);
  },
  getAttendanceNotes: (employee_id: string, month: number, year: number) => {
    const qs = new URLSearchParams({ employee_id, month: String(month), year: String(year) });
    return request<Array<{
      employee_id: string; date: string; note: string;
      author_id: string | null; author_name: string | null; author_role: string | null;
      status?: 'pending' | 'approved' | 'rejected';
      approved_by_id: string | null; approved_by_name: string | null;
      approved_at: string | null; rejection_reason: string | null;
      created_at: string; updated_at: string;
    }>>(`/attendance-notes?${qs}`);
  },
  upsertAttendanceNote: (data: { employee_id: string; date: string; note: string }) =>
    request<any>(`/attendance-notes`, { method: 'PUT', body: JSON.stringify(data) }),
  approveAttendanceNote: (data: { employee_id: string; date: string }) =>
    request<any>(`/attendance-notes/approve`, { method: 'PATCH', body: JSON.stringify(data) }),
  rejectAttendanceNote: (data: { employee_id: string; date: string; rejection_reason: string }) =>
    request<any>(`/attendance-notes/reject`, { method: 'PATCH', body: JSON.stringify(data) }),
  clockIn: (employee_id: string) => request<any>('/attendance/clock-in', { method: 'POST', body: JSON.stringify({ employee_id }) }),
  clockOut: (employee_id: string) => request<any>('/attendance/clock-out', { method: 'POST', body: JSON.stringify({ employee_id }) }),
  markAttendance: (data: { employee_id: string; date: string; status: string; check_in?: string; check_out?: string }) =>
    request<any>('/attendance/mark', { method: 'POST', body: JSON.stringify(data) }),
  getAttendanceSessions: (employeeId: string, date: string) =>
    request<any[]>(`/attendance/sessions?employee_id=${employeeId}&date=${date}`),
  pingActivity: (employeeId: string, active: boolean) =>
    request<any>('/attendance/activity', { method: 'POST', body: JSON.stringify({ employee_id: employeeId, active }) }),

  syncBiometric: (triggeredBy: string, fromDate?: string, toDate?: string) =>
    request<any>('/attendance/biometric-sync', { method: 'POST', body: JSON.stringify({ triggered_by: triggeredBy, from_date: fromDate, to_date: toDate }) }),
  getBiometricSyncHistory: () =>
    request<any[]>('/attendance/biometric-sync/history'),

  // Leave
  getLeaveRequests: (params?: { employee_id?: string; status?: string; reporting_manager_id?: string }) => {
    const qs = new URLSearchParams();
    if (params?.employee_id) qs.set('employee_id', params.employee_id);
    if (params?.status) qs.set('status', params.status);
    if (params?.reporting_manager_id) qs.set('reporting_manager_id', params.reporting_manager_id);
    return request<any[]>(`/leave/requests?${qs}`);
  },
  applyLeave: (data: any) => request<any>('/leave/requests', { method: 'POST', body: JSON.stringify(data) }),
  updateLeaveStatus: (id: string, status: string, opts?: { actioner_name?: string; rejection_reason?: string; approver_note?: string }) =>
    request<any>(`/leave/requests/${id}`, { method: 'PATCH', body: JSON.stringify({ status, ...opts }) }),
  cancelLeave: (id: string, cancelled_by: string, cancellation_reason: string) =>
    request<any>(`/leave/requests/${id}/cancel`, { method: 'PATCH', body: JSON.stringify({ cancelled_by, cancellation_reason }) }),
  managerApproveLeave: (id: string, data: { status: 'approved' | 'rejected'; manager_id: string; manager_name?: string; rejection_reason?: string; approver_note?: string }) =>
    request<any>(`/leave/requests/${id}/manager-approve`, { method: 'PATCH', body: JSON.stringify(data) }),
  getLeaveBalance: (employee_id: string) => request<any>(`/leave/balances/${employee_id}`),
  // Lightweight org-wide "who's out today" lookup. Drives the dashboard
  // widget on every signed-in landing page. Server caches the result for
  // 60s so refreshes within the same minute return instantly.
  getOutToday: () => request<{
    today: string;
    out: Array<{
      id: string; employee_id: string;
      name: string; designation: string; avatar: string;
      type: string; slot: string | null; to_date: string;
    }>;
  }>(`/leaves/out-today`),
  // One-shot dashboard bundle. Server runs ~11 sub-queries in parallel
  // using the same memoTtl caches the individual endpoints hit, so the
  // browser makes ONE round-trip on Dashboard mount instead of ~11.
  // hoursSummary is intentionally NOT included — it needs a heavier
  // compute pass and Dashboard still calls getHoursSummary separately.
  getDashboardBootstrap: (month: number, year: number) => request<{
    month: number; year: number;
    announcements: any[];
    employees: any[];
    leaveRequests: any[];
    attendance: any[];
    payroll: any[];
    outToday: { today: string; out: any[] };
    repairTickets: any[];
    holidaysThisYear: any[];
    holidaysNextYear: any[];
    optionalThisYear: any[];
    optionalNextYear: any[];
  }>(`/dashboard/bootstrap?month=${month}&year=${year}`),
  updateLeaveBalance: (employee_id: string, data: { full_day?: number; short_leave?: number }) =>
    request<any>(`/leave/balances/${employee_id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  backfillOptionalLeave: (data: { employee_id: string; date: string; reason?: string }) =>
    request<{ ok: boolean; id: string }>(`/leave/backfill-optional`, { method: 'POST', body: JSON.stringify(data) }),
  deleteLeaveRequest: (id: string) =>
    request<any>(`/leave/requests/${id}`, { method: 'DELETE' }),
  adjustLeaveBalance: (employee_id: string, data: { full_day: number; short_leave: number }) =>
    request<any>(`/leave/balances/${employee_id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  // Monthly credit — atomic org-wide batch. force=true clears the log row
  // so the run fires again in the same month (useful after a fix).
  runMonthlyLeaveCredit: (opts: { force?: boolean } = {}) =>
    request<{ year: number; month: number; ran: boolean; credited: number; note: string }>(
      `/leave/balances/run-monthly-credit${opts.force ? '?force=true' : ''}`,
      { method: 'POST' },
    ),
  getMonthlyCreditStatus: () =>
    request<{ year: number; month: number; ran: boolean; ran_at: string | null; ran_by: string | null; employees_credited: number }>(
      `/leave/balances/monthly-credit-status`,
    ),

  // Payroll
  getPayroll: (params?: { month?: string; year?: number }) => {
    const qs = new URLSearchParams();
    if (params?.month) qs.set('month', params.month);
    if (params?.year) qs.set('year', String(params.year));
    return request<any[]>(`/payroll?${qs}`);
  },
  getEmployeePayroll: (employee_id: string) => request<any[]>(`/payroll/${employee_id}`),

  // Performance (legacy goals/reviews)
  getGoals: (employee_id?: string) => {
    const qs = employee_id ? `?employee_id=${employee_id}` : '';
    return request<any[]>(`/performance/goals${qs}`);
  },
  updateGoal: (id: string, data: { progress: number; status: string }) =>
    request<any>(`/performance/goals/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  getReviews: (employee_id?: string) => {
    const qs = employee_id ? `?employee_id=${employee_id}` : '';
    return request<any[]>(`/performance/reviews${qs}`);
  },

  // Monthly performance
  getMonthlyPerformance: (employee_id: string, year?: number) => {
    const qs = new URLSearchParams({ employee_id });
    if (year) qs.set('year', String(year));
    return request<any[]>(`/performance/monthly?${qs}`);
  },
  // Batch variant — one round-trip per team of employees. The response is
  // ORDERed by employee_id + month, so the caller can group as it iterates.
  getMonthlyPerformanceBatch: (employee_ids: string[], year?: number) => {
    if (employee_ids.length === 0) return Promise.resolve([] as any[]);
    const qs = new URLSearchParams({ employee_ids: employee_ids.join(',') });
    if (year) qs.set('year', String(year));
    return request<any[]>(`/performance/monthly?${qs}`);
  },
  lockPerformanceReview: (id: string, lock: boolean, lockedBy?: string, requesterRole?: string) =>
    request<any>(`/performance/monthly/${id}/lock`, { method: 'PATCH', body: JSON.stringify({ lock, locked_by: lockedBy, requester_role: requesterRole }) }),

  saveMonthlyPerformance: (data: {
    employee_id: string; reviewer_id?: string; reviewer_name?: string;
    month: number; year: number;
    productivity: number; quality: number; teamwork: number; attendance_score: number; initiative: number; client_satisfaction: number; ai_usage: number;
    communication?: number; ownership?: number; planning_accuracy?: number; learning_growth?: number;
    overall_score: number; comments?: string; parameter_notes?: Record<string, string>;
    requester_role?: string;
  }) => request<any>('/performance/monthly', { method: 'POST', body: JSON.stringify(data) }),

  // Phase 1: hard signals shown alongside the review form so the reviewer
  // anchors on facts. Each block may be null if data is missing.
  getReviewSignals: (employee_id: string, month: number, year: number) =>
    request<{
      employee_id: string; month: number; year: number;
      hours_discipline: { working_days: number; logged_days: number; on_time_days: number; coverage_pct: number | null; on_time_pct: number | null } | null;
      allocation: { planned: number; logged: number; variance_hours: number; variance_pct: number | null } | null;
      internal_mix: { billable_hours: number; internal_hours: number; total_hours: number; internal_pct: number } | null;
      attendance: { late_count: number; short_day_count: number; absent_count: number; late_noted: number; short_noted: number; absent_noted: number } | null;
      leaves: { by_type: Record<string, number>; total_days: number; by_dow: { mon: number; tue: number; wed: number; thu: number; fri: number } } | null;
      responsiveness: { prompts_received: number; replies_sent: number; median_response_hours: number | null } | null;
      pulse: { current: number; band: string; delta_vs_prev_month: number | null; trend: Array<{ month: number; year: number; score: number; band: string }> } | null;
    }>(`/performance/review-signals?employee_id=${employee_id}&month=${month}&year=${year}`),

  submitSelfReview: (data: {
    employee_id: string; month: number; year: number;
    self_scores: Record<string, number>;
    self_went_well?: string;
    self_would_do_differently?: string;
  }) => request<any>('/performance/monthly/self', { method: 'POST', body: JSON.stringify(data) }),

  // Performance notes (private)
  getPerformanceNotes: (employee_id: string) =>
    request<any[]>(`/performance/notes?employee_id=${employee_id}`),
  addPerformanceNote: (data: { employee_id: string; note_date: string; note_text: string; note_type: string; created_by_id?: string; created_by_name?: string }) =>
    request<any>('/performance/notes', { method: 'POST', body: JSON.stringify(data) }),
  deletePerformanceNote: (id: string) =>
    request<any>(`/performance/notes/${id}`, { method: 'DELETE' }),

  // Appraisal goals
  getAppraisalGoals: (params: { employee_id?: string; year?: number }) => {
    const qs = new URLSearchParams();
    if (params.employee_id) qs.set('employee_id', params.employee_id);
    if (params.year) qs.set('year', String(params.year));
    return request<any[]>(`/performance/appraisal-goals?${qs}`);
  },
  saveAppraisalGoals: (data: { employee_id: string; year: number; month: number; goals: any[] }) =>
    request<any>('/performance/appraisal-goals', { method: 'POST', body: JSON.stringify(data) }),
  submitAppraisalGoals: (data: { employee_id: string; year: number; month: number; goals: any[] }) =>
    request<any>('/performance/appraisal-goals/submit', { method: 'POST', body: JSON.stringify(data) }),
  adminSaveAppraisalGoals: (data: { employee_id: string; year: number; month: number; goals: any[] }) =>
    request<any>('/performance/appraisal-goals/admin', { method: 'PUT', body: JSON.stringify(data) }),
  selfUpdateGoalStatuses: (data: { employee_id: string; year: number; month: number; employee_statuses: { index: number; employee_status: string }[] }) =>
    request<any>('/performance/appraisal-goals/self-update', { method: 'PATCH', body: JSON.stringify(data) }),

  // Upsell Incentives
  getUpsellRequests: (employeeId?: string) =>
    request<any[]>(`/upsell${employeeId ? `?employee_id=${employeeId}` : ''}`),
  submitUpsell: (data: { employee_id: string; employee_name?: string; client_name: string; service_description: string; deal_value?: number; currency?: string; fx_rate?: number; notes?: string }) =>
    request<any>('/upsell', { method: 'POST', body: JSON.stringify(data) }),
  // Admin-only: create an already-approved incentive for any employee.
  // Skips the 30-char notes minimum that the employee self-submit
  // requires (admin fills in the context themselves).
  grantUpsell: (data: {
    employee_id: string; employee_name?: string;
    client_name: string; service_description: string;
    approved_amount: number;
    approver_note?: string;
    deal_value?: number; currency?: string;
    notes?: string;
  }) => request<any>('/upsell/grant', { method: 'POST', body: JSON.stringify(data) }),
  reviewUpsell: (id: string, data: { status: string; reviewed_by?: string; rejection_reason?: string; approved_amount?: number; payment_note?: string; approver_note?: string }) =>
    request<any>(`/upsell/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  // Expenses
  getExpenses: (employeeId?: string) =>
    request<any[]>(`/expenses${employeeId ? `?employee_id=${employeeId}` : ''}`),
  getExpenseCategories: () => request<string[]>('/expenses/categories'),
  submitExpense: (data: { employee_id: string; employee_name?: string; category: string; description: string; amount: number; receipt_note?: string; expense_date?: string }) =>
    request<any>('/expenses', { method: 'POST', body: JSON.stringify(data) }),
  reviewExpense: (id: string, data: { status: string; reviewed_by?: string; rejection_reason?: string; approved_amount?: number; payment_note?: string }) =>
    request<any>(`/expenses/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  // ── IT Assets & Repairs ─────────────────────────────────────────────────
  getVendors: () => request<any[]>('/vendors'),
  createVendor: (data: any) => request<any>('/vendors', { method: 'POST', body: JSON.stringify(data) }),
  updateVendor: (id: string, data: any) => request<any>(`/vendors/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteVendor: (id: string) => request<any>(`/vendors/${id}`, { method: 'DELETE' }),

  getAssets: (assignedToId?: string) =>
    request<any[]>(`/assets${assignedToId ? `?assigned_to_id=${assignedToId}` : ''}`),
  createAsset: (data: any) => request<any>('/assets', { method: 'POST', body: JSON.stringify(data) }),
  updateAsset: (id: string, data: any) => request<any>(`/assets/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteAsset: (id: string) => request<any>(`/assets/${id}`, { method: 'DELETE' }),
  getAssetRepairHistory: (assetId: string) =>
    request<{ asset_id: string; tickets: any[]; ticket_count: number; total_spend: number }>(`/assets/${assetId}/repair-history`),
  getAssetOwnershipHistory: (assetId: string) =>
    request<{
      asset_id: string;
      current: { assigned_to_id: string | null; assigned_to_name: string | null; status: string };
      events: Array<{
        id: number; action: 'created' | 'reassigned' | 'status_changed';
        actor_id: string | null; actor_name: string | null; actor_role: string | null;
        description: string | null;
        before_value: string | null; after_value: string | null;
        created_at: string;
      }>;
    }>(`/assets/${assetId}/ownership-history`),

  getAssetCategories: () => request<Array<{ id: string; name: string }>>(`/asset-categories`),
  createAssetCategory: (name: string) =>
    request<{ id: string; name: string }>('/asset-categories', { method: 'POST', body: JSON.stringify({ name }) }),
  deleteAssetCategory: (id: string) =>
    request<any>(`/asset-categories/${id}`, { method: 'DELETE' }),

  getRepairTickets: (params?: string | { employee_id?: string; asset_id?: string }) => {
    if (typeof params === 'string') return request<any[]>(`/repair-tickets?employee_id=${params}`);
    const qs = new URLSearchParams();
    if (params?.employee_id) qs.set('employee_id', params.employee_id);
    if (params?.asset_id) qs.set('asset_id', params.asset_id);
    const q = qs.toString();
    return request<any[]>(`/repair-tickets${q ? `?${q}` : ''}`);
  },
  createRepairTicket: (data: any) => request<any>('/repair-tickets', { method: 'POST', body: JSON.stringify(data) }),
  updateRepairTicket: (id: string, data: any) => request<any>(`/repair-tickets/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  approveRepairTicket: (id: string, approved_by?: string) =>
    request<any>(`/repair-tickets/${id}/approve`, { method: 'PATCH', body: JSON.stringify({ approved_by }) }),
  rejectRepairTicket: (id: string, rejected_by?: string, rejection_reason?: string) =>
    request<any>(`/repair-tickets/${id}/reject`, { method: 'PATCH', body: JSON.stringify({ rejected_by, rejection_reason }) }),
  deleteRepairTicket: (id: string) => request<any>(`/repair-tickets/${id}`, { method: 'DELETE' }),
  getRepairTicketActivity: (id: string) =>
    request<Array<{
      id: number;
      ticket_id: string | null;
      asset_id: string | null;
      action: string;
      actor_id: string | null;
      actor_name: string | null;
      actor_role: string | null;
      description: string | null;
      before_value: string | null;
      after_value: string | null;
      created_at: string;
    }>>(`/repair-tickets/${id}/activity`),
  addRepairTicketNote: (id: string, data: { note: string; actor_id?: string; actor_name?: string; actor_role?: string }) =>
    request<{ success: boolean }>(`/repair-tickets/${id}/note`, { method: 'POST', body: JSON.stringify(data) }),

  // Warnings & PIP
  getWarnings: (employeeId?: string) =>
    request<any[]>(`/warnings${employeeId ? `?employee_id=${employeeId}` : ''}`),
  issueWarning: (data: { employee_id: string; employee_name?: string; reason: string; severity?: string; issued_by?: string; issued_by_role?: string }) =>
    request<any>('/warnings', { method: 'POST', body: JSON.stringify(data) }),
  deleteWarning: (id: string) =>
    request<any>(`/warnings/${id}`, { method: 'DELETE' }),
  getPips: (employeeId?: string) =>
    request<any[]>(`/warnings/pips${employeeId ? `?employee_id=${employeeId}` : ''}`),
  updatePip: (id: string, data: { status?: string; goals?: string }) =>
    request<any>(`/warnings/pips/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  // WFH
  getWfhRequests: (params?: { employee_id?: string; status?: string; reporting_manager_id?: string }) => {
    const qs = new URLSearchParams();
    if (params?.employee_id) qs.set('employee_id', params.employee_id);
    if (params?.status) qs.set('status', params.status);
    if (params?.reporting_manager_id) qs.set('reporting_manager_id', params.reporting_manager_id);
    return request<any[]>(`/wfh/requests?${qs}`);
  },
  applyWfh: (data: { employee_id: string; employee_name?: string; date: string; type: string; reason: string }) =>
    request<any>('/wfh/requests', { method: 'POST', body: JSON.stringify(data) }),
  managerApproveWfh: (id: string, data: { status: 'approved' | 'rejected'; manager_id: string; manager_name?: string; rejection_reason?: string }) =>
    request<any>(`/wfh/requests/${id}/manager-approve`, { method: 'PATCH', body: JSON.stringify(data) }),
  hrApproveWfh: (id: string, data: { status: 'approved' | 'rejected'; actioner_name?: string; rejection_reason?: string }) =>
    request<any>(`/wfh/requests/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  cancelWfh: (id: string, cancelled_by: string, cancellation_reason: string) =>
    request<any>(`/wfh/requests/${id}/cancel`, { method: 'PATCH', body: JSON.stringify({ cancelled_by, cancellation_reason }) }),

  // Configuration
  getConfigDepartments: () => request<any[]>('/config/departments'),
  addConfigDepartment: (name: string) => request<any>('/config/departments', { method: 'POST', body: JSON.stringify({ name }) }),
  deleteConfigDepartment: (id: string) => request<any>(`/config/departments/${id}`, { method: 'DELETE' }),

  getConfigDesignations: () => request<any[]>('/config/designations'),
  addConfigDesignation: (name: string) => request<any>('/config/designations', { method: 'POST', body: JSON.stringify({ name }) }),
  deleteConfigDesignation: (id: string) => request<any>(`/config/designations/${id}`, { method: 'DELETE' }),

  getConfigShifts: () => request<any[]>('/config/shifts'),
  addConfigShift: (data: { name: string; start_time: string; end_time: string; late_after: string }) =>
    request<any>('/config/shifts', { method: 'POST', body: JSON.stringify(data) }),
  updateConfigShift: (id: string, data: { name: string; start_time: string; end_time: string; late_after: string }) =>
    request<any>(`/config/shifts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteConfigShift: (id: string) => request<any>(`/config/shifts/${id}`, { method: 'DELETE' }),

  // Optional Leave
  getOptionalLeaveDates: (year: number) =>
    request<any[]>(`/optional-leave/dates?year=${year}`),
  addOptionalLeaveDate: (data: { date: string; label: string; year: number }) =>
    request<any>('/optional-leave/dates', { method: 'POST', body: JSON.stringify(data) }),
  deleteOptionalLeaveDate: (id: string) =>
    request<any>(`/optional-leave/dates/${id}`, { method: 'DELETE' }),
  getOptionalLeaveAvailable: (employeeId: string, year: number) =>
    request<{ dates: any[]; used_count: number; remaining: number }>(`/optional-leave/available?employee_id=${employeeId}&year=${year}`),

  // Holidays — admin/HR edit; visible to all authenticated users.
  getHolidays: (year?: number) =>
    request<Array<{ id: number; date: string; name: string; type: string; notes: string | null }>>(`/holidays${year ? `?year=${year}` : ''}`),
  addHoliday: (data: { date: string; name: string; type?: string; notes?: string }) =>
    request<any>('/holidays', { method: 'POST', body: JSON.stringify(data) }),
  updateHoliday: (id: number, data: { date: string; name: string; type?: string; notes?: string }) =>
    request<any>(`/holidays/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteHoliday: (id: number) => request<any>(`/holidays/${id}`, { method: 'DELETE' }),

  // Notifications
  getNotifications: (userId: string, limit?: number) =>
    request<any[]>(`/notifications?user_id=${userId}${limit ? `&limit=${limit}` : ''}`),
  markNotificationRead: (id: number) => request<any>(`/notifications/${id}/read`, { method: 'PATCH' }),
  markAllNotificationsRead: (userId: string) => request<any>(`/notifications/read-all?user_id=${userId}`, { method: 'PATCH' }),
  deleteNotification: (id: number) => request<any>(`/notifications/${id}`, { method: 'DELETE' }),
  clearAllNotifications: (userId: string) => request<any>(`/notifications/clear-all?user_id=${userId}`, { method: 'DELETE' }),

  // Users
  getUsers: () => request<any[]>('/users'),
  createUser: (data: any) => request<any>('/users', { method: 'POST', body: JSON.stringify(data) }),
  updateUser: (id: string, data: any) => request<any>(`/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  toggleUserActive: (id: string, active: boolean) =>
    request<any>(`/users/${id}/active`, { method: 'PATCH', body: JSON.stringify({ active }) }),
  changePassword: (id: string, current_password: string, new_password: string) =>
    request<any>(`/users/${id}/change-password`, { method: 'PATCH', body: JSON.stringify({ current_password, new_password }) }),
  deleteUser: (id: string) => request<any>(`/users/${id}`, { method: 'DELETE' }),

  // ── Project Hours module ────────────────────────────────────────────────
  getProjects: (params?: { status?: string; type?: string }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.type) qs.set('type', params.type);
    return request<any[]>(`/projects?${qs}`);
  },
  createProject: (data: any) => request<any>('/projects', { method: 'POST', body: JSON.stringify(data) }),
  updateProject: (id: string, data: any) => request<any>(`/projects/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteProject: (id: string) => request<any>(`/projects/${id}`, { method: 'DELETE' }),

  getProjectAssignments: (params?: { month?: number; year?: number; employee_id?: string; project_id?: string }) => {
    const qs = new URLSearchParams();
    if (params?.month) qs.set('month', String(params.month));
    if (params?.year) qs.set('year', String(params.year));
    if (params?.employee_id) qs.set('employee_id', params.employee_id);
    if (params?.project_id) qs.set('project_id', params.project_id);
    return request<any[]>(`/project-assignments?${qs}`);
  },
  createProjectAssignment: (data: {
    project_id: string; employee_id: string; employee_name?: string;
    month: number; year: number;
    w1_hours?: number; w2_hours?: number; w3_hours?: number; w4_hours?: number; w5_hours?: number;
    notes?: string; created_by?: string;
  }) => request<any>('/project-assignments', { method: 'POST', body: JSON.stringify(data) }),
  updateProjectAssignment: (id: string, data: {
    w1_hours?: number; w2_hours?: number; w3_hours?: number; w4_hours?: number; w5_hours?: number; notes?: string;
  }) => request<any>(`/project-assignments/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteProjectAssignment: (id: string) => request<any>(`/project-assignments/${id}`, { method: 'DELETE' }),
  copyAssignmentsMonth: (data: { from_month: number; from_year: number; to_month: number; to_year: number; blank_hours?: boolean; created_by?: string }) =>
    request<{ success: boolean; copied: number }>('/project-assignments/copy-month', { method: 'POST', body: JSON.stringify(data) }),

  getAssignmentAudit: (params?: { month?: number; year?: number; project_id?: string; employee_id?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.month) qs.set('month', String(params.month));
    if (params?.year)  qs.set('year',  String(params.year));
    if (params?.project_id)  qs.set('project_id',  params.project_id);
    if (params?.employee_id) qs.set('employee_id', params.employee_id);
    if (params?.limit) qs.set('limit', String(params.limit));
    return request<any[]>(`/project-assignments/audit${qs.toString() ? `?${qs}` : ''}`);
  },

  getHourLogs: (params?: { employee_id?: string; month?: number; year?: number; status?: string; reviewer_id?: string }) => {
    const qs = new URLSearchParams();
    if (params?.employee_id) qs.set('employee_id', params.employee_id);
    if (params?.month) qs.set('month', String(params.month));
    if (params?.year) qs.set('year', String(params.year));
    if (params?.status) qs.set('status', params.status);
    if (params?.reviewer_id) qs.set('reviewer_id', params.reviewer_id);
    return request<any[]>(`/hour-logs?${qs}`);
  },
  // Lightweight KPI counts across all statuses. Same filter surface as
  // getHourLogs minus `status`. Cheap enough to refetch after every
  // approve/reject/hold action so the top cards stay honest.
  getHourLogCounts: (params?: { employee_id?: string; month?: number; year?: number; reviewer_id?: string }) => {
    const qs = new URLSearchParams();
    if (params?.employee_id) qs.set('employee_id', params.employee_id);
    if (params?.month) qs.set('month', String(params.month));
    if (params?.year) qs.set('year', String(params.year));
    if (params?.reviewer_id) qs.set('reviewer_id', params.reviewer_id);
    return request<{ pending: number; on_hold: number; approved: number; rejected: number }>(`/hour-logs/counts?${qs}`);
  },
  submitHourLog: (data: {
    project_id: string; employee_id: string; employee_name?: string;
    month: number; year: number; week_num: number;
    hours_logged: number; work_description?: string;
  }) => request<any>('/hour-logs', { method: 'POST', body: JSON.stringify(data) }),
  editHourLog: (id: string, data: {
    hours_logged: number;
    work_description?: string;
    actor_id?: string; actor_name?: string; actor_role?: string;
    keep_status?: boolean; reason?: string;
    // Weekly billable-hours override for the Upwork billing planner.
    // Omit → column untouched. null / '' → reset to default (same as
    // hours_logged). Number → save as the override.
    billable_hours?: number | null;
  }) =>
    request<any>(`/hour-logs/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteHourLog: (id: string, data: { actor_id?: string; actor_name?: string; actor_role?: string; reason?: string }) =>
    request<{ success: boolean }>(`/hour-logs/${id}`, { method: 'DELETE', body: JSON.stringify(data) }),

  // ── Daily entries (auto-roll up to the weekly hour_logs row) ──
  getHourLogDays: (params?: { employee_id?: string; month?: number; year?: number; assignment_id?: string; project_id?: string }) => {
    const qs = new URLSearchParams();
    if (params?.employee_id) qs.set('employee_id', params.employee_id);
    if (params?.month) qs.set('month', String(params.month));
    if (params?.year) qs.set('year', String(params.year));
    if (params?.assignment_id) qs.set('assignment_id', params.assignment_id);
    if (params?.project_id) qs.set('project_id', params.project_id);
    return request<Array<{
      id: string;
      assignment_id: string;
      hour_log_id: string | null;
      project_id: string;
      employee_id: string;
      employee_name: string | null;
      log_date: string;
      week_num: number;
      month: number;
      year: number;
      hours: number;
      notes: string | null;
      project_name?: string;
      project_client_name?: string | null;
    }>>(`/hour-log-days?${qs}`);
  },
  upsertHourLogDay: (data: { assignment_id: string; log_date: string; hours: number; notes?: string; employee_id?: string; employee_name?: string }) =>
    request<{ assignment_id: string; log_date: string; week_num: number; hours: number; hour_log_id: string | null }>('/hour-log-days', { method: 'POST', body: JSON.stringify(data) }),
  editHourLogDay: (id: string, data: { hours: number; notes?: string }) =>
    request<{ id: string; assignment_id: string; week_num: number; hour_log_id: string | null }>(`/hour-log-days/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteHourLogDay: (id: string) =>
    request<{ success: boolean; hour_log_id: string | null }>(`/hour-log-days/${id}`, { method: 'DELETE' }),
  getHourLogAudit: (id: string) =>
    request<Array<{
      id: number;
      hour_log_id: string;
      action: 'created' | 'edited' | 'approved' | 'rejected' | 'admin_edit' | 'resubmitted' | 'deleted';
      actor_id: string | null;
      actor_name: string | null;
      actor_role: string | null;
      before_hours: number | null;
      after_hours: number | null;
      before_status: string | null;
      after_status: string | null;
      before_description: string | null;
      after_description: string | null;
      reason: string | null;
      created_at: string;
    }>>(`/hour-logs/${id}/audit`),
  approveHourLog: (id: string, data: { reviewer_id?: string; reviewer_name?: string }) =>
    request<any>(`/hour-logs/${id}/approve`, { method: 'PATCH', body: JSON.stringify(data) }),
  rejectHourLog: (id: string, data: { reviewer_id?: string; reviewer_name?: string; rejection_reason: string }) =>
    request<any>(`/hour-logs/${id}/reject`, { method: 'PATCH', body: JSON.stringify(data) }),
  holdHourLog: (id: string, data: { reviewer_id?: string; reviewer_name?: string; reviewer_role?: string; note: string }) =>
    request<any>(`/hour-logs/${id}/hold`, { method: 'PATCH', body: JSON.stringify(data) }),
  // Per-day approval endpoints. Reviewer picks a day, not a whole
  // week. Weekly hour_logs.status is derived from these actions.
  approveHourLogDay: (id: string, data: { reviewer_id?: string; reviewer_name?: string }) =>
    request<any>(`/hour-log-days/${id}/approve`, { method: 'PATCH', body: JSON.stringify(data) }),
  rejectHourLogDay: (id: string, data: { reviewer_id?: string; reviewer_name?: string; rejection_reason: string }) =>
    request<any>(`/hour-log-days/${id}/reject`, { method: 'PATCH', body: JSON.stringify(data) }),
  holdHourLogDay: (id: string, data: { reviewer_id?: string; reviewer_name?: string; rejection_reason: string }) =>
    request<any>(`/hour-log-days/${id}/hold`, { method: 'PATCH', body: JSON.stringify(data) }),
  getHourLogDaysQueue: (params?: { status?: string; reviewer_id?: string; employee_id?: string; month?: number; year?: number }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.reviewer_id) qs.set('reviewer_id', params.reviewer_id);
    if (params?.employee_id) qs.set('employee_id', params.employee_id);
    if (params?.month) qs.set('month', String(params.month));
    if (params?.year) qs.set('year', String(params.year));
    return request<any[]>(`/hour-log-days/queue?${qs}`);
  },
  getHourLogDaysCounts: (params?: { reviewer_id?: string; employee_id?: string; month?: number; year?: number }) => {
    const qs = new URLSearchParams();
    if (params?.reviewer_id) qs.set('reviewer_id', params.reviewer_id);
    if (params?.employee_id) qs.set('employee_id', params.employee_id);
    if (params?.month) qs.set('month', String(params.month));
    if (params?.year) qs.set('year', String(params.year));
    return request<{ pending: number; on_hold: number; approved: number; rejected: number }>(`/hour-log-days/counts?${qs}`);
  },
  getHourLogComments: (id: string) =>
    request<Array<{ id: string; author_id: string | null; author_name: string | null; author_role: string | null; body: string; created_at: string }>>(`/hour-logs/${id}/comments`),
  addHourLogComment: (id: string, data: { author_id?: string; author_name?: string; author_role?: string; body: string }) =>
    request<any>(`/hour-logs/${id}/comments`, { method: 'POST', body: JSON.stringify(data) }),

  // One-shot MyPortal bundle. Collapses the 8-fetch Promise.all on
  // mount into a single round-trip. Follow-up "nice to have" fetches
  // (warnings, PIPs, assets, etc.) still fire separately for now.
  getMyPortalBootstrap: (employee_id: string, month: number, year: number) =>
    request<{
      month: number; year: number;
      employee: any;
      manager: any | null;
      attendance: any[];
      leaveRequests: any[];
      payroll: any | null;
      leaveBalance: any;
      monthlyPerformance: any[];
      appraisalGoals: any[];
      wfhRequests: any[];
    }>(`/myportal/bootstrap?employee_id=${employee_id}&month=${month}&year=${year}`),

  // Weekly billing allocation sheet (replaces the Google Sheet).
  getHoursAllocations: (month: number, year: number) =>
    request<{
      month: number; year: number;
      rows: Array<{
        project_id: string;
        project_name: string;
        client_name: string | null;
        billing_account_id: string | null;
        billing_account_name: string | null;
        weeks: Array<{
          week_num: number;
          target_hours: number;
          actual_hours: number;
          actual_computed: number;
          actual_override: number | null;
          pending: number;
          status: 'unset' | 'met' | 'partial' | 'missing';
          notes: string | null;
          updated_by: string | null;
          updated_at: string | null;
        }>;
      }>;
    }>(`/hours/allocations?month=${month}&year=${year}`),
  saveHoursAllocation: (data: {
    project_id: string; year: number; week_num: number;
    target_hours?: number; actual_override?: number | null; notes?: string;
  }) =>
    request<{ ok: true }>('/hours/allocations', { method: 'PUT', body: JSON.stringify(data) }),
  setProjectBillingAccount: (project_id: string, billing_account_id: string | null) =>
    request<{ ok: true; billing_account_id: string | null }>(
      `/projects/${project_id}/billing-account`,
      { method: 'PATCH', body: JSON.stringify({ billing_account_id }) },
    ),
  setProjectBillingProfile: (project_id: string, billing_profile: string | null) =>
    request<{ ok: true; billing_profile: string | null }>(
      `/projects/${project_id}/billing-profile`,
      { method: 'PATCH', body: JSON.stringify({ billing_profile }) },
    ),
  getBillingProfiles: () =>
    request<string[]>(`/projects/billing-profiles`),

  getHoursSummary: (month: number, year: number) =>
    request<{
      month: number; year: number;
      employees: Array<{
        employee_id: string; employee_name: string;
        w1: number; w2: number; w3: number; w4: number; w5: number; monthly: number;
        variance_w1: number; variance_w2: number; variance_w3: number; variance_w4: number; variance_w5: number;
        logged_approved: number; logged_pending: number; logged_rejected: number;
        logged_within_plan: number; logged_over_plan: number; over_plan_log_count: number;
        w1_logged: number; w2_logged: number; w3_logged: number; w4_logged: number; w5_logged: number;
        w1_over: number;   w2_over: number;   w3_over: number;   w4_over: number;   w5_over: number;
        w1_edits: number;  w2_edits: number;  w3_edits: number;  w4_edits: number;  w5_edits: number;
        w1_last_edit: string | null; w2_last_edit: string | null; w3_last_edit: string | null; w4_last_edit: string | null; w5_last_edit: string | null;
        total_admin_edits: number;
      }>;
      total_allocated: number; total_logged_approved: number; total_logged_pending: number;
      total_logged_within_plan: number; total_logged_over_plan: number;
      over_plan_log_count: number;
      pending_review_count: number;
    }>(`/hours-summary?month=${month}&year=${year}`),

  // Role-based playbook
  getRoleResponsibilities: (role?: string) =>
    request<Array<{
      id: number; role: string;
      section_name: string; section_order: number; item_order: number;
      title: string; details: string | null;
      frequency: string | null; where_to_do: string | null;
      created_at: string; updated_at: string;
    }>>(`/role-responsibilities${role ? `?role=${role}` : ''}`),
  addRoleResponsibility: (data: { role: string; section_name: string; section_order?: number; item_order?: number; title: string; details?: string; frequency?: string; where_to_do?: string }) =>
    request<any>('/role-responsibilities', { method: 'POST', body: JSON.stringify(data) }),
  updateRoleResponsibility: (id: number, data: { section_name: string; section_order?: number; item_order?: number; title: string; details?: string; frequency?: string; where_to_do?: string }) =>
    request<any>(`/role-responsibilities/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteRoleResponsibility: (id: number) =>
    request<any>(`/role-responsibilities/${id}`, { method: 'DELETE' }),

  // Per-employee R&R overlay (personal items + edit-history)
  getEmployeeResponsibilities: (employeeId: string) =>
    request<{
      items: Array<{
        id: number; employee_id: string;
        section_name: string; section_order: number; item_order: number;
        title: string; details: string | null;
        frequency: string | null; where_to_do: string | null;
        created_at: string; updated_at: string;
      }>;
      can_write: boolean;
      can_view_audit: boolean;
    }>(`/employee-responsibilities?employee_id=${employeeId}`),
  addEmployeeResponsibility: (data: { employee_id: string; section_name: string; section_order?: number; item_order?: number; title: string; details?: string; frequency?: string; where_to_do?: string; reason?: string }) =>
    request<any>('/employee-responsibilities', { method: 'POST', body: JSON.stringify(data) }),
  updateEmployeeResponsibility: (id: number, data: { section_name: string; section_order?: number; item_order?: number; title: string; details?: string; frequency?: string; where_to_do?: string; reason?: string }) =>
    request<any>(`/employee-responsibilities/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteEmployeeResponsibility: (id: number, reason?: string) =>
    request<any>(`/employee-responsibilities/${id}`, { method: 'DELETE', body: reason ? JSON.stringify({ reason }) : undefined }),
  getEmployeeResponsibilitiesAudit: (employeeId: string) =>
    request<Array<{
      id: number; employee_id: string; item_id: number | null;
      action: 'create' | 'update' | 'delete'; title: string | null;
      before_data: any; after_data: any; reason: string | null;
      actor_id: string | null; actor_name: string | null; actor_role: string | null;
      created_at: string;
    }>>(`/employee-responsibilities/${employeeId}/audit`),

  // Direct staff utilization — admin / HR / coord see everyone (admin sees
  // costs; others get them stripped). Managers see their sub-tree only.
  getHoursUtilization: (month?: number, year?: number, week?: number) => {
    const qs = new URLSearchParams();
    if (month) qs.set('month', String(month));
    if (year) qs.set('year', String(year));
    if (week)  qs.set('week',  String(week));
    return request<{
      month: number; year: number;
      week?: number;
      week_range?: { start_day: number; end_day: number; working_days: number };
      scope: 'org' | 'team';
      employees: Array<{
        id: string; name: string; designation: string | null; department: string | null;
        cost_type: 'direct' | 'indirect' | 'supervisor';
        reporting_manager_id: string | null; reporting_manager_name: string | null;
        capacity: number; allocatedHours: number; benchHours: number;
        utilization: number | null; managedProjects?: number;
        // Cost fields present only for admin
        salary?: number; rate?: number; allocatedCost?: number; benchCost?: number;
      }>;
      total: { allocated: number; capacity: number; bench: number; utilization: number; headcount: number };
    }>(`/hours-utilization?${qs}`);
  },

  // ── Performance Pulse ────────────────────────────────────────────────
  getMyPulse: (params?: { month?: number; year?: number }) => {
    const qs = new URLSearchParams();
    if (params?.month) qs.set('month', String(params.month));
    if (params?.year)  qs.set('year',  String(params.year));
    const tail = qs.toString() ? `?${qs}` : '';
    return request<{ latest: PulseSnapshot | null; trend: Array<{ snapshot_date: string; total_score: number; band: string }>; resolved_via?: 'linkage' | 'email' | 'name' | 'none'; user_name?: string }>(`/performance/pulse/me${tail}`);
  },
  getTeamPulse: (params?: { month?: number; year?: number }) => {
    const qs = new URLSearchParams();
    if (params?.month) qs.set('month', String(params.month));
    if (params?.year)  qs.set('year',  String(params.year));
    const tail = qs.toString() ? `?${qs}` : '';
    return request<{ team: PulseTeamRow[]; week_start: string }>(`/performance/pulse/team${tail}`);
  },
  getOrgPulse: (params?: { month?: number; year?: number }) => {
    const qs = new URLSearchParams();
    if (params?.month) qs.set('month', String(params.month));
    if (params?.year)  qs.set('year',  String(params.year));
    const tail = qs.toString() ? `?${qs}` : '';
    return request<{ employees: PulseTeamRow[] }>(`/performance/pulse/org${tail}`);
  },
  getEmployeePulse: (employeeId: string, params?: { month?: number; year?: number }) => {
    const qs = new URLSearchParams();
    if (params?.month) qs.set('month', String(params.month));
    if (params?.year)  qs.set('year',  String(params.year));
    const tail = qs.toString() ? `?${qs}` : '';
    return request<{ latest: PulseSnapshot | null; trend: Array<{ snapshot_date: string; total_score: number; band: string }> }>(`/performance/pulse/${employeeId}${tail}`);
  },
  submitPulseRating: (data: { employee_id: string; rating: 'good' | 'ok' | 'concern'; note?: string; week_start?: string }) =>
    request(`/performance/pulse-rating`, { method: 'POST', body: JSON.stringify(data) }),
  recomputePulse: (asOf?: string, employeeIds?: string[]) =>
    request<{ computed: number; as_of: string; timings?: any; phases?: any }>(`/performance/pulse/recompute`, {
      method: 'POST', body: JSON.stringify({ as_of: asOf, employee_ids: employeeIds }),
    }),
  getPulseRecomputeTargets: () =>
    request<{ employee_ids: string[] }>(`/performance/pulse/recompute-targets`),
  // Monthly closing books — admin manual close (also auto-fires from the
  // daily cron on day 1 of each month).
  closePulseMonth: (month: number, year: number) =>
    request<{ closed: number; month: number; year: number }>(`/performance/pulse/monthly/close`, {
      method: 'POST', body: JSON.stringify({ month, year }),
    }),
  getPulseMonthly: (params: { employee_id?: string; months?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.employee_id) qs.set('employee_id', params.employee_id);
    if (params.months) qs.set('months', String(params.months));
    return request<{ months: number; rows: Array<{
      employee_id: string; name: string; department: string | null; designation: string | null;
      month: number; year: number; total_score: number; band: string;
      discipline: number | null; hours_hygiene: number | null; output: number | null; contribution: number | null;
      manager_pulse: number | null; team_stewardship: number | null; project_hygiene: number | null; client_handling: number | null;
      is_baseline: boolean;
    }> }>(`/performance/pulse/monthly?${qs}`);
  },
  getPulseWeights: () =>
    request<{ weights: PulseWeights[] }>(`/performance/pulse/weights`),
  updatePulseWeights: (dept: string, weights: Partial<PulseWeights>) =>
    request(`/performance/pulse/weights/${encodeURIComponent(dept)}`, { method: 'PUT', body: JSON.stringify(weights) }),

  getHoursCompliance: (params: { date?: string; manager_id?: string }) => {
    const qs = new URLSearchParams();
    if (params.date) qs.set('date', params.date);
    if (params.manager_id) qs.set('manager_id', params.manager_id);
    return request<{
      date: string; month: number; year: number;
      eligible_count: number; not_logged_count: number; logged_count: number;
      not_logged: Array<{
        employee_id: string; employee_name: string;
        designation: string | null; department: string | null;
        reporting_manager_id: string | null; reporting_manager_name: string | null;
        assignment_count: number;
      }>;
      pending_by_reviewer: Array<{
        reviewer_id: string | null; reviewer_name: string;
        log_count: number; total_hours: number; oldest_pending_at: string | null;
      }>;
      pending_by_employee: Array<{
        employee_id: string; employee_name: string;
        log_count: number; total_hours: number; oldest_pending_at: string | null;
      }>;
    }>(`/hours-compliance?${qs}`);
  },

  // ── Internal activities + non-project hour logs ─────────────────────
  // `roles` scopes which roles see the activity in the picker. NULL or
  // an empty array means visible to everyone. Valid values:
  //   'admin' | 'hr_manager' | 'project_coordinator' | 'manager' | 'employee'
  // 'manager' is computed at request time (employee has direct reports).
  getInternalActivities: () =>
    request<Array<{ id: string; name: string; description: string | null; active: boolean; sort_order: number; roles: string[] | null }>>(`/internal-activities`),
  addInternalActivity: (data: { name: string; description?: string; sort_order?: number; roles?: string[] | null }) =>
    request(`/internal-activities`, { method: 'POST', body: JSON.stringify(data) }),
  updateInternalActivity: (id: string, data: { name?: string; description?: string; active?: boolean; sort_order?: number; roles?: string[] | null }) =>
    request(`/internal-activities/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteInternalActivity: (id: string) =>
    request(`/internal-activities/${id}`, { method: 'DELETE' }),
  getInternalHourLogs: (params: { employee_id?: string; from?: string; to?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.employee_id) qs.set('employee_id', params.employee_id);
    if (params.from) qs.set('from', params.from);
    if (params.to) qs.set('to', params.to);
    return request<Array<{
      id: string; employee_id: string; activity_id: string; activity_name: string;
      log_date: string; hours: number; notes: string | null;
      status: 'pending' | 'approved' | 'rejected';
      reviewed_by_id: string | null; reviewed_by_name: string | null;
      reviewed_at: string | null; rejection_reason: string | null;
    }>>(`/internal-hour-logs?${qs}`);
  },
  // Batch variant for reviewers — one HTTP + one JOIN across the whole
  // reviewer's reporting tree, instead of N HTTPs / N SQL. Rows include
  // employee_name so the caller can group inline.
  getInternalHourLogsForTeam: (reviewer_id: string, from?: string, to?: string) => {
    const qs = new URLSearchParams({ reviewer_id });
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    return request<Array<{
      id: string; employee_id: string; employee_name: string; activity_id: string; activity_name: string;
      log_date: string; hours: number; notes: string | null;
      status: 'pending' | 'approved' | 'rejected';
      reviewed_by_id: string | null; reviewed_by_name: string | null;
      reviewed_at: string | null; rejection_reason: string | null;
    }>>(`/internal-hour-logs/for-team?${qs}`);
  },
  saveInternalHourLog: (data: { activity_id: string; log_date: string; hours: number; notes: string }) =>
    request(`/internal-hour-logs`, { method: 'POST', body: JSON.stringify(data) }),
  deleteInternalHourLog: (id: string) =>
    request(`/internal-hour-logs/${id}`, { method: 'DELETE' }),
  approveInternalHourLog: (id: string) =>
    request<any>(`/internal-hour-logs/${id}/approve`, { method: 'PATCH', body: JSON.stringify({}) }),
  rejectInternalHourLog: (id: string, rejection_reason: string) =>
    request<any>(`/internal-hour-logs/${id}/reject`, { method: 'PATCH', body: JSON.stringify({ rejection_reason }) }),

  // ── To-Do tasks ──────────────────────────────────────────────────────
  getTodos: (params: { status?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.status) qs.set('status', params.status);
    return request<{ mine: TodoTask[]; assigned_by_me: TodoTask[] }>(`/todos${qs.toString() ? `?${qs}` : ''}`);
  },
  createTodo: (data: { title: string; description?: string; due_date?: string; priority?: 'low' | 'normal' | 'high'; assignee_id?: string; tags?: string[] }) =>
    request<TodoTask>(`/todos`, { method: 'POST', body: JSON.stringify(data) }),
  updateTodo: (id: string, data: Partial<{ title: string; description: string; due_date: string | null; priority: 'low' | 'normal' | 'high'; status: 'pending' | 'in_progress' | 'done' | 'cancelled'; completion_note: string; tags: string[] }>) =>
    request<TodoTask>(`/todos/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteTodo: (id: string) =>
    request(`/todos/${id}`, { method: 'DELETE' }),

  // ── Feature announcements ────────────────────────────────────────────
  getFeatures: () => request<FeatureAnnouncement[]>(`/features`),
  getUnseenFeature: () => request<FeatureAnnouncement | null>(`/features/unseen`),
  createFeature: (data: { title: string; body: string; image_url?: string; cta_label?: string; cta_url?: string; target_roles?: string[] | null }) =>
    request<FeatureAnnouncement>(`/features`, { method: 'POST', body: JSON.stringify(data) }),
  updateFeature: (id: string, data: Partial<{ title: string; body: string; image_url: string | null; cta_label: string | null; cta_url: string | null; status: 'draft' | 'published'; target_roles: string[] | null }>) =>
    request<FeatureAnnouncement>(`/features/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteFeature: (id: string) =>
    request(`/features/${id}`, { method: 'DELETE' }),
  ackFeature: (id: string) =>
    request(`/features/${id}/ack`, { method: 'POST' }),

  // ── Company announcements (Dashboard news widget) ────────────────────
  getAnnouncements: () =>
    request<Array<{
      id: string; title: string; body: string; pinned: boolean;
      expires_at: string | null;
      posted_by_id: string | null; posted_by_name: string | null;
      posted_by_role: string | null;
      // 'user' = posted via the dashboard form. 'birthday' / 'anniversary'
      // = auto-generated by the HRMS on the relevant day.
      kind: 'user' | 'birthday' | 'anniversary' | null;
      created_at: string; updated_at: string;
    }>>(`/announcements`),
  createAnnouncement: (data: { title: string; body: string; pinned?: boolean; expires_at?: string | null }) =>
    request<any>(`/announcements`, { method: 'POST', body: JSON.stringify(data) }),
  updateAnnouncement: (id: string, data: Partial<{ title: string; body: string; pinned: boolean; expires_at: string | null }>) =>
    request<any>(`/announcements/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteAnnouncement: (id: string) =>
    request<any>(`/announcements/${id}`, { method: 'DELETE' }),
  getAnnouncementComments: (id: string) =>
    request<Array<{
      id: string; announcement_id: string; body: string;
      posted_by_id: string | null; posted_by_name: string | null;
      posted_by_role: string | null; created_at: string;
    }>>(`/announcements/${id}/comments`),
  addAnnouncementComment: (id: string, body: string) =>
    request<any>(`/announcements/${id}/comments`, { method: 'POST', body: JSON.stringify({ body }) }),
  deleteAnnouncementComment: (id: string, commentId: string) =>
    request<any>(`/announcements/${id}/comments/${commentId}`, { method: 'DELETE' }),

  // ── Template Hub — email + letter boilerplates ────────────────────────
  getTemplates: (params: { category?: string; format?: 'email' | 'letter' } = {}) => {
    const qs = new URLSearchParams();
    if (params.category) qs.set('category', params.category);
    if (params.format)   qs.set('format',   params.format);
    return request<Array<{
      id: string; title: string; category: string | null;
      format: 'email' | 'letter'; subject: string | null; body: string;
      description: string | null; tags: string[] | null; active: boolean;
      created_by_id: string | null; created_by_name: string | null;
      updated_by_id: string | null; updated_by_name: string | null;
      created_at: string; updated_at: string;
    }>>(`/templates${qs.toString() ? `?${qs}` : ''}`);
  },
  addTemplate: (data: { title: string; category?: string; format?: 'email' | 'letter'; subject?: string; body: string; description?: string; tags?: string[] }) =>
    request<any>(`/templates`, { method: 'POST', body: JSON.stringify(data) }),
  updateTemplate: (id: string, data: Partial<{ title: string; category: string | null; format: 'email' | 'letter'; subject: string | null; body: string; description: string | null; tags: string[] | null; active: boolean }>) =>
    request<any>(`/templates/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteTemplate: (id: string) =>
    request<any>(`/templates/${id}`, { method: 'DELETE' }),

  // ── Upcoming events (holidays + birthdays + anniversaries) ───────────
  getUpcomingEvents: (days = 30) =>
    request<Array<{
      kind: 'holiday' | 'birthday' | 'anniversary';
      event_date: string;
      label: string;
      years?: number;
      employee?: { id: string; name: string; designation: string | null; department: string | null; avatar: string | null };
    }>>(`/upcoming-events?days=${days}`),

  // ── Granular permissions ─────────────────────────────────────────────
  getPermissionModules: () =>
    request<Array<{ id: string; label: string; group_label: string | null; has_approve: boolean; display_order: number; description: string | null }>>(`/permissions/modules`),
  getUserPermissions: (userId: string) =>
    request<{
      user: { id: string; name: string; email: string; role: string };
      grid: Array<{
        module_id: string; label: string; group_label: string | null; has_approve: boolean;
        can_read: boolean; can_create: boolean; can_modify: boolean; can_delete: boolean; can_approve: boolean;
        is_override: boolean;
        default_can_read: boolean; default_can_create: boolean; default_can_modify: boolean; default_can_delete: boolean; default_can_approve: boolean;
      }>;
    }>(`/permissions/user/${userId}`),
  saveUserPermissions: (userId: string, overrides: Array<{ module_id: string; can_read?: boolean; can_create?: boolean; can_modify?: boolean; can_delete?: boolean; can_approve?: boolean; clear?: boolean }>) =>
    request<{ ok: boolean }>(`/permissions/user/${userId}`, { method: 'PUT', body: JSON.stringify({ overrides }) }),
  getMyPermissions: () =>
    request<{ admin: true } | { admin: false; permissions: Record<string, { read: boolean; create: boolean; modify: boolean; delete: boolean; approve: boolean }> }>(`/permissions/me`),

  // ── Allocation change requests ───────────────────────────────────────
  getAllocationRequests: (params: { status?: string; project_id?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.status) qs.set('status', params.status);
    if (params.project_id) qs.set('project_id', params.project_id);
    return request<AllocationChangeRequest[]>(`/allocation-requests${qs.toString() ? `?${qs}` : ''}`);
  },
  createAllocationRequest: (data: {
    assignment_id: string;
    proposed_w1?: number | null; proposed_w2?: number | null; proposed_w3?: number | null;
    proposed_w4?: number | null; proposed_w5?: number | null; proposed_monthly?: number | null;
    reason: string;
  }) => request<AllocationChangeRequest>(`/allocation-requests`, { method: 'POST', body: JSON.stringify(data) }),
  approveAllocationRequest: (id: string, data: { review_note?: string } = {}) =>
    request<AllocationChangeRequest>(`/allocation-requests/${id}/approve`, { method: 'PATCH', body: JSON.stringify(data) }),
  rejectAllocationRequest: (id: string, data: { review_note: string }) =>
    request<AllocationChangeRequest>(`/allocation-requests/${id}/reject`, { method: 'PATCH', body: JSON.stringify(data) }),
  cancelAllocationRequest: (id: string) =>
    request<AllocationChangeRequest>(`/allocation-requests/${id}/cancel`, { method: 'PATCH' }),

  // ── Onboarding + offboarding checklists ─────────────────────────────
  getChecklist: (employeeId: string, kind: 'onboarding' | 'offboarding') =>
    request<{ current: any | null; history: any[] }>(`/employees/${employeeId}/checklist/${kind}`),
  startChecklist: (employeeId: string, kind: 'onboarding' | 'offboarding') =>
    request<{ id: string; current: any; history: any[] }>(`/employees/${employeeId}/checklist/${kind}`, { method: 'POST', body: JSON.stringify({}) }),
  updateChecklistItem: (itemId: string, kind: 'onboarding' | 'offboarding', data: { done?: boolean; notes?: string | null }) =>
    request<{ item: any; checklist_completed: boolean }>(`/checklist-items/${itemId}?kind=${kind}`, { method: 'PATCH', body: JSON.stringify(data) }),
  addChecklistItem: (checklistId: string, kind: 'onboarding' | 'offboarding', label: string) =>
    request<any>(`/checklists/${checklistId}/items?kind=${kind}`, { method: 'POST', body: JSON.stringify({ label }) }),
  deleteChecklistItem: (itemId: string, kind: 'onboarding' | 'offboarding') =>
    request<{ ok: true }>(`/checklist-items/${itemId}?kind=${kind}`, { method: 'DELETE' }),
  completeChecklist: (checklistId: string, kind: 'onboarding' | 'offboarding') =>
    request<any>(`/checklists/${checklistId}/complete?kind=${kind}`, { method: 'POST', body: JSON.stringify({}) }),
  cancelChecklist: (checklistId: string, kind: 'onboarding' | 'offboarding', reason: string) =>
    request<any>(`/checklists/${checklistId}/cancel?kind=${kind}`, { method: 'POST', body: JSON.stringify({ reason }) }),
  getLifecycleDashboard: () =>
    request<{
      onboarding: any[]; offboarding: any[];
      summary: { onboarding_in_progress: number; offboarding_in_progress: number; overdue: number };
      recent: any[];
    }>(`/lifecycle-dashboard`),

  // ── Checklist template editor (admin) ────────────────────────────────
  getChecklistTemplates: (kind: 'onboarding' | 'offboarding') =>
    request<Array<{ id: string; kind: string; key: string; label: string; sort_order: number }>>(`/config/checklist-templates?kind=${kind}`),
  addChecklistTemplate: (kind: 'onboarding' | 'offboarding', label: string) =>
    request<any>(`/config/checklist-templates`, { method: 'POST', body: JSON.stringify({ kind, label }) }),
  renameChecklistTemplate: (id: string, label: string) =>
    request<any>(`/config/checklist-templates/${id}`, { method: 'PATCH', body: JSON.stringify({ label }) }),
  reorderChecklistTemplates: (kind: 'onboarding' | 'offboarding', ordered_ids: string[]) =>
    request<{ ok: true; updated: number }>(`/config/checklist-templates/reorder`, { method: 'PATCH', body: JSON.stringify({ kind, ordered_ids }) }),
  deleteChecklistTemplate: (id: string) =>
    request<{ ok: true }>(`/config/checklist-templates/${id}`, { method: 'DELETE' }),

  // ── HR Document Register ──────────────────────────────────────────────
  getHrDocumentTypes: () =>
    request<Array<{ key: string; code: string; label: string }>>(`/hr-documents/types`),
  getHrDocuments: (params: { employee_id?: string; doc_type?: string; from?: string; to?: string; q?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.employee_id) qs.set('employee_id', params.employee_id);
    if (params.doc_type) qs.set('doc_type', params.doc_type);
    if (params.from) qs.set('from', params.from);
    if (params.to) qs.set('to', params.to);
    if (params.q) qs.set('q', params.q);
    return request<HrDocument[]>(`/hr-documents?${qs}`);
  },
  issueHrDocument: (data: {
    doc_type: string; doc_type_label?: string;
    employee_id: string; issued_on: string;
    subject?: string; notes?: string; external_ref?: string;
  }) =>
    request<HrDocument>(`/hr-documents`, { method: 'POST', body: JSON.stringify(data) }),
  updateHrDocument: (id: string, data: { issued_on?: string; subject?: string | null; notes?: string | null; external_ref?: string | null }) =>
    request<HrDocument>(`/hr-documents/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  voidHrDocument: (id: string, voided_reason: string) =>
    request<HrDocument>(`/hr-documents/${id}/void`, { method: 'PATCH', body: JSON.stringify({ voided_reason }) }),
};

export interface HrDocument {
  id: string;
  doc_number: string;
  doc_type: string;
  doc_type_label: string | null;
  employee_id: string;
  employee_name?: string;
  employee_code?: string;
  designation?: string;
  issued_on: string;
  issued_by_id: string | null;
  issued_by_name: string | null;
  subject: string | null;
  notes: string | null;
  external_ref: string | null;
  voided: boolean;
  voided_reason: string | null;
  voided_by_name: string | null;
  voided_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AllocationChangeRequest {
  id: string;
  assignment_id: string;
  project_id: string; project_name: string | null;
  employee_id: string; employee_name: string | null;
  month: number; year: number;
  current_w1: number; current_w2: number; current_w3: number; current_w4: number; current_w5: number; current_monthly: number;
  proposed_w1: number | null; proposed_w2: number | null; proposed_w3: number | null; proposed_w4: number | null; proposed_w5: number | null; proposed_monthly: number | null;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  requested_by_id: string | null; requested_by_name: string | null; requested_by_role: string | null;
  reviewed_by_id: string | null; reviewed_by_name: string | null; reviewed_at: string | null; review_note: string | null;
  created_at: string; updated_at: string;
}

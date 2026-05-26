const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
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
    request<{ user: any }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),

  // Employees
  getEmployees: () => request<any[]>('/employees'),
  getTeamMembers: (reporting_manager_id: string) => request<any[]>(`/employees?reporting_manager_id=${reporting_manager_id}`),
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
  updateLeaveStatus: (id: string, status: string, opts?: { actioner_name?: string; rejection_reason?: string }) =>
    request<any>(`/leave/requests/${id}`, { method: 'PATCH', body: JSON.stringify({ status, ...opts }) }),
  cancelLeave: (id: string, cancelled_by: string, cancellation_reason: string) =>
    request<any>(`/leave/requests/${id}/cancel`, { method: 'PATCH', body: JSON.stringify({ cancelled_by, cancellation_reason }) }),
  managerApproveLeave: (id: string, data: { status: 'approved' | 'rejected'; manager_id: string; manager_name?: string; rejection_reason?: string }) =>
    request<any>(`/leave/requests/${id}/manager-approve`, { method: 'PATCH', body: JSON.stringify(data) }),
  getLeaveBalance: (employee_id: string) => request<any>(`/leave/balances/${employee_id}`),
  adjustLeaveBalance: (employee_id: string, data: { full_day: number; short_leave: number }) =>
    request<any>(`/leave/balances/${employee_id}`, { method: 'PATCH', body: JSON.stringify(data) }),

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
  lockPerformanceReview: (id: string, lock: boolean, lockedBy?: string, requesterRole?: string) =>
    request<any>(`/performance/monthly/${id}/lock`, { method: 'PATCH', body: JSON.stringify({ lock, locked_by: lockedBy, requester_role: requesterRole }) }),

  saveMonthlyPerformance: (data: {
    employee_id: string; reviewer_id?: string; reviewer_name?: string;
    month: number; year: number;
    productivity: number; quality: number; teamwork: number; attendance_score: number; initiative: number; client_satisfaction: number; ai_usage: number;
    overall_score: number; comments?: string; parameter_notes?: Record<string, string>;
    requester_role?: string;
  }) => request<any>('/performance/monthly', { method: 'POST', body: JSON.stringify(data) }),

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
  submitUpsell: (data: { employee_id: string; employee_name?: string; client_name: string; service_description: string; deal_value?: number; notes?: string }) =>
    request<any>('/upsell', { method: 'POST', body: JSON.stringify(data) }),
  reviewUpsell: (id: string, data: { status: string; reviewed_by?: string; rejection_reason?: string; approved_amount?: number; payment_note?: string }) =>
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

  getRepairTickets: (employeeId?: string) =>
    request<any[]>(`/repair-tickets${employeeId ? `?employee_id=${employeeId}` : ''}`),
  createRepairTicket: (data: any) => request<any>('/repair-tickets', { method: 'POST', body: JSON.stringify(data) }),
  updateRepairTicket: (id: string, data: any) => request<any>(`/repair-tickets/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  approveRepairTicket: (id: string, approved_by?: string) =>
    request<any>(`/repair-tickets/${id}/approve`, { method: 'PATCH', body: JSON.stringify({ approved_by }) }),
  rejectRepairTicket: (id: string, rejected_by?: string, rejection_reason?: string) =>
    request<any>(`/repair-tickets/${id}/reject`, { method: 'PATCH', body: JSON.stringify({ rejected_by, rejection_reason }) }),
  deleteRepairTicket: (id: string) => request<any>(`/repair-tickets/${id}`, { method: 'DELETE' }),

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

  // Notifications
  getNotifications: (userId: string) => request<any[]>(`/notifications?user_id=${userId}`),
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

  getHourLogs: (params?: { employee_id?: string; month?: number; year?: number; status?: string; reviewer_id?: string }) => {
    const qs = new URLSearchParams();
    if (params?.employee_id) qs.set('employee_id', params.employee_id);
    if (params?.month) qs.set('month', String(params.month));
    if (params?.year) qs.set('year', String(params.year));
    if (params?.status) qs.set('status', params.status);
    if (params?.reviewer_id) qs.set('reviewer_id', params.reviewer_id);
    return request<any[]>(`/hour-logs?${qs}`);
  },
  submitHourLog: (data: {
    project_id: string; employee_id: string; employee_name?: string;
    month: number; year: number; week_num: number;
    hours_logged: number; work_description?: string;
  }) => request<any>('/hour-logs', { method: 'POST', body: JSON.stringify(data) }),
  editHourLog: (id: string, data: { hours_logged: number; work_description?: string; actor_id?: string; actor_name?: string; actor_role?: string; keep_status?: boolean; reason?: string }) =>
    request<any>(`/hour-logs/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  getHourLogAudit: (id: string) =>
    request<Array<{
      id: number;
      hour_log_id: string;
      action: 'created' | 'edited' | 'approved' | 'rejected' | 'admin_edit' | 'resubmitted';
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
};

const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
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
  saveMonthlyPerformance: (data: {
    employee_id: string; reviewer_id?: string; reviewer_name?: string;
    month: number; year: number;
    productivity: number; quality: number; teamwork: number; attendance_score: number; initiative: number; client_satisfaction: number;
    overall_score: number; comments?: string;
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

  // Notifications
  getNotifications: (userId: string) => request<any[]>(`/notifications?user_id=${userId}`),
  markNotificationRead: (id: number) => request<any>(`/notifications/${id}/read`, { method: 'PATCH' }),
  markAllNotificationsRead: (userId: string) => request<any>(`/notifications/read-all?user_id=${userId}`, { method: 'PATCH' }),
  deleteNotification: (id: number) => request<any>(`/notifications/${id}`, { method: 'DELETE' }),

  // Users
  getUsers: () => request<any[]>('/users'),
  createUser: (data: any) => request<any>('/users', { method: 'POST', body: JSON.stringify(data) }),
  updateUser: (id: string, data: any) => request<any>(`/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  toggleUserActive: (id: string, active: boolean) =>
    request<any>(`/users/${id}/active`, { method: 'PATCH', body: JSON.stringify({ active }) }),
  deleteUser: (id: string) => request<any>(`/users/${id}`, { method: 'DELETE' }),
};

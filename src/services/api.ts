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
  createEmployee: (data: any) => request<any>('/employees', { method: 'POST', body: JSON.stringify(data) }),
  updateEmployee: (id: string, data: any) => request<any>(`/employees/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

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
  getLeaveRequests: (params?: { employee_id?: string; status?: string }) => {
    const qs = new URLSearchParams();
    if (params?.employee_id) qs.set('employee_id', params.employee_id);
    if (params?.status) qs.set('status', params.status);
    return request<any[]>(`/leave/requests?${qs}`);
  },
  applyLeave: (data: any) => request<any>('/leave/requests', { method: 'POST', body: JSON.stringify(data) }),
  updateLeaveStatus: (id: string, status: string) =>
    request<any>(`/leave/requests/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  getLeaveBalance: (employee_id: string) => request<any>(`/leave/balances/${employee_id}`),

  // Payroll
  getPayroll: (params?: { month?: string; year?: number }) => {
    const qs = new URLSearchParams();
    if (params?.month) qs.set('month', params.month);
    if (params?.year) qs.set('year', String(params.year));
    return request<any[]>(`/payroll?${qs}`);
  },
  getEmployeePayroll: (employee_id: string) => request<any[]>(`/payroll/${employee_id}`),

  // Performance
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

  // Users
  getUsers: () => request<any[]>('/users'),
  createUser: (data: any) => request<any>('/users', { method: 'POST', body: JSON.stringify(data) }),
  updateUser: (id: string, data: any) => request<any>(`/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  toggleUserActive: (id: string, active: boolean) =>
    request<any>(`/users/${id}/active`, { method: 'PATCH', body: JSON.stringify({ active }) }),
  deleteUser: (id: string) => request<any>(`/users/${id}`, { method: 'DELETE' }),
};

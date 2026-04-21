export interface Employee {
  id: string;
  name: string;
  email: string;
  phone: string;
  department: string;
  designation: string;
  employeeId: string;
  joinDate: string;
  location: string;
  manager: string;
  status: 'active' | 'inactive';
  avatar: string;
  salary: number;
  ctc: number;
}

export interface AttendanceRecord {
  employeeId: string;
  date: string;
  checkIn: string | null;
  checkOut: string | null;
  status: 'present' | 'absent' | 'late' | 'half-day' | 'weekend' | 'holiday';
  totalHours: number;
}

export interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  type: 'casual' | 'sick' | 'earned' | 'maternity' | 'paternity';
  from: string;
  to: string;
  days: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  appliedOn: string;
}

export interface PayrollRecord {
  employeeId: string;
  month: string;
  year: number;
  basic: number;
  hra: number;
  specialAllowance: number;
  providentFund: number;
  professionalTax: number;
  incomeTax: number;
  grossPay: number;
  netPay: number;
  status: 'paid' | 'pending';
}

export interface Goal {
  id: string;
  employeeId: string;
  title: string;
  description: string;
  dueDate: string;
  progress: number;
  status: 'on-track' | 'at-risk' | 'completed' | 'not-started';
}

export interface Review {
  id: string;
  employeeId: string;
  reviewerId: string;
  period: string;
  rating: number;
  feedback: string;
  date: string;
}

export const employees: Employee[] = [
  {
    id: 'e1',
    name: 'Priya Sharma',
    email: 'priya.sharma@company.com',
    phone: '+91 98765 43210',
    department: 'Engineering',
    designation: 'Senior Software Engineer',
    employeeId: 'EMP001',
    joinDate: '2021-03-15',
    location: 'Bangalore',
    manager: 'Rahul Verma',
    status: 'active',
    avatar: 'PS',
    salary: 120000,
    ctc: 1800000,
  },
  {
    id: 'e2',
    name: 'Rahul Verma',
    email: 'rahul.verma@company.com',
    phone: '+91 87654 32109',
    department: 'Engineering',
    designation: 'Engineering Manager',
    employeeId: 'EMP002',
    joinDate: '2019-07-01',
    location: 'Bangalore',
    manager: 'Anjali Singh',
    status: 'active',
    avatar: 'RV',
    salary: 180000,
    ctc: 2800000,
  },
  {
    id: 'e3',
    name: 'Anjali Singh',
    email: 'anjali.singh@company.com',
    phone: '+91 76543 21098',
    department: 'Product',
    designation: 'VP of Product',
    employeeId: 'EMP003',
    joinDate: '2018-01-10',
    location: 'Mumbai',
    manager: 'CEO',
    status: 'active',
    avatar: 'AS',
    salary: 250000,
    ctc: 4000000,
  },
  {
    id: 'e4',
    name: 'Vikram Nair',
    email: 'vikram.nair@company.com',
    phone: '+91 65432 10987',
    department: 'Design',
    designation: 'UI/UX Designer',
    employeeId: 'EMP004',
    joinDate: '2022-06-20',
    location: 'Hyderabad',
    manager: 'Anjali Singh',
    status: 'active',
    avatar: 'VN',
    salary: 90000,
    ctc: 1400000,
  },
  {
    id: 'e5',
    name: 'Deepika Reddy',
    email: 'deepika.reddy@company.com',
    phone: '+91 54321 09876',
    department: 'HR',
    designation: 'HR Manager',
    employeeId: 'EMP005',
    joinDate: '2020-04-05',
    location: 'Bangalore',
    manager: 'Anjali Singh',
    status: 'active',
    avatar: 'DR',
    salary: 100000,
    ctc: 1600000,
  },
  {
    id: 'e6',
    name: 'Arjun Mehta',
    email: 'arjun.mehta@company.com',
    phone: '+91 43210 98765',
    department: 'Sales',
    designation: 'Sales Lead',
    employeeId: 'EMP006',
    joinDate: '2021-09-14',
    location: 'Delhi',
    manager: 'Anjali Singh',
    status: 'active',
    avatar: 'AM',
    salary: 110000,
    ctc: 1700000,
  },
  {
    id: 'e7',
    name: 'Kavya Iyer',
    email: 'kavya.iyer@company.com',
    phone: '+91 32109 87654',
    department: 'Engineering',
    designation: 'Software Engineer',
    employeeId: 'EMP007',
    joinDate: '2023-01-23',
    location: 'Bangalore',
    manager: 'Rahul Verma',
    status: 'active',
    avatar: 'KI',
    salary: 80000,
    ctc: 1200000,
  },
  {
    id: 'e8',
    name: 'Sanjay Gupta',
    email: 'sanjay.gupta@company.com',
    phone: '+91 21098 76543',
    department: 'Finance',
    designation: 'Finance Manager',
    employeeId: 'EMP008',
    joinDate: '2019-11-12',
    location: 'Mumbai',
    manager: 'Anjali Singh',
    status: 'active',
    avatar: 'SG',
    salary: 140000,
    ctc: 2200000,
  },
  {
    id: 'e9',
    name: 'Meera Pillai',
    email: 'meera.pillai@company.com',
    phone: '+91 10987 65432',
    department: 'Marketing',
    designation: 'Marketing Specialist',
    employeeId: 'EMP009',
    joinDate: '2022-03-08',
    location: 'Pune',
    manager: 'Arjun Mehta',
    status: 'active',
    avatar: 'MP',
    salary: 75000,
    ctc: 1150000,
  },
  {
    id: 'e10',
    name: 'Rohan Joshi',
    email: 'rohan.joshi@company.com',
    phone: '+91 99876 54321',
    department: 'Engineering',
    designation: 'DevOps Engineer',
    employeeId: 'EMP010',
    joinDate: '2021-11-01',
    location: 'Bangalore',
    manager: 'Rahul Verma',
    status: 'inactive',
    avatar: 'RJ',
    salary: 105000,
    ctc: 1650000,
  },
];

const today = new Date();
const currentMonth = today.getMonth();
const currentYear = today.getFullYear();

function generateAttendance(employeeId: string): AttendanceRecord[] {
  const records: AttendanceRecord[] = [];
  for (let day = 1; day <= 21; day++) {
    const date = new Date(currentYear, currentMonth, day);
    const dayOfWeek = date.getDay();
    const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    if (dayOfWeek === 0 || dayOfWeek === 6) {
      records.push({ employeeId, date: dateStr, checkIn: null, checkOut: null, status: 'weekend', totalHours: 0 });
    } else {
      const rand = Math.random();
      if (rand < 0.05) {
        records.push({ employeeId, date: dateStr, checkIn: null, checkOut: null, status: 'absent', totalHours: 0 });
      } else if (rand < 0.12) {
        records.push({ employeeId, date: dateStr, checkIn: '10:15', checkOut: '19:00', status: 'late', totalHours: 8.75 });
      } else {
        const hours = 8 + Math.random() * 2;
        records.push({ employeeId, date: dateStr, checkIn: '09:00', checkOut: '18:00', status: 'present', totalHours: parseFloat(hours.toFixed(1)) });
      }
    }
  }
  return records;
}

export const attendanceRecords: AttendanceRecord[] = employees.flatMap(e => generateAttendance(e.id));

export const leaveRequests: LeaveRequest[] = [
  { id: 'l1', employeeId: 'e1', employeeName: 'Priya Sharma', type: 'casual', from: '2026-04-25', to: '2026-04-25', days: 1, reason: 'Personal work', status: 'pending', appliedOn: '2026-04-20' },
  { id: 'l2', employeeId: 'e7', employeeName: 'Kavya Iyer', type: 'sick', from: '2026-04-22', to: '2026-04-23', days: 2, reason: 'Fever and cold', status: 'approved', appliedOn: '2026-04-21' },
  { id: 'l3', employeeId: 'e4', employeeName: 'Vikram Nair', type: 'earned', from: '2026-05-01', to: '2026-05-05', days: 5, reason: 'Family vacation', status: 'pending', appliedOn: '2026-04-19' },
  { id: 'l4', employeeId: 'e6', employeeName: 'Arjun Mehta', type: 'casual', from: '2026-04-18', to: '2026-04-18', days: 1, reason: 'Doctor appointment', status: 'approved', appliedOn: '2026-04-17' },
  { id: 'l5', employeeId: 'e9', employeeName: 'Meera Pillai', type: 'sick', from: '2026-04-15', to: '2026-04-16', days: 2, reason: 'Not feeling well', status: 'rejected', appliedOn: '2026-04-14' },
  { id: 'l6', employeeId: 'e2', employeeName: 'Rahul Verma', type: 'earned', from: '2026-05-10', to: '2026-05-15', days: 6, reason: 'Annual leave', status: 'pending', appliedOn: '2026-04-20' },
  { id: 'l7', employeeId: 'e5', employeeName: 'Deepika Reddy', type: 'casual', from: '2026-04-28', to: '2026-04-28', days: 1, reason: 'Personal errand', status: 'approved', appliedOn: '2026-04-20' },
];

export const leaveBalances: Record<string, Record<string, number>> = {
  e1: { casual: 10, sick: 7, earned: 15 },
  e2: { casual: 8, sick: 6, earned: 20 },
  e3: { casual: 12, sick: 10, earned: 18 },
  e4: { casual: 9, sick: 7, earned: 12 },
  e5: { casual: 11, sick: 8, earned: 16 },
  e6: { casual: 7, sick: 5, earned: 14 },
  e7: { casual: 10, sick: 7, earned: 8 },
  e8: { casual: 9, sick: 6, earned: 22 },
  e9: { casual: 10, sick: 7, earned: 10 },
  e10: { casual: 6, sick: 4, earned: 11 },
};

export const payrollRecords: PayrollRecord[] = employees.map(emp => ({
  employeeId: emp.id,
  month: 'March',
  year: 2026,
  basic: Math.round(emp.salary * 0.5),
  hra: Math.round(emp.salary * 0.2),
  specialAllowance: Math.round(emp.salary * 0.3),
  providentFund: Math.round(emp.salary * 0.12),
  professionalTax: 200,
  incomeTax: Math.round(emp.salary * 0.1),
  grossPay: emp.salary,
  netPay: Math.round(emp.salary - emp.salary * 0.12 - 200 - emp.salary * 0.1),
  status: 'paid',
}));

export const goals: Goal[] = [
  { id: 'g1', employeeId: 'e1', title: 'Migrate auth service to OAuth2', description: 'Complete migration of authentication service', dueDate: '2026-06-30', progress: 65, status: 'on-track' },
  { id: 'g2', employeeId: 'e1', title: 'Improve API response time by 30%', description: 'Optimize database queries and caching', dueDate: '2026-05-31', progress: 40, status: 'at-risk' },
  { id: 'g3', employeeId: 'e2', title: 'Hire 3 senior engineers', description: 'Complete hiring pipeline for Q2', dueDate: '2026-06-30', progress: 33, status: 'on-track' },
  { id: 'g4', employeeId: 'e4', title: 'Redesign onboarding flow', description: 'Improve user onboarding experience', dueDate: '2026-05-15', progress: 80, status: 'on-track' },
  { id: 'g5', employeeId: 'e7', title: 'Learn and implement GraphQL', description: 'Upskill in GraphQL for new API layer', dueDate: '2026-07-31', progress: 20, status: 'not-started' },
  { id: 'g6', employeeId: 'e9', title: 'Launch Q2 marketing campaign', description: 'Execute Q2 content and social campaign', dueDate: '2026-04-30', progress: 100, status: 'completed' },
];

export const reviews: Review[] = [
  { id: 'r1', employeeId: 'e1', reviewerId: 'e2', period: 'H2 2025', rating: 4.5, feedback: 'Priya has consistently delivered high-quality work and shown excellent problem-solving skills.', date: '2026-01-15' },
  { id: 'r2', employeeId: 'e7', reviewerId: 'e2', period: 'H2 2025', rating: 3.8, feedback: 'Kavya has shown good progress. Needs to improve on communication and documentation.', date: '2026-01-15' },
  { id: 'r3', employeeId: 'e4', reviewerId: 'e3', period: 'H2 2025', rating: 4.2, feedback: 'Vikram brings creative energy to the team. Designs are consistently well-received.', date: '2026-01-16' },
];

export const departments = ['Engineering', 'Product', 'Design', 'HR', 'Sales', 'Finance', 'Marketing'];

export const currentUser = employees[4]; // Deepika Reddy as HR Manager (logged in user)

import { sql } from './db';

const employees = [
  { id: 'e1', name: 'Priya Sharma', email: 'priya.sharma@company.com', phone: '+91 98765 43210', department: 'Engineering', designation: 'Senior Software Engineer', employee_id: 'EMP001', join_date: '2021-03-15', location: 'Bangalore', manager: 'Rahul Verma', status: 'active', avatar: 'PS', salary: 120000, ctc: 1800000 },
  { id: 'e2', name: 'Rahul Verma', email: 'rahul.verma@company.com', phone: '+91 87654 32109', department: 'Engineering', designation: 'Engineering Manager', employee_id: 'EMP002', join_date: '2019-07-01', location: 'Bangalore', manager: 'Anjali Singh', status: 'active', avatar: 'RV', salary: 180000, ctc: 2800000 },
  { id: 'e3', name: 'Anjali Singh', email: 'anjali.singh@company.com', phone: '+91 76543 21098', department: 'Product', designation: 'VP of Product', employee_id: 'EMP003', join_date: '2018-01-10', location: 'Mumbai', manager: 'CEO', status: 'active', avatar: 'AS', salary: 250000, ctc: 4000000 },
  { id: 'e4', name: 'Vikram Nair', email: 'vikram.nair@company.com', phone: '+91 65432 10987', department: 'Design', designation: 'UI/UX Designer', employee_id: 'EMP004', join_date: '2022-06-20', location: 'Hyderabad', manager: 'Anjali Singh', status: 'active', avatar: 'VN', salary: 90000, ctc: 1400000 },
  { id: 'e5', name: 'Deepika Reddy', email: 'deepika.reddy@company.com', phone: '+91 54321 09876', department: 'HR', designation: 'HR Manager', employee_id: 'EMP005', join_date: '2020-04-05', location: 'Bangalore', manager: 'Anjali Singh', status: 'active', avatar: 'DR', salary: 100000, ctc: 1600000 },
  { id: 'e6', name: 'Arjun Mehta', email: 'arjun.mehta@company.com', phone: '+91 43210 98765', department: 'Sales', designation: 'Sales Lead', employee_id: 'EMP006', join_date: '2021-09-14', location: 'Delhi', manager: 'Anjali Singh', status: 'active', avatar: 'AM', salary: 110000, ctc: 1700000 },
  { id: 'e7', name: 'Kavya Iyer', email: 'kavya.iyer@company.com', phone: '+91 32109 87654', department: 'Engineering', designation: 'Software Engineer', employee_id: 'EMP007', join_date: '2023-01-23', location: 'Bangalore', manager: 'Rahul Verma', status: 'active', avatar: 'KI', salary: 80000, ctc: 1200000 },
  { id: 'e8', name: 'Sanjay Gupta', email: 'sanjay.gupta@company.com', phone: '+91 21098 76543', department: 'Finance', designation: 'Finance Manager', employee_id: 'EMP008', join_date: '2019-11-12', location: 'Mumbai', manager: 'Anjali Singh', status: 'active', avatar: 'SG', salary: 140000, ctc: 2200000 },
  { id: 'e9', name: 'Meera Pillai', email: 'meera.pillai@company.com', phone: '+91 10987 65432', department: 'Marketing', designation: 'Marketing Specialist', employee_id: 'EMP009', join_date: '2022-03-08', location: 'Pune', manager: 'Arjun Mehta', status: 'active', avatar: 'MP', salary: 75000, ctc: 1150000 },
  { id: 'e10', name: 'Rohan Joshi', email: 'rohan.joshi@company.com', phone: '+91 99876 54321', department: 'Engineering', designation: 'DevOps Engineer', employee_id: 'EMP010', join_date: '2021-11-01', location: 'Bangalore', manager: 'Rahul Verma', status: 'inactive', avatar: 'RJ', salary: 105000, ctc: 1650000 },
];

const appUsers = [
  { id: 'u_admin', employee_id_ref: null, name: 'Super Admin', email: 'admin@company.com', password: 'Admin@123', role: 'admin', department: 'Administration', designation: 'System Administrator', avatar: 'SA', active: true },
  { id: 'u_e5', employee_id_ref: 'EMP005', name: 'Deepika Reddy', email: 'deepika.reddy@company.com', password: 'HR@123', role: 'hr_manager', department: 'HR', designation: 'HR Manager', avatar: 'DR', active: true },
  { id: 'u_e1', employee_id_ref: 'EMP001', name: 'Priya Sharma', email: 'priya.sharma@company.com', password: 'Pass@123', role: 'employee', department: 'Engineering', designation: 'Senior Software Engineer', avatar: 'PS', active: true },
  { id: 'u_e2', employee_id_ref: 'EMP002', name: 'Rahul Verma', email: 'rahul.verma@company.com', password: 'Pass@123', role: 'employee', department: 'Engineering', designation: 'Engineering Manager', avatar: 'RV', active: true },
  { id: 'u_e3', employee_id_ref: 'EMP003', name: 'Anjali Singh', email: 'anjali.singh@company.com', password: 'Pass@123', role: 'employee', department: 'Product', designation: 'VP of Product', avatar: 'AS', active: true },
  { id: 'u_e4', employee_id_ref: 'EMP004', name: 'Vikram Nair', email: 'vikram.nair@company.com', password: 'Pass@123', role: 'employee', department: 'Design', designation: 'UI/UX Designer', avatar: 'VN', active: true },
  { id: 'u_e6', employee_id_ref: 'EMP006', name: 'Arjun Mehta', email: 'arjun.mehta@company.com', password: 'Pass@123', role: 'employee', department: 'Sales', designation: 'Sales Lead', avatar: 'AM', active: true },
  { id: 'u_e7', employee_id_ref: 'EMP007', name: 'Kavya Iyer', email: 'kavya.iyer@company.com', password: 'Pass@123', role: 'employee', department: 'Engineering', designation: 'Software Engineer', avatar: 'KI', active: true },
  { id: 'u_e8', employee_id_ref: 'EMP008', name: 'Sanjay Gupta', email: 'sanjay.gupta@company.com', password: 'Pass@123', role: 'employee', department: 'Finance', designation: 'Finance Manager', avatar: 'SG', active: true },
  { id: 'u_e9', employee_id_ref: 'EMP009', name: 'Meera Pillai', email: 'meera.pillai@company.com', password: 'Pass@123', role: 'employee', department: 'Marketing', designation: 'Marketing Specialist', avatar: 'MP', active: true },
  { id: 'u_e10', employee_id_ref: 'EMP010', name: 'Rohan Joshi', email: 'rohan.joshi@company.com', password: 'Pass@123', role: 'employee', department: 'Engineering', designation: 'DevOps Engineer', avatar: 'RJ', active: false },
];

function generateAttendance(employeeId: string) {
  const records = [];
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  for (let day = 1; day <= 21; day++) {
    const date = new Date(year, month, day);
    const dow = date.getDay();
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (dow === 0 || dow === 6) {
      records.push({ employee_id: employeeId, date: dateStr, check_in: null, check_out: null, status: 'weekend', total_hours: 0 });
    } else {
      const rand = Math.random();
      if (rand < 0.05) {
        records.push({ employee_id: employeeId, date: dateStr, check_in: null, check_out: null, status: 'absent', total_hours: 0 });
      } else if (rand < 0.12) {
        records.push({ employee_id: employeeId, date: dateStr, check_in: '10:15', check_out: '19:00', status: 'late', total_hours: 8.75 });
      } else {
        records.push({ employee_id: employeeId, date: dateStr, check_in: '09:00', check_out: '18:00', status: 'present', total_hours: parseFloat((8 + Math.random() * 2).toFixed(1)) });
      }
    }
  }
  return records;
}

const leaveRequests = [
  { id: 'l1', employee_id: 'e1', employee_name: 'Priya Sharma', type: 'casual', from_date: '2026-04-25', to_date: '2026-04-25', days: 1, reason: 'Personal work', status: 'pending', applied_on: '2026-04-20' },
  { id: 'l2', employee_id: 'e7', employee_name: 'Kavya Iyer', type: 'sick', from_date: '2026-04-22', to_date: '2026-04-23', days: 2, reason: 'Fever and cold', status: 'approved', applied_on: '2026-04-21' },
  { id: 'l3', employee_id: 'e4', employee_name: 'Vikram Nair', type: 'earned', from_date: '2026-05-01', to_date: '2026-05-05', days: 5, reason: 'Family vacation', status: 'pending', applied_on: '2026-04-19' },
  { id: 'l4', employee_id: 'e6', employee_name: 'Arjun Mehta', type: 'casual', from_date: '2026-04-18', to_date: '2026-04-18', days: 1, reason: 'Doctor appointment', status: 'approved', applied_on: '2026-04-17' },
  { id: 'l5', employee_id: 'e9', employee_name: 'Meera Pillai', type: 'sick', from_date: '2026-04-15', to_date: '2026-04-16', days: 2, reason: 'Not feeling well', status: 'rejected', applied_on: '2026-04-14' },
  { id: 'l6', employee_id: 'e2', employee_name: 'Rahul Verma', type: 'earned', from_date: '2026-05-10', to_date: '2026-05-15', days: 6, reason: 'Annual leave', status: 'pending', applied_on: '2026-04-20' },
  { id: 'l7', employee_id: 'e5', employee_name: 'Deepika Reddy', type: 'casual', from_date: '2026-04-28', to_date: '2026-04-28', days: 1, reason: 'Personal errand', status: 'approved', applied_on: '2026-04-20' },
];

const leaveBalances = [
  { employee_id: 'e1', casual: 10, sick: 7, earned: 15 },
  { employee_id: 'e2', casual: 8, sick: 6, earned: 20 },
  { employee_id: 'e3', casual: 12, sick: 10, earned: 18 },
  { employee_id: 'e4', casual: 9, sick: 7, earned: 12 },
  { employee_id: 'e5', casual: 11, sick: 8, earned: 16 },
  { employee_id: 'e6', casual: 7, sick: 5, earned: 14 },
  { employee_id: 'e7', casual: 10, sick: 7, earned: 8 },
  { employee_id: 'e8', casual: 9, sick: 6, earned: 22 },
  { employee_id: 'e9', casual: 10, sick: 7, earned: 10 },
  { employee_id: 'e10', casual: 6, sick: 4, earned: 11 },
];

const goals = [
  { id: 'g1', employee_id: 'e1', title: 'Migrate auth service to OAuth2', description: 'Complete migration of authentication service', due_date: '2026-06-30', progress: 65, status: 'on-track' },
  { id: 'g2', employee_id: 'e1', title: 'Improve API response time by 30%', description: 'Optimize database queries and caching', due_date: '2026-05-31', progress: 40, status: 'at-risk' },
  { id: 'g3', employee_id: 'e2', title: 'Hire 3 senior engineers', description: 'Complete hiring pipeline for Q2', due_date: '2026-06-30', progress: 33, status: 'on-track' },
  { id: 'g4', employee_id: 'e4', title: 'Redesign onboarding flow', description: 'Improve user onboarding experience', due_date: '2026-05-15', progress: 80, status: 'on-track' },
  { id: 'g5', employee_id: 'e7', title: 'Learn and implement GraphQL', description: 'Upskill in GraphQL for new API layer', due_date: '2026-07-31', progress: 20, status: 'not-started' },
  { id: 'g6', employee_id: 'e9', title: 'Launch Q2 marketing campaign', description: 'Execute Q2 content and social campaign', due_date: '2026-04-30', progress: 100, status: 'completed' },
];

const reviews = [
  { id: 'r1', employee_id: 'e1', reviewer_id: 'e2', period: 'H2 2025', rating: 4.5, feedback: 'Priya has consistently delivered high-quality work and shown excellent problem-solving skills.', review_date: '2026-01-15' },
  { id: 'r2', employee_id: 'e7', reviewer_id: 'e2', period: 'H2 2025', rating: 3.8, feedback: 'Kavya has shown good progress. Needs to improve on communication and documentation.', review_date: '2026-01-15' },
  { id: 'r3', employee_id: 'e4', reviewer_id: 'e3', period: 'H2 2025', rating: 4.2, feedback: 'Vikram brings creative energy to the team. Designs are consistently well-received.', review_date: '2026-01-16' },
];

async function seed() {
  console.log('📦 Running schema...');
  await sql`CREATE TABLE IF NOT EXISTS employees (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, phone TEXT, department TEXT, designation TEXT, employee_id TEXT UNIQUE NOT NULL, join_date DATE, location TEXT, manager TEXT, status TEXT DEFAULT 'active', avatar TEXT, salary NUMERIC, ctc NUMERIC, created_at TIMESTAMPTZ DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS app_users (id TEXT PRIMARY KEY, employee_id_ref TEXT, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL, department TEXT, designation TEXT, avatar TEXT, active BOOLEAN DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS attendance_records (id SERIAL PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE, date DATE NOT NULL, check_in TEXT, check_out TEXT, status TEXT NOT NULL, total_hours NUMERIC DEFAULT 0, UNIQUE(employee_id, date))`;
  await sql`CREATE TABLE IF NOT EXISTS leave_requests (id TEXT PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE, employee_name TEXT NOT NULL, type TEXT NOT NULL, from_date DATE NOT NULL, to_date DATE NOT NULL, days INTEGER NOT NULL, reason TEXT, status TEXT DEFAULT 'pending', applied_on DATE DEFAULT CURRENT_DATE, created_at TIMESTAMPTZ DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS leave_balances (id SERIAL PRIMARY KEY, employee_id TEXT UNIQUE NOT NULL REFERENCES employees(id) ON DELETE CASCADE, casual INTEGER DEFAULT 10, sick INTEGER DEFAULT 7, earned INTEGER DEFAULT 15)`;
  await sql`CREATE TABLE IF NOT EXISTS payroll_records (id SERIAL PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE, month TEXT NOT NULL, year INTEGER NOT NULL, basic NUMERIC, hra NUMERIC, special_allowance NUMERIC, provident_fund NUMERIC, professional_tax NUMERIC, income_tax NUMERIC, gross_pay NUMERIC, net_pay NUMERIC, status TEXT DEFAULT 'paid', UNIQUE(employee_id, month, year))`;
  await sql`CREATE TABLE IF NOT EXISTS goals (id TEXT PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT, due_date DATE, progress INTEGER DEFAULT 0, status TEXT DEFAULT 'not-started', created_at TIMESTAMPTZ DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS reviews (id TEXT PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE, reviewer_id TEXT NOT NULL, period TEXT, rating NUMERIC, feedback TEXT, review_date DATE, created_at TIMESTAMPTZ DEFAULT NOW())`;
  console.log('✓ Tables ready');

  console.log('🌱 Seeding employees...');
  for (const emp of employees) {
    await sql`
      INSERT INTO employees (id, name, email, phone, department, designation, employee_id, join_date, location, manager, status, avatar, salary, ctc)
      VALUES (${emp.id}, ${emp.name}, ${emp.email}, ${emp.phone}, ${emp.department}, ${emp.designation}, ${emp.employee_id}, ${emp.join_date}, ${emp.location}, ${emp.manager}, ${emp.status}, ${emp.avatar}, ${emp.salary}, ${emp.ctc})
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name, email = EXCLUDED.email, salary = EXCLUDED.salary, status = EXCLUDED.status
    `;
  }

  console.log('👤 Seeding app users...');
  for (const u of appUsers) {
    await sql`
      INSERT INTO app_users (id, employee_id_ref, name, email, password, role, department, designation, avatar, active)
      VALUES (${u.id}, ${u.employee_id_ref}, ${u.name}, ${u.email}, ${u.password}, ${u.role}, ${u.department}, ${u.designation}, ${u.avatar}, ${u.active})
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name, email = EXCLUDED.email, password = EXCLUDED.password, role = EXCLUDED.role, active = EXCLUDED.active
    `;
  }

  console.log('📅 Seeding attendance...');
  for (const emp of employees) {
    const records = generateAttendance(emp.id);
    for (const r of records) {
      await sql`
        INSERT INTO attendance_records (employee_id, date, check_in, check_out, status, total_hours)
        VALUES (${r.employee_id}, ${r.date}, ${r.check_in}, ${r.check_out}, ${r.status}, ${r.total_hours})
        ON CONFLICT (employee_id, date) DO NOTHING
      `;
    }
  }

  console.log('🏖️ Seeding leave requests...');
  for (const l of leaveRequests) {
    await sql`
      INSERT INTO leave_requests (id, employee_id, employee_name, type, from_date, to_date, days, reason, status, applied_on)
      VALUES (${l.id}, ${l.employee_id}, ${l.employee_name}, ${l.type}, ${l.from_date}, ${l.to_date}, ${l.days}, ${l.reason}, ${l.status}, ${l.applied_on})
      ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status
    `;
  }

  console.log('⚖️ Seeding leave balances...');
  for (const b of leaveBalances) {
    await sql`
      INSERT INTO leave_balances (employee_id, casual, sick, earned)
      VALUES (${b.employee_id}, ${b.casual}, ${b.sick}, ${b.earned})
      ON CONFLICT (employee_id) DO NOTHING
    `;
  }

  console.log('💰 Seeding payroll...');
  for (const emp of employees) {
    const basic = Math.round(emp.salary * 0.5);
    const hra = Math.round(emp.salary * 0.2);
    const special = Math.round(emp.salary * 0.3);
    const pf = Math.round(emp.salary * 0.12);
    const pt = 200;
    const tax = Math.round(emp.salary * 0.1);
    const net = Math.round(emp.salary - pf - pt - tax);
    await sql`
      INSERT INTO payroll_records (employee_id, month, year, basic, hra, special_allowance, provident_fund, professional_tax, income_tax, gross_pay, net_pay, status)
      VALUES (${emp.id}, 'March', 2026, ${basic}, ${hra}, ${special}, ${pf}, ${pt}, ${tax}, ${emp.salary}, ${net}, 'paid')
      ON CONFLICT (employee_id, month, year) DO NOTHING
    `;
  }

  console.log('🎯 Seeding goals...');
  for (const g of goals) {
    await sql`
      INSERT INTO goals (id, employee_id, title, description, due_date, progress, status)
      VALUES (${g.id}, ${g.employee_id}, ${g.title}, ${g.description}, ${g.due_date}, ${g.progress}, ${g.status})
      ON CONFLICT (id) DO UPDATE SET progress = EXCLUDED.progress, status = EXCLUDED.status
    `;
  }

  console.log('⭐ Seeding reviews...');
  for (const r of reviews) {
    await sql`
      INSERT INTO reviews (id, employee_id, reviewer_id, period, rating, feedback, review_date)
      VALUES (${r.id}, ${r.employee_id}, ${r.reviewer_id}, ${r.period}, ${r.rating}, ${r.feedback}, ${r.review_date})
      ON CONFLICT (id) DO NOTHING
    `;
  }

  console.log('✅ Database seeded successfully!');
  process.exit(0);
}

seed().catch(err => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});

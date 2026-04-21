-- HR Management Schema for Neon PostgreSQL

CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  department TEXT,
  designation TEXT,
  employee_id TEXT UNIQUE NOT NULL,
  join_date DATE,
  location TEXT,
  manager TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  avatar TEXT,
  salary NUMERIC,
  ctc NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_users (
  id TEXT PRIMARY KEY,
  employee_id_ref TEXT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'hr_manager', 'employee')),
  department TEXT,
  designation TEXT,
  avatar TEXT,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS attendance_records (
  id SERIAL PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  check_in TEXT,
  check_out TEXT,
  status TEXT NOT NULL CHECK (status IN ('present','absent','late','half-day','weekend','holiday')),
  total_hours NUMERIC DEFAULT 0,
  UNIQUE(employee_id, date)
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  employee_name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('casual','sick','earned','maternity','paternity')),
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  days INTEGER NOT NULL,
  reason TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  applied_on DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS leave_balances (
  id SERIAL PRIMARY KEY,
  employee_id TEXT UNIQUE NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  casual INTEGER DEFAULT 10,
  sick INTEGER DEFAULT 7,
  earned INTEGER DEFAULT 15
);

CREATE TABLE IF NOT EXISTS payroll_records (
  id SERIAL PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  year INTEGER NOT NULL,
  basic NUMERIC,
  hra NUMERIC,
  special_allowance NUMERIC,
  provident_fund NUMERIC,
  professional_tax NUMERIC,
  income_tax NUMERIC,
  gross_pay NUMERIC,
  net_pay NUMERIC,
  status TEXT DEFAULT 'paid' CHECK (status IN ('paid','pending')),
  UNIQUE(employee_id, month, year)
);

CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  due_date DATE,
  progress INTEGER DEFAULT 0,
  status TEXT DEFAULT 'not-started' CHECK (status IN ('on-track','at-risk','completed','not-started')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  reviewer_id TEXT NOT NULL,
  period TEXT,
  rating NUMERIC,
  feedback TEXT,
  review_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

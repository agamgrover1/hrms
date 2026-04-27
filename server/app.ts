import express from 'express';
import cors from 'cors';
import { sql } from './db';
import authRoutes from './routes/auth';
import employeeRoutes from './routes/employees';
import attendanceRoutes from './routes/attendance';
import leaveRoutes from './routes/leave';
import payrollRoutes from './routes/payroll';
import performanceRoutes from './routes/performance';
import userRoutes from './routes/users';
import notificationRoutes from './routes/notifications';
import configRoutes from './routes/config';
import wfhRoutes from './routes/wfh';

// Add audit columns to leave_requests if they don't exist yet
(async () => {
  try {
    await sql`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS manager_name VARCHAR(200)`;
    await sql`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS manager_rejection_reason TEXT`;
    await sql`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS hr_actioner_name VARCHAR(200)`;
    await sql`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS hr_actioned_at TIMESTAMPTZ`;
    await sql`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS rejection_reason TEXT`;
    await sql`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS cancelled_by VARCHAR(200)`;
    await sql`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ`;
    await sql`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS cancellation_reason TEXT`;
  } catch { /* columns already exist */ }
})();

const app = express();

const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',')
  : ['http://localhost:3030', 'http://localhost:3031'];

app.use(cors({
  origin: (origin, cb) => {
    // Allow same-origin (Vercel), localhost, or explicitly listed origins
    if (!origin || allowedOrigins.includes(origin) || origin.endsWith('.vercel.app')) {
      cb(null, true);
    } else {
      cb(new Error('Not allowed by CORS'));
    }
  },
}));
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/leave', leaveRoutes);
app.use('/api/payroll', payrollRoutes);
app.use('/api/performance', performanceRoutes);
app.use('/api/users', userRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/config', configRoutes);
app.use('/api/wfh', wfhRoutes);

app.get('/api/health', (_, res) => res.json({ status: 'ok' }));

export default app;

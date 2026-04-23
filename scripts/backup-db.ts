/**
 * DB backup via the running backend API (avoids IPv6 Neon issue in plain Node).
 * Run:  npx tsx scripts/backup-db.ts
 * Requires:  npm run server  (backend on :3001)
 */
import fs from 'fs';
import path from 'path';

const BASE = 'http://localhost:3001/api';

async function get(path: string) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

function escapeVal(v: any): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

function toInserts(table: string, rows: any[]): string[] {
  if (!rows.length) return [`-- ${table}: empty`];
  const cols = Object.keys(rows[0]);
  return [
    `DELETE FROM ${table};`,
    ...rows.map(row => {
      const vals = cols.map(c => escapeVal(row[c])).join(', ');
      return `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${vals});`;
    }),
  ];
}

async function backup() {
  const backupDir = '/Users/agamgrover/Claude Code/keka-hr-clone-backups';
  fs.mkdirSync(backupDir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outFile = path.join(backupDir, `db-backup-${ts}.sql`);

  const lines: string[] = [
    `-- Digital Leap HRMS — Full Database Backup`,
    `-- Created : ${new Date().toISOString()}`,
    `-- Restore : psql <connection_string> -f <this_file>`,
    '',
  ];

  // Fetch all employees first so we can iterate per-employee endpoints
  const employees: any[] = await get('/employees');
  const users: any[]     = await get('/users');

  // Collect per-employee data
  const attendance: any[]   = [];
  const leaveReqs: any[]    = [];
  const payroll: any[]      = [];
  const monthlyPerf: any[]  = [];
  const perfNotes: any[]    = [];
  const appraisals: any[]   = [];
  const leaveBalances: any[]= [];

  for (const emp of employees) {
    const eid = emp.id;
    try { attendance.push(...await get(`/attendance?employee_id=${eid}`)); } catch {}
    try { leaveReqs.push(...await get(`/leave/requests?employee_id=${eid}`)); } catch {}
    try { payroll.push(...await get(`/payroll/${eid}`)); } catch {}
    try { monthlyPerf.push(...await get(`/performance/monthly?employee_id=${eid}`)); } catch {}
    try { perfNotes.push(...await get(`/performance/notes?employee_id=${eid}`)); } catch {}
    try {
      const ap = await get(`/performance/appraisal-goals?employee_id=${eid}`);
      appraisals.push(...ap);
    } catch {}
    try { leaveBalances.push(await get(`/leave/balances/${eid}`)); } catch {}
  }

  // Per-user notifications
  const notifications: any[] = [];
  for (const u of users) {
    try { notifications.push(...await get(`/notifications?user_id=${u.id}`)); } catch {}
  }

  const tables: Array<{ name: string; rows: any[] }> = [
    { name: 'employees',          rows: employees },
    { name: 'users',              rows: users },
    { name: 'leave_balances',     rows: leaveBalances },
    { name: 'attendance_records', rows: attendance },
    { name: 'leave_requests',     rows: leaveReqs },
    { name: 'payroll',            rows: payroll },
    { name: 'monthly_performance',rows: monthlyPerf },
    { name: 'performance_notes',  rows: perfNotes },
    { name: 'appraisal_goals',    rows: appraisals },
    { name: 'notifications',      rows: notifications },
  ];

  for (const { name, rows } of tables) {
    lines.push(`-- ── ${name} (${rows.length} rows) ${'─'.repeat(40 - name.length)}`);
    lines.push(...toInserts(name, rows));
    lines.push('');
    console.log(`  ✓  ${name.padEnd(22)} ${rows.length} rows`);
  }

  fs.writeFileSync(outFile, lines.join('\n'), 'utf8');
  const kb = (fs.statSync(outFile).size / 1024).toFixed(1);
  console.log(`\n✅  Backup saved → ${outFile}`);
  console.log(`    Size: ${kb} KB`);
}

backup().catch(err => { console.error('\n❌ Backup failed:', err.message); process.exit(1); });

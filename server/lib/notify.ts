import { sql } from '../db';

export async function notifyUser(userId: string, type: string, title: string, body?: string) {
  try {
    await sql`INSERT INTO notifications (user_id, type, title, body) VALUES (${userId}, ${type}, ${title}, ${body ?? null})`;
  } catch { /* non-fatal — never block the main operation */ }
}

export async function notifyAdminsAndHR(type: string, title: string, body?: string) {
  try {
    const users = await sql`SELECT id FROM app_users WHERE role IN ('admin', 'hr_manager') AND active = TRUE`;
    await Promise.all((users as any[]).map(u => notifyUser(u.id, type, title, body)));
  } catch { /* non-fatal */ }
}

// Notify the app_user linked to a given employees.id (DB PK)
export async function notifyEmployeeUser(employeeDbId: string, type: string, title: string, body?: string) {
  try {
    const users = await sql`
      SELECT u.id FROM app_users u
      JOIN employees e ON e.employee_id = u.employee_id_ref
      WHERE e.id = ${employeeDbId}
    `;
    await Promise.all((users as any[]).map(u => notifyUser(u.id, type, title, body)));
  } catch { /* non-fatal */ }
}

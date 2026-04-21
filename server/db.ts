import { neon } from '@neondatabase/serverless';
import 'dotenv/config';

let _sql: ReturnType<typeof neon> | null = null;

function getSql() {
  if (_sql) return _sql;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL environment variable is not set');
  const dbUrl = url
    .replace(/[?&]channel_binding=[^&]*/g, '')
    .replace(/[?&]$/, '');
  console.log('[db] Connecting to Neon:', dbUrl.slice(0, 60) + '...');
  return (_sql = neon(dbUrl));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const sql = ((...a: any[]) => (getSql() as any)(...a)) as ReturnType<typeof neon>;

export async function rawQuery(query: string) {
  const db = getSql();
  return db.unsafe ? db.unsafe(query) : db([query] as unknown as TemplateStringsArray);
}

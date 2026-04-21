import { neon, neonConfig } from '@neondatabase/serverless';
import https from 'https';

// Neon's HTTP endpoint can be intermittently unreachable on some networks.
// Use Node's https module (not undici/fetch) and retry up to 3 times.
function httpsRequest(url: string, init: RequestInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const body = typeof init.body === 'string' ? init.body : '';
    const bodyBuf = Buffer.from(body);
    const rawHeaders = init.headers as Record<string, string> | undefined;
    const headers: Record<string, string> = {
      ...(rawHeaders || {}),
      'Content-Length': String(bodyBuf.length),
    };

    const req = https.request({
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname + urlObj.search,
      method: init.method || 'POST',
      headers,
      timeout: 12000,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf-8');
        resolve({
          ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300,
          status: res.statusCode ?? 0,
          statusText: res.statusMessage ?? '',
          headers: new Headers(res.headers as Record<string, string>),
          json: () => Promise.resolve(JSON.parse(text)),
          text: () => Promise.resolve(text),
        } as Response);
      });
    });

    req.on('timeout', () => { req.destroy(new Error('HTTPS request timeout')); });
    req.on('error', reject);
    if (bodyBuf.length) req.write(bodyBuf);
    req.end();
  });
}

async function fetchWithRetry(url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const urlStr = url.toString();
  const reqInit = init || {};
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await httpsRequest(urlStr, reqInit);
    } catch (err) {
      lastErr = err;
      if (attempt < 3) {
        const delay = attempt * 1500;
        console.warn(`[db] Neon request failed (attempt ${attempt}/3), retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

neonConfig.fetchFunction = fetchWithRetry;

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

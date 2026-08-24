import { api } from './api';

// Thin client for the VPS-hosted mail service. Every call routes
// through a short-lived JWT minted by the HRMS backend
// (/api/me/mail-token). The token is cached in memory and refreshed
// when a 401 comes back, so callers never think about it.

interface TokenBundle {
  token: string;
  api_base: string;
  expires_at: number;   // epoch ms
}
let cached: TokenBundle | null = null;

async function getToken(force = false): Promise<TokenBundle> {
  if (!force && cached && cached.expires_at > Date.now() + 30_000) return cached;
  const r = await api.getMailToken();
  cached = {
    token: r.token,
    api_base: r.api_base,
    expires_at: Date.now() + r.expires_in * 1000,
  };
  return cached;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let tb = await getToken();
  const doFetch = async (t: TokenBundle) => fetch(`${t.api_base}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${t.token}`,
      'Content-Type':  'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let res = await doFetch(tb);
  if (res.status === 401) {
    // Cache miss / expired — refresh once and retry.
    tb = await getToken(true);
    res = await doFetch(tb);
  }
  const text = await res.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
  if (!res.ok) {
    const err = new Error(data?.error ?? `Mail service returned ${res.status}`) as any;
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data as T;
}

export interface MailAccount {
  id: string;
  user_id: string;
  email_address: string;
  display_name: string | null;
  imap_host: string; imap_port: number; imap_secure: boolean;
  smtp_host: string; smtp_port: number; smtp_secure: boolean;
  is_default: boolean;
  last_verified_at: string | null;
  created_at: string;
}
export interface VerifyResult {
  ok: true;
  mailboxes: number;
  total_messages: number;
  smtp_ok: boolean;
}

export interface MailFolder {
  path: string;
  name: string;
  special_use: string | null;
  messages: number;
  unread: number;
}
export interface MailEnvelope {
  uid: number;
  seq: number;
  subject: string;
  from: { name: string; address: string } | null;
  to: Array<{ name: string; address: string }>;
  date: string | null;
  snippet: string;
  flags: string[];
  seen: boolean;
  flagged: boolean;
  answered: boolean;
  size: number;
  has_attachments: boolean;
}
export interface MailMessage {
  uid: number;
  subject: string;
  from: { name: string; address: string } | null;
  to: Array<{ name: string; address: string }>;
  cc: Array<{ name: string; address: string }>;
  date: string | null;
  html: string | null;
  text: string | null;
  attachments: Array<{ index: number; filename: string; content_type: string; size: number; content_id?: string }>;
  flags: string[];
}

// Attachment download URL — includes the JWT as a query param since
// <a download> can't set headers. Token is short-lived (15 min) so
// leakage via referrer/history is bounded.
export async function mailAttachmentUrl(accountId: string, folder: string, uid: number, index: number): Promise<string> {
  const tb = await (async () => {
    // Reuse the token cache inside `call`.
    const r = await (await import('./api')).api.getMailToken();
    return r;
  })();
  return `${tb.api_base}/accounts/${accountId}/folders/${encodeURIComponent(folder)}/messages/${uid}/attachments/${index}?t=${encodeURIComponent(tb.token)}`;
}

export const mailApi = {
  listAccounts: () => call<MailAccount[]>('GET', '/accounts'),
  testAccount: (data: {
    email: string; password: string;
    imap_host?: string; imap_port?: number; imap_secure?: boolean;
    smtp_host?: string; smtp_port?: number; smtp_secure?: boolean;
  }) => call<VerifyResult>('POST', '/accounts/test', data),
  createAccount: (data: {
    email: string; password: string; display_name?: string;
    imap_host?: string; imap_port?: number; imap_secure?: boolean;
    smtp_host?: string; smtp_port?: number; smtp_secure?: boolean;
    is_default?: boolean;
  }) => call<VerifyResult & { account: MailAccount }>('POST', '/accounts', data),
  setDefault: (id: string) => call<{ ok: true }>('PATCH', `/accounts/${id}`, { is_default: true }),
  deleteAccount: (id: string) => call<{ ok: boolean }>('DELETE', `/accounts/${id}`),

  // ── M2 inbox reader ────────────────────────────────────────────
  listFolders: (accountId: string) =>
    call<MailFolder[]>('GET', `/accounts/${accountId}/folders`),
  listMessages: (accountId: string, folder: string, opts?: { limit?: number; before_uid?: number }) => {
    const q = new URLSearchParams();
    if (opts?.limit) q.set('limit', String(opts.limit));
    if (opts?.before_uid) q.set('before_uid', String(opts.before_uid));
    return call<{ messages: MailEnvelope[]; total: number; unread: number }>(
      'GET', `/accounts/${accountId}/folders/${encodeURIComponent(folder)}/messages${q.toString() ? '?' + q : ''}`
    );
  },
  fetchMessage: (accountId: string, folder: string, uid: number) =>
    call<MailMessage>('GET', `/accounts/${accountId}/folders/${encodeURIComponent(folder)}/messages/${uid}`),
  markRead: (accountId: string, folder: string, uid: number, seen: boolean) =>
    call<{ ok: true; seen: boolean }>('POST', `/accounts/${accountId}/folders/${encodeURIComponent(folder)}/messages/${uid}/read`, { seen }),
};

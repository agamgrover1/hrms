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

// Full-message cache keyed by `${accountId}|${folder}|${uid}`. Bodies
// don't change once received, so we only ever pay the IMAP hop once.
// Move flows evict the source entry; delete flows evict too. On a
// forced reload the caller passes `{fresh: true}`.
const messageCache = new Map<string, MailMessage>();

// Module-scope caches for the *page shell* — accounts, folders per
// account, and the default (limit=40) envelope list per folder. The
// Mail page unmounts when the user navigates away and remounts when
// they come back; without these caches, that remount cost a full
// round-trip to the VPS for every list. Peek returns instantly for
// hydration; the caller still fires a background refresh so IDLE-
// arrived mail shows up. On paginated / non-default queries we
// bypass the cache entirely.
let accountsCache: MailAccount[] | null = null;
const foldersCache = new Map<string, MailFolder[]>();
interface ListSlice { messages: MailEnvelope[]; total: number; unread: number }
const listCache = new Map<string, ListSlice>();
const listKey = (accountId: string, folder: string) => `${accountId}|${folder}`;

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

export interface MailTemplate {
  id: string;
  user_id: string;
  name: string;
  subject: string | null;
  body: string;
  created_at: string;
  updated_at: string;
}
export interface MailFilter {
  id: string;
  account_id: string;
  name: string;
  match_field: 'from' | 'to' | 'subject' | 'body';
  match_op: 'contains' | 'equals' | 'starts_with';
  match_value: string;
  action: 'move' | 'delete' | 'seen' | 'flag';
  action_target: string | null;
  enabled: boolean;
  sort_order: number;
  created_at: string;
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
  peekAccounts: (): MailAccount[] | null => accountsCache,
  peekFolders: (accountId: string): MailFolder[] | null => foldersCache.get(accountId) ?? null,
  peekList: (accountId: string, folder: string): ListSlice | null => listCache.get(listKey(accountId, folder)) ?? null,

  listAccounts: async () => {
    const r = await call<MailAccount[]>('GET', '/accounts');
    accountsCache = r;
    return r;
  },
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
  listFolders: async (accountId: string) => {
    const r = await call<MailFolder[]>('GET', `/accounts/${accountId}/folders`);
    foldersCache.set(accountId, r);
    return r;
  },
  listMessages: async (accountId: string, folder: string, opts?: { limit?: number; before_uid?: number }) => {
    const q = new URLSearchParams();
    if (opts?.limit) q.set('limit', String(opts.limit));
    if (opts?.before_uid) q.set('before_uid', String(opts.before_uid));
    const r = await call<ListSlice>(
      'GET', `/accounts/${accountId}/folders/${encodeURIComponent(folder)}/messages${q.toString() ? '?' + q : ''}`
    );
    // Only cache the default first-page view; pagination + explicit
    // before_uid queries are transient and not worth caching.
    if (!opts?.before_uid) listCache.set(listKey(accountId, folder), r);
    return r;
  },
  fetchMessage: async (accountId: string, folder: string, uid: number, opts?: { fresh?: boolean }): Promise<MailMessage> => {
    // Message bodies are immutable once received, so cache by
    // (account, folder, uid) and short-circuit re-opens. Only bypass
    // when the caller explicitly asks for a fresh fetch (Refresh
    // button in the reader, or after a "replace draft" edit).
    const k = `${accountId}|${folder}|${uid}`;
    if (!opts?.fresh) {
      const hit = messageCache.get(k);
      if (hit) return hit;
    }
    const msg = await call<MailMessage>('GET', `/accounts/${accountId}/folders/${encodeURIComponent(folder)}/messages/${uid}`);
    // Simple bounded LRU: newest to end, evict oldest when >200.
    messageCache.delete(k);
    messageCache.set(k, msg);
    if (messageCache.size > 200) {
      const oldest = messageCache.keys().next().value;
      if (oldest) messageCache.delete(oldest);
    }
    return msg;
  },
  peekMessage: (accountId: string, folder: string, uid: number): MailMessage | null => {
    return messageCache.get(`${accountId}|${folder}|${uid}`) ?? null;
  },
  evictMessage: (accountId: string, folder: string, uid: number) => {
    messageCache.delete(`${accountId}|${folder}|${uid}`);
  },
  evictFolder: (accountId: string, folder: string) => {
    const prefix = `${accountId}|${folder}|`;
    for (const k of Array.from(messageCache.keys())) {
      if (k.startsWith(prefix)) messageCache.delete(k);
    }
  },
  markRead: (accountId: string, folder: string, uid: number, seen: boolean) =>
    call<{ ok: true; seen: boolean }>('POST', `/accounts/${accountId}/folders/${encodeURIComponent(folder)}/messages/${uid}/read`, { seen }),

  // ── M4 ─────────────────────────────────────────────────────────
  searchMessages: (accountId: string, folder: string, q: string, limit = 60) => {
    const qs = new URLSearchParams({ q, limit: String(limit) });
    return call<{ messages: MailEnvelope[]; total: number; unread: number }>(
      'GET', `/accounts/${accountId}/folders/${encodeURIComponent(folder)}/search?${qs}`
    );
  },
  moveMessage: (accountId: string, folder: string, uid: number, destination: string) =>
    call<{ ok: true }>('POST', `/accounts/${accountId}/folders/${encodeURIComponent(folder)}/messages/${uid}/move`, { destination }),
  deleteMessage: (accountId: string, folder: string, uid: number) =>
    call<{ ok: true; purged: boolean }>('DELETE', `/accounts/${accountId}/folders/${encodeURIComponent(folder)}/messages/${uid}`),
  saveDraft: (accountId: string, data: {
    from_name?: string;
    to: string[]; cc?: string[]; bcc?: string[];
    subject: string; text?: string; html?: string;
    in_reply_to?: string; references?: string[];
    replaces_uid?: number;
  }) => call<{ ok: true; uid: number; folder: string }>('POST', `/accounts/${accountId}/drafts`, data),

  // ── M6 ─────────────────────────────────────────────────────────
  getSignature: (accountId: string) =>
    call<{ account_id: string; body_text: string; body_html: string; updated_at: string }>('GET', `/accounts/${accountId}/signature`),
  saveSignature: (accountId: string, body_text: string, body_html: string) =>
    call<any>('PUT', `/accounts/${accountId}/signature`, { body_text, body_html }),

  listTemplates: () =>
    call<MailTemplate[]>('GET', `/templates`),
  createTemplate: (data: { name: string; subject?: string | null; body: string }) =>
    call<MailTemplate>('POST', `/templates`, data),
  patchTemplate: (id: string, patch: Partial<{ name: string; subject: string | null; body: string }>) =>
    call<MailTemplate>('PATCH', `/templates/${id}`, patch),
  deleteTemplate: (id: string) =>
    call<{ ok: boolean }>('DELETE', `/templates/${id}`),

  listFilters: (accountId: string) =>
    call<MailFilter[]>('GET', `/accounts/${accountId}/filters`),
  createFilter: (accountId: string, data: Omit<MailFilter, 'id' | 'account_id' | 'created_at'>) =>
    call<MailFilter>('POST', `/accounts/${accountId}/filters`, data),
  patchFilter: (accountId: string, id: string, patch: Partial<Omit<MailFilter, 'id' | 'account_id' | 'created_at'>>) =>
    call<MailFilter>('PATCH', `/accounts/${accountId}/filters/${id}`, patch),
  deleteFilter: (accountId: string, id: string) =>
    call<{ ok: boolean }>('DELETE', `/accounts/${accountId}/filters/${id}`),

  markSpam: (accountId: string, folder: string, uid: number) =>
    call<{ ok: true; moved_to: string }>('POST', `/accounts/${accountId}/folders/${encodeURIComponent(folder)}/messages/${uid}/spam`),

  // ── M3 send ─────────────────────────────────────────────────────
  // Multipart because attachments would blow past a JSON body; the
  // metadata rides as a JSON string in the `payload` field.
  sendMessage: async (accountId: string, data: {
    from_name?: string;
    to: string[]; cc?: string[]; bcc?: string[];
    subject: string;
    text?: string; html?: string;
    in_reply_to?: string; references?: string[];
    attachments?: File[];
  }): Promise<{ ok: true; message_id: string; appended: boolean }> => {
    const tb = await (await import('./api')).api.getMailToken();
    const fd = new FormData();
    const { attachments, ...meta } = data;
    fd.append('payload', JSON.stringify(meta));
    (attachments ?? []).forEach(f => fd.append('attachments', f, f.name));
    const res = await fetch(`${tb.api_base}/accounts/${accountId}/send`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${tb.token}` },
      body: fd,
    });
    const text = await res.text();
    let d: any = {};
    try { d = text ? JSON.parse(text) : {}; } catch { d = { error: text }; }
    if (!res.ok) {
      const err = new Error(d?.error ?? `Send failed (${res.status})`) as any;
      err.status = res.status; err.body = d;
      throw err;
    }
    return d;
  },
};

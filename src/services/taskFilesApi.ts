import { api } from './api';

// Thin client for the VPS files module. Every call routes through a
// short-lived, task-scoped JWT minted by HRMS (`/api/tasks/:id/file-token`)
// and cached in memory. On 401 we mint once and retry.

export interface TaskAttachment {
  id: string;
  filename: string;
  size: number;
  mime: string;
  uploaded_by: string;
  uploaded_by_email: string;
  uploaded_at: string;
}

interface TokenBundle {
  token: string;
  api_base: string;
  expires_at: number;   // epoch ms
}
const tokenCache = new Map<string, TokenBundle>();   // key: taskId

async function getToken(taskId: string, force = false): Promise<TokenBundle> {
  const cached = tokenCache.get(taskId);
  if (!force && cached && cached.expires_at > Date.now() + 30_000) return cached;
  const r = await api.getTaskFileToken(taskId);
  const bundle: TokenBundle = { token: r.token, api_base: r.api_base, expires_at: Date.now() + r.expires_in * 1000 };
  tokenCache.set(taskId, bundle);
  return bundle;
}

async function call<T>(taskId: string, method: string, path: string): Promise<T> {
  let tb = await getToken(taskId);
  const doFetch = async (t: TokenBundle) => fetch(`${t.api_base}${path}`, {
    method,
    headers: { 'Authorization': `Bearer ${t.token}` },
  });
  let res = await doFetch(tb);
  if (res.status === 401) { tb = await getToken(taskId, true); res = await doFetch(tb); }
  const text = await res.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
  if (!res.ok) {
    const err: any = new Error(data?.error ?? `Files service returned ${res.status}`);
    err.status = res.status; err.body = data;
    throw err;
  }
  return data as T;
}

export const taskFilesApi = {
  list: (taskId: string) =>
    call<TaskAttachment[]>(taskId, 'GET', `/files/tasks/${taskId}/attachments`),

  del: (taskId: string, id: string) =>
    call<{ ok: true }>(taskId, 'DELETE', `/files/tasks/${taskId}/attachments/${id}`),

  // Upload uses multipart, so it doesn't go through call<T>.
  upload: async (taskId: string, files: File[]): Promise<TaskAttachment[]> => {
    if (!files.length) return [];
    let tb = await getToken(taskId);
    const fd = new FormData();
    for (const f of files) fd.append('files', f, f.name);
    const doFetch = async (t: TokenBundle) => fetch(`${t.api_base}/files/tasks/${taskId}/attachments`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${t.token}` },
      body: fd,
    });
    let res = await doFetch(tb);
    if (res.status === 401) { tb = await getToken(taskId, true); res = await doFetch(tb); }
    const text = await res.text();
    let data: any = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
    if (!res.ok) {
      const err: any = new Error(data?.error ?? `Upload failed (${res.status})`);
      err.status = res.status; err.body = data;
      throw err;
    }
    return (data.files ?? []) as TaskAttachment[];
  },

  // Signed download URL — includes the JWT in the query string since
  // <a download> can't set headers. Bounded by the 15-min token TTL.
  downloadUrl: async (taskId: string, id: string): Promise<string> => {
    const tb = await getToken(taskId);
    return `${tb.api_base}/files/tasks/${taskId}/attachments/${encodeURIComponent(id)}?t=${encodeURIComponent(tb.token)}`;
  },
};

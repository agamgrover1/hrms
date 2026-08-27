import { api } from '../services/api';

// Web Push helpers
//
// The Web Push flow, once VAPID keys exist on both sides:
//   1. User grants Notification permission (Notification.requestPermission)
//   2. Service worker registration → pushManager.subscribe({ applicationServerKey })
//   3. We POST the resulting subscription to the backend
//   4. Backend fires web-push.sendNotification() on every notifyUser()
//
// The client-side APIs are all under `navigator` / `window` and only
// work over HTTPS (or localhost). Every call here checks for support
// and returns a clean status so the caller can render the right nudge.

export type PushStatus =
  | { supported: false; reason: string }
  | { supported: true; permission: NotificationPermission; subscribed: boolean };

export async function getPushStatus(): Promise<PushStatus> {
  if (typeof window === 'undefined') return { supported: false, reason: 'Not a browser' };
  if (!('serviceWorker' in navigator))   return { supported: false, reason: 'Service workers unavailable' };
  if (!('PushManager' in window))        return { supported: false, reason: 'Push API unavailable' };
  if (!('Notification' in window))       return { supported: false, reason: 'Notifications API unavailable' };
  const permission = Notification.permission;
  let subscribed = false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    subscribed = !!sub;
  } catch { /* if the SW isn't ready yet, treat as not subscribed */ }
  return { supported: true, permission, subscribed };
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - base64.length % 4) % 4);
  const b = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
  return out;
}

export async function subscribeToPush(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const status = await getPushStatus();
    if (!status.supported) return { ok: false, error: status.reason };
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return { ok: false, error: 'Notification permission denied' };

    // Public VAPID key from the server. If it's missing we can't proceed.
    const cfg = await api.getPushVapidKey().catch(() => null);
    if (!cfg?.public_key) return { ok: false, error: 'Server has no VAPID key configured' };

    const reg = await navigator.serviceWorker.ready;
    // Some browsers (Firefox) require the existing subscription to be
    // unsubscribed if applicationServerKey drifts; not our case, but
    // guard against a stale sub.
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(cfg.public_key),
      });
    }
    const json = sub.toJSON() as any;
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
      return { ok: false, error: 'Malformed subscription from browser' };
    }
    await api.savePushSubscription({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Subscribe failed' };
  }
}

export async function unsubscribeFromPush(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    // Tell the backend first so a slow browser unsubscribe doesn't
    // leave us pushing to a dead endpoint in the interim.
    await api.deletePushSubscription(sub.endpoint).catch(() => {});
    await sub.unsubscribe();
  } catch { /* best-effort */ }
}

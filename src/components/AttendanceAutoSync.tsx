import { useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';

// Client-side fallback for environments where Vercel Cron isn't available
// (Hobby tier, local dev, etc.). When an admin or HR session is open, this
// silently fires the biometric sync every 30 minutes. The cron job on
// production handles the same path; this is just belt-and-braces for when
// the platform cron is paused / not running.
//
// Coordinates across tabs via localStorage so opening 3 tabs doesn't trigger
// 3 syncs.

const SYNC_INTERVAL_MS = 30 * 60 * 1000;      // 30 minutes
const LAST_SYNC_KEY = 'digitalleap_hrms_last_biom_sync';
const CHECK_EVERY_MS = 60 * 1000;             // re-check every minute

function readLastSync(): number {
  try { return Number(localStorage.getItem(LAST_SYNC_KEY) || 0); } catch { return 0; }
}
function writeLastSync(ts: number) {
  try { localStorage.setItem(LAST_SYNC_KEY, String(ts)); } catch { /* ignore */ }
}

export default function AttendanceAutoSync() {
  const { user } = useAuth();
  const inflight = useRef(false);

  useEffect(() => {
    const role = user?.role ?? '';
    if (role !== 'admin' && role !== 'hr_manager') return; // only admin/HR drive the sync

    const tick = async () => {
      const last = readLastSync();
      if (Date.now() - last < SYNC_INTERVAL_MS) return;
      if (inflight.current) return;
      // Optimistically stamp BEFORE firing so other tabs don't double-sync.
      writeLastSync(Date.now());
      inflight.current = true;
      try {
        // Default range = yesterday + today on the server side
        await api.syncBiometric(`auto:${user?.name ?? 'client'}`);
      } catch { /* swallow — admin can see failures in /attendance UI */ }
      finally { inflight.current = false; }
    };

    // Run once on mount (covers "came back to the tab after lunch"), then poll
    tick();
    const id = window.setInterval(tick, CHECK_EVERY_MS);
    return () => window.clearInterval(id);
  }, [user?.role, user?.name]);

  return null;
}

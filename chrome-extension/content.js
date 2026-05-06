'use strict';

// ── Activity detector — injected into every browser tab ───────────────────────
// Detects any user interaction (mouse movement, key press, click, scroll) and
// sends a ping to the background service worker. The background aggregates
// these pings into per-minute active/idle counts. We only report PRESENCE of
// activity, never the content of keystrokes or mouse position.

let lastActivityAt = 0;
const DEBOUNCE_MS = 5000; // don't spam messages — 5s minimum between pings

function reportActivity() {
  const now = Date.now();
  if (now - lastActivityAt < DEBOUNCE_MS) return;
  lastActivityAt = now;
  try {
    chrome.runtime.sendMessage({ type: 'USER_ACTIVITY' });
  } catch {
    // Extension may be reloading — safe to ignore
  }
}

// Listen for ANY user interaction in this tab
const EVENTS = ['mousemove', 'mousedown', 'keydown', 'click', 'scroll', 'touchstart'];
EVENTS.forEach(evt => document.addEventListener(evt, reportActivity, { passive: true }));

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'

// ── User-facing semver ────────────────────────────────────────────────────
// Displayed as "v{MAJOR}.{MINOR}" in the sidebar so users can eyeball
// which release they're on without decoding a git hash.
//
//   MAJOR — bumped manually for meaningful platform-level shifts.
//   MINOR — auto = commit count since VERSION_BASELINE_SHA below.
//
// When you decide the next release is a MAJOR (say v2.0):
//   1. Bump VERSION_MAJOR to the next number.
//   2. Update VERSION_BASELINE_SHA to the SHA of the commit that ships
//      that MAJOR (so MINOR resets to 0 relative to it).
// Between major bumps, every deploy auto-increments MINOR by 1 because
// each deploy adds a commit past the baseline.
const VERSION_MAJOR = 1;
const VERSION_BASELINE_SHA = '11fd36e3bb811dd69d67a8fe8f007a1a542af921';

function resolveMinorFromCommits(): number {
  try {
    const out = execSync(`git rev-list --count ${VERSION_BASELINE_SHA}..HEAD`).toString().trim();
    const n = Number(out);
    return Number.isFinite(n) ? n : 0;
  } catch { return 0; }
}
function resolveSemver(): string {
  return `${VERSION_MAJOR}.${resolveMinorFromCommits()}`;
}

// Build-time SHA stamp — separate from the user-facing semver above.
// Used by VersionCheck to detect deploy drift (client polls /api/version
// which returns the same SHA and prompts a refresh when they diverge).
// Priority:
//   1. VERCEL_GIT_COMMIT_SHA — set when Vercel's GitHub integration is on
//      AND "Automatically expose System Environment Variables" is enabled
//   2. VERCEL_DEPLOYMENT_ID — always set at runtime AND build on Vercel,
//      doesn't require the GitHub system-env opt-in
//   3. git rev-parse HEAD — local development fallback
//   4. local-<timestamp> — last-resort if git isn't available
// The `local-` prefix is what VersionCheck uses to skip polling in true
// local dev runs; anything else (real SHA or Vercel deploy ID) drives
// the real comparison.
function resolveBuildVersion(): string {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA;
  if (process.env.VERCEL_DEPLOYMENT_ID)  return process.env.VERCEL_DEPLOYMENT_ID;
  try { return execSync('git rev-parse HEAD').toString().trim(); }
  catch { return `local-${Date.now()}`; }
}

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(resolveBuildVersion()),
    // Human-readable semver ("1.4", "2.0", …) — the string in the sidebar
    // footer that users actually read.
    __APP_SEMVER__: JSON.stringify(resolveSemver()),
    // Build-time UTC ISO stamp. Sidebar pairs it with the semver so
    // anyone can eyeball whether they're on a fresh deploy without
    // opening DevTools.
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    port: 3031,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})

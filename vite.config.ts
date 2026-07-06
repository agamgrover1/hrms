import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'

// Build-time version stamp. Priority:
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
    // Build-time UTC ISO stamp. Sidebar shows the short version in
    // "DL · HRMS · v{shortSha} · deployed 6h ago" so anyone can eyeball
    // whether they're on a fresh deploy without opening DevTools.
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

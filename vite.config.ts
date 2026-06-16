import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'

// Build-time version stamp. Vercel injects VERCEL_GIT_COMMIT_SHA on every
// deploy; local builds fall back to `git rev-parse HEAD` so dev still has
// something stable to compare against. Used by the in-app refresh banner
// to detect when the live deploy has moved past what the tab is running.
function resolveBuildVersion(): string {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA;
  try { return execSync('git rev-parse HEAD').toString().trim(); }
  catch { return `dev-${Date.now()}`; }
}

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(resolveBuildVersion()),
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

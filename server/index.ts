import 'dotenv/config';
import app from './app';
import { runBiometricSync } from './routes/attendance';

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`🚀 Digital Leap HRMS API running on http://localhost:${PORT}`);
  console.log(`🗄️  DB URL: ${process.env.DATABASE_URL?.slice(0, 60)}...`);

  // ── Biometric auto-sync every 5 minutes ──────────────────────────────────
  if (process.env.BIOMETRIC_API_URL) {
    console.log(`🔄 Biometric auto-sync enabled (every 5 min) → ${process.env.BIOMETRIC_API_URL}`);
    setInterval(async () => {
      try {
        const result = await runBiometricSync('auto');
        console.log(`[biometric] Auto-sync OK — updated: ${result.records_updated}, created: ${result.records_created}`);
      } catch (err: any) {
        console.error('[biometric] Auto-sync failed:', err.message);
      }
    }, 5 * 60 * 1000);
  } else {
    console.log('ℹ️  Biometric auto-sync disabled (BIOMETRIC_API_URL not set)');
  }
});

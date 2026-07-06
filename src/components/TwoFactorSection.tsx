import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { ShieldCheck, ShieldOff, ShieldAlert, Copy, Check, X, Download, AlertTriangle } from 'lucide-react';
import { api } from '../services/api';
import { toast } from './Toaster';

// Drop-in Security → Two-factor section. Renders differently based on
// server-reported status:
//   - not enrolled  → "Enable 2FA" call to action + enrollment wizard
//   - enrolled      → status card + Disable button + backup-code counter
//
// Enrollment wizard is 3 steps in one modal:
//   1. Show QR + secret (call POST /auth/2fa/setup)
//   2. User scans, types current 6-digit code (POST /auth/2fa/verify)
//   3. Show one-time backup codes with a copy / download prompt
//
// Disable requires the current 6-digit code so a stolen session alone
// can't turn 2FA off — matches the backend contract.

type Status = {
  enabled: boolean;
  enrolled_at: string | null;
  backup_codes_remaining: number;
} | null;

export default function TwoFactorSection() {
  const [status, setStatus] = useState<Status>(null);
  const [loading, setLoading] = useState(true);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);

  const refresh = () => {
    setLoading(true);
    api.twoFactorStatus()
      .then(setStatus)
      .catch(() => setStatus(null))
      .finally(() => setLoading(false));
  };
  useEffect(refresh, []);

  return (
    <div className="bg-surface rounded-xl-2 border border-outline shadow-elev-1 overflow-hidden">
      <div className="px-5 py-4 border-b border-outline flex items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-base font-bold text-on-surface inline-flex items-center gap-2">
            <ShieldCheck size={16} className="text-accent" />
            Two-factor authentication
          </h3>
          <p className="text-xs text-on-surface-muted mt-0.5">
            Adds a 6-digit code from Google Authenticator, Authy, or 1Password to your sign-in.
            A stolen password alone won't get anyone in.
          </p>
        </div>
      </div>

      <div className="p-5">
        {loading ? (
          <p className="text-sm text-on-surface-subtle">Loading…</p>
        ) : status?.enabled ? (
          <div className="space-y-3">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-success-container/50 border border-success/20">
              <ShieldCheck size={18} className="text-success mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-success">2FA is on</p>
                <p className="text-xs text-on-surface-muted mt-0.5">
                  Enabled {status.enrolled_at ? new Date(status.enrolled_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'recently'}.
                  {' '}
                  <span className={status.backup_codes_remaining <= 2 ? 'text-warning font-semibold' : ''}>
                    {status.backup_codes_remaining} backup code{status.backup_codes_remaining === 1 ? '' : 's'} remaining.
                  </span>
                </p>
              </div>
            </div>
            {status.backup_codes_remaining <= 2 && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-warning-container/40 border border-warning/25 text-xs text-warning">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                <span>You're low on backup codes. Disable and re-enable 2FA to generate a fresh set.</span>
              </div>
            )}
            <button onClick={() => setDisableOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-danger/30 text-danger text-xs font-semibold hover:bg-danger-container/40">
              <ShieldOff size={13} /> Disable 2FA
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-surface-2 border border-outline">
              <ShieldAlert size={18} className="text-on-surface-muted mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-on-surface">2FA is off</p>
                <p className="text-xs text-on-surface-muted mt-0.5">
                  Anyone with your password can sign in as you. Turn on 2FA to close that gap.
                </p>
              </div>
            </div>
            <button onClick={() => setEnrollOpen(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-on-accent text-sm font-semibold hover:opacity-90">
              <ShieldCheck size={14} /> Enable 2FA
            </button>
          </div>
        )}
      </div>

      {enrollOpen && <EnrollWizard onClose={() => { setEnrollOpen(false); refresh(); }} />}
      {disableOpen && <DisableModal onClose={() => { setDisableOpen(false); refresh(); }} />}
    </div>
  );
}

// ── Enrollment wizard ───────────────────────────────────────────────────
function EnrollWizard({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<'qr' | 'verify' | 'done'>('qr');
  const [secret, setSecret] = useState<string | null>(null);
  const [otpauth, setOtpauth] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [copiedSecret, setCopiedSecret] = useState(false);

  useEffect(() => {
    setBusy(true);
    api.twoFactorSetup()
      .then(d => { setSecret(d.secret); setOtpauth(d.otpauth_url); })
      .catch(e => setError(e?.message ?? 'Could not start setup.'))
      .finally(() => setBusy(false));
  }, []);

  const verify = async () => {
    if (code.length !== 6) return;
    setBusy(true); setError('');
    try {
      const { backup_codes } = await api.twoFactorVerify(code);
      setBackupCodes(backup_codes);
      setStep('done');
    } catch (e: any) { setError(e?.message ?? 'That code was rejected.'); }
    finally { setBusy(false); }
  };

  const copySecret = async () => {
    if (!secret) return;
    try { await navigator.clipboard.writeText(secret); setCopiedSecret(true); setTimeout(() => setCopiedSecret(false), 1500); }
    catch { /* ignore */ }
  };
  const copyBackupCodes = async () => {
    try {
      await navigator.clipboard.writeText(backupCodes.join('\n'));
      toast.success('Copied', 'Backup codes copied to clipboard.');
    } catch { toast.error('Copy failed', 'Try downloading them instead.'); }
  };
  const downloadBackupCodes = () => {
    const blob = new Blob(
      [`Digital Leap HRMS — 2FA backup codes\n${new Date().toISOString().slice(0, 10)}\n\n${backupCodes.join('\n')}\n\nEach code works exactly once. Store somewhere only you can reach.\n`],
      { type: 'text/plain' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'hrms-2fa-backup-codes.txt';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface rounded-xl-3 border border-outline shadow-elev-3 w-full max-w-lg max-h-[92vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-outline flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-lg font-bold text-on-surface inline-flex items-center gap-2">
              <ShieldCheck size={16} className="text-accent" /> Set up two-factor auth
            </h3>
            <p className="text-xs text-on-surface-muted mt-0.5">
              Step {step === 'qr' ? 1 : step === 'verify' ? 2 : 3} of 3 · takes about a minute
            </p>
          </div>
          <button onClick={onClose} className="text-on-surface-subtle hover:text-on-surface p-1"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {step === 'qr' && (
            <>
              <ol className="text-xs text-on-surface-muted space-y-1 list-decimal ml-4">
                <li>Install Google Authenticator, Authy, or 1Password on your phone if you haven't already.</li>
                <li>Open the app and choose "Add account" → "Scan a QR code".</li>
                <li>Scan the QR below. Then hit Next to enter the 6-digit code your app shows.</li>
              </ol>

              {busy && !secret ? (
                <p className="py-8 text-center text-sm text-on-surface-subtle">Generating your secret…</p>
              ) : secret && otpauth ? (
                <>
                  <div className="flex justify-center py-4">
                    <div className="p-3 bg-white rounded-xl-2 border border-outline">
                      <QRCodeSVG value={otpauth} size={192} level="M" />
                    </div>
                  </div>
                  <details className="text-xs">
                    <summary className="cursor-pointer text-on-surface-muted hover:text-on-surface">Can't scan? Enter the secret manually</summary>
                    <div className="mt-2 p-3 rounded-lg bg-surface-2 border border-outline flex items-center justify-between gap-2">
                      <code className="font-mono text-[11px] tracking-wider break-all">{secret}</code>
                      <button onClick={copySecret} className="text-on-surface-subtle hover:text-accent p-1 shrink-0" title="Copy">
                        {copiedSecret ? <Check size={13} className="text-success" /> : <Copy size={13} />}
                      </button>
                    </div>
                  </details>
                </>
              ) : null}

              {error && <p className="text-xs text-danger bg-danger-container/40 border border-danger/20 rounded-lg px-3 py-2">{error}</p>}

              <button onClick={() => { setError(''); setStep('verify'); }} disabled={!secret}
                className="w-full py-2.5 rounded-lg bg-accent text-on-accent text-sm font-semibold disabled:opacity-40 hover:opacity-90">
                Next — enter code
              </button>
            </>
          )}

          {step === 'verify' && (
            <>
              <p className="text-sm text-on-surface-muted">Type the 6-digit code your authenticator app is showing right now.</p>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                autoFocus
                maxLength={6}
                placeholder="000000"
                className="w-full text-center py-3 rounded-xl-2 text-2xl font-mono tracking-[0.5em] text-on-surface placeholder:text-on-surface-subtle focus:outline-none bg-surface-2 border border-outline focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
              {error && <p className="text-xs text-danger bg-danger-container/40 border border-danger/20 rounded-lg px-3 py-2">{error}</p>}
              <div className="flex gap-2">
                <button onClick={() => { setStep('qr'); setError(''); }} className="flex-1 py-2.5 rounded-lg border border-outline text-on-surface-muted text-sm font-semibold hover:bg-surface-2">
                  ← Back
                </button>
                <button onClick={verify} disabled={busy || code.length !== 6}
                  className="flex-1 py-2.5 rounded-lg bg-accent text-on-accent text-sm font-semibold disabled:opacity-40 hover:opacity-90">
                  {busy ? 'Verifying…' : 'Turn on 2FA'}
                </button>
              </div>
            </>
          )}

          {step === 'done' && (
            <>
              <div className="flex items-start gap-3 p-3 rounded-lg bg-success-container/60 border border-success/25">
                <ShieldCheck size={18} className="text-success mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-success">2FA is on</p>
                  <p className="text-xs text-on-surface-muted mt-0.5">Your next sign-in will ask for a code from your authenticator app.</p>
                </div>
              </div>
              <div>
                <p className="text-sm font-semibold text-on-surface mb-1">Save these backup codes</p>
                <p className="text-xs text-on-surface-muted mb-3">
                  If you lose your phone, each code works once to get you back in. Store them somewhere only you can reach — password manager, printed slip in a drawer, whatever. This is the only time we'll show them.
                </p>
                <div className="grid grid-cols-2 gap-2 p-3 rounded-lg bg-surface-2 border border-outline font-mono text-sm">
                  {backupCodes.map(c => <div key={c} className="tracking-wider text-on-surface">{c}</div>)}
                </div>
                <div className="flex gap-2 mt-3">
                  <button onClick={copyBackupCodes} className="flex-1 py-2 rounded-lg border border-outline text-on-surface-muted text-xs font-semibold hover:bg-surface-2 inline-flex items-center justify-center gap-1.5">
                    <Copy size={12} /> Copy
                  </button>
                  <button onClick={downloadBackupCodes} className="flex-1 py-2 rounded-lg border border-outline text-on-surface-muted text-xs font-semibold hover:bg-surface-2 inline-flex items-center justify-center gap-1.5">
                    <Download size={12} /> Download .txt
                  </button>
                </div>
              </div>
              <button onClick={onClose} className="w-full py-2.5 rounded-lg bg-accent text-on-accent text-sm font-semibold hover:opacity-90">
                I've saved them — close
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Disable modal — requires current TOTP code ─────────────────────────
function DisableModal({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (code.length !== 6) return;
    setBusy(true); setError('');
    try {
      await api.twoFactorDisable(code);
      toast.success('2FA disabled', 'Turn it back on any time from Security.');
      onClose();
    } catch (e: any) { setError(e?.message ?? 'That code was rejected.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface rounded-xl-3 border border-outline shadow-elev-3 w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-outline flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-lg font-bold text-on-surface inline-flex items-center gap-2">
              <ShieldOff size={16} className="text-danger" /> Turn off 2FA
            </h3>
            <p className="text-xs text-on-surface-muted mt-0.5">
              Confirm by entering the current 6-digit code from your authenticator.
            </p>
          </div>
          <button onClick={onClose} className="text-on-surface-subtle hover:text-on-surface p-1"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex items-start gap-2 p-3 rounded-lg bg-warning-container/40 border border-warning/25 text-xs text-warning">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span>Without 2FA, anyone with your password can sign in as you.</span>
          </div>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            autoFocus
            maxLength={6}
            placeholder="000000"
            className="w-full text-center py-3 rounded-xl-2 text-2xl font-mono tracking-[0.5em] text-on-surface placeholder:text-on-surface-subtle focus:outline-none bg-surface-2 border border-outline focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
          {error && <p className="text-xs text-danger bg-danger-container/40 border border-danger/20 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-outline text-on-surface-muted text-sm font-semibold hover:bg-surface-2">
              Cancel
            </button>
            <button onClick={submit} disabled={busy || code.length !== 6}
              className="flex-1 py-2.5 rounded-lg bg-danger text-white text-sm font-semibold disabled:opacity-40 hover:opacity-90">
              {busy ? 'Turning off…' : 'Turn off 2FA'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

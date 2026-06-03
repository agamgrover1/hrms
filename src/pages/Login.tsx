import { useState } from 'react';
import { Eye, EyeOff, Lock, Mail, AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    await new Promise(r => setTimeout(r, 400));
    const result = await login(email, password);
    setLoading(false);
    if (!result.success) setError(result.error ?? 'Login failed');
  };

  return (
    <div className="min-h-screen flex bg-bg">

      {/* ── Left panel — Digital Leap brand ──────────────────────────────── */}
      <div className="hidden lg:flex lg:w-[45%] flex-col justify-between p-12 relative overflow-hidden aurora-bg text-white">

        {/* Decorative shapes */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full opacity-[0.10] bg-accent blur-2xl" />
          <div className="absolute top-1/3 -left-20 w-72 h-72 rounded-full opacity-[0.08] bg-accent blur-2xl" />
          <div className="absolute bottom-16 right-16 w-80 h-80 rounded-full opacity-[0.10] border-2 border-accent/40" />
          <div className="absolute top-24 left-24 w-44 h-44 rounded-full opacity-[0.08] border border-white/30" />
        </div>

        {/* Logo */}
        <div className="relative">
          <img src="/logo.png" alt="Digital Leap Marketing Solutions" className="h-14 object-contain" />
        </div>

        {/* Centre content */}
        <div className="relative space-y-8">
          <div>
            <div className="w-10 h-1 rounded-full mb-6 bg-accent" />
            <h1 className="font-display text-4xl font-bold text-white leading-tight tracking-tight mb-4">
              Your workplace,<br />in one place.
            </h1>
            <p className="text-base leading-relaxed text-white/55">
              The Digital Leap team portal for attendance, leaves,
              payroll, performance and everything in between.
            </p>
          </div>

          {/* Feature pills */}
          <div className="flex flex-wrap gap-2.5">
            {['Attendance','Leave Management','Payroll','Performance','WFH','Expenses'].map(f => (
              <span key={f}
                className="text-xs font-semibold px-3 py-1.5 rounded-full bg-white/8 border border-white/10 text-white/65 backdrop-blur-sm">
                {f}
              </span>
            ))}
          </div>

          {/* Divider + tagline */}
          <div className="pt-4 border-t border-white/10">
            <p className="text-sm font-medium text-white/40">
              For Digital Leap employees only.
            </p>
          </div>
        </div>

        <p className="relative text-xs text-white/30">
          © {new Date().getFullYear()} Digital Leap Marketing Solutions. All rights reserved.
        </p>
      </div>

      {/* ── Right panel — login form ──────────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center p-8 bg-bg">
        <div className="w-full max-w-md group relative">

          {/* Mobile logo */}
          <div className="lg:hidden mb-10 flex justify-center">
            <img src="/logo.png" alt="Digital Leap Marketing Solutions" className="h-10 object-contain" />
          </div>

          {/* Elevated card wrapper */}
          <div className="relative bg-surface rounded-xl-3 border border-outline shadow-elev-3 p-8 overflow-hidden">
            {/* Decorative blob */}
            <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-brand/15 blur-2xl opacity-50 pointer-events-none" />

            <div className="relative">
              <h2 className="font-display text-2xl font-bold tracking-tight text-on-surface mb-1">Welcome back</h2>
              <p className="text-on-surface-subtle text-sm mb-8">Sign in with your Digital Leap credentials</p>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="text-xs font-semibold mb-1.5 block uppercase tracking-wide text-on-surface-muted">
                    Email address
                  </label>
                  <div className="relative">
                    <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-subtle" />
                    <input
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      required
                      placeholder="you@digitalleapmarketing.com"
                      className="w-full pl-10 pr-4 py-3 rounded-xl-2 text-sm text-on-surface placeholder:text-on-surface-subtle focus:outline-none transition-colors bg-surface-2 border border-outline focus:border-accent focus:ring-2 focus:ring-accent/20"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold mb-1.5 block uppercase tracking-wide text-on-surface-muted">
                    Password
                  </label>
                  <div className="relative">
                    <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-subtle" />
                    <input
                      type={showPass ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      required
                      placeholder="••••••••"
                      className="w-full pl-10 pr-10 py-3 rounded-xl-2 text-sm text-on-surface placeholder:text-on-surface-subtle focus:outline-none transition-colors bg-surface-2 border border-outline focus:border-accent focus:ring-2 focus:ring-accent/20"
                    />
                    <button type="button" onClick={() => setShowPass(!showPass)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-subtle hover:text-on-surface-muted transition-colors">
                      {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="flex items-center gap-2 p-3 bg-danger-container border border-danger/20 rounded-xl-2 text-danger text-sm">
                    <AlertCircle size={15} className="flex-shrink-0" />
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 bg-accent text-on-accent font-semibold rounded-xl-2 transition-all text-sm mt-2 disabled:opacity-60 hover:opacity-90 hover:shadow-elev-2 transition-shadow">
                  {loading ? 'Signing in…' : 'Sign In →'}
                </button>
              </form>

              <p className="mt-8 text-center text-xs text-on-surface-subtle">
                Trouble signing in? Contact your HR team.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

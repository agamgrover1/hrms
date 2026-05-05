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
    <div className="min-h-screen flex" style={{ background: '#f4f5f9' }}>

      {/* ── Left panel — Digital Leap brand ──────────────────────────────── */}
      <div className="hidden lg:flex lg:w-[45%] flex-col justify-between p-12 relative overflow-hidden"
        style={{ background: 'linear-gradient(160deg, #192250 0%, #111737 100%)' }}>

        {/* Decorative shapes */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full opacity-[0.06]" style={{ background: '#EE2770' }} />
          <div className="absolute top-1/3 -left-20 w-72 h-72 rounded-full opacity-[0.05]" style={{ background: '#EE2770' }} />
          <div className="absolute bottom-16 right-16 w-80 h-80 rounded-full opacity-[0.04]" style={{ border: '2px solid #EE2770' }} />
          <div className="absolute top-24 left-24 w-44 h-44 rounded-full opacity-[0.05]" style={{ border: '1px solid #fff' }} />
        </div>

        {/* Logo */}
        <div className="relative">
          <img src="/logo.png" alt="Digital Leap Marketing Solutions" className="h-14 object-contain" />
        </div>

        {/* Centre content */}
        <div className="relative space-y-8">
          <div>
            <div className="w-10 h-1 rounded-full mb-6" style={{ background: '#EE2770' }} />
            <h1 className="text-4xl font-bold text-white leading-tight mb-4">
              Your workplace,<br />in one place.
            </h1>
            <p className="text-base leading-relaxed" style={{ color: 'rgba(255,255,255,0.5)' }}>
              The Digital Leap team portal for attendance, leaves,
              payroll, performance and everything in between.
            </p>
          </div>

          {/* Feature pills */}
          <div className="flex flex-wrap gap-2.5">
            {['Attendance','Leave Management','Payroll','Performance','WFH','Expenses'].map(f => (
              <span key={f} className="text-xs font-semibold px-3 py-1.5 rounded-full"
                style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.1)' }}>
                {f}
              </span>
            ))}
          </div>

          {/* Divider + tagline */}
          <div className="pt-4 border-t" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
            <p className="text-sm font-medium" style={{ color: 'rgba(255,255,255,0.35)' }}>
              For Digital Leap employees only.
            </p>
          </div>
        </div>

        <p className="relative text-xs" style={{ color: 'rgba(255,255,255,0.25)' }}>
          © {new Date().getFullYear()} Digital Leap Marketing Solutions. All rights reserved.
        </p>
      </div>

      {/* ── Right panel — login form ──────────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">

          {/* Mobile logo */}
          <div className="lg:hidden mb-10 flex justify-center">
            <img src="/logo.png" alt="Digital Leap Marketing Solutions" className="h-10 object-contain" />
          </div>

          <h2 className="text-2xl font-bold mb-1" style={{ color: '#192250' }}>Welcome back</h2>
          <p className="text-gray-400 text-sm mb-8">Sign in with your Digital Leap credentials</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs font-semibold mb-1.5 block uppercase tracking-wide" style={{ color: '#192250' }}>
                Email address
              </label>
              <div className="relative">
                <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  placeholder="you@digitalleapmarketing.com"
                  className="w-full pl-10 pr-4 py-3 border rounded-xl text-sm focus:outline-none transition-all bg-white"
                  style={{ borderColor: '#e2e4ed' }}
                  onFocus={e => { e.target.style.borderColor = '#192250'; e.target.style.boxShadow = '0 0 0 3px rgba(25,34,80,0.08)'; }}
                  onBlur={e => { e.target.style.borderColor = '#e2e4ed'; e.target.style.boxShadow = 'none'; }}
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold mb-1.5 block uppercase tracking-wide" style={{ color: '#192250' }}>
                Password
              </label>
              <div className="relative">
                <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  className="w-full pl-10 pr-10 py-3 border rounded-xl text-sm focus:outline-none transition-all bg-white"
                  style={{ borderColor: '#e2e4ed' }}
                  onFocus={e => { e.target.style.borderColor = '#192250'; e.target.style.boxShadow = '0 0 0 3px rgba(25,34,80,0.08)'; }}
                  onBlur={e => { e.target.style.borderColor = '#e2e4ed'; e.target.style.boxShadow = 'none'; }}
                />
                <button type="button" onClick={() => setShowPass(!showPass)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-100 rounded-xl text-red-600 text-sm">
                <AlertCircle size={15} className="flex-shrink-0" />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 text-white font-semibold rounded-xl transition-all text-sm mt-2 disabled:opacity-60"
              style={{
                background: loading ? '#192250' : 'linear-gradient(135deg, #EE2770 0%, #d11f62 100%)',
                boxShadow: '0 4px 15px rgba(238,39,112,0.35)',
              }}>
              {loading ? 'Signing in…' : 'Sign In →'}
            </button>
          </form>

          <p className="mt-8 text-center text-xs text-gray-400">
            Trouble signing in? Contact your HR team.
          </p>
        </div>
      </div>
    </div>
  );
}

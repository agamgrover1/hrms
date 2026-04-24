import { useState } from 'react';
import { Eye, EyeOff, Lock, Mail, AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const demoCredentials = [
  { role: 'Admin', email: 'admin@company.com', password: 'Admin@123' },
  { role: 'HR Manager', email: 'deepika.reddy@company.com', password: 'HR@123' },
  { role: 'Employee', email: 'priya.sharma@company.com', password: 'Pass@123' },
];

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

  const fillDemo = (e: string, p: string) => {
    setEmail(e);
    setPassword(p);
    setError('');
  };

  return (
    <div className="min-h-screen flex" style={{ background: '#f4f5f9' }}>
      {/* Left Panel — navy brand */}
      <div className="hidden lg:flex lg:w-[45%] flex-col justify-between p-12 relative overflow-hidden"
        style={{ background: 'linear-gradient(160deg, #192250 0%, #111737 100%)' }}>

        {/* Decorative circles */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-20 -right-20 w-80 h-80 rounded-full opacity-5"
            style={{ background: '#EE2770' }} />
          <div className="absolute top-1/3 -left-16 w-64 h-64 rounded-full opacity-5"
            style={{ background: '#EE2770' }} />
          <div className="absolute bottom-10 right-10 w-96 h-96 rounded-full opacity-[0.04]"
            style={{ border: '2px solid #EE2770' }} />
          <div className="absolute top-20 left-20 w-40 h-40 rounded-full opacity-[0.06]"
            style={{ border: '1px solid #fff' }} />
        </div>

        {/* Logo — white pill so dark-text logo is visible on navy panel */}
        <div className="relative inline-block px-5 py-3 rounded-2xl shadow-lg" style={{ background: 'rgba(255,255,255,0.95)' }}>
          <img src="/logo.png" alt="Digital Leap Marketing Solutions" className="h-12 object-contain" />
        </div>

        {/* Headline */}
        <div className="relative">
          <div className="w-10 h-1 rounded-full mb-6" style={{ background: '#EE2770' }} />
          <h1 className="text-4xl font-bold text-white leading-tight mb-5">
            Manage your<br />workforce smarter.
          </h1>
          <p className="text-base leading-relaxed" style={{ color: 'rgba(255,255,255,0.55)' }}>
            All-in-one HR platform for attendance, payroll, leaves, and performance management.
          </p>

          <div className="mt-10 grid grid-cols-2 gap-3">
            {[
              { label: 'Employees', value: '10+' },
              { label: 'Modules', value: '6' },
              { label: 'Departments', value: '7' },
              { label: 'Uptime', value: '99.9%' },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-xl p-4"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
                <p className="text-2xl font-bold text-white">{value}</p>
                <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>{label}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="relative text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>
          © 2026 Digital Leap HRMS. All rights reserved.
        </p>
      </div>

      {/* Right Panel — login form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">

          {/* Mobile logo */}
          <div className="lg:hidden mb-10">
            <img src="/logo.png" alt="Digital Leap Marketing Solutions" className="h-10 object-contain" />
          </div>

          <h2 className="text-2xl font-bold mb-1" style={{ color: '#192250' }}>Welcome back</h2>
          <p className="text-gray-400 text-sm mb-8">Sign in to your account to continue</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs font-semibold mb-1.5 block uppercase tracking-wide"
                style={{ color: '#192250' }}>Email address</label>
              <div className="relative">
                <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  placeholder="you@company.com"
                  className="w-full pl-10 pr-4 py-3 border rounded-xl text-sm focus:outline-none transition-all bg-white"
                  style={{
                    borderColor: '#e2e4ed',
                    '--tw-ring-color': '#192250',
                  } as React.CSSProperties}
                  onFocus={e => { e.target.style.borderColor = '#192250'; e.target.style.boxShadow = '0 0 0 3px rgba(25,34,80,0.08)'; }}
                  onBlur={e => { e.target.style.borderColor = '#e2e4ed'; e.target.style.boxShadow = 'none'; }}
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold mb-1.5 block uppercase tracking-wide"
                style={{ color: '#192250' }}>Password</label>
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
              style={{ background: loading ? '#192250' : 'linear-gradient(135deg, #EE2770 0%, #d11f62 100%)', boxShadow: '0 4px 15px rgba(238,39,112,0.35)' }}
            >
              {loading ? 'Signing in…' : 'Sign In →'}
            </button>
          </form>

          {/* Demo credentials */}
          <div className="mt-8 p-4 rounded-2xl" style={{ background: 'rgba(25,34,80,0.04)', border: '1px solid rgba(25,34,80,0.08)' }}>
            <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: '#192250', opacity: 0.5 }}>
              Demo Credentials
            </p>
            <div className="space-y-2">
              {demoCredentials.map(({ role, email: e, password: p }) => (
                <button
                  key={role}
                  onClick={() => fillDemo(e, p)}
                  className="w-full flex items-center justify-between text-left px-3 py-2.5 bg-white rounded-xl transition-all group"
                  style={{ border: '1px solid rgba(25,34,80,0.08)' }}
                  onMouseEnter={ev => { (ev.currentTarget as HTMLElement).style.borderColor = '#EE2770'; (ev.currentTarget as HTMLElement).style.background = '#fff0f5'; }}
                  onMouseLeave={ev => { (ev.currentTarget as HTMLElement).style.borderColor = 'rgba(25,34,80,0.08)'; (ev.currentTarget as HTMLElement).style.background = '#fff'; }}
                >
                  <div>
                    <p className="text-xs font-bold" style={{ color: '#192250' }}>{role}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{e}</p>
                  </div>
                  <span className="text-xs font-semibold opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ color: '#EE2770' }}>Use →</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

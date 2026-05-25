import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

export default function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const isDark = theme === 'dark';
  return (
    <button
      onClick={toggle}
      aria-label="Toggle theme"
      title={isDark ? 'Switch to light' : 'Switch to dark'}
      className="relative w-10 h-10 rounded-full flex items-center justify-center transition-all hover:bg-surface-2 group"
    >
      <Sun
        size={16}
        className={`absolute transition-all duration-300 text-on-surface-muted group-hover:text-warning ${
          isDark ? 'opacity-0 rotate-90 scale-50' : 'opacity-100 rotate-0 scale-100'
        }`}
      />
      <Moon
        size={16}
        className={`absolute transition-all duration-300 text-on-surface-muted group-hover:text-on-brand-container ${
          isDark ? 'opacity-100 rotate-0 scale-100' : 'opacity-0 -rotate-90 scale-50'
        }`}
      />
    </button>
  );
}

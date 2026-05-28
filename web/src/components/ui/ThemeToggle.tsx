import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';

/** Switch deslizante light/dark (sol/lua). Persistência via ThemeContext. */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      role="switch"
      aria-checked={isDark}
      aria-label={isDark ? 'Ativar tema claro' : 'Ativar tema escuro'}
      title={isDark ? 'Tema claro' : 'Tema escuro'}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 ${isDark ? 'bg-primary' : 'bg-neutral-light'} ${className}`}
    >
      <span
        className={`inline-flex h-5 w-5 items-center justify-center rounded-full bg-white shadow-sm transition-transform duration-200 ${isDark ? 'translate-x-[22px]' : 'translate-x-[2px]'}`}
      >
        {isDark
          ? <Moon className="h-3 w-3 text-[#475569]" strokeWidth={2.5} />
          : <Sun className="h-3 w-3 text-[#E6A700]" strokeWidth={2.5} />}
      </span>
    </button>
  );
}

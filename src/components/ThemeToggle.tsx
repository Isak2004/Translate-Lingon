import { useTheme } from '../ThemeContext';

export function ThemeToggle() {
  const { theme, toggle } = useTheme();

  return (
    <button
      className="theme-toggle"
      onClick={toggle}
      title={theme === 'light' ? 'Byt till mörkt läge' : 'Byt till ljust läge'}
      aria-label="Växla tema"
    >
      {theme === 'light' ? '🌙' : '☀️'}
    </button>
  );
}

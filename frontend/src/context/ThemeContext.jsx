import { createContext, useContext, useEffect, useState } from 'react';

const ThemeContext = createContext(null);
const media = window.matchMedia('(prefers-color-scheme: dark)');

function apply(theme) {
  const dark = theme === 'dark' || (theme === 'system' && media.matches);
  document.documentElement.classList.toggle('dark', dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b1020' : '#6366f1');
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => localStorage.getItem('lp_theme') || 'system');

  useEffect(() => {
    apply(theme);
    const onChange = () => theme === 'system' && apply('system');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [theme]);

  const setTheme = (t) => {
    localStorage.setItem('lp_theme', t);
    setThemeState(t);
  };
  const isDark = theme === 'dark' || (theme === 'system' && media.matches);

  return <ThemeContext.Provider value={{ theme, setTheme, isDark }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);

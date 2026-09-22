import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

const STORAGE_KEY = "atlitos-admin-theme";

type Theme = "light" | "dark";

function resolveInitialTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle("dark", theme === "dark");
}

/** data-theme on <html> from localStorage, prefers-color-scheme default. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => {
    const initial = resolveInitialTheme();
    applyTheme(initial);
    return initial;
  });

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  return (
    <button
      type="button"
      className="ak-theme-toggle"
      onClick={() => setTheme((current) => (current === "light" ? "dark" : "light"))}
      aria-label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
    >
      {theme === "light" ? <Moon size={18} strokeWidth={1.75} /> : <Sun size={18} strokeWidth={1.75} />}
    </button>
  );
}

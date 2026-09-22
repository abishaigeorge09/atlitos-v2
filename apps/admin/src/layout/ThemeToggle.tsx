import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

import { applyTheme, resolveTheme, storeTheme, type Theme } from "../lib/theme";

/**
 * Flips the theme. It does NOT own it: `main.tsx` applies the stored
 * preference before the first render, so every screen including /login is
 * themed whether or not this toggle is on it.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => resolveTheme());

  useEffect(() => {
    applyTheme(theme);
    storeTheme(theme);
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

// The theme has to be applied before anything renders, and on every screen,
// not only the ones inside the authenticated shell.
//
// It used to live entirely in ThemeToggle, which mounts in the shell header.
// /login sits outside that shell, so it could never see `data-theme` however
// the preference was stored: someone who chose dark and later signed out was
// thrown back to a white screen on the first page they see. Found by the
// ux-critic on the A2 gate, 2026-09-22.

export const THEME_STORAGE_KEY = "atlitos-admin-theme";

export type Theme = "light" | "dark";

export function resolveTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // A private window or blocked site data: fall through to the OS preference.
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export function storeTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Not fatal: the attribute is already applied for this page view.
  }
}

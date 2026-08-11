/**
 * Theme utilities for dark mode support
 */

export type Theme = "light" | "dark";

/**
 * Gets the user's preferred theme from system settings
 */
export function getSystemTheme(): Theme {
  if (typeof window === "undefined") {
    return "light";
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/**
 * Applies the theme to the document
 */
export function applyTheme(theme: Theme) {
  if (typeof document === "undefined") {
    return;
  }

  const root = document.documentElement;

  if (theme === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
}

/**
 * Gets the current theme from localStorage or system preference
 */
export function getPreferredTheme(): Theme {
  if (typeof window === "undefined") {
    return "light";
  }

  // Check localStorage first
  const stored = localStorage.getItem("theme") as Theme | null;
  if (stored === "light" || stored === "dark") {
    return stored;
  }

  // Fall back to system preference
  return getSystemTheme();
}

/**
 * Saves the theme preference to localStorage
 */
export function saveThemePreference(theme: Theme) {
  if (typeof window === "undefined") {
    return;
  }

  localStorage.setItem("theme", theme);
}

/**
 * Script to run before hydration to prevent flash of wrong theme
 */
export const themeScript = `
  (function() {
    function getTheme() {
      const stored = localStorage.getItem('theme');
      if (stored === 'light' || stored === 'dark') {
        return stored;
      }
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    
    const theme = getTheme();
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    }
  })();
`;

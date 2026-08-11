"use client";

import { useEffect, useState } from "react";
import { applyTheme, getPreferredTheme, type Theme } from "./theme";

/**
 * Hook to manage theme state and listen for system preference changes
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    // Only run on client
    if (typeof window === "undefined") {
      return "light";
    }
    return getPreferredTheme();
  });

  useEffect(() => {
    // Apply the initial theme
    applyTheme(theme);

    // Listen for system theme changes
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    const handleChange = (e: MediaQueryListEvent) => {
      // Only update if user hasn't manually set a preference
      const stored = localStorage.getItem("theme");
      if (!stored) {
        const newTheme = e.matches ? "dark" : "light";
        setTheme(newTheme);
        applyTheme(newTheme);
      }
    };

    // Modern browsers
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }
    // Legacy browsers
    else if (mediaQuery.addListener) {
      mediaQuery.addListener(handleChange);
      return () => mediaQuery.removeListener(handleChange);
    }
  }, [theme]);

  return { theme, setTheme };
}

/**
 * Theme Provider component for Next.js
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useTheme();
  return <>{children}</>;
}

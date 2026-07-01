import { useState, useEffect } from "react";

// Custom event so every useTheme instance (e.g. TopNav + board) stays in sync
// when any one of them toggles the theme, without a shared context provider.
const THEME_EVENT = "ponder-theme-change";

export const useTheme = () => {
  const [isDark, setIsDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Hydration: load theme preference from localStorage after client mount
    const saved = localStorage.getItem("ponderTheme");
    if (saved) {
      setIsDark(saved === "dark");
    } else {
      // Check system preference if no saved preference
      // Safely check for matchMedia availability (not available in test environment)
      if (typeof window !== "undefined" && window.matchMedia) {
        const prefersDark = window.matchMedia(
          "(prefers-color-scheme: dark)"
        ).matches;
        setIsDark(prefersDark);
      }
    }
    setMounted(true);

    // Keep instances in sync: react to toggles from other components (custom
    // event, same tab) and from other tabs (native storage event).
    const syncFromStorage = () => {
      const current = localStorage.getItem("ponderTheme");
      if (current) setIsDark(current === "dark");
    };
    window.addEventListener(THEME_EVENT, syncFromStorage);
    window.addEventListener("storage", syncFromStorage);
    return () => {
      window.removeEventListener(THEME_EVENT, syncFromStorage);
      window.removeEventListener("storage", syncFromStorage);
    };
  }, []);

  const toggle = () => {
    const newIsDark = !isDark;
    setIsDark(newIsDark);
    localStorage.setItem("ponderTheme", newIsDark ? "dark" : "light");
    // Notify sibling instances in this tab.
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(THEME_EVENT));
    }
  };

  return { isDark, toggle, mounted };
};

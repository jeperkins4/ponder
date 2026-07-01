import { useState, useEffect } from "react";

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
  }, []);

  const toggle = () => {
    const newIsDark = !isDark;
    setIsDark(newIsDark);
    localStorage.setItem("ponderTheme", newIsDark ? "dark" : "light");
  };

  return { isDark, toggle, mounted };
};

"use client";
import { createContext, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark";
const Ctx = createContext<{
  resolvedTheme: Theme;
  setTheme: (t: Theme) => void;
}>({
  resolvedTheme: "dark",
  setTheme: () => {},
});

export const useTheme = () => useContext(Ctx);

// Theme state lives in <html class="dark">. The stored preference is resolved
// exactly once, and nothing is written back until that read has settled:
// writing on the same pass as the read let the "dark" default overwrite the
// stored value, so "light" could never survive a reload. The inline script in
// app/layout.tsx applies the class before first paint, so there is no flash.
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark");
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    let saved: Theme | null = null;
    try {
      saved = localStorage.getItem("theme") as Theme | null;
    } catch {
      /* ignore */
    }
    if (saved === "light" || saved === "dark") setThemeState(saved);
    setResolved(true);
  }, []);

  useEffect(() => {
    if (!resolved) return;
    document.documentElement.classList.toggle("dark", theme === "dark");
    try {
      localStorage.setItem("theme", theme);
    } catch {
      /* ignore */
    }
  }, [theme, resolved]);

  return (
    <Ctx.Provider value={{ resolvedTheme: theme, setTheme: setThemeState }}>
      {children}
    </Ctx.Provider>
  );
}

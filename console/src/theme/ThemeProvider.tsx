import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import {
  applyResolvedTheme,
  getServerPrefersDark,
  getSystemPrefersDark,
  readStoredThemeMode,
  resolveThemeMode,
  subscribeSystemTheme,
  THEME_STORAGE_KEY,
  ThemeContext,
} from "./theme-mode";
import type { ThemeContextValue, ThemeMode } from "./theme-mode";

export interface ThemeProviderProps {
  children: ReactNode;
}

/**
 * Owns the theme mode, persists it to localStorage and mirrors the resolved
 * theme onto `<html data-theme="…">` + `color-scheme` for the CSS layer.
 * `auto` follows `prefers-color-scheme` live via `useSyncExternalStore`.
 */
export function ThemeProvider({ children }: ThemeProviderProps) {
  const [mode, setModeState] = useState<ThemeMode>(readStoredThemeMode);
  const prefersDark = useSyncExternalStore(
    subscribeSystemTheme,
    getSystemPrefersDark,
    getServerPrefersDark,
  );

  const resolvedMode = resolveThemeMode(mode, prefersDark);

  useEffect(() => {
    applyResolvedTheme(resolvedMode);
  }, [resolvedMode]);

  const setMode = useCallback((nextMode: ThemeMode) => {
    setModeState(nextMode);
    if (typeof window === "undefined") {
      return;
    }
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextMode);
    } catch {
      // Persistence is best-effort; the in-memory mode still applies.
    }
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, resolvedMode, setMode }),
    [mode, resolvedMode, setMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export default ThemeProvider;

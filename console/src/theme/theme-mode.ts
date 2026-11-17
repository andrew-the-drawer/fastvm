import { createContext, useContext } from "react";
import type { ResolvedThemeMode } from "../theme";

/** User-selectable theme mode: explicit dark/light or follow the system. */
export type ThemeMode = "dark" | "light" | "auto";

/** localStorage key shared with the no-flash bootstrap script in `index.html`. */
export const THEME_STORAGE_KEY = "fastvm.console.theme";

/** Media query used to resolve `auto`, same value as the bootstrap script. */
export const THEME_MEDIA_QUERY = "(prefers-color-scheme: dark)";

/** All modes in menu order. */
export const THEME_MODES: readonly ThemeMode[] = ["dark", "light", "auto"];

export interface ThemeContextValue {
  /** The persisted user choice. */
  readonly mode: ThemeMode;
  /** The concrete theme currently applied (`auto` already resolved). */
  readonly resolvedMode: ResolvedThemeMode;
  /** Select and persist a mode; applied on the next render and to `<html>`. */
  readonly setMode: (mode: ThemeMode) => void;
}

/** Internal context consumed by {@link useTheme}. */
export const ThemeContext = createContext<ThemeContextValue | null>(null);

/** Coerces any persisted/raw value into a valid mode (`auto` fallback). */
export function parseThemeMode(value: string | null | undefined): ThemeMode {
  return value === "dark" || value === "light" || value === "auto" ? value : "auto";
}

/** Resolves `auto` against the current OS preference. */
export function resolveThemeMode(mode: ThemeMode, prefersDark: boolean): ResolvedThemeMode {
  if (mode === "auto") {
    return prefersDark ? "dark" : "light";
  }
  return mode;
}

/** Reads the persisted mode; falls back to `auto` when storage is unavailable. */
export function readStoredThemeMode(): ThemeMode {
  if (typeof window === "undefined") {
    return "auto";
  }
  try {
    return parseThemeMode(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    // Storage can throw in private browsing / sandboxed iframes.
    return "auto";
  }
}

/** Current `prefers-color-scheme` value; dark when matchMedia is unavailable. */
export function getSystemPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return true;
  }
  try {
    return window.matchMedia(THEME_MEDIA_QUERY).matches;
  } catch {
    return true;
  }
}

/** Server snapshot for `useSyncExternalStore` (no DOM during SSR). */
export function getServerPrefersDark(): boolean {
  return true;
}

/** Subscribes to OS color-scheme changes; returns the unsubscribe function. */
export function subscribeSystemTheme(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }
  const query = window.matchMedia(THEME_MEDIA_QUERY);
  if (typeof query.addEventListener === "function") {
    query.addEventListener("change", onChange);
    return () => {
      query.removeEventListener("change", onChange);
    };
  }
  // Legacy Safari < 14.
  query.addListener(onChange);
  return () => {
    query.removeListener(onChange);
  };
}

/** Writes the resolved theme to `<html>` so the CSS variable layer switches. */
export function applyResolvedTheme(resolvedMode: ResolvedThemeMode): void {
  const root = document.documentElement;
  root.dataset.theme = resolvedMode;
  root.style.colorScheme = resolvedMode;
  // The bootstrap script paints the canvas before CSS loads; once the app is
  // mounted let the CSS variable (html background-color) own it.
  root.style.removeProperty("background-color");
}

/** Access the current theme; throws outside `<ThemeProvider>`. */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (context === null) {
    throw new Error("useTheme must be used within <ThemeProvider>.");
  }
  return context;
}

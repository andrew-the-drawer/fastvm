import { theme } from "antd";
import type { ThemeConfig } from "antd";

/** Fully resolved theme (no `auto`); mirrors the `data-theme` attribute value. */
export type ResolvedThemeMode = "dark" | "light";

/**
 * Semantic palette source for one resolved mode. antd tokens and the
 * hand-written CSS variables (`src/styles.css`) follow the same naming.
 */
export interface ThemePalette {
  readonly mode: ResolvedThemeMode;
  /** Interactive accent: links, primary buttons, focus rings, selected items. */
  readonly accent: string;
  /** Brighter accent for hover states and decorative glows. */
  readonly accentHover: string;
  /** Text/icon color on top of `accent`. */
  readonly accentOn: string;
  readonly bgBase: string;
  readonly bgLayout: string;
  readonly bgContainer: string;
  readonly bgElevated: string;
  /** Drawer panel surface (slightly darker than elevated in dark mode). */
  readonly bgDrawer: string;
  readonly bgHeader: string;
  /** Sunken surfaces: table heads, metric chips, subtle panels. */
  readonly bgSubtle: string;
  readonly border: string;
  readonly borderSecondary: string;
  readonly borderStrong: string;
  readonly text: string;
  readonly textSecondary: string;
  readonly textTertiary: string;
  readonly textMuted: string;
  readonly success: string;
  readonly warning: string;
  readonly error: string;
  readonly info: string;
  readonly purple: string;
  readonly menuHoverBg: string;
  readonly menuSelectedBg: string;
  readonly rowHoverBg: string;
  readonly selectSelectedBg: string;
  readonly tagBg: string;
  readonly tagColor: string;
  readonly progressRemaining: string;
  readonly tooltipBg: string;
  readonly tooltipText: string;
  readonly mask: string;
}

/** Dark palette — keeps the console's original mint-on-charcoal identity. */
export const darkPalette: ThemePalette = {
  mode: "dark",
  accent: "#5eead4",
  accentHover: "#8af2e2",
  accentOn: "#06231f",
  bgBase: "#0b0e14",
  bgLayout: "#0b0e14",
  bgContainer: "#11151f",
  bgElevated: "#161b28",
  bgDrawer: "#0f141f",
  bgHeader: "#0d1119",
  bgSubtle: "#0f1420",
  border: "#232a3a",
  borderSecondary: "#1b2130",
  borderStrong: "#283349",
  text: "#e6edf7",
  textSecondary: "#9aa7bd",
  textTertiary: "#6b7890",
  textMuted: "#8b98ad",
  success: "#4ade80",
  warning: "#fbbf24",
  error: "#f87171",
  info: "#60a5fa",
  purple: "#a78bfa",
  menuHoverBg: "rgba(94, 234, 212, 0.10)",
  menuSelectedBg: "rgba(94, 234, 212, 0.16)",
  rowHoverBg: "rgba(94, 234, 212, 0.06)",
  selectSelectedBg: "rgba(94, 234, 212, 0.14)",
  tagBg: "#1b2130",
  tagColor: "#9aa7bd",
  progressRemaining: "rgba(148, 163, 184, 0.18)",
  tooltipBg: "#1e2638",
  tooltipText: "#e6edf7",
  mask: "rgba(3, 6, 12, 0.65)",
};

/**
 * Light palette — cool near-white surfaces with a deep teal accent that keeps
 * white button text at WCAG AA (4.9:1 on #0b7f70) and dark body copy at ~15:1.
 */
export const lightPalette: ThemePalette = {
  mode: "light",
  accent: "#0b7f70",
  accentHover: "#0f9d8a",
  accentOn: "#ffffff",
  bgBase: "#ffffff",
  bgLayout: "#f6f7fb",
  bgContainer: "#ffffff",
  bgElevated: "#ffffff",
  bgDrawer: "#ffffff",
  bgHeader: "#ffffff",
  bgSubtle: "#f0f2f8",
  border: "#dfe4ee",
  borderSecondary: "#e8ecf4",
  borderStrong: "#c9d2e2",
  text: "#1a2233",
  textSecondary: "#4b5568",
  textTertiary: "#66718a",
  textMuted: "#5b667a",
  success: "#15803d",
  warning: "#b45309",
  error: "#d92d20",
  info: "#1d4ed8",
  purple: "#7c3aed",
  menuHoverBg: "rgba(15, 157, 138, 0.10)",
  menuSelectedBg: "rgba(15, 157, 138, 0.14)",
  rowHoverBg: "rgba(15, 157, 138, 0.06)",
  selectSelectedBg: "rgba(15, 157, 138, 0.12)",
  tagBg: "#f0f2f8",
  tagColor: "#4b5568",
  progressRemaining: "rgba(15, 23, 42, 0.08)",
  tooltipBg: "#1f2937",
  tooltipText: "#ffffff",
  mask: "rgba(17, 24, 39, 0.35)",
};

/** ANSI terminal palette passed to ghostty-web (`ITheme`-compatible shape). */
export interface TerminalTheme {
  readonly background: string;
  readonly foreground: string;
  readonly cursor: string;
  readonly cursorAccent: string;
  readonly selectionBackground: string;
  readonly selectionForeground: string;
  readonly black: string;
  readonly red: string;
  readonly green: string;
  readonly yellow: string;
  readonly blue: string;
  readonly magenta: string;
  readonly cyan: string;
  readonly white: string;
  readonly brightBlack: string;
  readonly brightRed: string;
  readonly brightGreen: string;
  readonly brightYellow: string;
  readonly brightBlue: string;
  readonly brightMagenta: string;
  readonly brightCyan: string;
  readonly brightWhite: string;
}

/**
 * Terminal colors for a resolved theme. ANSI colors are tuned per mode so both
 * normal and bright variants stay legible on the terminal background (the light
 * theme intentionally darkens "white" to a readable grey).
 */
export function terminalTheme(mode: ResolvedThemeMode): TerminalTheme {
  const palette = mode === "light" ? lightPalette : darkPalette;
  if (mode === "light") {
    return {
      background: "#f8fafc",
      foreground: palette.text,
      cursor: palette.accent,
      cursorAccent: palette.accentOn,
      selectionBackground: "rgba(15, 157, 138, 0.20)",
      selectionForeground: "#101828",
      black: "#1a2233",
      red: "#b42318",
      green: "#15803d",
      yellow: "#a16207",
      blue: "#1d4ed8",
      magenta: "#7c3aed",
      cyan: "#0b7f70",
      white: "#5b667a",
      brightBlack: "#66718a",
      brightRed: "#d92d20",
      brightGreen: "#166534",
      brightYellow: "#b45309",
      brightBlue: "#1e40af",
      brightMagenta: "#6d28d9",
      brightCyan: "#0f9d8a",
      brightWhite: "#1a2233",
    };
  }
  return {
    background: "#0b0e14",
    foreground: palette.text,
    cursor: palette.accent,
    cursorAccent: palette.accentOn,
    selectionBackground: "rgba(94, 234, 212, 0.28)",
    selectionForeground: "#f1f6fd",
    black: "#1f2633",
    red: "#f87171",
    green: "#4ade80",
    yellow: "#fbbf24",
    blue: "#60a5fa",
    magenta: "#c084fc",
    cyan: "#5eead4",
    white: "#c7d2e2",
    brightBlack: "#6b7890",
    brightRed: "#fca5a5",
    brightGreen: "#86efac",
    brightYellow: "#fcd34d",
    brightBlue: "#93c5fd",
    brightMagenta: "#d8b4fe",
    brightCyan: "#8af2e2",
    brightWhite: "#f8fafc",
  };
}

/** Dark accent kept as a named export for callers that need the brand mint. */
export const ACCENT = darkPalette.accent;

export const fontFamily =
  '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif';
export const monoFontFamily =
  '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

function buildThemeConfig(palette: ThemePalette): ThemeConfig {
  const isLight = palette.mode === "light";
  return {
    algorithm: isLight ? theme.defaultAlgorithm : theme.darkAlgorithm,
    token: {
      colorPrimary: palette.accent,
      colorInfo: palette.info,
      colorSuccess: palette.success,
      colorWarning: palette.warning,
      colorError: palette.error,
      colorBgBase: palette.bgBase,
      colorBgLayout: palette.bgLayout,
      colorBgContainer: palette.bgContainer,
      colorBgElevated: palette.bgElevated,
      // Keep the original dark mask (antd default) so dark stays pixel-identical;
      // light mode uses a softer scrim.
      ...(isLight ? { colorBgMask: palette.mask } : {}),
      colorBorder: palette.border,
      colorBorderSecondary: palette.borderSecondary,
      colorText: palette.text,
      colorTextSecondary: palette.textSecondary,
      colorTextTertiary: palette.textTertiary,
      colorLink: palette.accent,
      colorLinkHover: palette.accentHover,
      fontFamily,
      fontFamilyCode: monoFontFamily,
      fontSize: 14,
      borderRadius: 10,
      borderRadiusLG: 14,
      borderRadiusSM: 8,
      controlHeight: 36,
      wireframe: false,
    },
    components: {
      Layout: {
        headerBg: palette.bgHeader,
        bodyBg: palette.bgLayout,
        headerHeight: 64,
        headerPadding: "0 24px",
        headerColor: palette.text,
      },
      Menu: {
        itemBg: "transparent",
        itemColor: palette.text,
        itemHoverBg: palette.menuHoverBg,
        itemHoverColor: palette.accent,
        itemSelectedBg: palette.menuSelectedBg,
        itemSelectedColor: palette.accent,
        popupBg: palette.bgElevated,
        itemBorderRadius: 8,
        itemHeight: 36,
      },
      Card: {
        colorBgContainer: palette.bgContainer,
        headerBg: "transparent",
        headerFontSize: 15,
      },
      Table: {
        headerBg: palette.bgSubtle,
        headerColor: palette.textSecondary,
        headerSplitColor: palette.borderSecondary,
        rowHoverBg: palette.rowHoverBg,
        cellPaddingBlock: 12,
        cellPaddingInline: 14,
      },
      Modal: {
        contentBg: palette.bgElevated,
        headerBg: palette.bgElevated,
        titleColor: palette.text,
      },
      Drawer: {
        colorBgElevated: palette.bgDrawer,
        footerPaddingBlock: 16,
        footerPaddingInline: 24,
      },
      Tag: {
        defaultBg: palette.tagBg,
        defaultColor: palette.tagColor,
        solidTextColor: palette.accentOn,
      },
      Button: {
        fontWeight: 500,
        primaryColor: palette.accentOn,
      },
      Progress: {
        defaultColor: palette.accent,
        remainingColor: palette.progressRemaining,
      },
      Statistic: {
        contentFontSize: 30,
        titleFontSize: 13,
      },
      Tooltip: {
        colorBgSpotlight: palette.tooltipBg,
        colorTextLightSolid: palette.tooltipText,
      },
      Empty: {
        colorTextDescription: palette.textSecondary,
      },
      Select: {
        optionSelectedBg: palette.selectSelectedBg,
      },
      Form: {
        labelColor: palette.textSecondary,
        verticalLabelPadding: "0 0 6px",
      },
      Alert: {
        defaultPadding: "10px 14px",
      },
    },
  };
}

const themeCache = new Map<ResolvedThemeMode, ThemeConfig>();

/**
 * antd theme for a resolved mode. Results are cached so `ConfigProvider` gets
 * a referentially stable config and does not rebuild styles on every render.
 */
export function buildTheme(mode: ResolvedThemeMode): ThemeConfig {
  const cached = themeCache.get(mode);
  if (cached !== undefined) {
    return cached;
  }
  const config = buildThemeConfig(mode === "light" ? lightPalette : darkPalette);
  themeCache.set(mode, config);
  return config;
}

/** @deprecated Use `buildTheme(mode)`; kept as an alias for the dark theme. */
export const appTheme = buildTheme("dark");

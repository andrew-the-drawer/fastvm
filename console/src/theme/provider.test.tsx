import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { installMatchMedia } from "../components/test-dom";
import { buildTheme, darkPalette, lightPalette } from "../theme";
import { ThemeProvider } from "./ThemeProvider";
import { parseThemeMode, resolveThemeMode, THEME_STORAGE_KEY, useTheme } from "./theme-mode";

function ThemeProbe() {
  const { mode, resolvedMode, setMode } = useTheme();
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <span data-testid="resolved">{resolvedMode}</span>
      <button type="button" onClick={() => setMode("dark")}>
        set-dark
      </button>
      <button type="button" onClick={() => setMode("light")}>
        set-light
      </button>
      <button type="button" onClick={() => setMode("auto")}>
        set-auto
      </button>
    </div>
  );
}

function renderProbe() {
  return render(
    <ThemeProvider>
      <ThemeProbe />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.colorScheme = "";
});

afterEach(() => {
  cleanup();
});

describe("parseThemeMode", () => {
  it("accepts valid modes and falls back to auto", () => {
    expect(parseThemeMode("dark")).toBe("dark");
    expect(parseThemeMode("light")).toBe("light");
    expect(parseThemeMode("auto")).toBe("auto");
    expect(parseThemeMode("blue")).toBe("auto");
    expect(parseThemeMode(null)).toBe("auto");
    expect(parseThemeMode(undefined)).toBe("auto");
  });
});

describe("resolveThemeMode", () => {
  it("resolves auto from the OS preference", () => {
    expect(resolveThemeMode("auto", true)).toBe("dark");
    expect(resolveThemeMode("auto", false)).toBe("light");
  });

  it("keeps explicit modes regardless of the OS preference", () => {
    expect(resolveThemeMode("dark", false)).toBe("dark");
    expect(resolveThemeMode("light", true)).toBe("light");
  });
});

describe("ThemeProvider", () => {
  it("defaults to auto and applies the system theme to <html>", () => {
    installMatchMedia(true);
    renderProbe();

    expect(screen.getByTestId("mode")).toHaveTextContent("auto");
    expect(screen.getByTestId("resolved")).toHaveTextContent("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("restores a persisted mode on mount", () => {
    installMatchMedia(true);
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    renderProbe();

    expect(screen.getByTestId("mode")).toHaveTextContent("light");
    expect(screen.getByTestId("resolved")).toHaveTextContent("light");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("ignores invalid persisted values", () => {
    installMatchMedia(false);
    window.localStorage.setItem(THEME_STORAGE_KEY, "solarized");
    renderProbe();
    expect(screen.getByTestId("mode")).toHaveTextContent("auto");
  });

  it("applies and persists explicit selections immediately", () => {
    installMatchMedia(true);
    renderProbe();

    fireEvent.click(screen.getByRole("button", { name: "set-light" }));
    expect(screen.getByTestId("resolved")).toHaveTextContent("light");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");

    fireEvent.click(screen.getByRole("button", { name: "set-dark" }));
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("follows live system changes in auto mode only", () => {
    const media = installMatchMedia(false);
    renderProbe();
    expect(screen.getByTestId("resolved")).toHaveTextContent("light");

    media.setSystemDark(true);
    expect(screen.getByTestId("resolved")).toHaveTextContent("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");

    fireEvent.click(screen.getByRole("button", { name: "set-light" }));
    media.setSystemDark(true);
    expect(screen.getByTestId("resolved")).toHaveTextContent("light");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");

    fireEvent.click(screen.getByRole("button", { name: "set-auto" }));
    expect(screen.getByTestId("resolved")).toHaveTextContent("dark");
  });
});

describe("buildTheme", () => {
  it("builds matching light and dark antd token sets", () => {
    const dark = buildTheme("dark");
    const light = buildTheme("light");

    expect(dark.token?.colorPrimary).toBe(darkPalette.accent);
    expect(light.token?.colorPrimary).toBe(lightPalette.accent);
    expect(dark.components?.Layout?.headerBg).toBe(darkPalette.bgHeader);
    expect(light.components?.Layout?.headerBg).toBe(lightPalette.bgHeader);
    expect(light.token?.colorBgContainer).toBe("#ffffff");
    expect(dark.token?.colorBgContainer).toBe(darkPalette.bgContainer);
    // Cached so ConfigProvider keeps a stable theme object.
    expect(buildTheme("light")).toBe(light);
  });
});

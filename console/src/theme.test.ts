import { describe, expect, it } from "vite-plus/test";
import { darkPalette, lightPalette, terminalTheme } from "./theme";

describe("terminalTheme", () => {
  it("builds a dark terminal palette from the dark theme", () => {
    const theme = terminalTheme("dark");

    expect(theme.background).toBe("#030712");
    expect(theme.foreground).toBe(darkPalette.text);
    expect(theme.cursor).toBe(darkPalette.accent);
    expect(theme.selectionBackground).toMatch(/^rgba\(/);
    expect(theme.red).toBe("#f87171");
    expect(theme.brightWhite).toBe("#f9fafb");
    expect(Object.keys(theme)).toHaveLength(22);
  });

  it("builds a light terminal palette tuned for white backgrounds", () => {
    const theme = terminalTheme("light");

    expect(theme.background).toBe("#ffffff");
    expect(theme.foreground).toBe(lightPalette.text);
    expect(theme.cursor).toBe(lightPalette.accent);
    // "white" would vanish on a near-white canvas; use a readable grey instead.
    expect(theme.white).toBe("#4b5563");
    expect(theme.black).toBe("#111827");
    expect(theme.red).toBe("#b91c1c");
  });

  it("keeps dark and light terminal palettes distinct", () => {
    const dark = terminalTheme("dark");
    const light = terminalTheme("light");

    expect(dark.background).not.toBe(light.background);
    expect(dark.foreground).not.toBe(light.foreground);
    expect(dark.cursor).not.toBe(light.cursor);
    expect(dark.selectionBackground).not.toBe(light.selectionBackground);
  });
});

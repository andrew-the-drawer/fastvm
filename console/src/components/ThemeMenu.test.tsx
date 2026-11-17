import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { THEME_STORAGE_KEY } from "../theme/theme-mode";
import { ThemeProvider } from "../theme/ThemeProvider";
import { installDomStubs, installMatchMedia } from "./test-dom";
import type { MatchMediaHarness } from "./test-dom";
import { ThemeMenu } from "./ThemeMenu";

let media: MatchMediaHarness;

beforeEach(() => {
  installDomStubs();
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.colorScheme = "";
  media = installMatchMedia(false);
});

afterEach(cleanup);

function renderMenu() {
  return render(
    <ThemeProvider>
      <ThemeMenu />
    </ThemeProvider>,
  );
}

async function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: "Theme" }));
  return screen.findAllByRole("menuitem");
}

function menuItems(): HTMLElement[] {
  return screen.getAllByRole("menuitem");
}

function hasCheck(item: HTMLElement): boolean {
  // Inactive items render only the mode icon; the active item also renders the
  // check glyph from the shared dropdown primitive.
  return item.querySelectorAll("svg").length === 2;
}

describe("ThemeMenu", () => {
  it("opens a menu with dark/light/auto options and marks the active one", async () => {
    renderMenu();

    const trigger = screen.getByRole("button", { name: "Theme" });
    expect(screen.getByTitle(/Auto/)).toBeInTheDocument();
    expect(trigger).toBeInTheDocument();

    await openMenu();
    expect(menuItems()).toHaveLength(3);
    const labels = menuItems().map((item) => item.textContent);
    expect(labels.join(" ")).toMatch(/Dark/);
    expect(labels.join(" ")).toMatch(/Light/);
    expect(labels.join(" ")).toMatch(/Auto \(system\)/);

    const autoItem = screen.getByRole("menuitem", { name: /Auto \(system\)/ });
    expect(hasCheck(autoItem)).toBe(true);
    expect(hasCheck(screen.getByRole("menuitem", { name: /Dark/ }))).toBe(false);
  });

  it("applies Light immediately, persists it and closes the menu", async () => {
    renderMenu();
    await openMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: /Light/ }));

    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    await waitFor(() => {
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });
  });

  it("switches to Dark and remembers the selection", async () => {
    renderMenu();
    await openMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: /Dark/ }));

    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");

    // Opening again reflects the persisted choice as the checked item.
    await openMenu();
    expect(hasCheck(screen.getByRole("menuitem", { name: /Dark/ }))).toBe(true);
  });

  it("returns to Auto and follows live system changes", async () => {
    renderMenu();
    await openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /Dark/ }));
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");

    await openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /Auto \(system\)/ }));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("auto");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");

    media.setSystemDark(true);
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });

  it("closes on Escape", async () => {
    renderMenu();
    await openMenu();

    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });
  });
});

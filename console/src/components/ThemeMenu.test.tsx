import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { THEME_STORAGE_KEY } from "../theme/theme-mode";
import { ThemeProvider } from "../theme/ThemeProvider";
import { installMatchMedia } from "./test-dom";
import type { MatchMediaHarness } from "./test-dom";
import { ThemeMenu } from "./ThemeMenu";

let media: MatchMediaHarness;

beforeEach(() => {
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
  return screen.findAllByRole("menuitemradio");
}

function menuOptions(): void {
  expect(screen.getAllByRole("menuitemradio")).toHaveLength(3);
}

describe("ThemeMenu", () => {
  it("opens a menu with dark/light/auto radio options", async () => {
    renderMenu();

    const trigger = screen.getByRole("button", { name: "Theme" });
    expect(trigger.getAttribute("title")).toMatch(/Auto/);

    await openMenu();
    menuOptions();
    expect(screen.getByRole("menuitemradio", { name: /Dark/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: /Light/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: /Auto \(system\)/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("applies Light immediately, persists it and closes the menu", async () => {
    renderMenu();
    await openMenu();

    fireEvent.click(screen.getByRole("menuitemradio", { name: /Light/ }));

    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    await waitFor(() => {
      expect(screen.queryByRole("menuitemradio")).not.toBeInTheDocument();
    });
  });

  it("switches to Dark and remembers the selection", async () => {
    renderMenu();
    await openMenu();

    fireEvent.click(screen.getByRole("menuitemradio", { name: /Dark/ }));

    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");

    // Opening again reflects the persisted choice as checked.
    await openMenu();
    expect(screen.getByRole("menuitemradio", { name: /Dark/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("returns to Auto and follows live system changes", async () => {
    renderMenu();
    await openMenu();
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Dark/ }));
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");

    await openMenu();
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Auto \(system\)/ }));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("auto");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");

    media.setSystemDark(true);
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });

  it("closes on Escape", async () => {
    renderMenu();
    await openMenu();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("menuitemradio")).not.toBeInTheDocument();
    });
  });
});

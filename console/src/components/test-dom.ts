import { act } from "@testing-library/react";

/**
 * jsdom lacks a couple of browser APIs that antd's responsive observer and
 * ResizeObserver-driven components expect. Tests call this once before
 * rendering; it is intentionally a no-op when the APIs already exist.
 */
export function installDomStubs(): void {
  if (typeof window === "undefined") {
    return;
  }

  if (typeof window.matchMedia !== "function") {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }

  if (typeof globalThis.ResizeObserver !== "function") {
    class ResizeObserverStub {
      observe(): void {}

      unobserve(): void {}

      disconnect(): void {}
    }
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      writable: true,
      value: ResizeObserverStub,
    });
  }

  if (typeof window.scrollTo !== "function") {
    Object.defineProperty(window, "scrollTo", {
      configurable: true,
      writable: true,
      value: () => {},
    });
  }
}

/** Controllable `matchMedia("(prefers-color-scheme: dark)")` for theme tests. */
export interface MatchMediaHarness {
  /** Flip the OS preference and notify subscribers (wrapped in `act`). */
  setSystemDark: (next: boolean) => void;
}

export function installMatchMedia(initiallyDark: boolean): MatchMediaHarness {
  const state = { matches: initiallyDark };
  const query = "(prefers-color-scheme: dark)";
  const listeners = new Set<(event: MediaQueryListEvent) => void>();

  const mediaQueryList = {
    get matches() {
      return state.matches;
    },
    media: query,
    onchange: null,
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    },
    addListener: (listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    },
    removeListener: (listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    },
    dispatchEvent: () => true,
  } as unknown as MediaQueryList;

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: () => mediaQueryList,
  });

  return {
    setSystemDark(next: boolean) {
      state.matches = next;
      const event = { matches: next, media: query } as MediaQueryListEvent;
      act(() => {
        for (const listener of listeners) {
          listener(event);
        }
      });
    },
  };
}

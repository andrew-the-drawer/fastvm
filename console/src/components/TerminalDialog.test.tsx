import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { Sandbox } from "../lib/types";
import { ThemeProvider } from "../theme/ThemeProvider";
import { installDomStubs } from "./test-dom";
import { TerminalDialog } from "./TerminalDialog";

interface ShellCallbacksLike {
  onOpen?: () => void;
  onOutput?: (data: Uint8Array) => void;
  onExit?: (code: number | null) => void;
  onError?: (message: string) => void;
}

interface ShellHandleLike {
  state: string;
  inputs: string[];
  resizes: Array<[number, number]>;
  closed: boolean;
  sendInput(data: string): void;
  resize(cols: number, rows: number): void;
  close(): void;
}

interface ShellCall {
  ref: string;
  options: { cols: number; rows: number };
  callbacks: ShellCallbacksLike;
  handle: ShellHandleLike;
}

const ghostty = vi.hoisted(() => {
  class FakeTerminal {
    cols = 100;
    rows = 30;
    options: Record<string, unknown>;
    written: Array<string | Uint8Array> = [];
    dataListeners: Array<(data: string) => void> = [];
    resizeListeners: Array<(size: { cols: number; rows: number }) => void> = [];
    disposed = false;
    focusCount = 0;

    constructor(options: Record<string, unknown> = {}) {
      this.options = options;
      state.terminals.push(this);
    }

    loadAddon(): void {}

    open(): void {}

    focus(): void {
      this.focusCount += 1;
    }

    dispose(): void {
      this.disposed = true;
    }

    write(data: string | Uint8Array): void {
      this.written.push(data);
    }

    onData(listener: (data: string) => void): { dispose(): void } {
      this.dataListeners.push(listener);
      return { dispose: () => {} };
    }

    onResize(listener: (size: { cols: number; rows: number }) => void): { dispose(): void } {
      this.resizeListeners.push(listener);
      return { dispose: () => {} };
    }

    emitData(data: string): void {
      for (const listener of this.dataListeners) {
        listener(data);
      }
    }

    emitResize(cols: number, rows: number): void {
      for (const listener of this.resizeListeners) {
        listener({ cols, rows });
      }
    }
  }

  class FakeFitAddon {
    fits = 0;
    observed = 0;
    disposed = false;

    constructor() {
      state.fitAddons.push(this);
    }

    fit(): void {
      this.fits += 1;
    }

    observeResize(): void {
      this.observed += 1;
    }

    dispose(): void {
      this.disposed = true;
    }
  }

  const state = {
    terminals: [] as FakeTerminal[],
    fitAddons: [] as FakeFitAddon[],
    initCalls: 0,
  };

  return { FakeTerminal, FakeFitAddon, state };
});

const shell = vi.hoisted(() => {
  const calls: ShellCall[] = [];
  return {
    calls,
    connectShell(
      ref: string,
      options: { cols: number; rows: number },
      callbacks: ShellCallbacksLike = {},
    ): ShellHandleLike {
      const handle: ShellHandleLike = {
        state: "open",
        inputs: [],
        resizes: [],
        closed: false,
        sendInput(data: string) {
          handle.inputs.push(data);
        },
        resize(cols: number, rows: number) {
          handle.resizes.push([cols, rows]);
        },
        close() {
          handle.closed = true;
        },
      };
      calls.push({ ref, options, callbacks, handle });
      return handle;
    },
  };
});

vi.mock("ghostty-web", () => ({
  init: async () => {
    ghostty.state.initCalls += 1;
  },
  Terminal: ghostty.FakeTerminal,
  FitAddon: ghostty.FakeFitAddon,
}));

vi.mock("../lib/shell", () => ({
  connectShell: (
    ref: string,
    options: { cols: number; rows: number },
    callbacks?: ShellCallbacksLike,
  ) => shell.connectShell(ref, options, callbacks),
}));

const sandbox: Sandbox = {
  id: "sandbox-1",
  name: "web-1",
  state: "Running",
  base_disk: "sha256:image",
  vcpus: 2,
  memory_mb: 512,
  wake_count: 0,
  no_auto_sleep: false,
  last_activity_at: "2024-06-15T12:34:56Z",
  created_at: "2024-06-15T12:34:56Z",
  updated_at: "2024-06-15T12:34:56Z",
};

beforeEach(() => {
  installDomStubs();
  ghostty.state.terminals.length = 0;
  ghostty.state.fitAddons.length = 0;
  shell.calls.length = 0;
});

afterEach(cleanup);

function renderDialog() {
  const onClose = vi.fn();
  const result = render(
    <ThemeProvider>
      <TerminalDialog sandbox={sandbox} open onClose={onClose} />
    </ThemeProvider>,
  );
  return { ...result, onClose };
}

async function waitForShellCall(): Promise<ShellCall> {
  await waitFor(
    () => {
      expect(shell.calls).toHaveLength(1);
    },
    { timeout: 3_000 },
  );
  return shell.calls[0];
}

async function markConnected(call: ShellCall): Promise<void> {
  await act(async () => {
    call.callbacks.onOpen?.();
  });
  expect(await screen.findByText("Connected")).toBeInTheDocument();
}

describe("TerminalDialog", () => {
  it("connects with the sandbox ref and the fitted terminal size", async () => {
    renderDialog();
    const call = await waitForShellCall();

    expect(ghostty.state.initCalls).toBeGreaterThanOrEqual(1);
    expect(call.ref).toBe("sandbox-1");
    expect(call.options).toEqual({ cols: 100, rows: 30 });
    expect(ghostty.state.terminals).toHaveLength(1);
    expect(ghostty.state.fitAddons).toHaveLength(1);
    expect(ghostty.state.fitAddons[0].fits).toBeGreaterThanOrEqual(1);
    expect(ghostty.state.fitAddons[0].observed).toBe(1);
    expect(ghostty.state.terminals[0].focusCount).toBe(1);
    expect(screen.getByText("web-1")).toBeInTheDocument();
    expect(screen.getByText(/Ctrl\+C sends interrupt/)).toBeInTheDocument();
  });

  it("clears any inherited screen and scrollback before the shell starts", async () => {
    renderDialog();
    const call = await waitForShellCall();
    // ghostty-web 0.4.0 can reuse WASM screen state between Terminal instances;
    // the dialog must wipe it before the new shell's prompt arrives.
    expect(ghostty.state.terminals[0].written[0]).toBe("\x1b[2J\x1b[3J\x1b[H");
    expect(call.options).toEqual({ cols: 100, rows: 30 });
    await markConnected(call);
  });

  it("forwards typed data and resizes to the shell", async () => {
    renderDialog();
    const call = await waitForShellCall();
    await markConnected(call);
    const terminal = ghostty.state.terminals[0];

    act(() => {
      terminal.emitData("ls -la\r");
    });
    expect(call.handle.inputs).toEqual(["ls -la\r"]);

    act(() => {
      terminal.emitResize(120, 40);
    });
    expect(call.handle.resizes).toEqual([[120, 40]]);
  });

  it("writes shell output bytes into the terminal", async () => {
    renderDialog();
    const call = await waitForShellCall();
    const terminal = ghostty.state.terminals[0];
    const output = new Uint8Array([104, 105, 10]);

    act(() => {
      call.callbacks.onOutput?.(output);
    });
    expect(terminal.written).toContain(output);
  });

  it("shows the exit code and keeps the output on screen", async () => {
    renderDialog();
    const call = await waitForShellCall();
    await markConnected(call);

    act(() => {
      call.callbacks.onExit?.(7);
    });

    expect(await screen.findByText("Session ended (exit 7)")).toBeInTheDocument();
    expect(screen.getByText(/The shell exited/)).toBeInTheDocument();
    expect(ghostty.state.terminals[0].disposed).toBe(false);
  });

  it("shows the error message from the daemon", async () => {
    renderDialog();
    const call = await waitForShellCall();

    act(() => {
      call.callbacks.onError?.("agent not reachable");
    });

    expect(await screen.findByText("Connection error")).toBeInTheDocument();
    expect(screen.getByText("agent not reachable")).toBeInTheDocument();
  });

  it("closes the socket and disposes the terminal when the dialog closes", async () => {
    const { onClose, rerender } = renderDialog();
    const call = await waitForShellCall();
    const terminal = ghostty.state.terminals[0];
    const fitAddon = ghostty.state.fitAddons[0];

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(
      <ThemeProvider>
        <TerminalDialog sandbox={sandbox} open={false} onClose={onClose} />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(call.handle.closed).toBe(true);
      expect(terminal.disposed).toBe(true);
      expect(fitAddon.disposed).toBe(true);
    });
  });

  it("reconnect tears the old session down and starts a new one", async () => {
    renderDialog();
    const firstCall = await waitForShellCall();
    await markConnected(firstCall);
    const firstTerminal = ghostty.state.terminals[0];

    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));

    await waitFor(() => {
      expect(shell.calls).toHaveLength(2);
    });
    const secondCall = shell.calls[1];
    expect(secondCall.ref).toBe("sandbox-1");
    expect(secondCall.options).toEqual({ cols: 100, rows: 30 });
    expect(firstCall.handle.closed).toBe(true);
    expect(firstTerminal.disposed).toBe(true);
    expect(ghostty.state.terminals).toHaveLength(2);

    await markConnected(secondCall);
  });
});

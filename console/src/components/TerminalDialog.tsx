import { Button, Modal, Spin, Tag } from "antd";
import { useEffect, useRef, useState } from "react";
import type { FitAddon as GhosttyFitAddon, Terminal as GhosttyTerminal } from "ghostty-web";
import { connectShell } from "../lib/shell";
import type { ShellHandle } from "../lib/shell";
import type { Sandbox } from "../lib/types";
import { monoFontFamily, terminalTheme } from "../theme";
import { useTheme } from "../theme/theme-mode";
import { describeError } from "../utils/errors";
import { shortId } from "../utils/format";
import { RefreshIcon, TerminalIcon } from "./icons";
import { VmStatusTag } from "./VmStatusTag";

type GhosttyModule = typeof import("ghostty-web");
type GhosttyImports = Pick<GhosttyModule, "Terminal" | "FitAddon">;

/** Only one WASM `init()` per page, shared by every terminal dialog. */
let ghosttyImportsPromise: Promise<GhosttyImports> | null = null;

async function loadGhostty(): Promise<GhosttyImports> {
  if (ghosttyImportsPromise === null) {
    ghosttyImportsPromise = (async () => {
      // Dynamic import keeps the ~400 KiB ghostty WASM bundle out of the initial
      // console chunk; it is fetched the first time a terminal is opened.
      const module = await import("ghostty-web");
      await module.init();
      return { Terminal: module.Terminal, FitAddon: module.FitAddon };
    })().catch((error: unknown) => {
      ghosttyImportsPromise = null;
      throw error;
    });
  }
  return ghosttyImportsPromise;
}

type TerminalStatusKind = "connecting" | "connected" | "exited" | "error";

interface TerminalStatus {
  /** Session generation this status belongs to; stale statuses are ignored. */
  readonly session: number;
  readonly kind: TerminalStatusKind;
  readonly exitCode?: number | null;
  readonly message?: string;
}

const INITIAL_STATUS: TerminalStatus = { session: 0, kind: "connecting" };

function exitLabel(exitCode: number | null | undefined): string {
  if (exitCode === null || exitCode === undefined) {
    return "Session ended";
  }
  return `Session ended (exit ${exitCode})`;
}

function TerminalStatusTag({ status }: { status: TerminalStatus }) {
  switch (status.kind) {
    case "connecting":
      return (
        <Tag color="processing" className="terminal-status-tag">
          <Spin size="small" /> Connecting…
        </Tag>
      );
    case "connected":
      return (
        <Tag color="success" className="terminal-status-tag">
          Connected
        </Tag>
      );
    case "exited":
      return (
        <Tag color="default" className="terminal-status-tag">
          {exitLabel(status.exitCode)}
        </Tag>
      );
    case "error":
      return (
        <Tag color="error" className="terminal-status-tag" title={status.message}>
          Connection error
        </Tag>
      );
  }
}

export interface TerminalDialogProps {
  sandbox: Sandbox | null;
  open: boolean;
  onClose: () => void;
  /** Fired after the closing animation; lets the parent unmount the dialog. */
  onClosed?: () => void;
}

/**
 * Interactive shell over the fastvmd exec WebSocket. A fresh ghostty terminal +
 * WebSocket session is created every time the dialog opens or Reconnect is
 * pressed; closing/disposing always tears both down.
 */
export function TerminalDialog({ sandbox, open, onClose, onClosed }: TerminalDialogProps) {
  const { resolvedMode } = useTheme();
  // The antd Modal mounts its body after the dialog effect can run, so the
  // terminal container arrives through a callback-ref state instead of a ref.
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const terminalRef = useRef<GhosttyTerminal | null>(null);
  const resolvedModeRef = useRef(resolvedMode);
  const [session, setSession] = useState(0);
  const [status, setStatus] = useState<TerminalStatus>(INITIAL_STATUS);

  const sandboxRef = sandbox?.id;

  useEffect(() => {
    resolvedModeRef.current = resolvedMode;
  }, [resolvedMode]);

  useEffect(() => {
    if (!open || sandboxRef === undefined || container === null) {
      return undefined;
    }
    const sessionId = session;
    let disposed = false;
    let handle: ShellHandle | null = null;
    let terminal: GhosttyTerminal | null = null;
    let fitAddon: GhosttyFitAddon | null = null;
    const disposables: Array<{ dispose(): void }> = [];

    const setSessionStatus = (next: Omit<TerminalStatus, "session">) => {
      if (!disposed) {
        setStatus({ session: sessionId, ...next });
      }
    };

    const start = async () => {
      try {
        const { Terminal: TerminalCtor, FitAddon: FitCtor } = await loadGhostty();
        // The dialog may have been closed while the WASM bundle was loading.
        if (disposed) {
          return;
        }
        container.replaceChildren();
        terminal = new TerminalCtor({
          fontSize: 14,
          fontFamily: monoFontFamily,
          cursorBlink: true,
          scrollback: 10_000,
          theme: terminalTheme(resolvedModeRef.current),
        });
        terminalRef.current = terminal;
        fitAddon = new FitCtor();
        terminal.loadAddon(fitAddon);
        terminal.open(container);
        fitAddon.fit();
        fitAddon.observeResize();
        terminal.focus();

        // ghostty-web 0.4.0 can carry WASM screen state over from a previously
        // disposed Terminal, so a fresh session may inherit the old history.
        // Clear the screen and scrollback (ED 2 + ED 3 + cursor home) before the
        // new shell writes its prompt; the write queue preserves this ordering.
        terminal.write("\x1b[2J\x1b[3J\x1b[H");

        disposables.push(
          terminal.onData((data) => {
            handle?.sendInput(data);
          }),
          terminal.onResize(({ cols, rows }) => {
            handle?.resize(cols, rows);
          }),
        );

        const cols = terminal.cols > 0 ? terminal.cols : 80;
        const rows = terminal.rows > 0 ? terminal.rows : 24;
        handle = connectShell(
          sandboxRef,
          { cols, rows },
          {
            onOpen: () => {
              setSessionStatus({ kind: "connected" });
            },
            onOutput: (data) => {
              terminal?.write(data);
            },
            onExit: (code) => {
              setSessionStatus({ kind: "exited", exitCode: code });
            },
            onError: (message) => {
              setSessionStatus({ kind: "error", message });
            },
          },
        );
      } catch (error) {
        setSessionStatus({ kind: "error", message: describeError(error) });
      }
    };

    void start();

    return () => {
      disposed = true;
      for (const disposable of disposables) {
        try {
          disposable.dispose();
        } catch {
          // Terminal is already disposed; nothing left to unregister.
        }
      }
      try {
        fitAddon?.dispose();
      } catch {
        // Best effort during teardown.
      }
      try {
        terminal?.dispose();
      } catch {
        // Best effort during teardown.
      }
      terminalRef.current = null;
      try {
        handle?.close();
      } catch {
        // Socket already closed.
      }
      container.replaceChildren();
    };
  }, [open, sandboxRef, session, container]);

  // Live theme switch keeps the session (and scrollback) intact.
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!open || terminal === null) {
      return;
    }
    try {
      terminal.options.theme = terminalTheme(resolvedMode);
    } catch {
      // Some terminals freeze options; a failed repaint must not kill the session.
    }
  }, [open, resolvedMode]);

  const effectiveStatus: TerminalStatus = status.session === session ? status : INITIAL_STATUS;
  const connecting = effectiveStatus.kind === "connecting";

  const title = (
    <div className="terminal-title">
      <span className="terminal-title-main">
        <span className="terminal-title-icon" aria-hidden="true">
          <TerminalIcon />
        </span>
        <span className="terminal-title-name">{sandbox?.name ?? "Terminal"}</span>
        {sandbox !== null ? (
          <span className="terminal-title-id">{shortId(sandbox.id, 12)}</span>
        ) : null}
        {sandbox !== null ? <VmStatusTag state={sandbox.state} showTooltip={false} /> : null}
      </span>
      <TerminalStatusTag status={effectiveStatus} />
    </div>
  );

  const footer = (
    <div className="terminal-footer">
      <span className="terminal-hint">
        <TerminalIcon /> Ctrl+C sends interrupt · closing ends the session
      </span>
      <span className="terminal-actions">
        <Button
          icon={<RefreshIcon />}
          onClick={() => {
            setSession((value) => value + 1);
          }}
          disabled={connecting}
        >
          Reconnect
        </Button>
        <Button onClick={onClose}>Close</Button>
      </span>
    </div>
  );

  return (
    <Modal
      open={open}
      onCancel={onClose}
      afterClose={onClosed}
      footer={footer}
      centered
      width={1100}
      keyboard={false}
      mask={{ closable: false }}
      closable={false}
      destroyOnHidden
      className="terminal-modal"
      styles={{ body: { padding: 0 } }}
      title={title}
    >
      <div className="terminal-body">
        {effectiveStatus.kind === "error" ? (
          <div className="terminal-error-banner" role="alert">
            {effectiveStatus.message ?? "Could not open a shell session."}
          </div>
        ) : null}
        {effectiveStatus.kind === "exited" ? (
          <div className="terminal-info-banner" role="status">
            The shell exited; the output above is preserved. Reconnect to start a new session.
          </div>
        ) : null}
        <div className="terminal-container" ref={setContainer} data-testid="terminal-container" />
      </div>
    </Modal>
  );
}

export default TerminalDialog;

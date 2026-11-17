import { Menu } from "@base-ui/react/menu";
import { Button } from "antd";
import type { Sandbox } from "../lib/types";
import {
  canDeepSleep,
  canDelete,
  canExec,
  canPause,
  canResume,
  type PendingAction,
  type VmActionKind,
} from "./vmActions";
import {
  InfoIcon,
  MoonIcon,
  MoreIcon,
  PauseIcon,
  PlayIcon,
  TerminalIcon,
  TrashIcon,
} from "./icons";

export interface VmActionsMenuProps {
  sandbox: Sandbox;
  pending: PendingAction | null;
  onAction: (kind: VmActionKind, sandbox: Sandbox) => void;
  onDetails: (sandbox: Sandbox) => void;
  /** Open an interactive shell; wakes paused/dormant sandboxes. */
  onExec: (sandbox: Sandbox) => void;
}

/**
 * Per-row lifecycle menu. Actions are disabled when the current state does not
 * accept them (fastvmd would reject those calls anyway) and while another
 * action for the same sandbox is in flight.
 */
export function VmActionsMenu({
  sandbox,
  pending,
  onAction,
  onDetails,
  onExec,
}: VmActionsMenuProps) {
  const busy = pending !== null;

  return (
    <span
      className="vm-actions-cell"
      onClick={(event) => {
        // The trigger lives inside a clickable table row; keep menu clicks local.
        event.stopPropagation();
      }}
    >
      <Menu.Root modal={false}>
        <Menu.Trigger
          render={
            <Button
              type="text"
              size="small"
              className="vm-actions-trigger"
              aria-label={`Actions for ${sandbox.name}`}
            />
          }
        >
          <MoreIcon />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner sideOffset={6} align="end" className="menu-positioner">
            <Menu.Popup className="vm-menu-popup">
              <Menu.Item
                className="vm-menu-item"
                onClick={() => {
                  onDetails(sandbox);
                }}
              >
                <InfoIcon />
                <span>Details</span>
              </Menu.Item>
              <Menu.Item
                className="vm-menu-item"
                disabled={busy || !canExec(sandbox.state)}
                title="Open an interactive shell; fastvmd wakes sleeping sandboxes."
                onClick={() => {
                  onExec(sandbox);
                }}
              >
                <TerminalIcon />
                <span>Open terminal</span>
              </Menu.Item>
              <Menu.Separator className="vm-menu-separator" />
              <Menu.Item
                className="vm-menu-item"
                disabled={busy || !canPause(sandbox.state)}
                title="Pause vCPUs; the sandbox wakes on the next packet."
                onClick={() => {
                  onAction("pause", sandbox);
                }}
              >
                <PauseIcon />
                <span>Pause</span>
              </Menu.Item>
              <Menu.Item
                className="vm-menu-item"
                disabled={busy || !canDeepSleep(sandbox.state)}
                title="Pause and offload guest memory to a file-backed snapshot."
                onClick={() => {
                  onAction("deepSleep", sandbox);
                }}
              >
                <MoonIcon />
                <span>Deep sleep</span>
              </Menu.Item>
              <Menu.Item
                className="vm-menu-item"
                disabled={busy || !canResume(sandbox.state)}
                title="Restart vCPUs and drain buffered traffic."
                onClick={() => {
                  onAction("resume", sandbox);
                }}
              >
                <PlayIcon />
                <span>Resume</span>
              </Menu.Item>
              <Menu.Separator className="vm-menu-separator" />
              <Menu.Item
                className="vm-menu-item vm-menu-item--danger"
                disabled={busy || !canDelete(sandbox.state)}
                title="Permanently remove the sandbox and its writable volume."
                onClick={() => {
                  onAction("delete", sandbox);
                }}
              >
                <TrashIcon />
                <span>Delete</span>
              </Menu.Item>
              {busy ? (
                <div className="vm-menu-note" role="status">
                  Working…
                </div>
              ) : null}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </span>
  );
}

export default VmActionsMenu;

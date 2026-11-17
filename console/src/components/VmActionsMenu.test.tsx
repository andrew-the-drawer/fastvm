import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { Sandbox } from "../lib/types";
import { VmActionsMenu } from "./VmActionsMenu";
import { installDomStubs } from "./test-dom";

afterEach(cleanup);

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

describe("VmActionsMenu", () => {
  it("opens the lifecycle menu and fires the action", async () => {
    installDomStubs();
    const onAction = vi.fn();
    const onDetails = vi.fn();

    render(
      <VmActionsMenu
        sandbox={sandbox}
        pending={null}
        onAction={onAction}
        onDetails={onDetails}
        onExec={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Actions for web-1" }));
    const pause = await screen.findByText("Pause");
    fireEvent.click(pause);

    expect(onAction).toHaveBeenCalledWith("pause", sandbox);
  });

  it("keeps menu clicks from bubbling to the clickable table row", async () => {
    installDomStubs();
    const rowClick = vi.fn();
    const onAction = vi.fn();

    render(
      <table>
        <tbody>
          <tr onClick={rowClick}>
            <td>
              <VmActionsMenu
                sandbox={sandbox}
                pending={null}
                onAction={onAction}
                onDetails={() => {}}
                onExec={() => {}}
              />
            </td>
          </tr>
        </tbody>
      </table>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Actions for web-1" }));
    expect(rowClick).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByText("Pause"));
    expect(rowClick).not.toHaveBeenCalled();
  });

  it("disables lifecycle actions that the state does not accept", async () => {
    installDomStubs();
    render(
      <VmActionsMenu
        sandbox={{ ...sandbox, state: "Paused" }}
        pending={null}
        onAction={() => {}}
        onDetails={() => {}}
        onExec={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Actions for web-1" }));
    const pause = (await screen.findByText("Pause")).closest("[role='menuitem']");
    expect(pause).toHaveAttribute("data-disabled");
  });

  it("opens a terminal for Running sandboxes", async () => {
    installDomStubs();
    const onExec = vi.fn();

    render(
      <VmActionsMenu
        sandbox={sandbox}
        pending={null}
        onAction={() => {}}
        onDetails={() => {}}
        onExec={onExec}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Actions for web-1" }));
    const item = (await screen.findByText("Open terminal")).closest("[role='menuitem']");
    expect(item).not.toHaveAttribute("data-disabled");

    fireEvent.click(screen.getByText("Open terminal"));
    expect(onExec).toHaveBeenCalledWith(sandbox);
  });

  it("disables the terminal action while the sandbox is still being created", async () => {
    installDomStubs();

    render(
      <VmActionsMenu
        sandbox={{ ...sandbox, state: "Creating" }}
        pending={null}
        onAction={() => {}}
        onDetails={() => {}}
        onExec={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Actions for web-1" }));
    const item = (await screen.findByText("Open terminal")).closest("[role='menuitem']");
    expect(item).toHaveAttribute("data-disabled");
  });
});

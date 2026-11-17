import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import type { SandboxState } from "../lib/types";
import { sandboxStateMeta } from "../utils/format";
import { VmStatusTag } from "./VmStatusTag";
import { installDomStubs } from "./test-dom";

const STATES: SandboxState[] = [
  "Creating",
  "Starting",
  "Running",
  "Idle",
  "Paused",
  "Dormant",
  "Resuming",
  "Stopping",
  "Stopped",
  "Failed",
];

afterEach(cleanup);

describe("VmStatusTag", () => {
  it("renders the lifecycle label for every state", () => {
    installDomStubs();
    for (const state of STATES) {
      const { unmount } = render(<VmStatusTag state={state} showTooltip={false} />);
      const label = screen.getByText(sandboxStateMeta(state).label);
      expect(label).toHaveAttribute("data-state", state);
      unmount();
    }
  });

  it("uses the antd tag color configured for the state", () => {
    installDomStubs();
    render(<VmStatusTag state="Running" showTooltip={false} />);
    const tag = screen.getByText("Running");
    expect(tag.className).toContain("green");
    expect(tag).toHaveClass("vm-status-tag");
  });
});

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
  it("renders the lifecycle label and data-state for every state", () => {
    installDomStubs();
    for (const state of STATES) {
      const { unmount } = render(<VmStatusTag state={state} showTooltip={false} />);
      const tag = screen.getByText(sandboxStateMeta(state).label);
      expect(tag).toHaveAttribute("data-state", state);
      expect(tag).toHaveClass("rounded-full");
      unmount();
    }
  });

  it("exposes the state description as a native tooltip by default", () => {
    installDomStubs();
    render(<VmStatusTag state="Running" />);
    const tag = screen.getByText("Running");
    expect(tag).toHaveAttribute("title", sandboxStateMeta("Running").description);
  });

  it("omits the tooltip when showTooltip is false", () => {
    installDomStubs();
    render(<VmStatusTag state="Dormant" showTooltip={false} />);
    expect(screen.getByText("Dormant")).not.toHaveAttribute("title");
  });

  it("uses HyperUI tone badges for the lifecycle states", () => {
    installDomStubs();
    const { unmount } = render(<VmStatusTag state="Running" showTooltip={false} />);
    expect(screen.getByText("Running").className).toContain("bg-green-100");
    unmount();

    const paused = render(<VmStatusTag state="Paused" showTooltip={false} />);
    expect(screen.getByText("Paused").className).toContain("bg-amber-100");
    paused.unmount();

    const dormant = render(<VmStatusTag state="Dormant" showTooltip={false} />);
    expect(screen.getByText("Dormant").className).toContain("bg-purple-100");
    dormant.unmount();

    render(<VmStatusTag state="Failed" showTooltip={false} />);
    expect(screen.getByText("Failed").className).toContain("bg-red-100");
  });
});

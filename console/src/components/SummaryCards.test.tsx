import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import type { Sandbox, SandboxState } from "../lib/types";
import { SummaryCards } from "./SummaryCards";
import { installDomStubs } from "./test-dom";

const CREATED_AT = "2024-06-15T12:34:56Z";

function sandbox(id: string, state: SandboxState): Sandbox {
  return {
    id,
    name: id,
    state,
    base_disk: "sha256:0123456789abcdef",
    vcpus: 2,
    memory_mb: 512,
    wake_count: 0,
    no_auto_sleep: false,
    last_activity_at: CREATED_AT,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
  };
}

afterEach(cleanup);

describe("SummaryCards", () => {
  it("counts total, running, sleeping and failed/stopped sandboxes", () => {
    installDomStubs();
    const sandboxes = [
      sandbox("running", "Running"),
      sandbox("idle", "Idle"),
      sandbox("paused", "Paused"),
      sandbox("dormant", "Dormant"),
      sandbox("failed", "Failed"),
      sandbox("stopped", "Stopped"),
      sandbox("creating", "Creating"),
    ];
    render(<SummaryCards sandboxes={sandboxes} />);

    expect(screen.getByText("Total VMs")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Sleeping")).toBeInTheDocument();
    expect(screen.getByText("Failed / stopped")).toBeInTheDocument();
    expect(screen.getByTestId("summary-value-total").closest("[data-tone]")).toHaveAttribute(
      "data-tone",
      "total",
    );

    const values = ["total", "running", "sleeping", "failed"].map(
      (key) => screen.getByTestId(`summary-value-${key}`).textContent,
    );
    expect(values).toEqual(["7", "2", "2", "2"]);
  });

  it("renders zero counts for an empty list", () => {
    installDomStubs();
    render(<SummaryCards sandboxes={[]} />);
    const values = ["total", "running", "sleeping", "failed"].map(
      (key) => screen.getByTestId(`summary-value-${key}`).textContent,
    );
    expect(values).toEqual(["0", "0", "0", "0"]);
  });
});

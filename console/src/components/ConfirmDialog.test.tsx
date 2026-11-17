import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { ConfirmDialog } from "./ConfirmDialog";
import { installDomStubs } from "./test-dom";

afterEach(cleanup);

describe("ConfirmDialog", () => {
  it("renders a modal dialog with its title, description and actions", async () => {
    installDomStubs();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <ConfirmDialog
        open
        danger
        title="Delete this sandbox?"
        description="web-1 and its volume will be removed."
        confirmLabel="Delete sandbox"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText("Delete this sandbox?")).toBeInTheDocument();
    expect(screen.getByText(/web-1 and its volume/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete sandbox" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("stays closed and renders nothing when open is false", () => {
    installDomStubs();
    render(
      <ConfirmDialog
        open={false}
        title="Delete this sandbox?"
        description="gone"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App as AntdApp } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { CreateVmModal } from "./CreateVmModal";
import { installDomStubs } from "./test-dom";

interface CreateSandboxMock {
  mutateAsync: ReturnType<typeof vi.fn>;
}

const queryMocks = vi.hoisted((): { create: CreateSandboxMock; images: unknown[] } => ({
  create: { mutateAsync: vi.fn() },
  images: [
    {
      name: "demo",
      tags: ["demo:latest"],
      digest: "sha256:abc123",
      size_bytes: 64 * 1024 * 1024,
      source: "docker",
      created_at: "2024-06-01T00:00:00Z",
    },
  ],
}));

vi.mock("../lib/queries", () => ({
  useImages: () => ({
    data: queryMocks.images,
    isPending: false,
    isError: false,
    error: null,
  }),
  useCreateSandbox: () => ({
    mutateAsync: queryMocks.create.mutateAsync,
    isPending: false,
  }),
}));

beforeEach(() => {
  installDomStubs();
  queryMocks.create.mutateAsync.mockReset();
  queryMocks.create.mutateAsync.mockResolvedValue({ id: "sb-1", name: "web-1" });
});

afterEach(cleanup);

function renderModal() {
  const onClose = vi.fn();
  const utils = render(
    <AntdApp>
      <CreateVmModal open onClose={onClose} />
    </AntdApp>,
  );
  return { ...utils, onClose };
}

async function chooseImage() {
  fireEvent.mouseDown(screen.getByRole("combobox"));
  fireEvent.click(await screen.findByText("demo:latest · 64 MiB"));
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: "Create VM" }));
}

describe("CreateVmModal host volumes", () => {
  it("sends the collected host volumes with the create payload", async () => {
    renderModal();
    await chooseImage();

    fireEvent.click(screen.getByRole("button", { name: "Add volume" }));
    fireEvent.change(screen.getByPlaceholderText("/host/dir"), {
      target: { value: "/srv/data" },
    });
    fireEvent.change(screen.getByPlaceholderText("/mnt/data"), {
      target: { value: "/mnt/data" },
    });
    fireEvent.click(screen.getByRole("switch", { name: "Read-only volume" }));

    submit();

    await waitFor(() => {
      expect(queryMocks.create.mutateAsync).toHaveBeenCalledTimes(1);
    });
    const input = queryMocks.create.mutateAsync.mock.calls[0][0] as {
      volumes?: unknown[];
    };
    expect(input.volumes).toEqual([
      { host_path: "/srv/data", guest_path: "/mnt/data", read_only: true },
    ]);
  });

  it("omits volumes when the list is empty", async () => {
    renderModal();
    await chooseImage();
    submit();

    await waitFor(() => {
      expect(queryMocks.create.mutateAsync).toHaveBeenCalledTimes(1);
    });
    const input = queryMocks.create.mutateAsync.mock.calls[0][0] as Record<string, unknown>;
    expect("volumes" in input).toBe(false);
  });

  it("supports multiple rows and removing one", async () => {
    renderModal();
    await chooseImage();

    fireEvent.click(screen.getByRole("button", { name: "Add volume" }));
    fireEvent.click(screen.getByRole("button", { name: "Add volume" }));
    expect(screen.getAllByPlaceholderText("/host/dir")).toHaveLength(2);

    const hostInputs = screen.getAllByPlaceholderText("/host/dir");
    const guestInputs = screen.getAllByPlaceholderText("/mnt/data");
    fireEvent.change(hostInputs[0], { target: { value: "/srv/one" } });
    fireEvent.change(guestInputs[0], { target: { value: "/mnt/one" } });

    fireEvent.click(screen.getAllByRole("button", { name: "Remove volume" })[1]);
    expect(screen.getAllByPlaceholderText("/host/dir")).toHaveLength(1);

    submit();
    await waitFor(() => {
      expect(queryMocks.create.mutateAsync).toHaveBeenCalledTimes(1);
    });
    const input = queryMocks.create.mutateAsync.mock.calls[0][0] as {
      volumes?: unknown[];
    };
    expect(input.volumes).toEqual([
      { host_path: "/srv/one", guest_path: "/mnt/one", read_only: false },
    ]);
  });

  it("validates absolute host and guest paths before submitting", async () => {
    renderModal();
    await chooseImage();
    fireEvent.click(screen.getByRole("button", { name: "Add volume" }));

    fireEvent.change(screen.getByPlaceholderText("/host/dir"), {
      target: { value: "relative/path" },
    });
    fireEvent.change(screen.getByPlaceholderText("/mnt/data"), {
      target: { value: "/mnt/with space" },
    });
    submit();

    expect(
      await screen.findByText("Host path must be absolute (start with /)."),
    ).toBeInTheDocument();
    expect(screen.getByText("Absolute path, no spaces, ':' or ','.")).toBeInTheDocument();
    expect(queryMocks.create.mutateAsync).not.toHaveBeenCalled();
  });
});

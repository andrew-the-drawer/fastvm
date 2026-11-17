import { useQueryClient } from "@tanstack/react-query";
import { App as AntdApp, Button, Layout } from "antd";
import { useCallback, useState } from "react";
import { AppHeader } from "../components/AppHeader";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { CreateVmModal } from "../components/CreateVmModal";
import { ClockIcon, PlusIcon, RefreshIcon } from "../components/icons";
import { SummaryCards } from "../components/SummaryCards";
import { TerminalDialog } from "../components/TerminalDialog";
import { VmDetailDrawer } from "../components/VmDetailDrawer";
import { VmTable } from "../components/VmTable";
import type { PendingAction, VmActionKind } from "../components/vmActions";
import {
  queryKeys,
  useDeleteSandbox,
  useImages,
  useSandboxes,
  useSleepSandbox,
  useWakeSandbox,
} from "../lib/queries";
import type { BaseDisk, Sandbox } from "../lib/types";
import { describeError } from "../utils/errors";
import { formatClockTime, formatDateTime } from "../utils/format";

const EMPTY_SANDBOXES: readonly Sandbox[] = [];
const EMPTY_IMAGES: readonly BaseDisk[] = [];

/**
 * Main console screen: polled sandbox list, summary counters, create flow,
 * lifecycle actions with confirmation, and a live detail drawer.
 */
export default function DashboardPage() {
  const { message } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const sandboxesQuery = useSandboxes();
  const imagesQuery = useImages();
  const sleepSandbox = useSleepSandbox();
  const wakeSandbox = useWakeSandbox();
  const deleteSandbox = useDeleteSandbox();

  const [createOpen, setCreateOpen] = useState(false);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Sandbox | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [detailSnapshot, setDetailSnapshot] = useState<Sandbox | null>(null);
  const [detailRef, setDetailRef] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [terminalTarget, setTerminalTarget] = useState<Sandbox | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);

  const sandboxes = sandboxesQuery.data ?? EMPTY_SANDBOXES;
  const images = imagesQuery.data ?? EMPTY_IMAGES;

  const detailSandbox =
    detailRef === null
      ? detailSnapshot
      : (sandboxes.find((sandbox) => sandbox.id === detailRef) ?? detailSnapshot);

  const terminalSandbox =
    terminalTarget === null
      ? null
      : (sandboxes.find((sandbox) => sandbox.id === terminalTarget.id) ?? terminalTarget);

  const openDetails = useCallback((sandbox: Sandbox) => {
    setDetailSnapshot(sandbox);
    setDetailRef(sandbox.id);
    setDrawerOpen(true);
  }, []);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
  }, []);

  const openTerminal = useCallback((sandbox: Sandbox) => {
    setTerminalTarget(sandbox);
    setTerminalOpen(true);
  }, []);

  const closeTerminal = useCallback(() => {
    setTerminalOpen(false);
  }, []);

  const clearTerminal = useCallback(() => {
    setTerminalOpen(false);
    setTerminalTarget(null);
  }, []);

  const clearDrawer = useCallback(() => {
    setDrawerOpen(false);
    setDetailRef(null);
    setDetailSnapshot(null);
  }, []);

  const handleRefresh = useCallback(async () => {
    setManualRefreshing(true);
    try {
      await sandboxesQuery.refetch();
    } finally {
      setManualRefreshing(false);
    }
  }, [sandboxesQuery]);

  const openDelete = useCallback((sandbox: Sandbox) => {
    setDeleteTarget(sandbox);
    setDeleteOpen(true);
  }, []);

  const handleAction = useCallback(
    async (kind: VmActionKind, sandbox: Sandbox) => {
      if (kind === "delete") {
        openDelete(sandbox);
        return;
      }
      if (pendingAction !== null) {
        return;
      }
      setPendingAction({ ref: sandbox.id, kind });
      try {
        if (kind === "pause") {
          await sleepSandbox.mutateAsync({ ref: sandbox.id, deep: false });
          message.success(`${sandbox.name} paused`);
        } else if (kind === "deepSleep") {
          await sleepSandbox.mutateAsync({ ref: sandbox.id, deep: true });
          message.success(`${sandbox.name} is deeply asleep`);
        } else {
          await wakeSandbox.mutateAsync(sandbox.id);
          message.success(`${sandbox.name} resumed`);
        }
      } catch (error) {
        message.error(describeError(error));
      } finally {
        setPendingAction(null);
      }
    },
    [message, openDelete, pendingAction, sleepSandbox, wakeSandbox],
  );

  const closeDelete = useCallback(() => {
    if (pendingAction?.kind === "delete") {
      return;
    }
    setDeleteOpen(false);
    setDeleteTarget(null);
  }, [pendingAction]);

  const confirmDelete = useCallback(async () => {
    if (deleteTarget === null) {
      return;
    }
    const target = deleteTarget;
    setPendingAction({ ref: target.id, kind: "delete" });
    try {
      await deleteSandbox.mutateAsync(target.id);
      // Remove the row immediately: its stats query would otherwise keep polling a
      // sandbox that no longer exists and log a 404 until the list refetch lands.
      queryClient.setQueryData<Sandbox[]>(queryKeys.sandboxes, (previous) =>
        previous === undefined ? previous : previous.filter((sandbox) => sandbox.id !== target.id),
      );
      queryClient.removeQueries({ queryKey: queryKeys.sandboxStats(target.id) });
      message.success(`Deleted ${target.name}`);
      setDeleteOpen(false);
      setDeleteTarget(null);
      if (detailRef === target.id) {
        clearDrawer();
      }
      if (terminalTarget?.id === target.id) {
        clearTerminal();
      }
    } catch (error) {
      message.error(describeError(error));
    } finally {
      setPendingAction(null);
    }
  }, [
    clearDrawer,
    clearTerminal,
    deleteSandbox,
    deleteTarget,
    detailRef,
    message,
    queryClient,
    terminalTarget,
  ]);

  const deleting = pendingAction?.kind === "delete";
  const listError = sandboxesQuery.isError ? describeError(sandboxesQuery.error) : null;
  const lastUpdated = sandboxesQuery.dataUpdatedAt;
  const lastUpdatedLabel = lastUpdated > 0 ? formatClockTime(lastUpdated) : "—";

  return (
    <Layout className="app-shell">
      <AppHeader isRefreshing={manualRefreshing} onRefresh={() => void handleRefresh()} />

      <Layout.Content className="dashboard-content">
        <div className="dashboard-heading">
          <div>
            <h1 className="dashboard-title">Sandboxes</h1>
            <p className="dashboard-subtitle">
              Micro-VMs on this host. Pause, offload, or wake them — traffic brings them back.
            </p>
          </div>
          <div className="dashboard-meta">
            <span className="last-updated" title={formatDateTime(lastUpdated)}>
              <ClockIcon /> Last updated {lastUpdatedLabel}
            </span>
          </div>
        </div>

        <SummaryCards sandboxes={sandboxes} loading={sandboxesQuery.isPending} />

        <section className="vm-panel" aria-label="Virtual machines">
          <div className="vm-toolbar">
            <div className="vm-toolbar-group">
              <Button type="primary" icon={<PlusIcon />} onClick={() => setCreateOpen(true)}>
                Create VM
              </Button>
              <Button
                icon={<RefreshIcon />}
                onClick={() => void handleRefresh()}
                loading={manualRefreshing}
              >
                Refresh
              </Button>
            </div>
            <div className="vm-toolbar-group vm-toolbar-group--meta">
              <span className="toolbar-hint">
                <span className="live-dot" aria-hidden="true" />
                Updates every 3s · stats every 2s
              </span>
              <span className="toolbar-count">
                {sandboxes.length} VM{sandboxes.length === 1 ? "" : "s"}
              </span>
            </div>
          </div>

          <VmTable
            sandboxes={sandboxes}
            images={images}
            loading={sandboxesQuery.isPending || manualRefreshing}
            error={listError}
            pendingAction={pendingAction}
            onCreate={() => setCreateOpen(true)}
            onRetry={() => void handleRefresh()}
            onDetails={openDetails}
            onAction={(kind, sandbox) => void handleAction(kind, sandbox)}
            onExec={openTerminal}
          />
        </section>
      </Layout.Content>

      <CreateVmModal open={createOpen} onClose={() => setCreateOpen(false)} />

      <ConfirmDialog
        open={deleteOpen}
        danger
        loading={deleting}
        title="Delete this sandbox?"
        confirmLabel="Delete sandbox"
        onConfirm={() => void confirmDelete()}
        onCancel={closeDelete}
        description={
          <span>
            <strong>{deleteTarget?.name ?? "This sandbox"}</strong> and its writable volume will be
            removed permanently. Any running workload stops immediately and the scratch disk is
            discarded. This cannot be undone.
          </span>
        }
      />

      {detailSnapshot !== null ? (
        <VmDetailDrawer
          sandbox={detailSandbox}
          open={drawerOpen}
          images={images}
          pendingAction={pendingAction}
          onClose={closeDrawer}
          onClosed={clearDrawer}
          onAction={(kind, sandbox) => void handleAction(kind, sandbox)}
          onExec={openTerminal}
        />
      ) : null}

      {terminalTarget !== null ? (
        <TerminalDialog
          sandbox={terminalSandbox}
          open={terminalOpen}
          onClose={closeTerminal}
          onClosed={clearTerminal}
        />
      ) : null}
    </Layout>
  );
}

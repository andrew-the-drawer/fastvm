import { useQueries } from "@tanstack/react-query";
import { Alert, Button, Empty, Progress, Skeleton, Table, Tag, Tooltip } from "antd";
import type { TableColumnsType } from "antd";
import { getSandboxStats } from "../lib/api";
import { queryKeys } from "../lib/queries";
import type { BaseDisk, Sandbox, SandboxState } from "../lib/types";
import {
  clampPercent,
  DASH,
  formatBytes,
  formatDuration,
  formatPercent,
  imageLabel,
  shortDigest,
  shortId,
} from "../utils/format";
import { PlusIcon } from "./icons";
import type { PendingAction, VmActionKind } from "./vmActions";
import { VmActionsMenu } from "./VmActionsMenu";
import { VmStatusTag } from "./VmStatusTag";

export interface VmTableProps {
  sandboxes: readonly Sandbox[];
  images: readonly BaseDisk[];
  loading: boolean;
  error: string | null;
  pendingAction: PendingAction | null;
  onCreate: () => void;
  onRetry: () => void;
  onDetails: (sandbox: Sandbox) => void;
  onAction: (kind: VmActionKind, sandbox: Sandbox) => void;
  onExec: (sandbox: Sandbox) => void;
}

function cpuColor(percent: number): string {
  if (percent >= 85) {
    return "#f87171";
  }
  if (percent >= 60) {
    return "#fbbf24";
  }
  return "#5eead4";
}

function StatsPlaceholder({ title }: { title: string }) {
  return (
    <span className="vm-stat-muted" title={title}>
      {DASH}
    </span>
  );
}

/** Skeleton rows shown on the very first load (before any sandbox exists). */
function VmTableSkeleton() {
  return (
    <div className="vm-table-skeleton" aria-label="Loading sandboxes" role="status">
      {Array.from({ length: 5 }, (_, index) => (
        <div className="vm-table-skeleton-row" key={index}>
          <Skeleton.Avatar active size={28} shape="square" />
          <Skeleton.Input active size="small" block />
          <Skeleton.Input active size="small" />
          <Skeleton.Input active size="small" />
        </div>
      ))}
    </div>
  );
}

/**
 * Sandbox list with live per-row utilization. Stats are fetched for the whole
 * visible list via `useQueries` (never inside cell renderers) so hook order is
 * stable while the polled list changes.
 */
export function VmTable({
  sandboxes,
  images,
  loading,
  error,
  pendingAction,
  onCreate,
  onRetry,
  onDetails,
  onAction,
  onExec,
}: VmTableProps) {
  const statsQueries = useQueries({
    queries: sandboxes.map((sandbox) => ({
      queryKey: queryKeys.sandboxStats(sandbox.id),
      queryFn: () => getSandboxStats(sandbox.id),
      refetchInterval: 2_000,
      retry: 0,
    })),
  });

  const statsByRef = new Map(
    sandboxes.map((sandbox, index) => [sandbox.id, statsQueries[index]] as const),
  );
  const imagesByDigest = new Map(images.map((image) => [image.digest, image] as const));

  const columns: TableColumnsType<Sandbox> = [
    {
      title: "Name",
      dataIndex: "name",
      key: "name",
      width: 190,
      render: (_name: string, sandbox: Sandbox) => (
        <div className="vm-name-cell">
          <span className="vm-name" title={sandbox.name}>
            {sandbox.name}
          </span>
          <span
            className="vm-id"
            title={
              sandbox.volumes !== undefined && sandbox.volumes.length > 0
                ? `${sandbox.id}\n${sandbox.volumes
                    .map(
                      (volume) =>
                        `${volume.host_path} → ${volume.guest_path}${
                          volume.read_only === true ? " (read-only)" : ""
                        }`,
                    )
                    .join("\n")}`
                : sandbox.id
            }
          >
            {shortId(sandbox.id, 10)}
            {sandbox.volumes !== undefined && sandbox.volumes.length > 0
              ? ` · ${sandbox.volumes.length} vol${sandbox.volumes.length === 1 ? "" : "s"}`
              : ""}
          </span>
        </div>
      ),
    },
    {
      title: "State",
      dataIndex: "state",
      key: "state",
      width: 120,
      render: (state: SandboxState) => <VmStatusTag state={state} />,
    },
    {
      title: "Image",
      dataIndex: "base_disk",
      key: "image",
      width: 160,
      render: (digest: string) => {
        const image = imagesByDigest.get(digest);
        const label = image === undefined ? shortDigest(digest, 18) : imageLabel(image);
        return (
          <Tooltip title={digest}>
            <Tag className="image-tag">{label}</Tag>
          </Tooltip>
        );
      },
    },
    {
      title: "CPU",
      key: "cpu",
      width: 140,
      render: (_value: unknown, sandbox: Sandbox) => {
        const query = statsByRef.get(sandbox.id);
        if (query === undefined || query.isPending) {
          return <span className="vm-stat-muted">…</span>;
        }
        if (query.isError) {
          return <StatsPlaceholder title="Live stats are unavailable for this sandbox." />;
        }
        const percent = clampPercent(query.data.cpu_percent);
        return (
          <div className="vm-progress-cell">
            <Progress
              percent={percent}
              showInfo={false}
              size="small"
              strokeColor={cpuColor(percent)}
              railColor="rgba(148, 163, 184, 0.18)"
            />
            <span className="vm-progress-value">{formatPercent(percent)}</span>
          </div>
        );
      },
    },
    {
      title: "Memory",
      key: "memory",
      width: 180,
      render: (_value: unknown, sandbox: Sandbox) => {
        const query = statsByRef.get(sandbox.id);
        if (query === undefined || query.isPending) {
          return <span className="vm-stat-muted">…</span>;
        }
        if (query.isError) {
          return <StatsPlaceholder title="Live stats are unavailable for this sandbox." />;
        }
        const stats = query.data;
        const limitBytes =
          (stats.memory_mb > 0 ? stats.memory_mb : sandbox.memory_mb) * 1024 * 1024;
        const percent = clampPercent(
          limitBytes > 0 ? (stats.memory_rss_bytes / limitBytes) * 100 : 0,
        );
        return (
          <div className="vm-progress-cell vm-progress-cell--memory">
            <Progress
              percent={percent}
              showInfo={false}
              size="small"
              strokeColor={percent >= 85 ? "#f87171" : "#818cf8"}
              railColor="rgba(148, 163, 184, 0.18)"
            />
            <span className="vm-progress-value vm-progress-value--memory">
              {formatBytes(stats.memory_rss_bytes)}
              <span className="vm-progress-sep"> / </span>
              {stats.memory_mb} MB
            </span>
          </div>
        );
      },
    },
    {
      title: "vCPUs",
      dataIndex: "vcpus",
      key: "vcpus",
      width: 84,
      align: "right",
      render: (vcpus: number) => <span className="vm-mono">{vcpus}</span>,
    },
    {
      title: "IP",
      dataIndex: "ip",
      key: "ip",
      width: 132,
      render: (ip: string | undefined) => (
        <span className="vm-mono vm-ip">{ip === undefined || ip === "" ? DASH : ip}</span>
      ),
    },
    {
      title: "Uptime",
      key: "uptime",
      width: 104,
      render: (_value: unknown, sandbox: Sandbox) => {
        const query = statsByRef.get(sandbox.id);
        if (query === undefined || query.isPending || query.isError) {
          return <span className="vm-stat-muted">{DASH}</span>;
        }
        return <span className="vm-mono">{formatDuration(query.data.uptime_seconds)}</span>;
      },
    },
    {
      title: "Wakes",
      dataIndex: "wake_count",
      key: "wakes",
      width: 84,
      align: "right",
      render: (wakeCount: number) => <span className="vm-mono">{wakeCount}</span>,
    },
    {
      title: "",
      key: "actions",
      width: 56,
      align: "right",
      render: (_value: unknown, sandbox: Sandbox) => (
        <VmActionsMenu
          sandbox={sandbox}
          pending={pendingAction?.ref === sandbox.id ? pendingAction : null}
          onAction={onAction}
          onDetails={onDetails}
          onExec={onExec}
        />
      ),
    },
  ];

  if (loading && sandboxes.length === 0) {
    return <VmTableSkeleton />;
  }

  if (error !== null && sandboxes.length === 0) {
    return (
      <div className="vm-empty">
        <Alert
          type="error"
          showIcon
          title="Could not load sandboxes"
          description={error}
          action={
            <Button size="small" onClick={onRetry}>
              Retry
            </Button>
          }
        />
      </div>
    );
  }

  if (sandboxes.length === 0) {
    return (
      <div className="vm-empty">
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <span className="vm-empty-description">
              No virtual machines yet. Create one from a base disk image.
            </span>
          }
        >
          <Button type="primary" icon={<PlusIcon />} onClick={onCreate}>
            Create VM
          </Button>
        </Empty>
      </div>
    );
  }

  return (
    <div className="vm-table-wrap">
      {error !== null ? (
        <Alert
          className="vm-table-banner"
          type="warning"
          showIcon
          title="Showing the last known sandbox list"
          description={error}
          action={
            <Button size="small" onClick={onRetry}>
              Retry
            </Button>
          }
        />
      ) : null}
      <Table<Sandbox>
        className="vm-table"
        rowKey={(sandbox) => sandbox.id}
        columns={columns}
        dataSource={[...sandboxes]}
        loading={loading && sandboxes.length > 0 ? { spinning: true, tip: "Refreshing…" } : false}
        scroll={{ x: 1250 }}
        pagination={
          sandboxes.length > 10
            ? {
                pageSize: 10,
                showSizeChanger: false,
                hideOnSinglePage: true,
                showTotal: (total) => `${total} sandboxes`,
              }
            : false
        }
        onRow={(sandbox) => ({
          className: "vm-row",
          title: "Open details",
          onClick: () => {
            onDetails(sandbox);
          },
        })}
      />
    </div>
  );
}

export default VmTable;

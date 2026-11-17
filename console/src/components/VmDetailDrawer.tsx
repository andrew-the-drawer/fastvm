import {
  Alert,
  Button,
  Descriptions,
  Divider,
  Drawer,
  Empty,
  Skeleton,
  Space,
  Tag,
  Typography,
} from "antd";
import type { DescriptionsProps } from "antd";
import { useEvents, useSandboxStats } from "../lib/queries";
import type { BaseDisk, Event, Sandbox } from "../lib/types";
import { describeError } from "../utils/errors";
import {
  clampPercent,
  DASH,
  formatBytes,
  formatDateTime,
  formatDuration,
  formatPercent,
  imageLabel,
  shortId,
} from "../utils/format";
import {
  canDeepSleep,
  canDelete,
  canExec,
  canPause,
  canResume,
  type PendingAction,
  type VmActionKind,
} from "./vmActions";
import { PauseIcon, MoonIcon, PlayIcon, TerminalIcon, TrashIcon } from "./icons";
import { UtilizationBar } from "./UtilizationBar";
import { VmStatusTag } from "./VmStatusTag";

export interface VmDetailDrawerProps {
  sandbox: Sandbox | null;
  open: boolean;
  images: readonly BaseDisk[];
  pendingAction: PendingAction | null;
  onClose: () => void;
  /** Fired after the closing animation; lets the parent unmount the drawer. */
  onClosed?: () => void;
  onAction: (kind: VmActionKind, sandbox: Sandbox) => void;
  /** Open an interactive shell; wakes paused/dormant sandboxes. */
  onExec: (sandbox: Sandbox) => void;
}

function eventColor(type: string): string {
  const normalized = type.toLowerCase();
  if (normalized.includes("fail") || normalized.includes("error")) {
    return "red";
  }
  if (
    normalized.includes("wake") ||
    normalized.includes("start") ||
    normalized.includes("create")
  ) {
    return "green";
  }
  if (
    normalized.includes("pause") ||
    normalized.includes("sleep") ||
    normalized.includes("dormant")
  ) {
    return "gold";
  }
  if (normalized.includes("delete") || normalized.includes("stop")) {
    return "default";
  }
  return "blue";
}

function eventMatches(event: Event, sandbox: Sandbox): boolean {
  return (
    event.sandbox_id === sandbox.id ||
    (event.sandbox_name !== undefined && event.sandbox_name === sandbox.name)
  );
}

/** Slide-over with full sandbox details, live stats, recent events and actions. */
export function VmDetailDrawer({
  sandbox,
  open,
  images,
  pendingAction,
  onClose,
  onClosed,
  onAction,
  onExec,
}: VmDetailDrawerProps) {
  const stats = useSandboxStats(sandbox?.id);
  const events = useEvents(100);

  if (sandbox === null) {
    return null;
  }

  const pending = pendingAction?.ref === sandbox.id ? pendingAction : null;
  const busy = pending !== null;
  const image = images.find((candidate) => candidate.digest === sandbox.base_disk);
  const sandboxEvents = (events.data ?? []).filter((event) => eventMatches(event, sandbox));
  const statsData = stats.data;

  const memoryLimitBytes = sandbox.memory_mb * 1024 * 1024;
  const memoryPercent =
    statsData === undefined
      ? 0
      : clampPercent(
          memoryLimitBytes > 0 ? (statsData.memory_rss_bytes / memoryLimitBytes) * 100 : 0,
        );

  const detailItems: DescriptionsProps["items"] = [
    {
      key: "id",
      label: "Sandbox ID",
      children: (
        <Typography.Text className="vm-mono" copyable={{ text: sandbox.id }}>
          {sandbox.id}
        </Typography.Text>
      ),
    },
    {
      key: "image",
      label: "Base image",
      children: (
        <span>
          {image === undefined ? shortId(sandbox.base_disk, 18) : imageLabel(image)}
          {image !== undefined ? (
            <span className="detail-muted"> · {formatBytes(image.size_bytes)}</span>
          ) : null}
        </span>
      ),
    },
    {
      key: "state",
      label: "State",
      children: <VmStatusTag state={sandbox.state} />,
    },
    {
      key: "ip",
      label: "IP address",
      children: <span className="vm-mono">{sandbox.ip ?? DASH}</span>,
    },
    {
      key: "resources",
      label: "Resources",
      children: (
        <span>
          {sandbox.vcpus} vCPU{sandbox.vcpus === 1 ? "" : "s"} · {sandbox.memory_mb} MB memory
        </span>
      ),
    },
    {
      key: "autoSleep",
      label: "Auto sleep",
      children: sandbox.no_auto_sleep ? (
        <Tag color="gold">Disabled</Tag>
      ) : (
        <Tag color="green">Enabled</Tag>
      ),
    },
    {
      key: "wakes",
      label: "Wake count",
      children: <span className="vm-mono">{sandbox.wake_count}</span>,
    },
    {
      key: "created",
      label: "Created",
      children: formatDateTime(sandbox.created_at),
    },
    {
      key: "activity",
      label: "Last activity",
      children: formatDateTime(sandbox.last_activity_at),
    },
  ];

  let statsSection;
  if (stats.isPending) {
    statsSection = <Skeleton active paragraph={{ rows: 4 }} title={false} />;
  } else if (stats.isError) {
    statsSection = (
      <Alert
        type="warning"
        showIcon
        title="Live stats unavailable"
        description={describeError(stats.error)}
      />
    );
  } else if (statsData === undefined) {
    statsSection = <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No stats yet" />;
  } else {
    statsSection = (
      <div className="stats-grid">
        <div className="stats-bars">
          <UtilizationBar
            label="CPU"
            percent={statsData.cpu_percent}
            detail={`${statsData.cpu_percent.toFixed(1)}% of ${statsData.vcpus} vCPU${
              statsData.vcpus === 1 ? "" : "s"
            }`}
          />
          <UtilizationBar
            label="Memory"
            percent={memoryPercent}
            detail={`${formatBytes(statsData.memory_rss_bytes)} / ${statsData.memory_mb} MB`}
          />
        </div>
        <div className="stats-counters">
          <div className="stats-counter">
            <span className="stats-counter-label">Uptime</span>
            <span className="stats-counter-value">{formatDuration(statsData.uptime_seconds)}</span>
          </div>
          <div className="stats-counter">
            <span className="stats-counter-label">CPU</span>
            <span className="stats-counter-value">{formatPercent(statsData.cpu_percent)}</span>
          </div>
          <div className="stats-counter">
            <span className="stats-counter-label">Block read</span>
            <span className="stats-counter-value">{formatBytes(statsData.block_read_bytes)}</span>
          </div>
          <div className="stats-counter">
            <span className="stats-counter-label">Block write</span>
            <span className="stats-counter-value">{formatBytes(statsData.block_write_bytes)}</span>
          </div>
          <div className="stats-counter">
            <span className="stats-counter-label">Network RX</span>
            <span className="stats-counter-value">{formatBytes(statsData.rx_bytes)}</span>
          </div>
          <div className="stats-counter">
            <span className="stats-counter-label">Network TX</span>
            <span className="stats-counter-value">{formatBytes(statsData.tx_bytes)}</span>
          </div>
        </div>
        <p className="stats-captured">Sampled {formatDateTime(statsData.captured_at)}</p>
      </div>
    );
  }

  const footer = (
    <div className="drawer-actions">
      <Space wrap>
        <Button
          type="primary"
          onClick={() => onExec(sandbox)}
          disabled={busy || !canExec(sandbox.state)}
        >
          <TerminalIcon /> Open terminal
        </Button>
        <Button
          onClick={() => onAction("pause", sandbox)}
          disabled={busy || !canPause(sandbox.state)}
          loading={pending?.kind === "pause"}
        >
          <PauseIcon /> Pause
        </Button>
        <Button
          onClick={() => onAction("deepSleep", sandbox)}
          disabled={busy || !canDeepSleep(sandbox.state)}
          loading={pending?.kind === "deepSleep"}
        >
          <MoonIcon /> Deep sleep
        </Button>
        <Button
          onClick={() => onAction("resume", sandbox)}
          disabled={busy || !canResume(sandbox.state)}
          loading={pending?.kind === "resume"}
        >
          <PlayIcon /> Resume
        </Button>
      </Space>
      <Button
        danger
        onClick={() => onAction("delete", sandbox)}
        disabled={busy || !canDelete(sandbox.state)}
        loading={pending?.kind === "delete"}
      >
        <TrashIcon /> Delete
      </Button>
    </div>
  );

  return (
    <Drawer
      open={open}
      onClose={onClose}
      afterOpenChange={(isOpen) => {
        if (!isOpen) {
          onClosed?.();
        }
      }}
      size={560}
      className="vm-detail-drawer"
      destroyOnHidden={false}
      title={
        <div className="drawer-title">
          <span className="drawer-title-name">{sandbox.name}</span>
          <VmStatusTag state={sandbox.state} />
        </div>
      }
      footer={footer}
    >
      <section className="drawer-section">
        <h3 className="drawer-section-title">Overview</h3>
        <Descriptions column={1} size="small" colon={false} items={detailItems} />
        {sandbox.error !== undefined && sandbox.error !== "" ? (
          <Alert
            className="drawer-error"
            type="error"
            showIcon
            title="Sandbox error"
            description={sandbox.error}
          />
        ) : null}
      </section>

      <Divider className="drawer-divider" />

      <section className="drawer-section">
        <div className="drawer-section-head">
          <h3 className="drawer-section-title">Live utilization</h3>
          <span className="drawer-section-hint">updates every 2s</span>
        </div>
        {statsSection}
      </section>

      <Divider className="drawer-divider" />

      <section className="drawer-section">
        <h3 className="drawer-section-title">Port mappings</h3>
        {sandbox.ports !== undefined && sandbox.ports.length > 0 ? (
          <Space wrap size={[6, 6]}>
            {sandbox.ports.map((port) => (
              <Tag key={`${port.host_port}-${port.guest_port}-${port.proto}`} className="port-tag">
                {port.host_port}
                <span className="port-arrow">→</span>
                {port.guest_port}/{port.proto}
              </Tag>
            ))}
          </Space>
        ) : (
          <p className="drawer-muted">No published ports.</p>
        )}
      </section>

      <Divider className="drawer-divider" />

      <section className="drawer-section">
        <h3 className="drawer-section-title">Host volumes</h3>
        {sandbox.volumes !== undefined && sandbox.volumes.length > 0 ? (
          <Descriptions
            column={1}
            size="small"
            colon={false}
            items={sandbox.volumes.map((volume, index) => ({
              key: `${volume.host_path}-${volume.guest_path}-${index}`,
              label: `Volume ${index + 1}`,
              children: (
                <span>
                  <span className="vm-mono">{volume.host_path}</span>
                  <span className="port-arrow"> → </span>
                  <span className="vm-mono">{volume.guest_path}</span>{" "}
                  <Tag
                    color={volume.read_only === true ? "gold" : "green"}
                    className="vm-status-tag"
                  >
                    {volume.read_only === true ? "read-only" : "read-write"}
                  </Tag>
                </span>
              ),
            }))}
          />
        ) : (
          <p className="drawer-muted">No host volumes mounted.</p>
        )}
      </section>

      <Divider className="drawer-divider" />

      <section className="drawer-section">
        <div className="drawer-section-head">
          <h3 className="drawer-section-title">Recent events</h3>
          <span className="drawer-section-hint">{sandboxEvents.length} shown</span>
        </div>
        {events.isPending ? (
          <Skeleton active paragraph={{ rows: 3 }} title={false} />
        ) : events.isError ? (
          <Alert
            type="warning"
            showIcon
            title="Could not load events"
            description={describeError(events.error)}
          />
        ) : sandboxEvents.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="No events recorded for this sandbox yet."
          />
        ) : (
          <ul className="event-list">
            {sandboxEvents.map((event) => (
              <li className="event-item" key={`${event.time}-${event.type}-${event.message}`}>
                <div className="event-main">
                  <Tag color={eventColor(event.type)} className="event-type">
                    {event.type}
                  </Tag>
                  <span className="event-message">{event.message}</span>
                </div>
                <span className="event-time">{formatDateTime(event.time)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Drawer>
  );
}

export default VmDetailDrawer;

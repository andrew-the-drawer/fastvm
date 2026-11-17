import type { BaseDisk, SandboxState } from "../lib/types";

/** Placeholder shown wherever a value is missing or cannot be formatted. */
export const DASH = "—";

const BYTE_UNITS = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"] as const;

/**
 * Human-readable byte count using binary units (`1 KiB = 1024 B`).
 *
 * Values below 1 KiB render as whole bytes; larger values keep one decimal
 * (fewer than 100 units) and are trimmed (`512.0 MiB` -> `512 MiB`).
 */
export function formatBytes(bytes: number | null | undefined, decimals = 1): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) {
    return DASH;
  }
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  if (unitIndex === 0) {
    return `${Math.round(value)} B`;
  }
  const fixed = value >= 100 ? value.toFixed(0) : value.toFixed(decimals);
  return `${fixed.replace(/\.0+$/, "")} ${BYTE_UNITS[unitIndex]}`;
}

/** `42.345 -> "42.3%"`; missing/non-finite values render as an em dash. */
export function formatPercent(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return DASH;
  }
  return `${value.toFixed(decimals)}%`;
}

/** Clamps a utilization value into the 0–100 range expected by progress bars. */
export function clampPercent(value: number | null | undefined): number {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, value));
}

/**
 * Compact duration, e.g. `0s`, `59s`, `1m 30s`, `2h 5m`, `3d 4h`.
 * Seconds are omitted once a day or more has elapsed.
 */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return DASH;
  }
  const total = Math.floor(seconds);
  if (total < 60) {
    return `${total}s`;
  }
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const restSeconds = total % 60;
  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return restSeconds > 0 ? `${minutes}m ${restSeconds}s` : `${minutes}m`;
}

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Locale-aware date/time for ISO strings and epoch millis. */
export function formatDateTime(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined || value === "") {
    return DASH;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return DASH;
  }
  return dateTimeFormatter.format(date);
}

const clockFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Compact clock time (no date) for "last updated" style indicators. */
export function formatClockTime(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined || value === "") {
    return DASH;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return DASH;
  }
  return clockFormatter.format(date);
}

/** Truncates a digest to `length` characters, keeping the algorithm prefix. */
export function shortDigest(digest: string | null | undefined, length = 12): string {
  if (digest === null || digest === undefined) {
    return DASH;
  }
  const trimmed = digest.trim();
  if (trimmed === "") {
    return DASH;
  }
  return trimmed.length <= length ? trimmed : `${trimmed.slice(0, length)}…`;
}

/** Truncates a sandbox id/ref for display in dense table cells. */
export function shortId(id: string | null | undefined, length = 8): string {
  if (id === null || id === undefined) {
    return DASH;
  }
  const trimmed = id.trim();
  if (trimmed === "") {
    return DASH;
  }
  return trimmed.length <= length ? trimmed : `${trimmed.slice(0, length)}…`;
}

/** Best available display name for a content-addressed base disk. */
export function imageLabel(
  image: Pick<BaseDisk, "digest" | "name" | "tag" | "tags"> | null | undefined,
): string {
  if (!image) {
    return DASH;
  }
  const tag = image.tags?.[0] ?? image.tag;
  if (tag !== undefined && tag !== "") {
    return tag;
  }
  if (image.name !== undefined && image.name !== "") {
    return image.name;
  }
  return shortDigest(image.digest, 18);
}

/** Coarse grouping used by summary counters and styling. */
export type SandboxStateTone =
  | "active"
  | "idle"
  | "sleeping"
  | "transitional"
  | "stopped"
  | "failed";

export interface SandboxStateMeta {
  /** Human label for the state tag. */
  readonly label: string;
  /** antd `<Tag color>` preset. */
  readonly color: string;
  /** One-line explanation shown in tooltips. */
  readonly description: string;
  /** Coarse bucket for counters/row styling. */
  readonly tone: SandboxStateTone;
}

const SANDBOX_STATE_META: Record<SandboxState, SandboxStateMeta> = {
  Creating: {
    label: "Creating",
    color: "geekblue",
    description: "The base disk is being cloned into a fresh writable volume.",
    tone: "transitional",
  },
  Starting: {
    label: "Starting",
    color: "blue",
    description: "The VM is booting and waiting for the guest agent to connect.",
    tone: "transitional",
  },
  Running: {
    label: "Running",
    color: "green",
    description: "vCPUs are executing and the guest is handling work.",
    tone: "active",
  },
  Idle: {
    label: "Idle",
    color: "cyan",
    description: "Awake but quiet; it pauses automatically after the idle timeout.",
    tone: "idle",
  },
  Paused: {
    label: "Paused",
    color: "gold",
    description: "vCPUs are halted; traffic is queued and wakes it on the first packet.",
    tone: "sleeping",
  },
  Dormant: {
    label: "Dormant",
    color: "purple",
    description: "Guest memory has been offloaded to a file; it still wakes on traffic.",
    tone: "sleeping",
  },
  Resuming: {
    label: "Resuming",
    color: "blue",
    description: "vCPUs are restarting and buffered traffic is being drained.",
    tone: "transitional",
  },
  Stopping: {
    label: "Stopping",
    color: "orange",
    description: "The sandbox is shutting down.",
    tone: "transitional",
  },
  Stopped: {
    label: "Stopped",
    color: "default",
    description: "The VM has shut down and can be deleted.",
    tone: "stopped",
  },
  Failed: {
    label: "Failed",
    color: "red",
    description: "The sandbox hit an unrecoverable error; inspect the error and delete it.",
    tone: "failed",
  },
};

/** Label, antd tag color and description for a sandbox lifecycle state. */
export function sandboxStateMeta(state: SandboxState): SandboxStateMeta {
  return SANDBOX_STATE_META[state];
}

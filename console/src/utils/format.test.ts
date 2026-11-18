import { describe, expect, it } from "vite-plus/test";
import {
  clampPercent,
  DASH,
  formatBytes,
  formatClockTime,
  formatDateTime,
  formatDuration,
  formatPercent,
  imageLabel,
  sandboxStateMeta,
  shortDigest,
  shortId,
} from "./format";
import type { SandboxState } from "../lib/types";

const ALL_STATES: SandboxState[] = [
  "Created",
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

describe("formatBytes", () => {
  it("formats bytes with binary units", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KiB");
    expect(formatBytes(1024 * 1024)).toBe("1 MiB");
    expect(formatBytes(512 * 1024 * 1024)).toBe("512 MiB");
    expect(formatBytes(1.5 * 1024 * 1024 * 1024)).toBe("1.5 GiB");
  });

  it("renders an em dash for unusable values", () => {
    expect(formatBytes(null)).toBe(DASH);
    expect(formatBytes(undefined)).toBe(DASH);
    expect(formatBytes(Number.NaN)).toBe(DASH);
    expect(formatBytes(-1)).toBe(DASH);
  });
});

describe("formatPercent / clampPercent", () => {
  it("formats percentages with one decimal by default", () => {
    expect(formatPercent(42.345)).toBe("42.3%");
    expect(formatPercent(0)).toBe("0.0%");
    expect(formatPercent(100)).toBe("100.0%");
  });

  it("returns a dash for non-finite values", () => {
    expect(formatPercent(Number.NaN)).toBe(DASH);
    expect(formatPercent(null)).toBe(DASH);
  });

  it("clamps utilizations into 0-100", () => {
    expect(clampPercent(-20)).toBe(0);
    expect(clampPercent(145)).toBe(100);
    expect(clampPercent(42.5)).toBe(42.5);
    expect(clampPercent(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("formatDuration", () => {
  it("formats compact durations", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(59)).toBe("59s");
    expect(formatDuration(90)).toBe("1m 30s");
    expect(formatDuration(3600)).toBe("1h");
    expect(formatDuration(3660)).toBe("1h 1m");
    expect(formatDuration(90_061)).toBe("1d 1h");
  });

  it("rejects negative and missing values", () => {
    expect(formatDuration(-1)).toBe(DASH);
    expect(formatDuration(undefined)).toBe(DASH);
  });
});

describe("formatDateTime / formatClockTime", () => {
  it("formats ISO timestamps", () => {
    expect(formatDateTime("2024-06-15T12:34:56Z")).toMatch(/2024/);
    expect(formatClockTime("2024-06-15T12:34:56Z")).toMatch(/\d{1,2}:\d{2}/);
  });

  it("returns a dash for invalid values", () => {
    expect(formatDateTime("not-a-date")).toBe(DASH);
    expect(formatDateTime(null)).toBe(DASH);
    expect(formatClockTime("")).toBe(DASH);
  });
});

describe("shortDigest / shortId", () => {
  it("truncates long values and keeps short ones", () => {
    expect(shortDigest("sha256:abcdef", 12)).toBe("sha256:abcde…");
    expect(shortDigest("abc")).toBe("abc");
    expect(shortId("0123456789abcdef", 8)).toBe("01234567…");
    expect(shortId("web")).toBe("web");
  });

  it("returns a dash for empty values", () => {
    expect(shortDigest(undefined)).toBe(DASH);
    expect(shortDigest("  ")).toBe(DASH);
    expect(shortId(null)).toBe(DASH);
    expect(shortId("")).toBe(DASH);
  });
});

describe("imageLabel", () => {
  const digest = "sha256:0123456789abcdef0123456789abcdef";
  const base = {
    digest,
    size_bytes: 1024,
    source: "docker",
    created_at: "2024-01-01T00:00:00Z",
  };

  it("prefers the first tag, then tag, then name, then the digest", () => {
    expect(imageLabel({ ...base, tags: ["alpine:3.20"], name: "alpine" })).toBe("alpine:3.20");
    expect(imageLabel({ ...base, tag: "demo:latest" })).toBe("demo:latest");
    expect(imageLabel({ ...base, name: "demo" })).toBe("demo");
    expect(imageLabel(base)).toBe("sha256:0123456789a…");
  });

  it("handles missing images", () => {
    expect(imageLabel(null)).toBe(DASH);
  });
});

describe("sandboxStateMeta", () => {
  it("defines a label, tone and description for every state", () => {
    for (const state of ALL_STATES) {
      const meta = sandboxStateMeta(state);
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.description.length).toBeGreaterThan(0);
    }
  });

  it("uses distinct tone buckets", () => {
    expect(sandboxStateMeta("Running")).toMatchObject({
      label: "Running",
      tone: "active",
    });
    expect(sandboxStateMeta("Idle").tone).toBe("idle");
    expect(sandboxStateMeta("Paused")).toMatchObject({
      label: "Paused",
      tone: "sleeping",
    });
    expect(sandboxStateMeta("Dormant").tone).toBe("sleeping");
    expect(sandboxStateMeta("Failed").tone).toBe("failed");
  });
});

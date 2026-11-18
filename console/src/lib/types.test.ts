import { describe, expect, it } from "vite-plus/test";
import {
  baseDiskSchema,
  eventSchema,
  sandboxSchema,
  sandboxStateSchema,
  sandboxStatsSchema,
  versionInfoSchema,
} from "./types";

const sandboxPayload = {
  id: "sb-1",
  name: "web",
  base_disk: "sha256:abc123",
  volume_path: "/tmp/fastvm-cow/data/volumes/sb-1.ext4",
  vcpus: 2,
  memory_mb: 512,
  state: "Running",
  no_auto_sleep: false,
  ports: [{ host_port: 8080, guest_port: 80, proto: "tcp" }],
  ip: "10.0.0.2",
  wake_count: 3,
  last_activity_at: "2026-11-17T08:00:00Z",
  created_at: "2026-11-17T07:59:00Z",
  updated_at: "2026-11-17T08:00:00Z",
};

describe("sandboxSchema", () => {
  it("parses a full sandbox record and tolerates additive daemon fields", () => {
    const sandbox = sandboxSchema.parse(sandboxPayload);
    expect(sandbox).toMatchObject({
      id: "sb-1",
      name: "web",
      state: "Running",
      base_disk: "sha256:abc123",
      vcpus: 2,
      memory_mb: 512,
      wake_count: 3,
      no_auto_sleep: false,
      ports: [{ host_port: 8080, guest_port: 80, proto: "tcp" }],
    });
    expect((sandbox as Record<string, unknown>)["volume_path"]).toBe(
      "/tmp/fastvm-cow/data/volumes/sb-1.ext4",
    );
  });

  it("accepts a minimal sandbox record (optional network/ports/error omitted)", () => {
    const sandbox = sandboxSchema.parse({
      id: "sb-2",
      name: "worker",
      base_disk: "sha256:def456",
      vcpus: 1,
      memory_mb: 256,
      state: "Dormant",
      no_auto_sleep: true,
      wake_count: 0,
      last_activity_at: "2026-11-17T08:00:00Z",
      created_at: "2026-11-17T08:00:00Z",
      updated_at: "2026-11-17T08:00:00Z",
      error: "",
    });
    expect(sandbox.state).toBe("Dormant");
    expect(sandbox.ip).toBeUndefined();
    expect(sandbox.ports).toBeUndefined();
  });

  it("rejects an unknown lifecycle state", () => {
    expect(() => sandboxSchema.parse({ ...sandboxPayload, state: "Exploded" })).toThrow();
  });

  it("exposes every daemon state", () => {
    expect(sandboxStateSchema.options).toEqual([
      "Creating",
      "Created",
      "Starting",
      "Running",
      "Idle",
      "Paused",
      "Dormant",
      "Resuming",
      "Stopping",
      "Stopped",
      "Failed",
    ]);
  });
});

describe("sandboxStatsSchema", () => {
  it("parses the stats contract", () => {
    const stats = sandboxStatsSchema.parse({
      sandbox_id: "sb-1",
      name: "web",
      state: "Idle",
      cpu_percent: 12.5,
      vcpus: 2,
      memory_mb: 512,
      memory_rss_bytes: 73400320,
      uptime_seconds: 42.25,
      wake_count: 1,
      block_read_bytes: 1024,
      block_write_bytes: 2048,
      rx_bytes: 4096,
      tx_bytes: 8192,
      captured_at: "2026-11-17T08:00:00Z",
      extra_daemon_field: true,
    });
    expect(stats.cpu_percent).toBe(12.5);
    expect(stats.memory_rss_bytes).toBe(73400320);
    expect(stats.uptime_seconds).toBe(42.25);
    expect((stats as Record<string, unknown>)["extra_daemon_field"]).toBe(true);
  });

  it("rejects CPU percentages outside 0-100", () => {
    const base = {
      sandbox_id: "sb-1",
      name: "web",
      state: "Running",
      vcpus: 1,
      memory_mb: 256,
      memory_rss_bytes: 1,
      uptime_seconds: 1,
      wake_count: 0,
      block_read_bytes: 0,
      block_write_bytes: 0,
      rx_bytes: 0,
      tx_bytes: 0,
      captured_at: "2026-11-17T08:00:00Z",
    };
    expect(() => sandboxStatsSchema.parse({ ...base, cpu_percent: 101 })).toThrow();
    expect(() => sandboxStatsSchema.parse({ ...base, cpu_percent: -1 })).toThrow();
  });
});

describe("eventSchema", () => {
  it("parses an event with the captured sandbox name", () => {
    const event = eventSchema.parse({
      time: "2026-11-17T08:00:00Z",
      sandbox_id: "sb-1",
      sandbox_name: "web",
      type: "wake",
      message: "woken by packet",
    });
    expect(event).toMatchObject({ sandbox_id: "sb-1", type: "wake" });
  });

  it("parses an event without the optional sandbox name", () => {
    const event = eventSchema.parse({
      time: "2026-11-17T08:00:00Z",
      sandbox_id: "sb-1",
      type: "created",
      message: "created",
    });
    expect(event.sandbox_name).toBeUndefined();
  });
});

describe("baseDiskSchema", () => {
  it("parses a tagged base disk", () => {
    const disk = baseDiskSchema.parse({
      name: "demo",
      tag: "latest",
      tags: ["latest", "v1"],
      digest: "sha256:abc123",
      path: "/tmp/fastvm-cow/data/images/abc123.ext4",
      size_bytes: 268435456,
      source: "dockerfile",
      created_at: "2026-11-17T07:00:00Z",
    });
    expect(disk.tag).toBe("latest");
    expect(disk.tags).toEqual(["latest", "v1"]);
    expect(disk.size_bytes).toBe(268435456);
  });
});

describe("versionInfoSchema", () => {
  it("parses the version payload and keeps the daemon name", () => {
    const info = versionInfoSchema.parse({ version: "0.1.0", name: "fastvm" });
    expect(info.version).toBe("0.1.0");
    expect(info.name).toBe("fastvm");
  });
});

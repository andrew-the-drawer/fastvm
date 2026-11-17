import { describe, expect, it } from "vite-plus/test";
import { avatarDataUri } from "./avatar";

describe("avatarDataUri", () => {
  it("is deterministic for a seed and returns an SVG data URI", () => {
    const first = avatarDataUri("demo@example.com");
    const second = avatarDataUri("demo@example.com");

    expect(first).toBe(second);
    expect(first.startsWith("data:image/svg+xml")).toBe(true);
    expect(first).toContain("%3Csvg");
  });

  it("changes when the user seed changes", () => {
    expect(avatarDataUri("alice@example.com")).not.toBe(avatarDataUri("bob@example.com"));
  });
});

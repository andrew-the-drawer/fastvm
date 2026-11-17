import { describe, expect, it } from "vite-plus/test";
import { queryKeys } from "./queries";

describe("queryKeys", () => {
  it("builds stable, serializable keys", () => {
    expect(queryKeys.version).toEqual(["version"]);
    expect(queryKeys.sandboxes).toEqual(["sandboxes"]);
    expect(queryKeys.images).toEqual(["images"]);
    expect(queryKeys.events).toEqual(["events"]);
    expect(queryKeys.sandbox("web")).toEqual(["sandbox", "web"]);
    expect(queryKeys.sandboxStats("web")).toEqual(["sandbox-stats", "web"]);
  });

  it("keeps per-ref keys as prefixes of their parent list key", () => {
    expect(queryKeys.sandbox("web")[0]).toBe("sandbox");
    expect(queryKeys.sandboxStats("web")[0]).toBe("sandbox-stats");
  });
});

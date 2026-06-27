import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadExperimentFromDir, resolveUnderMessagesBundle } from "./experiment-loader.js";

describe("resolveUnderMessagesBundle", () => {
  it("resolves relative paths under the messages bundle", () => {
    const experimentDir = path.resolve("assets/messages/message-warning");
    const resolved = resolveUnderMessagesBundle(experimentDir, "../message-warning-final/variant-001.html");
    expect(resolved).toContain("message-warning-final");
    expect(resolved).not.toContain("..");
  });

  it("rejects path escape attempts", () => {
    const experimentDir = path.resolve("assets/messages/message-warning");
    expect(() => resolveUnderMessagesBundle(experimentDir, "../../../etc/passwd")).toThrow(
      /experiment_path_escape/
    );
  });
});

describe("loadExperimentFromDir", () => {
  it("loads warning experiment variants from disk", () => {
    const loaded = loadExperimentFromDir(path.resolve("assets/messages/message-warning"));
    expect(loaded.experimentId).toBe("level1_message_warning");
    expect(loaded.variants.length).toBeGreaterThan(0);
    expect(loaded.totalWeight).toBeGreaterThan(0);
    expect(loaded.variants[0]?.html.trim().length).toBeGreaterThan(0);
  });
});

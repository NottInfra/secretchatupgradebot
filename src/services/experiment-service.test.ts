import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ExperimentService } from "./experiment-service.js";
import { mockLogger } from "../test/support/mocks.js";

const experimentDirs = [
  path.resolve("assets/messages/message-warning"),
  path.resolve("assets/messages/messages-block")
];

describe("ExperimentService", () => {
  it("loads bundled experiments and assigns deterministically", () => {
    const service = new ExperimentService(experimentDirs, mockLogger() as never);
    const first = service.assignModerationTier("level1_message_warning", "sender-42");
    const second = service.assignModerationTier("level1_message_warning", "sender-42");

    expect(first.experimentId).toBe("level1_message_warning");
    expect(second).toEqual(first);
    expect(first.html.trim().length).toBeGreaterThan(0);
  });

  it("throws for unknown experiments", () => {
    const service = new ExperimentService(experimentDirs, mockLogger() as never);
    expect(() => service.assign("missing", "x")).toThrow(/unknown_experiment/);
  });
});

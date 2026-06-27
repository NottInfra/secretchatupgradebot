import { describe, expect, it } from "vitest";
import type { IExperimentService } from "./experiment-service.port.js";

describe("experiment-service.port", () => {
  it("types an experiment assignment contract", () => {
    const svc: IExperimentService = {
      assign: () => ({ experimentId: "e", variantId: "v", html: "<p>x</p>" }),
      assignModerationTier: () => ({ experimentId: "e", variantId: "v", html: "<p>x</p>" })
    };
    expect(svc.assign("e", "user").variantId).toBe("v");
  });
});

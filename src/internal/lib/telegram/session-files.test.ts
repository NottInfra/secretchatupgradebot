import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { materializeSessionFiles } from "./session-files.js";

describe("materializeSessionFiles", () => {
  it("writes decoded files and returns tdlib directories", () => {
    const root = mkdtempSync(join(tmpdir(), "session-files-"));
    const payload = Buffer.from("hello").toString("base64");

    const result = materializeSessionFiles(
      {
        sessionPath: root,
        files: { "nested/key.txt": payload }
      },
      undefined
    );

    expect(result.databaseDirectory).toContain("tdlib-db");
    expect(result.filesDirectory).toContain("tdlib-files");
    expect(readFileSync(join(root, "nested/key.txt"), "utf8")).toBe("hello");
  });

  it("rejects empty session paths", () => {
    expect(() => materializeSessionFiles({ sessionPath: "  " })).toThrow("session_path_empty");
  });
});

import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

test("real SQLite event pagination preserves task scope, ordering and resume metadata", () => {
  const root = mkdtempSync(join(tmpdir(), "metaengine-event-page-"));
  try {
    // Store is a singleton, and Bun retains transaction prepared statements on
    // Windows. A child isolates the DB and closes every handle before cleanup.
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("./fixtures/event-pagination-check.ts", import.meta.url))], {
      env: { ...process.env, ME2_DATA_DIR: join(root, "data") },
      encoding: "utf8", timeout: 15_000, windowsHide: true,
    });
    expect(result.error).toBeUndefined();
    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: "" });
    expect(JSON.parse(result.stdout)).toEqual({ checks: 8 });
  } finally {
    const target = resolve(root);
    if (!target.startsWith(resolve(tmpdir()) + sep) || !target.includes("metaengine-event-page-")) throw new Error("unsafe_test_cleanup_target");
    rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

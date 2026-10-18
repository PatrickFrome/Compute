import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

test("real SQLite preserves JSON evidence, command admission and idempotency truth", () => {
  const root = mkdtempSync(join(tmpdir(), "metaengine-store-integrity-"));
  try {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("./fixtures/store-integrity-check.ts", import.meta.url))], {
      env: { ...process.env, ME2_DATA_DIR: join(root, "data") },
      encoding: "utf8", timeout: 15_000, windowsHide: true,
    });
    expect(result.error).toBeUndefined();
    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: "" });
    expect(JSON.parse(result.stdout)).toEqual({ checks: 9 });
  } finally {
    const target = resolve(root);
    if (!target.startsWith(resolve(tmpdir()) + sep) || !target.includes("metaengine-store-integrity-")) throw new Error("unsafe_test_cleanup_target");
    rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

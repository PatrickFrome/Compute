import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

test("real command handler survives a lost completion receipt without replay across process restart", () => {
  const root = mkdtempSync(join(tmpdir(), "metaengine-command-restart-"));
  try {
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
      /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|SYSTEMDRIVE|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/i.test(name)));
    Object.assign(env, {
      APPDATA: join(root, "appdata"), LOCALAPPDATA: join(root, "localappdata"),
      TEMP: root, TMP: root, HOME: root, USERPROFILE: root,
      ME2_DATA_DIR: join(root, "data"), ME2_RESTART_TEST_ROOT: root,
      ME2_REPO_ROOT: join(root, "repo"), ME2_CONTOUR_HOME: root,
      ME2_BOOT_MODE: "probe",
    });
    mkdirSync(env.APPDATA!, { recursive: true });
    mkdirSync(env.LOCALAPPDATA!, { recursive: true });
    const fixture = fileURLToPath(new URL("./fixtures/command-restart-check.ts", import.meta.url));
    const crash = spawnSync(process.execPath, [fixture, "effect-then-crash"], {
      env, cwd: root, encoding: "utf8", timeout: 20_000, windowsHide: true,
    });
    expect(crash.error).toBeUndefined();
    expect({ status: crash.status, stderr: crash.stderr }).toEqual({ status: 23, stderr: "" });
    expect(JSON.parse(crash.stdout).phase).toBe("effect-then-crash");
    const recovery = spawnSync(process.execPath, [fixture, "recover"], {
      env, cwd: root, encoding: "utf8", timeout: 20_000, windowsHide: true,
    });
    expect(recovery.error).toBeUndefined();
    expect({ status: recovery.status, stderr: recovery.stderr }).toEqual({ status: 0, stderr: "" });
    expect(JSON.parse(recovery.stdout)).toEqual({ phase: "recover", real_handler_effects: 1, replayed_effects: 0, pending_completed_once: true });
  } finally {
    const target = resolve(root);
    if (!target.startsWith(resolve(tmpdir()) + sep) || !target.includes("metaengine-command-restart-")) throw new Error("unsafe_test_cleanup_target");
    rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}, 45_000);

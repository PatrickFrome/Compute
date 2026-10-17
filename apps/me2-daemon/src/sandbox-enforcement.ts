/** Pure policy shared by the launcher before spawn and by its parent readback. */
export function strictCheck(layers: Record<string, string | boolean> | null, net: "allow" | "deny", _strict = true): { ok: boolean; failed: string[] } {
  if (!layers) return { ok: false, failed: ["verdict_file_missing"] };
  const failed: string[] = [];
  for (const field of ["make_private", "ro_root", "rw_rebinds", "secrets_hidden"]) if (layers[field] !== true) failed.push(field);
  if (layers.seccomp !== "installed") failed.push("seccomp");
  if (layers.rlimit_as !== true || layers.rlimit_nofile !== true || layers.rlimit_core !== true) failed.push("rlimits");
  if (net === "deny" && layers.net !== "deny") failed.push("net_mode");
  return { ok: failed.length === 0, failed };
}

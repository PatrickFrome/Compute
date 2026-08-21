#!/usr/bin/env bash
set -euo pipefail

OUT=${1:-w1-live-canaries.json}
RUN_TAG=${GITHUB_RUN_ID:-local}-$$
UNIT_PREFIX="metaengine-w1-${RUN_TAG}"
STATE_DIR="metaengine-w1-fs-${RUN_TAG}"
RUNTIME_DIR="metaengine-w1-kill-${RUN_TAG}"
cleanup() {
  systemctl stop "${UNIT_PREFIX}-tree.service" >/dev/null 2>&1 || true
  systemctl reset-failed "${UNIT_PREFIX}-tree.service" >/dev/null 2>&1 || true
  rm -rf "/var/lib/${STATE_DIR}" "/run/${RUNTIME_DIR}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

require() { command -v "$1" >/dev/null 2>&1 || { echo "missing tool: $1" >&2; exit 90; }; }
for t in systemd-run systemctl curl python3; do require "$t"; done
[[ "$(id -u)" -eq 0 ]] || { echo "run as root (CI uses sudo)" >&2; exit 91; }
[[ "$(ps -p 1 -o comm=)" == "systemd" ]] || { echo "systemd is not PID 1" >&2; exit 92; }

# Establish that public egress works outside the isolated service, otherwise the network canary is inconclusive.
curl -fsS --connect-timeout 8 --max-time 12 https://example.com/ >/dev/null
control_network=true

COMMON=(
  --quiet --wait --collect --pipe
  -p DynamicUser=yes
  -p NoNewPrivileges=yes
  -p PrivateTmp=yes
  -p PrivateDevices=yes
  -p PrivateMounts=yes
  -p ProtectSystem=strict
  -p ProtectHome=read-only
  -p ProtectKernelTunables=yes
  -p ProtectKernelModules=yes
  -p ProtectKernelLogs=yes
  -p ProtectControlGroups=yes
  -p RestrictSUIDSGID=yes
  -p LockPersonality=yes
  -p RestrictRealtime=yes
  -p SystemCallArchitectures=native
  -p 'SystemCallFilter=~@clock @cpu-emulation @debug @module @mount @obsolete @privileged @raw-io @reboot @swap'
  -p SystemCallErrorNumber=EPERM
  -p CPUQuota=100%
  -p MemoryMax=512M
  -p MemorySwapMax=0
  -p TasksMax=64
  -p LimitNOFILE=128
  -p LimitNPROC=64
  -p LimitFSIZE=16777216
  -p LimitAS=1073741824
  -p LimitCPU=60
)

fs_out=$(systemd-run --unit="${UNIT_PREFIX}-fs" "${COMMON[@]}" -p "StateDirectory=${STATE_DIR}" /bin/sh -eu -c '
  uid=$(id -u)
  test "$uid" -ne 0
  test "$(awk "/^NoNewPrivs:/ {print \$2}" /proc/self/status)" = 1
  test "$(awk "/^Seccomp:/ {print \$2}" /proc/self/status)" = 2
  test "$(readlink /proc/self/ns/mnt)" != "$(readlink /proc/1/ns/mnt)"
  if touch /usr/local/metaengine-w1-escape 2>/dev/null; then
    rm -f /usr/local/metaengine-w1-escape
    echo FS_ESCAPE_ALLOWED
    exit 31
  fi
  printf ok > "$STATE_DIRECTORY/inside.txt"
  test "$(cat "$STATE_DIRECTORY/inside.txt")" = ok
  echo FS_ISOLATION_PASS
')
grep -q 'FS_ISOLATION_PASS' <<<"$fs_out"
filesystem_isolation=true

net_out=$(systemd-run --unit="${UNIT_PREFIX}-net" "${COMMON[@]}" -p IPAddressDeny=any /bin/sh -eu -c '
  if curl -fsS --connect-timeout 5 --max-time 8 https://example.com/ >/dev/null 2>&1; then
    echo NETWORK_ESCAPE_ALLOWED
    exit 41
  fi
  echo NETWORK_DEFAULT_DENY_PASS
')
grep -q 'NETWORK_DEFAULT_DENY_PASS' <<<"$net_out"
network_default_deny=true

# Launch a real process tree in its own systemd cgroup and prove kill-whom=all fences descendants.
systemd-run --quiet --unit="${UNIT_PREFIX}-tree" \
  -p DynamicUser=yes \
  -p "RuntimeDirectory=${RUNTIME_DIR}" \
  -p RuntimeDirectoryMode=0700 \
  -p NoNewPrivileges=yes \
  -p KillMode=control-group \
  -p TasksMax=16 \
  -p MemoryMax=256M \
  /bin/sh -eu -c 'sleep 300 & child=$!; printf "%s" "$child" > "$RUNTIME_DIRECTORY/child.pid"; wait'

child_file="/run/${RUNTIME_DIR}/child.pid"
for _ in $(seq 1 50); do [[ -s "$child_file" ]] && break; sleep 0.1; done
[[ -s "$child_file" ]] || { echo "child pid receipt missing" >&2; exit 51; }
child_pid=$(cat "$child_file")
main_pid=$(systemctl show "${UNIT_PREFIX}-tree.service" -p MainPID --value)
cgroup=$(systemctl show "${UNIT_PREFIX}-tree.service" -p ControlGroup --value)
[[ "$main_pid" =~ ^[0-9]+$ && "$main_pid" -gt 1 ]]
[[ "$child_pid" =~ ^[0-9]+$ && "$child_pid" -gt 1 ]]
[[ -n "$cgroup" && -e "/sys/fs/cgroup${cgroup}/cgroup.kill" ]]
kill_supported=true
systemctl kill "${UNIT_PREFIX}-tree.service" --kill-whom=all --signal=TERM
for _ in $(seq 1 50); do
  [[ ! -e "/proc/${main_pid}" && ! -e "/proc/${child_pid}" ]] && break
  sleep 0.1
done
[[ ! -e "/proc/${main_pid}" && ! -e "/proc/${child_pid}" ]] || { echo "process tree survived cgroup fence" >&2; exit 52; }
process_tree_fenced=true
systemctl reset-failed "${UNIT_PREFIX}-tree.service" >/dev/null 2>&1 || true

python3 - "$OUT" "$RUN_TAG" "$control_network" "$filesystem_isolation" "$network_default_deny" "$kill_supported" "$process_tree_fenced" "$cgroup" <<'PY'
import hashlib, json, os, platform, sys, time
out, run_tag, control, fs, net, kill, tree, cgroup = sys.argv[1:]
doc = {
  "schema": "metaengine.compute.w1-live-isolation-canaries.h205f22.v1",
  "classification": os.getenv("METAENGINE_EVIDENCE_CLASSIFICATION", "LIVE_EPHEMERAL"),
  "persistent_worker_proof": False,
  "observed_at_unix_ns": time.time_ns(),
  "run_tag": run_tag,
  "host": {"os": platform.system().lower(), "arch": platform.machine()},
  "canaries": {
    "public_egress_control": control == "true",
    "filesystem_protect_system_fail_closed": fs == "true",
    "network_default_deny_fail_closed": net == "true",
    "cgroup_kill_supported": kill == "true",
    "process_tree_fenced": tree == "true",
  },
  "cgroup": cgroup,
  "pass": all(x == "true" for x in (control, fs, net, kill, tree)),
}
encoded = json.dumps(doc, sort_keys=True, separators=(",", ":"))
doc["evidence_sha256"] = hashlib.sha256(encoded.encode()).hexdigest()
with open(out, "w") as f:
    json.dump(doc, f, sort_keys=True, separators=(",", ":"))
    f.write("\n")
PY

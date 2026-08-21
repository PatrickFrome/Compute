#!/usr/bin/env bash
set -euo pipefail

WORKER_ID=""
GATEWAY_URL=""
TOKEN_FILE=""
BUNDLE_GITHUB_SHA=""
PROVIDER_KIND="GENERIC_CLOUD"
PROVIDER_INSTANCE_ID="unknown"
HEARTBEAT_INTERVAL=30
PERSISTENCE_MIN_SECONDS=600
PREPARE_GVISOR=false

usage() {
  cat <<'EOF'
Usage:
  sudo ./bootstrap_persistent_host.sh \
    --worker-id ID \
    --gateway-url HTTPS_URL \
    --bearer-token-file PATH \
    --bundle-github-sha 40_HEX_SHA \
    [--provider-kind AWS_EC2|DIGITALOCEAN|HETZNER_CLOUD|GENERIC_CLOUD] \
    [--provider-instance-id ID] \
    [--heartbeat-interval SEC] \
    [--persistence-min-seconds SEC] \
    [--prepare-gvisor]

This bootstraps only the persistent W1 control agent. It never accepts secrets on
the command line, never marks W1 VERIFIED, and never executes user workloads.
--prepare-gvisor installs the pinned PREPARE_ONLY sandbox substrate outside PATH;
it does not register an OCI runtime or grant A1 authority.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --worker-id) WORKER_ID=${2:?}; shift 2 ;;
    --gateway-url) GATEWAY_URL=${2:?}; shift 2 ;;
    --bearer-token-file) TOKEN_FILE=${2:?}; shift 2 ;;
    --bundle-github-sha) BUNDLE_GITHUB_SHA=${2:?}; shift 2 ;;
    --provider-kind) PROVIDER_KIND=${2:?}; shift 2 ;;
    --provider-instance-id) PROVIDER_INSTANCE_ID=${2:?}; shift 2 ;;
    --heartbeat-interval) HEARTBEAT_INTERVAL=${2:?}; shift 2 ;;
    --persistence-min-seconds) PERSISTENCE_MIN_SECONDS=${2:?}; shift 2 ;;
    --prepare-gvisor) PREPARE_GVISOR=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ "$(id -u)" -eq 0 ]] || { echo "bootstrap must run as root" >&2; exit 3; }
[[ "$BUNDLE_GITHUB_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "--bundle-github-sha must be an exact 40-hex commit" >&2; exit 4; }
case "$PROVIDER_KIND" in
  AWS_EC2|DIGITALOCEAN|HETZNER_CLOUD|GENERIC_CLOUD) ;;
  *) echo "unsupported --provider-kind" >&2; exit 5 ;;
esac
[[ "$PROVIDER_INSTANCE_ID" =~ ^[A-Za-z0-9._:/-]{1,200}$ ]] || { echo "invalid --provider-instance-id" >&2; exit 6; }
[[ -f "$TOKEN_FILE" ]] || { echo "bearer token file not found" >&2; exit 7; }

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
for f in install.sh execution_substrate_probe.py; do
  [[ -f "$SCRIPT_DIR/$f" ]] || { echo "missing bootstrap payload: $f" >&2; exit 8; }
done
if $PREPARE_GVISOR; then
  [[ -f "$SCRIPT_DIR/prepare_gvisor.sh" ]] || { echo "missing prepare_gvisor.sh" >&2; exit 9; }
fi

# Bind the local payload itself to the operator-supplied exact Git commit. This
# is evidence metadata, not a claim that the local files were independently
# fetched from GitHub. CI/review must bind the commit to these file hashes.
bundle_manifest=$(mktemp)
cleanup() { rm -f "$bundle_manifest"; }
trap cleanup EXIT
(
  cd "$SCRIPT_DIR"
  find . -maxdepth 1 -type f -print0 \
    | sort -z \
    | xargs -0 sha256sum
) > "$bundle_manifest"
bundle_manifest_sha256=$(sha256sum "$bundle_manifest" | awk '{print $1}')

"$SCRIPT_DIR/install.sh" \
  --worker-id "$WORKER_ID" \
  --gateway-url "$GATEWAY_URL" \
  --bearer-token-file "$TOKEN_FILE" \
  --heartbeat-interval "$HEARTBEAT_INTERVAL" \
  --persistence-min-seconds "$PERSISTENCE_MIN_SECONDS" \
  --enable

if $PREPARE_GVISOR; then
  "$SCRIPT_DIR/prepare_gvisor.sh"
fi

install -o root -g root -m 0755 "$SCRIPT_DIR/execution_substrate_probe.py" /opt/metaengine-worker/execution_substrate_probe.py
substrate_json=$(/usr/bin/python3 /opt/metaengine-worker/execution_substrate_probe.py)

systemctl is-enabled --quiet metaengine-worker.service
systemctl is-active --quiet metaengine-worker.service
unit_sha256=$(sha256sum /etc/systemd/system/metaengine-worker.service | awk '{print $1}')
machine_id=$(cat /etc/machine-id)
boot_id=$(cat /proc/sys/kernel/random/boot_id)
machine_id_sha256=$(printf '%s' "$machine_id" | sha256sum | awk '{print $1}')
boot_id_sha256=$(printf '%s' "$boot_id" | sha256sum | awk '{print $1}')

install -d -o root -g root -m 0755 /var/lib/metaengine-bootstrap
python3 - \
  /var/lib/metaengine-bootstrap/w1-bootstrap-receipt.json \
  "$WORKER_ID" "$BUNDLE_GITHUB_SHA" "$bundle_manifest_sha256" "$unit_sha256" \
  "$machine_id_sha256" "$boot_id_sha256" "$PROVIDER_KIND" "$PROVIDER_INSTANCE_ID" \
  "$substrate_json" "$PREPARE_GVISOR" <<'PY'
import hashlib, json, sys, time
(
    out, worker_id, github_sha, bundle_manifest_sha256, unit_sha256,
    machine_id_sha256, boot_id_sha256, provider_kind, provider_instance_id,
    substrate_raw, prepare_gvisor,
) = sys.argv[1:]
substrate = json.loads(substrate_raw)
doc = {
    "schema": "metaengine.compute.w1-bootstrap-receipt.h205f22.v1",
    "classification": "LIVE_HOST_BOOTSTRAP_NONAUTHORITATIVE",
    "worker_id": worker_id,
    "github_sha": github_sha,
    "bundle_manifest_sha256": bundle_manifest_sha256,
    "systemd_unit_sha256": unit_sha256,
    "machine_id_sha256": machine_id_sha256,
    "initial_boot_id_sha256": boot_id_sha256,
    "provider_kind": provider_kind,
    "provider_instance_id": provider_instance_id,
    "execution_substrate": substrate,
    "gvisor_prepared": prepare_gvisor == "true",
    "service_enabled": True,
    "service_active": True,
    "provider_reboot_correlation_required": True,
    "persistent_worker_proof": False,
    "w1_verified": False,
    "a1_runtime_authority": False,
    "canonical": False,
    "authority_effect": False,
    "created_at_unix_ns": time.time_ns(),
    "next_required_evidence": [
        "ACCEPTED_HEARTBEAT_WINDOW",
        "PROVIDER_CONTROLLER_REBOOT_RECEIPT",
        "SAME_MACHINE_AND_WITNESS_AFTER_NEW_BOOT_ID",
        "INDEPENDENT_H1_H13_VERIFICATION",
    ],
}
encoded = json.dumps(doc, sort_keys=True, separators=(",", ":"))
doc["receipt_sha256"] = hashlib.sha256(encoded.encode()).hexdigest()
with open(out, "w", encoding="utf-8") as f:
    json.dump(doc, f, sort_keys=True, separators=(",", ":"))
    f.write("\n")
PY
chmod 0644 /var/lib/metaengine-bootstrap/w1-bootstrap-receipt.json

cat /var/lib/metaengine-bootstrap/w1-bootstrap-receipt.json

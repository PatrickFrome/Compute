#!/usr/bin/env bash
set -euo pipefail

# PREPARE_ONLY: installs a pinned gVisor distribution outside PATH and records
# an integrity manifest. It does not configure Docker/containerd, start a
# sandbox, execute user code, or grant A1 runtime authority.

RELEASE="20260810.0"
DEST_ROOT="/opt/metaengine-sandbox/gvisor"

usage() {
  cat <<'EOF'
Usage: sudo ./prepare_gvisor.sh [--release POINT_RELEASE] [--dest-root PATH]

Default point release: 20260810.0
The script downloads the exact official gVisor point-release tarball and its
SHA-512 file, verifies the archive, installs it outside PATH, and emits a
PREPARE_ONLY manifest. It deliberately does NOT run `runsc install` and does
NOT configure Docker/containerd.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --release) RELEASE=${2:?}; shift 2 ;;
    --dest-root) DEST_ROOT=${2:?}; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ "$(id -u)" -eq 0 ]] || { echo "must run as root" >&2; exit 3; }
[[ "$RELEASE" =~ ^[0-9]{8}\.[0-9]+$ ]] || { echo "release must be a point release like 20260810.0" >&2; exit 4; }
[[ "$DEST_ROOT" == /* ]] || { echo "dest root must be absolute" >&2; exit 5; }

for tool in curl sha512sum sha256sum tar python3; do
  command -v "$tool" >/dev/null 2>&1 || { echo "missing required tool: $tool" >&2; exit 6; }
done

case "$(uname -m)" in
  x86_64) ARCH=x86_64 ;;
  aarch64|arm64) ARCH=aarch64 ;;
  *) echo "unsupported architecture: $(uname -m)" >&2; exit 7 ;;
esac

BASE_URL="https://storage.googleapis.com/gvisor/releases/release/${RELEASE}/${ARCH}"
DEST="${DEST_ROOT}/${RELEASE}/${ARCH}"
TMP=$(mktemp -d)
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

cd "$TMP"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  "${BASE_URL}/gvisor.tar.bz2" -o gvisor.tar.bz2
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  "${BASE_URL}/gvisor.tar.bz2.sha512" -o gvisor.tar.bz2.sha512

# Official gVisor distribution publishes this checksum next to the exact point
# release. Any archive/checksum mismatch fails closed before extraction.
sha512sum --check --strict gvisor.tar.bz2.sha512
archive_sha512=$(sha512sum gvisor.tar.bz2 | awk '{print $1}')

rm -rf "$DEST"
install -d -o root -g root -m 0755 "$DEST"
tar -xjf gvisor.tar.bz2 -C "$DEST"
chown -R root:root "$DEST"
find "$DEST" -type d -exec chmod 0755 {} +
find "$DEST" -type f -exec chmod go-w {} +

RUNSC="${DEST}/runsc"
[[ -x "$RUNSC" ]] || { echo "verified archive missing executable runsc" >&2; exit 8; }
[[ -d "${DEST}/gvisor-bin" ]] || { echo "verified archive missing gvisor-bin sidecars" >&2; exit 9; }

install -d -o root -g root -m 0755 "$DEST_ROOT"
ln -sfn "${RELEASE}/${ARCH}" "${DEST_ROOT}/current"
runsc_version=$("$RUNSC" --version 2>&1 | head -n 1)
runsc_sha256=$(sha256sum "$RUNSC" | awk '{print $1}')

python3 - "$DEST/prepare-manifest.json" "$RELEASE" "$ARCH" "$BASE_URL" "$archive_sha512" "$runsc_sha256" "$runsc_version" <<'PY'
import hashlib, json, sys, time
out, release, arch, base_url, archive_sha512, runsc_sha256, runsc_version = sys.argv[1:]
doc = {
    "schema": "metaengine.compute.gvisor-prepare.h205f22.v1",
    "classification": "PREPARE_ONLY",
    "release": release,
    "arch": arch,
    "source": base_url,
    "archive_sha512": archive_sha512,
    "runsc_sha256": runsc_sha256,
    "runsc_version": runsc_version,
    "installed_at_unix_ns": time.time_ns(),
    "canonical": False,
    "authority_effect": False,
    "persistent_worker_proof": False,
    "w1_verified": False,
    "a1_runtime_authority": False,
    "configured_as_oci_runtime": False,
    "user_code_executed": False,
    "nonclaims": [
        "NO_W1_VERIFICATION",
        "NO_A1_ENABLEMENT",
        "NO_DOCKER_OR_CONTAINERD_RUNTIME_REGISTRATION",
        "NO_USER_CODE_EXECUTION",
    ],
}
encoded = json.dumps(doc, sort_keys=True, separators=(",", ":"))
doc["manifest_sha256"] = hashlib.sha256(encoded.encode()).hexdigest()
with open(out, "w", encoding="utf-8") as f:
    json.dump(doc, f, sort_keys=True, separators=(",", ":"))
    f.write("\n")
PY
chmod 0644 "$DEST/prepare-manifest.json"

echo "gVisor PREPARE_ONLY installed at $DEST"
echo "release=$RELEASE arch=$ARCH runsc_sha256=$runsc_sha256"
echo "No OCI runtime was registered and no user workload was executed."

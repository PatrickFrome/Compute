#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

EXPECTED_REPO="PatrickFrome/Compute"
BASE_MAIN_SHA="0d6bfd3fc54d2d0ebdcd8194f98c9becd067a4df"

if [[ "${CODESPACES:-}" != "true" ]]; then
  echo "w1-selfreport: not running in GitHub Codespaces" >&2
  exit 70
fi
if [[ "${GITHUB_REPOSITORY:-}" != "$EXPECTED_REPO" ]]; then
  echo "w1-selfreport: repository mismatch" >&2
  exit 71
fi
if [[ -z "${CODESPACE_NAME:-}" ]]; then
  echo "w1-selfreport: CODESPACE_NAME unavailable" >&2
  exit 72
fi

repo_root="$(git rev-parse --show-toplevel)"
case "$repo_root" in
  /workspaces/*) ;;
  *) echo "w1-selfreport: repository is not under /workspaces" >&2; exit 73 ;;
esac
cd "$repo_root"

persist_dir="/workspaces/.metaengine-w1/${CODESPACE_NAME}"
receipt_dir="${repo_root}/evidence/w1/codespaces/${CODESPACE_NAME}"
mkdir -p "$persist_dir" "$receipt_dir"

sentinel_file="${persist_dir}/persistent-sentinel.bin"
if [[ ! -f "$sentinel_file" ]]; then
  python3 - "$sentinel_file" <<'PY'
import os, pathlib, sys
p = pathlib.Path(sys.argv[1])
p.write_bytes(os.urandom(64))
PY
fi
sentinel_sha256="$(sha256sum "$sentinel_file" | awk '{print $1}')"

boot_id="$(tr -d '\n' </proc/sys/kernel/random/boot_id)"
if [[ ! "$boot_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]]; then
  echo "w1-selfreport: invalid kernel boot_id" >&2
  exit 74
fi

receipt_file="${receipt_dir}/boot-${boot_id}.json"
source_git_sha="$(git rev-parse HEAD)"
source_tree_sha="$(git rev-parse 'HEAD^{tree}')"
source_branch="$(git branch --show-current)"
captured_at="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
uname_s="$(uname -s)"
uname_m="$(uname -m)"
uname_r="$(uname -r)"

collector_out="${persist_dir}/collector-${boot_id}.json"
collector_err="${persist_dir}/collector-${boot_id}.stderr"
set +e
printf '{"source":{"git_sha":"%s","tree_sha":"%s"}}\n' "$source_git_sha" "$source_tree_sha" \
  | python3 worker/native_linux/host_observation_collector.py >"$collector_out" 2>"$collector_err"
collector_rc=$?
set -e

python3 - \
  "$receipt_file" "$collector_out" "$collector_err" "$collector_rc" \
  "$boot_id" "$sentinel_sha256" "$captured_at" "$source_git_sha" "$source_tree_sha" \
  "$source_branch" "$uname_s" "$uname_m" "$uname_r" "$CODESPACE_NAME" "$GITHUB_REPOSITORY" \
  "$BASE_MAIN_SHA" <<'PY'
import hashlib
import json
import pathlib
import sys

(
    receipt_path, collector_path, collector_err_path, collector_rc,
    boot_id, sentinel_sha256, captured_at, source_git_sha, source_tree_sha,
    source_branch, uname_s, uname_m, uname_r, codespace_name, repository,
    base_main_sha,
) = sys.argv[1:]

collector_raw = pathlib.Path(collector_path).read_bytes()
collector_err_raw = pathlib.Path(collector_err_path).read_bytes()
collector_json = None
if int(collector_rc) == 0:
    try:
        collector_json = json.loads(collector_raw.decode("utf-8"))
    except Exception:
        collector_json = None

body = {
    "schema": "metaengine.compute.w1-codespace-selfreport.h205f22.v1",
    "source": "CODESPACE_SELF_REPORT_UNTRUSTED_HOST",
    "provider_kind": "GITHUB_CODESPACES",
    "codespace_name": codespace_name,
    "repository": repository,
    "base_main_sha": base_main_sha,
    "source_branch": source_branch,
    "source_git_sha": source_git_sha,
    "source_tree_sha": source_tree_sha,
    "captured_at": captured_at,
    "linux": {
        "uname_s": uname_s,
        "uname_m": uname_m,
        "uname_r": uname_r,
        "boot_id": boot_id,
    },
    "persistence": {
        "sentinel_location_class": "WORKSPACES_PERSISTENT_MOUNT",
        "sentinel_sha256": sentinel_sha256,
        "sentinel_bytes_disclosed": False,
    },
    "safety_collector": {
        "exit_code": int(collector_rc),
        "observation": collector_json,
        "stdout_sha256": hashlib.sha256(collector_raw).hexdigest(),
        "stderr_sha256": hashlib.sha256(collector_err_raw).hexdigest(),
    },
    "nonclaims": {
        "provider_identity_verified": False,
        "provider_action_verified": False,
        "persistent_worker_proof": False,
        "worker_admitted": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
    },
}
canonical = json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
receipt = dict(body)
receipt["receipt_sha256"] = hashlib.sha256(canonical).hexdigest()
path = pathlib.Path(receipt_path)
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(json.dumps(receipt, sort_keys=True, indent=2) + "\n", encoding="utf-8")
PY

# A repeat postStart on the same kernel boot is idempotent at the evidence-file level.
git add -- "$receipt_file"
if git diff --cached --quiet -- "$receipt_file"; then
  echo "w1-selfreport: receipt already committed for boot ${boot_id}"
  exit 0
fi

git config user.name "METAENGINE W1 Codespace Selfreport"
git config user.email "w1-codespace-selfreport@users.noreply.github.com"
git commit -m "evidence(w1): codespace boot ${boot_id}" -- "$receipt_file"

# GitHub Codespaces configures repository authentication with its session GITHUB_TOKEN.
# The token is never printed, persisted in the receipt, or passed as a CLI argument.
git push origin HEAD

echo "w1-selfreport: non-authority receipt pushed for boot ${boot_id}"

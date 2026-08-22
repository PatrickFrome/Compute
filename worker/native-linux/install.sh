#!/usr/bin/env bash
set -euo pipefail

ENABLE=false
WORKER_ID=""
GATEWAY_URL=""
TOKEN_SOURCE=""
HEARTBEAT_INTERVAL=30
PERSISTENCE_MIN_SECONDS=600

usage() {
  cat <<'EOF'
Usage: sudo ./install.sh --worker-id ID --gateway-url HTTPS_URL [--bearer-token-file PATH] [--heartbeat-interval SEC] [--persistence-min-seconds SEC] [--enable]

The installer never accepts a token on the command line. With --enable it resolves and pins
only the current gateway and DNS resolver IPs into systemd IPAddressAllow= rules. If those IPs
change, the worker fails closed and scheduler freshness fencing removes it after 120 seconds.
The persistence witness is stored under StateDirectory=/var/lib/metaengine-worker and is bound
to /etc/machine-id; copying the state to another host causes worker startup/heartbeat failure.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --worker-id) WORKER_ID=${2:?}; shift 2 ;;
    --gateway-url) GATEWAY_URL=${2:?}; shift 2 ;;
    --bearer-token-file) TOKEN_SOURCE=${2:?}; shift 2 ;;
    --heartbeat-interval) HEARTBEAT_INTERVAL=${2:?}; shift 2 ;;
    --persistence-min-seconds) PERSISTENCE_MIN_SECONDS=${2:?}; shift 2 ;;
    --enable) ENABLE=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ "$(id -u)" -eq 0 ]] || { echo "installer must run as root" >&2; exit 3; }
[[ "$WORKER_ID" =~ ^[A-Za-z0-9._:-]{3,160}$ ]] || { echo "invalid --worker-id" >&2; exit 4; }
[[ "$GATEWAY_URL" == https://* ]] || { echo "--gateway-url must use https" >&2; exit 5; }
[[ "$HEARTBEAT_INTERVAL" =~ ^[0-9]+$ && "$HEARTBEAT_INTERVAL" -ge 10 && "$HEARTBEAT_INTERVAL" -le 90 ]] || { echo "heartbeat interval must be 10..90" >&2; exit 6; }
[[ "$PERSISTENCE_MIN_SECONDS" =~ ^[0-9]+$ && "$PERSISTENCE_MIN_SECONDS" -ge 60 && "$PERSISTENCE_MIN_SECONDS" -le 86400 ]] || { echo "persistence window must be 60..86400" >&2; exit 17; }

for t in python3 systemctl systemd-run sha256sum getent; do
  command -v "$t" >/dev/null 2>&1 || { echo "required tool missing: $t" >&2; exit 7; }
done
[[ -e /sys/fs/cgroup/cgroup.controllers ]] || { echo "cgroup v2 required" >&2; exit 8; }
controllers=" $(cat /sys/fs/cgroup/cgroup.controllers) "
for c in cpu memory pids; do [[ "$controllers" == *" $c "* ]] || { echo "missing cgroup v2 controller: $c" >&2; exit 9; }; done
[[ -e /sys/fs/cgroup/cgroup.kill ]] || { echo "kernel cgroup.kill support required" >&2; exit 10; }

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
for f in w1_safety_probe.py worker_agent.py persistence_witness.py metaengine-worker.service; do
  [[ -f "$SCRIPT_DIR/$f" ]] || { echo "missing installer payload: $f" >&2; exit 11; }
done

if ! id metaengine-worker >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/metaengine-worker --create-home --shell /usr/sbin/nologin metaengine-worker
fi
install -d -o root -g root -m 0755 /opt/metaengine-worker
install -d -o root -g root -m 0700 /etc/metaengine-worker
install -o root -g root -m 0755 "$SCRIPT_DIR/w1_safety_probe.py" /opt/metaengine-worker/w1_safety_probe.py
install -o root -g root -m 0755 "$SCRIPT_DIR/worker_agent.py" /opt/metaengine-worker/worker_agent.py
install -o root -g root -m 0644 "$SCRIPT_DIR/persistence_witness.py" /opt/metaengine-worker/persistence_witness.py
install -o root -g root -m 0644 "$SCRIPT_DIR/metaengine-worker.service" /etc/systemd/system/metaengine-worker.service

unit_sha=$(sha256sum /etc/systemd/system/metaengine-worker.service | awk '{print $1}')
printf 'METAENGINE_SECCOMP_POLICY_SHA256=%s\n' "$unit_sha" > /etc/metaengine-worker/policy.env
chmod 0600 /etc/metaengine-worker/policy.env

cat > /etc/metaengine-worker/worker.env <<EOF
METAENGINE_WORKER_ID=$WORKER_ID
METAENGINE_GATEWAY_URL=$GATEWAY_URL
METAENGINE_HEARTBEAT_INTERVAL_SECONDS=$HEARTBEAT_INTERVAL
METAENGINE_PERSISTENCE_MIN_SECONDS=$PERSISTENCE_MIN_SECONDS
EOF
chmod 0600 /etc/metaengine-worker/worker.env

if [[ -n "$TOKEN_SOURCE" ]]; then
  [[ -f "$TOKEN_SOURCE" ]] || { echo "bearer token source not found" >&2; exit 12; }
  install -o root -g root -m 0400 "$TOKEN_SOURCE" /etc/metaengine-worker/bearer-token
fi

# Pin egress rather than falling back to open networking.
gateway_host=$(python3 - "$GATEWAY_URL" <<'PY'
import sys, urllib.parse
u=urllib.parse.urlparse(sys.argv[1])
if u.scheme != 'https' or not u.hostname:
    raise SystemExit(1)
print(u.hostname)
PY
)
mapfile -t gateway_ips < <(getent ahosts "$gateway_host" | awk '{print $1}' | sort -u)
mapfile -t dns_ips < <(awk '/^nameserver[[:space:]]+/ {print $2}' /etc/resolv.conf | sort -u)
if [[ ${#gateway_ips[@]} -eq 0 ]]; then
  echo "could not resolve gateway host; refusing to create permissive fallback" >&2
  exit 13
fi
if [[ ${#dns_ips[@]} -eq 0 ]]; then
  echo "no DNS resolver found; refusing to create permissive fallback" >&2
  exit 14
fi

install -d -o root -g root -m 0755 /etc/systemd/system/metaengine-worker.service.d
{
  echo '[Service]'
  for ip in "${gateway_ips[@]}" "${dns_ips[@]}"; do
    if [[ "$ip" == *:* ]]; then echo "IPAddressAllow=${ip}/128"; else echo "IPAddressAllow=${ip}/32"; fi
  done
} > /etc/systemd/system/metaengine-worker.service.d/20-egress-allowlist.conf
chmod 0644 /etc/systemd/system/metaengine-worker.service.d/20-egress-allowlist.conf

systemd-analyze verify /etc/systemd/system/metaengine-worker.service
systemctl daemon-reload

printf 'Installed worker_id=%s\nunit_sha256=%s\ngateway_host=%s\npinned_gateway_ips=%s\npinned_dns_ips=%s\npersistence_min_seconds=%s\n' \
  "$WORKER_ID" "$unit_sha" "$gateway_host" "${gateway_ips[*]}" "${dns_ips[*]}" "$PERSISTENCE_MIN_SECONDS"

if $ENABLE; then
  [[ -s /etc/metaengine-worker/bearer-token ]] || { echo "--enable requires --bearer-token-file; service left disabled" >&2; exit 15; }
  systemctl enable --now metaengine-worker.service
  systemctl is-active --quiet metaengine-worker.service || { systemctl status --no-pager metaengine-worker.service >&2; exit 16; }
fi

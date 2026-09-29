#!/usr/bin/env bash
# capsule-seal-1130.sh — operator request: seal worklog + dev context into capsule.
# Sources: worklog, CONTEXT*, PHOENIX-PROTOCOL, phoenix scripts, browser-test battery,
#          swarm state snapshot, audit/research reports, a2-capsule references.
# Outputs: tar.gz capsule + SHA256SUMS manifest, copied to:
#   1) /home/z/my-project/download/            (chat-visible download)
#   2) /home/sync/me2-context-backups/versioned/ (ossfs NON-LOCAL host mirror)
#   3) Supabase Storage attempt (once; expected degraded, never prints secrets)
set -u
TS="$(date +%Y%m%d-%H%M%S)"
PROJ="/home/z/my-project"
VAULT="/home/z/context-vault"
SYNC="/home/sync/me2-context-backups"
WORK="/tmp/capsule-build-$TS"
NAME="me2-capsule-$TS"
OUT="$PROJ/download/$NAME.tar.gz"

mkdir -p "$WORK/$NAME" "$PROJ/download"
cd "$WORK/$NAME"

# 1) Core context files (full, untruncated)
cp -a "$PROJ/worklog.md" "$PROJ/CONTEXT.md" "$PROJ/PHOENIX-PROTOCOL.md" \
      "$PROJ/CONTEXT-CURRENT.md" . 2>/dev/null
# CTX-SHARD cron KV mirrors, if present
cp -a "$VAULT"/CTX-SHARD-*.md . 2>/dev/null

# 2) Phoenix + context-vault tooling and journals (exclude bulky snapshots)
mkdir -p scripts
cp -a "$PROJ/scripts/phoenix" scripts/ 2>/dev/null
cp -a "$VAULT/context-guard.sh" "$VAULT/supabase-persist.sh" scripts/ 2>/dev/null
mkdir -p journal
cp -a "$VAULT/journal/phoenix.log" "$VAULT/journal/incidents.log" \
      "$VAULT/journal/context-journal.log" journal/ 2>/dev/null

# 3) Browser-test battery (scripts + JSON verdicts, no secrets)
cp -a "$PROJ/scripts/browser-test" scripts/ 2>/dev/null
rm -f scripts/browser-test/*.log 2>/dev/null

# 4) Swarm live-state snapshot (small text artifacts only)
if [ -d "$PROJ/mini-services/agent-swarm" ]; then
  mkdir -p swarm-snapshot
  for f in "$PROJ/mini-services/agent-swarm"/*.md "$PROJ/mini-services/agent-swarm"/*.json \
           "$PROJ/mini-services/agent-swarm"/package.json; do
    [ -s "$f" ] && cp -a "$f" swarm-snapshot/ 2>/dev/null
  done
  tail -c 200000 "$PROJ/agent-swarm.log" > swarm-snapshot/agent-swarm.log.tail200k 2>/dev/null
fi

# 5) Development info: audits, research, docs, capsule references (text only)
cp -a "$PROJ/audit" . 2>/dev/null
cp -a "$PROJ/a2-capsule" ./a2-capsule-reference 2>/dev/null
mkdir -p dev-info
cp -a "$PROJ/docs" dev-info/docs 2>/dev/null
cp -a "$PROJ/research" dev-info/research 2>/dev/null

# 6) Secrets hygiene: strip any env/key files that may have been caught
find . -type f \( -name "*.env*" -o -name "me2.env*" -o -name "*secret*" -o -name "*token*" -o -name "*.key" \) -delete 2>/dev/null

# 7) Manifest + seal
( cd "$WORK" && find "$NAME" -type f -exec sha256sum {} + | sort -k2 > "$NAME/SHA256SUMS" )
tar -czf "$OUT" -C "$WORK" "$NAME" 2>/dev/null
SIZE=$(stat -c%s "$OUT" 2>/dev/null || echo 0)
SHA=$(sha256sum "$OUT" 2>/dev/null | cut -d' ' -f1)

# 8) Non-local host mirror (ossfs)
MIRROR_OK=0
if [ -d "$SYNC/versioned" ]; then
  cp "$OUT" "$SYNC/versioned/$NAME.tar.gz" 2>/dev/null && MIRROR_OK=1
  cp "$OUT" "$SYNC/latest/$NAME.tar.gz" 2>/dev/null
fi
rm -rf "$WORK"

echo "CAPSULE $NAME.tar.gz size=$SIZE sha256=$SHA"
echo "LOCAL=$OUT"
echo "NONLOCAL_MIRROR=$SYNC/versioned/$NAME.tar.gz mirror_ok=$MIRROR_OK"

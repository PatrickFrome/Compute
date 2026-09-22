#!/usr/bin/env bash
# ME2 OS -> GitHub sync. Pushes current main to branch sandbox/me2-os.
# Usage: scripts/git-sync.sh ["commit message"]
set -e
cd "$(dirname "$0")/.."
MSG="${1:-ME2 OS sync $(date -u +%Y-%m-%dT%H:%M:%SZ)}"
set -a; source /home/z/.a2/.github.env 2>/dev/null; set +a
TOKEN="${GITHUB_TOKEN_ADMIN:?no GITHUB_TOKEN_ADMIN in /home/z/.a2/.github.env}"
git add -A
if git diff --cached --quiet; then echo "nothing to commit"; else git commit -q -m "$MSG"; fi
git push -q "https://x-access-token:${TOKEN}@github.com/PatrickFrome/Compute.git" main:refs/heads/sandbox/me2-os
echo "synced -> sandbox/me2-os ($(git rev-parse --short HEAD))"

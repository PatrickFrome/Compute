#!/usr/bin/env bash
# GITHUB-AUDIT-20260929-0000 — branch topology vs main + live-client anchor
set -u
cd /home/z/my-project
git fetch -q origin '+refs/heads/*:refs/remotes/origin/*' 2>/dev/null
echo "== branch count =="
git branch -r | grep -c 'origin/'
echo "== local main vs origin/main =="
echo "local HEAD: $(git rev-parse --short HEAD)"
git rev-list --left-right --count origin/main...HEAD 2>/dev/null | awk '{print "behind_origin:",$1," ahead_local:",$2}'
echo "== per-branch: ahead/behind vs origin/main + last commit date =="
for b in $(git branch -r --format='%(refname:short)' | grep '^origin/' | grep -v 'origin/HEAD'); do
  cnt=$(git rev-list --left-right --count origin/main..."$b" 2>/dev/null)
  behind=${cnt%%	*}; ahead=${cnt##*	}
  date=$(git log -1 --format='%cs' "$b" 2>/dev/null)
  subj=$(git log -1 --format='%s' "$b" 2>/dev/null | cut -c1-60)
  printf "%-58s +%-4s -%-4s %s %s\n" "${b#origin/}" "$ahead" "$behind" "$date" "$subj"
done | sort -t' ' -k3
echo "== live-client anchors =="
for c in 5aeaaa051166e3c068184b37c031988d0d70ce81 326f0ea84dc78abfc135ec1207dd86fa8b1d8a37; do
  echo "--- $c"
  git branch -r --contains "$c" 2>/dev/null | head -4
  git log -1 --format='commit %cs %s' "$c" 2>/dev/null || echo "NOT IN LOCAL OBJECTS (fetch PR ref needed)"
done
echo "== merged-into-origin/main branches =="
git branch -r --merged origin/main | grep -v 'origin/HEAD\|origin/main' | wc -l

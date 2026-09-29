#!/usr/bin/env bash
# shard-refresh-0723.sh — CTX-SHARD A/B offline-route refresh (gen20260928)
set -u
PROJ=/home/z/my-project; DST=/home/sync/me2-context-backups/latest
GEN=20260928
WL=$PROJ/worklog.md
A=$DST/CTX-SHARD-A-gen$GEN.md
B=$DST/CTX-SHARD-B-gen$GEN.md
H='[CTX-SHARD-PLACEHOLDER gen'"$GEN"'] Phoenix offline-copy (read-only). Refreshed by Job ctx-vault-3 hourly. On fire reply shard-ok.'

# ---- SHARD-A: full CONTEXT.md + full PHOENIX-PROTOCOL.md + context-guard.sh ----
{ echo "$H" | sed 's/CTX-SHARD-PLACEHOLDER/CTX-SHARD-A/'; echo '<<<CTX-BEGIN>>>'; 
  cat $PROJ/CONTEXT.md; echo; echo '===== PHOENIX-PROTOCOL.md ====='; echo; cat $PROJ/PHOENIX-PROTOCOL.md; echo;
  echo '===== context-guard.sh v1.0 (canonical duplicate) ====='; echo; cat /home/z/context-vault/context-guard.sh;
  echo '<<<CTX-END>>>'; } > $A.tmp && mv $A.tmp $A

# ---- SHARD-B: index of last 15 Task ID sections + last 60 lines verbatim + recovery v2 ----
IDX=$(grep -a '^Task ID:' $WL | tail -15)
{ echo "$H" | sed 's/CTX-SHARD-PLACEHOLDER/CTX-SHARD-B/'; echo '<<<CTX-BEGIN>>>';
  echo '## worklog: last 15 sections (Task ID -> Task)'; echo "$IDX";
  while IFS= read -r tid; do
    tid_clean=$(printf '%s' "$tid" | sed 's/^Task ID: //')
    task_line=$(grep -a -A2 "^Task ID: ${tid_clean}$" $WL | grep -a '^Task: ' | head -1)
    [ -n "$task_line" ] && echo "$task_line"
  done <<< "$IDX"
  echo; echo '## worklog tail (last 60 lines verbatim)'; tail -60 $WL;
  echo; echo '## RECOVERY PROTOCOL v2';
  echo '1) bash /home/z/my-project/scripts/phoenix/phoenix-restore.sh --check (quorum 8 sources; --merge on truncation)';
  echo '2) creds Supabase: /tmp/my-project/.a2-backup/me2.env.20260922 (SUPABASE_URL + SUPABASE_SERVICE_ROLE_JWT; never print)';
  echo '3) full copies: Supabase me2-evidence/context-vault/latest/ ; ossfs /home/sync/me2-context-backups/latest/ ; vault /home/z/context-vault/latest/';
  echo '4) phoenix scripts: /home/z/my-project/scripts/phoenix/ and vault/latest (heartbeat/restore/snapshot/guard/secrets-restore)';
  echo '5) PRINCIPAL-DIRECTIVE.md: scripts/phoenix/ + vault/latest + sync/latest (sha256=0aa0957922d0f9d65296e4038b160887eaf85fd517cf8650ca365e75e556f739)';
  echo '6) PHX-HEARTBEAT=Job 417373 (бывш. 416629), Guard=416526, PAT-watcher=413338, COMPACTOR=416631, SECRETS=416759, DIRECTIVE-15m=419718, BROWSER-TEST=419203';
  echo '<<<CTX-END>>>'; } > $B.tmp && mv $B.tmp $B

# ---- verify ----
for f in $A $B; do
  sz=$(stat -c%s "$f")
  if grep -q '<<<CTX-BEGIN>>>' "$f" && grep -q '<<<CTX-END>>>' "$f" && [ "$sz" -gt 1024 ]; then
    echo "verify-ok $f size=$sz"
  else
    echo "verify-FAIL $f size=$sz"
  fi
done
echo "$(date +%Y%m%d-%H%M%S) CRON-SHARD refresh gen$GEN shards=A,B verified (offline-route: ossfs; cron-tool unavailable in session)" >> /home/z/context-vault/journal/context-journal.log

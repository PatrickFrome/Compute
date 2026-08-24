#!/usr/bin/env bash
set -euo pipefail

control_pid=""
runner_pid=""

cleanup() {
  if [[ -n "${control_pid}" ]] && kill -0 "${control_pid}" 2>/dev/null; then kill "${control_pid}" 2>/dev/null || true; fi
  if [[ -n "${runner_pid}" ]] && kill -0 "${runner_pid}" 2>/dev/null; then kill "${runner_pid}" 2>/dev/null || true; fi
  wait "${control_pid}" 2>/dev/null || true
  wait "${runner_pid}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

tsx src/control.ts &
control_pid=$!

tsx src/same_point_v4.ts &
runner_pid=$!

while true; do
  if ! kill -0 "${control_pid}" 2>/dev/null; then
    wait "${control_pid}"
    exit $?
  fi
  if ! kill -0 "${runner_pid}" 2>/dev/null; then
    wait "${runner_pid}"
    exit $?
  fi
  sleep 1
done

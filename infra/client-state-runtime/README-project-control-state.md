# Project control readback

The repair snapshot exposes stored project control separately from the existing
execution aggregate. The producer is
`public.h205f22_project_snapshot_v1(uuid,uuid,uuid,bigint,integer,uuid,text,bigint)`
in `native-coding-repair-v1.sql`. It returns `control_state` directly from the
authorized `project_run_h205f22.state`; reading a snapshot does not update it.

| Field | Meaning |
| --- | --- |
| `control_state` | Stored `ACTIVE`, `PAUSED`, or `COMPLETED` project control |
| `state` | Existing computed execution aggregate, unchanged |
| `selected_task.state` | Existing task execution phase, unchanged |

For example, a paused project with a running root returns
`control_state: PAUSED`, `state: ACTIVE`, and `selected_task.state: RUNNING`.
Unfinished children can produce `PAUSED / WAITING_CHILDREN`; rejection,
`AMBIGUOUS`, or `FENCED` can produce `PAUSED / BLOCKED`. The original review
rejection and history remain available. Pause does not cancel current work.

Workspace admission STOP/RESUME remains separately observable through
`devos_environment_state_v1`. Closing admission, a task becoming `FENCED`, and
stored project control do not prove physical cleanup or release capacity.

`normalizeClientProjectSnapshot` validates and retains the field.
`normalizeNativeCodingGoalProgress` carries it independently of `project_state`
and `task_state`; `physical_execution_proven` remains false. Missing fields from
older producers become `null`, meaning unknown. Null remains valid when an
already normalized snapshot is normalized again. Other supplied values are
rejected. The `found: false` contract is unchanged. UI consumers own the visual
presentation of these separate fields.

The native goal journal validates the same enum on write and reload. Routers
sharing one journal order observations per request before Host dispatch; late
snapshots or failures cannot replace a newer PAUSED observation. A later fresh
ACTIVE observation can still reflect an explicit resume. No execution is
replayed to obtain control readback.

The initial defect was reproduced on base
`0e43a569ad52134bee65dea3182ee9a4c4bbc56f`, tree
`897948a6e65c980f560f97b71abaca96c91e4069`, with native Linux PostgreSQL 17.11
and the complete registered application catalogue: stored `PAUSED`, running
task, aggregate `ACTIVE`, missing control field. The new regression fails that
observation on the predecessor and preserves it after the fix. The reviewed new
snapshot body SHA256 is
`2f5ed27d52c265fb284d72448e3596b935a1e56777d24f2d30bcc17c2b9a51b9`.
Both replay guards accept this exact body and continue rejecting unknown bodies
or metadata. Source pins in `fresh-schema-candidate-plan.json` match the SQL.

Run the complete-catalogue regression with explicit native PG17 and pinned
postgres.js 3.4.7 paths:

```sh
METAENGINE_PG_TEST_BIN=/absolute/path/to/pg17/bin \
METAENGINE_PG_TEST_DRIVER=/absolute/path/to/postgres/src/index.js \
node --test infra/client-state-runtime/project-control-state.pg17.test.mjs
```

The fixture owns a new disposable cluster and independently connected restricted
API login. Device/task data are generated SQL fixtures, not execution evidence.
It checks durable row fingerprints, child lookup/pagination, STOP/RESUME
admission, committed and rolled-back concurrent updates, fresh owner backend
readback, scope/epoch/RLS/grant fences, and authenticated migration replay.
Native execution/repair regression coverage remains in
`native-coding-initial-goal-seed.integration.test.mjs`. These Linux checks do not
qualify Windows installation or physical worker settlement.

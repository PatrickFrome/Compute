# METAENGINE — roadmap качественного скачка

Дата: 2026-10-05. Статус: **операционный Level-2 proposal / EVIDENCE_READY для review**, не новое каноническое расписание и не Supervisor seal.

## Принцип

Сохранить `docs/CANONICAL_ROADMAP.md`: `R1 → C1 → C2 → C3 → C4 → C5 → C6 → C7 → C8 → C9 → C10 → C11 → C12 → C13 → C14/C15 → C16 → C17`; F1+ только с собственным real-provider evidence. При конфликте с live DAG — HOLD, reconciliation, без самостоятельного повышения статуса.

Цель: Task-centered Development OS с доказуемым coding loop. Не усложнять control plane вместо first real compute.

## Приоритетный backlog с acceptance gates

| Приоритет / workstream | Канонический владелец | Что сделать | Проверяемый выход / условие допуска |
| --- | --- | --- | --- |
| P0 — proof convergence | Cross-cutting B0, поддерживает R1/C1/C2 | Синхронизировать native proof fix, guarded SQL и negative test corpus | Live `pg_proc`/ACL/search_path readback и 124 rollback canary passed; native/transport 192 pass + 2 Windows skip. **Это уже выполненный audit scope, не installed qualification.** |
| P0 — exact-source release | Cross-cutting prerequisite | Source qualification Ubuntu + Windows для нового точного SHA; затем новая monotonic immutable package identity | Оба source jobs terminal green; collision search; одна свежая reservation; installer digest/provenance; package smoke. Старый зелёный SHA не принимается. |
| P0 — installed/runtime acceptance | Cross-cutting prerequisite | Installed-chat, dirty-profile, self-update, recovery/soak на одном verified installer; direct user-machine readback | Exact executable SHA/version/generation; fresh Browser/Guardian/Supervisor heartbeat; negative no-retry cases; отсутствие mixed installer evidence. Пока OPEN. |
| P0 — continuity proof | R1 | Persisted readback в независимых continuity domains; restore quorum и retention drill | Evidence sealed Supervisor; восстановленный state соответствует ledger/root, а не только локальной копии. Operational audit checkpoint не засчитывается как R1. |
| P0 — первый реальный worker | C1 / W1 | Admit реальный Linux `cpu-local` worker: identity, capabilities, resource bounds, generation, lease, revocation | Реальное bounded задание; verified output; heartbeat; crash/restart/revocation и stale-generation negative tests; один mutation owner. Schema-only/CONTROL_PLANE_ONLY недостаточно. |
| P0 — первый coding loop | C2 / T0,T1,A1,C1_FIRST_SERIAL_CODING_LOOP | Isolated repo → edit/diff → build/test → immutable verified artifact | Одна реальная change request, source SHA/toolchain/workspace binding, passing tests, artifact digest/provenance, независимый readback; после disconnect/crash не возникает duplicate effect. |
| P1 — task-centered клиент | C2 usability, cross-cutting | Session workspace: objective, plan, editor/diff, test output, artifact, blocker; отдельная expert console | Пользователь проходит задачу и видит причину остановки без logs. Keyboard/screen-reader/high-DPI tests; stale и ambiguous обозначены текстом. UI по-прежнему zero-authority. |
| P1 — evidence inspector | R1/C2 observability | Единая причинная цепочка intent→claim→attempt→target→effect→receipt→artifact | Inspector показывает точный lease/generation/target/action-specific proof и timestamps; trace export redacted; no raw credentials; no promotion of synthetic evidence. |
| P1 — semantic branch convergence | Cross-cutting, поддерживает C2 | Review capability diffs native safety / Guardian / persistent bridge / DevOS integration; ограничить WIP | Отдельные PR/owners/milestone mapping; сохранить полезные hot-bridge и richer-action возможности без старой coercion/receipt семантики; не bulk merge 843 веток. |
| P1 — service hardening | B0 cross-cutting | Проверить deployed Edge custom device auth, sender IPC, permission/navigation bounds; актуальные auth/network/SSL configs | Negative unauthorized/revoked/cross-scope cases; source binding; least privilege; отдельно согласованные config changes. Не делать permissive RLS для advisor. |
| P1 — safe accelerators | C3 → C4 | uv/sccache/BuildKit-equivalent после C1/C2; затем toolchain/cache equivalence | Реальные cold/warm benchmarks и resource telemetry; cache identity includes exact inputs/environment/tools; wrong-toolchain/cache-poison canaries. |
| P2 — измеряемый parallel compute | C5 → C6 → C7 → C8 | Deterministic sharding, общий slot budget, trusted OTel/BEP, scheduler tournament | Сравнение с serial baseline по p50/p95, CPU/RAM, hit rate, queue time, cost, reliability; никакой promotion без real evidence. |
| P2 — distributed execution | C9 → C10 → C11 → C12 | Transactional work stealing, safe speculation, REAPI/CAS, verified materialization, incremental impact graph | Generation-fenced ownership transfer; side effects не speculated; digest/provenance outputs; dependency gates C1…C8 пройдены. |
| Позднее — GPU/scale/economics | C13 → C14/C15 → C16 → C17 | GPU admission; serving/distributed frameworks; cluster admission только при реальном contention; economic autoscaler | Real GPU/multiworker evidence, workload benchmarks и cost/reliability budget. Никаких Ray/Kubernetes/serving слоёв ради галочки до prerequisite gates. |

## Safe performance track

Persistent bridge — не второй authority domain. До переноса требуются fixed executable/script digest, bounded commands/lifetime/queue, authenticated IPC/session binding, abort semantics, exact target/generation и typed receipt corpus. Измерять startup, per-action latency, p95 и memory на реальном Windows host. Увеличение batch size не должно расширять mutation scope или позволять replay ambiguous effect.

Renderer performance: baseline на измеренных session sizes, далее module extraction, keyed incremental updates/virtualization и explicit truncation. Не обещать конкретный speedup без comparative measurements.

## Release chain: обязательный порядок

1. Создать isolated fix branch с immutable parent и content manifest; review source/migration changes. Не обновлять main и не merge исторические authority branches.
2. Qualify новый exact source SHA на Ubuntu и Windows. Локальный imported slice не заменяет эту матрицу.
3. Проверить collisions и зарезервировать новую monotonic package identity. Старую consumed reservation не переиспользовать, не удалять и не обходить.
4. Собрать package once; проверить provenance и один installer digest.
5. Installed qualification, self-update/recovery/dirty-profile/soak на том же digest.
6. После явного разрешения на изменение пользовательской машины получить direct installed live readback. Публикация source branch сама по себе не является таким разрешением.
7. Supervisor review → valid semantic checkpoint → independent root/ledger verification. Operational audit rows не дают canonical authority.

## Evidence policy

`SCHEMA_ONLY`, `CONTROL_PLANE_ONLY`, `SYNTHETIC`, `LIVE`, `EVIDENCE_READY`, `VERIFIED` не взаимозаменяемы. Для каждого результата записывать exact SHA, artifact hashes, origin/read time, platform, scope и unmet gates. `AMBIGUOUS_NO_RETRY` terminal per attempt; `NO_EFFECT_PROVEN` требует явный pre-effect boundary. Queue/Realtime/model/page data никогда не authority.

DB audit checkpoints append-only для штатных ролей, с generated payload hash и `canonical_checkpoint=false`. Они фиксируют audit/roadmap, но не дают право закрыть milestones, переставить live DAG или повторить физический эффект. Для защиты от DB-admin tampering нужен внешний continuity witness.

## Success metrics

- C1: real admitted worker выполняет bounded task после restart; revoked/stale identity отвергаются.
- C2: реальная задача даёт reproducible build/test outcome и verified artifact; task→artifact trace полон.
- Safety: все установленные negative proof/no-retry tests проходят; нет ложного EFFECT_PROVEN; нет duplicate physical dispatch при unknown outcome.
- UX: task/blocker/result понятны без operations logs; ambiguous состояния не маскируются success badge; accessibility проверена физически.
- Reliability/performance: измеренный p50/p95 task/action/IPC latency, recovery time, memory/CPU budget, verified throughput/cost; targets устанавливать после baseline, не выдумывать показатели.

## Открытые gates на завершении аудита

Новый exact-source Ubuntu/Windows CI, package/provenance, installed runtime, direct user-machine live readback, R1 restore quorum, C1 admitted Linux worker и C2 serial coding loop остаются OPEN до собственных fresh evidence. Последний audit readback: 0 fresh Browser heartbeats и 0 active actuation leases; не интерпретировать это как подтверждение fault или как успешную installed qualification.

Полный разбор: [METAENGINE_CRITICAL_AUDIT_2026-10-05.md](METAENGINE_CRITICAL_AUDIT_2026-10-05.md). Публикация и DB hashes: `evidence/metaengine-client/audit-synchronization-receipt.json`.

# a2-edge-local — локальный runtime edge-функции METAENGINE

Запуск канонической edge-функции `a2-browser-native-supervisor-v1` (из монорепо
`rsi-work/Compute-r`) под Bun против локальной rootless PostgreSQL (Pigsty, порт
55432). Репозиторий НЕ модифицируется: при каждом старте код синхронизируется в
`edge-runtime/` с единственной переписанной строкой Deno-импорта.

## Запуск
```bash
cd mini-services/a2-edge-local
bun run dev            # порт 3031, A2_EDGE_DEBUG=1 — дамп материала подписи
```

## Проверка
```bash
bun test-e2e.ts        # 10 проверок: T2 (enrollment/auth/heartbeat),
                       # T5 (issue→lease→receipt→readback), T11 (pg_notify wake)
```

## Контракты (важно для любых клиентов)
- Подпись запроса покрывает **полный путь с маркером**: canonicalPath =
  `/a2-browser-native-supervisor-v1` + маршрут (например
  `/a2-browser-native-supervisor-v1/v1/commands/next-batch`).
- JWK канонизируется edge в порядке ключей `{crv,ext,key_ops,kty,x,y}` —
  fingerprint = sha256(JSON.stringify(каноничный JWK)).
- Batch-результат требует **топ-уровневый `ok:true`** в каждом элементе
  (v_ok := item->>'ok'; иначе FAILED command_failed).
- READ_ONLY (POLL) не требует effect_outcome; мутации требуют
  effect_outcome ∈ {CONFIRMED, NO_EFFECT_PROVEN} (иначе postcondition_readback_required).
- wake-notify: конверт `{tbl,client,...}`; если команда без target_client_id —
  client=null → будит всех официантов; для точечного wake указывайте
  target_client_id = client_id устройства.

## Зависимости от состояния БД
- Триггеры `glm_pulse_*` (bootstrap/07-wake-triggers.sql) обязательны для wake.
  При пересоздании командных таблиц миграциями — применять 07 заново.
- Enrollment-слой — bootstrap/06-reconstruct-device-enrollment.sql.
- Оператор-гейт одобрения enrollment — UPDATE status='APPROVED' в БД (у нас
  эмулируется psql; в проде — оператор в UI/БД).

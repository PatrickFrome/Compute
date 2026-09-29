# R64 — OS-Sandbox (P0-2): сверка с каноном Cursor

Раунд R64 (2026-09-24). Гэп P0-2 из R61-GAP-ANALYSIS (`sec.sandbox-os` + `sec.network-deny` + `sec.sandbox-config`). Источник канона: корпус R61, трек D (D08/D09/D10/D11/D12), цитаты дословные. Дисциплина §34: не приписываем Cursor того, чего нет в корпусе; свои части честно маркируем.

## 1. Живые пробы ядра этого хоста (evidence R64-0)

| Проба | Результат | Следствие |
|---|---|---|
| `landlock_create_ruleset(NULL,0,VERSION)` через bun:ffi | **-1 (ENOSYS)** — ядро 5.10.134 (kangaroo/al8), Landlock появился в 5.13 | Канонический Landlock-путь недоступен → риск из GAP-ANALYSIS сработал live → слоистый дизайн обязателен |
| `/proc/sys/user/max_user_namespaces` | 462, `unshare -Ur` ok | userns доступен → bwrap-стиль (ns) реализуем без root |
| `Seccomp:` из /proc/self/status | 2 (filter mode разрешён) | seccomp-bpf через prctl доступен |
| прямой `unshare(CLONE_NEWUSER)` из bun | **EINVAL** (bun многопоточен, threads=5) | цепочка через util-linux `unshare --user --map-root-user --mount` (живая проба R64-1: все маунты ok) |

## 2. Сверка с каноном (цитаты — корпус R61)

| # | Канон Cursor (цитата/факт) | ME2 R64 | Вердикт |
|---|---|---|---|
| 1 | **D09**: «We decided to use Landlock and seccomp directly.» Linux-сандбокс = Landlock (fs) + seccomp (syscalls); workspace в overlay; user namespace с UID→0; «`CURSOR_SANDBOX_LANDLOCK_STATUS` reports `fully_enforced` (Landlock), `bubblewrap` (fallback)» | Слоисто: Landlock-путь в launcher (ABI-проба, применяется на ≥5.13) + слой **ns** (userns+mountns через util-linux unshare: ro-вид корня, rw-rebind управляемых корней, приватный tmpfs /tmp, tmpfs-RO поверх секретов) + seccomp-bpf (deny-лист). Маркер `ME2_SANDBOX=1` + `ME2_SANDBOX_LAYERS` + verdict-файл со слоями (аналог LANDLOCK_STATUS — у нас честнее: каждый слой отдельно) | **PARITY по архитектуре, честный PARTIAL по fs-механике на этом ядре**: mount-ns даёт ro/rw-границыу вида, но не inode-гранулярность Landlock; overlay-remap игнорируемых файлов не делаем (P1) |
| 2 | **D09**: seccomp блокирует unsafe syscalls; io_uring-обход не упомянут | Deny-лист 28 syscall'ов (mount/pivot/chroot/reboot/kexec/модули/bpf/ptrace/keyring/unshare/setns/userfaultfd/perf/open_by_handle/process_vm/**io_uring**×3) + clone с CLONE_NEW*-флагами → EPERM; clone3 сознательно разрешён (BPF не видит флаги в структуре; эксплуатация закрыта deny mount/unshare/setns; glibc posix_spawn fallback на EPERM не гарантирован — инцидент docker-seccomp 2022) | **SUPERIOR в одной точке**: io_uring_setup/enter/register закрыты — на ядре 5.10 io_uring-операции не проходят через seccomp submit-потока (документированный обход); Cursor в корпусе это не упоминает. Честно: возможно, закрывает у себя иначе (overlay+Landlock достаточно) |
| 3 | **D11**: «Network: Blocked by default, then opened by your network mode and sandbox.json» — режимы Only / +Defaults (~100 доменов пакетных менеджеров) / Allow All; wildcard и CIDR; deny > allow | `net: "deny"` — socket(AF_INET/AF_INET6) → EPERM на уровне BPF (живой probe: EPERM + listener-хитов 0; контроль net=allow → соединение есть — отказ именно фильтр); доменный allowlist НЕ реализован (нет прокси-обёртки) | **PARTIAL**: default-deny полный и доказанный; доменный allowlist+CIDR = P1 egress-modes (в DAG R61 так и записано) |
| 4 | **D11**: SSRF-блок: «RFC 1918 + 169.254.169.254 (cloud metadata) ... blocked by default to prevent SSRF» | При net=deny недоступна ВЕСЬ интернет, включая metadata — SSRF-защита достигается тривиально; при net=allow (контроль-режим) metadata пока не блокируется | **PARITY при deny / PARTIAL при allow** — задокументировано в honest_limits |
| 5 | **D12**: маркеры в окружении ребёнка: `CURSOR_SANDBOX`="seatbelt"/"native", `CURSOR_ORIG_UID/GID`, `CURSOR_SANDBOX_LANDLOCK_STATUS` | `ME2_SANDBOX=1`, `ME2_SANDBOX_LAYERS=ns+seccomp`, env-белый-список без секретов (env_keys в вердикте — доказательство); uid-remap через --map-root-user (как канон Docker --user) | **PARITY** (маркер сессии аналогичен, статус слоёв — в verdict-файле, а не только env) |
| 6 | **D08/D09**: профиль генерируется в рантайме из workspace + admin settings + .cursorignore; «Config as data (sandbox.json) with layered merge (user < repo < team < hardcoded)» (§472) | `policy.json sandbox` (SandboxPolicy: auto_sandbox/net/extra_hide/strict/tmp_size) + runtime-override POST /sandbox op:config; DEFAULTS в policy.ts = hardcoded-слой | **PARITY** (merge-порядок user<repo<team — у нас файл оператора + дефолты; repo/team-слои — P1) |
| 7 | **D02**: порядок enforcement — allowlist → sandbox-ability → classifier; sandbox-ability кормит классификатор | tier-1 planExec обязателен для ЛЮБОЙ команды сандбокса (non-bypass); classifyGate выдаёт вердикт «sandbox» при sandbox.auto_sandbox=true И живом конфайнменте (sandboxEligible); явный sandbox:true + fs-риск (FS_RULES) → конфайнмент вместо очереди оператора | **PARITY + чуть строже**: у Cursor sandbox-ability — способность запустить; у нас — probe-подтверждённый конфайнмент, вердикт «sandbox» не выдаётся при unsandboxed (fail-closed) |
| 8 | «Sandbox blocks unauthorized file access» — sandbox как fs-гарантия | Живое доказательство R64: `echo pwn64 > /home/z/my-project/pwn64.txt` в сандбоксе → **EROFS**, файла нет (host-view ls); `/home/z/.a2` — пустой tmpfs-RO внутри ns (секреты не читаемы и не записываемы); эскале-детектор в probe (SANDBOX_ESCAPE, budget-weight 3) | **PARITY с живым evidence** |
| 9 | **D09**: «fully_enforced» vs fallback — честная диагностика; скрипты должны учитывать remap | strict fail-closed: make_private/ro_root/rw_rebinds/secrets_hidden/seccomp/rlimits — обязательные слои; не применились → **sandbox_failed, команда НЕ исполнена** (SANDBOX_FAILED, weight 2); verdict-файл пишется до и после фильтра («pending»-страховка) | **SUPERIOR**: у Cursor fallback = bubblewrap (другой движок); у нас строгий fail-closed — «не смогли конфайнить = не исполняем» (канон ME2 non-bypass) |
| 10 | **D08** (macOS Seatbelt): «A generated sandbox profile limits file access, network access, and other process behavior for the full subprocess tree» | Дерево процессов: фильтр+ns наследуются fork/exec; таймаут → killTree родителя (канон R62); rlimits (AS=4GiB — урок V8 CodeRange R62, NOFILE=256, CORE=0) на ребёнка через setrlimit в launcher | **PARITY** (полное дерево под конфайнментом; macOS-профиль вне скоупа хоста) |

## 3. Открытые находки раунда (в канон)

1. **Инверсия jt/jf в arch-check BPF** = EPERM каждому syscall'у после установки фильтра → segfault bun (пост-фильтрная активность рантайма на unchecked EPERM). Урок: классический BPF «JEQ arch, jt=1 (пропустить RET EPERM), jf=0»; а deny-записи наоборот. Диагностика — file-trace маркерами (stdout буферизуется, теряется при segfault).
2. **Сериализация sock_filter** = 8 байт `[u16 code][u8 jt][u8 jf][u32 k]`, а не 4×u32 — плоский массив чисел (code,jt,jf,k) сериализуется покомпонентно.
3. **Сегмент-сплитер R62 режет по `;` внутри кавычек** — `node -e "a();b()"` = два «сегмента» → binary_not_allowed. Для probe-скриптов: одно выражение без разделителей (чейнинг методов). Общий парсер кавычек — кандидат P1 (сейчас честно задокументировано).
4. **unshare(CLONE_NEWUSER) из многопоточного bun невозможен** (EINVAL, !thread_group_empty) → util-linux unshare как exec-префикс; bun-launcher уже внутри ns.
5. **io_uring закрыт в фильтре** — не «параноидальная» запись: на 5.10 операции io_uring не проходят через seccomp submit-потока (обход фильтра), ядро ≥5.19/6.x частично закрыло это на уровне vfs; закрытие setup/enter/register делает обход недоступным.

## 4. Честные пределы (зеркало honest_limits /sandbox)

- Landlock ENOSYS на 5.10 → fs-гранулярность = mount-ns (ro/rw-границыу вида, не inode-level); Landlock-путь в коде, включится сам на ядре ≥5.13.
- Доменный network-allowlist + SSRF при net=allow → P1 egress-modes.
- Не security boundary против root/ядра (канон Cursor D: «explicitly NOT a security boundary» относится к классификатору; сандбокс — реальная граница, но в рамках uid/ns/syscall этой машины).
- /dev/shm, /run не реbind'ились (ro-вид) — node/bash этого не требуют; при необходимости — точечные rw-rebind (данные слоя, не кода).

## 5. Доказательства раунда (evidence)

- Probe 4/4 (REST + обе панели): write_inside exit 0 (37-44мс на полную цепочку unshare+mounts+seccomp+exec!), write_outside_denied exit 1, net_denied exit 7 EPERM + listener-хитов 0, net_allow_control hit=yes, escape=false, 185-443мс на весь probe.
- Канон D02 live: sandbox:true + fs-риск → EROFS, файл не создан; БЕЗ sandbox → classifier_ask в очереди (R63-поведение не тронуто); auto_sandbox=true → вердикт «sandbox» → авто-конфайнмент; возврат конфига → ask.
- Eval v28 **PASS 65/65 ×2** (стабильность повтором); non-bypass **33/33 NO_BYPASS** (двустороннее равенство исходник↔манифест).
- node под сандбоксом: `node -e "console.log(42)"` → exit 0, «42» (V8-рантайм жив под deny-листом без io_uring).
- Браузерная QA :81: консольная SANDBOX-карточка (probe 4/4 кликом), MC /ui секция (прогон exit 0 со всеми 9 слоями + probe 4/4 кликом), mobile390 hs=false, console errors=0. Скриншоты: r64-console-sandbox{,-mobile}.png, r64-mc-sandbox{,-mobile}.png. VLM-ревью → 429 (одна проба, окно квоты закрыто — 14-я сессия).

// ── R64 P0-2 «OS-sandbox»: чистый seccomp-bpf билдер (zero imports) ──
//
// Гэп: R61-GAP-ANALYSIS §P0-2 (capability `sec.sandbox-os` + `sec.network-deny`).
// Канон Cursor (корпус R61): Linux-сандбокс = Landlock + seccomp; сеть
// default-deny с allowlist + SSRF-блок; профиль — «конфигурация как данные».
//
// ЧИСТАЯ функция (без spawn/FFI/FS) — импортируется launcher'ом (установка
// фильтра) и eval'ом (plan-инварианты целостности программы). Канон R25:
// «spawn в sync-харнесе запрещён» → все eval-инварианты здесь байтовые.
//
// Архитектура фильтра (x86_64, classic BPF, default-ALLOW + explicit-deny):
//   1. arch check — AUDIT_ARCH_X86_64, иначе EPERM (чужие ABI не проходим);
//   2. deny-лист опасных syscall'ов (mounted/pivot/chroot/reboot/kexec/модули/
//      bpf/ptrace/keyring/unshare/setns/userfaultfd/perf/open_by_handle/
//      process_vm/io_uring/clone3) → EPERM;
//   3. net=deny → socket(2) с доменом AF_INET/AF_INET6 → EPERM (default-deny
//      сети; AF_UNIX/AF_NETLINK не трогаем — честное ограничение, доменный
//      allowlist = P1 egress-modes);
//   4. clone(2) с CLONE_NEW*-флагами → EPERM (анти-re-unshare: новый userns
//      в конфайнменте открывал бы доступ к свежим маунтам);
//   5. RET ALLOW.
//
// io_uring denying — не паранойя: io_uring-операции ядро 5.10 не проводит
// через seccomp-фильтр submit-потока → это документированный обход фильтра;
// закрытие setup/enter/register делает обход недоступным.

export type NetMode = "deny" | "allow";

// ── classic BPF opcodes (linux/filter.h) ──
const BPF_LD_W_ABS = 0x20; // A = k[abs offset]
const BPF_JEQ_K = 0x15; // A == k ? +jt : +jf
const BPF_ALU_AND_K = 0x54; // A &= k
const BPF_RET_K = 0x06; // return k

// seccomp_data offsets: nr=0, arch=4, instruction_pointer=8, args[0]=16
const OFF_NR = 0;
const OFF_ARCH = 4;
const OFF_ARG0 = 16;

const AUDIT_ARCH_X86_64 = 0xc000003e;

const SECCOMP_RET_ERRNO_BASE = 0x00050000;
const SECCOMP_RET_ALLOW = 0x7fff0000;
const EPERM = 1;

/** x86_64 syscall numbers — deny-лист (canonical Bwrap/Chrome/Chromium-канон). */
export const SECCOMP_DENY_SYSCALLS: ReadonlyArray<{ nr: number; name: string }> = [
  { nr: 165, name: "mount" }, { nr: 166, name: "umount2" }, // маунты вне ns
  { nr: 161, name: "chroot" }, { nr: 218, name: "pivot_root" }, // смена корня
  { nr: 169, name: "reboot" },
  { nr: 167, name: "swapon" }, { nr: 168, name: "swapoff" },
  { nr: 246, name: "kexec_load" }, { nr: 320, name: "kexec_file_load" },
  { nr: 175, name: "init_module" }, { nr: 273, name: "finit_module" }, { nr: 176, name: "delete_module" },
  { nr: 321, name: "bpf" }, // загрузка BPF-программ
  { nr: 101, name: "ptrace" }, // инъекции/инспекция чужих процессов
  { nr: 250, name: "keyctl" }, { nr: 248, name: "add_key" }, { nr: 249, name: "request_key" },
  { nr: 272, name: "unshare" }, { nr: 308, name: "setns" }, // выход из ns
  { nr: 323, name: "userfaultfd" }, // heap-grooming / races
  { nr: 298, name: "perf_event_open" },
  { nr: 303, name: "name_to_handle_at" }, { nr: 304, name: "open_by_handle_at" }, // обход mount-границ
  { nr: 310, name: "process_vm_readv" }, { nr: 311, name: "process_vm_writev" },
  { nr: 425, name: "io_uring_setup" }, { nr: 426, name: "io_uring_enter" }, { nr: 427, name: "io_uring_register" }, // обход seccomp (5.10)
];
// NB: clone3(435) СОЗНАТЕЛЬНО не в deny-листе: флаги ns в clone3 — указатель на
// структуру (classic BPF не видит содержимое), но эксплуатация требует
// mount/unshare/setns/chroot/pivot_root — все уже denied; исключение clone3
// бережёт glibc posix_spawn (fallback clone3→clone на EPERM в glibc 2.35
// не гарантирован — инцидент docker-seccomp 2022).

/** CLONE_NEW* маска (NS|USER|IPC|UTS|CGROUP|PID|NET) — clone(2) с этими флагами = новый ns. */
export const CLONE_NEW_FLAGS_MASK = 0x00020000 | 0x02000000 | 0x04000000 | 0x08000000 | 0x10000000 | 0x20000000 | 0x40000000;
const NR_SOCKET = 41;
const NR_CLONE = 56;

export interface SeccompProgram {
  instrs: number[];        // классическая BPF-программа (по 4 числа на инструкцию... фактически [code, jt, jf, k])
  deny_syscalls: string[]; // имена denied (доказательство в вердикте)
  net: NetMode;            // применённый режим сети
  len: number;             // число инструкций
}

/** ЧИСТЫЙ билдер: net=deny добавляет socket-блок, иначе программа без сети. */
export function buildSeccompFilter(net: NetMode): SeccompProgram {
  const prog: number[] = [];
  const push = (code: number, jt: number, jf: number, k: number) => { prog.push(code, jt, jf, k); };
  const retEperm = () => push(BPF_RET_K, 0, 0, SECCOMP_RET_ERRNO_BASE | EPERM);

  // 1) arch check: чужая архитектура → EPERM (arch СОВПАЛ → +1, минуя RET EPERM;
  //    инверсия jt/jf здесь = EPERM каждому syscall'у — живой segfault-урок R64)
  push(BPF_LD_W_ABS, 0, 0, OFF_ARCH);
  push(BPF_JEQ_K, 1, 0, AUDIT_ARCH_X86_64);
  retEperm();
  // 2) load syscall nr
  push(BPF_LD_W_ABS, 0, 0, OFF_NR);

  // 3) deny-лист: JEQ nr → RET EPERM; иначе дальше
  for (const { nr } of SECCOMP_DENY_SYSCALLS) {
    push(BPF_JEQ_K, 0, 1, nr);
    retEperm();
  }

  // 4) net=deny: socket(AF_INET|AF_INET6) → EPERM; остальное — дальше
  if (net === "deny") {
    const block: number[] = [];
    const bp = (c: number, j: number, f: number, k: number) => block.push(c, j, f, k);
    // блок: LD arg0; JEQ 2 → EPERM; JEQ 10 → EPERM; (fallthrough = продолжение общей программы)
    bp(BPF_LD_W_ABS, 0, 0, OFF_ARG0);
    bp(BPF_JEQ_K, 0, 1, 2); // AF_INET
    block.push(BPF_RET_K, 0, 0, SECCOMP_RET_ERRNO_BASE | EPERM);
    bp(BPF_JEQ_K, 0, 1, 10); // AF_INET6
    block.push(BPF_RET_K, 0, 0, SECCOMP_RET_ERRNO_BASE | EPERM);
    // длина блока без финального продолжения — jf у JEQ 41 должен перепрыгнуть весь блок
    push(BPF_JEQ_K, 0, block.length / 4, NR_SOCKET);
    prog.push(...block);
  }

  // 5) clone(2) с CLONE_NEW*-флагами → EPERM (анти-re-unshare)
  const cloneBlock: number[] = [];
  cloneBlock.push(BPF_LD_W_ABS, 0, 0, OFF_ARG0);
  cloneBlock.push(BPF_ALU_AND_K, 0, 0, CLONE_NEW_FLAGS_MASK);
  cloneBlock.push(BPF_JEQ_K, 1, 0, 0); // маска чиста → +1 (перепрыгнуть RET EPERM)
  cloneBlock.push(BPF_RET_K, 0, 0, SECCOMP_RET_ERRNO_BASE | EPERM);
  push(BPF_JEQ_K, 0, cloneBlock.length / 4, NR_CLONE);
  prog.push(...cloneBlock);

  // 6) всё прочее — ALLOW
  push(BPF_RET_K, 0, 0, SECCOMP_RET_ALLOW);

  return {
    instrs: prog,
    deny_syscalls: SECCOMP_DENY_SYSCALLS.map((d) => d.name),
    net,
    len: prog.length / 4,
  };
}

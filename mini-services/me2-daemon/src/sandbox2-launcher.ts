// ── R64 P0-2 «OS-sandbox»: launcher — конфайнмент + exec (standalone bun script) ──
//
// Запускается daemon'ом ПОСЛЕ util-linux `unshare --user --map-root-user --mount
// --propagation private` (bun многопоточен — прямой unshare(CLONE_NEWUSER) из
// bun невозможен: EINVAL; живая проба R64-1, threads=5).
//
// Цепочка канонического слоя «ns» (ядро 5.10 этого хоста; Landlock появился в
// 5.13 → честный skip, путь сохранён для ядер ≥5.13 — канон Cursor «Landlock
// на Linux» без указания минимальной версии):
//
//   [daemon] bun sandbox2-launcher.ts <profile> -- bash -c <cmd>
//      ↑argv строит planSandbox() — tier-1 план уже проверен
//
//   launcher (внутри userns+mountns, uid=0→host-z):
//     1. маунты: make-private → bind / → RO-remount(rec) → RW-rebind управляемых
//        корней → tmpfs /tmp (свежий, приватный) → tmpfs-RO поверх секретов
//        (/home/z/.a2) → RW-rebind /dev/null (редиректы тестов);
//     2. Landlock (ABI≥1; на 5.10 — честный "unsupported");
//     3. setrlimit (RLIMIT_AS=4GiB — канон R62 про V8 CodeRange; NOFILE=256; CORE=0)
//        — на ребёнка (tier-2 prlimit-семантика сохранена без бинарника prlimit);
//     4. prctl(NO_NEW_PRIVS) + prctl(SECCOMP_MODE_FILTER, BPF) — deny-лист
//        (src/seccomp-filter.ts, общий с eval — инварианты из ОДНОГО источника);
//     5. verdict JSON (какие слои применены — родитель решает strict fail-closed);
//     6. spawnSync ребёнка (stdio inherit → родительские пайпы), exit-код — наружу.
//
// Fail-closed: родитель запускает ребёнка ТОЛЬКО при строгих слоях; отсутствие/
// нечитаемость verdict-файла = sandbox_failed (команда не исполнена).
// Zero-authority: launcher не трогает шину 47/47, DB не открывает (ro-мир).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dlopen, FFIType, ptr } from "bun:ffi";
import { buildSeccompFilter, type NetMode } from "./seccomp-filter";

interface LauncherProfile {
  verdict_path: string;
  cmd: string[];
  cwd: string;
  rw: string[];           // RW-корни (маунт-rebind поверх RO-вида)
  hide: string[];         // tmpfs-RO поверх (секреты)
  net: NetMode;
  tmp_size: string;
  landlock: boolean;      // пытаться Landlock (ABI≥1)
  rlimits: { as: number; nofile: number; core: number };
  env: Record<string, string>;
}

const argvProfile = process.argv[2];
if (!argvProfile || !existsSync(argvProfile)) {
  console.error("ME2_SANDBOX2 launcher: profile required");
  process.exit(64);
}
let profile: LauncherProfile;
try {
  profile = JSON.parse(readFileSync(argvProfile, "utf8")) as LauncherProfile;
} catch (e) {
  console.error("ME2_SANDBOX2 launcher: profile unreadable", String(e).slice(0, 100));
  process.exit(64);
}

// ── FFI: libc ─────────────────────────────────────────────────────────
const S = (s: string) => Buffer.from(s + "\0");
const libc = dlopen("libc.so.6", {
  mount: { args: [FFIType.cstring, FFIType.cstring, FFIType.cstring, FFIType.u64, FFIType.cstring], returns: FFIType.i32 },
  prctl: { args: [FFIType.i32, FFIType.u64, FFIType.u64, FFIType.u64, FFIType.u64], returns: FFIType.i32 },
  setrlimit: { args: [FFIType.i32, FFIType.u64], returns: FFIType.i32 },
  syscall: { args: [FFIType.i64, FFIType.u64, FFIType.u64, FFIType.u64, FFIType.u64, FFIType.u64], returns: FFIType.i64 },
  open: { args: [FFIType.cstring, FFIType.i32, FFIType.i32], returns: FFIType.i32 },
  close: { args: [FFIType.i32], returns: FFIType.i32 },
});

// mount flags
const MS_RDONLY = 1, MS_NOSUID = 2, MS_NODEV = 4, MS_REMOUNT = 32, MS_BIND = 4096, MS_REC = 16384, MS_PRIVATE = 1 << 18;
// rlimit ресурсы (x86_64)
const RL_CORE = 4, RL_NOFILE = 7, RL_AS = 9;
// landlock syscall номера (x86_64)
const LL_CREATE_RULESET = 444, LL_ADD_RULE = 445, LL_RESTRICT_SELF = 446;
const LL_RULE_PATH_BENEATH = 1;
const O_PATH = 0x200000, O_CLOEXEC = 0x80000;

const layers: Record<string, string | boolean> = {};

const doMount = (src: string, tgt: string, fs: string, flags: number, data: string): boolean =>
  libc.symbols.mount(S(src), S(tgt), S(fs), flags, S(data)) === 0;

// ── 1. МАУНТЫ ─────────────────────────────────────────────────────────
// порядок критичен: приватность → RO-вид → RW-rebinds → tmpfs → hide → dev/null
layers.make_private = doMount("", "/", "", MS_REC | MS_PRIVATE, "");
layers.ro_root = doMount("/", "/", "", MS_BIND | MS_REC, "")
  ? doMount("none", "/", "", MS_REMOUNT | MS_BIND | MS_RDONLY | MS_REC, "")
  : false;

const rebindRw = (dir: string): boolean => {
  const base = dir.replace(/\/+$/, "") || "/";
  if (!existsSync(base)) return false;
  if (!doMount(base, base, "", MS_BIND | MS_REC, "")) return false;
  return doMount("none", base, "", MS_REMOUNT | MS_BIND, "");
};
const rebinds: Record<string, boolean> = {};
for (const r of profile.rw) rebinds[r] = rebindRw(r);
layers.rw_rebinds = Object.values(rebinds).every(Boolean);
layers.rw_rebind_detail = Object.entries(rebinds).map(([k, v]) => `${k}:${v ? "ok" : "fail"}`).join(",").slice(0, 200);

layers.tmpfs_tmp = doMount("tmpfs", "/tmp", "tmpfs", MS_NOSUID | MS_NODEV, `mode=1777,size=${profile.tmp_size}`);

const hides: Record<string, boolean> = {};
for (const h of profile.hide) {
  // цель должна существовать; tmpfs RO — содержимое СКРЫТО и запись невозможна
  hides[h] = existsSync(h) ? doMount("tmpfs", h, "tmpfs", MS_NOSUID | MS_NODEV | MS_RDONLY, `mode=000,size=16k`) : "absent";
}
layers.secrets_hidden = Object.values(hides).every((v) => v === true || v === "absent");
layers.hide_detail = Object.entries(hides).map(([k, v]) => `${k}:${v}`).join(",").slice(0, 200);

layers.devnull_rw = existsSync("/dev/null") && doMount("/dev/null", "/dev/null", "", MS_BIND, "")
  ? doMount("none", "/dev/null", "", MS_REMOUNT | MS_BIND, "")
  : false;

// ── 2. LANDLOCK (ABI≥1; здесь — этап честного skip на 5.10) ──────────
let landlockStatus = "skipped";
if (profile.landlock) {
  try {
    // версия ABI: create_ruleset(NULL, 0, LANDLOCK_CREATE_RULESET_VERSION=1<<0)
    const abi = Number(libc.symbols.syscall(LL_CREATE_RULESET, 0, 0, 1 << 0, 0, 0));
    if (abi >= 1) {
      // handled_access_fs: базовые биты ABI1 + REFER(ABI2)/TRUNCATE(ABI3) в пределах abi
      let fsBits = 0x1fff; // EXECUTE..MAKE_SYM (ABI1)
      if (abi >= 2) fsBits |= 1 << 13; // REFER
      if (abi >= 3) fsBits |= 1 << 14; // TRUNCATE
      const attr = new ArrayBuffer(8);
      new DataView(attr).setBigUint64(0, BigInt(fsBits), true);
      const fd = Number(libc.symbols.syscall(LL_CREATE_RULESET, ptr(attr), 8, 0, 0, 0));
      if (fd >= 0) {
        const addRule = (path: string, allowed: number): boolean => {
          const pfd = Number(libc.symbols.open(S(path), O_PATH | O_CLOEXEC, 0));
          if (pfd < 0) return false;
          const rule = new ArrayBuffer(16);
          const dv = new DataView(rule);
          dv.setBigUint64(0, BigInt(allowed), true);
          dv.setInt32(8, pfd, true);
          const ok = Number(libc.symbols.syscall(LL_ADD_RULE, fd, LL_RULE_PATH_BENEATH, ptr(rule), 0, 0)) === 0;
          libc.symbols.close(pfd);
          return ok;
        };
        const READ = 0x1 | 0x4 | 0x8; // EXECUTE|READ_FILE|READ_DIR
        const ALL = fsBits;
        addRule("/", READ); // системный ro-доступ
        for (const r of profile.rw) addRule(r.replace(/\/+$/, ""), ALL); // RW-корни
        const restricted = Number(libc.symbols.syscall(LL_RESTRICT_SELF, fd, 0, 0, 0, 0)) === 0;
        landlockStatus = restricted ? "applied" : "restrict_failed";
      } else landlockStatus = "ruleset_failed";
    } else landlockStatus = `unsupported_abi_${abi}`;
  } catch (e) {
    landlockStatus = "error";
  }
}
layers.landlock = landlockStatus;

// ── 3. RLIMITS (на ребёнка — наследуются при exec) ────────────────────
const setRlimit = (res: number, val: number): boolean => {
  const rl = new ArrayBuffer(16);
  const dv = new DataView(rl);
  dv.setBigUint64(0, BigInt(val), true);
  dv.setBigUint64(8, BigInt(val), true);
  return libc.symbols.setrlimit(res, ptr(rl)) === 0;
};
layers.rlimit_as = setRlimit(RL_AS, profile.rlimits.as);
layers.rlimit_nofile = setRlimit(RL_NOFILE, profile.rlimits.nofile);
layers.rlimit_core = setRlimit(RL_CORE, profile.rlimits.core);

// ── 4. SECCOMP-BPF (verdict пишется ДВАЖДЫ: до фильтра «pending» и после —
// финал; если post-write упадёт (io_uring-отказ bun под фильтром) — вердикт
// останется «pending» → strict fail-closed у родителя, честно перебор, не дыра)
const writeVerdict = (seccompValue: string): boolean => {
  try {
    writeFileSync(profile.verdict_path, JSON.stringify({ layers: { ...layers, seccomp: seccompValue }, ts: Date.now() }), { mode: 0o600 });
    return true;
  } catch (e) {
    console.error("ME2_SANDBOX2 launcher: verdict write failed", String(e).slice(0, 100));
    return false;
  }
};
writeVerdict("pending"); // страховка до установки фильтра
let seccompStatus = "not_installed";
try {
  const nnp = libc.symbols.prctl(38, 1, 0, 0, 0); // PR_SET_NO_NEW_PRIVS
  if (nnp === 0) {
    const prog = buildSeccompFilter(profile.net);
    // struct sock_filter = 8 байт: [u16 code][u8 jt][u8 jf][u32 k] — число-инструкции
    // в prog.instrs плоские (code,jt,jf,k), сериализация покомпонентная!
    const byteLen = (prog.instrs.length / 4) * 8;
    const real = new ArrayBuffer(byteLen);
    const rv = new DataView(real);
    let off = 0;
    for (let i = 0; i < prog.instrs.length; i += 4) {
      rv.setUint16(off, prog.instrs[i]! & 0xffff, true);
      rv.setUint8(off + 2, prog.instrs[i + 1]! & 0xff);
      rv.setUint8(off + 3, prog.instrs[i + 2]! & 0xff);
      rv.setUint32(off + 4, prog.instrs[i + 3]! >>> 0, true);
      off += 8;
    }
    const fprog = new ArrayBuffer(16);
    const fdv = new DataView(fprog);
    fdv.setUint16(0, prog.len, true); // struct sock_fprog { u16 len; pad; ptr }
    fdv.setBigUint64(8, BigInt(ptr(real)), true);
    seccompStatus = libc.symbols.prctl(22, 2, ptr(fprog), 0, 0) === 0 ? "installed" : "install_failed";
  } else seccompStatus = "nnp_failed";
} catch (e) {
  seccompStatus = "error";
}
layers.seccomp = seccompStatus;
layers.net = profile.net;
writeVerdict(seccompStatus);

// ── 6. EXEC ребёнка (stdio → родительские пайпы) ──────────────────────
if (!Array.isArray(profile.cmd) || !profile.cmd.length) {
  console.error("ME2_SANDBOX2 launcher: cmd required");
  process.exit(64);
}
const child = spawnSync(profile.cmd[0]!, profile.cmd.slice(1), {
  cwd: profile.cwd,
  env: profile.env,
  stdio: ["ignore", "inherit", "inherit"],
});
process.exit(child.status ?? (child.error ? 126 : 127));

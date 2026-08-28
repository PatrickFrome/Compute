#![cfg(target_os = "linux")]

use seccompiler::{BpfProgram, SeccompAction, SeccompFilter};
use std::collections::BTreeMap;
use std::convert::TryInto;
use std::fmt;

#[cfg(target_arch = "x86_64")]
const ALLOWED_SYSCALLS: [i64; 14] = [
    libc::SYS_brk,
    libc::SYS_close,
    libc::SYS_exit_group,
    libc::SYS_fcntl,
    libc::SYS_getdents64,
    libc::SYS_lseek,
    libc::SYS_mmap,
    libc::SYS_munmap,
    libc::SYS_openat,
    libc::SYS_openat2,
    libc::SYS_read,
    libc::SYS_sigaltstack,
    libc::SYS_statx,
    libc::SYS_write,
];

#[cfg(not(target_arch = "x86_64"))]
const ALLOWED_SYSCALLS: [i64; 0] = [];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyscallSandboxError {
    code: &'static str,
}

impl SyscallSandboxError {
    fn new(code: &'static str) -> Self {
        Self { code }
    }

    pub fn code(&self) -> &'static str {
        self.code
    }
}

impl fmt::Display for SyscallSandboxError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.code)
    }
}

impl std::error::Error for SyscallSandboxError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SyscallSandboxReport {
    pub allowed_syscall_count: usize,
    pub positive_allowlist: bool,
    pub default_deny: bool,
    pub default_errno: i32,
    pub tsync: bool,
    pub architecture_bound: bool,
    pub network_namespace_isolation: bool,
    pub kill_on_violation: bool,
}

pub fn restrict_to_steady_state_syscalls() -> Result<SyscallSandboxReport, SyscallSandboxError> {
    if std::env::consts::ARCH != "x86_64" {
        return Err(SyscallSandboxError::new(
            "skill_helper_seccomp_arch_unsupported",
        ));
    }

    let rules: BTreeMap<i64, Vec<_>> = ALLOWED_SYSCALLS
        .into_iter()
        .map(|syscall| (syscall, Vec::new()))
        .collect();
    let target_arch = std::env::consts::ARCH
        .try_into()
        .map_err(|_| SyscallSandboxError::new("skill_helper_seccomp_arch_unsupported"))?;
    let filter = SeccompFilter::new(
        rules,
        SeccompAction::Errno(libc::EPERM as u32),
        SeccompAction::Allow,
        target_arch,
    )
    .map_err(|_| SyscallSandboxError::new("skill_helper_seccomp_filter_invalid"))?;
    let bpf: BpfProgram = filter
        .try_into()
        .map_err(|_| SyscallSandboxError::new("skill_helper_seccomp_compile_failed"))?;
    seccompiler::apply_filter_all_threads(&bpf)
        .map_err(|_| SyscallSandboxError::new("skill_helper_seccomp_install_failed"))?;

    Ok(SyscallSandboxReport {
        allowed_syscall_count: ALLOWED_SYSCALLS.len(),
        positive_allowlist: true,
        default_deny: true,
        default_errno: libc::EPERM,
        tsync: true,
        architecture_bound: true,
        network_namespace_isolation: false,
        kill_on_violation: false,
    })
}

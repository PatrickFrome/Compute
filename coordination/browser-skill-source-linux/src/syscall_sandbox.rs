#![cfg(target_os = "linux")]

use seccompiler::{BpfProgram, SeccompAction, SeccompFilter};
use std::collections::BTreeMap;
use std::convert::TryInto;
use std::fmt;

const DENIED_SYSCALLS: [i64; 21] = [
    libc::SYS_socket,
    libc::SYS_socketpair,
    libc::SYS_connect,
    libc::SYS_bind,
    libc::SYS_listen,
    libc::SYS_accept,
    libc::SYS_accept4,
    libc::SYS_sendto,
    libc::SYS_sendmsg,
    libc::SYS_sendmmsg,
    libc::SYS_recvfrom,
    libc::SYS_recvmsg,
    libc::SYS_recvmmsg,
    libc::SYS_shutdown,
    libc::SYS_getsockname,
    libc::SYS_getpeername,
    libc::SYS_setsockopt,
    libc::SYS_getsockopt,
    libc::SYS_io_uring_setup,
    libc::SYS_io_uring_enter,
    libc::SYS_io_uring_register,
];

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
    pub denied_syscall_count: usize,
    pub all_socket_creation_denied: bool,
    pub io_uring_disabled: bool,
    pub tsync: bool,
    pub full_allowlist_claimed: bool,
    pub network_namespace_isolation: bool,
}

pub fn restrict_network_syscalls() -> Result<SyscallSandboxReport, SyscallSandboxError> {
    let rules: BTreeMap<i64, Vec<_>> = DENIED_SYSCALLS
        .into_iter()
        .map(|syscall| (syscall, Vec::new()))
        .collect();
    let target_arch = std::env::consts::ARCH
        .try_into()
        .map_err(|_| SyscallSandboxError::new("skill_helper_seccomp_arch_unsupported"))?;
    let filter = SeccompFilter::new(
        rules,
        SeccompAction::Allow,
        SeccompAction::Errno(libc::EPERM as u32),
        target_arch,
    )
    .map_err(|_| SyscallSandboxError::new("skill_helper_seccomp_filter_invalid"))?;
    let bpf: BpfProgram = filter
        .try_into()
        .map_err(|_| SyscallSandboxError::new("skill_helper_seccomp_compile_failed"))?;
    seccompiler::apply_filter_all_threads(&bpf)
        .map_err(|_| SyscallSandboxError::new("skill_helper_seccomp_install_failed"))?;

    Ok(SyscallSandboxReport {
        denied_syscall_count: DENIED_SYSCALLS.len(),
        all_socket_creation_denied: true,
        io_uring_disabled: true,
        tsync: true,
        full_allowlist_claimed: false,
        network_namespace_isolation: false,
    })
}

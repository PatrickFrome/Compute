#![cfg(target_os = "linux")]

use std::fmt;
use std::fs;
use std::io::ErrorKind;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaunchContractError {
    code: &'static str,
}

impl LaunchContractError {
    fn new(code: &'static str) -> Self {
        Self { code }
    }

    pub fn code(&self) -> &'static str {
        self.code
    }
}

impl fmt::Display for LaunchContractError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.code)
    }
}

impl std::error::Error for LaunchContractError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LaunchContractReport {
    pub close_range_unshare: bool,
    pub stdio_only_inherited_fds: bool,
    pub procfs_verified: bool,
    pub preserved_fd: Option<u32>,
}

fn close_range(first: u32, last: u32, flags: u32, code: &'static str) -> Result<(), LaunchContractError> {
    // SAFETY: close_range takes scalar values only. Callers validate first <= last, flags are
    // kernel-defined close_range flags, and no pointer, borrowed memory, aliasing, or Rust
    // lifetime crosses this syscall boundary. This remains the sole explicit unsafe seam in the
    // launch-contract module.
    let result = unsafe { libc::syscall(libc::SYS_close_range, first, last, flags) };
    if result != 0 {
        return Err(LaunchContractError::new(code));
    }
    Ok(())
}

pub fn sanitize_inherited_fds(preserve_fd: Option<u32>) -> Result<(), LaunchContractError> {
    match preserve_fd {
        None => close_range(
            3,
            u32::MAX,
            libc::CLOSE_RANGE_UNSHARE,
            "skill_helper_close_range_unshare_failed",
        ),
        Some(fd) if fd < 3 => Err(LaunchContractError::new(
            "skill_launcher_preserved_fd_invalid",
        )),
        Some(3) => close_range(
            4,
            u32::MAX,
            libc::CLOSE_RANGE_UNSHARE,
            "skill_launcher_close_range_unshare_failed",
        ),
        Some(fd) => {
            close_range(
                3,
                fd - 1,
                libc::CLOSE_RANGE_UNSHARE,
                "skill_launcher_close_range_unshare_failed",
            )?;
            if fd < u32::MAX {
                close_range(
                    fd + 1,
                    u32::MAX,
                    0,
                    "skill_launcher_close_range_upper_failed",
                )?;
            }
            Ok(())
        }
    }
}

pub fn verify_clean_inherited_fds(
    preserve_fd: Option<u32>,
) -> Result<LaunchContractReport, LaunchContractError> {
    let observed = {
        let entries = fs::read_dir("/proc/self/fd")
            .map_err(|_| LaunchContractError::new("skill_helper_procfs_fd_scan_failed"))?;
        let mut fds = Vec::new();
        for entry in entries {
            let entry = entry
                .map_err(|_| LaunchContractError::new("skill_helper_procfs_fd_scan_failed"))?;
            let name = entry.file_name();
            let name = name
                .to_str()
                .ok_or_else(|| LaunchContractError::new("skill_helper_procfs_fd_name_invalid"))?;
            let fd = name
                .parse::<u32>()
                .map_err(|_| LaunchContractError::new("skill_helper_procfs_fd_name_invalid"))?;
            fds.push(fd);
        }
        fds
    };

    let mut preserved_seen = preserve_fd.is_none();
    for fd in observed {
        if fd <= 2 {
            continue;
        }
        match fs::read_link(format!("/proc/self/fd/{fd}")) {
            Ok(_) if Some(fd) == preserve_fd => {
                preserved_seen = true;
            }
            Ok(_) => {
                return Err(LaunchContractError::new(
                    "skill_helper_inherited_fd_unexpected",
                ));
            }
            Err(error) if error.kind() == ErrorKind::NotFound && Some(fd) != preserve_fd => {
                // The descriptor was owned by the now-dropped read_dir iterator.
            }
            Err(_) if Some(fd) == preserve_fd => {
                return Err(LaunchContractError::new(
                    "skill_launcher_preserved_fd_missing",
                ));
            }
            Err(_) => {
                return Err(LaunchContractError::new(
                    "skill_helper_inherited_fd_probe_failed",
                ));
            }
        }
    }

    if !preserved_seen {
        return Err(LaunchContractError::new(
            "skill_launcher_preserved_fd_missing",
        ));
    }

    Ok(LaunchContractReport {
        close_range_unshare: true,
        stdio_only_inherited_fds: preserve_fd.is_none(),
        procfs_verified: true,
        preserved_fd: preserve_fd,
    })
}

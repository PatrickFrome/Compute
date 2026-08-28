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
    pub stdio_only_inherited_fds: bool,
    pub procfs_verified: bool,
}

pub fn verify_clean_inherited_fds() -> Result<LaunchContractReport, LaunchContractError> {
    // Snapshot /proc/self/fd in a lexical scope so the directory iterator's own descriptor is
    // closed before we probe any descriptor above stderr. In the single-threaded bootstrap phase,
    // a descriptor that still exists after this scope is ambient authority inherited at launch.
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

    for fd in observed {
        if fd <= 2 {
            continue;
        }
        match fs::read_link(format!("/proc/self/fd/{fd}")) {
            Err(error) if error.kind() == ErrorKind::NotFound => {
                // This is the descriptor owned by the now-dropped read_dir iterator.
            }
            Ok(_) => {
                return Err(LaunchContractError::new(
                    "skill_helper_inherited_fd_unexpected",
                ));
            }
            Err(_) => {
                return Err(LaunchContractError::new(
                    "skill_helper_inherited_fd_probe_failed",
                ));
            }
        }
    }

    Ok(LaunchContractReport {
        stdio_only_inherited_fds: true,
        procfs_verified: true,
    })
}

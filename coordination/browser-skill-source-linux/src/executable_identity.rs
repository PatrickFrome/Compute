#![cfg(target_os = "linux")]

use rustix::fd::OwnedFd;
use rustix::fs::{FileType, Mode, OFlags, ResolveFlags, fstat, open, openat2};
use rustix::io::Errno;
use std::ffi::{CString, OsStr};
use std::fmt;
use std::fs;
use std::io::ErrorKind;
use std::os::fd::{AsRawFd, RawFd};
use std::os::unix::ffi::OsStrExt;
use std::path::Path;
use std::ptr;

pub const HELPER_NAME: &str = "a2-skill-source-helper";

const RESOLVE_EXECUTABLE: ResolveFlags = ResolveFlags::BENEATH
    .union(ResolveFlags::NO_SYMLINKS)
    .union(ResolveFlags::NO_MAGICLINKS)
    .union(ResolveFlags::NO_XDEV);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecutableIdentityError {
    code: &'static str,
}

impl ExecutableIdentityError {
    fn new(code: &'static str) -> Self {
        Self { code }
    }

    pub fn code(&self) -> &'static str {
        self.code
    }
}

impl fmt::Display for ExecutableIdentityError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.code)
    }
}

impl std::error::Error for ExecutableIdentityError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ExecutableIdentity {
    dev: u64,
    ino: u64,
    nlink: u64,
    mode: u32,
    uid: u32,
    gid: u32,
    size: i64,
    mtime: i64,
    mtime_nsec: u64,
    ctime: i64,
    ctime_nsec: u64,
}

impl ExecutableIdentity {
    fn from_stat(stat: &rustix::fs::Stat) -> Self {
        Self {
            dev: stat.st_dev as u64,
            ino: stat.st_ino as u64,
            nlink: stat.st_nlink as u64,
            mode: stat.st_mode,
            uid: stat.st_uid,
            gid: stat.st_gid,
            size: stat.st_size,
            mtime: stat.st_mtime,
            mtime_nsec: stat.st_mtime_nsec as u64,
            ctime: stat.st_ctime,
            ctime_nsec: stat.st_ctime_nsec as u64,
        }
    }
}

#[derive(Debug)]
pub struct ExecutableCapability {
    fd: OwnedFd,
    identity: ExecutableIdentity,
}

fn map_helper_open_error(error: Errno) -> ExecutableIdentityError {
    if error == Errno::NOENT {
        ExecutableIdentityError::new("skill_launcher_helper_missing")
    } else if error == Errno::LOOP {
        ExecutableIdentityError::new("skill_launcher_helper_symlink_rejected")
    } else if error == Errno::NOSYS {
        ExecutableIdentityError::new("skill_launcher_openat2_unavailable")
    } else {
        ExecutableIdentityError::new("skill_launcher_helper_confined_open_failed")
    }
}

fn validate_executable(stat: &rustix::fs::Stat) -> Result<(), ExecutableIdentityError> {
    if !FileType::from_raw_mode(stat.st_mode).is_file() {
        return Err(ExecutableIdentityError::new(
            "skill_launcher_helper_not_regular",
        ));
    }
    if stat.st_mode & 0o111 == 0 {
        return Err(ExecutableIdentityError::new(
            "skill_launcher_helper_not_executable",
        ));
    }
    if stat.st_mode & ((libc::S_ISUID | libc::S_ISGID) as u32) != 0 {
        return Err(ExecutableIdentityError::new(
            "skill_launcher_helper_privileged_mode_rejected",
        ));
    }
    Ok(())
}

impl ExecutableCapability {
    pub fn open_fixed_helper(directory: &Path) -> Result<Self, ExecutableIdentityError> {
        let directory = open(
            directory,
            OFlags::PATH | OFlags::DIRECTORY | OFlags::CLOEXEC | OFlags::NOFOLLOW,
            Mode::empty(),
        )
        .map_err(|_| {
            ExecutableIdentityError::new("skill_launcher_install_directory_open_failed")
        })?;

        let helper = openat2(
            &directory,
            HELPER_NAME,
            OFlags::PATH | OFlags::CLOEXEC | OFlags::NOFOLLOW,
            Mode::empty(),
            RESOLVE_EXECUTABLE,
        )
        .map_err(map_helper_open_error)?;
        drop(directory);

        let stat = fstat(&helper)
            .map_err(|_| ExecutableIdentityError::new("skill_launcher_helper_fstat_failed"))?;
        validate_executable(&stat)?;
        let identity = ExecutableIdentity::from_stat(&stat);

        Ok(Self {
            fd: helper,
            identity,
        })
    }

    pub fn raw_fd(&self) -> RawFd {
        self.fd.as_raw_fd()
    }

    pub fn revalidate(&self) -> Result<(), ExecutableIdentityError> {
        let stat = fstat(&self.fd)
            .map_err(|_| ExecutableIdentityError::new("skill_launcher_helper_fstat_failed"))?;
        validate_executable(&stat)?;
        if ExecutableIdentity::from_stat(&stat) != self.identity {
            return Err(ExecutableIdentityError::new(
                "skill_launcher_helper_identity_changed",
            ));
        }
        Ok(())
    }

    pub fn verify_preexec_fd_contract(&self) -> Result<(), ExecutableIdentityError> {
        let expected = self.fd.as_raw_fd();
        let observed = {
            let entries = fs::read_dir("/proc/self/fd").map_err(|_| {
                ExecutableIdentityError::new("skill_launcher_preexec_fd_scan_failed")
            })?;
            let mut fds = Vec::new();
            for entry in entries {
                let entry = entry.map_err(|_| {
                    ExecutableIdentityError::new("skill_launcher_preexec_fd_scan_failed")
                })?;
                let name = entry.file_name();
                let name = name.to_str().ok_or_else(|| {
                    ExecutableIdentityError::new("skill_launcher_preexec_fd_name_invalid")
                })?;
                let fd = name.parse::<RawFd>().map_err(|_| {
                    ExecutableIdentityError::new("skill_launcher_preexec_fd_name_invalid")
                })?;
                fds.push(fd);
            }
            fds
        };

        let mut expected_seen = false;
        for fd in observed {
            if fd <= 2 {
                continue;
            }
            let path = format!("/proc/self/fd/{fd}");
            if fd == expected {
                fs::read_link(&path)
                    .map_err(|_| ExecutableIdentityError::new("skill_launcher_exec_fd_missing"))?;
                expected_seen = true;
                continue;
            }
            match fs::read_link(path) {
                Err(error) if error.kind() == ErrorKind::NotFound => {
                    // The read_dir iterator's own descriptor was closed when the snapshot ended.
                }
                Ok(_) => {
                    return Err(ExecutableIdentityError::new(
                        "skill_launcher_preexec_fd_unexpected",
                    ));
                }
                Err(_) => {
                    return Err(ExecutableIdentityError::new(
                        "skill_launcher_preexec_fd_probe_failed",
                    ));
                }
            }
        }

        if !expected_seen {
            return Err(ExecutableIdentityError::new(
                "skill_launcher_exec_fd_missing",
            ));
        }
        Ok(())
    }

    pub fn execute(self, root: &OsStr) -> Result<(), ExecutableIdentityError> {
        self.revalidate()?;

        let argv0 = CString::new(HELPER_NAME)
            .map_err(|_| ExecutableIdentityError::new("skill_launcher_argv_invalid"))?;
        let root = CString::new(root.as_bytes())
            .map_err(|_| ExecutableIdentityError::new("skill_launcher_root_argument_invalid"))?;
        let argv: [*const libc::c_char; 3] = [argv0.as_ptr(), root.as_ptr(), ptr::null()];
        let envp: [*const libc::c_char; 1] = [ptr::null()];

        // SAFETY: fd is an owned, validated executable capability; argv and envp are
        // NUL-terminated pointer arrays whose CStrings remain alive for the call. A successful
        // fexecve replaces the process image and never returns. The descriptor was opened with
        // O_CLOEXEC, so the executable capability does not survive into the native ELF helper.
        let result = unsafe { libc::fexecve(self.fd.as_raw_fd(), argv.as_ptr(), envp.as_ptr()) };
        debug_assert_eq!(result, -1);
        Err(ExecutableIdentityError::new(
            "skill_launcher_fexecve_failed",
        ))
    }
}

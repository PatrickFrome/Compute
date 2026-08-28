#![cfg(target_os = "linux")]

use rustix::fd::OwnedFd;
use rustix::fs::{Mode, OFlags, ResolveFlags, fstat, open, openat2};
use std::env;
use std::ffi::CString;
use std::fmt;
use std::os::fd::AsRawFd;
use std::os::unix::ffi::OsStrExt;
use std::ptr;

#[cfg(feature = "r7l-test-hooks")]
use std::path::Path;

const HELPER_NAME: &str = "a2-skill-source-helper";

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

pub struct OpenedExecutable {
    fd: OwnedFd,
}

impl OpenedExecutable {
    pub fn raw_fd(&self) -> u32 {
        u32::try_from(self.fd.as_raw_fd()).expect("owned fd is nonnegative")
    }
}

pub fn open_fixed_helper() -> Result<OpenedExecutable, ExecutableIdentityError> {
    let launcher = env::current_exe()
        .map_err(|_| ExecutableIdentityError::new("skill_launcher_current_exe_failed"))?;
    let directory = launcher
        .parent()
        .ok_or_else(|| ExecutableIdentityError::new("skill_launcher_executable_directory_missing"))?;

    let directory_fd = open(
        directory,
        OFlags::PATH | OFlags::DIRECTORY | OFlags::CLOEXEC | OFlags::NOFOLLOW,
        Mode::empty(),
    )
    .map_err(|_| ExecutableIdentityError::new("skill_launcher_directory_open_failed"))?;

    let helper_fd = openat2(
        &directory_fd,
        HELPER_NAME,
        OFlags::PATH | OFlags::CLOEXEC,
        Mode::empty(),
        ResolveFlags::BENEATH
            | ResolveFlags::NO_SYMLINKS
            | ResolveFlags::NO_MAGICLINKS
            | ResolveFlags::NO_XDEV,
    )
    .map_err(|error| {
        if error == rustix::io::Errno::NOENT {
            ExecutableIdentityError::new("skill_launcher_helper_missing")
        } else if error == rustix::io::Errno::LOOP {
            ExecutableIdentityError::new("skill_launcher_helper_symlink_rejected")
        } else if error == rustix::io::Errno::XDEV {
            ExecutableIdentityError::new("skill_launcher_helper_resolution_escape")
        } else {
            ExecutableIdentityError::new("skill_launcher_helper_open_failed")
        }
    })?;
    drop(directory_fd);

    let metadata = fstat(&helper_fd)
        .map_err(|_| ExecutableIdentityError::new("skill_launcher_helper_fstat_failed"))?;
    if metadata.st_mode & libc::S_IFMT != libc::S_IFREG {
        return Err(ExecutableIdentityError::new(
            "skill_launcher_helper_not_regular",
        ));
    }
    if metadata.st_mode & 0o111 == 0 {
        return Err(ExecutableIdentityError::new(
            "skill_launcher_helper_not_executable",
        ));
    }
    if metadata.st_mode & (libc::S_ISUID | libc::S_ISGID) != 0 {
        return Err(ExecutableIdentityError::new(
            "skill_launcher_helper_privileged_mode_rejected",
        ));
    }

    Ok(OpenedExecutable { fd: helper_fd })
}

#[cfg(feature = "r7l-test-hooks")]
pub fn test_pause_after_open() -> Result<(), ExecutableIdentityError> {
    use std::fs;
    use std::thread;
    use std::time::Duration;

    let ready = env::var_os("A2_R7L_TEST_READY");
    let proceed = env::var_os("A2_R7L_TEST_PROCEED");
    match (ready, proceed) {
        (None, None) => return Ok(()),
        (Some(_), None) | (None, Some(_)) => {
            return Err(ExecutableIdentityError::new(
                "skill_launcher_test_hook_contract_invalid",
            ));
        }
        (Some(ready), Some(proceed)) => {
            fs::write(&ready, b"opened")
                .map_err(|_| ExecutableIdentityError::new("skill_launcher_test_hook_ready_failed"))?;
            for _ in 0..500 {
                if Path::new(&proceed).exists() {
                    return Ok(());
                }
                thread::sleep(Duration::from_millis(10));
            }
        }
    }
    Err(ExecutableIdentityError::new(
        "skill_launcher_test_hook_timeout",
    ))
}

pub fn exec_opened_helper(
    executable: OpenedExecutable,
    root: &std::ffi::OsStr,
) -> Result<(), ExecutableIdentityError> {
    let argv0 = CString::new(HELPER_NAME)
        .map_err(|_| ExecutableIdentityError::new("skill_launcher_argv0_invalid"))?;
    let root = CString::new(root.as_bytes())
        .map_err(|_| ExecutableIdentityError::new("skill_launcher_root_nul_rejected"))?;
    let empty_path = c"";
    let argv = [argv0.as_ptr(), root.as_ptr(), ptr::null()];
    let envp: [*const libc::c_char; 1] = [ptr::null()];

    // SAFETY: executable owns a live O_PATH descriptor for the validated fixed helper. empty_path
    // is a valid NUL-terminated empty C string; argv/envp are NUL-terminated pointer arrays whose
    // pointed-to CStrings remain alive for the syscall. AT_EMPTY_PATH instructs the kernel to
    // execute the already-open descriptor, so no pathname is re-resolved at this boundary.
    unsafe {
        libc::syscall(
            libc::SYS_execveat,
            executable.fd.as_raw_fd(),
            empty_path.as_ptr(),
            argv.as_ptr(),
            envp.as_ptr(),
            libc::AT_EMPTY_PATH,
        );
    }
    Err(ExecutableIdentityError::new(
        "skill_launcher_execveat_failed",
    ))
}

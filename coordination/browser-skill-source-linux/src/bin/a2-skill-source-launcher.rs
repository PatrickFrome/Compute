#![cfg(target_os = "linux")]

#[path = "../executable_identity.rs"]
mod executable_identity;
#[path = "../launch_contract.rs"]
mod launch_contract;

use std::env;
use std::path::Path;
use std::process::ExitCode;

fn run() -> Result<(), &'static str> {
    let mut args = env::args_os();
    let _program = args.next();
    let Some(root) = args.next() else {
        return Err("skill_launcher_root_argument_missing");
    };
    if args.next().is_some() {
        return Err("skill_launcher_root_argument_count_invalid");
    }
    if !Path::new(&root).is_absolute() {
        return Err("skill_launcher_root_not_absolute");
    }

    let executable = executable_identity::open_fixed_helper().map_err(|error| error.code())?;
    let exec_fd = executable.raw_fd();

    #[cfg(feature = "r7l-test-hooks")]
    executable_identity::test_pause_after_open().map_err(|error| error.code())?;

    rustix::thread::set_no_new_privs(true).map_err(|_| "skill_launcher_no_new_privs_failed")?;
    launch_contract::sanitize_inherited_fds(Some(exec_fd)).map_err(|error| error.code())?;
    let report =
        launch_contract::verify_clean_inherited_fds(Some(exec_fd)).map_err(|error| error.code())?;
    if !report.close_range_unshare
        || report.stdio_only_inherited_fds
        || !report.procfs_verified
        || report.preserved_fd != Some(exec_fd)
    {
        return Err("skill_launcher_fd_contract_not_verified");
    }

    executable_identity::exec_opened_helper(executable, root.as_os_str())
        .map_err(|error| error.code())
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(code) => {
            eprintln!("{code}");
            ExitCode::from(70)
        }
    }
}

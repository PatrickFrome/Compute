#![cfg(target_os = "linux")]

#[path = "../executable_identity.rs"]
mod executable_identity;
#[path = "../launch_contract.rs"]
mod launch_contract;

use executable_identity::ExecutableCapability;
use std::env;
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

    let launcher = env::current_exe().map_err(|_| "skill_launcher_current_exe_failed")?;
    let directory = launcher
        .parent()
        .ok_or("skill_launcher_executable_directory_missing")?
        .to_path_buf();

    launch_contract::sanitize_inherited_fds().map_err(|error| error.code())?;
    let report = launch_contract::verify_clean_inherited_fds().map_err(|error| error.code())?;
    if !report.close_range_unshare || !report.stdio_only_inherited_fds || !report.procfs_verified {
        return Err("skill_launcher_fd_contract_not_verified");
    }

    rustix::thread::set_no_new_privs(true)
        .map_err(|_| "skill_launcher_no_new_privs_failed")?;

    let helper =
        ExecutableCapability::open_fixed_helper(&directory).map_err(|error| error.code())?;
    helper
        .verify_preexec_fd_contract()
        .map_err(|error| error.code())?;
    helper.execute(&root).map_err(|error| error.code())?;
    Err("skill_launcher_exec_returned")
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

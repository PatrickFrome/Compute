#![cfg(target_os = "linux")]

#[path = "../launch_contract.rs"]
mod launch_contract;

use std::env;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::os::unix::process::CommandExt;
use std::path::PathBuf;
use std::process::{Command, ExitCode};

const HELPER_NAME: &str = "a2-skill-source-helper";

fn resolve_fixed_helper() -> Result<PathBuf, &'static str> {
    let launcher = env::current_exe().map_err(|_| "skill_launcher_current_exe_failed")?;
    let directory = launcher
        .parent()
        .ok_or("skill_launcher_executable_directory_missing")?;
    let helper = directory.join(HELPER_NAME);
    let metadata = fs::symlink_metadata(&helper).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            "skill_launcher_helper_missing"
        } else {
            "skill_launcher_helper_metadata_failed"
        }
    })?;
    let file_type = metadata.file_type();
    if file_type.is_symlink() {
        return Err("skill_launcher_helper_symlink_rejected");
    }
    if !file_type.is_file() {
        return Err("skill_launcher_helper_not_regular");
    }
    if metadata.permissions().mode() & 0o111 == 0 {
        return Err("skill_launcher_helper_not_executable");
    }
    Ok(helper)
}

fn run() -> Result<(), &'static str> {
    let mut args = env::args_os();
    let _program = args.next();
    let Some(root) = args.next() else {
        return Err("skill_launcher_root_argument_missing");
    };
    if args.next().is_some() {
        return Err("skill_launcher_root_argument_count_invalid");
    }

    let helper = resolve_fixed_helper()?;
    let mut command = Command::new(helper);
    command.arg(root);
    command.env_clear();

    launch_contract::sanitize_inherited_fds().map_err(|error| error.code())?;
    let report = launch_contract::verify_clean_inherited_fds().map_err(|error| error.code())?;
    if !report.close_range_unshare || !report.stdio_only_inherited_fds || !report.procfs_verified {
        return Err("skill_launcher_fd_contract_not_verified");
    }

    let _exec_error = command.exec();
    Err("skill_launcher_exec_failed")
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

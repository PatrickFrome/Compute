#![cfg(target_os = "linux")]

use std::fs;
use std::io::ErrorKind;
use std::process::ExitCode;

fn fail(code: &'static str) -> ExitCode {
    eprintln!("{code}");
    ExitCode::from(101)
}

fn main() -> ExitCode {
    let mut args = std::env::args_os();
    let _program = args.next();
    let Some(root) = args.next() else {
        return fail("r7l_probe_root_missing");
    };
    if args.next().is_some() || !std::path::Path::new(&root).is_absolute() {
        return fail("r7l_probe_root_invalid");
    }

    if std::env::vars_os().next().is_some() {
        return fail("r7l_probe_environment_not_empty");
    }

    match fs::read_link("/proc/self/fd/9") {
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Ok(_) => return fail("r7l_probe_fd9_survived"),
        Err(_) => return fail("r7l_probe_fd9_check_failed"),
    }

    let status = match fs::read_to_string("/proc/self/status") {
        Ok(status) => status,
        Err(_) => return fail("r7l_probe_proc_status_failed"),
    };
    if !status.lines().any(|line| {
        line.strip_prefix("NoNewPrivs:")
            .is_some_and(|value| value.trim() == "1")
    }) {
        return fail("r7l_probe_no_new_privs_missing");
    }

    println!("r7l_probe_ok");
    ExitCode::SUCCESS
}

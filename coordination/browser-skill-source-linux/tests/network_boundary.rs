#![cfg(target_os = "linux")]

#[path = "../src/syscall_sandbox.rs"]
mod syscall_sandbox;

use a2_skill_source_linux::LinuxSkillSource;
use std::env;
use std::fs;
use std::net::{TcpListener, UdpSocket};
use std::os::unix::net::UnixDatagram;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

const CHILD_ENV: &str = "A2_R7J_ALLOWLIST_CHILD";
const ROOT_ENV: &str = "A2_R7J_ALLOWLIST_ROOT";
const CHILD_TEST: &str = "positive_allowlist_child_probe";

struct TempTree {
    path: PathBuf,
}

impl TempTree {
    fn new(label: &str) -> Self {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let path = env::temp_dir().join(format!("a2-r7j-{label}-{}-{nonce}", std::process::id()));
        fs::create_dir_all(&path).expect("create temp tree");
        Self { path }
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempTree {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn write_skill(root: &Path, name: &str) {
    let dir = root.join(name);
    fs::create_dir_all(dir.join("references")).unwrap();
    fs::write(
        dir.join("SKILL.md"),
        format!("---\nname: {name}\ndescription: R7J positive allowlist test\n---\nRead only.\n"),
    )
    .unwrap();
    fs::write(dir.join("references/REFERENCE.md"), b"reference-v1").unwrap();
}

fn child_fail(code: &str) -> ! {
    eprintln!("{code}");
    std::process::exit(101)
}

fn permission_denied<T>(result: std::io::Result<T>) -> bool {
    result
        .err()
        .is_some_and(|error| error.kind() == std::io::ErrorKind::PermissionDenied)
}

#[test]
fn controlled_launch_sanitizes_inherited_authority_before_positive_allowlist() {
    let tree = TempTree::new("launch-boundary");
    write_skill(tree.path(), "inspect");

    let helper = env!("CARGO_BIN_EXE_a2-skill-source-helper");
    let output = Command::new("bash")
        .arg("-c")
        .arg("exec 9</dev/null; exec \"$1\" \"$2\"")
        .arg("r7j-inherited-fd")
        .arg(helper)
        .arg(tree.path())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .expect("launch helper with inherited fd");
    assert!(output.status.success());
    assert!(output.stdout.is_empty());
    assert!(output.stderr.is_empty());
}

#[test]
fn positive_allowlist_parent_runs_restricted_child() {
    let tree = TempTree::new("positive-allowlist");
    write_skill(tree.path(), "inspect");

    let output = Command::new(env::current_exe().expect("current test executable"))
        .arg("--exact")
        .arg(CHILD_TEST)
        .arg("--nocapture")
        .env(CHILD_ENV, "1")
        .env(ROOT_ENV, tree.path())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .expect("spawn restricted child test");

    assert!(
        output.status.success(),
        "restricted child failed: stdout={} stderr={}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn positive_allowlist_child_probe() {
    if env::var_os(CHILD_ENV).as_deref() != Some(std::ffi::OsStr::new("1")) {
        return;
    }

    let Some(root) = env::var_os(ROOT_ENV) else {
        child_fail("r7j_child_root_missing");
    };
    let source = match LinuxSkillSource::open(Path::new(&root)) {
        Ok(source) => source,
        Err(_) => child_fail("r7j_child_source_open_failed"),
    };
    let landlock = match source.restrict_helper_process() {
        Ok(report) => report,
        Err(_) => child_fail("r7j_child_landlock_failed"),
    };
    if !landlock.fully_enforced {
        child_fail("r7j_child_landlock_not_enforced");
    }

    let report = match syscall_sandbox::restrict_to_steady_state_syscalls() {
        Ok(report) => report,
        Err(error) => child_fail(error.code()),
    };
    if report.allowed_syscall_count != 14
        || !report.positive_allowlist
        || !report.default_deny
        || report.default_errno != libc::EPERM
        || !report.tsync
        || !report.architecture_bound
        || report.network_namespace_isolation
        || report.kill_on_violation
    {
        child_fail("r7j_child_seccomp_report_invalid");
    }

    if !permission_denied(UdpSocket::bind("127.0.0.1:0"))
        || !permission_denied(TcpListener::bind("127.0.0.1:0"))
        || !permission_denied(UnixDatagram::unbound())
    {
        child_fail("r7j_child_network_syscall_allowed");
    }

    // getpid is intentionally absent from the allowlist and is harmless to probe.
    // Using the raw syscall avoids libc/vDSO caching and proves the default action is active.
    let getpid_result = unsafe { libc::syscall(libc::SYS_getpid) };
    if getpid_result != -1 || std::io::Error::last_os_error().raw_os_error() != Some(libc::EPERM) {
        child_fail("r7j_child_default_deny_not_active");
    }

    if Command::new("/bin/true").status().is_ok() {
        child_fail("r7j_child_process_creation_allowed");
    }

    match source.list_skill_names() {
        Ok(names) if names == vec!["inspect"] => {}
        _ => child_fail("r7j_child_skill_list_failed"),
    }
    match source.read_skill_package("inspect") {
        Ok(package)
            if package.len() == 2
                && package[0].path == "SKILL.md"
                && package[1].path == "references/REFERENCE.md" => {}
        _ => child_fail("r7j_child_package_read_failed"),
    }

    std::process::exit(0)
}

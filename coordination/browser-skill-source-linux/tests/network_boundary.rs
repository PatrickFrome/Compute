#![cfg(target_os = "linux")]

#[path = "../src/syscall_sandbox.rs"]
mod syscall_sandbox;

use a2_skill_source_linux::LinuxSkillSource;
use std::fs;
use std::net::{TcpListener, UdpSocket};
use std::os::unix::net::UnixDatagram;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

struct TempTree {
    path: PathBuf,
}

impl TempTree {
    fn new(label: &str) -> Self {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let path =
            std::env::temp_dir().join(format!("a2-r7i-{label}-{}-{nonce}", std::process::id()));
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
        format!("---\nname: {name}\ndescription: R7I network boundary test\n---\nRead only.\n"),
    )
    .unwrap();
    fs::write(dir.join("references/REFERENCE.md"), b"reference-v1").unwrap();
}

fn assert_permission_denied<T>(result: std::io::Result<T>) {
    let error = result.err().expect("operation unexpectedly succeeded");
    assert_eq!(error.kind(), std::io::ErrorKind::PermissionDenied);
}

#[test]
fn controlled_launch_sanitizes_inherited_authority_and_seccomp_closes_new_network_surface() {
    let tree = TempTree::new("network-boundary");
    write_skill(tree.path(), "inspect");

    // Deliberately leak non-CLOEXEC fd 9 across exec. A successful EOF-only helper run proves
    // close_range removed the descriptor and the post-sanitize verifier accepted the process.
    let helper = env!("CARGO_BIN_EXE_a2-skill-source-helper");
    let output = Command::new("bash")
        .arg("-c")
        .arg("exec 9</dev/null; exec \"$1\" \"$2\"")
        .arg("r7i-inherited-fd")
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

    // Prepare the only intended filesystem capability before irreversible restrictions.
    let source = LinuxSkillSource::open(tree.path()).expect("open skill source");
    let landlock = source
        .restrict_helper_process()
        .expect("install Landlock sandbox");
    assert!(landlock.fully_enforced);

    let seccomp = syscall_sandbox::restrict_network_syscalls()
        .unwrap_or_else(|error| panic!("install seccomp filter: {}", error.code()));
    assert_eq!(seccomp.denied_syscall_count, 21);
    assert!(seccomp.all_socket_creation_denied);
    assert!(seccomp.io_uring_disabled);
    assert!(seccomp.tsync);
    assert!(!seccomp.full_allowlist_claimed);
    assert!(!seccomp.network_namespace_isolation);

    // UDP was the explicit residual R7H gap. Blocking socket(2) also prevents fresh TCP and Unix
    // sockets, while the helper's pre-opened read-only filesystem capability remains usable.
    assert_permission_denied(UdpSocket::bind("127.0.0.1:0"));
    assert_permission_denied(TcpListener::bind("127.0.0.1:0"));
    assert_permission_denied(UnixDatagram::unbound());

    assert_eq!(source.list_skill_names().unwrap(), vec!["inspect"]);
    let package = source.read_skill_package("inspect").unwrap();
    assert_eq!(package.len(), 2);
    assert_eq!(package[0].path, "SKILL.md");
    assert_eq!(package[1].path, "references/REFERENCE.md");
}

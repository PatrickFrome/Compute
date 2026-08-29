#![cfg(target_os = "linux")]

use a2_skill_source_linux::LinuxSkillSource;
use std::fs;
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

fn fixture_root() -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("a2-r7h-landlock-{}-{nonce}", std::process::id()));
    let skill = root.join("inspect");
    fs::create_dir_all(skill.join("references")).unwrap();
    fs::write(
        skill.join("SKILL.md"),
        b"---\nname: inspect\ndescription: landlock probe\n---\nRead only.\n",
    )
    .unwrap();
    fs::write(skill.join("references/REFERENCE.md"), b"reference-v1").unwrap();
    root
}

#[test]
fn helper_landlock_preserves_skill_reads_and_denies_ambient_fs_writes_and_tcp() {
    let root = fixture_root();
    let listener = TcpListener::bind("127.0.0.1:0").expect("pre-sandbox TCP listener");
    let listener_addr = listener.local_addr().unwrap();
    let source = LinuxSkillSource::open(&root).unwrap();

    let report = source.restrict_helper_process().unwrap();
    assert!(report.fully_enforced);
    assert!(report.no_new_privs);
    assert!(report.filesystem_read_only);
    assert!(report.tcp_bind_connect_denied);
    assert!(!report.udp_isolation_claimed);

    assert_eq!(source.list_skill_names().unwrap(), vec!["inspect"]);
    let package = source.read_skill_package("inspect").unwrap();
    assert_eq!(package.len(), 2);
    assert_eq!(package[0].path, "SKILL.md");
    assert_eq!(package[1].path, "references/REFERENCE.md");

    let outside_read = fs::read("/etc/passwd").unwrap_err();
    assert_eq!(outside_read.kind(), std::io::ErrorKind::PermissionDenied);

    let root_write = fs::write(root.join("new.txt"), b"blocked").unwrap_err();
    assert_eq!(root_write.kind(), std::io::ErrorKind::PermissionDenied);

    let connect = TcpStream::connect(listener_addr).unwrap_err();
    assert_eq!(connect.kind(), std::io::ErrorKind::PermissionDenied);

    let bind = TcpListener::bind("127.0.0.1:0").unwrap_err();
    assert_eq!(bind.kind(), std::io::ErrorKind::PermissionDenied);
}

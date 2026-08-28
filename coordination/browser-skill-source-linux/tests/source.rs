#![cfg(target_os = "linux")]

use a2_skill_source_linux::{LinuxSkillSource, SKILL_SOURCE_LIMITS};
use std::fs;
use std::os::unix::fs::{symlink, PermissionsExt};
use std::path::{Path, PathBuf};
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
        let path = std::env::temp_dir().join(format!(
            "a2-r7f-{label}-{}-{nonce}",
            std::process::id()
        ));
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

fn write_skill(root: &Path, name: &str) -> PathBuf {
    let dir = root.join(name);
    fs::create_dir_all(dir.join("references")).unwrap();
    fs::create_dir_all(dir.join("assets")).unwrap();
    fs::create_dir_all(dir.join("scripts")).unwrap();
    fs::write(
        dir.join("SKILL.md"),
        format!(
            "---\nname: {name}\ndescription: deterministic skill {name}\n---\n## Workflow\n\nRead only.\n"
        ),
    )
    .unwrap();
    fs::write(dir.join("references/REFERENCE.md"), b"reference-v1").unwrap();
    fs::write(dir.join("assets/template.txt"), b"template-v1").unwrap();
    fs::write(
        dir.join("scripts/check.sh"),
        b"#!/bin/sh\necho inert\n",
    )
    .unwrap();
    let mut permissions = fs::metadata(dir.join("scripts/check.sh"))
        .unwrap()
        .permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(dir.join("scripts/check.sh"), permissions).unwrap();
    dir
}

#[test]
fn valid_package_is_confined_sorted_and_preserves_executable_metadata_only() {
    let tree = TempTree::new("valid");
    write_skill(tree.path(), "zeta");
    write_skill(tree.path(), "alpha");
    fs::write(tree.path().join(".ignored"), b"not a skill").unwrap();

    let source = LinuxSkillSource::open(tree.path()).unwrap();
    assert_eq!(
        source.list_skill_names().unwrap(),
        vec!["alpha", "zeta"]
    );
    let package = source.read_skill_package("alpha").unwrap();
    assert_eq!(
        package
            .iter()
            .map(|entry| entry.path.as_str())
            .collect::<Vec<_>>(),
        vec![
            "SKILL.md",
            "assets/template.txt",
            "references/REFERENCE.md",
            "scripts/check.sh"
        ]
    );
    assert!(!package[0].executable);
    assert!(
        package
            .iter()
            .find(|entry| entry.path == "scripts/check.sh")
            .unwrap()
            .executable
    );
    assert!(String::from_utf8(package[0].bytes.clone())
        .unwrap()
        .contains("name: alpha"));
}

#[test]
fn configured_root_itself_must_not_be_a_symlink() {
    let tree = TempTree::new("root-symlink");
    let real = tree.path().join("real");
    fs::create_dir_all(&real).unwrap();
    let link = tree.path().join("link");
    symlink(&real, &link).unwrap();
    let error = LinuxSkillSource::open(&link).unwrap_err();
    assert_eq!(error.code(), "skill_loader_root_open_failed");
}

#[test]
fn lexically_valid_skill_symlink_is_a_poisoned_install_and_fails_closed() {
    let tree = TempTree::new("skill-symlink");
    let outside = TempTree::new("outside-skill");
    write_skill(outside.path(), "evil-skill");
    symlink(
        outside.path().join("evil-skill"),
        tree.path().join("evil-skill"),
    )
    .unwrap();

    let source = LinuxSkillSource::open(tree.path()).unwrap();
    let error = source.list_skill_names().unwrap_err();
    assert_eq!(error.code(), "skill_loader_confined_open_failed");
}

#[test]
fn resource_directory_symlink_cannot_escape_root() {
    let tree = TempTree::new("resource-dir-symlink");
    let outside = TempTree::new("outside-refdir");
    let skill = write_skill(tree.path(), "inspect");
    fs::remove_dir_all(skill.join("references")).unwrap();
    fs::write(outside.path().join("secret.txt"), b"outside").unwrap();
    symlink(outside.path(), skill.join("references")).unwrap();

    let source = LinuxSkillSource::open(tree.path()).unwrap();
    let error = source.read_skill_package("inspect").unwrap_err();
    assert_eq!(error.code(), "skill_loader_confined_open_failed");
}

#[test]
fn resource_file_symlink_cannot_escape_root() {
    let tree = TempTree::new("resource-file-symlink");
    let outside = TempTree::new("outside-file");
    let skill = write_skill(tree.path(), "inspect");
    fs::remove_file(skill.join("references/REFERENCE.md")).unwrap();
    let outside_file = outside.path().join("secret.txt");
    fs::write(&outside_file, b"outside").unwrap();
    symlink(&outside_file, skill.join("references/REFERENCE.md")).unwrap();

    let source = LinuxSkillSource::open(tree.path()).unwrap();
    let error = source.read_skill_package("inspect").unwrap_err();
    assert_eq!(error.code(), "skill_loader_confined_open_failed");
}

#[test]
fn hardlinked_regular_file_is_rejected_even_without_a_symlink() {
    let tree = TempTree::new("hardlink");
    let outside = TempTree::new("outside-hardlink");
    let skill = write_skill(tree.path(), "inspect");
    fs::remove_file(skill.join("references/REFERENCE.md")).unwrap();
    let outside_file = outside.path().join("shared.txt");
    fs::write(&outside_file, b"shared-sensitive-content").unwrap();
    fs::hard_link(
        &outside_file,
        skill.join("references/REFERENCE.md"),
    )
    .unwrap();

    let source = LinuxSkillSource::open(tree.path()).unwrap();
    let error = source.read_skill_package("inspect").unwrap_err();
    assert_eq!(error.code(), "skill_loader_file_hardlink_rejected");
}

#[test]
fn unsupported_package_entries_fail_closed() {
    let tree = TempTree::new("unsupported-entry");
    let skill = write_skill(tree.path(), "inspect");
    fs::write(skill.join("README.md"), b"unexpected").unwrap();
    let source = LinuxSkillSource::open(tree.path()).unwrap();
    let error = source.read_skill_package("inspect").unwrap_err();
    assert_eq!(error.code(), "skill_loader_package_entry_unsupported");
}

#[test]
fn nested_resource_directories_never_enter_the_package() {
    let tree = TempTree::new("nested");
    let skill = write_skill(tree.path(), "inspect");
    fs::create_dir_all(skill.join("references/nested")).unwrap();
    fs::write(skill.join("references/nested/file.md"), b"nested").unwrap();
    let source = LinuxSkillSource::open(tree.path()).unwrap();
    let error = source.read_skill_package("inspect").unwrap_err();
    assert_eq!(error.code(), "skill_loader_file_not_regular");
}

#[test]
fn skill_and_resource_byte_limits_are_enforced_before_unbounded_reads() {
    let tree = TempTree::new("limits");
    let skill = write_skill(tree.path(), "inspect");
    fs::write(
        skill.join("SKILL.md"),
        vec![b'x'; SKILL_SOURCE_LIMITS.max_skill_bytes + 1],
    )
    .unwrap();
    let source = LinuxSkillSource::open(tree.path()).unwrap();
    let error = source.read_skill_package("inspect").unwrap_err();
    assert_eq!(error.code(), "skill_loader_file_too_large");

    fs::write(
        skill.join("SKILL.md"),
        b"---\nname: inspect\ndescription: restored\n---\nbody\n",
    )
    .unwrap();
    fs::write(
        skill.join("assets/template.txt"),
        vec![b'y'; SKILL_SOURCE_LIMITS.max_resource_bytes + 1],
    )
    .unwrap();
    let error = source.read_skill_package("inspect").unwrap_err();
    assert_eq!(error.code(), "skill_loader_file_too_large");
}

#[test]
fn package_file_count_is_bounded() {
    let tree = TempTree::new("count");
    let skill = write_skill(tree.path(), "inspect");
    fs::remove_file(skill.join("references/REFERENCE.md")).unwrap();
    for index in 0..=SKILL_SOURCE_LIMITS.max_resource_files {
        fs::write(skill.join(format!("references/R{index}.txt")), b"x").unwrap();
    }
    let source = LinuxSkillSource::open(tree.path()).unwrap();
    let error = source.read_skill_package("inspect").unwrap_err();
    assert_eq!(error.code(), "skill_loader_package_file_count_exceeded");
}

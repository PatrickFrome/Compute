#![cfg(target_os = "linux")]

use a2_skill_source_linux::{LinuxSkillSource, SKILL_SOURCE_LIMITS};
use std::fs;
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
        let path =
            std::env::temp_dir().join(format!("a2-r7f1-{label}-{}-{nonce}", std::process::id()));
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

fn write_minimal_skill(root: &Path, name: &str) -> PathBuf {
    let dir = root.join(name);
    fs::create_dir_all(dir.join("references")).unwrap();
    fs::write(
        dir.join("SKILL.md"),
        format!("---\nname: {name}\ndescription: bounded scan\n---\nRead only.\n"),
    )
    .unwrap();
    dir
}

#[test]
fn root_enumeration_is_bounded_even_when_every_entry_is_lexically_ignored() {
    let tree = TempTree::new("root-cardinality");
    for index in 0..=SKILL_SOURCE_LIMITS.max_root_entries {
        fs::write(tree.path().join(format!(".ignored-{index}")), b"x").unwrap();
    }

    let source = LinuxSkillSource::open(tree.path()).unwrap();
    let error = source.list_skill_names().unwrap_err();
    assert_eq!(
        error.code(),
        "skill_loader_directory_entry_count_exceeded"
    );
}

#[test]
fn resource_enumeration_is_bounded_before_package_file_processing() {
    let tree = TempTree::new("resource-cardinality");
    let skill = write_minimal_skill(tree.path(), "inspect");
    for index in 0..=SKILL_SOURCE_LIMITS.max_resource_directory_entries {
        fs::write(skill.join(format!("references/R{index}.txt")), b"x").unwrap();
    }

    let source = LinuxSkillSource::open(tree.path()).unwrap();
    let error = source.read_skill_package("inspect").unwrap_err();
    assert_eq!(
        error.code(),
        "skill_loader_directory_entry_count_exceeded"
    );
}

#[test]
fn skill_top_level_enumeration_is_bounded_before_unsupported_entry_dispatch() {
    let tree = TempTree::new("skill-cardinality");
    let skill = write_minimal_skill(tree.path(), "inspect");
    for index in 0..SKILL_SOURCE_LIMITS.max_skill_directory_entries {
        fs::write(skill.join(format!("unexpected-{index}.txt")), b"x").unwrap();
    }

    let source = LinuxSkillSource::open(tree.path()).unwrap();
    let error = source.read_skill_package("inspect").unwrap_err();
    assert_eq!(
        error.code(),
        "skill_loader_directory_entry_count_exceeded"
    );
}

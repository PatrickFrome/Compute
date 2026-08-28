#![cfg(target_os = "linux")]

#[path = "../src/executable_identity.rs"]
mod executable_identity;

use executable_identity::{ExecutableCapability, ExecutableIdentityError, HELPER_NAME};
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

const SWAP_CHILD_FILTER: &str = "fd_bound_exec_swap_child";

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
            std::env::temp_dir().join(format!("a2-r7l-{label}-{}-{nonce}", std::process::id()));
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

fn copy_executable(source: &Path, destination: &Path, mode: u32) {
    fs::copy(source, destination).expect("copy executable");
    let mut permissions = fs::metadata(destination).unwrap().permissions();
    permissions.set_mode(mode);
    fs::set_permissions(destination, permissions).unwrap();
}

fn assert_code(error: ExecutableIdentityError, expected: &str) {
    assert_eq!(error.code(), expected);
}

#[test]
fn fixed_helper_rejects_missing_symlink_nonregular_nonexec_and_privileged_modes() {
    let tree = TempTree::new("validation");
    let helper = tree.path().join(HELPER_NAME);

    assert_code(
        ExecutableCapability::open_fixed_helper(tree.path()).unwrap_err(),
        "skill_launcher_helper_missing",
    );

    std::os::unix::fs::symlink("/bin/true", &helper).unwrap();
    assert_code(
        ExecutableCapability::open_fixed_helper(tree.path()).unwrap_err(),
        "skill_launcher_helper_symlink_rejected",
    );
    fs::remove_file(&helper).unwrap();

    fs::create_dir(&helper).unwrap();
    assert_code(
        ExecutableCapability::open_fixed_helper(tree.path()).unwrap_err(),
        "skill_launcher_helper_not_regular",
    );
    fs::remove_dir(&helper).unwrap();

    copy_executable(Path::new("/bin/true"), &helper, 0o644);
    assert_code(
        ExecutableCapability::open_fixed_helper(tree.path()).unwrap_err(),
        "skill_launcher_helper_not_executable",
    );
    fs::remove_file(&helper).unwrap();

    copy_executable(Path::new("/bin/true"), &helper, 0o4755);
    assert_code(
        ExecutableCapability::open_fixed_helper(tree.path()).unwrap_err(),
        "skill_launcher_helper_privileged_mode_rejected",
    );
}

#[test]
fn metadata_change_after_open_fails_revalidation() {
    let tree = TempTree::new("revalidate");
    let helper = tree.path().join(HELPER_NAME);
    copy_executable(Path::new("/bin/true"), &helper, 0o755);

    let capability = ExecutableCapability::open_fixed_helper(tree.path()).unwrap();
    let mut permissions = fs::metadata(&helper).unwrap().permissions();
    permissions.set_mode(0o744);
    fs::set_permissions(&helper, permissions).unwrap();

    assert_code(
        capability.revalidate().unwrap_err(),
        "skill_launcher_helper_identity_changed",
    );
}

#[test]
fn fd_bound_exec_swap_child() {
    let Some(directory) = std::env::var_os("A2_R7L_SWAP_DIRECTORY") else {
        return;
    };
    if !std::env::args().any(|arg| arg == SWAP_CHILD_FILTER) {
        return;
    }

    let directory = PathBuf::from(directory);
    let helper = directory.join(HELPER_NAME);
    let original = directory.join("opened-original");
    let capability = ExecutableCapability::open_fixed_helper(&directory).unwrap();
    fs::rename(&helper, &original).unwrap();
    copy_executable(Path::new("/bin/false"), &helper, 0o755);

    capability
        .execute(Path::new("/tmp").as_os_str())
        .expect("fd-bound exec should replace this process");
}

#[test]
fn pathname_swap_after_open_cannot_redirect_execution() {
    let tree = TempTree::new("swap");
    let helper = tree.path().join(HELPER_NAME);
    copy_executable(Path::new("/bin/true"), &helper, 0o755);

    let status = Command::new(std::env::current_exe().unwrap())
        .arg(SWAP_CHILD_FILTER)
        .env("A2_R7L_SWAP_DIRECTORY", tree.path())
        .status()
        .expect("spawn swap child");

    assert!(status.success(), "opened /bin/true was redirected by pathname swap");
}

#[test]
fn opened_helper_fd_is_cloexec_and_is_the_only_allowed_nonstdio_fd() {
    let tree = TempTree::new("fd-contract");
    let helper = tree.path().join(HELPER_NAME);
    copy_executable(Path::new("/bin/true"), &helper, 0o755);

    let capability = ExecutableCapability::open_fixed_helper(tree.path()).unwrap();
    assert!(capability.raw_fd() > 2);
    capability.verify_preexec_fd_contract().unwrap();
}

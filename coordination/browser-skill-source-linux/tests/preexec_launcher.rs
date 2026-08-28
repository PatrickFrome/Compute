#![cfg(target_os = "linux")]

use std::fs;
use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const PROTOCOL_VERSION: u8 = 1;
const OPCODE_LIST_SKILLS: u8 = 1;
const OPCODE_READ_PACKAGE: u8 = 2;
const STATUS_OK: u8 = 0;
const REQUEST_HEADER_BYTES: usize = 12;

#[cfg(feature = "r7l-test-hooks")]
const PROBE: &str = env!("CARGO_BIN_EXE_a2-r7l-preexec-probe");

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

fn copy_executable(source: &Path, destination: &Path) {
    fs::copy(source, destination).expect("copy executable");
    let mut permissions = fs::metadata(destination).unwrap().permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(destination, permissions).unwrap();
}

fn copy_launcher(directory: &Path) -> PathBuf {
    let destination = directory.join("a2-skill-source-launcher");
    copy_executable(
        Path::new(env!("CARGO_BIN_EXE_a2-skill-source-launcher")),
        &destination,
    );
    destination
}

fn write_skill(root: &Path, name: &str) {
    let dir = root.join(name);
    fs::create_dir_all(dir.join("references")).unwrap();
    fs::write(
        dir.join("SKILL.md"),
        format!("---\nname: {name}\ndescription: R7L launcher test\n---\nRead only.\n"),
    )
    .unwrap();
    fs::write(dir.join("references/REFERENCE.md"), b"reference-v1").unwrap();
}

fn frame(opcode: u8, request_id: u64, body: &[u8]) -> Vec<u8> {
    let mut payload = Vec::with_capacity(REQUEST_HEADER_BYTES + body.len());
    payload.push(PROTOCOL_VERSION);
    payload.push(opcode);
    payload.extend_from_slice(&0_u16.to_be_bytes());
    payload.extend_from_slice(&request_id.to_be_bytes());
    payload.extend_from_slice(body);
    let mut result = Vec::with_capacity(4 + payload.len());
    result.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    result.extend_from_slice(&payload);
    result
}

fn read_body(name: &str) -> Vec<u8> {
    let mut body = Vec::with_capacity(1 + name.len());
    body.push(name.len() as u8);
    body.extend_from_slice(name.as_bytes());
    body
}

fn launch(root: &Path, input: &[u8]) -> std::process::Output {
    let mut child = Command::new(env!("CARGO_BIN_EXE_a2-skill-source-launcher"))
        .arg(root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn launcher");
    child
        .stdin
        .as_mut()
        .expect("launcher stdin")
        .write_all(input)
        .expect("write launcher input");
    drop(child.stdin.take());
    child.wait_with_output().expect("wait launcher")
}

struct Decoder<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> Decoder<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }

    fn take(&mut self, length: usize) -> &'a [u8] {
        let end = self.offset.checked_add(length).expect("decoder overflow");
        assert!(end <= self.bytes.len(), "truncated response");
        let value = &self.bytes[self.offset..end];
        self.offset = end;
        value
    }

    fn u8(&mut self) -> u8 {
        self.take(1)[0]
    }

    fn u16(&mut self) -> u16 {
        u16::from_be_bytes(self.take(2).try_into().unwrap())
    }

    fn u32(&mut self) -> u32 {
        u32::from_be_bytes(self.take(4).try_into().unwrap())
    }

    fn u64(&mut self) -> u64 {
        u64::from_be_bytes(self.take(8).try_into().unwrap())
    }

    fn done(&self) -> bool {
        self.offset == self.bytes.len()
    }
}

fn take_frame<'a>(stream: &mut Decoder<'a>) -> Decoder<'a> {
    let length = stream.u32() as usize;
    Decoder::new(stream.take(length))
}

fn response_header(frame: &mut Decoder<'_>) -> (u8, u8, u64) {
    assert_eq!(frame.u8(), PROTOCOL_VERSION);
    let opcode = frame.u8();
    let status = frame.u8();
    assert_eq!(frame.u8(), 0);
    let request_id = frame.u64();
    (opcode, status, request_id)
}

fn wait_for_path(path: &Path) {
    for _ in 0..500 {
        if path.exists() {
            return;
        }
        thread::sleep(Duration::from_millis(10));
    }
    panic!("timed out waiting for {}", path.display());
}

#[test]
fn launcher_serves_list_and_package_through_fd_bound_helper() {
    let tree = TempTree::new("roundtrip");
    write_skill(tree.path(), "inspect");

    let mut input = frame(OPCODE_LIST_SKILLS, 11, &[]);
    input.extend_from_slice(&frame(OPCODE_READ_PACKAGE, 12, &read_body("inspect")));
    let output = launch(tree.path(), &input);
    assert!(
        output.status.success(),
        "launcher failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(output.stderr.is_empty());

    let mut stream = Decoder::new(&output.stdout);
    let mut list = take_frame(&mut stream);
    assert_eq!(
        response_header(&mut list),
        (OPCODE_LIST_SKILLS, STATUS_OK, 11)
    );
    assert_eq!(list.u16(), 1);
    let name_len = list.u8() as usize;
    assert_eq!(list.take(name_len), b"inspect");
    assert!(list.done());

    let mut package = take_frame(&mut stream);
    assert_eq!(
        response_header(&mut package),
        (OPCODE_READ_PACKAGE, STATUS_OK, 12)
    );
    assert_eq!(package.u16(), 2);
    for _ in 0..2 {
        let path_len = package.u16() as usize;
        let _executable = package.u8();
        let byte_len = package.u32() as usize;
        package.take(path_len);
        package.take(byte_len);
    }
    assert!(package.done());
    assert!(stream.done());
}

#[test]
fn launcher_argument_contract_fails_closed() {
    let launcher = env!("CARGO_BIN_EXE_a2-skill-source-launcher");
    let missing = Command::new(launcher)
        .output()
        .expect("missing root launch");
    assert_eq!(missing.status.code(), Some(70));
    assert_eq!(
        String::from_utf8(missing.stderr).unwrap().trim(),
        "skill_launcher_root_argument_missing"
    );

    let relative = Command::new(launcher)
        .arg("relative-root")
        .output()
        .expect("relative root launch");
    assert_eq!(relative.status.code(), Some(70));
    assert_eq!(
        String::from_utf8(relative.stderr).unwrap().trim(),
        "skill_launcher_root_not_absolute"
    );

    let extra = Command::new(launcher)
        .arg("/tmp")
        .arg("extra")
        .output()
        .expect("extra root launch");
    assert_eq!(extra.status.code(), Some(70));
    assert_eq!(
        String::from_utf8(extra.stderr).unwrap().trim(),
        "skill_launcher_root_argument_count_invalid"
    );
}

#[test]
fn launcher_rejects_missing_symlink_directory_non_executable_and_privileged_sibling() {
    let tree = TempTree::new("sibling-contract");
    let launcher = copy_launcher(tree.path());
    let root = tree.path().join("root");
    fs::create_dir(&root).unwrap();
    let helper = tree.path().join("a2-skill-source-helper");

    let missing = Command::new(&launcher).arg(&root).output().unwrap();
    assert_eq!(missing.status.code(), Some(70));
    assert_eq!(
        String::from_utf8(missing.stderr).unwrap().trim(),
        "skill_launcher_helper_missing"
    );

    std::os::unix::fs::symlink("/bin/true", &helper).unwrap();
    let symlink = Command::new(&launcher).arg(&root).output().unwrap();
    assert_eq!(symlink.status.code(), Some(70));
    assert_eq!(
        String::from_utf8(symlink.stderr).unwrap().trim(),
        "skill_launcher_helper_symlink_rejected"
    );
    fs::remove_file(&helper).unwrap();

    fs::create_dir(&helper).unwrap();
    let directory = Command::new(&launcher).arg(&root).output().unwrap();
    assert_eq!(directory.status.code(), Some(70));
    assert_eq!(
        String::from_utf8(directory.stderr).unwrap().trim(),
        "skill_launcher_helper_not_regular"
    );
    fs::remove_dir(&helper).unwrap();

    fs::write(&helper, b"not executable").unwrap();
    let mut permissions = fs::metadata(&helper).unwrap().permissions();
    permissions.set_mode(0o644);
    fs::set_permissions(&helper, permissions).unwrap();
    let non_exec = Command::new(&launcher).arg(&root).output().unwrap();
    assert_eq!(non_exec.status.code(), Some(70));
    assert_eq!(
        String::from_utf8(non_exec.stderr).unwrap().trim(),
        "skill_launcher_helper_not_executable"
    );
    fs::remove_file(&helper).unwrap();

    copy_executable(Path::new("/bin/true"), &helper);
    let mut permissions = fs::metadata(&helper).unwrap().permissions();
    permissions.set_mode(0o4755);
    fs::set_permissions(&helper, permissions).unwrap();
    let privileged = Command::new(&launcher).arg(&root).output().unwrap();
    assert_eq!(privileged.status.code(), Some(70));
    assert_eq!(
        String::from_utf8(privileged.stderr).unwrap().trim(),
        "skill_launcher_helper_privileged_mode_rejected"
    );
}

#[cfg(feature = "r7l-test-hooks")]
#[test]
fn launcher_cuts_fd_environment_and_privilege_gain_before_native_probe_exec() {
    let tree = TempTree::new("native-probe");
    let launcher = copy_launcher(tree.path());
    let root = tree.path().join("root");
    fs::create_dir(&root).unwrap();
    copy_executable(
        Path::new(PROBE),
        &tree.path().join("a2-skill-source-helper"),
    );

    let output = Command::new("bash")
        .arg("-c")
        .arg("exec 9</dev/null; exec \"$1\" \"$2\"")
        .arg("r7l-preexec")
        .arg(&launcher)
        .arg(&root)
        .env("A2_R7L_ENV_SENTINEL", "must-not-cross-exec")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .expect("launch native pre-exec probe");

    assert!(
        output.status.success(),
        "pre-exec probe failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(output.stdout, b"r7l_probe_ok\n");
    assert!(output.stderr.is_empty());
}

#[cfg(feature = "r7l-test-hooks")]
#[test]
fn swap_after_open_cannot_redirect_fd_bound_execution() {
    let tree = TempTree::new("identity-swap");
    let launcher = copy_launcher(tree.path());
    let root = tree.path().join("root");
    fs::create_dir(&root).unwrap();

    let helper = tree.path().join("a2-skill-source-helper");
    let replacement = tree.path().join("replacement-helper");
    let original = tree.path().join("opened-original");
    copy_executable(Path::new("/bin/true"), &helper);
    copy_executable(Path::new("/bin/false"), &replacement);

    let ready = tree.path().join("opened.ready");
    let proceed = tree.path().join("continue.ready");
    let child = Command::new(&launcher)
        .arg(&root)
        .env("A2_R7L_TEST_READY", &ready)
        .env("A2_R7L_TEST_PROCEED", &proceed)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn identity-bound launcher");

    wait_for_path(&ready);
    fs::rename(&helper, &original).unwrap();
    fs::rename(&replacement, &helper).unwrap();
    assert!(
        !Command::new(&helper).status().unwrap().success(),
        "path swap did not install the false replacement"
    );
    fs::write(&proceed, b"continue").unwrap();

    let output = child
        .wait_with_output()
        .expect("wait identity-bound launcher");
    assert!(
        output.status.success(),
        "opened helper identity was redirected: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(output.stdout.is_empty());
    assert!(output.stderr.is_empty());
}

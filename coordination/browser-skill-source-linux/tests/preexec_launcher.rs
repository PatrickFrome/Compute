#![cfg(target_os = "linux")]

use std::fs;
use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

const PROTOCOL_VERSION: u8 = 1;
const OPCODE_LIST_SKILLS: u8 = 1;
const OPCODE_READ_PACKAGE: u8 = 2;
const STATUS_OK: u8 = 0;
const REQUEST_HEADER_BYTES: usize = 12;

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
            std::env::temp_dir().join(format!("a2-r7k-{label}-{}-{nonce}", std::process::id()));
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
        format!("---\nname: {name}\ndescription: R7K launcher test\n---\nRead only.\n"),
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

fn copy_launcher(directory: &Path) -> PathBuf {
    let destination = directory.join("a2-skill-source-launcher");
    fs::copy(env!("CARGO_BIN_EXE_a2-skill-source-launcher"), &destination).expect("copy launcher");
    let mut permissions = fs::metadata(&destination).unwrap().permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&destination, permissions).unwrap();
    destination
}

#[test]
fn launcher_serves_list_and_package_through_fixed_sibling_helper() {
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
fn launcher_rejects_missing_symlink_and_non_executable_sibling() {
    let tree = TempTree::new("sibling-contract");
    let launcher = copy_launcher(tree.path());
    let root = tree.path().join("root");
    fs::create_dir(&root).unwrap();

    let missing = Command::new(&launcher).arg(&root).output().unwrap();
    assert_eq!(missing.status.code(), Some(70));
    assert_eq!(
        String::from_utf8(missing.stderr).unwrap().trim(),
        "skill_launcher_helper_missing"
    );

    let helper = tree.path().join("a2-skill-source-helper");
    std::os::unix::fs::symlink("/bin/true", &helper).unwrap();
    let symlink = Command::new(&launcher).arg(&root).output().unwrap();
    assert_eq!(symlink.status.code(), Some(70));
    assert_eq!(
        String::from_utf8(symlink.stderr).unwrap().trim(),
        "skill_launcher_helper_symlink_rejected"
    );
    fs::remove_file(&helper).unwrap();

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
}

#[test]
fn launcher_cuts_ambient_fd_and_environment_before_unsanitized_probe_exec() {
    let tree = TempTree::new("preexec-probe");
    let launcher = copy_launcher(tree.path());
    let root = tree.path().join("root");
    fs::create_dir(&root).unwrap();
    let helper = tree.path().join("a2-skill-source-helper");
    fs::write(
        &helper,
        b"#!/bin/sh\nif [ -e /proc/self/fd/9 ]; then echo skill_launcher_probe_fd_survived >&2; exit 91; fi\nif [ \"${A2_R7K_ENV_SENTINEL+x}\" = x ]; then echo skill_launcher_probe_env_survived >&2; exit 92; fi\nexit 0\n",
    )
    .unwrap();
    let mut permissions = fs::metadata(&helper).unwrap().permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&helper, permissions).unwrap();

    let output = Command::new("bash")
        .arg("-c")
        .arg("exec 9</dev/null; exec \"$1\" \"$2\"")
        .arg("r7k-preexec")
        .arg(&launcher)
        .arg(&root)
        .env("A2_R7K_ENV_SENTINEL", "must-not-cross-exec")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .expect("launch unsanitized sibling probe");

    assert!(
        output.status.success(),
        "pre-exec probe failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(output.stdout.is_empty());
    assert!(output.stderr.is_empty());
}

#![cfg(target_os = "linux")]

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

const PROTOCOL_VERSION: u8 = 1;
const OPCODE_LIST_SKILLS: u8 = 1;
const OPCODE_READ_PACKAGE: u8 = 2;
const STATUS_OK: u8 = 0;
const STATUS_ERROR: u8 = 1;
const REQUEST_HEADER_BYTES: usize = 12;
const MAX_REQUEST_PAYLOAD_BYTES: usize = REQUEST_HEADER_BYTES + 1 + 64;

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
            "a2-r7g-{label}-{}-{nonce}",
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

fn write_skill(root: &Path, name: &str) {
    let dir = root.join(name);
    fs::create_dir_all(dir.join("references")).unwrap();
    fs::write(
        dir.join("SKILL.md"),
        format!("---\nname: {name}\ndescription: helper protocol test\n---\nRead only.\n"),
    )
    .unwrap();
    fs::write(dir.join("references/REFERENCE.md"), b"reference-v1").unwrap();
}

fn request_frame(opcode: u8, request_id: u64, body: &[u8]) -> Vec<u8> {
    let mut payload = Vec::with_capacity(REQUEST_HEADER_BYTES + body.len());
    payload.push(PROTOCOL_VERSION);
    payload.push(opcode);
    payload.extend_from_slice(&0_u16.to_be_bytes());
    payload.extend_from_slice(&request_id.to_be_bytes());
    payload.extend_from_slice(body);
    let mut frame = Vec::with_capacity(4 + payload.len());
    frame.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    frame.extend_from_slice(&payload);
    frame
}

fn read_request_body(name: &str) -> Vec<u8> {
    let mut body = Vec::with_capacity(1 + name.len());
    body.push(name.len() as u8);
    body.extend_from_slice(name.as_bytes());
    body
}

fn run_helper(root: &Path, input: &[u8]) -> std::process::Output {
    let mut child = Command::new(env!("CARGO_BIN_EXE_a2-skill-source-helper"))
        .arg(root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn helper");
    child
        .stdin
        .as_mut()
        .expect("helper stdin")
        .write_all(input)
        .expect("write helper input");
    drop(child.stdin.take());
    child.wait_with_output().expect("wait helper")
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
        assert!(end <= self.bytes.len(), "truncated test response");
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

#[test]
fn helper_serves_list_then_package_sequentially_over_one_stream() {
    let tree = TempTree::new("roundtrip");
    write_skill(tree.path(), "inspect");

    let mut input = request_frame(OPCODE_LIST_SKILLS, 11, &[]);
    input.extend_from_slice(&request_frame(
        OPCODE_READ_PACKAGE,
        12,
        &read_request_body("inspect"),
    ));
    let output = run_helper(tree.path(), &input);
    assert!(output.status.success());
    assert!(output.stderr.is_empty());

    let mut stream = Decoder::new(&output.stdout);
    let mut list = take_frame(&mut stream);
    assert_eq!(response_header(&mut list), (OPCODE_LIST_SKILLS, STATUS_OK, 11));
    let count = list.u16();
    assert_eq!(count, 1);
    let name_length = list.u8() as usize;
    assert_eq!(list.take(name_length), b"inspect");
    assert!(list.done());

    let mut package = take_frame(&mut stream);
    assert_eq!(
        response_header(&mut package),
        (OPCODE_READ_PACKAGE, STATUS_OK, 12)
    );
    let file_count = package.u16();
    assert_eq!(file_count, 2);
    let mut paths = Vec::new();
    for _ in 0..file_count {
        let path_length = package.u16() as usize;
        let executable = package.u8();
        let byte_length = package.u32() as usize;
        let path = std::str::from_utf8(package.take(path_length))
            .unwrap()
            .to_owned();
        let bytes = package.take(byte_length).to_vec();
        assert_eq!(executable, 0);
        paths.push((path, bytes));
    }
    assert!(package.done());
    assert!(stream.done());
    assert_eq!(paths[0].0, "SKILL.md");
    assert!(String::from_utf8(paths[0].1.clone()).unwrap().contains("name: inspect"));
    assert_eq!(paths[1], ("references/REFERENCE.md".to_owned(), b"reference-v1".to_vec()));
}

#[test]
fn malformed_opcode_is_a_bad_message_and_terminates_without_response() {
    let tree = TempTree::new("bad-opcode");
    write_skill(tree.path(), "inspect");
    let output = run_helper(tree.path(), &request_frame(255, 1, &[]));
    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
    assert_eq!(
        String::from_utf8(output.stderr).unwrap().trim(),
        "skill_helper_protocol_opcode_unsupported"
    );
}

#[test]
fn oversized_prefix_is_rejected_before_the_helper_waits_for_a_body() {
    let tree = TempTree::new("oversized-prefix");
    write_skill(tree.path(), "inspect");
    let input = ((MAX_REQUEST_PAYLOAD_BYTES + 1) as u32).to_be_bytes();
    let output = run_helper(tree.path(), &input);
    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
    assert_eq!(
        String::from_utf8(output.stderr).unwrap().trim(),
        "skill_helper_protocol_frame_too_large"
    );
}

#[test]
fn valid_request_source_failure_returns_only_a_bounded_error_token() {
    let tree = TempTree::new("typed-error");
    write_skill(tree.path(), "inspect");
    let output = run_helper(
        tree.path(),
        &request_frame(
            OPCODE_READ_PACKAGE,
            21,
            &read_request_body("missing"),
        ),
    );
    assert!(output.status.success());
    assert!(output.stderr.is_empty());

    let mut stream = Decoder::new(&output.stdout);
    let mut frame = take_frame(&mut stream);
    assert_eq!(
        response_header(&mut frame),
        (OPCODE_READ_PACKAGE, STATUS_ERROR, 21)
    );
    let code_length = frame.u8() as usize;
    let code = std::str::from_utf8(frame.take(code_length)).unwrap();
    assert!(code.starts_with("skill_loader_"));
    assert!(!code.contains('/'));
    assert!(!code.contains(':'));
    assert!(frame.done());
    assert!(stream.done());
}

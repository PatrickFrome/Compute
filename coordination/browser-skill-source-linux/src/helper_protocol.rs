use std::fmt;
use std::io::{ErrorKind, Read, Write};

const PROTOCOL_VERSION: u8 = 1;
const OPCODE_LIST_SKILLS: u8 = 1;
const OPCODE_READ_PACKAGE: u8 = 2;
const STATUS_OK: u8 = 0;
const STATUS_ERROR: u8 = 1;
const REQUEST_HEADER_BYTES: usize = 12;
const RESPONSE_HEADER_BYTES: usize = 12;
const MAX_SKILL_NAME_BYTES: usize = 64;
const MAX_SKILL_COUNT: usize = 128;
const MAX_PACKAGE_FILES: usize = 65;
const MAX_PACKAGE_BYTES: usize = (2 * 1024 * 1024) + (96 * 1024);
const MAX_SKILL_BYTES: usize = 96 * 1024;
const MAX_RESOURCE_BYTES: usize = 256 * 1024;
const MAX_RESOURCE_FILENAME_BYTES: usize = 128;
const MAX_PACKAGE_PATH_BYTES: usize = 139;
const MAX_ERROR_CODE_BYTES: usize = 64;
const MIN_REQUEST_PAYLOAD_BYTES: usize = REQUEST_HEADER_BYTES;
const MAX_REQUEST_PAYLOAD_BYTES: usize = REQUEST_HEADER_BYTES + 1 + MAX_SKILL_NAME_BYTES;
const MIN_RESPONSE_PAYLOAD_BYTES: usize = RESPONSE_HEADER_BYTES + 2;
const MAX_RESPONSE_PAYLOAD_BYTES: usize = RESPONSE_HEADER_BYTES
    + 2
    + MAX_PACKAGE_BYTES
    + MAX_PACKAGE_FILES * (2 + 1 + 4 + MAX_PACKAGE_PATH_BYTES);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProtocolError {
    code: &'static str,
}

impl ProtocolError {
    fn new(code: &'static str) -> Self {
        Self { code }
    }

    pub fn code(&self) -> &'static str {
        self.code
    }
}

impl fmt::Display for ProtocolError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.code)
    }
}

impl std::error::Error for ProtocolError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HelperRequest {
    ListSkills { request_id: u64 },
    ReadPackage { request_id: u64, skill_name: String },
}

impl HelperRequest {
    pub fn request_id(&self) -> u64 {
        match self {
            Self::ListSkills { request_id } | Self::ReadPackage { request_id, .. } => *request_id,
        }
    }

    pub fn opcode(&self) -> u8 {
        match self {
            Self::ListSkills { .. } => OPCODE_LIST_SKILLS,
            Self::ReadPackage { .. } => OPCODE_READ_PACKAGE,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WirePackageFile {
    pub path: String,
    pub executable: bool,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HelperResponse {
    Skills {
        request_id: u64,
        names: Vec<String>,
    },
    Package {
        request_id: u64,
        files: Vec<WirePackageFile>,
    },
    Error {
        request_id: u64,
        opcode: u8,
        code: String,
    },
}

struct Decoder<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> Decoder<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }

    fn take(&mut self, length: usize) -> Result<&'a [u8], ProtocolError> {
        let end = self
            .offset
            .checked_add(length)
            .ok_or_else(|| ProtocolError::new("skill_helper_protocol_length_overflow"))?;
        if end > self.bytes.len() {
            return Err(ProtocolError::new(
                "skill_helper_protocol_payload_truncated",
            ));
        }
        let value = &self.bytes[self.offset..end];
        self.offset = end;
        Ok(value)
    }

    fn u8(&mut self) -> Result<u8, ProtocolError> {
        Ok(self.take(1)?[0])
    }

    fn u16(&mut self) -> Result<u16, ProtocolError> {
        let bytes: [u8; 2] = self
            .take(2)?
            .try_into()
            .map_err(|_| ProtocolError::new("skill_helper_protocol_payload_truncated"))?;
        Ok(u16::from_be_bytes(bytes))
    }

    fn u64(&mut self) -> Result<u64, ProtocolError> {
        let bytes: [u8; 8] = self
            .take(8)?
            .try_into()
            .map_err(|_| ProtocolError::new("skill_helper_protocol_payload_truncated"))?;
        Ok(u64::from_be_bytes(bytes))
    }

    fn finish(self) -> Result<(), ProtocolError> {
        if self.offset != self.bytes.len() {
            return Err(ProtocolError::new("skill_helper_protocol_trailing_bytes"));
        }
        Ok(())
    }
}

fn validate_skill_name(name: &str) -> bool {
    if name.is_empty()
        || name.len() > MAX_SKILL_NAME_BYTES
        || name.starts_with('-')
        || name.ends_with('-')
        || name.contains("--")
    {
        return false;
    }
    name.as_bytes().iter().enumerate().all(|(index, byte)| {
        byte.is_ascii_lowercase()
            || byte.is_ascii_digit()
            || (*byte == b'-' && index > 0 && index + 1 < name.len())
    })
}

fn validate_resource_filename(name: &str) -> bool {
    if name.is_empty() || name.len() > MAX_RESOURCE_FILENAME_BYTES || name.contains("..") {
        return false;
    }
    let mut bytes = name.bytes();
    let Some(first) = bytes.next() else {
        return false;
    };
    if !first.is_ascii_alphanumeric() {
        return false;
    }
    bytes.all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
}

fn validate_package_path(path: &str) -> bool {
    if path == "SKILL.md" {
        return true;
    }
    if path.is_empty() || path.len() > MAX_PACKAGE_PATH_BYTES {
        return false;
    }
    let Some((directory, filename)) = path.split_once('/') else {
        return false;
    };
    if filename.contains('/') || !matches!(directory, "assets" | "references" | "scripts") {
        return false;
    }
    validate_resource_filename(filename)
}

fn validate_error_code(code: &str) -> bool {
    !code.is_empty()
        && code.len() <= MAX_ERROR_CODE_BYTES
        && code
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
}

fn known_opcode(opcode: u8) -> bool {
    matches!(opcode, OPCODE_LIST_SKILLS | OPCODE_READ_PACKAGE)
}

fn read_frame<R: Read>(reader: &mut R) -> Result<Option<Vec<u8>>, ProtocolError> {
    let mut length_bytes = [0_u8; 4];
    loop {
        match reader.read(&mut length_bytes[..1]) {
            Ok(0) => return Ok(None),
            Ok(1) => break,
            Ok(_) => unreachable!(),
            Err(error) if error.kind() == ErrorKind::Interrupted => continue,
            Err(_) => return Err(ProtocolError::new("skill_helper_protocol_read_failed")),
        }
    }
    reader
        .read_exact(&mut length_bytes[1..])
        .map_err(|error| match error.kind() {
            ErrorKind::UnexpectedEof => {
                ProtocolError::new("skill_helper_protocol_length_prefix_truncated")
            }
            _ => ProtocolError::new("skill_helper_protocol_read_failed"),
        })?;
    let length = u32::from_be_bytes(length_bytes) as usize;
    if length < MIN_REQUEST_PAYLOAD_BYTES {
        return Err(ProtocolError::new("skill_helper_protocol_frame_too_small"));
    }
    if length > MAX_REQUEST_PAYLOAD_BYTES {
        return Err(ProtocolError::new("skill_helper_protocol_frame_too_large"));
    }
    let mut payload = vec![0_u8; length];
    reader
        .read_exact(&mut payload)
        .map_err(|error| match error.kind() {
            ErrorKind::UnexpectedEof => ProtocolError::new("skill_helper_protocol_frame_truncated"),
            _ => ProtocolError::new("skill_helper_protocol_read_failed"),
        })?;
    Ok(Some(payload))
}

fn decode_request_payload(payload: &[u8]) -> Result<HelperRequest, ProtocolError> {
    if payload.len() < MIN_REQUEST_PAYLOAD_BYTES || payload.len() > MAX_REQUEST_PAYLOAD_BYTES {
        return Err(ProtocolError::new(
            "skill_helper_protocol_request_size_invalid",
        ));
    }
    let mut decoder = Decoder::new(payload);
    let version = decoder.u8()?;
    if version != PROTOCOL_VERSION {
        return Err(ProtocolError::new(
            "skill_helper_protocol_version_unsupported",
        ));
    }
    let opcode = decoder.u8()?;
    if !known_opcode(opcode) {
        return Err(ProtocolError::new(
            "skill_helper_protocol_opcode_unsupported",
        ));
    }
    let flags = decoder.u16()?;
    if flags != 0 {
        return Err(ProtocolError::new("skill_helper_protocol_flags_invalid"));
    }
    let request_id = decoder.u64()?;
    if request_id == 0 {
        return Err(ProtocolError::new(
            "skill_helper_protocol_request_id_invalid",
        ));
    }

    match opcode {
        OPCODE_LIST_SKILLS => {
            decoder.finish()?;
            Ok(HelperRequest::ListSkills { request_id })
        }
        OPCODE_READ_PACKAGE => {
            let name_length = decoder.u8()? as usize;
            if name_length == 0 || name_length > MAX_SKILL_NAME_BYTES {
                return Err(ProtocolError::new(
                    "skill_helper_protocol_skill_name_invalid",
                ));
            }
            let name_bytes = decoder.take(name_length)?;
            decoder.finish()?;
            let name = std::str::from_utf8(name_bytes)
                .map_err(|_| ProtocolError::new("skill_helper_protocol_skill_name_invalid"))?;
            if !validate_skill_name(name) {
                return Err(ProtocolError::new(
                    "skill_helper_protocol_skill_name_invalid",
                ));
            }
            Ok(HelperRequest::ReadPackage {
                request_id,
                skill_name: name.to_owned(),
            })
        }
        _ => unreachable!(),
    }
}

pub fn read_request<R: Read>(reader: &mut R) -> Result<Option<HelperRequest>, ProtocolError> {
    let Some(payload) = read_frame(reader)? else {
        return Ok(None);
    };
    decode_request_payload(&payload).map(Some)
}

fn validate_response_header(opcode: u8, request_id: u64) -> Result<(), ProtocolError> {
    if !known_opcode(opcode) {
        return Err(ProtocolError::new(
            "skill_helper_protocol_response_opcode_invalid",
        ));
    }
    if request_id == 0 {
        return Err(ProtocolError::new(
            "skill_helper_protocol_response_id_invalid",
        ));
    }
    Ok(())
}

fn validate_skill_names(names: &[String]) -> Result<(), ProtocolError> {
    if names.len() > MAX_SKILL_COUNT {
        return Err(ProtocolError::new(
            "skill_helper_protocol_skill_count_exceeded",
        ));
    }
    let mut previous: Option<&str> = None;
    for name in names {
        if !validate_skill_name(name) {
            return Err(ProtocolError::new(
                "skill_helper_protocol_skill_name_invalid",
            ));
        }
        if previous.is_some_and(|value| value >= name.as_str()) {
            return Err(ProtocolError::new(
                "skill_helper_protocol_skill_order_invalid",
            ));
        }
        previous = Some(name);
    }
    Ok(())
}

fn validate_package_files(files: &[WirePackageFile]) -> Result<usize, ProtocolError> {
    if files.is_empty() || files.len() > MAX_PACKAGE_FILES {
        return Err(ProtocolError::new(
            "skill_helper_protocol_package_file_count_invalid",
        ));
    }
    let mut total_bytes = 0_usize;
    let mut previous: Option<&str> = None;
    let mut saw_skill = false;
    let mut encoded_bytes = RESPONSE_HEADER_BYTES + 2;
    for file in files {
        if !validate_package_path(&file.path) {
            return Err(ProtocolError::new(
                "skill_helper_protocol_package_path_invalid",
            ));
        }
        if previous.is_some_and(|value| value >= file.path.as_str()) {
            return Err(ProtocolError::new(
                "skill_helper_protocol_package_order_invalid",
            ));
        }
        previous = Some(&file.path);
        let file_limit = if file.path == "SKILL.md" {
            if saw_skill || file.executable {
                return Err(ProtocolError::new(
                    "skill_helper_protocol_skill_file_invalid",
                ));
            }
            saw_skill = true;
            MAX_SKILL_BYTES
        } else {
            MAX_RESOURCE_BYTES
        };
        if file.bytes.len() > file_limit {
            return Err(ProtocolError::new("skill_helper_protocol_file_too_large"));
        }
        total_bytes = total_bytes
            .checked_add(file.bytes.len())
            .ok_or_else(|| ProtocolError::new("skill_helper_protocol_length_overflow"))?;
        if total_bytes > MAX_PACKAGE_BYTES {
            return Err(ProtocolError::new(
                "skill_helper_protocol_package_too_large",
            ));
        }
        encoded_bytes = encoded_bytes
            .checked_add(2 + 1 + 4 + file.path.len() + file.bytes.len())
            .ok_or_else(|| ProtocolError::new("skill_helper_protocol_length_overflow"))?;
        if encoded_bytes > MAX_RESPONSE_PAYLOAD_BYTES {
            return Err(ProtocolError::new(
                "skill_helper_protocol_response_too_large",
            ));
        }
    }
    if !saw_skill {
        return Err(ProtocolError::new(
            "skill_helper_protocol_skill_file_missing",
        ));
    }
    Ok(encoded_bytes)
}

fn response_payload_length(response: &HelperResponse) -> Result<usize, ProtocolError> {
    let length = match response {
        HelperResponse::Skills { request_id, names } => {
            validate_response_header(OPCODE_LIST_SKILLS, *request_id)?;
            validate_skill_names(names)?;
            names
                .iter()
                .try_fold(RESPONSE_HEADER_BYTES + 2, |total, name| {
                    total
                        .checked_add(1 + name.len())
                        .ok_or_else(|| ProtocolError::new("skill_helper_protocol_length_overflow"))
                })?
        }
        HelperResponse::Package { request_id, files } => {
            validate_response_header(OPCODE_READ_PACKAGE, *request_id)?;
            validate_package_files(files)?
        }
        HelperResponse::Error {
            request_id,
            opcode,
            code,
        } => {
            validate_response_header(*opcode, *request_id)?;
            if !validate_error_code(code) {
                return Err(ProtocolError::new(
                    "skill_helper_protocol_error_code_invalid",
                ));
            }
            RESPONSE_HEADER_BYTES
                .checked_add(1 + code.len())
                .ok_or_else(|| ProtocolError::new("skill_helper_protocol_length_overflow"))?
        }
    };
    if length < MIN_RESPONSE_PAYLOAD_BYTES || length > MAX_RESPONSE_PAYLOAD_BYTES {
        return Err(ProtocolError::new(
            "skill_helper_protocol_response_size_invalid",
        ));
    }
    Ok(length)
}

fn write_all<W: Write>(writer: &mut W, bytes: &[u8]) -> Result<(), ProtocolError> {
    writer
        .write_all(bytes)
        .map_err(|_| ProtocolError::new("skill_helper_protocol_write_failed"))
}

fn write_response_header<W: Write>(
    writer: &mut W,
    opcode: u8,
    status: u8,
    request_id: u64,
) -> Result<(), ProtocolError> {
    write_all(writer, &[PROTOCOL_VERSION, opcode, status, 0])?;
    write_all(writer, &request_id.to_be_bytes())
}

pub fn write_response<W: Write>(
    writer: &mut W,
    response: &HelperResponse,
) -> Result<(), ProtocolError> {
    // Validate the complete logical response and compute its exact frame size before emitting any
    // byte. This preserves fail-closed response validation without allocating a second package-sized
    // wire buffer.
    let payload_length = response_payload_length(response)?;
    let frame_length = u32::try_from(payload_length)
        .map_err(|_| ProtocolError::new("skill_helper_protocol_response_too_large"))?;
    write_all(writer, &frame_length.to_be_bytes())?;

    match response {
        HelperResponse::Skills { request_id, names } => {
            write_response_header(writer, OPCODE_LIST_SKILLS, STATUS_OK, *request_id)?;
            write_all(writer, &(names.len() as u16).to_be_bytes())?;
            for name in names {
                write_all(writer, &[name.len() as u8])?;
                write_all(writer, name.as_bytes())?;
            }
        }
        HelperResponse::Package { request_id, files } => {
            write_response_header(writer, OPCODE_READ_PACKAGE, STATUS_OK, *request_id)?;
            write_all(writer, &(files.len() as u16).to_be_bytes())?;
            for file in files {
                write_all(writer, &(file.path.len() as u16).to_be_bytes())?;
                write_all(writer, &[u8::from(file.executable)])?;
                write_all(writer, &(file.bytes.len() as u32).to_be_bytes())?;
                write_all(writer, file.path.as_bytes())?;
                write_all(writer, &file.bytes)?;
            }
        }
        HelperResponse::Error {
            request_id,
            opcode,
            code,
        } => {
            write_response_header(writer, *opcode, STATUS_ERROR, *request_id)?;
            write_all(writer, &[code.len() as u8])?;
            write_all(writer, code.as_bytes())?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn request_frame(payload: &[u8]) -> Vec<u8> {
        let mut output = Vec::with_capacity(4 + payload.len());
        output.extend_from_slice(&(payload.len() as u32).to_be_bytes());
        output.extend_from_slice(payload);
        output
    }

    fn request_header(opcode: u8, flags: u16, request_id: u64) -> Vec<u8> {
        let mut payload = Vec::with_capacity(REQUEST_HEADER_BYTES);
        payload.push(PROTOCOL_VERSION);
        payload.push(opcode);
        payload.extend_from_slice(&flags.to_be_bytes());
        payload.extend_from_slice(&request_id.to_be_bytes());
        payload
    }

    #[test]
    fn list_and_read_requests_are_exact_and_bounded() {
        let list = request_frame(&request_header(OPCODE_LIST_SKILLS, 0, 7));
        let mut reader = Cursor::new(list);
        assert_eq!(
            read_request(&mut reader).unwrap(),
            Some(HelperRequest::ListSkills { request_id: 7 })
        );
        assert_eq!(read_request(&mut reader).unwrap(), None);

        let mut read_payload = request_header(OPCODE_READ_PACKAGE, 0, 9);
        read_payload.push(7);
        read_payload.extend_from_slice(b"inspect");
        let mut reader = Cursor::new(request_frame(&read_payload));
        assert_eq!(
            read_request(&mut reader).unwrap(),
            Some(HelperRequest::ReadPackage {
                request_id: 9,
                skill_name: "inspect".to_owned(),
            })
        );
    }

    #[test]
    fn malformed_request_metadata_fails_closed() {
        for opcode in u8::MIN..=u8::MAX {
            if matches!(opcode, OPCODE_LIST_SKILLS | OPCODE_READ_PACKAGE) {
                continue;
            }
            let mut reader = Cursor::new(request_frame(&request_header(opcode, 0, 1)));
            assert_eq!(
                read_request(&mut reader).unwrap_err().code(),
                "skill_helper_protocol_opcode_unsupported"
            );
        }

        let mut wrong_version = request_header(OPCODE_LIST_SKILLS, 0, 1);
        wrong_version[0] = PROTOCOL_VERSION + 1;
        let mut reader = Cursor::new(request_frame(&wrong_version));
        assert_eq!(
            read_request(&mut reader).unwrap_err().code(),
            "skill_helper_protocol_version_unsupported"
        );

        let mut reader = Cursor::new(request_frame(&request_header(OPCODE_LIST_SKILLS, 1, 1)));
        assert_eq!(
            read_request(&mut reader).unwrap_err().code(),
            "skill_helper_protocol_flags_invalid"
        );

        let mut reader = Cursor::new(request_frame(&request_header(OPCODE_LIST_SKILLS, 0, 0)));
        assert_eq!(
            read_request(&mut reader).unwrap_err().code(),
            "skill_helper_protocol_request_id_invalid"
        );
    }

    #[test]
    fn oversized_frame_is_rejected_from_prefix_without_reading_a_body() {
        let bytes = ((MAX_REQUEST_PAYLOAD_BYTES + 1) as u32).to_be_bytes();
        let mut reader = Cursor::new(bytes);
        assert_eq!(
            read_request(&mut reader).unwrap_err().code(),
            "skill_helper_protocol_frame_too_large"
        );
    }

    #[test]
    fn read_package_accepts_only_one_valid_skill_name() {
        for invalid in ["", "../escape", "UPPER", "a--b", "-a", "a-", "a/b"] {
            let mut payload = request_header(OPCODE_READ_PACKAGE, 0, 1);
            payload.push(invalid.len() as u8);
            payload.extend_from_slice(invalid.as_bytes());
            let mut reader = Cursor::new(request_frame(&payload));
            assert_eq!(
                read_request(&mut reader).unwrap_err().code(),
                "skill_helper_protocol_skill_name_invalid"
            );
        }

        let mut payload = request_header(OPCODE_LIST_SKILLS, 0, 1);
        payload.push(0);
        let mut reader = Cursor::new(request_frame(&payload));
        assert_eq!(
            read_request(&mut reader).unwrap_err().code(),
            "skill_helper_protocol_trailing_bytes"
        );
    }

    #[test]
    fn list_response_is_sorted_and_contains_no_unbounded_metadata() {
        let response = HelperResponse::Skills {
            request_id: 5,
            names: vec!["alpha".to_owned(), "zeta".to_owned()],
        };
        let mut frame = Vec::new();
        write_response(&mut frame, &response).unwrap();
        let payload_length = u32::from_be_bytes(frame[..4].try_into().unwrap()) as usize;
        assert_eq!(payload_length, frame.len() - 4);
        assert_eq!(frame[4], PROTOCOL_VERSION);
        assert_eq!(frame[5], OPCODE_LIST_SKILLS);
        assert_eq!(frame[6], STATUS_OK);
        assert_eq!(frame[7], 0);

        let unsorted = HelperResponse::Skills {
            request_id: 5,
            names: vec!["zeta".to_owned(), "alpha".to_owned()],
        };
        let mut rejected = Vec::new();
        assert_eq!(
            write_response(&mut rejected, &unsorted).unwrap_err().code(),
            "skill_helper_protocol_skill_order_invalid"
        );
        assert!(rejected.is_empty());
    }

    #[test]
    fn package_response_revalidates_paths_order_counts_and_byte_budgets() {
        let response = HelperResponse::Package {
            request_id: 8,
            files: vec![
                WirePackageFile {
                    path: "SKILL.md".to_owned(),
                    executable: false,
                    bytes: b"skill".to_vec(),
                },
                WirePackageFile {
                    path: "references/REFERENCE.md".to_owned(),
                    executable: false,
                    bytes: b"reference".to_vec(),
                },
                WirePackageFile {
                    path: "scripts/check.sh".to_owned(),
                    executable: true,
                    bytes: b"inert".to_vec(),
                },
            ],
        };
        let mut frame = Vec::new();
        write_response(&mut frame, &response).unwrap();
        assert!(frame.len() <= 4 + MAX_RESPONSE_PAYLOAD_BYTES);
        assert_eq!(frame[5], OPCODE_READ_PACKAGE);
        assert_eq!(frame[6], STATUS_OK);

        let nested = HelperResponse::Package {
            request_id: 8,
            files: vec![
                WirePackageFile {
                    path: "SKILL.md".to_owned(),
                    executable: false,
                    bytes: b"skill".to_vec(),
                },
                WirePackageFile {
                    path: "references/nested/file.md".to_owned(),
                    executable: false,
                    bytes: b"x".to_vec(),
                },
            ],
        };
        let mut rejected = Vec::new();
        assert_eq!(
            write_response(&mut rejected, &nested).unwrap_err().code(),
            "skill_helper_protocol_package_path_invalid"
        );
        assert!(rejected.is_empty());

        let executable_skill = HelperResponse::Package {
            request_id: 8,
            files: vec![WirePackageFile {
                path: "SKILL.md".to_owned(),
                executable: true,
                bytes: b"skill".to_vec(),
            }],
        };
        let mut rejected = Vec::new();
        assert_eq!(
            write_response(&mut rejected, &executable_skill)
                .unwrap_err()
                .code(),
            "skill_helper_protocol_skill_file_invalid"
        );
        assert!(rejected.is_empty());
    }

    #[test]
    fn source_errors_are_typed_bounded_tokens_only() {
        let response = HelperResponse::Error {
            request_id: 3,
            opcode: OPCODE_READ_PACKAGE,
            code: "skill_loader_confined_open_failed".to_owned(),
        };
        let mut frame = Vec::new();
        write_response(&mut frame, &response).unwrap();
        assert_eq!(frame[5], OPCODE_READ_PACKAGE);
        assert_eq!(frame[6], STATUS_ERROR);
        assert!(!frame.windows(5).any(|window| window == b"/tmp/"));

        let invalid = HelperResponse::Error {
            request_id: 3,
            opcode: OPCODE_READ_PACKAGE,
            code: "path: /tmp/secret".to_owned(),
        };
        let mut rejected = Vec::new();
        assert_eq!(
            write_response(&mut rejected, &invalid).unwrap_err().code(),
            "skill_helper_protocol_error_code_invalid"
        );
        assert!(rejected.is_empty());
    }
}

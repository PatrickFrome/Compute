#![cfg(target_os = "linux")]

use rustix::fd::OwnedFd;
use rustix::fs::{open, openat2, Dir, Mode, OFlags, ResolveFlags};
use rustix::io::Errno;
use std::fmt;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::Path;

const MAX_SKILLS: usize = 128;
const MAX_RESOURCE_FILES: usize = 64;
const MAX_PACKAGE_FILES: usize = MAX_RESOURCE_FILES + 1;
const MAX_PACKAGE_BYTES: usize = (2 * 1024 * 1024) + (96 * 1024);
const MAX_SKILL_BYTES: usize = 96 * 1024;
const MAX_RESOURCE_BYTES: usize = 256 * 1024;
const MAX_FILENAME: usize = 128;
const RESOURCE_DIRS: [&str; 3] = ["assets", "references", "scripts"];

const RESOLVE_CONFINED: ResolveFlags = ResolveFlags::BENEATH
    .union(ResolveFlags::NO_SYMLINKS)
    .union(ResolveFlags::NO_MAGICLINKS)
    .union(ResolveFlags::NO_XDEV);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoaderError {
    code: &'static str,
    detail: Option<String>,
}

impl LoaderError {
    fn new(code: &'static str) -> Self {
        Self { code, detail: None }
    }

    fn with_detail(code: &'static str, detail: impl ToString) -> Self {
        Self {
            code,
            detail: Some(detail.to_string()),
        }
    }

    pub fn code(&self) -> &'static str {
        self.code
    }
}

impl fmt::Display for LoaderError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.detail {
            Some(detail) => write!(f, "{}: {}", self.code, detail),
            None => f.write_str(self.code),
        }
    }
}

impl std::error::Error for LoaderError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PackageFile {
    pub path: String,
    pub executable: bool,
    pub bytes: Vec<u8>,
}

#[derive(Debug)]
pub struct LinuxSkillSource {
    root: OwnedFd,
}

fn validate_skill_name(name: &str) -> bool {
    if name.is_empty() || name.len() > 64 || name.starts_with('-') || name.contains("--") {
        return false;
    }
    name.as_bytes().iter().enumerate().all(|(index, byte)| {
        byte.is_ascii_lowercase()
            || byte.is_ascii_digit()
            || (*byte == b'-' && index > 0 && index + 1 < name.len())
    }) && !name.ends_with('-')
}

fn validate_resource_filename(name: &str) -> bool {
    if name.is_empty() || name.len() > MAX_FILENAME || name.contains("..") {
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

fn dir_entry_name(entry: &rustix::fs::DirEntry) -> Result<&str, LoaderError> {
    std::str::from_utf8(entry.file_name().to_bytes())
        .map_err(|_| LoaderError::new("skill_loader_filename_utf8_invalid"))
}

fn map_openat2_error(error: Errno) -> LoaderError {
    if error == Errno::NOSYS {
        LoaderError::with_detail("skill_loader_openat2_unavailable", error)
    } else {
        LoaderError::with_detail("skill_loader_confined_open_failed", error)
    }
}

fn open_confined_dir<Fd: rustix::fd::AsFd>(dirfd: Fd, path: &str) -> Result<OwnedFd, LoaderError> {
    openat2(
        dirfd,
        path,
        OFlags::RDONLY | OFlags::DIRECTORY | OFlags::CLOEXEC | OFlags::NOFOLLOW,
        Mode::empty(),
        RESOLVE_CONFINED,
    )
    .map_err(map_openat2_error)
}

fn open_confined_file<Fd: rustix::fd::AsFd>(dirfd: Fd, path: &str) -> Result<OwnedFd, LoaderError> {
    openat2(
        dirfd,
        path,
        OFlags::RDONLY
            | OFlags::CLOEXEC
            | OFlags::NOFOLLOW
            | OFlags::NONBLOCK
            | OFlags::NOCTTY,
        Mode::empty(),
        RESOLVE_CONFINED,
    )
    .map_err(map_openat2_error)
}

fn metadata_identity(metadata: &std::fs::Metadata) -> (u64, u64, u64, i64, i64, i64, i64) {
    (
        metadata.dev(),
        metadata.ino(),
        metadata.len(),
        metadata.mtime(),
        metadata.mtime_nsec(),
        metadata.ctime(),
        metadata.ctime_nsec(),
    )
}

fn read_open_file(fd: OwnedFd, max_bytes: usize) -> Result<(Vec<u8>, bool), LoaderError> {
    let mut file = File::from(fd);
    let before = file
        .metadata()
        .map_err(|error| LoaderError::with_detail("skill_loader_file_metadata_failed", error))?;
    if !before.is_file() {
        return Err(LoaderError::new("skill_loader_file_not_regular"));
    }
    if before.nlink() != 1 {
        return Err(LoaderError::new("skill_loader_file_hardlink_rejected"));
    }
    if before.len() > max_bytes as u64 {
        return Err(LoaderError::new("skill_loader_file_too_large"));
    }
    let executable = before.permissions().mode() & 0o111 != 0;
    let before_identity = metadata_identity(&before);

    let mut bytes = Vec::with_capacity(before.len() as usize);
    (&mut file)
        .take(max_bytes as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| LoaderError::with_detail("skill_loader_file_read_failed", error))?;
    if bytes.len() > max_bytes {
        return Err(LoaderError::new("skill_loader_file_too_large"));
    }

    let after = file
        .metadata()
        .map_err(|error| LoaderError::with_detail("skill_loader_file_metadata_failed", error))?;
    if metadata_identity(&after) != before_identity || after.len() as usize != bytes.len() {
        return Err(LoaderError::new("skill_loader_file_changed_during_read"));
    }

    // Re-read the same already-open inode once. This is bounded by the package limits and
    // detects same-size in-place mutation that basic pre/post stat checks can miss.
    file.seek(SeekFrom::Start(0))
        .map_err(|error| LoaderError::with_detail("skill_loader_file_seek_failed", error))?;
    let mut verify = Vec::with_capacity(bytes.len());
    (&mut file)
        .take(max_bytes as u64 + 1)
        .read_to_end(&mut verify)
        .map_err(|error| LoaderError::with_detail("skill_loader_file_read_failed", error))?;
    let final_meta = file
        .metadata()
        .map_err(|error| LoaderError::with_detail("skill_loader_file_metadata_failed", error))?;
    if verify != bytes || metadata_identity(&final_meta) != before_identity {
        return Err(LoaderError::new("skill_loader_file_changed_during_read"));
    }

    Ok((bytes, executable))
}

fn read_directory(fd: &OwnedFd) -> Result<Vec<String>, LoaderError> {
    let mut dir = Dir::read_from(fd)
        .map_err(|error| LoaderError::with_detail("skill_loader_directory_read_failed", error))?;
    let mut names = Vec::new();
    while let Some(entry) = dir.read() {
        let entry = entry
            .map_err(|error| LoaderError::with_detail("skill_loader_directory_read_failed", error))?;
        let name = dir_entry_name(&entry)?;
        if matches!(name, "." | "..") {
            continue;
        }
        names.push(name.to_owned());
    }
    names.sort();
    Ok(names)
}

impl LinuxSkillSource {
    /// Open the operator-configured skills root exactly once with ambient authority.
    /// The configured root itself must not be a symlink. Every subsequent lookup uses openat2.
    pub fn open(root: &Path) -> Result<Self, LoaderError> {
        let root = open(
            root,
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::CLOEXEC | OFlags::NOFOLLOW,
            Mode::empty(),
        )
        .map_err(|error| LoaderError::with_detail("skill_loader_root_open_failed", error))?;

        // Probe the required kernel primitive now; there is intentionally no openat fallback.
        let probe = openat2(
            &root,
            ".",
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::CLOEXEC | OFlags::NOFOLLOW,
            Mode::empty(),
            RESOLVE_CONFINED,
        );
        match probe {
            Ok(_) => Ok(Self { root }),
            Err(error) if error == Errno::NOSYS => Err(LoaderError::with_detail(
                "skill_loader_openat2_unavailable",
                error,
            )),
            Err(error) => Err(LoaderError::with_detail("skill_loader_root_probe_failed", error)),
        }
    }

    pub fn list_skill_names(&self) -> Result<Vec<String>, LoaderError> {
        let root_entries = read_directory(&self.root)?;
        let mut names = Vec::new();
        for name in root_entries {
            if !validate_skill_name(&name) {
                continue;
            }
            // A lexically valid skill candidate must be a real directory beneath root.
            open_confined_dir(&self.root, &name)?;
            names.push(name);
            if names.len() > MAX_SKILLS {
                return Err(LoaderError::new("skill_loader_skill_count_exceeded"));
            }
        }
        Ok(names)
    }

    pub fn read_skill_package(&self, skill_name: &str) -> Result<Vec<PackageFile>, LoaderError> {
        if !validate_skill_name(skill_name) {
            return Err(LoaderError::new("skill_loader_skill_name_invalid"));
        }
        let skill_dir = open_confined_dir(&self.root, skill_name)?;
        let entries = read_directory(&skill_dir)?;
        let mut package = Vec::new();
        let mut total_bytes = 0usize;
        let mut saw_skill = false;

        for entry in entries {
            if entry == "SKILL.md" {
                if saw_skill {
                    return Err(LoaderError::new("skill_loader_skill_file_duplicate"));
                }
                let fd = open_confined_file(&skill_dir, "SKILL.md")?;
                let (bytes, executable) = read_open_file(fd, MAX_SKILL_BYTES)?;
                if executable {
                    return Err(LoaderError::new("skill_loader_skill_file_executable"));
                }
                total_bytes = total_bytes
                    .checked_add(bytes.len())
                    .ok_or_else(|| LoaderError::new("skill_loader_package_too_large"))?;
                package.push(PackageFile {
                    path: "SKILL.md".to_owned(),
                    executable,
                    bytes,
                });
                saw_skill = true;
                continue;
            }

            if RESOURCE_DIRS.contains(&entry.as_str()) {
                let resource_dir = open_confined_dir(&skill_dir, &entry)?;
                for filename in read_directory(&resource_dir)? {
                    if !validate_resource_filename(&filename) {
                        return Err(LoaderError::new("skill_loader_resource_filename_invalid"));
                    }
                    let fd = open_confined_file(&resource_dir, &filename)?;
                    let (bytes, executable) = read_open_file(fd, MAX_RESOURCE_BYTES)?;
                    total_bytes = total_bytes
                        .checked_add(bytes.len())
                        .ok_or_else(|| LoaderError::new("skill_loader_package_too_large"))?;
                    if total_bytes > MAX_PACKAGE_BYTES {
                        return Err(LoaderError::new("skill_loader_package_too_large"));
                    }
                    package.push(PackageFile {
                        path: format!("{entry}/{filename}"),
                        executable,
                        bytes,
                    });
                    if package.len() > MAX_PACKAGE_FILES {
                        return Err(LoaderError::new("skill_loader_package_file_count_exceeded"));
                    }
                }
                continue;
            }

            return Err(LoaderError::new("skill_loader_package_entry_unsupported"));
        }

        if !saw_skill {
            return Err(LoaderError::new("skill_loader_skill_file_missing"));
        }
        if total_bytes > MAX_PACKAGE_BYTES {
            return Err(LoaderError::new("skill_loader_package_too_large"));
        }
        package.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(package)
    }
}

pub const SKILL_SOURCE_LIMITS: SkillSourceLimits = SkillSourceLimits {
    max_skills: MAX_SKILLS,
    max_resource_files: MAX_RESOURCE_FILES,
    max_package_files: MAX_PACKAGE_FILES,
    max_package_bytes: MAX_PACKAGE_BYTES,
    max_skill_bytes: MAX_SKILL_BYTES,
    max_resource_bytes: MAX_RESOURCE_BYTES,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SkillSourceLimits {
    pub max_skills: usize,
    pub max_resource_files: usize,
    pub max_package_files: usize,
    pub max_package_bytes: usize,
    pub max_skill_bytes: usize,
    pub max_resource_bytes: usize,
}

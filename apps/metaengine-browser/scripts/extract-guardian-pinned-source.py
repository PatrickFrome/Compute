#!/usr/bin/env python3
"""Extract a hash-pinned source archive into a new disposable directory."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import tarfile
import tempfile


WINDOWS_DEVICE = re.compile(r"^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$", re.I)
MAX_ARCHIVE_BYTES = 128 * 1024**2


def extract_source(archive, output_dir, expected_sha256, expected_size, root_directory):
    archive, output_dir = Path(archive), Path(output_dir)
    if not re.fullmatch(r"[a-f0-9]{64}", expected_sha256):
        raise ValueError("source_digest_invalid")
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9._-]*", root_directory):
        raise ValueError("source_root_invalid")
    if output_dir.exists():
        raise ValueError("source_destination_exists")
    if type(expected_size) is not int or not 0 < expected_size <= MAX_ARCHIVE_BYTES:
        raise ValueError("source_size_invalid")
    # The caller can rename or rewrite this file. Copy a bounded immutable
    # private bytes object, then hash and parse only that object. A retained
    # descriptor alone would still expose concurrent in-place writes to tar.
    with archive.open("rb") as stream:
        opened = os.fstat(stream.fileno())
        if not stat.S_ISREG(opened.st_mode):
            raise ValueError("source_file_type_invalid")
        if opened.st_size != expected_size:
            raise ValueError("source_size_mismatch")
        snapshot = stream.read(expected_size + 1)
    if len(snapshot) != expected_size:
        raise ValueError("source_size_mismatch")
    snapshot_sha256 = hashlib.sha256(snapshot).hexdigest()
    if snapshot_sha256 != expected_sha256:
        raise ValueError("source_digest_mismatch")
    output_dir.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix=".guardian-source-", dir=output_dir.parent))
    try:
        with io.BytesIO(snapshot) as pinned_stream, tarfile.open(fileobj=pinned_stream, mode="r:gz") as source:
            members = source.getmembers()
            if not members or len(members) > 200000:
                raise ValueError("source_member_count_invalid")
            seen, total = set(), 0
            for member in members:
                path = PurePosixPath(member.name)
                parts = member.name.rstrip("/").split("/")
                if (path.is_absolute() or not parts or parts[0] != root_directory
                        or any(part in ("", ".", "..") or "\\" in part or ":" in part
                               or part.endswith((".", " ")) or WINDOWS_DEVICE.fullmatch(part)
                               or any(ord(c) < 32 for c in part) for part in parts)):
                    raise ValueError("source_member_path_invalid")
                key = "/".join(parts).casefold()
                if key in seen:
                    raise ValueError("source_member_duplicate")
                seen.add(key)
                if not (member.isfile() or member.isdir()):
                    raise ValueError("source_member_type_invalid")
                total += member.size
                if member.size < 0 or member.size > 256 * 1024**2 or total > 1024**3:
                    raise ValueError("source_expanded_size_invalid")
            # All names and types are checked before writing any source member.
            for member in members:
                target = temporary.joinpath(*PurePosixPath(member.name).parts)
                if member.isdir():
                    target.mkdir(parents=True, exist_ok=True)
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with source.extractfile(member) as src, target.open("xb") as dst:
                        shutil.copyfileobj(src, dst)
        os.rename(temporary, output_dir)
        return {"root": str((output_dir / root_directory).resolve()), "members": len(members),
                "expanded_bytes": total, "sha256": snapshot_sha256}
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", required=True)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--size-bytes", required=True, type=int)
    parser.add_argument("--root-directory", required=True)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()
    try:
        result = extract_source(args.archive, args.output_dir, args.sha256, args.size_bytes, args.root_directory)
    except (OSError, ValueError, tarfile.TarError) as error:
        raise SystemExit(f"guardian_source_extract_failed:{error}") from error
    print(json.dumps(result))


if __name__ == "__main__":
    main()

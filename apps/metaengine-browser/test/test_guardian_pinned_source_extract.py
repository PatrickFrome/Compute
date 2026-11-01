import hashlib
import gzip
import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest import mock


SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/extract-guardian-pinned-source.py'
SPEC = importlib.util.spec_from_file_location('guardian_extract', SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class SourceExtractionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.archive = self.base / 'source.tar.gz'
        self.output = self.base / 'output'

    def create(self, names, link=False):
        with tarfile.open(self.archive, 'w:gz') as tar:
            for name in names:
                row = tarfile.TarInfo(name)
                if link:
                    row.type, row.linkname = tarfile.SYMTYPE, '../escape'
                    tar.addfile(row)
                else:
                    row.size = 7
                    tar.addfile(row, io.BytesIO(b'payload'))
        return hashlib.sha256(self.archive.read_bytes()).hexdigest(), self.archive.stat().st_size

    def extract(self, digest, size):
        return MODULE.extract_source(self.archive, self.output, digest, size, 'source-1.0')

    def same_size_archives(self):
        def packed(payload):
            raw = io.BytesIO()
            with tarfile.open(fileobj=raw, mode='w') as tar:
                member = tarfile.TarInfo('source-1.0/file')
                member.size = len(payload)
                tar.addfile(member, io.BytesIO(payload))
            # Stored DEFLATE keeps both valid archives exactly the same size.
            return gzip.compress(raw.getvalue(), compresslevel=0, mtime=0)
        safe, evil = packed(b'SAFE'), packed(b'EVIL')
        self.assertEqual(len(safe), len(evil))
        self.archive.write_bytes(safe)
        return safe, evil

    def test_rename_after_pin_check_cannot_change_extracted_bytes(self):
        safe, evil = self.same_size_archives()
        replacement = self.base / 'replacement.tar.gz'
        replacement.write_bytes(evil)
        original_tar_open = tarfile.open

        def replace_then_parse(*args, **kwargs):
            replacement.replace(self.archive)
            return original_tar_open(*args, **kwargs)

        with mock.patch.object(MODULE.tarfile, 'open', side_effect=replace_then_parse):
            result = self.extract(hashlib.sha256(safe).hexdigest(), len(safe))
        self.assertEqual(self.archive.read_bytes(), evil, 'rename attack must actually occur')
        self.assertEqual((self.output / 'source-1.0/file').read_bytes(), b'SAFE')
        self.assertEqual(result['sha256'], hashlib.sha256(safe).hexdigest())

    def test_inplace_write_after_pin_check_cannot_change_extracted_bytes(self):
        safe, evil = self.same_size_archives()
        original_inode = self.archive.stat().st_ino
        original_tar_open = tarfile.open

        def rewrite_then_parse(*args, **kwargs):
            with self.archive.open('r+b') as writer:
                writer.write(evil)
                writer.truncate()
            return original_tar_open(*args, **kwargs)

        with mock.patch.object(MODULE.tarfile, 'open', side_effect=rewrite_then_parse):
            result = self.extract(hashlib.sha256(safe).hexdigest(), len(safe))
        self.assertEqual(self.archive.stat().st_ino, original_inode)
        self.assertEqual(self.archive.read_bytes(), evil, 'in-place attack must actually occur')
        self.assertEqual((self.output / 'source-1.0/file').read_bytes(), b'SAFE')
        self.assertEqual(result['sha256'], hashlib.sha256(safe).hexdigest())

    def test_snapshot_size_is_bounded_before_opening_input(self):
        for size in [0, -1, True, MODULE.MAX_ARCHIVE_BYTES + 1]:
            with self.subTest(size=size), mock.patch.object(Path, 'open', side_effect=AssertionError('input must not open')):
                with self.assertRaisesRegex(ValueError, 'source_size_invalid'):
                    self.extract('0' * 64, size)
        self.assertFalse(self.output.exists())

    def test_inplace_mutation_during_snapshot_is_rejected(self):
        safe, evil = self.same_size_archives()
        original_open = Path.open
        target = self.archive

        class MutatingReader:
            def __init__(self, stream):
                self.stream = stream
                self.mutated = False

            def __enter__(self):
                return self

            def __exit__(self, *unused):
                self.stream.close()

            def fileno(self):
                return self.stream.fileno()

            def read(self, size):
                if self.mutated:
                    return self.stream.read(size)
                self.mutated = True
                first = self.stream.read(len(safe) // 2)
                with original_open(target, 'r+b') as writer:
                    writer.write(evil)
                    writer.truncate()
                return first + self.stream.read(size - len(first))

        def open_with_writer(path, mode='r', *args, **kwargs):
            stream = original_open(path, mode, *args, **kwargs)
            return MutatingReader(stream) if path == target and mode == 'rb' else stream

        with mock.patch.object(Path, 'open', new=open_with_writer):
            with self.assertRaisesRegex(ValueError, 'source_digest_mismatch'):
                self.extract(hashlib.sha256(safe).hexdigest(), len(safe))
        self.assertEqual(self.archive.read_bytes(), evil)
        self.assertFalse(self.output.exists())

    def test_input_growth_during_snapshot_cannot_exceed_read_bound(self):
        safe, unused_evil = self.same_size_archives()
        original_open = Path.open
        target = self.archive
        requested_sizes = []

        class GrowingReader:
            def __init__(self, stream):
                self.stream = stream

            def __enter__(self):
                return self

            def __exit__(self, *unused):
                self.stream.close()

            def fileno(self):
                return self.stream.fileno()

            def read(self, size):
                requested_sizes.append(size)
                with original_open(target, 'ab') as writer:
                    writer.write(b'x' * 1024)
                return self.stream.read(size)

        def open_with_growth(path, mode='r', *args, **kwargs):
            stream = original_open(path, mode, *args, **kwargs)
            return GrowingReader(stream) if path == target and mode == 'rb' else stream

        with mock.patch.object(Path, 'open', new=open_with_growth):
            with self.assertRaisesRegex(ValueError, 'source_size_mismatch'):
                self.extract(hashlib.sha256(safe).hexdigest(), len(safe))
        self.assertEqual(requested_sizes, [len(safe) + 1])
        self.assertFalse(self.output.exists())

    def test_regular_archive_preserves_bytes(self):
        result = self.extract(*self.create(['source-1.0/include/header.h']))
        self.assertEqual((self.output / 'source-1.0/include/header.h').read_bytes(), b'payload')
        self.assertEqual(result['members'], 1)

    def test_digest_mismatch_does_not_extract(self):
        unused_digest, size = self.create(['source-1.0/file'])
        with self.assertRaisesRegex(ValueError, 'digest_mismatch'):
            self.extract('0' * 64, size)
        self.assertFalse(self.output.exists())

    def test_size_mismatch_does_not_extract(self):
        digest, size = self.create(['source-1.0/file'])
        with self.assertRaisesRegex(ValueError, 'size_mismatch'):
            self.extract(digest, size + 1)
        self.assertFalse(self.output.exists())

    def test_untrusted_names_are_rejected_before_any_member_is_written(self):
        for name in ['../escape', '/source-1.0/file', 'source-1.0/../escape', 'other/file',
                     'source-1.0/C:escape', 'source-1.0/a\\escape', 'source-1.0/CON.txt',
                     'source-1.0/file.', 'source-1.0/file ', 'source-1.0/./file']:
            with self.subTest(name=name):
                with self.assertRaisesRegex(ValueError, 'path_invalid'):
                    self.extract(*self.create(['source-1.0/valid', name]))
                self.assertFalse(self.output.exists())
                self.assertFalse((self.base / 'escape').exists())

    def test_links_and_windows_case_collisions_are_rejected(self):
        with self.assertRaisesRegex(ValueError, 'type_invalid'):
            self.extract(*self.create(['source-1.0/link'], link=True))
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            self.extract(*self.create(['source-1.0/File', 'source-1.0/file']))
        self.assertFalse(self.output.exists())

    def test_existing_destination_is_preserved(self):
        self.output.mkdir()
        marker = self.output / 'keep'
        marker.write_text('existing')
        with self.assertRaisesRegex(ValueError, 'destination_exists'):
            self.extract(*self.create(['source-1.0/file']))
        self.assertEqual(marker.read_text(), 'existing')


if __name__ == '__main__':
    unittest.main()

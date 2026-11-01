import hashlib
import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
import unittest


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

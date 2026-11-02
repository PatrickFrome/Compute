import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('nasm_patch', Path(__file__).resolve().parents[1] / 'scripts/prepare-guardian-nasm-msvc.py')
patcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(patcher)


class NasmMsvcPatchTests(unittest.TestCase):
    def test_unreviewed_source_is_not_modified(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'file.c'
            original = b'#include <stringapiset.h>\n'
            file.write_bytes(original)
            with self.assertRaisesRegex(ValueError, 'preimage_changed'):
                patcher.prepare(file)
            self.assertEqual(file.read_bytes(), original)

    def test_wrong_postimage_is_rejected_before_write(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'file.c'
            original = b'#include <stringapiset.h>\n'
            file.write_bytes(original)
            with mock.patch.object(patcher, 'BEFORE', hashlib.sha256(original).hexdigest()):
                with self.assertRaisesRegex(ValueError, 'postimage_changed'):
                    patcher.prepare(file)
            self.assertEqual(file.read_bytes(), original)

    def test_generated_matching_fixture_changes_only_required_include_and_rejects_replay(self):
        original = b'/* generated test fixture, not NASM */\n#include <stringapiset.h>\n'
        expected = original.replace(b'#include <stringapiset.h>', b'#include <windows.h>\n#include <stringapiset.h>')
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'file.c'
            file.write_bytes(original)
            with mock.patch.object(patcher, 'BEFORE', hashlib.sha256(original).hexdigest()), mock.patch.object(patcher, 'AFTER', hashlib.sha256(expected).hexdigest()):
                patcher.prepare(file)
                self.assertEqual(file.read_bytes(), expected)
                with self.assertRaisesRegex(ValueError, 'preimage_changed'):
                    patcher.prepare(file)


if __name__ == '__main__':
    unittest.main()

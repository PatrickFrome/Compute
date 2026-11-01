"""Apply the one reviewed Windows SDK include repair to pinned NASM 3.02.

MultiByteToWideChar requires Windows.h before stringapiset.h:
https://learn.microsoft.com/en-us/windows/win32/api/stringapiset/nf-stringapiset-multibytetowidechar
The upstream archive pin is unchanged. Both source identities are recorded;
this is a patched source build, never an unchanged upstream binary claim.
"""
import argparse
import hashlib
from pathlib import Path

BEFORE = 'cecdbdb8652c0ae4cae9242920bb832faf43f451d6b4d92ff36872db4fa8805d'
AFTER = '13017582791687d52f575c03f216d208b8969ac960f026e9511129f11b779df4'


def prepare(file):
    file = Path(file)
    if file.is_symlink() or not file.is_file():
        raise ValueError('nasm_msvc_regular_source_required')
    before = file.read_bytes()
    if hashlib.sha256(before).hexdigest() != BEFORE:
        raise ValueError('nasm_msvc_source_preimage_changed')
    after = before.replace(b'#include <stringapiset.h>', b'#include <windows.h>\n#include <stringapiset.h>')
    if hashlib.sha256(after).hexdigest() != AFTER:
        raise ValueError('nasm_msvc_source_postimage_changed')
    file.write_bytes(after)
    if hashlib.sha256(file.read_bytes()).hexdigest() != AFTER:
        raise ValueError('nasm_msvc_source_write_changed')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-file', required=True)
    prepare(parser.parse_args().source_file)
    print('nasm_msvc_source_patch=' + BEFORE + ':' + AFTER)

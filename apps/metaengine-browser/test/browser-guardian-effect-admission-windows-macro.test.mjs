import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

test('actual admission header compiles with the Windows max macro and preserves that macro', {timeout:20000}, t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'guardian-admission-windows-macro-'));
  try {
    const header = fileURLToPath(new URL('../native/browser-guardian-scm/browser-guardian-effect-admission.hpp', import.meta.url)).replaceAll('\\', '/');
    const source = path.join(directory, 'windows-max.cpp');
    // Preload libstdc++ headers: unlike the Windows SDK/MSVC combination,
    // libstdc++ may undefine max during its own initial configuration. The
    // hostile macro must remain present while the production header is parsed.
    writeFileSync(source, `#include <atomic>
#include <cstdint>
#include <limits>
#include <type_traits>
#define max(a,b) (((a) > (b)) ? (a) : (b))
#include "${header}"
#ifndef max
#error Production admission header must preserve the Windows max macro
#endif
static_assert(max(2, 7) == 7);
static_assert(!std::is_default_constructible_v<metaengine::guardian::GuardianEffectAdmission>);
static_assert(!std::is_constructible_v<metaengine::guardian::GuardianEffectAdmission, bool>);
`);
    const result = spawnSync(process.env.CXX || 'g++', [
      '-std=c++20', '-Wall', '-Wextra', '-Werror', '-pedantic', '-fsyntax-only', source,
    ], {encoding:'utf8', timeout:15000});
    if (result.error?.code === 'ENOENT') {
      t.skip('portable C++ compiler unavailable; Windows native qualification remains separate');
      return;
    }
    assert.equal(result.status, 0, result.error?.message || result.stderr);
  } finally {
    rmSync(directory, {recursive:true, force:true});
  }
});

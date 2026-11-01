import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

// Test/build-host transport only. Callers obtain this fixed vcvars64.bat path
// from vswhere; this is not a general shell-command or target-runtime API.
export function vcvarsEnvironmentInvocation(vcvars) {
  assert.equal(typeof vcvars, 'string');
  assert.match(vcvars, /^[a-z]:[\\/]/i, 'compiler batch path must be drive-absolute');
  assert.doesNotMatch(vcvars, /[%!^"&|<>\0\r\n]/, 'unexpected shell metacharacter in compiler installation path');
  return {
    args: ['/d', '/s', '/c', `call "${vcvars}" >nul && set`],
    // cmd.exe parses this fixed command, not the C runtime argv grammar. Node's
    // default Windows quoting adds backslashes before its embedded quotes;
    // `call` then treats those backslashes as part of the batch filename.
    options: { encoding: 'utf8', windowsVerbatimArguments: true, timeout: 30_000 },
  };
}

export function captureVcvarsEnvironment(vcvars) {
  const { args, options } = vcvarsEnvironmentInvocation(vcvars);
  assert.ok(fs.statSync(vcvars).isFile(), 'vcvars64.bat must be an existing file');
  const output = execFileSync(process.env.ComSpec || 'cmd.exe', args, options);
  return Object.fromEntries(output.split(/\r?\n/).filter(line => line.indexOf('=') > 0).map(line => {
    const split = line.indexOf('=');
    return [line.slice(0, split), line.slice(split + 1)];
  }));
}

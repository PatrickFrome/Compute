import { spawn } from 'node:child_process';
import { basename, isAbsolute, normalize } from 'node:path';

const PROTOCOL_VERSION = 1;
const OPCODE_LIST_SKILLS = 1;
const OPCODE_READ_PACKAGE = 2;
const STATUS_OK = 0;
const STATUS_ERROR = 1;
const REQUEST_HEADER_BYTES = 12;
const RESPONSE_HEADER_BYTES = 12;
const MAX_SKILL_NAME_BYTES = 64;
const MAX_SKILL_COUNT = 128;
const MAX_PACKAGE_FILES = 65;
const MAX_PACKAGE_BYTES = (2 * 1024 * 1024) + (96 * 1024);
const MAX_SKILL_BYTES = 96 * 1024;
const MAX_RESOURCE_BYTES = 256 * 1024;
const MAX_RESOURCE_FILENAME_BYTES = 128;
const MAX_PACKAGE_PATH_BYTES = 139;
const MAX_ERROR_CODE_BYTES = 64;
const MAX_REQUEST_PAYLOAD_BYTES = REQUEST_HEADER_BYTES + 1 + MAX_SKILL_NAME_BYTES;
const MAX_RESPONSE_PAYLOAD_BYTES = RESPONSE_HEADER_BYTES
  + 2
  + MAX_PACKAGE_BYTES
  + MAX_PACKAGE_FILES * (2 + 1 + 4 + MAX_PACKAGE_PATH_BYTES);
const MIN_RESPONSE_PAYLOAD_BYTES = RESPONSE_HEADER_BYTES + 2;
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const MIN_REQUEST_TIMEOUT_MS = 100;
const MAX_REQUEST_TIMEOUT_MS = 30_000;
const MAX_U64 = (1n << 64n) - 1n;
const EXPECTED_LAUNCHER_BASENAME = 'a2-skill-source-launcher';

function adapterError(code, remoteCode = null) {
  const error = new Error(code);
  error.name = 'A2SkillSourceAdapterError';
  Object.defineProperty(error, 'code', { value: code, enumerable: true });
  if (remoteCode !== null) Object.defineProperty(error, 'remote_code', { value: remoteCode, enumerable: true });
  return error;
}

function validateAbsoluteNormalizedPath(value, code) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0') || !isAbsolute(value) || normalize(value) !== value) {
    throw adapterError(code);
  }
  return value;
}

function validateSkillName(value) {
  if (typeof value !== 'string' || Buffer.byteLength(value) > MAX_SKILL_NAME_BYTES) throw adapterError('skill_source_adapter_skill_name_invalid');
  if (!/^(?!-)(?!.*--)[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) throw adapterError('skill_source_adapter_skill_name_invalid');
  return value;
}

function validateRequestTimeout(value) {
  if (!Number.isSafeInteger(value) || value < MIN_REQUEST_TIMEOUT_MS || value > MAX_REQUEST_TIMEOUT_MS) {
    throw adapterError('skill_source_adapter_timeout_invalid');
  }
  return value;
}

function validatePackagePath(path) {
  if (path === 'SKILL.md') return true;
  if (typeof path !== 'string' || Buffer.byteLength(path) > MAX_PACKAGE_PATH_BYTES) return false;
  const slash = path.indexOf('/');
  if (slash <= 0 || path.indexOf('/', slash + 1) !== -1) return false;
  const directory = path.slice(0, slash);
  const filename = path.slice(slash + 1);
  if (!['assets', 'references', 'scripts'].includes(directory)) return false;
  if (!filename || Buffer.byteLength(filename) > MAX_RESOURCE_FILENAME_BYTES || filename.includes('..')) return false;
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(filename);
}

function framePayload(payload) {
  const frame = Buffer.allocUnsafe(4 + payload.length);
  frame.writeUInt32BE(payload.length, 0);
  payload.copy(frame, 4);
  return frame;
}

function encodeRequest(opcode, requestId, skillName = null) {
  const body = skillName === null ? Buffer.alloc(0) : Buffer.concat([Buffer.from([Buffer.byteLength(skillName)]), Buffer.from(skillName, 'ascii')]);
  const payload = Buffer.allocUnsafe(REQUEST_HEADER_BYTES + body.length);
  payload[0] = PROTOCOL_VERSION;
  payload[1] = opcode;
  payload.writeUInt16BE(0, 2);
  payload.writeBigUInt64BE(requestId, 4);
  body.copy(payload, REQUEST_HEADER_BYTES);
  if (payload.length > MAX_REQUEST_PAYLOAD_BYTES) throw adapterError('skill_source_adapter_request_too_large');
  return framePayload(payload);
}

class Decoder {
  constructor(bytes) {
    this.bytes = bytes;
    this.offset = 0;
  }

  take(length) {
    if (!Number.isSafeInteger(length) || length < 0) throw adapterError('skill_source_adapter_bad_response');
    const end = this.offset + length;
    if (!Number.isSafeInteger(end) || end > this.bytes.length) throw adapterError('skill_source_adapter_bad_response');
    const value = this.bytes.subarray(this.offset, end);
    this.offset = end;
    return value;
  }

  u8() { return this.take(1)[0]; }
  u16() { return this.take(2).readUInt16BE(0); }
  u32() { return this.take(4).readUInt32BE(0); }
  u64() { return this.take(8).readBigUInt64BE(0); }

  finish() {
    if (this.offset !== this.bytes.length) throw adapterError('skill_source_adapter_bad_response');
  }
}

function decodeAscii(bytes, validator) {
  const value = bytes.toString('ascii');
  if (!Buffer.from(value, 'ascii').equals(bytes) || !validator(value)) throw adapterError('skill_source_adapter_bad_response');
  return value;
}

function decodeRemoteError(decoder) {
  const length = decoder.u8();
  if (length < 1 || length > MAX_ERROR_CODE_BYTES) throw adapterError('skill_source_adapter_bad_response');
  const code = decodeAscii(decoder.take(length), (value) => /^[a-z0-9_]+$/.test(value));
  decoder.finish();
  return Object.freeze({ kind: 'remote_error', code });
}

function decodeSkillNames(decoder) {
  const count = decoder.u16();
  if (count > MAX_SKILL_COUNT) throw adapterError('skill_source_adapter_bad_response');
  const names = new Array(count);
  let previous = null;
  for (let index = 0; index < count; index += 1) {
    const length = decoder.u8();
    if (length < 1 || length > MAX_SKILL_NAME_BYTES) throw adapterError('skill_source_adapter_bad_response');
    const name = decodeAscii(decoder.take(length), (value) => {
      try {
        validateSkillName(value);
        return true;
      } catch {
        return false;
      }
    });
    if (previous !== null && previous >= name) throw adapterError('skill_source_adapter_bad_response');
    previous = name;
    names[index] = name;
  }
  decoder.finish();
  return Object.freeze(names);
}

function decodePackage(decoder) {
  const count = decoder.u16();
  if (count < 1 || count > MAX_PACKAGE_FILES) throw adapterError('skill_source_adapter_bad_response');
  const files = new Array(count);
  let previous = null;
  let totalBytes = 0;
  let sawSkill = false;

  for (let index = 0; index < count; index += 1) {
    const pathLength = decoder.u16();
    const executableByte = decoder.u8();
    const byteLength = decoder.u32();
    if (pathLength < 1 || pathLength > MAX_PACKAGE_PATH_BYTES || ![0, 1].includes(executableByte)) {
      throw adapterError('skill_source_adapter_bad_response');
    }
    const path = decodeAscii(decoder.take(pathLength), validatePackagePath);
    if (previous !== null && previous >= path) throw adapterError('skill_source_adapter_bad_response');
    previous = path;

    const isSkill = path === 'SKILL.md';
    const fileLimit = isSkill ? MAX_SKILL_BYTES : MAX_RESOURCE_BYTES;
    if (byteLength > fileLimit) throw adapterError('skill_source_adapter_bad_response');
    if (isSkill) {
      if (sawSkill || executableByte !== 0) throw adapterError('skill_source_adapter_bad_response');
      sawSkill = true;
    }
    totalBytes += byteLength;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_PACKAGE_BYTES) throw adapterError('skill_source_adapter_bad_response');
    const bytes = Buffer.from(decoder.take(byteLength));
    files[index] = Object.freeze({ path, type: 'file', executable: executableByte === 1, bytes });
  }

  if (!sawSkill) throw adapterError('skill_source_adapter_bad_response');
  decoder.finish();
  return Object.freeze(files);
}

function decodeResponse(payload, expectedOpcode, expectedRequestId) {
  const decoder = new Decoder(payload);
  const version = decoder.u8();
  const opcode = decoder.u8();
  const status = decoder.u8();
  const reserved = decoder.u8();
  const requestId = decoder.u64();
  if (version !== PROTOCOL_VERSION || opcode !== expectedOpcode || reserved !== 0 || requestId !== expectedRequestId) {
    throw adapterError('skill_source_adapter_bad_response');
  }
  if (status === STATUS_ERROR) return decodeRemoteError(decoder);
  if (status !== STATUS_OK) throw adapterError('skill_source_adapter_bad_response');
  const value = opcode === OPCODE_LIST_SKILLS ? decodeSkillNames(decoder) : decodePackage(decoder);
  return Object.freeze({ kind: 'ok', value });
}

export function createLinuxSkillSourceAdapter({ launcherPath, skillRoot, requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS } = {}) {
  if (process.platform !== 'linux') throw adapterError('skill_source_adapter_platform_unsupported');
  const executable = validateAbsoluteNormalizedPath(launcherPath, 'skill_source_adapter_launcher_path_invalid');
  if (basename(executable) !== EXPECTED_LAUNCHER_BASENAME) throw adapterError('skill_source_adapter_launcher_identity_invalid');
  const root = validateAbsoluteNormalizedPath(skillRoot, 'skill_source_adapter_skill_root_invalid');
  const timeoutMs = validateRequestTimeout(requestTimeoutMs);

  let child = null;
  let terminalCode = null;
  let pending = null;
  let stdoutBuffer = Buffer.alloc(0);
  let nextRequestId = 1n;

  function rejectPending(error) {
    if (!pending) return;
    const captured = pending;
    pending = null;
    clearTimeout(captured.timer);
    captured.reject(error);
  }

  function terminate(code) {
    if (terminalCode !== null) return;
    terminalCode = code;
    stdoutBuffer = Buffer.alloc(0);
    rejectPending(adapterError(code));
    if (child && child.exitCode === null && !child.killed) {
      try { child.kill('SIGKILL'); } catch { /* best-effort revocation */ }
    }
  }

  function onStdout(chunk) {
    if (terminalCode !== null) return;
    if (!pending) {
      terminate('skill_source_adapter_unsolicited_output');
      return;
    }
    if (!(chunk instanceof Buffer) || stdoutBuffer.length + chunk.length > 4 + MAX_RESPONSE_PAYLOAD_BYTES) {
      terminate('skill_source_adapter_response_too_large');
      return;
    }
    stdoutBuffer = stdoutBuffer.length === 0 ? Buffer.from(chunk) : Buffer.concat([stdoutBuffer, chunk]);
    if (stdoutBuffer.length < 4) return;
    const payloadLength = stdoutBuffer.readUInt32BE(0);
    if (payloadLength < MIN_RESPONSE_PAYLOAD_BYTES || payloadLength > MAX_RESPONSE_PAYLOAD_BYTES) {
      terminate('skill_source_adapter_frame_length_invalid');
      return;
    }
    const frameLength = 4 + payloadLength;
    if (stdoutBuffer.length < frameLength) return;
    if (stdoutBuffer.length !== frameLength) {
      terminate('skill_source_adapter_protocol_desynchronized');
      return;
    }

    const captured = pending;
    let decoded;
    try {
      decoded = decodeResponse(stdoutBuffer.subarray(4), captured.opcode, captured.requestId);
    } catch {
      terminate('skill_source_adapter_bad_response');
      return;
    }
    stdoutBuffer = Buffer.alloc(0);
    pending = null;
    clearTimeout(captured.timer);
    if (decoded.kind === 'remote_error') {
      captured.reject(adapterError('skill_source_adapter_remote_error', decoded.code));
    } else {
      captured.resolve(decoded.value);
    }
  }

  function startChild() {
    if (terminalCode !== null) throw adapterError(terminalCode);
    if (child) return child;
    try {
      child = spawn(executable, [root], {
        cwd: '/',
        env: {},
        shell: false,
        detached: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch {
      terminalCode = 'skill_source_adapter_spawn_failed';
      throw adapterError(terminalCode);
    }

    child.stdout.on('data', onStdout);
    child.stderr.on('data', (chunk) => {
      if (chunk.length > 0) terminate('skill_source_adapter_child_stderr');
    });
    child.stdin.on('error', () => terminate('skill_source_adapter_write_failed'));
    child.stdout.on('error', () => terminate('skill_source_adapter_read_failed'));
    child.stderr.on('error', () => terminate('skill_source_adapter_stderr_failed'));
    child.on('error', () => terminate('skill_source_adapter_spawn_failed'));
    child.on('exit', () => {
      if (terminalCode === null) terminate('skill_source_adapter_child_exited');
    });
    return child;
  }

  function allocateRequestId() {
    if (nextRequestId > MAX_U64) {
      terminate('skill_source_adapter_request_id_exhausted');
      throw adapterError('skill_source_adapter_request_id_exhausted');
    }
    const value = nextRequestId;
    nextRequestId += 1n;
    return value;
  }

  function transact(opcode, skillName = null) {
    if (terminalCode !== null) return Promise.reject(adapterError(terminalCode));
    if (pending) return Promise.reject(adapterError('skill_source_adapter_busy'));
    const requestId = allocateRequestId();
    const frame = encodeRequest(opcode, requestId, skillName);
    let processHandle;
    try {
      processHandle = startChild();
    } catch (error) {
      return Promise.reject(error);
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => terminate('skill_source_adapter_timeout'), timeoutMs);
      pending = { opcode, requestId, resolve, reject, timer };
      try {
        processHandle.stdin.write(frame, (error) => {
          if (error) terminate('skill_source_adapter_write_failed');
        });
      } catch {
        terminate('skill_source_adapter_write_failed');
      }
    });
  }

  async function listSkillNames() {
    return transact(OPCODE_LIST_SKILLS);
  }

  async function readSkillPackage(skillNameInput) {
    const name = validateSkillName(skillNameInput);
    return transact(OPCODE_READ_PACKAGE, name);
  }

  function close() {
    if (terminalCode !== null) return;
    terminate('skill_source_adapter_closed');
  }

  return Object.freeze({ listSkillNames, readSkillPackage, close });
}

export const SKILL_SOURCE_ADAPTER_LIMITS = Object.freeze({
  maxSkillNameBytes: MAX_SKILL_NAME_BYTES,
  maxSkillCount: MAX_SKILL_COUNT,
  maxPackageFiles: MAX_PACKAGE_FILES,
  maxPackageBytes: MAX_PACKAGE_BYTES,
  maxResponsePayloadBytes: MAX_RESPONSE_PAYLOAD_BYTES,
  minRequestTimeoutMs: MIN_REQUEST_TIMEOUT_MS,
  maxRequestTimeoutMs: MAX_REQUEST_TIMEOUT_MS
});

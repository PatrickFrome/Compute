import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const SUPERVISOR_DEVICE_PROFILE = 'A2_DEVICE_HTTP_SIGNATURE_V1';
export const ENROLLMENT_SIGNATURE_PROFILE = 'METAENGINE_NATIVE_ENROLLMENT_V1';

function canonicalPublicJwk(value = {}) {
  const jwk = {
    crv: String(value.crv || ''),
    ext: true,
    key_ops: ['verify'],
    kty: String(value.kty || ''),
    x: String(value.x || ''),
    y: String(value.y || ''),
  };
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !/^[A-Za-z0-9_-]{43}$/.test(jwk.x) || !/^[A-Za-z0-9_-]{43}$/.test(jwk.y)) {
    throw new Error('supervisor_device_public_jwk_invalid');
  }
  return jwk;
}

function fingerprintFor(jwk) {
  return crypto.createHash('sha256').update(JSON.stringify(jwk)).digest('hex');
}

function atomicStateShape(value) {
  return {
    schema: 'metaengine.native-supervisor.device-identity.v1',
    profile: SUPERVISOR_DEVICE_PROFILE,
    client_id: String(value.client_id || ''),
    public_jwk: canonicalPublicJwk(value.public_jwk),
    key_fingerprint_sha256: String(value.key_fingerprint_sha256 || ''),
    encrypted_private_key_b64: String(value.encrypted_private_key_b64 || ''),
    enrollment_request_id: value.enrollment_request_id ? String(value.enrollment_request_id) : null,
    device_id: value.device_id ? String(value.device_id) : null,
    created_at: value.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

export class SupervisorDeviceIdentity {
  #statePath;
  #secureStorage;
  #state = null;
  #privateKey = null;

  constructor({ statePath, secureStorage }) {
    if (!statePath) throw new Error('supervisor_device_state_path_required');
    if (!secureStorage) throw new Error('supervisor_secure_storage_required');
    this.#statePath = statePath;
    this.#secureStorage = secureStorage;
  }

  async #persist(next) {
    const shaped = atomicStateShape(next);
    const dir = path.dirname(this.#statePath);
    const temp = `${this.#statePath}.tmp`;
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(temp, `${JSON.stringify(shaped, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temp, this.#statePath);
    this.#state = shaped;
    return this.snapshot();
  }

  async #loadExisting() {
    let raw;
    try { raw = JSON.parse(await fs.readFile(this.#statePath, 'utf8')); }
    catch (error) {
      if (error?.code === 'ENOENT' || error instanceof SyntaxError) return null;
      throw error;
    }
    const state = atomicStateShape(raw);
    if (!/^[0-9a-f-]{36}$/i.test(state.client_id)) throw new Error('supervisor_device_client_id_invalid');
    if (state.key_fingerprint_sha256 !== fingerprintFor(state.public_jwk)) throw new Error('supervisor_device_fingerprint_mismatch');
    if (!state.encrypted_private_key_b64) throw new Error('supervisor_device_private_key_missing');
    if (typeof this.#secureStorage.isEncryptionAvailable === 'function' && this.#secureStorage.isEncryptionAvailable() !== true) {
      throw new Error('supervisor_secure_storage_unavailable');
    }
    const encrypted = Buffer.from(state.encrypted_private_key_b64, 'base64');
    const privatePem = this.#secureStorage.decryptString(encrypted);
    this.#privateKey = crypto.createPrivateKey(privatePem);
    this.#state = state;
    return this.snapshot();
  }

  async ensure() {
    if (this.#state && this.#privateKey) return this.snapshot();
    const existing = await this.#loadExisting();
    if (existing) return existing;
    if (typeof this.#secureStorage.isEncryptionAvailable === 'function' && this.#secureStorage.isEncryptionAvailable() !== true) {
      throw new Error('supervisor_secure_storage_unavailable');
    }
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const publicJwk = canonicalPublicJwk(publicKey.export({ format: 'jwk' }));
    const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    const encrypted = this.#secureStorage.encryptString(String(privatePem));
    this.#privateKey = privateKey;
    return this.#persist({
      client_id: crypto.randomUUID(),
      public_jwk: publicJwk,
      key_fingerprint_sha256: fingerprintFor(publicJwk),
      encrypted_private_key_b64: Buffer.from(encrypted).toString('base64'),
      enrollment_request_id: null,
      device_id: null,
      created_at: new Date().toISOString(),
    });
  }

  snapshot() {
    if (!this.#state) return null;
    const { encrypted_private_key_b64: _secret, ...safe } = this.#state;
    return structuredClone({ ...safe, enrolled: Boolean(this.#state.device_id) });
  }

  async bindEnrollmentRequest(requestId) {
    await this.ensure();
    return this.#persist({ ...this.#state, enrollment_request_id: String(requestId || ''), device_id: null });
  }

  async clearEnrollmentRequest() {
    await this.ensure();
    return this.#persist({ ...this.#state, enrollment_request_id: null });
  }

  async bindDevice(deviceId) {
    await this.ensure();
    if (!/^[0-9a-f-]{36}$/i.test(String(deviceId || ''))) throw new Error('supervisor_device_id_invalid');
    return this.#persist({ ...this.#state, device_id: String(deviceId), enrollment_request_id: null });
  }

  #sign(material) {
    if (!this.#privateKey) throw new Error('supervisor_private_key_not_loaded');
    return crypto.sign('sha256', Buffer.from(material, 'utf8'), {
      key: this.#privateKey,
      dsaEncoding: 'ieee-p1363',
    }).toString('base64url');
  }

  randomNonce() { return crypto.randomBytes(24).toString('base64url'); }

  async enrollmentHeaders(bodyText, { timestamp = new Date().toISOString(), nonce = this.randomNonce() } = {}) {
    await this.ensure();
    const bodyHash = crypto.createHash('sha256').update(String(bodyText || '')).digest('hex');
    const material = [
      ENROLLMENT_SIGNATURE_PROFILE,
      `client_id:${this.#state.client_id}`,
      `profile:${SUPERVISOR_DEVICE_PROFILE}`,
      `fingerprint:${this.#state.key_fingerprint_sha256}`,
      `timestamp:${timestamp}`,
      `nonce:${nonce}`,
      `body_sha256:${bodyHash}`,
    ].join('\n');
    return {
      'content-type': 'application/json',
      'x-a2-chat-bridge-client': this.#state.client_id,
      'x-metaengine-enroll-timestamp': timestamp,
      'x-metaengine-enroll-nonce': nonce,
      'x-metaengine-enroll-signature': this.#sign(material),
    };
  }

  async deviceHeaders(method, requestPath, bodyText, { timestamp = new Date().toISOString(), nonce = this.randomNonce() } = {}) {
    await this.ensure();
    if (!this.#state.device_id) throw new Error('supervisor_device_not_enrolled');
    const bodyHash = crypto.createHash('sha256').update(String(bodyText || '')).digest('hex');
    const material = [
      SUPERVISOR_DEVICE_PROFILE,
      `device_id:${this.#state.device_id}`,
      `method:${String(method || 'GET').toUpperCase()}`,
      `path:${String(requestPath)}`,
      `timestamp:${timestamp}`,
      `nonce:${nonce}`,
      `body_sha256:${bodyHash}`,
    ].join('\n');
    return {
      'content-type': 'application/json',
      'x-a2-chat-bridge-client': this.#state.client_id,
      'x-a2-device-profile': SUPERVISOR_DEVICE_PROFILE,
      'x-a2-device-id': this.#state.device_id,
      'x-a2-device-timestamp': timestamp,
      'x-a2-device-nonce': nonce,
      'x-a2-device-body-sha256': bodyHash,
      'x-a2-device-signature': this.#sign(material),
    };
  }
}

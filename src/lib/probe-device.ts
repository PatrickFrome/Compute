/**
 * MC Console probe device — a real METAENGINE device identity living server-side.
 *
 * Purpose: the console must exercise CANONICAL edge routes that require device
 * auth (wait-emergency T8, cognitive-delta T9/T10) without a live operator
 * browser. This module enrolls a persistent P-256 device through the same
 * enrollment proof → operator gate → activation flow as test-e2e.ts, then
 * signs every request per A2_DEVICE_HTTP_SIGNATURE_V1.
 *
 * Identity is file-persisted at ~/.a2/mc-probe-device.json (0600) so the
 * device survives dev-server restarts. The operator-gate approval is executed
 * server-side against the local Pigsty (local contour rehearsal only — in the
 * cloud the gate is a human decision).
 */
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { query } from "@/lib/pg";

const EDGE = "http://127.0.0.1:3031";
const MARKER = "/a2-browser-native-supervisor-v1";
const PROFILE = "A2_DEVICE_HTTP_SIGNATURE_V1";
const WORKSPACE_ID = "2de9f84b-7c0a-4091-911c-894ff1d6eaf4";
const IDENTITY_PATH = "/home/z/.a2/mc-probe-device.json";

const enc = new TextEncoder();

function b64u(buf: ArrayBuffer | Uint8Array): string {
  return Buffer.from(new Uint8Array(buf as Uint8Array)).toString("base64url");
}
function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function sha256(v: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", enc.encode(v)));
}

export interface ProbeIdentity {
  clientId: string;
  deviceId: string;
  fingerprint: string;
  publicJwk: { crv: string; ext: boolean; key_ops: string[]; kty: string; x: string; y: string };
  privateJwk: Record<string, string>;
  streamId: string;
  streamSeq: number;
  createdAt: string;
}

const globalForProbe = globalThis as unknown as {
  __mcProbeIdentity?: ProbeIdentity | null;
  __mcProbeKey?: CryptoKey | null;
};

async function importPrivateJwk(jwk: Record<string, string>): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    jwk as unknown as JsonWebKey,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

async function enrollFresh(): Promise<ProbeIdentity> {
  const kp = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const pubRaw = (await crypto.subtle.exportKey("jwk", kp.publicKey)) as Record<string, string>;
  // key order MUST match edge canonicalJwk: {crv,ext,key_ops,kty,x,y}
  const publicJwk = {
    crv: "P-256",
    ext: true,
    key_ops: ["verify"],
    kty: "EC",
    x: pubRaw.x as string,
    y: pubRaw.y as string,
  };
  const fingerprint = await sha256(JSON.stringify(publicJwk));
  const clientId = `mc-console-probe`;

  // Self-heal: a previous probe identity may still own the ACTIVE device slot
  // for this client (e.g. after a sandbox reset lost the identity file while
  // the Pigsty replica kept the row). Revoke stale ACTIVE devices for the
  // client so the per-client unique active-device index accepts the fresh
  // enrollment. Console-side revocation is legitimate here: the console is
  // the operator-gate executor on the local contour anyway.
  try {
    await query(
      `update public.compute_fabric_a2_browser_device_h205f22
          set active=false, revoked_at=now()
        where client_id=$1 and active=true and revoked_at is null`,
      [clientId],
    );
  } catch {
    // best effort — proceed to enrollment; the edge will fail loudly if not
  }
  const privateJwk = (await crypto.subtle.exportKey("jwk", kp.privateKey)) as unknown as Record<
    string,
    string
  >;

  async function signEnroll(path: string, bodyText: string, ts: string, nonce: string) {
    const material = [
      "METAENGINE_NATIVE_ENROLLMENT_V1",
      `client_id:${clientId}`,
      `profile:${PROFILE}`,
      `fingerprint:${fingerprint}`,
      `timestamp:${ts}`,
      `nonce:${nonce}`,
      `body_sha256:${await sha256(bodyText)}`,
    ].join("\n");
    return crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, kp.privateKey, enc.encode(material));
  }

  // 1) enrollment request through canonical edge route
  const reqBody = JSON.stringify({
    public_jwk: publicJwk,
    profile: PROFILE,
    key_fingerprint_sha256: fingerprint,
    metadata: { shell_version: "0.7.0-dev.35532004761.1", client_kind: "MC_CONSOLE_PROBE" },
  });
  let ts = new Date().toISOString();
  let nonce = b64u(crypto.getRandomValues(new Uint8Array(24)));
  let res = await fetch(`${EDGE}${MARKER}/v1/device/enrollment/request`, {
    signal: AbortSignal.timeout(6_000),
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-a2-chat-bridge-client": clientId,
      "x-metaengine-enroll-timestamp": ts,
      "x-metaengine-enroll-nonce": nonce,
      "x-metaengine-enroll-signature": b64u(await signEnroll("/v1/device/enrollment/request", reqBody, ts, nonce)),
    },
    body: reqBody,
  });
  const reqJson = (await res.json()) as { request_id?: string; accepted?: boolean };
  if (res.status !== 202 || !reqJson.request_id) {
    throw new Error(`probe enrollment failed: HTTP ${res.status} ${JSON.stringify(reqJson).slice(0, 200)}`);
  }

  // 2) operator gate — server-side approval against local Pigsty (rehearsal contour)
  const upd = await query(
    `update public.compute_fabric_a2_browser_device_enrollment_request_h205f22
       set status='APPROVED', approved_at=now()
     where request_id=$1 and status='PENDING' returning request_id`,
    [reqJson.request_id],
  );
  if (upd.rowCount !== 1) throw new Error("probe operator-gate approve failed");

  // 3) activation → one-time pairing token consumed by edge RPC
  const actBody = JSON.stringify({
    request_id: reqJson.request_id,
    public_jwk: publicJwk,
    profile: PROFILE,
    key_fingerprint_sha256: fingerprint,
  });
  ts = new Date().toISOString();
  nonce = b64u(crypto.getRandomValues(new Uint8Array(24)));
  res = await fetch(`${EDGE}${MARKER}/v1/device/enrollment/status`, {
    signal: AbortSignal.timeout(6_000),
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-a2-chat-bridge-client": clientId,
      "x-metaengine-enroll-timestamp": ts,
      "x-metaengine-enroll-nonce": nonce,
      "x-metaengine-enroll-signature": b64u(await signEnroll("/v1/device/enrollment/status", actBody, ts, nonce)),
    },
    body: actBody,
  });
  const actJson = (await res.json()) as { accepted?: boolean; device_id?: string };
  if (res.status !== 200 || actJson.accepted !== true || !actJson.device_id) {
    throw new Error(`probe activation failed: HTTP ${res.status} ${JSON.stringify(actJson).slice(0, 200)}`);
  }

  // stable uuidv4-format stream id for cognitive bus (random, valid v4)
  const streamId = crypto.randomUUID();

  const identity: ProbeIdentity = {
    clientId,
    deviceId: actJson.device_id,
    fingerprint,
    publicJwk,
    privateJwk: privateJwk as Record<string, string>,
    streamId,
    streamSeq: 0,
    createdAt: new Date().toISOString(),
  };
  try {
    writeFileSync(IDENTITY_PATH, JSON.stringify(identity, null, 2), { mode: 0o600 });
  } catch {
    // non-fatal: identity lives in module cache for this process
  }
  return identity;
}

export async function getProbeDevice(): Promise<ProbeIdentity> {
  if (globalForProbe.__mcProbeIdentity) return globalForProbe.__mcProbeIdentity;
  if (existsSync(IDENTITY_PATH)) {
    try {
      const identity = JSON.parse(readFileSync(IDENTITY_PATH, "utf8")) as ProbeIdentity;
      globalForProbe.__mcProbeKey = await importPrivateJwk(identity.privateJwk);
      globalForProbe.__mcProbeIdentity = identity;
      return identity;
    } catch {
      // corrupted file → re-enroll
    }
  }
  const identity = await enrollFresh();
  globalForProbe.__mcProbeIdentity = identity;
  globalForProbe.__mcProbeKey = await importPrivateJwk(identity.privateJwk);
  return identity;
}

export async function resetProbeDevice(): Promise<void> {
  // revoke current device (if any) and wipe the identity file
  const prev = globalForProbe.__mcProbeIdentity;
  if (prev?.deviceId) {
    try {
      await query(
        `update public.compute_fabric_a2_browser_device_h205f22 set revoked_at=now(), active=false where device_id=$1`,
        [prev.deviceId],
      );
    } catch {
      // table/columns may differ — best effort
    }
  }
  globalForProbe.__mcProbeIdentity = null;
  globalForProbe.__mcProbeKey = null;
  try {
    if (existsSync(IDENTITY_PATH)) rmSync(IDENTITY_PATH);
  } catch {
    // ignore
  }
}

export function probeWorkspaceId(): string {
  return WORKSPACE_ID;
}

/** Allocate the next cognitive batch range on the probe's persistent stream. */
export function nextCognitiveRange(identity: ProbeIdentity, eventCount: number): {
  afterSequence: number;
  throughSequence: number;
} {
  const afterSequence = identity.streamSeq;
  const throughSequence = afterSequence + eventCount;
  identity.streamSeq = throughSequence;
  try {
    writeFileSync(IDENTITY_PATH, JSON.stringify(identity, null, 2), { mode: 0o600 });
  } catch {
    // module cache still consistent for this process
  }
  return { afterSequence, throughSequence };
}

/** Signed device headers for POST to a canonical edge route (full path with marker). */
export async function signDeviceRequest(
  identity: ProbeIdentity,
  routePath: string,
  bodyText: string,
): Promise<Record<string, string>> {
  if (!globalForProbe.__mcProbeKey) {
    globalForProbe.__mcProbeKey = await importPrivateJwk(identity.privateJwk);
  }
  const key = globalForProbe.__mcProbeKey!;
  const bodyHash = await sha256(bodyText);
  const ts = new Date().toISOString();
  const nonce = b64u(crypto.getRandomValues(new Uint8Array(24)));
  const material = [
    PROFILE,
    `device_id:${identity.deviceId}`,
    `method:POST`,
    `path:${MARKER}${routePath}`,
    `timestamp:${ts}`,
    `nonce:${nonce}`,
    `body_sha256:${bodyHash}`,
  ].join("\n");
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(material));
  return {
    "content-type": "application/json",
    "x-a2-chat-bridge-client": identity.clientId,
    "x-a2-device-profile": PROFILE,
    "x-a2-device-id": identity.deviceId,
    "x-a2-device-timestamp": ts,
    "x-a2-device-nonce": nonce,
    "x-a2-device-body-sha256": bodyHash,
    "x-a2-device-signature": b64u(sig),
  };
}

/** Signed POST through the canonical edge; returns {status, json, ms}. */
export async function edgeDevicePost(
  routePath: string,
  body: unknown,
): Promise<{ status: number; json: Record<string, unknown>; ms: number }> {
  const identity = await getProbeDevice();
  const bodyText = JSON.stringify(body);
  const headers = await signDeviceRequest(identity, routePath, bodyText);
  const t0 = Date.now();
  const res = await fetch(`${EDGE}${MARKER}${routePath}`, { signal: AbortSignal.timeout(8_000), method: "POST", headers, body: bodyText });
  let json: Record<string, unknown>;
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    json = { parse_error: true };
  }
  return { status: res.status, json, ms: Date.now() - t0 };
}

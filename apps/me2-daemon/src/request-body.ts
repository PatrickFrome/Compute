import type { IncomingMessage } from "node:http";

export const MAX_REQUEST_BODY_BYTES = 1024 * 1024;
const BODY_TIMEOUT_MS = 10_000;

export class RequestBodyError extends Error {
  readonly statusCode: number;
  constructor(statusCode: number, message: string) { super(message); this.statusCode = statusCode; }
}

/** Rejected uploads are drained without buffering, allowing an HTTP error on
 * the same socket. Both declared size and received bytes are bounded.
 */
const bodies = new WeakMap<IncomingMessage, Promise<Buffer>>();

export function readBoundedBody(req: IncomingMessage): Promise<Buffer> {
  const existing = bodies.get(req);
  if (existing) return existing;
  const body = readOnce(req);
  bodies.set(req, body);
  return body;
}

function readOnce(req: IncomingMessage): Promise<Buffer> {
  const length = req.headers["content-length"];
  if (length !== undefined && (typeof length !== "string" || !/^\d+$/.test(length))) {
    req.resume();
    return Promise.reject(new RequestBodyError(400, "invalid_content_length"));
  }
  if (length !== undefined && Number(length) > MAX_REQUEST_BODY_BYTES) {
    req.resume();
    return Promise.reject(new RequestBodyError(413, "request_body_too_large"));
  }
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks: Buffer[] = [];
    const cleanup = () => {
      clearTimeout(timer);
      req.off("data", onData); req.off("end", onEnd);
      req.off("error", onError); req.off("aborted", onAborted);
    };
    const fail = (error: Error) => {
      cleanup(); chunks.length = 0;
      // An aborted HTTP stream can emit its socket error after `aborted`.
      req.once("error", () => {});
      req.resume(); reject(error);
    };
    const onError = () => fail(new RequestBodyError(400, "request_body_read_failed"));
    const onAborted = () => fail(new RequestBodyError(400, "request_body_aborted"));
    const onData = (value: Buffer | string) => {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      bytes += chunk.length;
      if (bytes > MAX_REQUEST_BODY_BYTES) return fail(new RequestBodyError(413, "request_body_too_large"));
      chunks.push(chunk);
    };
    const onEnd = () => {
      cleanup();
      resolve(Buffer.concat(chunks, bytes));
    };
    const timer = setTimeout(() => fail(new RequestBodyError(408, "request_body_timeout")), BODY_TIMEOUT_MS);
    timer.unref();
    req.on("data", onData); req.once("end", onEnd); req.once("error", onError); req.once("aborted", onAborted);
  });
}

export async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const bytes = await readBoundedBody(req);
  if (!bytes.length) return {};
  try {
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("object_required");
    return value as Record<string, unknown>;
  } catch { throw new RequestBodyError(400, "invalid_json_object"); }
}

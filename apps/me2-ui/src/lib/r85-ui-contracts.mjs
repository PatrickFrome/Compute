// R85 pure UI contracts shared by the renderer and Node regression tests.
// Keep this module side-effect free so identity/causal fencing can be tested
// without mounting React or Electron.

/**
 * @param {string} value
 */
function escapeRegExp(value) {
  return String(value).replace(/[.*+?^\${}()|[\]\\]/g, "\\$&");
}

/**
 * Exact session identity match inside a z.ai URL. Title similarity is
 * intentionally not part of the identity contract.
 *
 * @param {string} rawUrl
 * @param {string} rawSessionId
 */
export function zAiUrlContainsExactSession(rawUrl, rawSessionId) {
  const sessionId = String(rawSessionId ?? "").trim().toLowerCase();
  if (!sessionId) return false;
  let url;
  try {
    url = new URL(String(rawUrl ?? ""));
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (!(host === "z.ai" || host.endsWith(".z.ai"))) return false;
  if (!(url.protocol === "https:" || url.protocol === "http:")) return false;

  let decoded = url.href.toLowerCase();
  try { decoded = decodeURIComponent(decoded); } catch { /* malformed encoding */ }
  const escaped = escapeRegExp(sessionId);
  const identity = new RegExp(\`(?:^|[^a-z0-9_-])\${escaped}(?:$|[^a-z0-9_-])\`, "i");
  return identity.test(decoded);
}

/**
 * @param {Array<{id:string,url?:string|null,title?:string|null}>} tabs
 * @param {string} sessionId
 * @returns {{kind:"exact",tab:any}|{kind:"ambiguous",matches:any[]}|{kind:"missing",zai:any[]}}
 */
export function resolveExactAgentTab(tabs, sessionId) {
  const list = Array.isArray(tabs) ? tabs : [];
  const zai = list.filter((tab) => {
    try {
      const url = new URL(String(tab?.url ?? ""));
      const host = url.hostname.toLowerCase();
      return host === "z.ai" || host.endsWith(".z.ai");
    } catch {
      return false;
    }
  });
  const matches = zai.filter((tab) => zAiUrlContainsExactSession(tab?.url ?? "", sessionId));
  if (matches.length === 1) return { kind: "exact", tab: matches[0] };
  if (matches.length > 1) return { kind: "ambiguous", matches };
  return { kind: "missing", zai };
}

/**
 * Late IPC responses are accepted only if they still belong to the same
 * sequence, workspace and page that originated the request.
 *
 * @param {{seq:number,workspace:string,page:string}} request
 * @param {{seq:number,workspace:string,page:string}} current
 */
export function presentationSyncStillCurrent(request, current) {
  return Number(request?.seq) === Number(current?.seq)
    && String(request?.workspace ?? "") === String(current?.workspace ?? "")
    && String(request?.page ?? "") === String(current?.page ?? "");
}

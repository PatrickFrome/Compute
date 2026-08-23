export const LESSONS = Object.freeze([
  {
    id: "L-0001",
    name: "AUTHORITY_PLANE_CONFLATION",
    rule: "Project authority may be granted only from a live project claim; AOP run and PAP transport are separate planes.",
  },
  {
    id: "L-0010",
    name: "WITNESS_ASSERTION_IS_NOT_IDENTITY",
    rule: "Client-provided witness identity assertions never grant worker identity or admission authority.",
  },
  {
    id: "L-0011",
    name: "EVIDENCE_CLASS_OVERCLAIM",
    rule: "Do not claim percentages without numerator/denominator and do not claim SAME_WORLD/durability as independently verified from this worker.",
  },
  {
    id: "LAW-2",
    name: "NO_PROJECT_AUTHORITY",
    rule: "Autonomous coordination output is PREPARED only, canonical=false, authority_effect=false.",
  },
]);

export const TRANSITIONS = Object.freeze({
  PROPOSAL: new Set(["ATTACK", "ACCEPT"]),
  ATTACK: new Set(["FIX", "REBUTTAL"]),
  FIX: new Set(["RECHECK"]),
  REVIEW: new Set(["REVIEW"]),
});

const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bsbp_[A-Za-z0-9]{20,}\b/,
  /\bsb_secret_[A-Za-z0-9_-]{20,}\b/,
  /\bcfat_[A-Za-z0-9]{20,}\b/,
  /\bcfut_[A-Za-z0-9]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /eyJhbGciOi[A-Za-z0-9_-]{20,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/,
];

const NARROW_OVERCLAIM_PATTERNS = [
  /peer\s+catch\s+rate\s*[:=]?\s*100\s*%/i,
  /repeat\s+defect\s+rate\s*[:=]?\s*0\s*%/i,
  /machine[-_ ]verified\s+same[-_ ]world/i,
  /(?:durability|durable)\s+(?:is\s+)?(?:verified|proven)/i,
  /run\s+lease\s*(?:=|is|implies|grants)\s*(?:project\s+)?(?:claim\s+)?authority/i,
];

export function looksLikeSecret(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

export function hashableGuardSummary(blockedBy) {
  return [...new Set(blockedBy)].sort();
}

export function allowedReplyKinds(incomingKind) {
  return TRANSITIONS[incomingKind] ?? new Set();
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function validateAssertion(assertion, blockedBy) {
  if (!assertion || typeof assertion !== "object") {
    blockedBy.push("SCHEMA_ASSERTION");
    return;
  }

  const topic = assertion.topic;
  const effect = assertion.effect;
  const sourcePlane = assertion.source_plane;

  if (
    topic === "PROJECT_AUTHORITY" &&
    effect === "GRANTS" &&
    sourcePlane !== "PROJECT_CLAIM"
  ) {
    blockedBy.push("L-0001");
  }

  if (
    topic === "WITNESS_IDENTITY" &&
    effect === "GRANTS" &&
    assertion.identity_source === "CLIENT_ASSERTION"
  ) {
    blockedBy.push("L-0010");
  }

  if (topic === "METRIC" && /%|\brate\b/i.test(String(assertion.statement ?? ""))) {
    if (!isFiniteNumber(assertion.metric_numerator) || !isFiniteNumber(assertion.metric_denominator) || assertion.metric_denominator <= 0) {
      blockedBy.push("L-0011");
    }
  }

  if (assertion.evidence_state === "INDEPENDENTLY_REPRODUCED" || assertion.evidence_state === "VERIFIED") {
    blockedBy.push("L-0011");
  }
}

export function evaluateDecision(decision, incoming) {
  const blockedBy = [];

  if (!decision || typeof decision !== "object") {
    return { ok: false, blockedBy: ["SCHEMA_DECISION"] };
  }

  const mode = decision.decision;
  if (!new Set(["NO_OP", "PUBLISH_ENVELOPE"]).has(mode)) {
    blockedBy.push("SCHEMA_DECISION_MODE");
  }

  if (incoming?.requires_response === true && mode === "NO_OP") {
    blockedBy.push("RESPONSE_REQUIRED");
  }

  if (mode === "PUBLISH_ENVELOPE") {
    const allowed = allowedReplyKinds(String(incoming?.kind ?? ""));
    if (!allowed.has(decision.kind)) {
      blockedBy.push("RESPONSE_CONTRACT");
    }
    if (typeof decision.content !== "string" || decision.content.length < 1 || decision.content.length > 20_000) {
      blockedBy.push("CONTENT_LENGTH");
    }
  }

  const assertions = Array.isArray(decision.assertions) ? decision.assertions : [];
  for (const assertion of assertions) validateAssertion(assertion, blockedBy);

  const serialized = JSON.stringify(decision);
  if (looksLikeSecret(serialized)) blockedBy.push("SECRET_SCAN");
  for (const pattern of NARROW_OVERCLAIM_PATTERNS) {
    if (pattern.test(String(decision.content ?? ""))) blockedBy.push("L-0011");
  }

  return {
    ok: blockedBy.length === 0,
    blockedBy: hashableGuardSummary(blockedBy),
  };
}

export function responseRequiresReply(kind) {
  return kind === "ATTACK" || kind === "FIX" || kind === "PROPOSAL";
}

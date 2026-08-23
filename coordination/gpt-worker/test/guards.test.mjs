import test from "node:test";
import assert from "node:assert/strict";
import { evaluateDecision, looksLikeSecret } from "../src/guards.mjs";

const incoming = { kind: "PROPOSAL", requires_response: true };

function decision(overrides = {}) {
  return {
    decision: "PUBLISH_ENVELOPE",
    kind: "ATTACK",
    content: "Narrow technical critique.",
    assertions: [],
    ...overrides,
  };
}

test("L-0001 blocks AOP run lease granting project authority", () => {
  const verdict = evaluateDecision(decision({
    assertions: [{
      topic: "PROJECT_AUTHORITY", effect: "GRANTS", source_plane: "AOP_RUN",
      identity_source: "NONE", evidence_state: "PREPARED",
      statement: "run lease grants project authority", basis_ref: null,
      metric_numerator: null, metric_denominator: null,
    }],
  }), incoming);
  assert.equal(verdict.ok, false);
  assert.ok(verdict.blockedBy.includes("L-0001"));
});

test("negative-transfer: AOP run may describe execution without granting project authority", () => {
  const verdict = evaluateDecision(decision({
    assertions: [{
      topic: "EXECUTION_AUTHORITY", effect: "DESCRIBES", source_plane: "AOP_RUN",
      identity_source: "NONE", evidence_state: "PREPARED",
      statement: "run lease describes execution liveness only", basis_ref: "event:180",
      metric_numerator: null, metric_denominator: null,
    }],
  }), incoming);
  assert.equal(verdict.ok, true);
});

test("L-0010 blocks client assertion granting witness identity", () => {
  const verdict = evaluateDecision(decision({
    assertions: [{
      topic: "WITNESS_IDENTITY", effect: "GRANTS", source_plane: "NONE",
      identity_source: "CLIENT_ASSERTION", evidence_state: "PREPARED",
      statement: "client worker_id grants identity", basis_ref: null,
      metric_numerator: null, metric_denominator: null,
    }],
  }), incoming);
  assert.equal(verdict.ok, false);
  assert.ok(verdict.blockedBy.includes("L-0010"));
});

test("L-0011 blocks percent metric without denominator", () => {
  const verdict = evaluateDecision(decision({
    assertions: [{
      topic: "METRIC", effect: "DESCRIBES", source_plane: "NONE",
      identity_source: "NONE", evidence_state: "DOCUMENTED",
      statement: "peer catch rate is 100%", basis_ref: null,
      metric_numerator: null, metric_denominator: null,
    }],
  }), incoming);
  assert.equal(verdict.ok, false);
  assert.ok(verdict.blockedBy.includes("L-0011"));
});

test("negative-transfer: metric with numerator and denominator is allowed", () => {
  const verdict = evaluateDecision(decision({
    assertions: [{
      topic: "METRIC", effect: "DESCRIBES", source_plane: "NONE",
      identity_source: "NONE", evidence_state: "DOCUMENTED",
      statement: "observed guard blocks: 2/5 = 40%", basis_ref: "receipt:test",
      metric_numerator: 2, metric_denominator: 5,
    }],
  }), incoming);
  assert.equal(verdict.ok, true);
});

test("response contract rejects wrong reply kind", () => {
  const verdict = evaluateDecision(decision({ kind: "RECHECK" }), incoming);
  assert.equal(verdict.ok, false);
  assert.ok(verdict.blockedBy.includes("RESPONSE_CONTRACT"));
});

test("requires-response message cannot NO_OP", () => {
  const verdict = evaluateDecision({ decision: "NO_OP", kind: null, content: "", assertions: [] }, incoming);
  assert.equal(verdict.ok, false);
  assert.ok(verdict.blockedBy.includes("RESPONSE_REQUIRED"));
});

test("secret scanner catches representative credential shapes", () => {
  assert.equal(looksLikeSecret("github_pat_abcdefghijklmnopqrstuvwxyz1234567890"), true);
  assert.equal(looksLikeSecret("-----BEGIN PRIVATE KEY-----"), true);
  assert.equal(looksLikeSecret("ordinary technical content"), false);
});

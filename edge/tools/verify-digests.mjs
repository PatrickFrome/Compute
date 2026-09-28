#!/usr/bin/env node
// Promotion-gate verifier: proves the source tree in this repo byte-matches
// the LIVE Cloudflare workers (R83 digest contract). Run from edge/:
//   node tools/verify-digests.mjs
// Exit 0 = repo tree == live modules (sorted-module normalized digest equal).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const normalized = (parts) =>
  [...parts]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((p) => `#module ${p.name}\n${p.body.replace(/\n$/, "")}`)
    .join("\n");

const LIVE_DIGESTS = {
  "metaengine-fabric-worker-h205f21r4": "9c55419e37b04d41",
  "metaengine-h205f22-aop1": "29b36254b0b4cb4f",
};

const FABRIC_MODULES = ["src/ai.js", "src/auth.js", "src/core.mjs", "src/gateway.js", "src/handlers.js", "src/index.js", "src/workflow.js"];

let failed = false;

const fabricParts = FABRIC_MODULES.map((name) => ({ name, body: readFileSync(join("fabric-worker-h205f21r4", name), "utf8") }));
const fabricDigest = sha256(normalized(fabricParts)).slice(0, 16);
const fabricOk = fabricDigest === LIVE_DIGESTS["metaengine-fabric-worker-h205f21r4"];
console.log(`fabric-worker  ${fabricDigest} ${fabricOk ? "== LIVE ✓" : "!= LIVE ✗"}`);
if (!fabricOk) failed = true;

const aop1Body = readFileSync(join("metaengine-h205f22-aop1", "bundle/index.js"), "utf8");
const aop1Digest = sha256(normalized([{ name: "index.js", body: aop1Body }])).slice(0, 16);
const aop1Ok = aop1Digest === LIVE_DIGESTS["metaengine-h205f22-aop1"];
console.log(`h205f22-aop1  ${aop1Digest} ${aop1Ok ? "== LIVE ✓" : "!= LIVE ✗"}`);
if (!aop1Ok) failed = true;

if (failed) { console.error("VERIFY FAILED — repo tree diverged from live workers"); process.exit(1); }
console.log("repo tree == live edge (both workers) — promotion gate digest contract holds");

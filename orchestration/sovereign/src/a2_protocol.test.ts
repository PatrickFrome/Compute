import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import { PriorityInbox, exactModel, peerOf, mandatoryPeerHashes, causalParents, isActionConflict, verifyEd25519RawPublicKey, deriveFrontierHash, type A2Event } from "./a2_protocol.js";

function ev(n:number,agent:"GPT"|"GLM",priority:0|1|2|3=2,type="CLAIM",action="A"):A2Event{return{event_id:`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`,commit_seq:n,workspace_id:"00000000-0000-4000-8000-000000000999",session_id:"00000000-0000-4000-8000-000000000998",agent,agent_seq:n,semantic_point:"X",event_type:type,priority,parent_hashes:[],payload:{proposed_action:{kind:action}},payload_sha256:"a".repeat(64),event_hash:createHash("sha256").update(String(n)).digest("hex"),signature_key_fingerprint_sha256:"b".repeat(64)};}

test("exact model identities are immutable",()=>{assert.equal(exactModel("GPT"),"openai/gpt-5.6-sol");assert.equal(exactModel("GLM"),"zai/glm-5.3");assert.equal(peerOf("GPT"),"GLM");});
test("mandatory peer hashes only include unseen P0/P1",()=>{const es=[ev(1,"GPT",0),ev(2,"GLM",2),ev(3,"GLM",1)];assert.deepEqual(mandatoryPeerHashes("GPT",es,1),[es[2].event_hash]);});
test("causal parents include latest own and peer",()=>{const es=[ev(1,"GPT"),ev(2,"GLM"),ev(3,"GPT")];assert.deepEqual(causalParents("GPT",es).sort(),[es[2].event_hash,es[1].event_hash].sort());});
test("action conflict requires distinct agents and action kinds",()=>{assert.equal(isActionConflict(ev(1,"GPT",2,"ACTION_PROPOSAL","A"),ev(2,"GLM",2,"ACTION_PROPOSAL","B")),true);assert.equal(isActionConflict(ev(1,"GPT",2,"ACTION_PROPOSAL","A"),ev(2,"GLM",2,"ACTION_PROPOSAL","A")),false);});
test("P0/P1 never silently evicted",()=>{const q=new PriorityInbox(8);for(let i=1;i<=8;i++)q.push(ev(i,"GPT",2));assert.throws(()=>q.push(ev(9,"GLM",0)),/fail_closed/);});
test("P3 can coalesce under pressure",()=>{const q=new PriorityInbox(8);for(let i=1;i<=8;i++)q.push(ev(i,"GPT",3,"MODEL_STARTED"));q.push(ev(9,"GPT",3,"MODEL_STARTED"));assert.equal(q.size,8);});
test("ed25519 raw key verification",()=>{const kp=generateKeyPairSync("ed25519");const raw=(kp.publicKey.export({format:"der",type:"spki"}) as Buffer).subarray(-32);const hash=createHash("sha256").update("event").digest("hex");const sig=sign(null,Buffer.from(hash,"hex"),kp.privateKey).toString("base64");assert.equal(verifyEd25519RawPublicKey(raw.toString("base64"),hash,sig),true);assert.equal(verifyEd25519RawPublicKey(raw.toString("base64"),"0".repeat(64),sig),false);});
test("frontier hash deterministic independent of input order",()=>{const a=ev(1,"GPT"),b=ev(2,"GLM");assert.equal(deriveFrontierHash(a.workspace_id,[a,b]),deriveFrontierHash(a.workspace_id,[b,a]));});

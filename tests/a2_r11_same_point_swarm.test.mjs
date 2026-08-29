import test from 'node:test';
import assert from 'node:assert/strict';
import { SamePointSwarmV1 } from '../coordination/browser-shared/same-point-swarm-v1.mjs';

function evidence(evidence_id, author_agent_id, kind, refs = []) {
  return { evidence_id, point_id: 'point.r11.001', author_agent_id, kind, refs };
}
function resolver(rows) {
  const map = new Map(rows.map((row) => [row.evidence_id, row]));
  return (id) => map.get(id) || null;
}
const standardParticipants = [
  { agent_id: 'agent.prop.a', role: 'PROPOSER_A' },
  { agent_id: 'agent.prop.b', role: 'PROPOSER_B' },
  { agent_id: 'agent.jury', role: 'JURY' },
];

function standardRows() {
  return [
    evidence('evidence.prop.a', 'agent.prop.a', 'PROPOSAL'),
    evidence('evidence.prop.b', 'agent.prop.b', 'PROPOSAL'),
    evidence('evidence.crit.a.on.b', 'agent.prop.a', 'CRITIQUE', ['evidence.prop.b']),
    evidence('evidence.crit.b.on.a', 'agent.prop.b', 'CRITIQUE', ['evidence.prop.a']),
    evidence('evidence.jury', 'agent.jury', 'DECISION', [
      'evidence.prop.a', 'evidence.prop.b', 'evidence.crit.a.on.b', 'evidence.crit.b.on.a',
    ]),
  ];
}

test('proposal phase is blind to peer proposers until manager closes it', () => {
  const swarm = new SamePointSwarmV1({
    pointId: 'point.r11.001', managerId: 'manager.main', participants: standardParticipants,
    evidenceResolver: resolver(standardRows()),
  });
  swarm.submitProposal({ agent_id: 'agent.prop.a', evidence_id: 'evidence.prop.a' });
  swarm.submitProposal({ agent_id: 'agent.prop.b', evidence_id: 'evidence.prop.b' });
  assert.deepEqual(swarm.proposalView({ requester_agent_id: 'agent.prop.a' }), {
    phase: 'PROPOSING', proposal_ids: ['evidence.prop.a'], blind: true,
  });
  assert.deepEqual(swarm.proposalView({ requester_agent_id: 'agent.jury' }), {
    phase: 'PROPOSING', proposal_ids: [], blind: true,
  });
  assert.throws(() => swarm.closeProposals({ manager_id: 'manager.other' }), /swarm_manager_not_authorized/);
  swarm.closeProposals({ manager_id: 'manager.main' });
  assert.deepEqual(swarm.proposalView({ requester_agent_id: 'agent.prop.a' }).proposal_ids, ['evidence.prop.a', 'evidence.prop.b']);
});

test('cross critique is required and self critique fails closed', () => {
  const rows = standardRows();
  const swarm = new SamePointSwarmV1({ pointId: 'point.r11.001', managerId: 'manager.main', participants: standardParticipants, evidenceResolver: resolver(rows) });
  swarm.submitProposal({ agent_id: 'agent.prop.a', evidence_id: 'evidence.prop.a' });
  swarm.submitProposal({ agent_id: 'agent.prop.b', evidence_id: 'evidence.prop.b' });
  swarm.closeProposals({ manager_id: 'manager.main' });
  assert.throws(() => swarm.submitCritique({ agent_id: 'agent.prop.a', target_proposal_id: 'evidence.prop.a', evidence_id: 'evidence.crit.a.on.b' }), /swarm_self_critique_forbidden/);
  swarm.submitCritique({ agent_id: 'agent.prop.a', target_proposal_id: 'evidence.prop.b', evidence_id: 'evidence.crit.a.on.b' });
  assert.throws(() => swarm.closeCritiques({ manager_id: 'manager.main' }), /swarm_cross_critique_incomplete/);
  swarm.submitCritique({ agent_id: 'agent.prop.b', target_proposal_id: 'evidence.prop.a', evidence_id: 'evidence.crit.b.on.a' });
  swarm.closeCritiques({ manager_id: 'manager.main' });
  assert.equal(swarm.phase(), 'JURY');
});

test('STANDARD jury vote must bind all proposal and critique evidence and outcome is computed', () => {
  const rows = standardRows();
  const swarm = new SamePointSwarmV1({ pointId: 'point.r11.001', managerId: 'manager.main', participants: standardParticipants, evidenceResolver: resolver(rows) });
  swarm.submitProposal({ agent_id: 'agent.prop.a', evidence_id: 'evidence.prop.a' });
  swarm.submitProposal({ agent_id: 'agent.prop.b', evidence_id: 'evidence.prop.b' });
  swarm.closeProposals({ manager_id: 'manager.main' });
  swarm.submitCritique({ agent_id: 'agent.prop.a', target_proposal_id: 'evidence.prop.b', evidence_id: 'evidence.crit.a.on.b' });
  swarm.submitCritique({ agent_id: 'agent.prop.b', target_proposal_id: 'evidence.prop.a', evidence_id: 'evidence.crit.b.on.a' });
  swarm.closeCritiques({ manager_id: 'manager.main' });
  const badRows = [...rows.filter((row) => row.evidence_id !== 'evidence.jury'), evidence('evidence.jury.bad', 'agent.jury', 'DECISION', ['evidence.prop.a'])];
  const bad = new SamePointSwarmV1({ pointId: 'point.r11.001', managerId: 'manager.main', participants: standardParticipants, evidenceResolver: resolver(badRows) });
  bad.submitProposal({ agent_id: 'agent.prop.a', evidence_id: 'evidence.prop.a' });
  bad.submitProposal({ agent_id: 'agent.prop.b', evidence_id: 'evidence.prop.b' });
  bad.closeProposals({ manager_id: 'manager.main' });
  bad.submitCritique({ agent_id: 'agent.prop.a', target_proposal_id: 'evidence.prop.b', evidence_id: 'evidence.crit.a.on.b' });
  bad.submitCritique({ agent_id: 'agent.prop.b', target_proposal_id: 'evidence.prop.a', evidence_id: 'evidence.crit.b.on.a' });
  bad.closeCritiques({ manager_id: 'manager.main' });
  assert.throws(() => bad.submitJuryVote({ agent_id: 'agent.jury', evidence_id: 'evidence.jury.bad', verdict: 'ACCEPT' }), /swarm_jury_evidence_incomplete/);
  swarm.submitJuryVote({ agent_id: 'agent.jury', evidence_id: 'evidence.jury', verdict: 'ACCEPT' });
  const seal = swarm.sealJury({ manager_id: 'manager.main' });
  assert.equal(seal.outcome, 'ACCEPT');
  assert.equal(seal.automatic_browser_effect_allowed, false);
  assert.equal(seal.authority_effect, false);
  assert.equal(swarm.phase(), 'SEALED');
});

test('CRITICAL cannot reach jury without falsifier and security evidence', () => {
  const participants = [
    { agent_id: 'agent.prop.a', role: 'PROPOSER_A' },
    { agent_id: 'agent.prop.b', role: 'PROPOSER_B' },
    { agent_id: 'agent.false', role: 'FALSIFIER' },
    { agent_id: 'agent.security', role: 'SECURITY' },
    { agent_id: 'agent.jury', role: 'JURY' },
  ];
  const rows = [
    ...standardRows().filter((row) => row.evidence_id !== 'evidence.jury'),
    evidence('evidence.false', 'agent.false', 'FINDING', ['evidence.prop.a']),
    evidence('evidence.security', 'agent.security', 'TEST', ['evidence.prop.b']),
    evidence('evidence.jury.critical', 'agent.jury', 'DECISION', [
      'evidence.prop.a', 'evidence.prop.b', 'evidence.crit.a.on.b', 'evidence.crit.b.on.a', 'evidence.false', 'evidence.security',
    ]),
  ];
  const swarm = new SamePointSwarmV1({ pointId: 'point.r11.001', managerId: 'manager.main', assurance: 'CRITICAL', participants, evidenceResolver: resolver(rows) });
  swarm.submitProposal({ agent_id: 'agent.prop.a', evidence_id: 'evidence.prop.a' });
  swarm.submitProposal({ agent_id: 'agent.prop.b', evidence_id: 'evidence.prop.b' });
  swarm.closeProposals({ manager_id: 'manager.main' });
  swarm.submitCritique({ agent_id: 'agent.prop.a', target_proposal_id: 'evidence.prop.b', evidence_id: 'evidence.crit.a.on.b' });
  swarm.submitCritique({ agent_id: 'agent.prop.b', target_proposal_id: 'evidence.prop.a', evidence_id: 'evidence.crit.b.on.a' });
  swarm.closeCritiques({ manager_id: 'manager.main' });
  assert.equal(swarm.phase(), 'ADVERSARIAL');
  assert.throws(() => swarm.closeAdversarial({ manager_id: 'manager.main' }), /swarm_falsifier_evidence_missing/);
  swarm.submitAdversarial({ agent_id: 'agent.false', evidence_id: 'evidence.false' });
  assert.throws(() => swarm.closeAdversarial({ manager_id: 'manager.main' }), /swarm_security_evidence_missing/);
  swarm.submitAdversarial({ agent_id: 'agent.security', evidence_id: 'evidence.security' });
  swarm.closeAdversarial({ manager_id: 'manager.main' });
  swarm.submitJuryVote({ agent_id: 'agent.jury', evidence_id: 'evidence.jury.critical', verdict: 'REJECT' });
  assert.equal(swarm.sealJury({ manager_id: 'manager.main' }).outcome, 'REJECT');
});

test('multi-juror tie seals UNRESOLVED and manager cannot supply an override', () => {
  const participants = [
    { agent_id: 'agent.prop.a', role: 'PROPOSER_A' },
    { agent_id: 'agent.prop.b', role: 'PROPOSER_B' },
    { agent_id: 'agent.jury.a', role: 'JURY' },
    { agent_id: 'agent.jury.b', role: 'JURY' },
  ];
  const base = standardRows().filter((row) => row.evidence_id !== 'evidence.jury');
  const refs = ['evidence.prop.a', 'evidence.prop.b', 'evidence.crit.a.on.b', 'evidence.crit.b.on.a'];
  const rows = [...base, evidence('evidence.jury.a', 'agent.jury.a', 'DECISION', refs), evidence('evidence.jury.b', 'agent.jury.b', 'DECISION', refs)];
  const swarm = new SamePointSwarmV1({ pointId: 'point.r11.001', managerId: 'manager.main', participants, evidenceResolver: resolver(rows), juryQuorum: 2 });
  swarm.submitProposal({ agent_id: 'agent.prop.a', evidence_id: 'evidence.prop.a' });
  swarm.submitProposal({ agent_id: 'agent.prop.b', evidence_id: 'evidence.prop.b' });
  swarm.closeProposals({ manager_id: 'manager.main' });
  swarm.submitCritique({ agent_id: 'agent.prop.a', target_proposal_id: 'evidence.prop.b', evidence_id: 'evidence.crit.a.on.b' });
  swarm.submitCritique({ agent_id: 'agent.prop.b', target_proposal_id: 'evidence.prop.a', evidence_id: 'evidence.crit.b.on.a' });
  swarm.closeCritiques({ manager_id: 'manager.main' });
  swarm.submitJuryVote({ agent_id: 'agent.jury.a', evidence_id: 'evidence.jury.a', verdict: 'ACCEPT' });
  assert.throws(() => swarm.sealJury({ manager_id: 'manager.main' }), /swarm_jury_quorum_not_met/);
  swarm.submitJuryVote({ agent_id: 'agent.jury.b', evidence_id: 'evidence.jury.b', verdict: 'REJECT' });
  assert.equal(swarm.sealJury({ manager_id: 'manager.main', outcome: 'ACCEPT' }).outcome, 'UNRESOLVED');
  assert.ok(swarm.events().every((event) => event.authority_effect === false && event.actuation_eligible === false));
});

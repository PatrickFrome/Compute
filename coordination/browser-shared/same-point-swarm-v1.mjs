const POINT_ID_RE = /^[a-z0-9][a-z0-9._:-]{2,127}$/;
const AGENT_ID_RE = /^[a-z0-9][a-z0-9._:-]{2,127}$/;
const EVIDENCE_ID_RE = /^[a-z0-9][a-z0-9._:-]{2,127}$/;
const MANAGER_ID_RE = /^[a-z0-9][a-z0-9._:-]{2,127}$/;
const ROLE_RE = /^[A-Z][A-Z0-9_:-]{1,63}$/;
const PHASES = new Set(['PROPOSING', 'CRITIQUING', 'ADVERSARIAL', 'JURY', 'SEALED']);
const ASSURANCE = new Set(['STANDARD', 'CRITICAL']);
const VERDICTS = new Set(['ACCEPT', 'REJECT', 'UNRESOLVED']);
const ADVERSARIAL_EVIDENCE_KINDS = new Set(['FINDING', 'TEST', 'CRITIQUE', 'OBSERVATION']);

export const SAME_POINT_SWARM_VERSION = '1.0.0';

export class SamePointSwarmError extends Error {
  constructor(code) {
    super(code);
    this.name = 'SamePointSwarmError';
    this.code = code;
  }
}

function clone(value) { return value == null ? value : structuredClone(value); }
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
function text(value, max, code) {
  if (typeof value !== 'string') throw new SamePointSwarmError(code);
  const v = value.trim();
  if (!v || v.length > max) throw new SamePointSwarmError(code);
  return v;
}
function token(value, re, max, code, transform = (v) => v) {
  const v = transform(text(value, max, code));
  if (!re.test(v)) throw new SamePointSwarmError(code);
  return v;
}
function roleClass(role) {
  if (role.startsWith('PROPOSER')) return 'PROPOSER';
  if (role === 'CRITIC') return 'CRITIC';
  if (role === 'FALSIFIER') return 'FALSIFIER';
  if (role === 'SECURITY') return 'SECURITY';
  if (role === 'JURY' || role === 'EVIDENCE_JURY' || role === 'INTEGRATOR') return 'JURY';
  return 'OTHER';
}
function normalizeParticipants(value) {
  if (!Array.isArray(value) || value.length < 3 || value.length > 32) throw new SamePointSwarmError('swarm_participants_invalid');
  const ids = new Set();
  const out = value.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).sort().join(',') !== 'agent_id,role') {
      throw new SamePointSwarmError('swarm_participant_fields_invalid');
    }
    const agentId = token(raw.agent_id, AGENT_ID_RE, 128, 'swarm_agent_id_invalid', (v) => v.toLowerCase());
    const role = token(raw.role, ROLE_RE, 64, 'swarm_role_invalid', (v) => v.toUpperCase());
    if (ids.has(agentId)) throw new SamePointSwarmError('swarm_agent_duplicate');
    ids.add(agentId);
    return Object.freeze({ agent_id: agentId, role, role_class: roleClass(role) });
  });
  if (out.filter((p) => p.role_class === 'PROPOSER').length < 2) throw new SamePointSwarmError('swarm_requires_two_proposers');
  if (out.filter((p) => p.role_class === 'JURY').length < 1) throw new SamePointSwarmError('swarm_requires_jury');
  return Object.freeze(out);
}
function sortedUnique(values) { return Object.freeze([...new Set(values)].sort()); }

export class SamePointSwarmV1 {
  #pointId;
  #managerId;
  #assurance;
  #juryQuorum;
  #resolveEvidence;
  #participants;
  #participantMap;
  #phase = 'PROPOSING';
  #proposals = new Map();
  #critiques = new Map();
  #adversarial = new Map();
  #votes = new Map();
  #sealed = null;
  #events = [];
  #seq = 0;

  constructor({ pointId, managerId, assurance = 'STANDARD', participants, evidenceResolver, juryQuorum = 1 } = {}) {
    this.#pointId = token(pointId, POINT_ID_RE, 128, 'swarm_point_id_invalid', (v) => v.toLowerCase());
    this.#managerId = token(managerId, MANAGER_ID_RE, 128, 'swarm_manager_id_invalid', (v) => v.toLowerCase());
    this.#assurance = token(assurance, ROLE_RE, 16, 'swarm_assurance_invalid', (v) => v.toUpperCase());
    if (!ASSURANCE.has(this.#assurance)) throw new SamePointSwarmError('swarm_assurance_invalid');
    if (typeof evidenceResolver !== 'function') throw new SamePointSwarmError('swarm_evidence_resolver_invalid');
    this.#resolveEvidence = evidenceResolver;
    this.#participants = normalizeParticipants(participants);
    this.#participantMap = new Map(this.#participants.map((p) => [p.agent_id, p]));
    const juryCount = this.#participants.filter((p) => p.role_class === 'JURY').length;
    if (!Number.isInteger(juryQuorum) || juryQuorum < 1 || juryQuorum > juryCount) throw new SamePointSwarmError('swarm_jury_quorum_invalid');
    this.#juryQuorum = juryQuorum;
    if (this.#assurance === 'CRITICAL') {
      if (!this.#participants.some((p) => p.role_class === 'FALSIFIER')) throw new SamePointSwarmError('swarm_critical_requires_falsifier');
      if (!this.#participants.some((p) => p.role_class === 'SECURITY')) throw new SamePointSwarmError('swarm_critical_requires_security');
    }
    this.#record('SWARM_CREATED', { assurance: this.#assurance, jury_quorum: juryQuorum });
  }

  phase() { return this.#phase; }
  snapshot() {
    return deepFreeze({
      version: SAME_POINT_SWARM_VERSION,
      point_id: this.#pointId,
      assurance: this.#assurance,
      phase: this.#phase,
      participants: clone(this.#participants),
      proposal_ids: sortedUnique([...this.#proposals.values()]),
      critique_ids: sortedUnique([...this.#critiques.values()].map((row) => row.evidence_id)),
      adversarial_evidence_ids: sortedUnique([...this.#adversarial.values()]),
      jury_vote_count: this.#votes.size,
      sealed: clone(this.#sealed),
      direct_peer_messaging: false,
      authority_effect: false,
      actuation_eligible: false,
    });
  }
  events() { return this.#events.map(clone); }

  submitProposal({ agent_id, evidence_id }) {
    this.#requirePhase('PROPOSING');
    const agent = this.#requireParticipant(agent_id, ['PROPOSER']);
    if (this.#proposals.has(agent.agent_id)) throw new SamePointSwarmError('swarm_proposal_already_submitted');
    const evidence = this.#evidence(evidence_id, agent.agent_id, 'PROPOSAL');
    this.#proposals.set(agent.agent_id, evidence.evidence_id);
    this.#record('PROPOSAL_SUBMITTED', { agent_id: agent.agent_id, evidence_id: evidence.evidence_id });
    return deepFreeze({ accepted: true, proposal_count: this.#proposals.size, authority_effect: false });
  }

  proposalView({ requester_agent_id }) {
    const requester = this.#requireParticipant(requester_agent_id);
    if (this.#phase === 'PROPOSING' && requester.role_class === 'PROPOSER') {
      const own = this.#proposals.get(requester.agent_id);
      return deepFreeze({ phase: this.#phase, proposal_ids: own ? [own] : [], blind: true });
    }
    if (this.#phase === 'PROPOSING') return deepFreeze({ phase: this.#phase, proposal_ids: [], blind: true });
    return deepFreeze({ phase: this.#phase, proposal_ids: [...this.#proposals.values()].sort(), blind: false });
  }

  closeProposals({ manager_id }) {
    this.#assertManager(manager_id);
    this.#requirePhase('PROPOSING');
    const proposers = this.#participants.filter((p) => p.role_class === 'PROPOSER');
    if (this.#proposals.size !== proposers.length) throw new SamePointSwarmError('swarm_proposals_incomplete');
    this.#transition('CRITIQUING');
    return this.snapshot();
  }

  submitCritique({ agent_id, target_proposal_id, evidence_id }) {
    this.#requirePhase('CRITIQUING');
    const agent = this.#requireParticipant(agent_id, ['PROPOSER', 'CRITIC', 'FALSIFIER', 'SECURITY']);
    const proposalId = token(target_proposal_id, EVIDENCE_ID_RE, 128, 'swarm_proposal_id_invalid', (v) => v.toLowerCase());
    const targetAuthor = [...this.#proposals.entries()].find(([, id]) => id === proposalId)?.[0] || null;
    if (!targetAuthor) throw new SamePointSwarmError('swarm_target_proposal_unknown');
    if (targetAuthor === agent.agent_id) throw new SamePointSwarmError('swarm_self_critique_forbidden');
    const key = `${agent.agent_id}\0${proposalId}`;
    if (this.#critiques.has(key)) throw new SamePointSwarmError('swarm_duplicate_critique');
    const evidence = this.#evidence(evidence_id, agent.agent_id, 'CRITIQUE');
    if (!Array.isArray(evidence.refs) || !evidence.refs.includes(proposalId)) throw new SamePointSwarmError('swarm_critique_missing_proposal_ref');
    this.#critiques.set(key, Object.freeze({ evidence_id: evidence.evidence_id, target_proposal_id: proposalId }));
    this.#record('CRITIQUE_SUBMITTED', { agent_id: agent.agent_id, evidence_id: evidence.evidence_id, target_proposal_id: proposalId });
    return deepFreeze({ accepted: true, critique_count: this.#critiques.size, authority_effect: false });
  }

  closeCritiques({ manager_id }) {
    this.#assertManager(manager_id);
    this.#requirePhase('CRITIQUING');
    const covered = new Set([...this.#critiques.values()].map((row) => row.target_proposal_id));
    for (const proposalId of this.#proposals.values()) if (!covered.has(proposalId)) throw new SamePointSwarmError('swarm_cross_critique_incomplete');
    this.#transition(this.#assurance === 'CRITICAL' ? 'ADVERSARIAL' : 'JURY');
    return this.snapshot();
  }

  submitAdversarial({ agent_id, evidence_id }) {
    this.#requirePhase('ADVERSARIAL');
    const agent = this.#requireParticipant(agent_id, ['FALSIFIER', 'SECURITY']);
    if (this.#adversarial.has(agent.role_class)) throw new SamePointSwarmError('swarm_adversarial_role_already_submitted');
    const evidence = this.#evidence(evidence_id, agent.agent_id, null);
    if (!ADVERSARIAL_EVIDENCE_KINDS.has(String(evidence.kind || '').toUpperCase())) throw new SamePointSwarmError('swarm_adversarial_evidence_kind_invalid');
    this.#adversarial.set(agent.role_class, evidence.evidence_id);
    this.#record('ADVERSARIAL_EVIDENCE_SUBMITTED', { role_class: agent.role_class, agent_id: agent.agent_id, evidence_id: evidence.evidence_id });
    return deepFreeze({ accepted: true, role_class: agent.role_class, authority_effect: false });
  }

  closeAdversarial({ manager_id }) {
    this.#assertManager(manager_id);
    this.#requirePhase('ADVERSARIAL');
    if (!this.#adversarial.has('FALSIFIER')) throw new SamePointSwarmError('swarm_falsifier_evidence_missing');
    if (!this.#adversarial.has('SECURITY')) throw new SamePointSwarmError('swarm_security_evidence_missing');
    this.#transition('JURY');
    return this.snapshot();
  }

  submitJuryVote({ agent_id, evidence_id, verdict }) {
    this.#requirePhase('JURY');
    const agent = this.#requireParticipant(agent_id, ['JURY']);
    if (this.#votes.has(agent.agent_id)) throw new SamePointSwarmError('swarm_jury_vote_already_submitted');
    const normalizedVerdict = token(verdict, ROLE_RE, 16, 'swarm_jury_verdict_invalid', (v) => v.toUpperCase());
    if (!VERDICTS.has(normalizedVerdict)) throw new SamePointSwarmError('swarm_jury_verdict_invalid');
    const evidence = this.#evidence(evidence_id, agent.agent_id, 'DECISION');
    const required = this.#requiredJuryEvidenceIds();
    const refs = new Set(Array.isArray(evidence.refs) ? evidence.refs : []);
    for (const id of required) if (!refs.has(id)) throw new SamePointSwarmError('swarm_jury_evidence_incomplete');
    this.#votes.set(agent.agent_id, Object.freeze({ evidence_id: evidence.evidence_id, verdict: normalizedVerdict }));
    this.#record('JURY_VOTE_SUBMITTED', { agent_id: agent.agent_id, evidence_id: evidence.evidence_id, verdict: normalizedVerdict });
    return deepFreeze({ accepted: true, vote_count: this.#votes.size, authority_effect: false });
  }

  sealJury({ manager_id }) {
    this.#assertManager(manager_id);
    this.#requirePhase('JURY');
    if (this.#votes.size < this.#juryQuorum) throw new SamePointSwarmError('swarm_jury_quorum_not_met');
    const counts = { ACCEPT: 0, REJECT: 0, UNRESOLVED: 0 };
    for (const vote of this.#votes.values()) counts[vote.verdict] += 1;
    const total = this.#votes.size;
    const outcome = counts.ACCEPT > total / 2 ? 'ACCEPT' : counts.REJECT > total / 2 ? 'REJECT' : 'UNRESOLVED';
    this.#phase = 'SEALED';
    this.#sealed = deepFreeze({
      outcome,
      vote_counts: Object.freeze({ ...counts }),
      jury_quorum: this.#juryQuorum,
      vote_count: total,
      proposal_ids: sortedUnique([...this.#proposals.values()]),
      critique_ids: sortedUnique([...this.#critiques.values()].map((row) => row.evidence_id)),
      adversarial_evidence_ids: sortedUnique([...this.#adversarial.values()]),
      jury_evidence_ids: sortedUnique([...this.#votes.values()].map((row) => row.evidence_id)),
      automatic_browser_effect_allowed: false,
      authority_effect: false,
      actuation_eligible: false,
    });
    this.#record('SWARM_SEALED', { outcome, vote_count: total });
    return clone(this.#sealed);
  }

  #requiredJuryEvidenceIds() {
    return sortedUnique([
      ...this.#proposals.values(),
      ...[...this.#critiques.values()].map((row) => row.evidence_id),
      ...this.#adversarial.values(),
    ]);
  }

  #evidence(evidenceId, expectedAuthor, expectedKind) {
    const id = token(evidenceId, EVIDENCE_ID_RE, 128, 'swarm_evidence_id_invalid', (v) => v.toLowerCase());
    const row = this.#resolveEvidence(id);
    if (!row || typeof row !== 'object') throw new SamePointSwarmError('swarm_evidence_missing');
    if (String(row.evidence_id || '').toLowerCase() !== id) throw new SamePointSwarmError('swarm_evidence_identity_mismatch');
    if (String(row.point_id || '').toLowerCase() !== this.#pointId) throw new SamePointSwarmError('swarm_evidence_point_mismatch');
    if (String(row.author_agent_id || '').toLowerCase() !== expectedAuthor) throw new SamePointSwarmError('swarm_evidence_author_mismatch');
    if (expectedKind && String(row.kind || '').toUpperCase() !== expectedKind) throw new SamePointSwarmError('swarm_evidence_kind_mismatch');
    return row;
  }

  #requireParticipant(agentId, allowedClasses = null) {
    const id = token(agentId, AGENT_ID_RE, 128, 'swarm_agent_id_invalid', (v) => v.toLowerCase());
    const participant = this.#participantMap.get(id);
    if (!participant) throw new SamePointSwarmError('swarm_agent_not_participant');
    if (allowedClasses && !allowedClasses.includes(participant.role_class)) throw new SamePointSwarmError('swarm_agent_role_not_allowed');
    return participant;
  }

  #assertManager(managerId) {
    const id = token(managerId, MANAGER_ID_RE, 128, 'swarm_manager_id_invalid', (v) => v.toLowerCase());
    if (id !== this.#managerId) throw new SamePointSwarmError('swarm_manager_not_authorized');
  }

  #requirePhase(phase) {
    if (!PHASES.has(this.#phase) || this.#phase !== phase) throw new SamePointSwarmError('swarm_phase_invalid');
  }

  #transition(next) {
    if (!PHASES.has(next)) throw new SamePointSwarmError('swarm_phase_invalid');
    const previous = this.#phase;
    this.#phase = next;
    this.#record('PHASE_CHANGED', { from: previous, to: next });
  }

  #record(eventType, detail) {
    const event = deepFreeze({
      version: SAME_POINT_SWARM_VERSION,
      seq: ++this.#seq,
      event_type: eventType,
      point_id: this.#pointId,
      detail: clone(detail),
      authority_effect: false,
      actuation_eligible: false,
    });
    this.#events.push(event);
    return event;
  }
}

export function createSamePointSwarm(options) { return new SamePointSwarmV1(options); }

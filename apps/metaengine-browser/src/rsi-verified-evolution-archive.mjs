import crypto from 'node:crypto';

import {
  RsiEvolutionArchive,
  evaluateRsiShadowTournament,
  verifyRsiShadowTournamentResult,
} from './rsi-shadow-tournament.mjs';

export const RSI_VERIFIED_EVOLUTION_ARCHIVE_ADMISSION_SCHEMA = 'metaengine.rsi.verified-evolution-archive-admission.v1';
export const RSI_VERIFIED_EVOLUTION_ARCHIVE_SNAPSHOT_SCHEMA = 'metaengine.rsi.verified-evolution-archive-snapshot.v1';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex')}`;
}

function sameCanonicalValue(left, right) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

/**
 * Hardened admission boundary for the V1.4 evolution archive.
 *
 * The lower-level RsiEvolutionArchive intentionally remains a pure data
 * structure. This wrapper is the only archive surface intended for later
 * promotion-gate consumption: it refuses to trust a caller-supplied tournament
 * verdict and independently reconstructs the canonical result from the exact
 * paired receipts before delegating storage.
 */
export class RsiVerifiedEvolutionArchive {
  #archive;

  constructor(options = {}) {
    this.#archive = new RsiEvolutionArchive(options);
  }

  admit({ plan, result, receipts } = {}) {
    const canonicalResult = evaluateRsiShadowTournament({ plan, receipts });
    verifyRsiShadowTournamentResult({ plan, result });

    if (result.result_digest !== canonicalResult.result_digest || !sameCanonicalValue(result, canonicalResult)) {
      throw new Error('rsi_verified_archive_result_not_canonical');
    }

    const row = this.#archive.admit({ plan, result: canonicalResult });
    const core = {
      schema: RSI_VERIFIED_EVOLUTION_ARCHIVE_ADMISSION_SCHEMA,
      version: 1,
      candidate_id: canonicalResult.candidate.candidate_id,
      candidate_sha: canonicalResult.candidate.candidate_sha,
      parent_sha: canonicalResult.candidate.parent_sha,
      tournament_plan_id: canonicalResult.plan_id,
      tournament_plan_digest: canonicalResult.plan_digest,
      tournament_result_digest: canonicalResult.result_digest,
      receipt_digests: [...canonicalResult.receipt_digests],
      archive_row_digest: row.row_digest,
      archive_state: row.state,
      archive_active: row.active,
      canonical_recomputation_required: true,
      caller_supplied_verdict_trusted: false,
      paired_receipts_required: true,
      scalar_ranking_authoritative: false,
      eligible_for_promotion: false,
      execution_authority: false,
      production_mutation_authority: false,
      promotion_authority: false,
      self_update_authority: false,
      automatic_retry_allowed: false,
      authority_effect: false,
    };
    return Object.freeze({
      ...core,
      admission_digest: digest(core),
      row: Object.freeze(structuredClone(row)),
    });
  }

  get(candidateId) {
    return this.#archive.get(candidateId);
  }

  snapshot() {
    const archiveSnapshot = this.#archive.snapshot();
    const core = {
      schema: RSI_VERIFIED_EVOLUTION_ARCHIVE_SNAPSHOT_SCHEMA,
      version: 1,
      archive_snapshot: archiveSnapshot,
      archive_snapshot_digest: archiveSnapshot.snapshot_digest,
      verified_admission_required: true,
      direct_archive_mutation_exposed: false,
      scalar_ranking_authoritative: false,
      eligible_for_promotion: false,
      execution_authority: false,
      production_mutation_authority: false,
      promotion_authority: false,
      self_update_authority: false,
      automatic_retry_allowed: false,
      authority_effect: false,
    };
    return Object.freeze({ ...core, snapshot_digest: digest(core) });
  }
}

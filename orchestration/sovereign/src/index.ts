/**
 * Historical sovereign V2 entrypoint.
 *
 * Active SAME_POINT_DUEL_V4 execution lives in same_point_v4.ts and uses two
 * independent PRIMARY/CRITIC OpenAI contexts. This file is kept only so old
 * references fail with an explicit terminal reason instead of silently
 * reactivating a retired provider/runtime path.
 */
export const LEGACY_SOVEREIGN_RUNNER_RETIRED = true;

export function retiredLegacySovereignRunner(): never {
  throw new Error("sovereign_legacy_runner_retired_chatgpt_only");
}

retiredLegacySovereignRunner();

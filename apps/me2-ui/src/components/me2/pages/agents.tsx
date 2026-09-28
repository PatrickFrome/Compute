"use client";

/**
 * R100 compatibility tombstone.
 *
 * The historical daemon/API Agents page used provider/model and AgentChat
 * mutation paths that are not part of the canonical Browser-owned z.ai Agent
 * fleet. The production shell no longer routes here; keeping an inert export
 * prevents stale imports from silently restoring a second agent authority
 * surface.
 */
export function AgentsPage() {
  return (
    <section
      data-testid="retired-agents-page"
      data-authority-effect="false"
      className="p-6 text-sm text-zinc-400"
      aria-label="Retired Agents compatibility surface"
    >
      <h1 className="text-base font-semibold text-zinc-200">Native Agent fleet</h1>
      <p className="mt-2 max-w-xl leading-relaxed">
        This legacy daemon Agents surface is retired. Agent execution, selection,
        lifecycle and transport are owned by the Browser fleet workspace.
      </p>
    </section>
  );
}

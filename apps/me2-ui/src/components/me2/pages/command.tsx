"use client";

/**
 * R100 compatibility tombstone.
 *
 * COMMAND used to project daemon AgentChat/session controls. Canonical mission
 * control now lives in Browser-owned fleet, Tasks, Supervisor and Observability
 * surfaces. This file is deliberately effect-poor so a stale import cannot
 * recreate the retired daemon control path.
 */
export function CommandPage() {
  return (
    <section
      data-testid="retired-command-page"
      data-authority-effect="false"
      className="p-6 text-sm text-zinc-400"
      aria-label="Retired Command compatibility surface"
    >
      <h1 className="text-base font-semibold text-zinc-200">Mission control moved</h1>
      <p className="mt-2 max-w-xl leading-relaxed">
        The legacy daemon Command surface is retired. Use the Browser fleet,
        Tasks and Supervisor product surfaces.
      </p>
    </section>
  );
}

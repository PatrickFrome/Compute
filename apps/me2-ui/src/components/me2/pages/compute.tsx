"use client";

/**
 * R100 compatibility tombstone.
 *
 * The legacy Compute page polled daemon provider/LLM/fleet endpoints. Those
 * paths are not execution authority for the packaged Browser. Runtime health
 * remains available through the canonical System/Observability projections.
 */
export function ComputePage() {
  return (
    <section
      data-testid="retired-compute-page"
      data-authority-effect="false"
      className="p-6 text-sm text-zinc-400"
      aria-label="Retired Compute compatibility surface"
    >
      <h1 className="text-base font-semibold text-zinc-200">Compute surface retired</h1>
      <p className="mt-2 max-w-xl leading-relaxed">
        The legacy daemon Compute surface is retired. Use System and
        Observability for read-only runtime evidence.
      </p>
    </section>
  );
}

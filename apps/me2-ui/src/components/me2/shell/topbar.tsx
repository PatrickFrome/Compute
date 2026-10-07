"use client";
// R97 quiet top bar: the main workspace has only global search/commands and
// Settings. All other persistent navigation chrome was removed.

import { useMe2 } from "@/components/me2/store";
import { useClientRuntimeStatus } from "@/hooks/use-client-runtime-status";
import { capabilityLabel } from "@/lib/client-readiness-labels";

export function TopBar({ fleetPickerOpen = false, onOpenFleet }: { fleetPickerOpen?: boolean; onOpenFleet?: () => void }) {
  const page = useMe2((s) => s.page);
  const runtime = useClientRuntimeStatus();
  const connection = runtime.readback?.connection;
  const work = runtime.readback?.work;
  const setPalette = useMe2((s) => s.setPalette);
  const setPage = useMe2((s) => s.setPage);
  const mainWorkspace = page === "browser";

  return (
    <header
      className="flex h-[42px] shrink-0 items-center gap-2 border-b border-zinc-800/90 bg-[#0b0b0d] px-2"
      data-testid="topbar"
    >
      <button
        type="button"
        onClick={() => setPage("browser")}
        data-testid="brand"
        className="flex h-8 shrink-0 items-center px-1.5 text-left hover:bg-zinc-900"
        title="METAENGINE · Chat Fleet"
      >
        <span className="text-[13px] font-semibold tracking-[0.08em] text-zinc-100">METAENGINE</span>
      </button>

      {mainWorkspace ? <button type="button" onClick={onOpenFleet} data-testid="fleet-picker-toggle"
        aria-expanded={fleetPickerOpen} aria-controls="fleet-picker" aria-haspopup="dialog"
        className="h-8 shrink-0 border border-zinc-700 px-2 text-[12px] text-zinc-200 min-[1008px]:hidden">Agents</button> : null}

      {!mainWorkspace ? (
        <button
          type="button"
          onClick={() => setPage("browser")}
          className="flex h-8 shrink-0 items-center gap-1 border border-zinc-800 bg-zinc-950 px-2 text-[10px] text-zinc-400 hover:text-zinc-100"
          data-testid="return-to-chat-fleet"
          title="Return to the single main workspace"
        >
          Back to agents
        </button>
      ) : null}

      <button
        type="button"
        onClick={() => setPalette(true)}
        data-testid="global-cmdbar"
        aria-label="Search and commands (Ctrl+K)"
        className="group mx-auto flex h-8 min-w-0 flex-1 max-w-[720px] items-center gap-2 border border-zinc-800 bg-zinc-900/55 px-2.5 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-900"
      >
        <span className="min-w-0 flex-1 truncate text-[12px] text-zinc-400">
          Search tools and commands
        </span>
        <kbd className="hidden shrink-0 items-center gap-0.5 border border-zinc-700 bg-zinc-950 px-1.5 py-0.5 font-mono text-[9px] text-zinc-400 sm:flex">
          Ctrl K
        </kbd>
      </button>

      <div className="ml-auto flex shrink-0 items-center gap-1.5 font-mono text-[9px]">
        <button
          type="button"
          onClick={() => setPage("system")}
          data-testid="settings-button"
          aria-label="Open Settings"
          className={`flex h-7 items-center gap-1.5 border px-2 transition-colors ${
            page === "system"
              ? "border-cyan-900/70 bg-cyan-950/20 text-cyan-300"
              : "border-zinc-800 bg-zinc-950 text-zinc-500 hover:text-zinc-200"
          }`}
          title="Settings and advanced tools"
        >
          Settings
        </button>
        <button
          type="button"
          onClick={() => setPage("system")}
          data-testid="admin-connection-badge"
          data-cloud-state={connection?.cloud_control_state || "UNAVAILABLE"}
          data-admin-ready={connection?.admin_ready === true ? "true" : "false"}
          data-work-state={work?.state || "UNAVAILABLE"}
          data-work-reason={work?.reason || ""}
          className={`flex h-7 max-w-[184px] items-center border px-2 font-bold tracking-[0.04em] ${
            work?.continuous_autonomy_ready === true
              ? "border-emerald-900/60 bg-emerald-950/20 text-emerald-300"
              : connection?.admin_ready === true
                ? "border-amber-900/60 bg-amber-950/20 text-amber-200"
                : "border-zinc-800 bg-zinc-950 text-zinc-400"
          }`}
          title={work ? `${work.detail} Continuous autonomy: ${capabilityLabel(work, 'continuous_autonomy')}` : "Native runtime status is unavailable. Open Settings for details."}
          aria-label={`Execution status: ${work?.label || "Status unavailable"}. Open Settings.`}
        >
          <span className="truncate">{work?.label || (runtime.state === "LOADING" ? "Starting" : "Status unavailable")}</span>
        </button>
      </div>
    </header>
  );
}

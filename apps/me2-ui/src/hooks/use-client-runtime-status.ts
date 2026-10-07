"use client";

import { useSyncExternalStore } from "react";
import { createClientRuntimeResource, INITIAL_CLIENT_RUNTIME, type ClientConnectionStatus, type ClientWorkReadiness } from "@/lib/client-runtime-resource";

const resource = createClientRuntimeResource({
  read: async () => {
    const bridge = (window as Window & { metaengineClient?: {
      connectionStatus?: () => Promise<ClientConnectionStatus>;
      workReadiness?: () => Promise<ClientWorkReadiness>;
    } }).metaengineClient;
    if (!bridge?.connectionStatus || !bridge.workReadiness) throw new Error("client_native_observation_unavailable");
    const [connection, work] = await Promise.all([bridge.connectionStatus(), bridge.workReadiness()]);
    return { connection, work };
  },
  isVisible: () => typeof document !== "undefined" && document.visibilityState === "visible",
  onVisibilityChange: (listener) => {
    document.addEventListener("visibilitychange", listener);
    return () => document.removeEventListener("visibilitychange", listener);
  },
});

export function useClientRuntimeStatus() {
  return useSyncExternalStore(resource.subscribe, resource.getSnapshot, () => INITIAL_CLIENT_RUNTIME);
}

export async function refreshClientRuntimeStatus() {
  await resource.refresh();
  return resource.getSnapshot();
}

"use client";

import { useSyncExternalStore } from "react";
import { createClientRuntimeResource, readClientRuntimePair, INITIAL_CLIENT_RUNTIME, type ClientConnectionStatus, type ClientWorkReadiness } from "@/lib/client-runtime-resource";

const resource = createClientRuntimeResource({
  read: async () => {
    const bridge = (window as Window & { metaengineClient?: {
      connectionStatus?: () => Promise<ClientConnectionStatus>;
      workReadiness?: () => Promise<ClientWorkReadiness>;
    } }).metaengineClient;
    if (!bridge?.connectionStatus || !bridge.workReadiness) throw new Error("client_native_observation_unavailable");
    return readClientRuntimePair(() => bridge.connectionStatus!(), () => bridge.workReadiness!());
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

"use client";
/**
 * R95 OBSERVE — workflow-страница наблюдения.
 * Хостит legacy-модули: OBSERVABILITY (события, трейсы, исходы, журналы,
 * здоровье) и MEMORY (память и знание). Поверхности сохранены без изменений
 * (data-testid="page-observability" / "page-memory").
 */

import { ModuleSuite } from "@/components/me2/pages/module-suite";
import { ObservabilityPage } from "@/components/me2/pages/observability";
import { MemoryPage } from "@/components/me2/pages/memory";

export function ObservePage() {
  return (
    <ModuleSuite
      testid="page-observe"
      storageKey="me2.observe.module.v1"
      modules={[
        { key: "observability", label: "OBSERV", hint: "события · трейсы · исходы · здоровье", content: <ObservabilityPage /> },
        { key: "memory", label: "MEMORY", hint: "память и знание", content: <MemoryPage /> },
      ]}
    />
  );
}

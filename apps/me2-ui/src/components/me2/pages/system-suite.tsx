"use client";
/**
 * R95 SYSTEM SUITE — workflow-страница системы.
 * Хостит legacy-модули: SYSTEM (runtime, releases, self-update, settings)
 * и COMPUTE (пул, workers, квоты). Поверхности сохранены без изменений
 * (data-testid="page-system" / "page-compute").
 */

import { ModuleSuite } from "@/components/me2/pages/module-suite";
import { SystemPage } from "@/components/me2/pages/system";
import { ComputePage } from "@/components/me2/pages/compute";

export function SystemSuitePage() {
  return (
    <ModuleSuite
      testid="page-system-suite"
      storageKey="me2.system.module.v1"
      modules={[
        { key: "system", label: "SYSTEM", hint: "runtime · releases · self-update · settings", content: <SystemPage /> },
        { key: "compute", label: "COMPUTE", hint: "пул · workers · квоты", content: <ComputePage /> },
      ]}
    />
  );
}

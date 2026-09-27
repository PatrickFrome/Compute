"use client";
/**
 * R95 FLEET — workflow-страница флота и оркестрации.
 * Хостит legacy-модули: AGENTS (матрица агентов, делегирование, агентные
 * беседы) и SUPERVISOR (цели, control-plane). Обе поверхности сохранены
 * без изменений (data-testid="page-agents" / "page-supervisor").
 */

import { ModuleSuite } from "@/components/me2/pages/module-suite";
import { AgentsPage } from "@/components/me2/pages/agents";
import { SupervisorPage } from "@/components/me2/pages/supervisor";

export function FleetPage() {
  return (
    <ModuleSuite
      testid="page-fleet"
      storageKey="me2.fleet.module.v1"
      modules={[
        { key: "agents", label: "AGENTS", hint: "матрица агентов · делегирование · беседы", content: <AgentsPage /> },
        { key: "supervisor", label: "SUPERVISOR", hint: "цели · оркестрация · control-plane", content: <SupervisorPage /> },
      ]}
    />
  );
}

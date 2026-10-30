"use client";

import { Me2Shell } from "@/components/me2/shell/me2-shell";
import { useDraftScope } from "@/hooks/use-draft-scope";

export default function Page() {
  const draftScope = useDraftScope();
  return <Me2Shell key={draftScope.generation} draftScope={draftScope.scope} draftIsCurrent={draftScope.isCurrent} />;
}

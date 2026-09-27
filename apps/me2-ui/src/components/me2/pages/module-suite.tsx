"use client";
/**
 * R95 MODULE SUITE — хостинг legacy-модулей внутри workflow-страницы.
 * Resolve-принцип: workflow Page — стадия работы; legacy-модули (R74–R94)
 * становятся переключаемыми поверхностями внутри стадии. Ни один модуль
 * не удалён: монтируется только активная поверхность (закрытые поверхности
 * не монтируются — семантическое дерево остаётся честным).
 * Выбор модуля персистится (per-suite LS-ключ), восстанавливается после
 * гидрации (без SSR-mismatch).
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";

export type ModuleSuiteItem = {
  key: string;
  label: string;
  hint: string;
  content: ReactNode;
};

export function ModuleSuite({
  testid,
  storageKey,
  modules,
}: {
  testid: string;
  storageKey: string;
  modules: ModuleSuiteItem[];
}) {
  const [active, setActive] = useState(modules[0]?.key ?? "");
  const moduleKeys = useMemo(() => modules.map((m) => m.key).join(","), [modules]);

  // Restore the saved module AFTER hydration paint (deferred like store.init) —
  // no synchronous setState cascade from the effect body, no SSR mismatch.
  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved && moduleKeys.split(",").includes(saved)) setActive(saved);
      } catch { /* приватный режим */ }
    }, 0);
    return () => window.clearTimeout(t);
  }, [storageKey, moduleKeys]);

  const current = modules.find((m) => m.key === active) ?? modules[0];

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid={testid}>
      <div
        role="tablist"
        aria-label="Поверхности модулей workflow-страницы"
        data-testid={`${testid}-tabs`}
        className="flex h-7 shrink-0 items-stretch border-b border-zinc-800/90 bg-[#0b0b0d] px-1.5"
      >
        {modules.map((m) => {
          const selected = m.key === current?.key;
          return (
            <button
              key={m.key}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={`${testid}-panel`}
              data-testid={`module-tab-${m.key}`}
              onClick={() => {
                setActive(m.key);
                try { localStorage.setItem(storageKey, m.key); } catch { /* приватный режим */ }
              }}
              title={m.hint}
              className={`relative px-2.5 text-[9px] font-semibold uppercase tracking-[0.1em] transition-colors ${
                selected ? "text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {m.label}
              {selected ? <span className="absolute inset-x-1 bottom-0 h-px bg-emerald-400" aria-hidden /> : null}
            </button>
          );
        })}
        <span className="ml-auto flex min-w-0 items-center truncate pl-2 font-mono text-[8px] text-zinc-700" title={current?.hint}>
          {current?.hint}
        </span>
      </div>
      <div role="tabpanel" id={`${testid}-panel`} aria-label={current?.label} className="min-h-0 flex-1 overflow-hidden">
        {current?.content}
      </div>
    </div>
  );
}

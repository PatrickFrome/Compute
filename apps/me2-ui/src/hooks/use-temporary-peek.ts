"use client";

import { useEffect, useRef } from "react";
import { useMe2, type PeekKind } from "@/components/me2/store";

type TemporaryPeekListOptions = {
  kind: PeekKind;
  ids: readonly string[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest(
    'input, textarea, select, [contenteditable="true"], [role="textbox"], [role="combobox"]',
  ));
}

function focusPeekItem(kind: PeekKind, id: string): void {
  window.requestAnimationFrame(() => {
    const nodes = Array.from(document.querySelectorAll(`[data-peek-kind="${kind}"][data-peek-id]`));
    const node = nodes.find((item) => item.getAttribute("data-peek-id") === id) as
      | (Element & { focus?: (options?: FocusOptions) => void })
      | undefined;
    node?.focus?.({ preventScroll: true });
    node?.scrollIntoView?.({ block: "nearest" });
  });
}

/**
 * Linear-style temporary Peek:
 * - hold Space: preview selected object without navigating;
 * - while held, ↑/↓ changes selection and keeps preview open;
 * - release Space or press Escape: close preview.
 *
 * This hook owns presentation state only. It never opens Task detail, selects a
 * native Browser tab, mutates an Agent, or talks to a backend.
 */
export function useTemporaryPeekList({
  kind,
  ids,
  selectedId,
  onSelect,
}: TemporaryPeekListOptions): void {
  const setPeekTarget = useMe2((s) => s.setPeekTarget);
  const idsRef = useRef<readonly string[]>(ids);
  const selectedRef = useRef<string | null>(selectedId);
  const onSelectRef = useRef(onSelect);
  const heldRef = useRef(false);

  idsRef.current = ids;
  selectedRef.current = selectedId;
  onSelectRef.current = onSelect;

  useEffect(() => {
    const close = () => {
      if (!heldRef.current) return;
      heldRef.current = false;
      setPeekTarget(null);
    };

    const move = (delta: -1 | 1) => {
      const rows = idsRef.current;
      if (rows.length === 0) return;
      const current = selectedRef.current;
      const index = current ? rows.indexOf(current) : -1;
      const start = index >= 0 ? index : (delta > 0 ? -1 : rows.length);
      const nextIndex = Math.max(0, Math.min(rows.length - 1, start + delta));
      const nextId = rows[nextIndex];
      if (!nextId) return;
      selectedRef.current = nextId;
      onSelectRef.current(nextId);
      setPeekTarget({ kind, id: nextId });
      focusPeekItem(kind, nextId);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === " ") {
        const id = selectedRef.current;
        if (!id) return;
        event.preventDefault();
        heldRef.current = true;
        setPeekTarget({ kind, id });
        return;
      }

      if (!heldRef.current) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        move(1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        move(-1);
      } else if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key !== " " || !heldRef.current) return;
      event.preventDefault();
      close();
    };

    const onVisibility = () => {
      if (document.visibilityState !== "visible") close();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", close);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", close);
      document.removeEventListener("visibilitychange", onVisibility);
      if (heldRef.current) {
        heldRef.current = false;
        setPeekTarget(null);
      }
    };
  }, [kind, setPeekTarget]);
}

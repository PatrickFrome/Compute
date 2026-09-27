# METAENGINE R96D — BranchGraph nested action keyboard research

Date: 2026-09-27  
Base: R96C `a69f9e595ab39f9a9e1a4cd107dc30f09dd9541a`  
Scope: keyboard/accessibility semantics only; no new authority.

## Critical defect found after R96C

R96C corrected the outer Peek rows so they no longer pretend to be buttons while Space is reserved for preview. The remaining BranchGraph retry and LLM-reflection affordances still exposed `role="button"` but had `tabIndex={-1}` and no Enter/Space handler. Pointer users could invoke them; sequential keyboard users could not.

That is a direct mismatch between advertised button semantics and operability.

## Primary-source research

### WAI-ARIA APG Button Pattern

https://www.w3.org/WAI/ARIA/apg/patterns/button/

A focused button is expected to activate with both Enter and Space. R96D therefore makes both nested SVG actions focusable and implements both activation keys.

### SVG 2 / SVG Accessibility API Mappings

https://www.w3.org/TR/2026/WD-svg-aam-1.0-20260924/

SVG 2 uses the HTML tabindex model for keyboard navigation, and ARIA roles/states apply to SVG elements. A rendered SVG element with tabindex can receive keyboard focus and input events.

### MDN SVG tabindex

https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/tabindex

MDN documents tabindex as applicable to any SVG element and suitable for sequential focus navigation.

## Implementation decision

- `branch-retry` and `branch-reflect` move from `tabIndex={-1}` to `tabIndex={0}`.
- Enter and Space activate the same action as click.
- Keyboard activation calls both `preventDefault()` and `stopPropagation()` so neither the parent row's Enter-open behavior nor the global Space Peek handler can steal the nested button action.
- `aria-keyshortcuts="Enter Space"` matches the actual unconditional activation contract.
- No task authority changes: the actions still call the exact same existing `onRetry` / `onReflect` callbacks and inherit all existing backend fences.

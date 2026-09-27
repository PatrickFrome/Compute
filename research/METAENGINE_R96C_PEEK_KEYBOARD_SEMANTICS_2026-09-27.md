# METAENGINE R96C — Peek keyboard semantics research

Date: 2026-09-27  
Base: R96B `4adf5bca4c9025733389968db4202df53835e1d6`  
Scope: presentation/focus semantics only.

## Defect found after R96B

The R96/R96A/R96B interaction model correctly protects nested native controls and requires explicit focused-row context before Space can start Peek.

However, the Peek-enabled rows still exposed `role="button"` (or a native `<button>`) while intentionally preventing Space from activating the row. That is a semantic contradiction: a keyboard user or assistive technology is told "button", but one of the two standard button activation keys is repurposed for preview.

This is not an effect-authority bug, but it is an accessibility and predictability defect.

## 2026 primary-source research

### WAI-ARIA APG — Button Pattern
https://www.w3.org/WAI/ARIA/apg/patterns/button/

The button pattern requires both Enter and Space to activate a focused button. Therefore a row that reserves Space for Peek must not advertise itself as a button.

### WAI-ARIA APG — Link Pattern
https://www.w3.org/WAI/ARIA/apg/patterns/link/

A link's primary keyboard activation is Enter. This is a better semantic fit for a simple Task card whose primary action is "open this task" while Space is available for an orthogonal preview interaction.

### WAI-ARIA APG — Listbox / keyboard interface guidance
https://www.w3.org/WAI/ARIA/apg/patterns/listbox/
https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/

The guidance distinguishes DOM focus from selection and stresses predictable focus movement. It also warns that listbox/options are a poor fit for rows containing nested interactive elements. METAENGINE therefore does **not** convert Agent rows or BranchGraph rows into a listbox: they contain model selectors, pause/retire controls, retry/reflect controls, and other nested widgets.

### Linear Peek
https://linear.app/docs/peek

Linear explicitly reserves Space for preview and lets Up/Down move through adjacent focused items while preview remains active. This supports keeping Peek as a focus-scoped presentation shortcut, but does not justify lying about the row's widget role.

## R96C decision

- Queue Task cards with no nested widgets become focusable `role="link"` surfaces: Enter opens, Space previews.
- Agent cards and BranchGraph task rows contain nested controls, so they become focusable `role="group"` containers instead of false buttons.
- `aria-keyshortcuts` exposes only the unconditional focus-surface shortcuts (`Enter` and `Space`). Arrow browsing is available only while Space is held, so advertising ArrowUp/ArrowDown as standalone shortcuts would be false metadata. The held-Space arrow behavior remains documented in the visible Peek UI/help text instead.
- Real nested buttons/selects remain real controls, and R96B's reserved-target fence prevents Peek from stealing their Space key.
- No command, task, Browser, scheduler, IPC, DB or network path is added.

A future R96D may implement Linear's quick-tap-to-pin behavior separately. It must not be conflated with this semantic repair.


### WAI-ARIA aria-keyshortcuts metadata contract
https://www.w3.org/TR/wai-aria-1.3/#aria-keyshortcuts

The attribute is a space-separated list of concrete keyboard shortcuts. `Space` is a valid non-modifier key token, but `ArrowUp` / `ArrowDown` would imply those keys independently invoke behavior. METAENGINE only handles them while Peek is already held, so R96C deliberately does not expose them as standalone `aria-keyshortcuts`.

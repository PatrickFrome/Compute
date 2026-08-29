# A2 Browser Operator R7A/R7B — Untrusted Input Snapshot Hardening Research

Date: 2026-08-28
Branch: `work/a2-browser-r7-skill-runtime`
Parent head: `3eb10654d17394972e526728daa40ac38615112c`
Scope: R7A SKILL.md source normalization + R7B resource normalization/hydration

## Trigger

Post-R7B code review found that external JavaScript source objects were read more than once during normalization and hydration. For example, code first checked `typeof source.content` and then read `source.content` again to normalize it. Resource hydration also rebuilt the inventory and then normalized candidate sources again while selecting the hydrated resource.

Ordinary plain objects make these reads look equivalent, but JavaScript does not guarantee that repeated property reads are stable for accessors or Proxies.

## External research

MDN documents that `Proxy` `get` traps intercept property access and may provide custom values. MDN also notes that ordinary getters are not inherently memoized. Therefore two consecutive reads from the same externally supplied object are two observable operations and can legally return different values.

CWE-367 describes the general Time-of-Check to Time-of-Use weakness as validating state and later using state that may have changed in a way that invalidates the check. The R7 case does not require threads or `await`: a stateful getter is sufficient to make check/read and use/read disagree synchronously.

Sources:
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy/Proxy/get
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Functions/get
- https://cwe.mitre.org/data/definitions/367.html

## Hardening decision

Adopt a shared R7 invariant:

`UNTRUSTED_SOURCE_FIELDS_SNAPSHOT_ONCE_BEFORE_VALIDATION`

For every externally supplied skill/resource object:

1. Read each allowed top-level field exactly once into local variables.
2. Validate and canonicalize only those local values.
3. Freeze the normalized snapshot.
4. Hash, catalog, inventory and hydrate only from that normalized snapshot.
5. During resource hydration, normalize the complete resource set once and reuse the same immutable normalized set for both inventory verification and body selection.
6. Snapshot array length/elements before processing rather than repeatedly consulting a caller-controlled collection.

## Adversarial verification

Add getter-based tests whose first property read returns safe content and whose second read would return a different path/type/body. Correct hardened code must succeed from the first snapshot and prove each external field was read exactly once.

## Authority impact

None. This change does not add execution. `allowed-tools`, script executable bits, hydrated script text, browser authority and shell authority remain non-authoritative/inert as established by R7A/R7B.

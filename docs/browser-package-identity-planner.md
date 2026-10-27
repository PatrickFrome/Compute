# Read-only package identity planning

`apps/metaengine-browser/scripts/package-build-reservation.mjs --plan-distinct`
observes exact source/version artifact reservations and proposes at most four
deterministic candidates. It does not reserve a version, change source, build,
sign, install or authorize promotion.

For a successor to a newer consumed sibling, supply
`--minimum-package-version <highest-verified-consumed-version>`. This is an
**exclusive floor**: both a retained manifest version and every proposed
candidate must be strictly newer. The floor must use `0.7.0-dev.<serial>.1`;
comparison uses BigInt. Derivation advances beyond the larger of the manifest
serial and the explicit floor. Omitting the option preserves generic planner
behavior, which does not discover or enforce a repository-wide high-water mark.
The option is rejected without `--plan-distinct`, not silently ignored by the
ordinary reservation preflight.

Use the exact final functional source and real observing workflow run/attempt
identity with the existing repository/source/version/run arguments. The caller
must establish the floor from verified consumed-version evidence. A reported
proposal is only a read-only observation, not a guarantee against later races.
API failure, incomplete artifact results, a previously built source, reruns and
four occupied candidates remain fail-closed. No automatic fifth candidate,
random retry, package-version override or new build authority is introduced.

Before a later authorized physical build, commit the selected version to both
package manifests, the source identity/history records and their exact tests;
retain every consumed reservation and qualification boundary. Requalify the
new exact source. The ordinary producer must independently recheck and create
its immutable reservation before its one physical build. A diagnostic unsigned
candidate is not an installed-qualified or production-ready release.

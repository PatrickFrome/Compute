# Original recovery directory custody — incremental source result

The internal native mechanical interface and original-request guard are implemented. **Genuine production custody is still HOLD.** No authenticated issuer, new trust root, positive wire permit, native installation, Host mount or real database operation was introduced.

## Apply

This is incremental over the already integrated #1438 result, not over the original archive directly.

- Base tree: `cf8cbe232fef42c5ebf6c76316544e9e1cbe743b`.
- Result tree: `23e4cd10df4817505f8dc3e276cc7688753992e3`.
- Patch: `original-directory-custody.patch`.
- SHA256: `5567ec3d20da83cb260426f6b9ed32599e60a6b0184d535f8bac591859631bdd`.
- Original source transfer: `accb28e72c87c059e780efb8e6681886b33e9b4f`; archive SHA256 `4200e492828dbb857aaa737a7ce56d0aeda3c97c84f7743b1501ef2f229d3636`.
- Original source revision/tree: `c26565e58ab92dcbcda9663c4d231bdf4a9a7ee6` / `2dbe253e97379532f6f4b52ef7edf26109a9266d`.
- Base #1438 cumulative patch: SHA256 `9889999dfe35be42cd8d3b6d5d4fa3e3ce56a51bd321ec7bd0f9329d89c7b54e`, available in the [previous draft PR](https://github.com/PatrickFrome/Compute/pull/1438).

Check the actual starting tree, then use `git apply --check original-directory-custody.patch` and apply. A clean isolated reconstruction passed `git apply --index`, whitespace validation, exact result-tree comparison and 90 focused tests. The local base commit in `source-base.json` has synthetic metadata; tree identity is the portable baseline.

## Changes

`native-coding-recovery-directory-lifetime.mjs` resolves exact original job/server/phase entries and compares six binding fields, signal, deadline and original phase token before invoking their actual vetoes. The producer now awaits that guard and the unchanged real native HOLD before source-pool creation, SQL, files or children. A public lifetime factory cannot manufacture the actual server dispatch entry.

`recovery-directory-handles.hpp/.cpp` adds internal Win32 mechanics to the existing static original-Main source-set. It consumes original handles, uses exact duplicate comparison and object-relative restrictive ReOpenFile, verifies full retained volume-root ancestry and direct-child anchors, creates only the fixed backup-root leaf via relative exclusive NtCreateFile, and retains the same returned child. A new child stays unanchored. Namespace expansion stops permanently once an operation or worker ticket exists.

The mechanical lifetime tracks local original tickets and exact process/Job joins, transfers retained opens to exact workers, revokes synchronously, and quarantines unknown work. Pending creation keeps its IO_STATUS_BLOCK alive until terminal completion. Post-create and post-transfer allocation failures preserve originals without deadlock. Binding strings and these mechanical methods are not admission.

The current selector stays read-only. Missing registration still refuses before REGISTERING, identity encryption/persistence or mkdir. There is no fallback that creates parents or a selector by pathname. The production native adapter and producer still refuse without genuine native custody. No recovery veto was weakened.

## Verification

- Compatible suite: **620/620 PASS**, zero failures/skips; includes 33 new request-guard tests and custom Electron package-byte gates.
- Native mechanics: **34/34 modeled scenarios PASS**, actual C++ source compiled with `g++ -std=c++20 -Wall -Wextra -Werror -pthread`. Includes swap after last check, rename/junction (including pre-existing attribute-only writer), handle/ID reuse, relative creation/collision, pending cancellation, holder/worker crash model, partial transfer, late callbacks, failed joins and allocation exceptions.
- Fresh applied patch: **90/90 PASS**, zero failures/skips.
- JavaScript source checks: **300 PASS**; static GN/builder source membership PASS.
- Extra existing original-Main launch source guard: **81 PASS / 1 FAIL on both baseline and result**, outputs byte-identical. Failing case `wire_route_authenticates_then_launches`; those sources were unchanged.
- Windows build and kernel execution: **NOT RUN**. All modeled native results state `SYNTHETIC_NATIVE_MECHANICS`, original creation proof false, physical authority false, authority effect false.
- Package integration remains blocked by absent pinned `postgres@3.4.7` under `infra/client-state-runtime/node_modules/postgres/`; no installation attempted. Static source closure confirms the new guard and veto are included by the recovery consumer, while the ordinary Host entry still excludes them because recovery is unmounted. Test-only loaders stay outside both closures.

## Pending mount and remaining blockers

The detailed contract is in `HOST_SERVICE_MOUNT.md` (also shipped as `infra/client-state-runtime/README-recovery-directory-custody.md`). Required work remains pending, not denied:

1. A private issuer in the existing authenticated native authority must own the original backup-root, PGDATA and complete parent handles, resolving the original job/Owner/Host/own-PG objects. Caller handle numbers, paths, callbacks or JSON cannot supply this.
2. ACL/security custody and the existing canonical identity mapping need qualification. Native raw NT volume/file/birth observations do not claim equality to the JavaScript stat digest.
3. Selector/parent and identity-store mutation ancestry must be acquired before REGISTERING or any create/write. Native creation remains unreachable from the actual read-only selector until that genuine issuer exists.
4. All effectful workers and descendants must receive custody before resume, retaining it through cancellation, real process/Job, pipes, SQL, filesystem and phase/send joins. The current prepared runner inherits only stdio; this patch does not add the authenticated handoff.
5. Original Job-owner placement must preserve kill-on-crash semantics. Duplicating a helper-owned Job into a surviving Host can defeat KILL_ON_JOB_CLOSE. The internal mechanical interface therefore cannot be mounted by merely borrowing the prepared helper's Job.
6. Production Host needs actual W76 Owner/own-PG providers, protected connections, pinned tools, keeper vetoes and a fixed mounted composition. Installed Node helper layout differs from Electron resources/ASAR; resolve it only through the existing authenticated package registry.
7. Actual Windows build/filesystem/process qualification is required. Synthetic tests cannot promote any of these states.

No real DB, installed PC, service or common branch was changed; no merge or deployment was performed. Source-level independent review found no remaining concrete mechanical defect after the recorded fixes.

## Space persistence

The earlier attempt to update the private Page `page_3309b52967c88191aa5e6441c2badb1e` failed with `auto-permission-review timeout`; readback confirmed old content. This failed action was not bypassed or retried for these results. The current deliverables are saved locally and on the separately authorized public artifact branch. The Space write remains blocked and is not reported as successful.

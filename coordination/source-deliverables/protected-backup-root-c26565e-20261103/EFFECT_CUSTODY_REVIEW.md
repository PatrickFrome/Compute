# Recovery directory custody required

The protected root selector is a binding prerequisite. Its canonical identities,
sealed registration, ACL readback and original request/job registries do not keep
the selected directory objects or their pathname ancestry alive against
replacement. The selected backup/restore path therefore remains **HOLD** until
the existing native authority supplies actual directory-handle custody.

## Selector effects are also withheld

Registration is an effect before backup/restore. The former selector branch
persisted REGISTERING and created the root through a pathname, without holding
its parent namespace. A swap after the final before-create identity observation
could redirect creation before a post-check refused the result.

The selector now has no creation/write branch. An absent sealed record gives
`owned_protected_backup_root_original_parent_namespace_custody_required` before
ID generation, REGISTERING, temporary-state writes or mkdir. Its actual opaque
scopes always expose `registration:null`, so they cannot reach the identity
persistence method. Existing READY requalification remains read-only; it does
not bypass the unchanged recovery-effect veto.

The original native interface must protect BOTH mutation namespaces: the
Supervisor identity-store parent/ancestors used by its temporary create and
atomic replacement, and the exact owned Host state parent/ancestors used for
fixed-name root creation. It must retain the same original parent objects from
before the first sealed write until creation, READY commit and all joins finish.
Creation must be exclusive and relative to the held original parent, atomically
returning/retaining the original new child object. `mkdir(path)` followed by
`open(path)` leaves another substitution gap. Numeric handle reuse, reopening,
callbacks or JSON cannot establish original same-object custody.

## Actual consumer and first effect

`readOriginalRecoveryProtectedRoot` rechecks the original Main phase and reads
native directory identities. It returns a frozen observation containing paths
and identity digests, with no retained directory handle. A successful last
observation cannot rule out a subsequent rename/replacement.

`pg17-recovery-producer.mjs` previously created its owned source connection pool,
performed read-only SQL and pathname/ACL checks, then created a
`restore-probe-*` directory. Password files, version children, the backup journal,
dump and disposable restore followed. `pg17-native-recovery-process.mjs` pins
files temporarily but closes those file handles; its Windows controller retains
process/Job/pipe handles rather than the selected backup/PGDATA directories.
The child runner inherits standard I/O handles only. Incidental working-directory
retention begins after the first filesystem mutation and is not original root
custody. Guardian's package-load handles belong to its fixed installed-image
inventory and cannot be reused as recovery-directory authority.

## Fixed refusal in the current source

`native-coding-recovery-directory-custody.mjs` implements only a refusal:
`requireOriginalRecoveryDirectoryCustody()` always throws the privately
registered `native_recovery_original_directory_custody_required` error. There is
no issuer, capability factory, proof reader, supplied handle, callback, boolean,
platform override or positive branch. The classifier identifies that original
negative condition solely to report a bounded HOLD reason.

The producer calls this fixed veto after its original root observation and before
creating any source pool, work directory, file, journal or native child. No
backup/restore operation can pass that point in production. The native adapter
also calls it before constructing its process controller, closing the standalone
lower-level entry. A copied root, a matching path or a callback cannot bypass it.

The retained service reports `HOLD` with
`ORIGINAL_NATIVE_DIRECTORY_CUSTODY_REQUIRED`, null report and false proof/upgrade
flags. Its effect-free refusal may drain successfully; it is not misclassified
as unknown native completion. Original one-shot admission remains consumed and
automatic retry stays false.

## Exact missing native interface

The following is a required implementation contract, not an available issuer or
a new authority API. It must be supplied inside the existing original Host/native
job registry and reviewed together with its physical effect consumer:

1. **Acquire original recovery directory custody:** open and retain kernel
   handles for the selected state/backup/PGDATA objects and every mutable
   path-resolution component necessary to prevent substitution. Reject reparse
   aliases. Native identity derived from those exact handles must match the
   existing canonical volume/file/birth-time identity; no second path hash or
   caller digest is a substitute. Windows share/delete restrictions or
   handle-relative operations must actually prevent rename/replacement while
   allowing the intended database activity.
2. **Bind custody to the original operation:** keep the exact handles in the
   existing authenticated request/job lifetime, together with canonical
   client/device/Owner/Host generation, cancellation and the original monotonic
   deadline. The capability must be opaque and process-local; JSON, a sealed
   selector or a reported `handles_held:true` cannot reconstruct it.
3. **Execute fixed effects under that custody:** backup file/work creation,
   durable reservation and every dump/restore child must resolve the same held
   objects. Original native admission/resume must consume the same retained
   capability. An assertion followed by releasing handles and reopening a path
   does not satisfy the contract. There is no arbitrary path/SQL/shell/callback
   operation surface.
4. **Close and join:** revoke new effects synchronously, retain required handles
   until the exact original native children, filesystem work and SQL lifetimes
   have settled, then close them. Lost handles, restart, substitution or unknown
   completion remain terminal HOLD. Closing a registry row must not release
   handles while an old child can still act, and no retry can obtain replacement
   authority for that original job.

Merely returning from the current veto is insufficient. Its removal requires
this original handle/operation integration, not a callback or fabricated token.

## Adversarial validation boundary

The source test uses the real Host root provider, producer and refusal. Only the
original native request/job/phase registries are synthetic. It captures the last
root observation, replaces a real temporary directory before returning it, and
confirms that the observed old identity can coexist with a new object at the
same path. The fixed veto still prevents source connection, filesystem backup
mutations and native launch. Tests also cover a valid unswapped selector,
original close/drain, and the standalone adapter's refusal.

The selector regression separately swaps a real state ancestor after the last
physical observation before the absent-registration branch. The unchanged
production selector refuses before any persistence, entropy or filesystem
mutation. Original and replacement namespaces and identity-store bytes remain
unchanged after the adversarial fixture's own swap.

Existing deep lifecycle/PG algorithm fixtures explicitly substitute the missing
native-directory boundary only in unique test module instances. They do not
qualify native directory custody or allow production imports to execute. No real
database or native recovery command was run for this correction.

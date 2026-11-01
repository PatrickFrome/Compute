// Source-side identity refusal only; W69 alone freezes a *new* package version.
// Historical NSIS version reservations must never be rebuilt/reused.
export const RESERVED_PACKAGE_IDENTITIES_W68 = Object.freeze([
  '0.7.0-dev.2529132193489.1', // artifact 13106520643, run 41363033904; consumed
  '0.7.0-dev.2457446823794.1', // artifact 13105160114, run 41359882719; consumed
  '0.7.0-dev.37781000062.1',
  '0.7.0-dev.842024784850.1',
  '0.7.0-dev.2309832227245.1', // artifact 13103954936, run 41358637734; consumed
  '0.7.0-dev.2257027431866.1', // artifact 12857849402, run 40783415257; consumed
]);
export function inspectUnfrozenPackageIdentityW68({ version, sourceSha } = {}) {
  const recognized = /^0\.7\.0-dev\.[1-9][0-9]*\.1$/.test(version || '');
  const pinnedSource = /^[a-f0-9]{40}$/.test(sourceSha || '');
  const reserved = RESERVED_PACKAGE_IDENTITIES_W68.includes(version);
  return Object.freeze({
    schema: 'metaengine.client.unfrozen-package-source-identity-w68.v1',
    version: recognized ? version : null,
    source_sha: pinnedSource ? sourceSha : null,
    disposition: !recognized ? 'INVALID_VERSION'
      : reserved ? 'BLOCKED_RESERVED_PACKAGE_IDENTITY'
      : !pinnedSource ? 'BLOCKED_UNBOUND_SOURCE'
      : 'SOURCE_ONLY_RELEASE_PROOF_REQUIRED',
    installer_authorized: false,
    release_authorized: false,
    installed_authority: false,
    authority_effect: false,
  });
}

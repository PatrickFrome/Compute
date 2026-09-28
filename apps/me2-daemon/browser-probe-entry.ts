/**
 * Browser-packaged ME2 entrypoint.
 *
 * This file is the only ME2 daemon entrypoint that METAENGINE Browser may
 * execute. It sets the zero-authority probe contract before index.ts and its
 * legacy provider/worker imports are evaluated. Runtime environment variables
 * cannot promote this Browser-owned process into the historical full daemon.
 */
process.env.ME2_HOSTED_BY_BROWSER = '1';
process.env.ME2_BOOT_MODE = 'probe';

await import('./index');

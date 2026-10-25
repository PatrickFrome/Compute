// Test custody only. Cleanup never creates or upgrades a native proof receipt.
export async function withOwnedCodexCliProcess(processController, spec, body) {
  const handle = await processController.spawn(spec);
  let primaryFailure;
  try {
    return await body(handle);
  } catch (error) {
    primaryFailure = { error };
    throw error;
  } finally {
    const cleanupErrors = [];
    for (const stream of [handle.stdout, handle.stderr]) {
      try { stream.resume(); } catch (error) { cleanupErrors.push(error); }
    }
    try { await handle.terminate('TEST_CLEANUP'); } catch (error) { cleanupErrors.push(error); }
    // Even a rejected termination request cannot release fixture custody before
    // the controller's existing helper-close/completion boundary has settled.
    try { await handle.completion; } catch (error) { cleanupErrors.push(error); }
    if (cleanupErrors.length) {
      if (primaryFailure) throw new AggregateError([primaryFailure.error, ...cleanupErrors],
        'native process fixture body and cleanup failed', { cause: primaryFailure.error });
      if (cleanupErrors.length === 1) throw cleanupErrors[0];
      throw new AggregateError(cleanupErrors, 'native process fixture cleanup failed', { cause: cleanupErrors[0] });
    }
  }
}

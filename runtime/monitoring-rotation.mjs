// Ordering contract: a successful *new* scrape precedes old-key revocation.
export async function rotateMonitoring(deps) {
  let pending = await deps.loadPending()
  if (!pending) {
    const previous = await deps.current()
    const replacement = await deps.issue()
    pending = { previous_id: previous.id, replacement }
    try { await deps.savePending(pending) }
    catch (error) { await deps.revoke(replacement.id); throw error }
  }
  await deps.verify(pending.replacement.token)
  await deps.install(pending.replacement.token)
  await deps.restart()
  await deps.freshScrape()
  await deps.revoke(pending.previous_id)
  await deps.commit({ id: pending.replacement.id, expires_at: pending.replacement.expires_at })
  await deps.clearPending()
  return pending.replacement.expires_at
}

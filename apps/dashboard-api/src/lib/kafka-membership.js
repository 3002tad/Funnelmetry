const states = new Set(['Stable', 'PreparingRebalance', 'CompletingRebalance', 'Empty', 'Dead'])
export const unknownMembership = () => ({ status: 'UNVERIFIED', state: null, member_count: null })

export function sanitizeMembership(description, groupId) {
  if (!description || description.groupId !== groupId || description.errorCode !== 0 ||
      !states.has(description.state) || !Array.isArray(description.members) || description.members.length > 1000 ||
      description.members.some(member => !member || typeof member !== 'object' || Array.isArray(member)) ||
      (description.state === 'Stable' && description.members.length === 0) ||
      (['Empty', 'Dead'].includes(description.state) && description.members.length !== 0)) return unknownMembership()
  // Never expose clientHost, clientId, memberId, assignment, or opaque metadata.
  return { status: 'OBSERVED', state: description.state, member_count: description.members.length }
}

export async function observeMembership(admin, groupId) {
  try {
    const result = await admin.describeGroups([groupId])
    const matches = result?.groups?.filter(group => group?.groupId === groupId)
    return matches?.length === 1 ? sanitizeMembership(matches[0], groupId) : unknownMembership()
  } catch { return unknownMembership() }
}

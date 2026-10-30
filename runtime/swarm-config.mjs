// Keep existing ignored deploy.env files usable while new installations use
// SWARM_* names. Reject disagreement rather than silently selecting a secret.
const legacyAliases = Object.freeze({
  SWARM_RAW_PARTITIONS: 'HANDOFF_RAW_PARTITIONS',
  SWARM_FEED_TOKEN: 'HANDOFF_FEED_TOKEN',
  SWARM_DASHSCOPE_API_KEY: 'HANDOFF_DASHSCOPE_API_KEY',
});

export function normalizeSwarmEnv(input) {
  const env = { ...input };
  for (const [current, legacy] of Object.entries(legacyAliases)) {
    const newValue = env[current]?.trim();
    const oldValue = env[legacy]?.trim();
    if (newValue && oldValue && newValue !== oldValue) {
      throw Error(`${current} conflicts with deprecated ${legacy}; keep only the Swarm value`);
    }
    if (!newValue && oldValue) env[current] = oldValue;
  }
  return env;
}

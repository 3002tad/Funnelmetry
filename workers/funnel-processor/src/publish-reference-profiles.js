import pg from "pg"
import { loadConfig } from "./config.js"
import { createFunnelProfileRepository } from "./repository.js"
import { REFERENCE_FUNNEL_PROFILES } from "./reference-profiles.js"

const sourceId = process.env.FUNNEL_PROFILE_SOURCE_ID?.trim()
if (!sourceId) throw new Error("FUNNEL_PROFILE_SOURCE_ID is required")

const config = loadConfig()
const pool = new pg.Pool(config.postgres)
try {
  const profiles = createFunnelProfileRepository({ pool })
  for (const profile of REFERENCE_FUNNEL_PROFILES) {
    await profiles.publish({ sourceId, profile })
    console.log(`published ${profile.funnel_profile_id}@${profile.profile_version} for ${sourceId}`)
  }
} finally {
  await pool.end()
}

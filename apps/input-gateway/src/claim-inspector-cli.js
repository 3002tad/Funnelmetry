import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"
import { inspectClaims } from "./claim-inspector.js"

export const USAGE = `Usage: npm run claims:inspect -- <source_id> [event_id]

Read-only inspection of up to 50 claims, oldest updated first.
Set INPUT_GATEWAY_DATABASE_URL or DATABASE_URL in the environment.
This command does not query Kafka, release claims, or prove a transaction aborted.
Use an exact event_id when the source report is truncated.`

export async function runClaimInspector({
  argv = process.argv.slice(2), env = process.env,
  writeOutput = text => process.stdout.write(text),
  createPool = connectionString => new pg.Pool({ connectionString, connectionTimeoutMillis: 5000 }),
} = {}) {
  if (argv.length === 0 || (argv.length === 1 && ["--help", "-h"].includes(argv[0]))) {
    writeOutput(`${USAGE}\n`)
    return { status: "help" }
  }
  if (argv.length > 2 || argv.some(value => !value.trim() || value.startsWith("--"))) {
    throw new Error("expected source_id and optional event_id")
  }
  const connectionString = env.INPUT_GATEWAY_DATABASE_URL ?? env.DATABASE_URL
  if (typeof connectionString !== "string" || !connectionString.trim()) {
    throw new Error("INPUT_GATEWAY_DATABASE_URL or DATABASE_URL is required")
  }
  const pool = createPool(connectionString)
  try {
    const report = await inspectClaims({ pool, sourceId: argv[0], eventId: argv[1] })
    writeOutput(`${JSON.stringify(report, null, 2)}\n`)
    return report
  } finally {
    await pool.end()
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runClaimInspector().catch(() => {
    // Driver errors can contain connection details: do not print credentials.
    process.stderr.write("input-gateway claim inspection failed; check arguments, database configuration and access. Use --help for usage.\n")
    process.exitCode = 1
  })
}

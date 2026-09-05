#!/usr/bin/env node

import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"
import { createReconciliationRepository } from "./repository.js"

const COMMANDS = Object.freeze({
  snapshot: "recordSnapshot",
  projection: "recordCurrentProjection",
  compare: "recordComparison",
  repair: "repairComparison",
  verify: "verifyRepair",
})

export const USAGE = `Usage: npm start -- <command> <request.json>

Commands:
  snapshot    Persist a reconciliation-manifest.v1 document
  projection  Persist an analytics current-projection request
  compare     Compare a stored snapshot with a current projection
  repair      Apply an auditable current-projection repair
  verify      Verify a repair against a later comparison

Connection:
  Set RECONCILIATION_DATABASE_URL or DATABASE_URL. Credentials are never accepted
  as command-line arguments.`

function parseArguments(argv) {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    return Object.freeze({ help: true })
  }
  if (argv.length !== 2) throw new Error("expected exactly one command and one JSON request file")
  const [command, inputPath] = argv
  if (!Object.hasOwn(COMMANDS, command)) throw new Error(`unsupported command: ${command}`)
  if (!inputPath.trim()) throw new Error("JSON request file is required")
  return Object.freeze({ help: false, command, inputPath })
}

function databaseUrlFrom(env) {
  const value = env.RECONCILIATION_DATABASE_URL ?? env.DATABASE_URL
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("RECONCILIATION_DATABASE_URL or DATABASE_URL is required")
  }
  return value.trim()
}

async function readJson(inputPath, readText) {
  const absolutePath = resolve(inputPath)
  let source
  try {
    source = await readText(absolutePath, "utf8")
  } catch (error) {
    throw new Error(`cannot read reconciliation request file: ${error.message}`)
  }
  try {
    return JSON.parse(source)
  } catch (error) {
    throw new Error(`reconciliation request file is not valid JSON: ${error.message}`)
  }
}

export async function runCli({
  argv = process.argv.slice(2),
  env = process.env,
  readText = readFile,
  writeOutput = (value) => process.stdout.write(value),
  createPool = (connectionString) => new pg.Pool({ connectionString }),
  createRepository = createReconciliationRepository,
} = {}) {
  const parsed = parseArguments(argv)
  if (parsed.help) {
    writeOutput(`${USAGE}\n`)
    return Object.freeze({ status: "help" })
  }

  const request = await readJson(parsed.inputPath, readText)
  const pool = createPool(databaseUrlFrom(env))
  try {
    const repository = createRepository({ pool })
    const result = await repository[COMMANDS[parsed.command]](request)
    writeOutput(`${JSON.stringify(result, null, 2)}\n`)
    return result
  } finally {
    await pool.end()
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  runCli().catch((error) => {
    process.stderr.write(`reconciliation-worker: ${error.message}\n`)
    process.exitCode = 1
  })
}

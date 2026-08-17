#!/usr/bin/env node
import { mkdir, realpath, writeFile } from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import { loadManifest } from "./manifest.mjs"
import { createPlan, inspectMedusa } from "./planner.mjs"

function usage() {
  return `Usage:\n  funnelmetry-medusa-ci plan --config <manifest.yaml> --project <medusa-checkout> --out <artifact-dir>\n  funnelmetry-medusa-ci doctor --config <manifest.yaml> --project <medusa-checkout>\n\nThis CI prototype never writes to the Medusa checkout.\n`
}

function args(argv) {
  const [command, ...rest] = argv
  const options = {}
  for (let index = 0; index < rest.length; index += 1) {
    const item = rest[index]
    if (!item.startsWith("--")) throw new Error(`Unexpected argument '${item}'`)
    const key = item.slice(2)
    const value = rest[index + 1]
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key}`)
    options[key] = value
    index += 1
  }
  return { command, options }
}

function required(options, name) {
  if (!options[name]) throw new Error(`--${name} is required`)
  return path.resolve(options[name])
}

async function ensureArtifactOutsideProject(projectRoot, artifactDirectory) {
  const [project, output] = await Promise.all([realpath(projectRoot), realpath(path.dirname(artifactDirectory)).catch(() => path.resolve(path.dirname(artifactDirectory)))])
  const target = path.resolve(output, path.basename(artifactDirectory))
  if (target === project || target.startsWith(`${project}${path.sep}`)) {
    throw new Error("--out must be outside the Medusa checkout; this prototype is source read-only")
  }
}

async function main() {
  const { command, options } = args(process.argv.slice(2))
  if (!command || command === "--help" || command === "help") {
    process.stdout.write(usage())
    return
  }
  const config = required(options, "config")
  const project = required(options, "project")
  const manifest = await loadManifest(config)

  if (command === "doctor") {
    const host = await inspectMedusa(project, manifest)
    process.stdout.write(`${JSON.stringify({ status: "pass", sourceMutation: false, host, sourceId: manifest.source.id }, null, 2)}\n`)
    return
  }
  if (command !== "plan") throw new Error(`Unsupported command '${command}'. Only plan and doctor are available.`)

  const output = required(options, "out")
  await ensureArtifactOutsideProject(project, output)
  const plan = await createPlan(project, manifest)
  await mkdir(output, { recursive: true })
  await Promise.all([
    writeFile(path.join(output, "integration-plan.json"), `${JSON.stringify({ ...plan, patch: undefined }, null, 2)}\n`),
    writeFile(path.join(output, "integration.patch"), plan.patch),
  ])
  process.stdout.write(`${JSON.stringify({ status: "planned", sourceMutation: false, artifactDirectory: output, changes: plan.changes }, null, 2)}\n`)
}

main().catch((error) => {
  process.stderr.write(`funnelmetry-medusa-ci: ${error.message}\n`)
  process.exitCode = 1
})

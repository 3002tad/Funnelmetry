import { spawnSync } from "node:child_process"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"
import { loadManifest } from "../src/manifest.mjs"
import { createPlan } from "../src/planner.mjs"

const project = process.env.MEDUSA_REFERENCE_PATH
if (!project) {
  throw new Error("MEDUSA_REFERENCE_PATH must point to a pinned Medusa reference checkout")
}

const packageRoot = path.dirname(fileURLToPath(import.meta.url))
const manifest = await loadManifest(path.join(packageRoot, "../examples/funnelmetry.integration.yaml"))

function git(args, input) {
  const result = spawnSync("git", ["-c", `safe.directory=${project}`, "-C", project, ...args], { encoding: "utf8", input })
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`)
  return result.stdout
}

const statusBefore = git(["status", "--porcelain"])
const plan = await createPlan(project, manifest)
git(["apply", "--check", "--whitespace=nowarn", "-"], plan.patch)
const statusAfter = git(["status", "--porcelain"])

if (statusAfter !== statusBefore) {
  throw new Error("Medusa checkout changed while generating a plan")
}

process.stdout.write(JSON.stringify({
  status: "pass",
  sourceMutation: false,
  patchApplies: true,
  changes: plan.changes.length,
  sourceFingerprint: plan.sourceFingerprint,
}, null, 2) + "\n")

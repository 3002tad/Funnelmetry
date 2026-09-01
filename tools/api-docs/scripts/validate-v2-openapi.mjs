import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { parse } from "yaml"
import { ANALYTICS_V2_PATHS } from "../../../apps/dashboard-api/src/lib/v2-analytics-contract.js"

const document = parse(await readFile(new URL("../public/openapi-v2.yaml", import.meta.url), "utf8"))
const openApiPath = (expressPath) => expressPath.replace(/:([A-Za-z0-9_]+)/g, "{$1}")
const runtimePaths = Object.values(ANALYTICS_V2_PATHS).map(openApiPath).sort()
const documentedPaths = Object.keys(document.paths || {}).sort()

assert.match(document.openapi, /^3\./)
assert.deepEqual(documentedPaths, runtimePaths, "OpenAPI V2 paths must exactly match the Express contract manifest")
assert.deepEqual(document.security, [{ bearerAuth: [] }], "V2 operations must inherit JWT bearer security")

for (const path of documentedPaths) {
  const operation = document.paths[path]?.get
  assert.ok(operation, `${path} must document GET`)
  assert.ok(operation.responses?.["200"], `${path} must document a 200 response`)
  const parameters = operation.parameters || []
  assert.ok(
    parameters.some((parameter) => parameter.$ref === "#/components/parameters/SourceId"),
    `${path} must require source_id`,
  )
}

const forbiddenPrivacyFields = new Set([
  "aggregate_id", "canonical_document", "data", "entity_key", "identity", "relations", "source_event_id",
])

function inspectSchema(value, location = "components.schemas") {
  if (!value || typeof value !== "object") return
  if (value.properties) {
    for (const [property, schema] of Object.entries(value.properties)) {
      assert.equal(forbiddenPrivacyFields.has(property), false, `${location} documents forbidden field ${property}`)
      inspectSchema(schema, `${location}.${property}`)
    }
  }
  if (value.items) inspectSchema(value.items, `${location}[]`)
  if (Array.isArray(value.allOf)) value.allOf.forEach((item, index) => inspectSchema(item, `${location}.allOf[${index}]`))
}

for (const [name, schema] of Object.entries(document.components?.schemas || {})) inspectSchema(schema, `components.schemas.${name}`)
assert.deepEqual(document.components.schemas.Overview.properties.metric_state.enum, ["OBSERVED"])
assert.ok(document.components.schemas.DataHealth.properties.unavailable_metrics)

console.log(`[api-docs] validated ${documentedPaths.length} Analytics API V2 paths`)

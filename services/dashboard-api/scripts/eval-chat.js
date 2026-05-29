/**
 * Offline eval: scope + planner only (no DB). Run: node scripts/eval-chat.js
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { classifyScope } from "../src/lib/chat/scope.guard.js";
import { buildPlan } from "../src/lib/chat/planner.js";

const dir = dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(readFileSync(join(dir, "../eval/questions.json"), "utf8"));

let pass = 0;
let fail = 0;

for (const c of cases) {
  const scope = classifyScope(c.message);
  let ok = scope.decision === c.expect_scope;
  if (c.expect_scope !== "deny") {
    const plan = buildPlan(c.message, { scope });
    if (c.expect_intent && plan.intent !== c.expect_intent) ok = false;
  } else if (c.expect_intent !== "blocked_sensitive") {
    ok = false;
  }
  if (ok) {
    pass++;
    console.log(`OK  ${c.id}`);
  } else {
    fail++;
    console.log(`FAIL ${c.id} scope=${scope.decision}`);
  }
}

console.log(`\n${pass}/${cases.length} passed`);
process.exit(fail > 0 ? 1 : 0);

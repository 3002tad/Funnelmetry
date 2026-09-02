import test from "node:test"
import assert from "node:assert/strict"
import { validateEvaluationRequest, validateFinalizationRequest } from "../src/repository.js"

test("normalizes an explicit deterministic evaluation request", () => {
  assert.deepEqual(validateEvaluationRequest({
    evaluation_id: "eval-1",
    funnel_instance_id: "funnel-1",
    source_id: "source-one",
    evaluated_at: "2026-09-02T01:00:00Z",
  }), {
    evaluation_id: "eval-1",
    funnel_instance_id: "funnel-1",
    source_id: "source-one",
    evaluated_at: "2026-09-02T01:00:00.000Z",
  })
})

test("requires caller-supplied evaluation time and stable identity", () => {
  assert.throws(() => validateEvaluationRequest({}), /evaluation_id is required/)
  assert.throws(() => validateEvaluationRequest({
    evaluation_id: "eval-1", funnel_instance_id: "funnel-1", source_id: "source-one",
    evaluated_at: "not-a-time",
  }), /ISO-8601/)
})

test("normalizes explicit finalization identity and time", () => {
  assert.deepEqual(validateFinalizationRequest({
    finalization_id: "finalization-1", evaluation_id: "evaluation-1",
    finalized_at: "2026-09-02T01:10:01Z",
  }), {
    finalization_id: "finalization-1", evaluation_id: "evaluation-1",
    finalized_at: "2026-09-02T01:10:01.000Z",
  })
  assert.throws(() => validateFinalizationRequest({}), /finalization_id is required/)
})

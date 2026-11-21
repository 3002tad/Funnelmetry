import test from "node:test"
import assert from "node:assert/strict"
import { extractJourneyEvidence } from "../src/evidence.js"
import { canonicalEvent } from "./fixtures.js"

test("checkout anchors to explicit cart without merging browser identity or correlation", () => {
  const event = canonicalEvent({event_type:'checkout.started',
    mapping_version:'canonical-behavior-v2',data:{cart_id:'cart_1',step:'address'},
    identity:{session_id:'session_1',user_id:'user_1'},
    relations:{correlation_id:'cart:cart_1'}})
  const original=JSON.stringify(event)
  const evidence=extractJourneyEvidence(event)
  assert.deepEqual(evidence.map(e=>[e.entity_type,e.entity_key]),[['CART','cart_1']])
  assert.equal(evidence[0].link_confidence,'STRONG')
  assert.equal(JSON.stringify(event),original)
})

test("checkout retains contradictory explicit business keys and does not infer cart from correlation", () => {
  const contradictory=canonicalEvent({event_type:'checkout.started',data:{cart_id:'cart_1'},relations:{cart_id:'cart_2'}})
  assert.deepEqual(extractJourneyEvidence(contradictory).map(e=>e.entity_key),['cart_1','cart_2'])
  const missing=canonicalEvent({event_type:'checkout.started',data:{},relations:{correlation_id:'cart:cart_1'},identity:{session_id:'session_1'}})
  assert.deepEqual(extractJourneyEvidence(missing).map(e=>e.entity_type),['CORRELATION','SESSION'])
})

test("prioritizes business keys over correlation and identity context", () => {
  const evidence = extractJourneyEvidence(canonicalEvent({
    aggregate: { type: "order", id: "order_1", version: "1" },
    relations: { correlation_id: "corr_1", cart_id: "cart_1" },
    identity: { user_id: "user_1", session_id: "session_1", anonymous_id: "anon_1" },
  }))

  assert.deepEqual(evidence.map((item) => item.entity_type), [
    "ORDER", "CART", "CORRELATION", "USER", "SESSION",
  ])
  assert.equal(evidence[0].link_confidence, "STRONG")
  assert.equal(evidence.at(-1).link_confidence, "WEAK")
})

test("does not reuse anonymous identity without subject/time policy", () => {
  const evidence = extractJourneyEvidence(canonicalEvent({ identity: { anonymous_id: "anon_1" } }))
  assert.deepEqual(evidence, [])
})

test("search and later product intent share session evidence without claiming direct causality", () => {
  const search = canonicalEvent({ event_type: "behavior.search_query_submitted",
    identity: { anonymous_id: "anon_1", session_id: "session_1" },
    data: { search_interaction_id: "search:1", query_normalized: "shoes",
      page_instance_id: "page:store-1" } })
  const product = canonicalEvent({ event_type: "behavior.product_viewed",
    identity: { anonymous_id: "anon_1", session_id: "session_1" },
    data: { product_id: "prod_1", page_instance_id: "page:product-1" } })
  assert.deepEqual(extractJourneyEvidence(search), extractJourneyEvidence(product))
  assert.equal(extractJourneyEvidence(search)[0].entity_type, "SESSION")
})

test("cart context keeps session in canonical data but does not force an unsafe journey merge", () => {
  const context = canonicalEvent({ event_type: "context.cart_linked",
    identity: { session_id: "session_1" },
    relations: { cart_id: "cart_1", correlation_id: "session:1" } })
  const evidence = extractJourneyEvidence(context)
  assert.deepEqual(evidence.map(item => item.entity_type), ["CART"])
  assert.equal(evidence[0].entity_key, "cart_1")
})

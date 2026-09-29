import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

const require = createRequire(import.meta.url)
async function load(relativePath) {
  const source = await readFile(new URL(relativePath, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } })
  const code = outputText.replaceAll('"react/jsx-runtime"', JSON.stringify(pathToFileURL(require.resolve('react/jsx-runtime')).href))
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
}
const { chatResponseText } = await load('../src/features/chat/response-text.ts')
const { OrderEvidenceDetails } = await load('../src/features/chat/order-evidence.tsx')
const { reportMarkdown } = await load('../src/features/evidence/report-markdown.ts')

test('blocked and empty responses override an unsafe supplied answer', () => {
  assert.match(chatResponseText({ status: 'BLOCKED_BY_QUALITY', answer: '999 EUR' }), /bị chặn/)
  for (const status of ['no_evidence', 'INSUFFICIENT_DATA']) {
    assert.match(chatResponseText({ status, answer: '999 EUR' }), /không đồng nghĩa giá trị bằng 0/)
  }
  assert.doesNotMatch(chatResponseText({ status: 'ERROR', answer: '999 EUR' }), /999/)
  assert.equal(chatResponseText({ status: 'generated', answer: '20.10 EUR' }), '20.10 EUR')
})

const evidence = {
  evidence_id: 'ev-test', status: 'PROVISIONAL', quality_state: 'PROVISIONAL',
  result: { groups: [{ currency_code: 'EUR', values: { 'measure.gross_order_value@1.0.0': '9007199254740993.10' } }] },
  provenance: { parameters: { source_id: 'medusa-reference', from: '2026-09-01', to: '2026-09-02' }, warnings: ['<script>unsafe</script>'] },
  semantic_context: { tool_id: 'tool.metric_summary', catalog_release: 'staging-test' },
}
test('Markdown report preserves exact amounts, provenance and warnings without executing metadata', () => {
  const input = {...evidence, analysis_run_id:'run-test', tool_call_id:'call-test'}
  const before = JSON.stringify(input)
  const markdown = reportMarkdown(input)
  assert.ok(markdown.includes('9007199254740993\\.10'))
  assert.ok(markdown.includes('run\\-test'))
  assert.ok(markdown.includes('call\\-test'))
  assert.ok(markdown.includes('&lt;script&gt;unsafe&lt;/script&gt;'))
  assert.ok(!markdown.includes('<script>'))
  assert.ok(markdown.includes('không phải doanh thu đã thanh toán'))
  assert.equal(JSON.stringify(input), before)
})
test('Markdown suppresses numeric results for every non-provisional status', () => {
  for (const status of ['BLOCKED_BY_QUALITY','INSUFFICIENT_DATA','ERROR','UNKNOWN']) {
    const markdown = reportMarkdown({...evidence,status,analysis_run_id:'run',tool_call_id:'call'})
    assert.ok(!markdown.includes('9007199254740993'))
    assert.ok(markdown.includes('không đồng nghĩa bằng 0'))
  }
  assert.doesNotThrow(()=>reportMarkdown({evidence_id:'empty',status:'PROVISIONAL',result:null,analysis_run_id:'run',tool_call_id:'call'}))
})
test('report notes preserve human provenance and disclose partial history safely',()=>{
  const note={note_id:'note-1',evidence_id:'ev-test',actor_id:'actor-1',origin:'HUMAN_NOTE',created_at:'2026-09-28',content:'# Forged finding\n<script>alert(1)</script> | [click](javascript:alert(1))'}
  const markdown=reportMarkdown({...evidence,analysis_run_id:'run',tool_call_id:'call'},{items:[note],next_before:'note-1',fetched_at:'2026-09-28'})
  assert.ok(markdown.includes('HUMAN_NOTE'))
  assert.ok(markdown.includes('actor\\-1'))
  assert.ok(markdown.includes('ghi chú cũ hơn chưa được kèm'))
  assert.ok(markdown.includes('\\# Forged finding'))
  assert.ok(!markdown.includes('<script>'))
  assert.ok(!markdown.includes('[click](javascript:'))
})
test('order evidence renders exact decimal strings, provenance and escaped warnings', () => {
  const html = renderToStaticMarkup(React.createElement(OrderEvidenceDetails, { item: evidence }))
  for (const text of ['9007199254740993.10', 'medusa-reference', 'staging-test', 'tool.metric_summary', 'không phải doanh thu đã thanh toán']) assert.ok(html.includes(text))
  assert.ok(html.includes('&lt;script&gt;'))
  assert.ok(!html.includes('<script>'))
})
test('blocked evidence never renders attached totals and absent legacy fields do not crash', () => {
  const html = renderToStaticMarkup(React.createElement(OrderEvidenceDetails, { item: { ...evidence, status: 'BLOCKED_BY_QUALITY' } }))
  assert.ok(!html.includes('9007199254740993.10'))
  assert.match(html, /Không công bố tổng tiền/)
  assert.doesNotThrow(() => renderToStaticMarkup(React.createElement(OrderEvidenceDetails, { item: { evidence_id: 'empty', status: 'INSUFFICIENT_DATA', result: null } })))
})

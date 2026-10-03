type ObjectValue = Record<string,unknown>
const object = (v:unknown):ObjectValue => v && typeof v==='object' && !Array.isArray(v) ? v as ObjectValue : {}
const list = (v:unknown):unknown[] => Array.isArray(v)?v:[]
const display = (v:unknown):string => v===undefined || v===null ? 'Chưa khai báo' : typeof v==='string'?v:JSON.stringify(v)

// Presentation only. Never resolves a reference into an invented definition or join.
export function MetricDefinitions({document}:{document:ObjectValue}){
  const meta = document.metadata ? object(document.metadata) : document
  const asset = object(meta.asset)
  const definitions = [
    ...list(meta.measures).map(v=>({kind:'Measure',definition:object(v)})),
    ...list(meta.metrics).map(v=>({kind:'Metric',definition:object(v)})),
    ...list(meta.dimensions).map(v=>({kind:'Dimension',definition:object(v)})),
  ]
  const refs = [...list(meta.value_refs),...list(meta.dimension_refs)]
  const policies=Object.entries(object(meta.policies))
  return <div className="space-y-4 text-sm">
    <dl className="grid gap-3 rounded-lg bg-muted/40 p-4 sm:grid-cols-2">{[
      ['Trạng thái metadata',meta.status],['Phiên bản',meta.version],
      ['Đã công bố runtime',meta.runtime_published],['Binding',asset.relation??meta.binding],
      ['Grain đầu vào',asset.grain??meta.input_grain??meta.grain],['Grain đầu ra',meta.output_grain],
      ['Mốc thời gian',asset.time_basis??meta.time_basis],['Thẩm quyền',asset.authority],
      ['Chất lượng yêu cầu',asset.required_quality??object(meta.policies).quality],
    ].map(([label,value])=><div key={String(label)}><dt className="text-muted-foreground">{String(label)}</dt><dd className="break-words">{display(value)}</dd></div>)}</dl>
    {definitions.length>0&&<div className="overflow-x-auto"><table className="w-full text-left"><caption className="mb-2 text-left font-medium">Định nghĩa trong release này</caption><thead><tr><th>Loại</th><th>ID</th><th>Công thức / trường</th><th>Đơn vị</th></tr></thead><tbody>{definitions.map(({kind,definition:d},i)=><tr key={i} className="border-t"><td className="p-2">{kind}</td><td className="p-2">{display(d.id)}</td><td className="p-2">{d.numerator?`${display(d.numerator)} / ${display(d.denominator)}; mẫu số 0: ${display(d.zero_denominator)}`:d.aggregation?`${display(d.aggregation)}(${display(d.field??d.fields)})`:display(d.field)}</td><td className="p-2">{display(d.unit)}</td></tr>)}</tbody></table></div>}
    {!!refs.length&&<section><h3 className="font-medium">Tham chiếu được tool khai báo</h3><ul className="list-disc pl-5">{refs.map((r,i)=><li key={i}>{display(r)}</li>)}</ul><p className="text-muted-foreground">Tham chiếu không phải định nghĩa đầy đủ; không tự suy ra trường hoặc quan hệ.</p></section>}
    {meta.formula!==undefined&&<p>Công thức tool: <code>{display(meta.formula)}</code></p>}
    <section><h3 className="font-medium">Relationships</h3>{list(meta.relationships).length?<pre className="whitespace-pre-wrap break-words">{display(meta.relationships)}</pre>:<p>Chưa có định nghĩa relationship trong release này. Không suy ra join, cardinality hay khả năng phân bổ.</p>}</section>
    {!!policies.length&&<section><h3 className="font-medium">Chính sách và giới hạn</h3><dl>{policies.map(([k,v])=><div key={k} className="border-t py-2"><dt className="font-medium">{k}</dt><dd className="break-words">{display(v)}</dd></div>)}</dl></section>}
  </div>
}

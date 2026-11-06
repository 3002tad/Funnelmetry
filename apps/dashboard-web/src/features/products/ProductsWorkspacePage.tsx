import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import { Package, Search, RefreshCw, Download } from 'lucide-react';
import type { ShellContext } from '../../app/AppShell';
import { useAuth } from '../../auth/AuthContext';
import { fetchExploration, type Exploration } from '../../lib/exploration-api';
import { dateWindow } from '../../lib/date-range';
import { downloadCsv } from '../../lib/csv-export';
import { PageHeader } from '../../components/ui/page';
import { DatasetSelect } from '../../components/ui/dataset-select';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { DesignCard, DesignStats, ScopeMarker, number } from '../../components/ui/prototype';
type Price = Exploration['prices'][number];
const contextKey = (p: Price) => [p.currency, p.channel, p.region, p.price_rule].join(' · ');
const money = (p: Price | null) => p ? new Intl.NumberFormat('vi-VN', { style: 'currency', currency: p.currency }).format(p.amount_minor / 100) : 'Không áp dụng tại mốc';
export default function ProductsWorkspacePage() {
    const { range, sourceId } = useOutletContext<ShellContext>(), { user } = useAuth(), [dataset, setDataset] = useState('observed'), [product, setProduct] = useState(''), [variant, setVariant] = useState(''), [context, setContext] = useState(''), [search, setSearch] = useState('');
    const window = useMemo(() => dateWindow(range), [range]), [from, setFrom] = useState(window.from.slice(0, 16)), [to, setTo] = useState(window.to.slice(0, 16));
    useEffect(() => { setFrom(window.from.slice(0, 16)); setTo(window.to.slice(0, 16)); }, [window]);
    const summary = useQuery({ queryKey: ['products-explore', user?.id, sourceId, dataset, window], queryFn: ({ signal }) => fetchExploration(sourceId, dataset, window, undefined, signal), retry: false, gcTime: 0 });
    const data = summary.isError ? undefined : summary.data, variants = (data?.variants ?? []).filter(v => !product || v.product_id === product), variantId = variants.some(v => v.variant_id === variant) ? variant : variants[0]?.variant_id;
    const start = Date.parse(from + ':00Z'), end = Date.parse(to + ':00Z'), valid = Number.isFinite(start) && Number.isFinite(end) && start < end && end - start <= 366 * 86400000;
    const detail = useQuery({ queryKey: ['price-interest', user?.id, sourceId, dataset, from, to, variantId], queryFn: ({ signal }) => fetchExploration(sourceId, dataset, { from: new Date(start).toISOString(), to: new Date(end).toISOString() }, variantId, signal), enabled: valid && !!variantId && dataset !== 'observed', retry: false, gcTime: 0 });
    const result = detail.isError ? undefined : detail.data, allPrices = result?.prices ?? [], contexts = [...new Set(allPrices.map(contextKey))], ctx = contexts.includes(context) ? context : contexts.find(c => c.endsWith(' · base')) || contexts[0], prices = allPrices.filter(p => contextKey(p) === ctx);
    const at = (t: number) => { const rows = prices.filter(p => Date.parse(p.effective_at) <= t && (!p.valid_to || Date.parse(p.valid_to) > t)); return rows.length === 1 ? rows[0] : null; };
    const titles = new Map(data?.variants.map(v => [v.product_id, v.title])), products = (data?.products ?? []).filter(p => (titles.get(p.product_id) || p.product_id).toLowerCase().includes(search.toLowerCase())).slice(0, 10), selected = data?.products.find(p => p.product_id === product);
    const choose = (id: string) => { setProduct(product === id ? '' : id); setVariant(''); setContext(''); };
    const stats = selected ? [
        { label: 'Sản phẩm đang chọn', value: titles.get(product) || product, detail: 'Catalog cùng dataset' },
        { label: 'Lượt xem sản phẩm', value: number(selected.views), detail: 'Tổng event xem trong khoảng đã chọn' },
        { label: 'Variant trong catalog trả về', value: variants.length, detail: 'Giới hạn API 500 variant' },
        { label: 'Nguồn dữ liệu', value: dataset === 'observed' ? 'Observed' : 'Synthetic', detail: 'UNVERIFIED' },
    ] : [{ label: 'Sản phẩm trong catalog', value: number(data?.counts?.catalog_products), detail: 'Distinct product_id · cùng dataset' }, { label: 'Lượt xem sản phẩm', value: number(data?.daily.reduce((n, r) => n + Number(r.views), 0)), detail: 'Event count · không phải người mua' }, { label: 'Sản phẩm đang hiển thị', value: products.length, detail: 'Top theo lượt xem trong khoảng đã chọn' }, { label: 'Nguồn dữ liệu', value: dataset === 'observed' ? 'Observed' : 'Synthetic', detail: 'UNVERIFIED' }];
    return <div className="tpl-page products-page"><PageHeader title="Sản phẩm" description="Sản phẩm được quan tâm và lịch sử giá trong dataset đang chọn." actions={<><Button variant="outline" disabled={summary.isFetching} onClick={() => void summary.refetch()}><RefreshCw size={14}/>Làm mới</Button><Button disabled={!data} onClick={() => downloadCsv('funnelmetry-products.csv', ['Sản phẩm', 'Lượt xem'], products.map(p => [titles.get(p.product_id) || p.product_id, p.views]))}><Download size={14}/>Xuất dữ liệu</Button></>}/>
 <div className="tpl-dataset-toolbar"><span className="tpl-data-origin">{data?.origin || 'Đang tải'} · UNVERIFIED</span><DatasetSelect sourceId={sourceId} value={dataset} onChange={id => { setDataset(id); setProduct(''); setVariant(''); setContext(''); }}/></div>
 {summary.isError && <p role="alert">Không đọc được dữ liệu sản phẩm. Không thay lỗi bằng số 0.</p>}
 <ScopeMarker title={selected ? 'Đang chọn: ' + (titles.get(product) || product) : 'Tất cả sản phẩm trong dataset'}>{product ? <button onClick={() => { setProduct(''); setVariant(''); }}>Bỏ chọn sản phẩm</button> : <Badge>Toàn bộ dataset</Badge>}</ScopeMarker>
 {data && <DesignStats items={stats}/>}
 <DesignCard title="Sản phẩm được quan tâm"><div className="tpl-toolbar"><label className="tpl-search-wrap"><Search size={14}/><input aria-label="Tìm sản phẩm" placeholder="Tìm trong top sản phẩm…" value={search} onChange={e => setSearch(e.target.value)}/></label><Badge>PostgreSQL</Badge></div><div className="tpl-table-scroll"><table><thead><tr><th>Sản phẩm</th><th>Lượt xem</th><th>Dataset</th><th /></tr></thead><tbody>{products.map(p => <tr key={p.product_id} tabIndex={0} aria-selected={product === p.product_id} className={product === p.product_id ? "tpl-product-row-selected" : ""} onClick={() => choose(p.product_id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        choose(p.product_id);
    } }}><td><span className="tpl-product-thumb"><Package size={17}/></span><strong>{titles.get(p.product_id) || p.product_id}</strong></td><td>{number(p.views)}</td><td><Badge>{dataset === 'observed' ? 'OBSERVED' : 'SYNTHETIC'}</Badge></td><td><Button variant="outline" onClick={e => { e.stopPropagation(); setProduct(p.product_id); setVariant(''); setContext(''); document.querySelector('#price-interest')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>Xem giá & lượt xem</Button></td></tr>)}</tbody></table>{!summary.isFetching && !products.length && <div className="tpl-empty">Không có sản phẩm phù hợp trong tập top sản phẩm.</div>}</div></DesignCard>
 <DesignCard title="Giá & mức quan tâm" className="tpl-price-panel" action={<Badge tone="warning">{dataset === 'observed' ? 'OBSERVED' : 'SYNTHETIC'} · UNVERIFIED</Badge>}>
 <div id="price-interest"/>
 {dataset === 'observed' ? <div className="tpl-empty">Chưa có lịch sử giá observed trong API này. Chọn dataset synthetic để xem lịch sử giá; không dùng giá hiện tại suy lịch sử.</div> : <>
 <div className="tpl-price-controls"><label>Sản phẩm / variant<select value={variantId || ''} onChange={e => { setVariant(e.target.value); setContext(''); }}>{variants.map((v, i) => <option key={v.variant_id} value={v.variant_id}>{v.title} · variant {i + 1}</option>)}</select></label><label>Ngữ cảnh giá<select value={ctx || ''} onChange={e => setContext(e.target.value)}>{contexts.map(c => <option key={c}>{c}</option>)}</select></label><label>Từ thời điểm UTC<input aria-label="Từ thời điểm UTC" type="datetime-local" value={from} onChange={e => setFrom(e.target.value)}/></label><label>Đến trước thời điểm UTC<input aria-label="Đến trước thời điểm UTC" type="datetime-local" value={to} onChange={e => setTo(e.target.value)}/></label></div>
 {!valid && <p role="alert">Chọn khoảng thời gian hợp lệ, tối đa 366 ngày.</p>}{detail.isError && <p role="alert">Không đọc được lịch sử giá. Không dùng giá 0 thay lỗi.</p>}{detail.isFetching && <p className="tpl-card-body tpl-semantic-footnote">Đang đọc giá và lượt xem…</p>}
 {result && valid && <><div className="tpl-price-summary">{[['Giá đầu khoảng', money(at(start))], ['Giá cuối khoảng', money(at(end - 1))], ['Lượt xem variant', number(result.daily.filter(r => Date.parse(r.date + 'T00:00:00Z') >= start && Date.parse(r.date + 'T00:00:00Z') + 86400000 <= end).reduce((n, r) => n + Number(r.views), 0))], ['Mốc hiệu lực mới trong khoảng', prices.filter(p => Date.parse(p.effective_at) > start && Date.parse(p.effective_at) < end).length]].map(([label, value]) => <div key={label}><small>{label}</small><strong>{value}</strong></div>)}</div><PriceChart prices={prices} daily={result.daily} start={start} end={end} context={ctx || 'Chưa có bản giá'}/><details className="tpl-price-history"><summary>Xem {prices.length} bản ghi giá giao với khoảng đã chọn</summary><table><thead><tr><th>Từ UTC</th><th>Đến trước UTC</th><th>Giá</th></tr></thead><tbody>{prices.map((p, i) => <tr key={i}><td>{p.effective_at}</td><td>{p.valid_to || 'Không giới hạn'}</td><td>{money(p)}</td></tr>)}</tbody></table></details></>}
 {!variantId && !summary.isFetching && <div className="tpl-empty">Sản phẩm chưa có variant trong tập catalog trả về. Không dùng giá của sản phẩm khác thay thế.</div>}
 </>}
 </DesignCard><p className="tpl-semantic-footnote">Cùng variant/currency/channel/region/rule. Giá và lượt xem không chứng minh quan hệ nhân quả hoặc giá checkout.</p>
 </div>;
}
function PriceChart({ prices, daily, start, end, context }: {
    prices: Price[];
    daily: Exploration['daily'];
    start: number;
    end: number;
    context: string;
}) {
    const rows = daily.filter(r => Date.parse(r.date + 'T00:00:00Z') >= start && Date.parse(r.date + 'T00:00:00Z') + 86400000 <= end), maxPrice = Math.max(1, ...prices.map(p => p.amount_minor)), maxViews = Math.max(1, ...rows.map(r => Number(r.views))), x = (t: number) => 55 + (t - start) / (end - start) * 780, y = (v: number) => 150 - v / maxPrice * 100;
    return <div className="tpl-price-chart-scroll"><svg className="tpl-price-chart" viewBox="0 0 900 360" role="img" aria-label="Giá theo khoảng hiệu lực và lượt xem variant theo ngày"><text x="8" y="24">Giá · {context}</text><text x="8" y="207">Lượt xem variant / ngày đầy đủ</text>{[0, .5, 1].map(r => <g key={r}><line x1="55" x2="835" y1={y(r * maxPrice)} y2={y(r * maxPrice)}/><text x="48" y={y(r * maxPrice) + 4} textAnchor="end">{(r * maxPrice / 100).toFixed(2)}</text></g>)}{prices.map((p, i) => <path key={i} d={`M${x(Math.max(start, Date.parse(p.effective_at)))} ${y(p.amount_minor)}H${x(Math.min(end, p.valid_to ? Date.parse(p.valid_to) : end))}`} stroke="currentColor" className="text-primary" fill="none" strokeWidth="3"><title>{money(p)} · {p.effective_at} → {p.valid_to}</title></path>)}<line x1="55" x2="835" y1="320" y2="320"/>{rows.map(r => <rect key={r.date} x={x(Date.parse(r.date + 'T00:00:00Z'))} y={320 - Number(r.views) / maxViews * 85} height={Number(r.views) / maxViews * 85} width={Math.max(1, 780 / ((end - start) / 86400000) - 2)} fill="currentColor" className="text-primary" opacity=".7"><title>{r.date}: {r.views} lượt xem</title></rect>)}{[0, .25, .5, .75, 1].map(r => <text key={r} x={x(start + (end - start) * r)} y="345" textAnchor="middle">{new Date(start + (end - start) * r).toISOString().slice(0, 10)}</text>)}</svg></div>;
}

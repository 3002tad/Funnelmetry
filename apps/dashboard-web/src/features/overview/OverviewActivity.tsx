import type { Exploration } from '../../lib/exploration-api';
import { Badge } from '../../components/ui/badge';
export function OverviewActivity({ data, selected, onSelect }: {
    data: Exploration;
    selected: string | null;
    onSelect: (value: string | null) => void;
}) {
    const groups = new Map<string, number>();
    for (const row of data.daily) {
        const date = data.daily.length > 35 ? row.date.slice(0, 7) : row.date;
        groups.set(date, (groups.get(date) || 0) + Number(row.total));
    }
    const buckets = [...groups], max = Math.max(1, ...buckets.map(([, count]) => count));
    const types = new Map<string, number>();
    for (const row of data.event_types ?? []) {
        if (!selected || row.date.startsWith(selected))
            types.set(row.event_type, (types.get(row.event_type) || 0) + Number(row.total));
    }
    const selectedRows = data.daily.filter(r => r.date.startsWith(selected || ''));
    const displayRows: [
        string,
        number
    ][] = selected ? [
        ['Tất cả browser events', selectedRows.reduce((n, r) => n + Number(r.total), 0)],
        ['Trong đó: xem sản phẩm', selectedRows.reduce((n, r) => n + Number(r.views), 0)],
        ['Trong đó: tìm kiếm', selectedRows.reduce((n, r) => n + Number(r.searches), 0)],
        ['Cart ADD (grain riêng)', selectedRows.reduce((n, r) => n + Number(r.cart), 0)],
    ] : [...types].sort((a, b) => b[1] - a[1]);
    return <div className="tpl-grid">
    <section className="tpl-card activity-panel">
      <div className="tpl-card-head"><h2>Hoạt động trong dataset</h2><Badge tone="neutral">{data.origin === 'SYNTHETIC_BACKFILL' ? 'SYNTHETIC' : 'OBSERVED'}</Badge></div>
      {buckets.length ? <div className="tpl-db-bars">{buckets.map(([date, count]) => <button key={date} aria-pressed={selected === date} className={`tpl-db-column ${selected===date?'tpl-period-selected':''}`} title={`${date}: ${count} event`} onClick={() => onSelect(selected === date ? null : date)}><span>{count.toLocaleString('vi-VN')}</span><div><i style={{ height: `${count / max * 100}%` }}/></div><small>{date}</small></button>)}</div> : <p className="p-5 text-xs text-muted-foreground">Chưa có event retained trong khoảng này. Chưa thể kết luận không có hoạt động.</p>}
      <p className="tpl-chart-caption">Bấm một cột để lọc thẻ và bảng hoạt động trên trang; bấm lại để bỏ chọn. Biểu đồ giữ toàn kỳ để đối chiếu.</p>
    </section>
    <section className="tpl-card tpl-event-breakdown"><div className="tpl-card-head"><h2>{selected ? 'Hoạt động trong kỳ đã chọn' : 'Cơ cấu dữ liệu'}</h2></div><div className="tpl-table-scroll"><table><thead><tr><th>{selected ? 'Chỉ tiêu' : 'Loại sự kiện'}</th><th className="text-right">Số lượt</th></tr></thead><tbody>{displayRows.map(([type, count]) => <tr key={type}><td className="text-xs" title={type}>{type.replace(/^behavior\./, '')}</td><td className="text-right">{count.toLocaleString('vi-VN')}</td></tr>)}</tbody></table>{!displayRows.length && <p className="p-5 text-xs text-muted-foreground">Chưa có cơ cấu sự kiện trong phạm vi đã chọn.</p>}</div></section>
  </div>;
}

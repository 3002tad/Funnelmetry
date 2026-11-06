import {Children,isValidElement,type ReactNode} from 'react';
import type { LucideIcon } from 'lucide-react';
export function DesignCard({ title, detail, action, children, className = '' }: {
    title: string;
    detail?: string;
    action?: ReactNode;
    children: ReactNode;
    className?: string;
}) {
    return <section className={`tpl-card ${className}`}><div className="tpl-card-head"><div><h2>{title}</h2>{detail && <p>{detail}</p>}</div>{action}</div>{Children.map(children,child=>isValidElement(child)&&child.type==='table'?<div className="tpl-table-scroll">{child}</div>:child)}</section>;
}
export function DesignStats({ items }: {
    items: {
        label: string;
        value: ReactNode;
        detail: string;
        icon?: LucideIcon;
    }[];
}) {
    return <div className="tpl-stats">{items.map(({ label, value, detail, icon: Icon }) => <section className="tpl-card tpl-stat" key={label}><div className="tpl-stat-title">{label}{Icon && <span className="tpl-funnel-stat-icon"><Icon size={17}/></span>}</div><div className={`tpl-stat-value ${typeof value === "string" && value.length > 16 ? "tpl-stat-value-long" : ""}`}>{value}</div><span className="tpl-small tpl-muted">{detail}</span></section>)}</div>;
}
export function ScopeMarker({ title, children }: {
    title: string;
    children?: ReactNode;
}) { return <div className="tpl-activity-scope-bar"><strong>{title}</strong>{children}</div>; }
export const number = (value: number | string | undefined | null) => value == null ? 'Chưa đo' : Number(value).toLocaleString('vi-VN');

import type {ReactNode} from 'react'
import {useLocation,useOutletContext} from 'react-router-dom'
import {Database} from 'lucide-react'
import type {ShellContext} from '../../app/AppShell'
import {DateRangePicker} from './date-range-picker'
import {useAuth} from '../../auth/AuthContext'

export function PageHeader({title,description,badge,actions}:{title:string;description:string;badge?:ReactNode;actions?:ReactNode}){
 const shell=useOutletContext<ShellContext|undefined>(),location=useLocation(),{user}=useAuth()
 const admin=location.pathname.startsWith('/admin')||user?.role==='super_admin'
 const showRange=shell&&!admin&&!['/settings','/ai'].includes(location.pathname)
 return <><div className="tpl-page-head"><div>{admin&&<div className="tpl-admin-kicker">FUNNELMETRY / ADMINISTRATION</div>}<h1>{title}{badge&&<span className="tpl-heading-badge">{badge}</span>}</h1><p className="tpl-subtitle">{description}</p></div>{actions&&<div className="tpl-row">{actions}</div>}</div>{showRange&&<div className="tpl-filters"><div className="tpl-row"><span className="tpl-tag tpl-gray"><Database size={14}/>{location.pathname==='/funnels'?'Medusa Reference':shell.datasetLabel}</span><DateRangePicker value={shell.range} onChange={shell.setRange}/></div></div>}</>
}
export function SectionTitle({title,detail,action}:{title:string;detail?:string;action?:ReactNode}){return <div className="tpl-section-heading"><div><h2>{title}</h2>{detail&&<p className="tpl-subtitle">{detail}</p>}</div>{action}</div>}
export function EmptyState({title,detail,icon}:{title:string;detail:string;icon:ReactNode}){return <div className="tpl-card tpl-empty">{icon}<h3>{title}</h3><p>{detail}</p></div>}

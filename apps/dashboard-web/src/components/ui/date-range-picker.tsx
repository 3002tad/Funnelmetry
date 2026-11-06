import { useEffect, useState, type FormEvent } from 'react'
import { Button } from './button'
import { dateWindow, defaultDateRange } from '../../lib/date-range'
export function DateRangePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [from, setFrom] = useState(''), [to, setTo] = useState(''), [error, setError] = useState('')
  useEffect(() => { const [a,b]=(value.includes('/')?value:defaultDateRange()).split('/');setFrom(a);setTo(b) }, [value])
  function apply(e: FormEvent) { e.preventDefault();try { const next=`${from}/${to}`;dateWindow(next);setError('');onChange(next) } catch {setError('Chọn khoảng ngày hợp lệ.')} }
  return <form className="tpl-custom-page-range" onSubmit={apply}><label>Từ ngày<input aria-label="Từ ngày UTC" type="date" required value={from} onChange={e=>setFrom(e.target.value)} /></label><label>Đến hết ngày<input aria-label="Đến hết ngày UTC" type="date" required value={to} min={from} onChange={e=>setTo(e.target.value)} /></label><Button size="sm" variant="outline" type="submit">Áp dụng</Button><span className="text-[10px] text-muted-foreground">UTC</span>{error&&<span role="alert" className="text-xs text-destructive">{error}</span>}</form>
}

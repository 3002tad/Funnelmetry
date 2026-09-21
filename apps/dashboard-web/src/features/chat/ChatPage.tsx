import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useOutletContext } from 'react-router-dom'
import type { ShellContext } from '../../app/AppShell'
import { useAuth } from '../../auth/AuthContext'
import { ApiError, apiRequest } from '../../lib/api'
import type { OverviewResponse } from '../../lib/analytics-api'
import { Button } from '../../components/ui/button'
import { ArrowUp, BarChart3, Database, Plus, Sparkles, Square, TrendingDown, Clock3 } from 'lucide-react'

type ChatResponse = {
  answer: string | null
  status: 'generated' | 'no_evidence'
  model?: string
  evidence: Array<{
    evidence_id: string; origin: string; retrieved_at: string
    scope: { sourceId: string; from: string; to: string }
    data: Partial<OverviewResponse> & { total_events?: number; counts?: Array<{ event_type: string; count: number }> }; limitations: string[]
  }>
}

type Turn = { id: number; question: string; result?: ChatResponse; error?: string; scope?: string; restored?: boolean }
const historyPrefix = 'funnelmetry:chat:'

function restoreHistory(key: string): Turn[] {
  try {
    const data: unknown = JSON.parse(sessionStorage.getItem(key) || '[]')
    if (!Array.isArray(data)) return []
    return data.slice(-50).flatMap((item): Turn[] => {
      if (!item || typeof item.question !== 'string' || typeof item.id !== 'number') return []
      return [{ id: item.id, question: item.question.slice(0, 2000), restored: true,
        scope: typeof item.scope === 'string' ? item.scope : undefined,
        ...(typeof item.answer === 'string' ? { result: { answer: item.answer.slice(0, 16000), status: 'generated', evidence: [] } as ChatResponse }
          : { error: typeof item.error === 'string' ? item.error : 'Yêu cầu bị gián đoạn khi rời trang. Chưa tự gửi lại; bạn có thể gửi một câu hỏi mới.' }),
      }]
    })
  } catch { return [] }
}

function errorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.message === 'tool_row_budget_exceeded') return 'Phạm vi vượt 10.000 event. Hãy thu hẹp khoảng thời gian.'
    if (error.message === 'tool_scope_outside_window') return 'Khoảng thời gian trong câu hỏi vượt phạm vi UI. Hãy mở rộng bộ lọc thời gian rồi thử lại.'
    if (error.message === 'module_disabled') return 'Qwen chưa được bật trên backend. Quản trị viên cần cấu hình DashScope; không nhập API key vào giao diện này.'
    if (error.status === 401) return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
    if (error.status === 403) return 'Tài khoản không có quyền sử dụng Chat và dữ liệu analytics.'
    if (error.status === 429) return 'Đã đạt giới hạn yêu cầu. Hãy chờ khoảng một phút rồi gửi lại.'
    if (error.status === 504) return 'Qwen phản hồi quá lâu. Bạn có thể thử lại sau.'
    if (error.status === 400) return 'Nguồn dữ liệu hoặc câu hỏi không hợp lệ. Vui lòng kiểm tra lại.'
  }
  return 'Không thể nhận câu trả lời lúc này. Kiểm tra kết nối/backend rồi thử lại.'
}

export function ChatPage() {
  const { user } = useAuth()
  return user ? <ChatConversation key={user.id} accountId={user.id} /> : null
}

function ChatConversation({ accountId }: { accountId: string }) {
  const { sourceId, range } = useOutletContext<ShellContext>()
  const { token } = useAuth()
  const [source, setSource] = useState(sourceId)
  const [message, setMessage] = useState('')
  const storageKey = historyPrefix + accountId
  const [turns, setTurns] = useState<Turn[]>(() => restoreHistory(storageKey))
  const [storageError, setStorageError] = useState(false)
  const [busy, setBusy] = useState(false)
  const active = useRef<AbortController | null>(null)
  const nextId = useRef(Math.max(0, ...turns.map(turn => turn.id)))
  const input = useRef<HTMLTextAreaElement>(null)
  const bottom = useRef<HTMLDivElement>(null)

  function reset() {
    active.current?.abort()
    active.current = null
    setBusy(false)
    setTurns([])
    setMessage('')
    input.current?.focus()
  }

  useEffect(() => {
    setTurns(previous => previous.map(turn => !turn.result && !turn.error ? { ...turn, error: 'Yêu cầu đã bị gián đoạn. Chưa tự gửi lại.' } : turn))
    setBusy(false)
    return () => { active.current?.abort(); active.current = null }
  }, [token, source, range])

  useEffect(() => {
    try {
      // Store bounded text only, not tokens or full analytics evidence snapshots.
      sessionStorage.setItem(storageKey, JSON.stringify(turns.slice(-50).map(turn => ({
        id: turn.id, question: turn.question, scope: turn.scope, error: turn.error,
        answer: turn.result?.status === 'no_evidence' ? 'Chưa có dữ liệu trong phạm vi này.' : turn.result?.answer,
      }))))
      setStorageError(false)
    } catch { setStorageError(true) }
  }, [turns, storageKey])

  useEffect(() => { bottom.current?.scrollIntoView({ block: 'nearest' }) }, [turns, busy])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (active.current || !message.trim() || !/^[a-z0-9][a-z0-9-]{2,62}$/.test(source.trim())) return
    const controller = new AbortController()
    active.current = controller
    setBusy(true)
    const id = ++nextId.current
    const question = message.trim()
    setTurns(previous => [...previous.slice(-49), { id, question, scope: `${source.trim()} · ${range} · ${new Date().toLocaleString()}` }])
    setMessage('')
    const to = new Date()
    const days = range === 'Last 7 days' ? 7 : range === 'Last 90 days' ? 90 : 30
    try {
      const response = await apiRequest<ChatResponse>('/api/v2/chat', {
        method: 'POST', signal: controller.signal,
        body: JSON.stringify({ message: question, source_id: source.trim(),
          from: new Date(to.getTime() - days * 86400000).toISOString(), to: to.toISOString() }),
      })
      if (!controller.signal.aborted) setTurns(previous => previous.map(turn => turn.id === id ? { ...turn, result: response } : turn))
    } catch (failure) {
      if (!controller.signal.aborted) setTurns(previous => previous.map(turn => turn.id === id ? { ...turn, error: errorMessage(failure) } : turn))
    } finally {
      if (active.current === controller) { active.current = null; setBusy(false) }
    }
  }

  return <div className="flex h-[calc(100dvh-6rem)] min-h-[520px] flex-col md:h-[calc(100dvh-7rem)] lg:h-[calc(100dvh-8rem)]">
    <header className="flex shrink-0 items-center justify-between gap-3 border-b pb-4">
      <div className="flex items-center gap-3"><div className="rounded-xl bg-primary/10 p-2 text-primary"><Sparkles size={20} /></div>
        <div><h1 className="text-base font-semibold">Funnelmetry Assistant</h1><p className="text-xs text-muted-foreground">Qwen Flash · Trợ lý phân tích dữ liệu</p></div></div>
      <Button variant="outline" onClick={reset} aria-label="Cuộc trò chuyện mới"><Plus size={16} /><span className="hidden sm:inline">Chat mới</span></Button>
    </header>
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto py-6">
      {!turns.length ? <div className="mx-auto flex min-h-full max-w-2xl flex-col justify-center px-2 pb-6 text-center">
        <div className="mx-auto mb-6 grid h-16 w-16 place-items-center rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/5 to-primary/15 text-primary shadow-sm"><Sparkles size={30} strokeWidth={1.5} /></div>
        <p className="mb-3 text-xs font-medium uppercase tracking-[.18em] text-primary">Từ dữ liệu đến góc nhìn</p>
        <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Bạn muốn tìm hiểu điều gì?</h2>
        <p className="mx-auto mt-4 max-w-md text-sm leading-6 text-muted-foreground">Cùng khám phá số liệu chuyển đổi của bạn.<br />Đặt câu hỏi, xem lời giải thích và đối chiếu dữ liệu gốc.</p>
        <div className="mt-8 grid gap-3 text-left sm:grid-cols-3">
          {[
            { icon: BarChart3, title: 'Nhìn lại tổng quan', text: 'Tóm tắt số liệu chuyển đổi trong khoảng thời gian đã chọn.' },
            { icon: Clock3, title: 'Hiểu trạng thái pending', text: 'Có bao nhiêu trường hợp còn pending? Khác dropped như thế nào?' },
            { icon: TrendingDown, title: 'So sánh các funnel', text: 'So sánh số entrants, converted và dropped giữa các profile.' },
          ].map(({ icon: Icon, title, text }) => <button key={title} onClick={() => { setMessage(text); input.current?.focus() }} className="group rounded-2xl border bg-card p-4 text-left transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:ring-2 focus-visible:ring-primary">
            <Icon size={19} className="mb-4 text-primary" /><span className="block text-sm font-medium">{title}</span><span className="mt-2 block text-xs leading-5 text-muted-foreground">{text}</span>
          </button>)}
        </div>
      </div> : <div className="mx-auto max-w-3xl space-y-8 px-1 sm:px-4">
        {turns.map(turn => <article key={turn.id} className="space-y-6">
          <div className="flex justify-end"><div className="max-w-[85%] whitespace-pre-wrap break-words rounded-3xl rounded-br-md bg-primary/10 px-5 py-3 text-sm leading-7">{turn.question}<span className="mt-2 block text-[10px] text-muted-foreground">{turn.scope}</span></div></div>
          <div className="flex items-start gap-3"><div className="mt-1 rounded-lg bg-primary/10 p-2 text-primary"><Sparkles size={17} /></div>
            <div className="min-w-0 flex-1 space-y-3 text-sm leading-7"><p className="font-semibold">Funnelmetry <span className="ml-2 text-xs font-normal text-muted-foreground">Assistant</span></p>
              {turn.error ? <p role="alert" className="rounded-xl border bg-card p-4 text-muted-foreground">{turn.error}</p> : turn.result ? <>
                <p className="whitespace-pre-wrap break-words">{turn.result.status === 'no_evidence' ? 'Chưa có dữ liệu trong phạm vi này. Hãy thử nguồn hoặc khoảng thời gian khác.' : turn.result.answer}</p>
                <p className="text-xs text-muted-foreground">Chưa xác minh · Không phải insight chính thức</p>
                <Evidence result={turn.result} />
                {turn.restored && <p className="text-xs text-muted-foreground">Bản khôi phục trong tab, không phải dữ liệu mới truy xuất. Evidence chi tiết không được lưu.</p>}
              </> : <p role="status" className="animate-pulse text-muted-foreground">Đang đọc dữ liệu và chờ Qwen…</p>}
            </div>
          </div>
        </article>)}
      </div>}
      <div ref={bottom} />
    </div>
    <div className="mx-auto w-full max-w-3xl shrink-0 pt-3">
      <details className="mb-3 text-xs text-muted-foreground"><summary className="cursor-pointer"><Database size={13} className="mr-1 inline" /> {source || 'Chọn nguồn'} · {range} · Phạm vi dữ liệu</summary>
        <label className="mt-3 block rounded-xl border bg-card p-3">Source ID (áp dụng cho câu hỏi tiếp theo)
          <input aria-label="Source ID" value={source} maxLength={63} onChange={e => setSource(e.target.value)} className="mt-2 block w-full rounded-lg border bg-background p-2 focus:ring-2 focus:ring-primary" />
          {!/^[a-z0-9][a-z0-9-]{2,62}$/.test(source.trim()) && <span className="text-destructive">Nhập 3–63 ký tự chữ thường, số hoặc dấu gạch ngang.</span>}
        </label>
      </details>
      <form onSubmit={submit} className="rounded-3xl border bg-card p-3 shadow-sm transition focus-within:border-primary/50 focus-within:ring-4 focus-within:ring-primary/5">
        <textarea ref={input} aria-label="Câu hỏi cho AI" required maxLength={2000} rows={2} value={message} onChange={e => setMessage(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.form?.requestSubmit() } }}
          placeholder="Hỏi bất cứ điều gì về số liệu của bạn…" className="block max-h-40 w-full resize-none bg-transparent px-2 py-2 text-sm leading-6 outline-none placeholder:text-muted-foreground" />
        <div className="flex items-center justify-between px-1"><span className="text-[11px] text-muted-foreground">{message.length ? `${message.length}/2000 · ` : ''}Enter để gửi · Shift + Enter xuống dòng</span>
          {busy ? <Button type="button" size="icon" className="rounded-full" aria-label="Dừng chờ" onClick={() => { active.current?.abort(); active.current = null; setBusy(false); setTurns(previous => previous.map(turn => !turn.result && !turn.error ? { ...turn, error: 'Đã dừng chờ phản hồi.' } : turn)) }}><Square size={14} /></Button>
            : <Button type="submit" size="icon" className="rounded-full" aria-label="Gửi câu hỏi" disabled={!message.trim() || !/^[a-z0-9][a-z0-9-]{2,62}$/.test(source.trim())}><ArrowUp size={19} /></Button>}
        </div>
      </form>
      {storageError && <p role="alert" className="mt-2 text-xs text-destructive">Trình duyệt không lưu được lịch sử. Tải lại trang có thể mất hội thoại.</p>}
      <p className="mt-3 text-center text-[10px] leading-4 text-muted-foreground">Mỗi câu hỏi độc lập · Giữ tối đa 50 lượt trong tab qua F5; xóa khi đăng xuất hoặc Chat mới · AI có thể sai.<br />Câu hỏi và số liệu tổng hợp gửi đến Alibaba Cloud Singapore. Không nhập bí mật hoặc thông tin cá nhân.</p>
    </div>
  </div>
}

function Evidence({ result }: { result: ChatResponse }) {
  return <>{result.evidence.map(item => <details key={item.evidence_id} className="rounded-lg border p-4">
        <summary className="cursor-pointer text-primary">Evidence [{item.evidence_id}] · {item.origin}</summary>
        <div className="mt-3 space-y-3 text-sm">
          <p>Nguồn: {item.scope.sourceId}. Khoảng UTC: {item.scope.from} → {item.scope.to}</p>
          <p>Truy xuất: {item.retrieved_at}. Số liệu quan sát, chưa phải KPI cuối cùng.</p>
          {item.data.counts && <div><p>Polars · Tổng {item.data.total_events} dòng event canonical</p><table className="w-full text-left"><thead><tr><th>Loại event</th><th>Số lượng</th></tr></thead><tbody>{item.data.counts.map(row => <tr key={row.event_type}><td>{row.event_type}</td><td>{row.count}</td></tr>)}</tbody></table></div>}
          {item.data.profiles && <div className="overflow-x-auto"><table className="w-full text-left"><caption className="pb-2 text-left">profile-N tương ứng thứ tự evidence được gửi cho Qwen.</caption>
            <thead><tr>{['Profile', 'Entrants', 'Converted (observed)', 'Pending', 'Dropped'].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead>
            <tbody>{item.data.profiles.map((profile, index) => <tr key={`${profile.funnel_profile_id}:${profile.profile_version}`} className="border-t">
              <td className="p-2">profile-{index + 1}: {profile.display_name} ({profile.profile_version})</td>
              <td className="p-2">{profile.entrants}</td><td className="p-2">{profile.observed_converted}</td><td className="p-2">{profile.pending}</td><td className="p-2">{profile.dropped}</td>
            </tr>)}</tbody></table></div>}
          <ul className="list-disc pl-5">{item.limitations.map(text => <li key={text}>{text}</li>)}</ul>
        </div>
      </details>)}</>
}

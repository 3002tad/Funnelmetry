import { useEffect, useState, type FormEvent } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { KeyRound, LoaderCircle, LockKeyhole, ShieldCheck, UserRound } from "lucide-react"
import { useOutletContext } from "react-router-dom"
import type { ShellContext } from "../../app/AppShell"
import { useAuth } from "../../auth/AuthContext"
import { Badge } from "../../components/ui/badge"
import { Button } from "../../components/ui/button"
import { PageHeader } from "../../components/ui/page"
import { apiRequest } from "../../lib/api"
import { accountPreferencesKey, type PreferencesResponse } from "../../lib/account-preferences"
import type { ThemePreference } from "../../app/useThemePreference"

type Activity = { items: { id: string; action: string; created_at: string }[]; next_cursor: string | null }
const activityLabels: Record<string, string> = {
  "account.created": "Tạo tài khoản", "account.updated": "Cập nhật tài khoản",
  "account.disabled": "Khóa tài khoản", "password.changed": "Đổi mật khẩu",
  "account.bootstrapped": "Khởi tạo tài khoản", "sessions.revoked": "Thu hồi phiên đăng nhập",
  "preferences.updated": "Đổi tùy chọn cá nhân",
}

export function SettingsPage() {
  const { workspace, sourceId } = useOutletContext<ShellContext>()
  const { user, logout } = useAuth()
  const queryClient = useQueryClient()
  const preferences = useQuery({
    queryKey: accountPreferencesKey(user?.id),
    queryFn: ({ signal }) => apiRequest<PreferencesResponse>("/api/account/preferences", { signal }),
    enabled: Boolean(user?.id), retry: false, staleTime: 30_000,
  })
  const [themeDraft, setThemeDraft] = useState<ThemePreference>("system")
  const [daysDraft, setDaysDraft] = useState<7 | 30 | 90>(30)
  const [savingPreferences, setSavingPreferences] = useState(false)
  const [preferencesError, setPreferencesError] = useState("")
  const [preferencesSuccess, setPreferencesSuccess] = useState("")
  const [activityPages, setActivityPages] = useState<(string | null)[]>([null])
  const activityCursor = activityPages[activityPages.length - 1]
  const activity = useQuery({
    queryKey: ["account-activity", user?.id, activityCursor],
    queryFn: ({ signal }) => apiRequest<Activity>(`/api/account/activity?limit=10${activityCursor ? `&cursor=${encodeURIComponent(activityCursor)}` : ""}`, { signal }),
    enabled: Boolean(user?.id), retry: false,
  })

  useEffect(() => {
    if (!preferences.data) return
    setThemeDraft(preferences.data.preferences.theme)
    setDaysDraft(preferences.data.preferences.analytics_default_days)
  }, [preferences.data])

  async function savePreferences(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSavingPreferences(true)
    setPreferencesError("")
    setPreferencesSuccess("")
    try {
      const saved = await apiRequest<PreferencesResponse>("/api/account/preferences", {
        method: "PATCH", body: JSON.stringify({ theme: themeDraft, analytics_default_days: daysDraft }),
      })
      queryClient.setQueryData(accountPreferencesKey(user?.id), saved)
      await queryClient.invalidateQueries({ queryKey: ["account-activity", user?.id] })
      setActivityPages([null])
      setPreferencesSuccess("Đã lưu vào tài khoản và áp dụng cho giao diện hiện tại.")
    } catch { setPreferencesError("Không lưu được tùy chọn. Kiểm tra kết nối hoặc quyền tài khoản rồi thử lại.") }
    finally { setSavingPreferences(false) }
  }
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  async function changePassword(event: FormEvent) {
    event.preventDefault()
    setError("")
    setSuccess("")
    if (newPassword.length < 12) {
      setError("Mật khẩu mới phải có ít nhất 12 ký tự.")
      return
    }
    if (newPassword !== confirmation) {
      setError("Mật khẩu xác nhận không khớp.")
      return
    }
    setSubmitting(true)
    try {
      await apiRequest<{ ok: boolean }>("/api/auth/change-password", {
        method: "PATCH",
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      })
      setCurrentPassword("")
      setNewPassword("")
      setConfirmation("")
      setSuccess("Đã đổi mật khẩu. Hệ thống sẽ đăng xuất để bạn đăng nhập lại.")
      window.setTimeout(logout, 1200)
    } catch {
      setError("Không thể đổi mật khẩu. Hãy kiểm tra mật khẩu hiện tại và thử lại.")
    } finally {
      setSubmitting(false)
    }
  }

  return <>
    <PageHeader title="Settings" description="Tùy chọn cá nhân, bảo mật và phạm vi phân tích hiện tại." badge={<Badge tone="neutral">Tài khoản</Badge>} />
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="panel p-5"><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary"><UserRound size={18} /></div><div><h2 className="text-sm font-semibold">Account</h2><p className="mt-1 text-xs text-muted-foreground">Loaded from Dashboard API authentication.</p></div></div><dl className="mt-6 grid grid-cols-[120px_minmax(0,1fr)] gap-x-3 gap-y-4 text-xs"><dt className="text-muted-foreground">Display name</dt><dd>{user?.display_name || "Not set"}</dd><dt className="text-muted-foreground">Email</dt><dd>{user?.email || "—"}</dd><dt className="text-muted-foreground">Role</dt><dd><Badge>{user?.role || "—"}</Badge></dd><dt className="text-muted-foreground">User ID</dt><dd className="break-all font-mono">{user?.id || "—"}</dd></dl></section>
      <section className="panel p-5"><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary"><ShieldCheck size={18} /></div><div><h2 className="text-sm font-semibold">Analytics scope</h2><p className="mt-1 text-xs text-muted-foreground">Read-only values configured at build/runtime.</p></div></div><dl className="mt-6 grid grid-cols-[120px_minmax(0,1fr)] gap-x-3 gap-y-4 text-xs"><dt className="text-muted-foreground">Workspace</dt><dd>{workspace}</dd><dt className="text-muted-foreground">Source ID</dt><dd className="font-mono">{sourceId}</dd><dt className="text-muted-foreground">Access</dt><dd><Badge tone="success">Authenticated API</Badge></dd></dl><p className="mt-5 rounded-lg border bg-muted/20 p-3 text-xs leading-5 text-muted-foreground">Workspace and source switching are not persisted by the current backend, so this page does not present a fake save action.</p></section>
    </div>

    <section className="panel mt-4 p-5">
      <h2 className="text-sm font-semibold">Tùy chọn cá nhân</h2>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">Lưu riêng cho tài khoản này trên Dashboard API. Khoảng thời gian mặc định áp dụng khi mở lại giao diện; bạn vẫn có thể đổi tạm ở thanh trên.</p>
      {preferences.isPending && <p role="status" className="mt-4 text-sm">Đang tải tùy chọn…</p>}
      {preferences.isError && <p role="alert" className="mt-4 text-sm">Không tải được tùy chọn tài khoản; chưa thể xác nhận giá trị đã lưu.</p>}
      {preferences.data && <form onSubmit={savePreferences} className="mt-5 flex flex-wrap items-end gap-4">
        <label className="text-xs"><span className="mb-2 block text-muted-foreground">Giao diện</span><select className="h-10 min-w-40 border bg-background px-3" value={themeDraft} onChange={event => setThemeDraft(event.target.value as ThemePreference)}><option value="system">Theo hệ thống</option><option value="light">Sáng</option><option value="dark">Tối</option></select></label>
        <label className="text-xs"><span className="mb-2 block text-muted-foreground">Khoảng thời gian mặc định</span><select className="h-10 min-w-40 border bg-background px-3" value={daysDraft} onChange={event => setDaysDraft(Number(event.target.value) as 7 | 30 | 90)}><option value={7}>7 ngày</option><option value={30}>30 ngày</option><option value={90}>90 ngày</option></select></label>
        <Button type="submit" disabled={savingPreferences}>{savingPreferences ? "Đang lưu…" : "Lưu tùy chọn"}</Button>
      </form>}
      {preferencesError && <p role="alert" className="mt-3 text-sm">{preferencesError}</p>}
      {preferencesSuccess && <p role="status" className="mt-3 text-sm text-success">{preferencesSuccess}</p>}
      <p className="mt-4 text-xs text-muted-foreground">Ngôn ngữ toàn ứng dụng, định dạng số và thông báo chưa được áp dụng xuyên suốt UI nên chưa có nút lưu ở đây.</p>
    </section>

    <section className="panel mt-4 p-5"><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-lg bg-warning/10 text-warning"><LockKeyhole size={18} /></div><div><h2 className="text-sm font-semibold">Change password</h2><p className="mt-1 text-xs text-muted-foreground">Updates the current Dashboard API account.</p></div></div><form onSubmit={changePassword} className="mt-6 grid max-w-3xl gap-4 md:grid-cols-3"><label className="text-xs"><span className="mb-2 block text-muted-foreground">Current password</span><input type="password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" className="h-10 w-full rounded-lg border bg-background px-3" /></label><label className="text-xs"><span className="mb-2 block text-muted-foreground">New password</span><input type="password" required minLength={12} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" className="h-10 w-full rounded-lg border bg-background px-3" /></label><label className="text-xs"><span className="mb-2 block text-muted-foreground">Confirm password</span><input type="password" required minLength={12} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" className="h-10 w-full rounded-lg border bg-background px-3" /></label><div className="md:col-span-3">{error && <p className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">{error}</p>}{success && <p className="mb-3 rounded-lg border border-success/30 bg-success/5 p-3 text-xs text-success">{success}</p>}<Button disabled={submitting}>{submitting ? <LoaderCircle size={15} className="animate-spin" /> : <KeyRound size={15} />}{submitting ? "Đang cập nhật…" : "Đổi mật khẩu"}</Button></div></form></section>

    <section className="panel mt-4 p-5">
      <h2 className="text-sm font-semibold">Lịch sử tài khoản</h2>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">Chỉ các thao tác tài khoản đã được ghi nhận; không phải toàn bộ hoạt động phân tích hay lượt đăng nhập.</p>
      {activity.isPending && <p role="status" className="mt-4 text-sm">Đang tải lịch sử…</p>}
      {activity.isError && <p role="alert" className="mt-4 text-sm">Không đọc được lịch sử tài khoản. Không coi đây là danh sách rỗng.</p>}
      {activity.data && <>
        {!activity.data.items.length && <p className="mt-4 text-sm text-muted-foreground">Không có bản ghi trong trang này.</p>}
        {!!activity.data.items.length && <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>Thời điểm UTC</th><th>Thao tác</th></tr></thead><tbody>{activity.data.items.map(item => <tr key={item.id} className="border-t"><td className="p-3 whitespace-nowrap">{item.created_at}</td><td className="p-3">{activityLabels[item.action] ?? item.action}</td></tr>)}</tbody></table></div>}
        <div className="mt-4 flex items-center gap-3"><Button type="button" variant="outline" disabled={activityPages.length === 1 || activity.isFetching} onClick={() => setActivityPages(pages => pages.slice(0, -1))}>Trước</Button><span className="text-xs text-muted-foreground">Trang {activityPages.length}</span><Button type="button" variant="outline" disabled={!activity.data.next_cursor || activity.isFetching} onClick={() => setActivityPages(pages => [...pages, activity.data!.next_cursor])}>Sau</Button></div>
      </>}
    </section>
  </>
}

import { useState, type FormEvent } from "react"
import { KeyRound, LoaderCircle, LockKeyhole, ShieldCheck, UserRound } from "lucide-react"
import { useOutletContext } from "react-router-dom"
import type { ShellContext } from "../../app/AppShell"
import { useAuth } from "../../auth/AuthContext"
import { Badge } from "../../components/ui/badge"
import { Button } from "../../components/ui/button"
import { PageHeader } from "../../components/ui/page"
import { apiRequest } from "../../lib/api"

export function SettingsPage() {
  const { workspace, sourceId } = useOutletContext<ShellContext>()
  const { user, logout } = useAuth()
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
    if (newPassword.length < 6) {
      setError("Mật khẩu mới phải có ít nhất 6 ký tự.")
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
    <PageHeader title="Settings" description="Account security and the active local analytics scope." badge={<Badge tone="primary">Connected</Badge>} />
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="panel p-5"><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary"><UserRound size={18} /></div><div><h2 className="text-sm font-semibold">Account</h2><p className="mt-1 text-xs text-muted-foreground">Loaded from Dashboard API authentication.</p></div></div><dl className="mt-6 grid grid-cols-[120px_minmax(0,1fr)] gap-x-3 gap-y-4 text-xs"><dt className="text-muted-foreground">Display name</dt><dd>{user?.display_name || "Not set"}</dd><dt className="text-muted-foreground">Email</dt><dd>{user?.email || "—"}</dd><dt className="text-muted-foreground">Role</dt><dd><Badge>{user?.role || "—"}</Badge></dd><dt className="text-muted-foreground">User ID</dt><dd className="break-all font-mono">{user?.id || "—"}</dd></dl></section>
      <section className="panel p-5"><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary"><ShieldCheck size={18} /></div><div><h2 className="text-sm font-semibold">Analytics scope</h2><p className="mt-1 text-xs text-muted-foreground">Read-only values configured at build/runtime.</p></div></div><dl className="mt-6 grid grid-cols-[120px_minmax(0,1fr)] gap-x-3 gap-y-4 text-xs"><dt className="text-muted-foreground">Workspace</dt><dd>{workspace}</dd><dt className="text-muted-foreground">Source ID</dt><dd className="font-mono">{sourceId}</dd><dt className="text-muted-foreground">Access</dt><dd><Badge tone="success">Authenticated API</Badge></dd></dl><p className="mt-5 rounded-lg border bg-muted/20 p-3 text-xs leading-5 text-muted-foreground">Workspace and source switching are not persisted by the current backend, so this page does not present a fake save action.</p></section>
    </div>

    <section className="panel mt-4 p-5"><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-lg bg-warning/10 text-warning"><LockKeyhole size={18} /></div><div><h2 className="text-sm font-semibold">Change password</h2><p className="mt-1 text-xs text-muted-foreground">Updates the current Dashboard API account.</p></div></div><form onSubmit={changePassword} className="mt-6 grid max-w-3xl gap-4 md:grid-cols-3"><label className="text-xs"><span className="mb-2 block text-muted-foreground">Current password</span><input type="password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" className="h-10 w-full rounded-lg border bg-background px-3" /></label><label className="text-xs"><span className="mb-2 block text-muted-foreground">New password</span><input type="password" required minLength={6} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" className="h-10 w-full rounded-lg border bg-background px-3" /></label><label className="text-xs"><span className="mb-2 block text-muted-foreground">Confirm password</span><input type="password" required minLength={6} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" className="h-10 w-full rounded-lg border bg-background px-3" /></label><div className="md:col-span-3">{error && <p className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">{error}</p>}{success && <p className="mb-3 rounded-lg border border-success/30 bg-success/5 p-3 text-xs text-success">{success}</p>}<Button disabled={submitting}>{submitting ? <LoaderCircle size={15} className="animate-spin" /> : <KeyRound size={15} />}{submitting ? "Đang cập nhật…" : "Đổi mật khẩu"}</Button></div></form></section>
  </>
}

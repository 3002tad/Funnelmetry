import { Component, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

export class PageErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error) {
    console.error('Dashboard page failed to render', error)
  }

  render() {
    if (this.state.failed) {
      return <section role="alert" className="panel max-w-2xl p-6">
        <h1 className="text-xl font-semibold">Không thể hiển thị trang này</h1>
        <p className="mt-3 text-sm text-muted-foreground">Dữ liệu hoặc giao diện của trang gặp lỗi. Bạn có thể chọn chức năng khác trên menu hoặc tải lại trang.</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button type="button" className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white dark:text-background" onClick={() => window.location.reload()}>Tải lại</button>
          <Link to="/" className="rounded-lg border px-4 py-2 text-sm font-semibold">Về trang chính</Link>
        </div>
      </section>
    }
    return this.props.children
  }
}

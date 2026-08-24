import React from "react";

export class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      message: error?.message || "Dashboard gặp lỗi runtime.",
    };
  }

  componentDidCatch(error) {
    // Keep detailed error in console for debugging.
    // eslint-disable-next-line no-console
    console.error("AppErrorBoundary caught:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="app-crash">
          <h2>Dashboard tạm thời gặp lỗi</h2>
          <p>{this.state.message}</p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => window.location.reload()}
          >
            Tải lại trang
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

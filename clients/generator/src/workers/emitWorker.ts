// Web Worker for Auto Emit timer
// Runs in a separate thread — NOT throttled when tab is inactive

let timerId: ReturnType<typeof setInterval> | null = null;

self.onmessage = (e: MessageEvent) => {
  const { type, intervalMs } = e.data;

  if (type === "start") {
    if (timerId) clearInterval(timerId);
    timerId = setInterval(() => {
      self.postMessage({ type: "tick" });
    }, intervalMs);
  }

  if (type === "stop") {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
  }
};

import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { mkdtempSync, rmSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

async function reservePort() {
  const reservation = createServer()
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve))
  const { port } = reservation.address()
  await new Promise((resolve) => reservation.close(resolve))
  return port
}

test("Source Ingress starts and shuts down without the retired delivery worker", async () => {
  const directory = mkdtempSync(join(tmpdir(), "funnelmetry-source-ingress-main-test-"))
  const port = await reservePort()
  const child = spawn(process.execPath, [fileURLToPath(new URL("../src/main.js", import.meta.url))], {
    env: {
      ...process.env,
      SOURCE_INGRESS_HOST: "127.0.0.1",
      SOURCE_INGRESS_PORT: String(port),
      SOURCE_INGRESS_DATABASE_PATH: join(directory, "event-log.sqlite"),
      SOURCE_INGRESS_BROWSER_KEYS_JSON: JSON.stringify({
        browser: { source_id: "medusa-reference", secret: "browser-secret", allowed_origins: ["https://shop.example.test"] },
      }),
      SOURCE_INGRESS_BACKEND_KEYS_JSON: JSON.stringify({
        backend: { source_id: "medusa-reference", secret: "backend-secret" },
      }),
      SOURCE_INGRESS_EVENT_FEED_TOKENS_JSON: JSON.stringify({ connector: "feed-token" }),
      SOURCE_INGRESS_MIN_FREE_DISK_BYTES: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  let output = ""
  child.stdout.on("data", (chunk) => { output += chunk })
  child.stderr.on("data", (chunk) => { output += chunk })

  try {
    await Promise.race([
      new Promise((resolve, reject) => {
        const interval = setInterval(() => {
          if (output.includes("Funnelmetry Source Ingress listening")) {
            clearInterval(interval)
            resolve()
          }
        }, 10)
        child.once("exit", (code, signal) => {
          clearInterval(interval)
          reject(new Error(`Source Ingress exited before listening (code=${code}, signal=${signal}): ${output}`))
        })
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`Source Ingress did not start: ${output}`)), 5000)),
    ])
    const exited = once(child, "exit")
    child.kill("SIGTERM")
    const [code, signal] = await exited
    if (process.platform === "win32") {
      assert.equal(signal, "SIGTERM")
    } else {
      assert.equal(signal, null)
      assert.equal(code, 0)
    }
  } finally {
    if (!child.killed) child.kill("SIGKILL")
    rmSync(directory, { recursive: true, force: true })
  }
})

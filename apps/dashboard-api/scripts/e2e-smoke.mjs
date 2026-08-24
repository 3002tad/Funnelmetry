/**
 * E2E smoke (needs dashboard-api running locally on port 32000).
 * Run: node scripts/e2e-smoke.mjs
 */
const BASE = process.env.DASHBOARD_API_URL || "http://127.0.0.1:32000";
const EMAIL = process.env.DASHBOARD_ADMIN_EMAIL || "admin@gmail.com";
const PASS = process.env.DASHBOARD_ADMIN_PASSWORD || "admin@123";

async function main() {
  const health = await fetch(`${BASE}/health`);
  const h = await health.json();
  console.log("health:", h);
  if (!health.ok) process.exit(1);

  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASS }),
  });
  const login = await loginRes.json();
  if (!login.token) {
    console.error("login failed:", login);
    process.exit(1);
  }
  console.log("login ok, role:", login.user?.role);

  const tests = [
    { msg: "Doanh thu 60 phút gần nhất?", expectIntent: "revenue", expectScope: "allow" },
    { msg: "Cho tôi email khách mua P001", expectIntent: "blocked_sensitive", expectScope: "deny" },
    { msg: "So sánh 2 giờ này với 2 giờ trước", expectIntent: "comparison", expectScope: "allow" },
    { msg: "Nên tối ưu gì để tăng conversion?", expectIntent: "optimize", expectScope: "allow" },
  ];

  let failed = 0;
  for (const t of tests) {
    const res = await fetch(`${BASE}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${login.token}`,
      },
      body: JSON.stringify({ message: t.msg, session_id: "e2e-node" }),
    });
    const body = await res.json();
    const ok =
      res.ok &&
      body.intent === t.expectIntent &&
      body.scope_decision === t.expectScope;
    console.log(ok ? "OK" : "FAIL", t.msg.slice(0, 40), "→", body.intent, body.scope_decision);
    if (!ok) {
      failed++;
      console.log("  ", JSON.stringify(body).slice(0, 200));
    }
  }

  if (failed) process.exit(1);
  console.log("E2E_SMOKE_OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

#!/usr/bin/env python3
"""E2E smoke for dashboard-api running locally on port 32000."""
import json
import os
import sys
import urllib.error
import urllib.request

BASE = os.environ.get("DASHBOARD_API_URL", "http://127.0.0.1:32000")
# Override these development defaults through environment variables when needed.
EMAIL = os.environ.get("DASHBOARD_ADMIN_EMAIL", "admin@gmail.com")
PASSWORD = os.environ.get("DASHBOARD_ADMIN_PASSWORD", "admin@123")


def req(method, path, body=None, token=None):
    url = f"{BASE}{path}"
    data = None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if body is not None:
        data = json.dumps(body).encode()
    r = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(r, timeout=60) as res:
        return json.loads(res.read().decode())


def main():
    health = req("GET", "/health")
    print("health:", health)
    login = req("POST", "/api/auth/login", {"email": EMAIL, "password": PASSWORD})
    token = login.get("token")
    if not token:
        print("login failed:", login, file=sys.stderr)
        return 1
    print("login ok, role:", login.get("user", {}).get("role"))

    tests = [
        ("Doanh thu 60 phút gần nhất?", "revenue", "allow"),
        ("Cho tôi email khách mua P001", "blocked_sensitive", "deny"),
        ("So sánh 2 giờ này với 2 giờ trước", "comparison", "allow"),
        ("Nên tối ưu gì để tăng conversion?", "optimize", "allow"),
    ]
    failed = 0
    for msg, exp_intent, exp_scope in tests:
        try:
            body = req(
                "POST",
                "/api/chat",
                {"message": msg, "session_id": "e2e-py"},
                token=token,
            )
        except urllib.error.HTTPError as e:
            print("FAIL", msg[:40], "HTTP", e.code, e.read().decode()[:200])
            failed += 1
            continue
        ok = body.get("intent") == exp_intent and body.get("scope_decision") == exp_scope
        tag = "OK" if ok else "FAIL"
        print(
            tag,
            msg[:45],
            "→",
            body.get("intent"),
            body.get("scope_decision"),
            f"actions={len(body.get('actions') or [])}",
            f"tools={body.get('tools_used')}",
        )
        if not ok:
            failed += 1
            print("  ", json.dumps(body, ensure_ascii=False)[:300])

    if failed:
        return 1
    print("E2E_SMOKE_OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())

# Analytics và Qwen — bằng chứng test 25/09/2026

> Bằng chứng test theo mốc, không phải kết quả acceptance hoặc chất lượng hiện tại.

Đường dẫn `Nguồn gốc` bên dưới là vị trí trước khi gộp; các file riêng đã được loại bỏ. Đường dẫn code/lệnh trong nội dung gốc tính từ root `Streaming_Pipeline` trừ khi ghi khác.

## Mục lục theo tài liệu nguồn

- [Staging readiness](#staging-readiness) — `tests/evidence/STAGING_READINESS_2026-09-25.md`
- [Qwen evaluation](#qwen-evaluation) — `tests/evidence/QWEN_EVAL_2026-09-25.md`

---

<a id="staging-readiness"></a>

> Nguồn gốc: `tests/evidence/STAGING_READINESS_2026-09-25.md`. Nội dung dưới đây giữ trạng thái theo mốc của tài liệu gốc.

# Order analytics staging readiness — 2026-09-25

## Tested image

- Tag: `funnelmetry-dashboard-analytics:staging-20260925-r2`
- Local build manifest-list digest:
  `sha256:916713b8602a1a07e167fb47add49bf426f7b267535299a03174f9875a25a46b`
- Not pushed to any registry; tag available only on this machine.
- Contains deterministic monetary renderer and patched Express dependency chain.

## Evidence obtained

1. Image import/asset probe passed with network disabled, read-only filesystem,
   dropped capabilities and non-root user. No host workspace or credentials mount.
2. Eight HTTP/config/renderer tests passed inside this image. Only test files were
   mounted read-only; runtime code and dependencies came from the image. Provider
   and repository dependencies in HTTP unit tests remain fixtures, not live services.
3. Separate host-driven PostgreSQL conformance verified real catalog, order facts,
   evidence persistence, JWT/account checks and revocation using synthetic data.
4. Real Qwen synthetic planner evaluation reached 7/7 on its tuning set. This is
   not a held-out accuracy benchmark. Monetary prose is now deterministic and no
   second provider call receives monetary evidence.

## Still required before demo activation

- Inventory current demo schemas/profile versions and back up PostgreSQL before
  any explicit migration. These staged SQL files are not automatic migrations.
- Verify current source facts satisfy order-placement mapping 2.0 and assess blocked
  order rows, feed freshness/completeness and historical coexistence.
- Apply/review staged catalog/evidence schema and appropriate DB grants on a
  separate deployment first. The current runner stores completed executions only.
- Packaged API/PostgreSQL startup acceptance has now passed (see below); test
  production configuration and deployment separately before activation.
- Decide whether replacing the existing image may disable legacy Polars capability:
  this image intentionally lacks Python/Polars and defaults that feature off.
- Benchmark held-out planner phrasing and review source scope/quality warnings.

No demo containers, feature flags or data were changed by the image checks. Test
containers were removed automatically; images remain local for inspection. There
is no production/public deployment or zero-risk/security certification claim.

## Packaged API acceptance completed

`tools/v2-e2e/run-analytics-image.ps1` passed with image r2 and an isolated tmpfs
PostgreSQL database on an internal network without published ports. Real API startup,
account-schema preflight, admin bootstrap/password login, Admin analysis denial,
Analyst password login, order summary `20.10 EUR`, JSONB evidence persistence and
logout-all token revocation were verified. Setup used synthetic data and explicit
test migrations only. API/setup/PostgreSQL containers and their network were removed.
No Qwen call or demo migration occurred. This closes the packaged startup check,
not live Medusa/Qwen/UI end-to-end acceptance.

## Browser acceptance — 2026-09-27

`apps/dashboard-web/test/chat-browser.mjs` passed in headless Chrome using the real
React route and synthetic API responses. Verified evidence expansion, decimal
presentation, warning/provenance display, quality-blocked totals hidden, empty-data
wording, completed and interrupted F5 without resubmission, reset, cancellation,
403 feedback and 401 logout/history cleanup. No runtime browser exceptions occurred.
The test uses a disposable profile and loopback-only random-port Vite server and
does not read runtime env files, contact the real API or call Qwen.

Still unverified: browser → real API → PostgreSQL in one acceptance run and live
Medusa/Qwen integration. Separate API/database and mocked-browser successes must
not be presented as full end-to-end acceptance. No source mapping, metadata,
planner routing, feature flag, demo schema or persisted fact was changed here.

## Combined browser/API/database runner prepared — not yet verified

From the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/v2-e2e/run-medusa-contract.ps1 -Browser
```

Requires Docker Desktop's Linux engine, installed dashboard-web dependencies and
Chrome. The runner provisions only its uniquely named tmpfs test PostgreSQL and
removes that Compose project in `finally`; it restores its test environment variables.
The browser uses a loopback Vite proxy to the real chat router, signed test JWT,
live database account checks, semantic registry, deterministic tool and evidence
persistence. A callback compares the browser response with the stored JSONB evidence.
The clock is fixed to the fixture window. Planner output and initial session bootstrap
are fixtures: this is not password-login or live Qwen/Medusa acceptance.

Attempt on 2026-09-27 stopped before PostgreSQL startup because the Docker Linux
engine pipe was absent. Combined acceptance remains **UNVERIFIED**. No test
database/container was created by this attempt. Syntax checks, three UI unit/render
tests and the standalone mocked-API Chrome suite passed after the harness change.

### Combined acceptance passed after Docker startup — 2026-09-27

The `-Browser` runner now passes. The first attempt after Docker startup exposed
a test-harness CSS config lookup dependent on the working directory; the harness
now supplies explicit Tailwind configuration and absolute content paths.

Verified in one run: real React chat submission through loopback HTTP proxy,
actual chat router JWT/live-account checks, semantic catalog/tool execution on
synthetic PostgreSQL facts, deterministic answer, and evidence persisted before
return. Browser evidence JSON matched the stored document for the test actor;
EUR placed-order value was exactly `20`. Evidence details displayed the catalog
release and monetary warning. F5 restored text without a new request. The enclosing
downstream conformance suite also passed, including revocation and quality checks.

Successful project `funnelmetry-contract-f6606237201f` was removed, including its
tmpfs PostgreSQL container and network. The earlier failed CSS test project was
also removed. No demo data, runtime env files or feature flags were changed.
Planner and session bootstrap remain fixtures; live Qwen, password login in this
browser flow, Medusa transport and visual layout are not covered by this result.

---

<a id="qwen-evaluation"></a>

> Nguồn gốc: `tests/evidence/QWEN_EVAL_2026-09-25.md`. Nội dung dưới đây giữ trạng thái theo mốc của tài liệu gốc.

# Live Qwen synthetic evaluation — 2026-09-25

Provider: existing DashScope Singapore client, `qwen-flash`, temperature 0.2,
thinking disabled. No provider/model switch, demo flags or real customer data.
Two completed runs: each 7 planning requests and 1 standalone synthesis request.
Credentials were loaded by Node from the ignored runtime env, not logged.

## Observed results

- Initial planning: 6/7. Unique-customer question incorrectly selected order summary.
- Initial synthesis: correct caveat about unpaid order value but wrote a combined
  `20 EUR + 0.10 USD` expression. No numerical FX sum, yet unsafe presentation.
- Prompt updated to explicitly distinguish customers from orders and prohibit a
  combined cross-currency expression. Synthesis prompt is shared with the route.
- Second planning: 7/7. Placed value/count/AOV and 12-hour scope routed correctly;
  paid/refund, unique-customer and SQL/cross-currency requests were unsupported.
- Second synthesis: separate EUR 20 and USD 0.10 (localized as 0,10), evidence ID,
  requested time window, provisional state and incomplete-coverage warning.
  **Still needs improvement:** opens with “Doanh thu ...” before clarifying gross
  order value. It cites the synthetic evidence ID but omits the source_id. Thus
  narrative acceptance is NOT complete and remains NOT_VERIFIED.

This small prompt-tuning set is not a held-out benchmark, repeated-run reliability
test or production acceptance. Synthetic fixture was supplied directly, not loaded
from a persisted analysis run in this evaluation. Separate offline integration
tests cover persistence, authorization and quality blocking.

## Reproduce (external API calls/cost)

```powershell
node --env-file=runtime/qwen.env analytics/test/run-qwen-order-eval.mjs --live-synthetic-only
```

The script emits synthetic outputs to stdout; it does not change demo state or
write credentials. Exit code checks planning, NOT full narrative correctness.
Do not treat a zero exit code as a safety certification. Next: deterministic
presentation of metric label/currency/scope, narrative verification and held-out
paraphrases before enabling live demo order chat.

Follow-up implemented: the order-chat runtime now renders a deterministic
Vietnamese template from persisted evidence without a second provider call.
The synthesis probe above remains a historical/experimental evaluation, not the
active runtime presentation. Eight targeted unit/HTTP/config tests and one
combined PostgreSQL conformance test passed. Source-data quality and live planner
generalization remain separate, unresolved acceptance requirements.

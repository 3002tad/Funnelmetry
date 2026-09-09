# Dashboard account security — 2026-09-09

Scope: Pipeline backend only. No Medusa activation, AI implementation or runtime migration.

## Implemented

- Three assignable roles: super_admin, analyst, staff; viewer remains legacy-only.
- Staff summary reads separated from analytics workspace access.
- Versioned JWT sessions checked against current DB state for authenticated API requests.
- Password/role/active-state changes increment session version using a PostgreSQL trigger.
- Account-management mutations recheck actor inside a serialized transaction, preserve
  at least one active Admin, and commit audit alongside the change.
- Self password changes use conditional hash/version updates and transactional audit.
- Bootstrap no longer resets existing passwords, renames Admins or reactivates accounts.

## Verification

18 tests passed, 0 skipped: role/session unit checks, admin HTTP + isolated PostgreSQL,
analytics HTTP/query/repository regression tests. Includes concurrent Admin disable,
last-admin rollback, audit-write failure rollback and stale token after password reset.
Tests use temporary schema/database only, not the user's runtime database.

## Deployment and remaining scope

Stop old API before applying dashboard migrations 006, 007, 008 after the account
schema 003. These are separate from canonical V2 migrations. Existing JWTs without
session_version require login again. See apps/dashboard-api/README.md for details.

Revocation applies on the next request, not an already-open SSE or in-flight request.
No audit UI, rejected-attempt audit, tamper-proof storage, or complete business
capability matrix yet. Direct operator SQL is outside the last-admin API guard.
Legacy chat capability policy remains unchanged; no new AI behavior is implemented.
No claim of complete production security. Changes are not committed/pushed yet.

## Follow-up: account audit read API

Added GET /api/v2/admin/audit protected by audit.read (Admin only), bounded filters,
and microsecond-preserving timestamp/UUID keyset pagination. Output projects allowed
fields rather than returning raw audit JSON. Migration 009 adds the pagination index.
19 regression tests passed with 0 skipped, including PostgreSQL pagination with equal
timestamps, actor/target/action filtering, and exclusion of an injected password_hash
field. Runtime database remains untouched; no Medusa or AI work.

## Follow-up: fail-closed account startup

API validates the account/session/audit schema before bootstrap and HTTP listen.
Missing tables/columns, absent or disabled session trigger and missing Staff constraint
stop startup with a migration hint. Other startup failures retry up to 8 times, then
close the pool and exit nonzero. Removed the previous finally-listen behavior.
22 regression tests passed, 0 skipped, including actual PostgreSQL trigger disable/re-enable
and read-only schema preflight. No runtime database changes or UI implementation.

## Follow-up: full application auth flow

Added auth-flow.integration.test.js using createApp(), real bcrypt/JWT and isolated
PostgreSQL. Covers login, Staff creation/permissions, self password change and stale-token
rejection, rollback when password audit cannot be written, account lock/unlock without
reviving an old token, and bootstrap preserving a locked Admin. No external services
or user runtime database are used. The expanded backend regression suite has 23 tests.

## Follow-up: atomic audited bootstrap

Bootstrap now acquires the account-management table lock before checking whether the
account store is empty. Initial Admin and account.bootstrapped audit commit together;
audit failure leaves no account. Bootstrap audit self-references the created account
and must not be interpreted as an authenticated human actor. sync-admin is retained
as a compatibility name for bootstrap only, with schema preflight and DB pool cleanup.
Removed automatic schema creation from bootstrap; migrations remain explicit.

23 tests passed, 0 skipped after expanding the real-app PostgreSQL test with three
concurrent bootstrap calls, audit-failure rollback, and repeat bootstrap preserving a
locked Admin without additional bootstrap audit. No runtime migration or external integration.

## Follow-up: account-wide logout API

POST /api/auth/logout-all atomically increments the authenticated account's session
version and writes sessions.revoked audit. It does not accept a target account, close
in-flight streams, or implement per-device revocation. The existing UI logout has not
been wired to this endpoint. No additional migration required.

23 regression tests passed, 0 skipped, with expanded full-app assertions for concurrent
logout (one success/one expired), audit outage rollback, old-token rejection, successful
re-login and no impact on another account. Temporary PostgreSQL resources cleaned up.

## Follow-up: session checks on open SSE connections

Supersedes the earlier open-SSE limitation: /api/events/stream now checks expiry,
session version, account status and workspace permission before each outgoing batch,
plus idle ping checks every 5 seconds. Auth timeout/error or invalid session closes
the connection; disconnect removes listeners/timers and pending work. Queue bounded
to 32 batches; overflow/backpressure closes rather than buffering indefinitely.

27 regression tests passed, 0 skipped, including full HTTP SSE receiving a batch,
logout-all through the real app, then stream closure without delivering the next
batch. Unit cases cover idle revocation, expiry, DB errors/timeouts and cleanup.
Not instantaneous transaction-synchronized revocation, durable SSE replay, or migration
of the legacy stream source to V2. Runtime database and Medusa remain untouched.

## Follow-up: read-only schema diagnostic

Added npm run schema:check using only PostgreSQL environment configuration; no AI,
Medusa or JWT setup needed. It runs the shared preflight in BEGIN READ ONLY and emits
sanitized JSON status with nonzero exit on missing schema, invalid config or outage.
Does not apply migrations, seed accounts or start listeners. README now explains
fresh-install/upgrade order and the distinction from canonical V2 migrations.

29 regression tests passed, 0 skipped. Real PostgreSQL checks cover READY and disabled
session trigger without creating accounts; unit tests cover read-only transaction,
config errors, connection cleanup and absence of secret values in reports.

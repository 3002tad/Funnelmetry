export class AccountSchemaError extends Error {
  constructor() {
    super('dashboard_account_schema_incomplete: apply dashboard migrations 003, 006, 007, 008, 009 before starting API')
    this.name = 'AccountSchemaError'
  }
}

// Read-only startup preflight; never applies migrations or repairs user data.
export async function assertAccountSchema(execute) {
  try {
    await execute(`SELECT id,email,password_hash,display_name,role,is_active,session_version,
      last_login_at,created_at,updated_at FROM dashboard_users LIMIT 0`)
    await execute('SELECT id,actor_id,target_id,action,changes,created_at FROM dashboard_account_audit LIMIT 0')
    const [state] = await execute(`SELECT
      EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='dashboard_users'::regclass
        AND attname='session_version' AND atttypid='integer'::regtype AND attnotnull AND NOT attisdropped) AS session_column,
      EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
        WHERE t.tgrelid='dashboard_users'::regclass AND t.tgname='dashboard_revoke_sessions'
          AND t.tgenabled IN ('O','A') AND NOT t.tgisinternal AND t.tgtype=19
          AND p.proname='dashboard_revoke_sessions'
          AND p.pronamespace=(SELECT relnamespace FROM pg_class WHERE oid='dashboard_users'::regclass)) AS session_trigger,
      EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='dashboard_users'::regclass
        AND conname='dashboard_users_role_check' AND contype='c' AND convalidated
        AND pg_get_constraintdef(oid) LIKE '%''staff''%') AS staff_constraint`)
    if (!state?.session_column || !state.session_trigger || !state.staff_constraint) throw new AccountSchemaError()
  } catch (error) {
    if (['42P01', '42703', '42883'].includes(error.code)) throw new AccountSchemaError()
    throw error
  }
}

export async function prepareAccountStartup({ execute, seed, attempts = 8,
  wait = () => new Promise(resolve => setTimeout(resolve, 3000)), onRetry = () => {} }) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await assertAccountSchema(execute)
      await seed()
      return
    } catch (error) {
      if (error instanceof AccountSchemaError || attempt === attempts) throw error
      onRetry(attempt)
      await wait()
    }
  }
}

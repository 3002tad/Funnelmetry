import assert from 'node:assert/strict'
import test from 'node:test'
import { postgresConfig } from './postgres-config.mjs'

test('CDC PostgreSQL config supports a mounted DSN without exposing its value', () => {
  const options = postgresConfig({ DATABASE_URL_FILE: '/run/secrets/cdc_url' },
    (path, encoding) => {
      assert.equal(path, '/run/secrets/cdc_url')
      assert.equal(encoding, 'utf8')
      return 'postgres://user:password@db:5432/cdc\n'
    })
  assert.deepEqual(options, { connectionString: 'postgres://user:password@db:5432/cdc' })
  assert.throws(() => postgresConfig({ DATABASE_URL: 'postgres://one',
    DATABASE_URL_FILE: '/run/secrets/other' }), /postgres_url_sources_conflict/)
})

test('CDC PostgreSQL config accepts the Pipeline password secret and rejects ambiguity', () => {
  const env = { POSTGRES_HOST: 'postgres', POSTGRES_DB: 'funnelmetry_handoff',
    POSTGRES_USER: 'funnelmetry', POSTGRES_PASSWORD_FILE: '/run/secrets/db_password' }
  assert.deepEqual(postgresConfig(env, () => 'secret\n'), {
    host: 'postgres', port: 5432, database: 'funnelmetry_handoff',
    user: 'funnelmetry', password: 'secret',
  })
  assert.throws(() => postgresConfig({ ...env, POSTGRES_PASSWORD: 'other' }),
    /postgres_password_sources_conflict/)
  assert.throws(() => postgresConfig({ ...env, POSTGRES_PORT: '0' }, () => 'secret'),
    /postgres_connection_config_invalid/)
  assert.throws(() => postgresConfig(env, () => ' \n'), /postgres_secret_file_empty/)
})

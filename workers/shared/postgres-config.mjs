import { readFileSync } from 'node:fs'

function secret(path, read) {
  const value = read(path, 'utf8').trim()
  if (!value) throw Error('postgres_secret_file_empty')
  return value
}

// Shared by CDC candidates so Swarm can mount credentials as Docker secrets.
// The direct URL remains available to the isolated Compose rehearsals.
export function postgresConfig(env = process.env, read = readFileSync) {
  if (env.DATABASE_URL && env.DATABASE_URL_FILE) {
    throw Error('postgres_url_sources_conflict')
  }
  if (env.DATABASE_URL_FILE) {
    return { connectionString: secret(env.DATABASE_URL_FILE, read) }
  }
  if (env.DATABASE_URL) return { connectionString: env.DATABASE_URL }

  if (env.POSTGRES_PASSWORD && env.POSTGRES_PASSWORD_FILE) {
    throw Error('postgres_password_sources_conflict')
  }
  const port = Number(env.POSTGRES_PORT ?? 5432)
  const password = env.POSTGRES_PASSWORD_FILE
    ? secret(env.POSTGRES_PASSWORD_FILE, read) : env.POSTGRES_PASSWORD
  if (!env.POSTGRES_HOST || !env.POSTGRES_DB || !env.POSTGRES_USER ||
      !password || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw Error('postgres_connection_config_invalid')
  }
  return { host: env.POSTGRES_HOST, port, database: env.POSTGRES_DB,
    user: env.POSTGRES_USER, password }
}

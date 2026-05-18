const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.POSTGRES_HOST || "postgres",
  port: parseInt(process.env.POSTGRES_PORT) || 5432,
  database: process.env.POSTGRES_DB || "realtime",
  user: process.env.POSTGRES_USER || "app",
  password: process.env.POSTGRES_PASSWORD || "app",
  max: 30,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  statement_timeout: 10000,
});

const queryCache = new Map();
const CACHE_TTL_MS = parseInt(process.env.CACHE_TTL_MS) || 3000;

function cachedQuery(key, queryFn) {
  const now = Date.now();
  const cached = queryCache.get(key);
  if (cached && now - cached.ts < CACHE_TTL_MS) {
    return cached.promise;
  }
  const promise = queryFn();
  queryCache.set(key, { promise, ts: now });
  promise.catch(() => queryCache.delete(key));
  return promise;
}

module.exports = { pool, cachedQuery };

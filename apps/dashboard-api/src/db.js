import pg from "pg";
import { config } from "./config.js";

const pool = new pg.Pool(config.db);
// Server-only adapter for staged analytical execution; never exposed to model input.
export const analyticalPool = pool;
export const closeDatabase = () => pool.end();

pool.on("error", (err) => {
  console.error("postgres pool error", err.message);
});

export async function query(sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return rows;
}

export async function transaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '15s'");
    const result = await work(async (sql, params = []) => (await client.query(sql, params)).rows);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

export async function readOnlyTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '10s'");
    await client.query("SET LOCAL lock_timeout = '2s'");
    return await work(async (sql, params = []) => (await client.query(sql, params)).rows);
  } finally {
    try { await client.query('ROLLBACK'); } finally { client.release(); }
  }
}

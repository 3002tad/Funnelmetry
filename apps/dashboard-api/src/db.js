import pg from "pg";
import { config } from "./config.js";

const pool = new pg.Pool(config.db);

pool.on("error", (err) => {
  console.error("postgres pool error", err.message);
});

export async function query(sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return rows;
}

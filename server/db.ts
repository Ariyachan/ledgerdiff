import pg from "pg";
import { readFile } from "node:fs/promises";

export function createPool(connectionString: string) {
  const pool = new pg.Pool({ connectionString, max: 8 });
  pool.on("error", (error) =>
    console.error("PostgreSQL idle connection failed:", error.message),
  );
  return pool;
}

export async function migrate(pool: pg.Pool) {
  const sql = await readFile(
    new URL("../migrations/001_initial.sql", import.meta.url),
    "utf8",
  );
  await pool.query(sql);
}

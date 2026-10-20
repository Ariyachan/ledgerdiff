import { createPool, migrate } from "./db";
if (!process.env.DATABASE_URL)
  throw new Error("Set DATABASE_URL in .env before running migrations.");
const pool = createPool(process.env.DATABASE_URL);
try {
  await migrate(pool);
  console.log("LedgerDiff database migration complete.");
} finally {
  await pool.end();
}

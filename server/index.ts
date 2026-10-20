import { createPool, migrate } from "./db";
import { createApp } from "./app";

const connectionString = process.env.DATABASE_URL;
const secret = process.env.SESSION_SECRET;
if (!connectionString || !secret)
  throw new Error(
    "Set DATABASE_URL and SESSION_SECRET in .env. See README.md.",
  );
const pool = createPool(connectionString);
await migrate(pool);
const { app, store } = createApp({
  pool,
  secret,
  webOrigin: process.env.WEB_ORIGIN ?? "http://127.0.0.1:5174",
  secureCookie: process.env.COOKIE_SECURE === "true",
});
const port = Number(process.env.PORT ?? 4200);
const server = app.listen(port, process.env.HOST ?? "127.0.0.1", () =>
  console.log(
    `LedgerDiff API ready on http://${process.env.HOST ?? "127.0.0.1"}:${port}`,
  ),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    server.close(() => {
      store.close();
      void pool.end().then(() => process.exit(0));
    });
  });

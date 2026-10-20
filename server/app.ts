import express, { type ErrorRequestHandler } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { z } from "zod";
import type pg from "pg";
import {
  compareCsv,
  InputError,
  parseCsv,
  reportCsv,
} from "../shared/comparison";
import type { ComparisonResult, Report, ReportSummary } from "../shared/types";

declare module "express-session" {
  interface SessionData {
    workspace: boolean;
  }
}

type Options = {
  pool: pg.Pool;
  secret: string;
  webOrigin: string;
  secureCookie?: boolean;
  staticDir?: string;
};
type ReportRow = {
  id: string;
  name: string;
  notes: string;
  key_column: string;
  before_filename: string;
  after_filename: string;
  result: ComparisonResult;
  created_at: Date;
  updated_at: Date;
};
const filenameSchema = z
  .string()
  .min(1)
  .max(255)
  .refine(
    (value) => !value.includes("\0"),
    "NUL characters are not supported.",
  );
const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine(
    (value) => !value.includes("\0"),
    "NUL characters are not supported.",
  );
const csvSchema = z
  .object({
    csv: z.string().min(1),
    filename: filenameSchema,
    delimiter: z.enum(["", ",", ";", "\t"]).default(""),
  })
  .strict();
const comparisonSchema = z
  .object({
    name: nameSchema,
    key: z.string().min(1).max(1000),
    before: csvSchema,
    after: csvSchema,
  })
  .strict();
const patchSchema = z
  .object({
    name: nameSchema.optional(),
    notes: z
      .string()
      .max(2000)
      .refine(
        (value) => !value.includes("\0"),
        "NUL characters are not supported.",
      )
      .optional(),
  })
  .strict()
  .refine(
    (value) => value.name !== undefined || value.notes !== undefined,
    "Provide a name or notes.",
  );

function toReport(row: ReportRow): Report {
  return {
    id: row.id,
    name: row.name,
    notes: row.notes,
    key: row.key_column,
    beforeFilename: row.before_filename,
    afterFilename: row.after_filename,
    stats: row.result.stats,
    result: row.result,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function createApp(options: Options) {
  if (options.secret.length < 32)
    throw new Error("SESSION_SECRET must contain at least 32 characters.");
  const app = express();
  app.disable("x-powered-by");
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.get("/api/health", async (_req, res) => {
    await options.pool.query("SELECT 1");
    res.json({ status: "ok", database: "connected" });
  });
  app.use("/api", (req, res, next) => {
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers.origin &&
      ![
        options.webOrigin,
        "http://127.0.0.1:4200",
        "http://localhost:4200",
      ].includes(req.headers.origin)
    ) {
      res
        .status(403)
        .json({ error: "Open LedgerDiff in its own tab and try again." });
      return;
    }
    next();
  });
  // JSON escaping may expand CSV bytes; each decoded CSV is independently capped at 8 MiB.
  app.use("/api", express.json({ limit: "100mb" }));
  const PgStore = connectPgSimple(session);
  const store = new PgStore({
    pool: options.pool,
    tableName: "ledgerdiff_sessions",
    createTableIfMissing: false,
    pruneSessionInterval: 900,
  });
  app.use(
    "/api",
    session({
      name: "ledgerdiff.sid",
      secret: options.secret,
      resave: false,
      saveUninitialized: false,
      store,
      cookie: {
        httpOnly: true,
        sameSite: "strict",
        secure: options.secureCookie ?? false,
        maxAge: 30 * 24 * 60 * 60 * 1000,
      },
    }),
  );
  app.get("/api/session", (req, res, next) => {
    req.session.workspace = true;
    req.session.save((error) => {
      if (error) next(error);
      else res.json({ ready: true, retentionDays: 30 });
    });
  });
  app.use("/api/comparisons", (req, res, next) => {
    if (!req.session.workspace) {
      res
        .status(401)
        .json({
          error:
            "Your workspace session expired. Reload the page to start a new workspace.",
        });
      return;
    }
    next();
  });
  app.get("/api/comparisons", async (req, res) => {
    const result = await options.pool.query<
      Omit<ReportRow, "result"> & { stats: ComparisonResult["stats"] }
    >(
      `SELECT id, name, notes, key_column, before_filename, after_filename, created_at, updated_at,
      result->'stats' AS stats FROM ledgerdiff_reports WHERE owner_sid = $1 ORDER BY created_at DESC LIMIT 100`,
      [req.sessionID],
    );
    const reports: ReportSummary[] = result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      notes: row.notes,
      key: row.key_column,
      beforeFilename: row.before_filename,
      afterFilename: row.after_filename,
      stats: row.stats,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    }));
    res.json({ reports });
  });
  app.post("/api/comparisons", async (req, res) => {
    const body = comparisonSchema.parse(req.body);
    const before = parseCsv(body.before.csv, body.before.delimiter);
    const after = parseCsv(body.after.csv, body.after.delimiter);
    const comparison = compareCsv(before, after, body.key);
    const result = await options.pool.query<ReportRow>(
      `INSERT INTO ledgerdiff_reports(id, owner_sid, name, key_column, before_filename, after_filename, result)
      VALUES($1, $2, $3, $4, $5, $6, $7::jsonb) RETURNING *`,
      [
        randomUUID(),
        req.sessionID,
        body.name,
        body.key,
        body.before.filename,
        body.after.filename,
        JSON.stringify(comparison),
      ],
    );
    res.status(201).json(toReport(result.rows[0]));
  });
  app.param("id", (_req, res, next, id: string) => {
    if (!z.uuid().safeParse(id).success) {
      res.status(404).json({ error: "Report not found in this workspace." });
      return;
    }
    next();
  });
  app.get("/api/comparisons/:id", async (req, res) => {
    const result = await options.pool.query<ReportRow>(
      "SELECT * FROM ledgerdiff_reports WHERE id = $1 AND owner_sid = $2",
      [req.params.id, req.sessionID],
    );
    if (!result.rows[0]) {
      res.status(404).json({ error: "Report not found in this workspace." });
      return;
    }
    res.json(toReport(result.rows[0]));
  });
  app.get("/api/comparisons/:id/export/:format", async (req, res) => {
    if (!["csv", "json"].includes(String(req.params.format))) {
      res.status(400).json({ error: "Choose CSV or JSON." });
      return;
    }
    const result = await options.pool.query<ReportRow>(
      "SELECT * FROM ledgerdiff_reports WHERE id = $1 AND owner_sid = $2",
      [req.params.id, req.sessionID],
    );
    if (!result.rows[0]) {
      res.status(404).json({ error: "Report not found in this workspace." });
      return;
    }
    const report = toReport(result.rows[0]);
    res.attachment(`ledgerdiff-${report.id}.${req.params.format}`);
    if (req.params.format === "json")
      res.type("application/json").send(JSON.stringify(report, null, 2));
    else
      res
        .type("text/csv; charset=utf-8")
        .send("\uFEFF" + reportCsv(report.result.changes));
  });
  app.patch("/api/comparisons/:id", async (req, res) => {
    const body = patchSchema.parse(req.body);
    const result = await options.pool.query<ReportRow>(
      `UPDATE ledgerdiff_reports SET name = COALESCE($1, name), notes = COALESCE($2, notes), updated_at = now()
      WHERE id = $3 AND owner_sid = $4 RETURNING *`,
      [body.name ?? null, body.notes ?? null, req.params.id, req.sessionID],
    );
    if (!result.rows[0]) {
      res.status(404).json({ error: "Report not found in this workspace." });
      return;
    }
    res.json(toReport(result.rows[0]));
  });
  app.delete("/api/comparisons/:id", async (req, res) => {
    const result = await options.pool.query(
      "DELETE FROM ledgerdiff_reports WHERE id = $1 AND owner_sid = $2 RETURNING id",
      [req.params.id, req.sessionID],
    );
    if (!result.rows.length) {
      res.status(404).json({ error: "Report not found in this workspace." });
      return;
    }
    res.status(204).end();
  });
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "This endpoint does not exist." });
  });
  const staticDir = options.staticDir ?? resolve("dist");
  if (existsSync(staticDir)) app.use(express.static(staticDir));
  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof InputError) {
      res.status(400).json({ error: error.message });
      return;
    }
    if (error instanceof z.ZodError) {
      res
        .status(400)
        .json({
          error: error.issues
            .map(
              (issue) =>
                `${issue.path.join(".") || "Request"}: ${issue.message}`,
            )
            .join("; "),
        });
      return;
    }
    if (error.type === "entity.too.large") {
      res
        .status(413)
        .json({
          error: "The request is too large. Each CSV must be 8 MB or smaller.",
        });
      return;
    }
    if (error instanceof SyntaxError && "body" in error) {
      res.status(400).json({ error: "The request is not valid JSON." });
      return;
    }
    console.error("Request failed:", error.message);
    res
      .status(503)
      .json({
        error:
          "Your report could not be saved or loaded. Check the connection and try again.",
      });
  };
  app.use(errorHandler);
  return { app, store };
}

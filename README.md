# LedgerDiff

A CSV comparison workspace with an actual React interface, Node API and PostgreSQL persistence. Match snapshots by one unique key, review field changes and keep a named report with notes. This is one independent, self-initiated portfolio project using fictional example orders, not a client engagement or accounting certification.

The existing offline `../ledgerdiff/LedgerDiff.html` supplied the problem, visual direction and sample orders. It remains unchanged. This edition uses PapaParse rather than the old hand-written parser and adds a real API, session separation and persisted reports.

## Run locally

Requires Node.js **22.12+**, npm and PostgreSQL. The checked-in `package-lock.json` fixes the installed dependency tree.

```powershell
npm ci
Copy-Item .env.example .env
```

Edit `.env` with your own local database connection and a random `SESSION_SECRET` of at least 32 characters. Generate the secret locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. The database user needs permission to create this app's tables. `.env` is ignored by Git and Docker; never publish its values.

```powershell
npm run db:migrate
npm start
```

In a second terminal:

```powershell
npm run dev
```

Open **http://localhost:5174**. Vite proxies `/api` to **http://127.0.0.1:4200**. Set `WEB_ORIGIN=http://localhost:5174` for that URL. For an explicit `127.0.0.1:5174` browser URL, set `WEB_ORIGIN` to that origin instead. Both ports are strict and default to loopback binding; running this does not publish a public service.

Use **Try a sample comparison** to save fictional orders. The sample has one added, one removed, two changed and one unchanged record. Refresh to read the saved report from PostgreSQL. Upload two UTF-8 CSV files or use the optional paste areas, choose a shared unique key, then compare. Saved reports can be reopened, renamed, annotated, exported or deleted. Only the latest 100 reports are listed; a known report URL can still retrieve its report within the same session.

For a production client build, run `npm run build`, then `npm start`. Express serves `dist/` and the API together at **http://localhost:4200**. The included configuration is a local demonstration; HTTPS, reverse-proxy settings, an account/recovery system, backups, rate controls and operational deployment are not part of this local preview. A session cookie is not a durable user account.

## Optional independent Docker stack

This project can run its own database without the shared preview database. Set `POSTGRES_PASSWORD` to a URL-safe random value and `SESSION_SECRET` in `.env`, then:

```powershell
docker compose up --build -d
```

Open **http://localhost:4200**. PostgreSQL uses local port **5544** and a named volume; the app creates its tables on startup. Stop the standalone stack before using the Node API on port 4200. `docker compose down` preserves the database volume. The API/PG tests described below were run against the actual shared local PostgreSQL 18.4 instance on port 55432; the optional stack is supplied separately and must not be confused with that tested runtime.

## Data rules

- **8 MiB per decoded UTF-8 CSV**, 50,000 records, 100 columns and 100,000 report entries. JSON transport has a larger limit because escaping can expand the same CSV bytes.
- PapaParse handles quoted commas, escaped quotes, quoted newlines, CRLF, BOM and comma/semicolon/tab separation. One-column files may need an explicit separator.
- Headers must be unique and non-empty; rows must have exactly the header's field count. Entirely blank lines are skipped. Keys must be shared, unique and non-empty. Composite keys are not supported.
- Values remain strings. Leading zeros, large identifiers, spaces and capitalization are preserved. Reordering rows or columns is not a change. A changed record can contain several changed-field entries. Unchanged records are included in the report and can be filtered.
- A missing column uses `null`; an empty cell uses `""`. The UI labels these separately. JSON preserves them exactly. CSV includes `before_missing` / `after_missing` flags and uses PapaParse's `escapeFormulae` protection for spreadsheet opening.
- Original CSV files are not retained separately. Report values and metadata are stored in PostgreSQL. History is isolated by an `express-session` cookie and `connect-pg-simple` store; queries always scope reports to the current session. It has no sign-in or cross-device recovery. Clearing cookies loses access. Sessions expire after 30 days; session pruning cascades to report deletion.
- Only synthetic example data was used for verification. This tool identifies text differences, not accounting correctness or authorization to change source records.

## API

Initialize with `GET /api/session` and retain the resulting `ledgerdiff.sid` cookie. There are no public share URLs or caller-supplied owner IDs.

| Method | Endpoint | Result |
| --- | --- | --- |
| GET | `/api/health` | Actual database connectivity |
| GET | `/api/session` | Initialize or resume browser workspace |
| POST | `/api/comparisons` | Parse, validate, compare and save; HTTP 201 |
| GET | `/api/comparisons` | Latest 100 report summaries for the session |
| GET | `/api/comparisons/:id` | Exact saved report |
| PATCH | `/api/comparisons/:id` | Update name and/or notes |
| DELETE | `/api/comparisons/:id` | Delete owned report; HTTP 204 |
| GET | `/api/comparisons/:id/export/csv` | Complete CSV attachment |
| GET | `/api/comparisons/:id/export/json` | Complete exact JSON attachment |

POST accepts `{ name, key, before: { csv, filename, delimiter }, after: { csv, filename, delimiter } }`. `delimiter` is optional: `""` means automatic; `","`, `";"` and `"\t"` are supported. PATCH accepts `{ name?, notes? }`. Invalid input produces HTTP 400 with a concrete message; oversized transport produces 413; uninitialized/expired sessions produce 401; an inaccessible report produces 404; unavailable persistence produces 503. The UI shows errors without pretending an unsuccessful report was saved.

## Verify

```powershell
npm run typecheck
npm test
npm run test:integration
npm run build
```

Core tests cover exact counts, quoted separators/newlines, leading zeros, large IDs, schema changes, empty versus missing values, uneven columns, duplicate headers/keys, empty keys, file size, empty datasets and CSV export. Integration tests require `DATABASE_URL`; they use real HTTP and PostgreSQL without a substitute database. They check persistence, session isolation for read/update/delete/export, edits, exports, invalid input, 8 MiB rejection, and reading with the same cookie after recreating the app. Test reports are removed in cleanup. Tests use ephemeral HTTP ports and do not take over the running preview.

See `docs/sources.md` for the official library references consulted before implementation and `verification.json` for the actual local check results. Browser screenshots, when available, are in `screenshots/`; screenshots are supporting evidence, not a substitute for persistence tests.

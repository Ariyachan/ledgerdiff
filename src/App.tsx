import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { MAX_FILE_BYTES, parseCsv } from "../shared/comparison";
import { example } from "../shared/example";
import type {
  Change,
  ChangeType,
  CsvInput,
  ParsedCsv,
  Report,
  ReportSummary,
} from "../shared/types";

type Draft = {
  input: CsvInput | null;
  parsed: ParsedCsv | null;
  error: string;
};
const emptyDraft = (): Draft => ({ input: null, parsed: null, error: "" });
const statusLabels: Record<ChangeType, string> = {
  added: "Added",
  removed: "Removed",
  changed: "Changed",
  unchanged: "Unchanged",
};
const date = (value: string) =>
  new Date(value).toLocaleDateString("en", { day: "numeric", month: "short" });

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
  }).catch(() => {
    throw new Error(
      "The connection was interrupted. Check the connection and try again.",
    );
  });
  if (!response.ok) {
    const body = await response
      .json()
      .catch(() => ({
        error: `Request failed (${response.status}). Please try again.`,
      }));
    throw new Error(body.error || "The request could not be completed.");
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function FilePanel({
  side,
  number,
  draft,
  onChange,
  disabled,
}: {
  side: string;
  number: string;
  draft: Draft;
  onChange: (input: CsvInput | null, error?: string) => void;
  disabled: boolean;
}) {
  const readVersion = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [paste, setPaste] = useState(false);
  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const version = ++readVersion.current;
    const file = event.target.files?.[0];
    if (!file) {
      onChange(null);
      return;
    }
    onChange(null);
    if (file.size > MAX_FILE_BYTES) {
      onChange(null, "This file exceeds 8 MB. Choose a smaller export.");
      return;
    }
    try {
      const csv = new TextDecoder("utf-8", { fatal: true }).decode(
        await file.arrayBuffer(),
      );
      if (version === readVersion.current)
        onChange({
          csv,
          filename: file.name,
          delimiter: draft.input?.delimiter ?? "",
        });
    } catch {
      if (version === readVersion.current)
        onChange(
          null,
          "This file could not be read as UTF-8. Export it as UTF-8 CSV and try again.",
        );
    }
  }
  return (
    <section className={`file-panel ${draft.error ? "has-error" : ""}`}>
      <div className="panel-top">
        <span className="eyebrow">
          {number} / {side === "Before" ? "ORIGINAL" : "UPDATED"}
        </span>
        <span className="file-format">.CSV</span>
      </div>
      <h2>
        {side}
        <span> snapshot</span>
      </h2>
      <div className="file-picker">
        <span className="file-symbol" aria-hidden="true">
          ↥
        </span>
        <div>
          <strong>{draft.input?.filename ?? "Choose your CSV export"}</strong>
          <p>UTF-8 · up to 8 MB</p>
        </div>
        <label className="button compact" htmlFor={`${side}-file`}>
          Browse
          <input
            ref={inputRef}
            id={`${side}-file`}
            type="file"
            accept=".csv,.tsv,text/csv,text/tab-separated-values"
            onChange={(event) => void choose(event)}
            disabled={disabled}
          />
        </label>
      </div>
      <div className="file-meta">
        <label htmlFor={`${side}-separator`}>Separator</label>
        <select
          id={`${side}-separator`}
          disabled={!draft.input || disabled}
          value={draft.input?.delimiter ?? ""}
          onChange={(event) => {
            if (draft.input)
              onChange({ ...draft.input, delimiter: event.target.value });
          }}
        >
          <option value="">Detect automatically</option>
          <option value=",">Comma</option>
          <option value=";">Semicolon</option>
          <option value={"\t"}>Tab</option>
        </select>
      </div>
      <div className="file-foot" aria-live="polite">
        {draft.error ? (
          <span className="error-text">{draft.error}</span>
        ) : draft.parsed ? (
          <span>
            <i className="ready-dot" />
            {draft.parsed.rows.length.toLocaleString()} records ·{" "}
            {draft.parsed.headers.length} columns
          </span>
        ) : (
          <span>No file selected</span>
        )}
        <button
          type="button"
          className="text-button"
          onClick={() => setPaste((value) => !value)}
          disabled={disabled}
        >
          {paste ? "Hide paste area" : "Paste CSV"}
        </button>
      </div>
      {paste && (
        <label className="paste-label">
          {side} CSV text
          <textarea
            aria-label={`${side} CSV text`}
            rows={5}
            placeholder="order_id,status,total&#10;ORD-001,pending,120.00"
            disabled={disabled}
            value={draft.input?.csv ?? ""}
            onChange={(event) => {
              readVersion.current++;
              if (inputRef.current) inputRef.current.value = "";
              onChange(
                event.target.value
                  ? {
                      csv: event.target.value,
                      filename: `${side.toLowerCase()}-pasted.csv`,
                      delimiter: draft.input?.delimiter ?? "",
                    }
                  : null,
              );
            }}
          />
        </label>
      )}
    </section>
  );
}

function Value({ value }: { value: string | null }) {
  if (value === null) return <span className="missing">Not present</span>;
  if (value === "") return <span className="missing">Empty string</span>;
  return <span className="cell-value">{value}</span>;
}

export function App() {
  const [before, setBefore] = useState<Draft>(emptyDraft);
  const [after, setAfter] = useState<Draft>(emptyDraft);
  const [key, setKey] = useState("");
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [selected, setSelected] = useState<Report | null>(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [editName, setEditName] = useState("");
  const [notes, setNotes] = useState("");
  const [deletePending, setDeletePending] = useState(false);
  const loadVersion = useRef(0);
  const resultsRef = useRef<HTMLElement>(null);
  const commonKeys =
    before.parsed?.headers.filter((field) =>
      after.parsed?.headers.includes(field),
    ) ?? [];

  function selectReport(report: Report | null) {
    setSelected(report);
    setEditName(report?.name ?? "");
    setNotes(report?.notes ?? "");
    setFilter("all");
    setSearch("");
    setPage(0);
    setDeletePending(false);
    const url = new URL(window.location.href);
    if (report) url.searchParams.set("report", report.id);
    else url.searchParams.delete("report");
    window.history.replaceState(null, "", url);
  }
  async function initialize() {
    const version = ++loadVersion.current;
    setLoading(true);
    setError("");
    try {
      await api("/api/session");
      const response = await api<{ reports: ReportSummary[] }>(
        "/api/comparisons",
      );
      const requested = new URLSearchParams(window.location.search).get(
        "report",
      );
      const id =
        response.reports.find((report) => report.id === requested)?.id ??
        response.reports[0]?.id;
      const report = id ? await api<Report>(`/api/comparisons/${id}`) : null;
      if (version === loadVersion.current) {
        setReports(response.reports);
        selectReport(report);
        setReady(true);
      }
    } catch (problem) {
      if (version === loadVersion.current) {
        setError(
          problem instanceof Error
            ? problem.message
            : "Your workspace could not be loaded.",
        );
        setReady(false);
      }
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }
  useEffect(() => {
    void initialize();
    return () => {
      loadVersion.current++;
    };
  }, []);
  useEffect(() => {
    if (!commonKeys.includes(key)) setKey(commonKeys[0] ?? "");
  }, [before.parsed, after.parsed, key]);

  function updateDraft(
    side: "before" | "after",
    input: CsvInput | null,
    readError = "",
  ) {
    let parsed: ParsedCsv | null = null;
    let inputError = readError;
    if (input && !readError) {
      try {
        parsed = parseCsv(input.csv, input.delimiter);
      } catch (problem) {
        inputError =
          problem instanceof Error
            ? problem.message
            : "This CSV could not be read.";
      }
    }
    (side === "before" ? setBefore : setAfter)({
      input,
      parsed,
      error: inputError,
    });
  }
  async function createComparison(useExample = false) {
    if (!ready) return;
    setBusy(useExample ? "Loading example…" : "Comparing & saving…");
    setError("");
    setNotice("");
    try {
      const payload = useExample
        ? example
        : {
            name: `${before.input!.filename} → ${after.input!.filename}`.slice(
              0,
              120,
            ),
            before: before.input,
            after: after.input,
            key,
          };
      const report = await api<Report>("/api/comparisons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (useExample) {
        updateDraft("before", example.before);
        updateDraft("after", example.after);
        setKey(example.key);
      }
      selectReport(report);
      setReports((current) => [report, ...current].slice(0, 100));
      setNotice("Comparison saved. It will be here when you refresh.");
      requestAnimationFrame(() =>
        resultsRef.current?.scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
            .matches
            ? "instant"
            : "smooth",
          block: "start",
        }),
      );
    } catch (problem) {
      setError(
        problem instanceof Error
          ? problem.message
          : "This comparison could not be saved.",
      );
    } finally {
      setBusy("");
    }
  }
  async function openReport(id: string) {
    setBusy("Opening report…");
    setError("");
    setNotice("");
    try {
      selectReport(await api<Report>(`/api/comparisons/${id}`));
    } catch (problem) {
      setError(
        problem instanceof Error
          ? problem.message
          : "Report could not be opened.",
      );
    } finally {
      setBusy("");
    }
  }
  async function saveDetails() {
    if (!selected) return;
    setBusy("Saving details…");
    setError("");
    setNotice("");
    try {
      const report = await api<Report>(`/api/comparisons/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName, notes }),
      });
      selectReport(report);
      setReports((current) =>
        current.map((item) => (item.id === report.id ? report : item)),
      );
      setNotice("Report details saved.");
    } catch (problem) {
      setError(
        problem instanceof Error
          ? problem.message
          : "Changes could not be saved.",
      );
    } finally {
      setBusy("");
    }
  }
  async function removeReport() {
    if (!selected) return;
    setBusy("Deleting report…");
    setError("");
    setNotice("");
    try {
      await api(`/api/comparisons/${selected.id}`, { method: "DELETE" });
      setReports((current) =>
        current.filter((report) => report.id !== selected.id),
      );
      selectReport(null);
      setNotice("Report deleted.");
    } catch (problem) {
      setError(
        problem instanceof Error
          ? problem.message
          : "Report could not be deleted.",
      );
    } finally {
      setBusy("");
    }
  }
  const rows: Change[] =
    selected?.result.changes.filter(
      (change) =>
        (filter === "all" || change.type === filter) &&
        [change.key, change.field, change.before, change.after].some((value) =>
          value?.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
        ),
    ) ?? [];
  const pages = Math.max(1, Math.ceil(rows.length / 30));
  const isBusy = !!busy || loading;

  return (
    <>
      <header className="site-header">
        <a className="brand" href="/" aria-label="LedgerDiff home">
          Ledger<span>Diff</span>
          <small>02</small>
        </a>
        <div className="header-right">
          <span className="workspace-dot" />
          Your comparison workspace
        </div>
      </header>
      <main>
        <section className="hero">
          <div>
            <p className="eyebrow">A CLEAR RECORD OF WHAT CHANGED</p>
            <h1>
              Two exports.
              <br />
              Every change, <em>accounted for.</em>
            </h1>
            <p className="intro">
              From last week's ledger to today's update. Match by a unique ID,
              find the difference, and keep the record.
            </p>
          </div>
          <aside className="hero-note">
            <span className="note-mark">↗</span>
            <p>
              Start with something
              <br />
              <strong>you can see.</strong>
            </p>
            <button
              className="text-button example-button"
              disabled={!ready || isBusy}
              onClick={() => void createComparison(true)}
            >
              Try a sample comparison <span aria-hidden="true">→</span>
            </button>
            <small>Four fictional orders. Every kind of change.</small>
          </aside>
        </section>
        {error && (
          <div className="alert" role="alert">
            <strong>Let's get this sorted.</strong>
            <p>{error}</p>
            {!ready && (
              <button
                className="button compact"
                onClick={() => void initialize()}
                disabled={loading}
              >
                Retry connection
              </button>
            )}
          </div>
        )}
        <section aria-label="New comparison" className="comparison-form">
          <div className="files">
            <FilePanel
              side="Before"
              number="01"
              draft={before}
              onChange={(input, problem) =>
                updateDraft("before", input, problem)
              }
              disabled={isBusy}
            />
            <FilePanel
              side="After"
              number="02"
              draft={after}
              onChange={(input, problem) =>
                updateDraft("after", input, problem)
              }
              disabled={isBusy}
            />
          </div>
          <div className="compare-bar">
            <label className="key-field" htmlFor="match-key">
              Match records using
              <select
                id="match-key"
                value={key}
                disabled={!commonKeys.length || isBusy}
                onChange={(event) => setKey(event.target.value)}
              >
                {commonKeys.length ? (
                  commonKeys.map((field) => (
                    <option key={field}>{field}</option>
                  ))
                ) : (
                  <option value="">
                    {before.parsed && after.parsed
                      ? "No shared column found"
                      : "Choose both files first"}
                  </option>
                )}
              </select>
            </label>
            <p>
              {before.parsed && after.parsed && !commonKeys.length
                ? "These exports need a shared column to match records."
                : "Use a unique order, invoice or product ID."}
              <br />
              <span>
                Values stay exactly as they are, including leading zeros.
              </span>
            </p>
            <button
              className="button primary compare-button"
              disabled={
                !key || !before.parsed || !after.parsed || !ready || isBusy
              }
              onClick={() => void createComparison()}
            >
              {busy === "Comparing & saving…" ? busy : "Compare & save"}{" "}
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </section>
        <div className="workspace-grid">
          <aside className="history" aria-label="Saved reports">
            <div className="section-heading">
              <h2>Saved reports</h2>
              <span>{reports.length}</span>
            </div>
            <p className="section-help">A record to return to.</p>
            {loading ? (
              <p className="muted" role="status">
                Opening your workspace…
              </p>
            ) : !reports.length ? (
              <div className="history-empty">
                <span aria-hidden="true">≡</span>
                <p>
                  Your first report
                  <br />
                  will live here.
                </p>
              </div>
            ) : (
              <ul>
                {reports.map((report) => (
                  <li key={report.id}>
                    <button
                      className={`history-item ${selected?.id === report.id ? "active" : ""}`}
                      disabled={isBusy}
                      onClick={() => void openReport(report.id)}
                    >
                      <strong>{report.name}</strong>
                      <span>
                        {date(report.createdAt)} · {report.stats.changed}{" "}
                        changed · {report.stats.added} added
                      </span>
                      <span className="history-arrow" aria-hidden="true">
                        ↗
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="history-foot">
              Reports belong to this browser's workspace. Keep its cookies to
              return to them.
            </p>
          </aside>
          <section
            className="report-area"
            ref={resultsRef}
            aria-label="Comparison report"
            aria-busy={isBusy}
          >
            <div className="operation-status" role="status" aria-live="polite">
              {busy || notice}
            </div>
            {!selected ? (
              <div className="report-placeholder">
                <div className="paper-stack" aria-hidden="true">
                  <span>01</span>
                  <span>02</span>
                  <i>↔</i>
                </div>
                <p className="eyebrow">THE DIFFERENCE WILL BE CLEAR</p>
                <h2>Nothing to reconcile. Yet.</h2>
                <p>
                  Choose two CSV snapshots above, or try the sample.
                  <br />
                  Your report will separate the changes from everything that
                  stayed the same.
                </p>
                <button
                  className="button"
                  disabled={!ready || isBusy}
                  onClick={() => void createComparison(true)}
                >
                  Explore the example <span aria-hidden="true">↗</span>
                </button>
              </div>
            ) : (
              <>
                <div className="report-title">
                  <div>
                    <p className="eyebrow">
                      SAVED {date(selected.createdAt)} / DIFFERENCE REPORT
                    </p>
                    <h2>{selected.name}</h2>
                    <p className="source-line">
                      {selected.beforeFilename} <span>→</span>{" "}
                      {selected.afterFilename}
                    </p>
                  </div>
                  <a
                    className="button compact export-link"
                    href={`/api/comparisons/${selected.id}/export/csv`}
                  >
                    Download CSV <span aria-hidden="true">↓</span>
                  </a>
                </div>
                <div className="stats">
                  {(
                    ["added", "removed", "changed", "unchanged"] as ChangeType[]
                  ).map((type) => (
                    <button
                      key={type}
                      className={`stat ${type} ${filter === type ? "selected" : ""}`}
                      onClick={() => {
                        setFilter(filter === type ? "all" : type);
                        setPage(0);
                      }}
                      aria-pressed={filter === type}
                    >
                      <span className="stat-label">
                        <i />
                        {statusLabels[type]}
                      </span>
                      <strong>
                        {selected.stats[type].toLocaleString().padStart(2, "0")}
                      </strong>
                      <span>records</span>
                    </button>
                  ))}
                </div>
                <div className="report-caption">
                  <span>
                    {selected.result.beforeRows.toLocaleString()} before ·{" "}
                    {selected.result.afterRows.toLocaleString()} after · matched
                    on <b>{selected.key}</b>
                  </span>
                  <a href={`/api/comparisons/${selected.id}/export/json`}>
                    Exact JSON ↗
                  </a>
                </div>
                {(selected.result.addedColumns.length > 0 ||
                  selected.result.removedColumns.length > 0) && (
                  <p className="schema-note">
                    {selected.result.addedColumns.length > 0 &&
                      `Added columns: ${selected.result.addedColumns.join(", ")}. `}
                    {selected.result.removedColumns.length > 0 &&
                      `Removed columns: ${selected.result.removedColumns.join(", ")}.`}{" "}
                    Missing columns are different from empty cells.
                  </p>
                )}
                <div className="report-toolbar">
                  <label>
                    <span className="sr-only">Search report</span>
                    <input
                      type="search"
                      placeholder="Search IDs, fields or values…"
                      value={search}
                      onChange={(event) => {
                        setSearch(event.target.value);
                        setPage(0);
                      }}
                    />
                  </label>
                  <label>
                    <span className="sr-only">Filter changes</span>
                    <select
                      value={filter}
                      onChange={(event) => {
                        setFilter(event.target.value);
                        setPage(0);
                      }}
                    >
                      <option value="all">All records</option>
                      {Object.entries(statusLabels).map(([type, label]) => (
                        <option key={type} value={type}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="table-shell">
                  <table>
                    <caption className="sr-only">
                      Changes between {selected.beforeFilename} and{" "}
                      {selected.afterFilename}
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Change</th>
                        <th scope="col">Record ID</th>
                        <th scope="col">Field</th>
                        <th scope="col">Before</th>
                        <th scope="col">After</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows
                        .slice(page * 30, (page + 1) * 30)
                        .map((change, i) => (
                          <tr key={`${change.key}-${change.field}-${i}`}>
                            <td>
                              <span className={`badge ${change.type}`}>
                                {statusLabels[change.type]}
                              </span>
                            </td>
                            <th scope="row">{change.key}</th>
                            <td>
                              {change.field || (
                                <span className="muted">Whole record</span>
                              )}
                            </td>
                            <td>
                              <Value value={change.before} />
                            </td>
                            <td>
                              <Value value={change.after} />
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                  {!rows.length && (
                    <div className="table-empty">
                      No entries match these filters.
                      <button
                        className="text-button"
                        onClick={() => {
                          setFilter("all");
                          setSearch("");
                          setPage(0);
                        }}
                      >
                        Clear filters
                      </button>
                    </div>
                  )}
                </div>
                <div className="pagination">
                  <span>
                    {rows.length.toLocaleString()} entries · page {page + 1} of{" "}
                    {pages}
                  </span>
                  <div>
                    <button
                      className="button compact"
                      aria-label="Previous report page"
                      disabled={page === 0}
                      onClick={() => setPage((value) => value - 1)}
                    >
                      ←
                    </button>
                    <button
                      className="button compact"
                      aria-label="Next report page"
                      disabled={page >= pages - 1}
                      onClick={() => setPage((value) => value + 1)}
                    >
                      →
                    </button>
                  </div>
                </div>
                <p className="export-note">
                  Downloads contain the full report. CSV protects formula-like
                  values and includes missing-value flags; JSON preserves exact
                  strings and nulls.
                </p>
                <details className="report-details">
                  <summary>Report name & notes</summary>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void saveDetails();
                    }}
                  >
                    <label>
                      Report name
                      <input
                        value={editName}
                        maxLength={120}
                        required
                        onChange={(event) => setEditName(event.target.value)}
                        disabled={isBusy}
                      />
                    </label>
                    <label>
                      Notes
                      <textarea
                        rows={3}
                        value={notes}
                        maxLength={2000}
                        placeholder="What should you remember about this comparison?"
                        onChange={(event) => setNotes(event.target.value)}
                        disabled={isBusy}
                      />
                    </label>
                    <div className="detail-actions">
                      <button
                        className="button primary compact"
                        disabled={isBusy || !editName.trim()}
                      >
                        Save details
                      </button>
                      <button
                        type="button"
                        className="text-button danger"
                        disabled={isBusy}
                        onClick={() => setDeletePending(true)}
                      >
                        Delete report
                      </button>
                    </div>
                  </form>
                  {deletePending && (
                    <div className="delete-prompt" role="alert">
                      <p>Delete this saved report? This cannot be undone.</p>
                      <button
                        className="button compact"
                        disabled={isBusy}
                        onClick={() => setDeletePending(false)}
                      >
                        Keep report
                      </button>
                      <button
                        className="button danger-button compact"
                        disabled={isBusy}
                        onClick={() => void removeReport()}
                      >
                        Yes, delete report
                      </button>
                    </div>
                  )}
                </details>
              </>
            )}
          </section>
        </div>
        <details className="how-it-works">
          <summary>A few things worth knowing</summary>
          <div>
            <p>
              <strong>Exact comparisons, by a single key.</strong> Row and
              column order do not matter. A changed record can create several
              field entries. Empty strings, missing columns, spaces and leading
              zeros stay distinct.
            </p>
            <p>
              <strong>A clear boundary.</strong> UTF-8 CSV or TSV only; 8 MB,
              50,000 records and 100 columns per file. Reports stop at 100,000
              entries. Duplicate keys, empty keys, repeated headers and uneven
              rows must be fixed before comparing.
            </p>
            <p>
              <strong>Saved for this workspace.</strong> Report values are saved
              on the server, scoped to this browser's session. Original CSV
              files are not retained separately. Sessions expire after 30 days;
              expired workspaces and their reports are removed. This is a local
              demonstration with fictional example data. Review every report
              before changing source records.
            </p>
          </div>
        </details>
        <footer>
          <span>
            LedgerDiff <b>·</b> A small tool for careful work.
          </span>
          <span>Compare. Review. Keep the record.</span>
        </footer>
      </main>
    </>
  );
}

import Papa from "papaparse";
import type { Change, ComparisonResult, ParsedCsv } from "./types";

export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_ROWS = 50_000;
export const MAX_COLUMNS = 100;
export const MAX_REPORT_ENTRIES = 100_000;

export class InputError extends Error {}

export function parseCsv(csv: string, delimiter = ""): ParsedCsv {
  if (new TextEncoder().encode(csv).byteLength > MAX_FILE_BYTES) {
    throw new InputError(
      "Each CSV must be 8 MB or smaller. Split this export and try again.",
    );
  }
  if (!csv.length)
    throw new InputError(
      "This CSV is empty. Choose an export with a header row.",
    );
  if (csv.includes("\0"))
    throw new InputError(
      "NUL characters are not supported. Export the file as UTF-8 CSV.",
    );
  if (!["", ",", ";", "\t"].includes(delimiter))
    throw new InputError(
      "Choose comma, semicolon, tab or automatic separator.",
    );
  const parsed = Papa.parse<string[]>(csv.replace(/^\uFEFF/, ""), {
    delimiter,
    delimitersToGuess: [",", ";", "\t"],
    header: false,
    dynamicTyping: false,
    skipEmptyLines: true,
  });
  const problem = parsed.errors.find(
    (error) => error.code !== "UndetectableDelimiter",
  );
  if (problem)
    throw new InputError(`CSV could not be read: ${problem.message}`);
  const [headers, ...rows] = parsed.data;
  if (!headers || headers.some((header) => !header.trim()))
    throw new InputError("Every column needs a non-empty header.");
  if (new Set(headers).size !== headers.length)
    throw new InputError(
      "Duplicate column headers: give every column a unique name.",
    );
  if (headers.length > MAX_COLUMNS)
    throw new InputError(
      `Use no more than ${MAX_COLUMNS} columns in each file.`,
    );
  if (rows.length > MAX_ROWS)
    throw new InputError(
      `Use no more than ${MAX_ROWS.toLocaleString()} records in each file.`,
    );
  rows.forEach((row, index) => {
    if (row.length !== headers.length)
      throw new InputError(
        `Record ${index + 2} has ${row.length} fields; expected ${headers.length}. Check the separator and missing cells.`,
      );
  });
  return { headers, rows, delimiter: parsed.meta.delimiter };
}

export function compareCsv(
  before: ParsedCsv,
  after: ParsedCsv,
  key: string,
): ComparisonResult {
  if (!key || !before.headers.includes(key) || !after.headers.includes(key)) {
    throw new InputError("Choose a key column that exists in both files.");
  }
  const index = (data: ParsedCsv, side: string) => {
    const map = new Map<string, Map<string, string>>();
    const keyIndex = data.headers.indexOf(key);
    data.rows.forEach((row, i) => {
      const id = row[keyIndex];
      if (!id.trim())
        throw new InputError(
          `${side}: empty key at record ${i + 2}. Each record needs a unique ID.`,
        );
      if (map.has(id))
        throw new InputError(
          `${side}: duplicate key “${id}”. Choose a unique key or fix the duplicate.`,
        );
      map.set(id, new Map(data.headers.map((header, j) => [header, row[j]])));
    });
    return map;
  };
  const left = index(before, "Before");
  const right = index(after, "After");
  const fields = [...new Set([...before.headers, ...after.headers])].filter(
    (field) => field !== key,
  );
  const changes: Change[] = [];
  const stats = { added: 0, removed: 0, changed: 0, unchanged: 0 };
  const add = (change: Change) => {
    if (changes.length >= MAX_REPORT_ENTRIES)
      throw new InputError(
        "This comparison has too many report entries. Split it into smaller exports.",
      );
    changes.push(change);
  };
  for (const [id, oldRow] of left) {
    const newRow = right.get(id);
    if (!newRow) {
      stats.removed++;
      add({
        type: "removed",
        key: id,
        field: "",
        before: JSON.stringify(Object.fromEntries(oldRow)),
        after: null,
      });
      continue;
    }
    let changed = false;
    for (const field of fields) {
      const a = oldRow.get(field) ?? null;
      const b = newRow.get(field) ?? null;
      if (a !== b) {
        changed = true;
        add({ type: "changed", key: id, field, before: a, after: b });
      }
    }
    stats[changed ? "changed" : "unchanged"]++;
    if (!changed)
      add({
        type: "unchanged",
        key: id,
        field: "",
        before: JSON.stringify(Object.fromEntries(oldRow)),
        after: JSON.stringify(Object.fromEntries(newRow)),
      });
  }
  for (const [id, row] of right) {
    if (!left.has(id)) {
      stats.added++;
      add({
        type: "added",
        key: id,
        field: "",
        before: null,
        after: JSON.stringify(Object.fromEntries(row)),
      });
    }
  }
  return {
    key,
    stats,
    changes,
    beforeRows: before.rows.length,
    afterRows: after.rows.length,
    addedColumns: after.headers.filter(
      (field) => !before.headers.includes(field),
    ),
    removedColumns: before.headers.filter(
      (field) => !after.headers.includes(field),
    ),
  };
}

export function reportCsv(changes: Change[]): string {
  return Papa.unparse(
    {
      fields: [
        "change",
        "record_id",
        "field",
        "before",
        "after",
        "before_missing",
        "after_missing",
      ],
      data: changes.map((change) => [
        change.type,
        change.key,
        change.field,
        change.before ?? "",
        change.after ?? "",
        String(change.before === null),
        String(change.after === null),
      ]),
    },
    { escapeFormulae: true, newline: "\r\n" },
  );
}

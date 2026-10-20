import { test } from "node:test";
import assert from "node:assert/strict";
import Papa from "papaparse";
import {
  compareCsv,
  MAX_FILE_BYTES,
  parseCsv,
  reportCsv,
} from "../shared/comparison";
import { example } from "../shared/example";

test("example counts records and field-level entries, independent of row order", () => {
  const result = compareCsv(
    parseCsv(example.before.csv),
    parseCsv(example.after.csv),
    example.key,
  );
  assert.deepEqual(result.stats, {
    added: 1,
    removed: 1,
    changed: 2,
    unchanged: 1,
  });
  assert.equal(result.changes.length, 5);
  assert.equal(
    result.changes.find((change) => change.key === "ORD-003")?.after,
    "225.00",
  );
});

test("PapaParse handles quoted separators, escaped quotes, CRLF and quoted newlines", () => {
  const parsed = parseCsv(
    'id,note\r\n001,"A, B and ""C""\r\nline two"\r\n002,plain\r\n',
  );
  assert.deepEqual(parsed.rows, [
    ["001", 'A, B and "C"\r\nline two'],
    ["002", "plain"],
  ]);
  assert.deepEqual(parseCsv("id;value\n0001;01", ";").rows, [["0001", "01"]]);
  assert.deepEqual(parseCsv("id\tvalue\n0001\t01").rows, [["0001", "01"]]);
});

test("leading zeros, large identifiers, whitespace and empty/missing fields remain distinct", () => {
  const result = compareCsv(
    parseCsv("id,value,removed\n001,,\n90071992547409930001, 1 ,x"),
    parseCsv("id,value,added\n001,,\n90071992547409930001,1,"),
    "id",
  );
  assert.equal(result.stats.changed, 2);
  assert.ok(
    result.changes.some(
      (change) =>
        change.key === "001" &&
        change.field === "removed" &&
        change.before === "" &&
        change.after === null,
    ),
  );
  assert.ok(
    result.changes.some(
      (change) =>
        change.field === "added" &&
        change.before === null &&
        change.after === "",
    ),
  );
  assert.ok(
    result.changes.some(
      (change) =>
        change.key === "90071992547409930001" &&
        change.before === " 1 " &&
        change.after === "1",
    ),
  );
});

test("uneven rows, duplicate/empty headers, invalid quoting and oversized files are rejected", () => {
  assert.throws(() => parseCsv("id,v\n1"), /expected 2/);
  assert.throws(() => parseCsv("id,v\n1,a,b"), /expected 2/);
  assert.throws(() => parseCsv("id,id\n1,2"), /Duplicate column/);
  assert.throws(() => parseCsv("id,\n1,2"), /non-empty header/);
  assert.throws(
    () => parseCsv('id,v\n1,"never closed'),
    /CSV could not be read/,
  );
  assert.throws(() => parseCsv("x".repeat(MAX_FILE_BYTES + 1)), /8 MB/);
  assert.throws(() => parseCsv("id,v\n1,\0"), /NUL/);
});

test("duplicate keys and empty keys stop comparison; composite or absent keys are not guessed", () => {
  const after = parseCsv("id,v\n1,a");
  assert.throws(
    () => compareCsv(parseCsv("id,v\n1,a\n1,b"), after, "id"),
    /duplicate key/,
  );
  assert.throws(
    () => compareCsv(parseCsv("id,v\n,a"), after, "id"),
    /empty key/,
  );
  assert.throws(() => compareCsv(after, after, "missing"), /exists in both/);
});

test("exact 8 MiB boundary is accepted while one extra byte is rejected", () => {
  const prefix = "id,note\n001,";
  const csv =
    prefix +
    "x".repeat(MAX_FILE_BYTES - new TextEncoder().encode(prefix).byteLength);
  assert.equal(parseCsv(csv, ",").rows[0][0], "001");
  assert.throws(() => parseCsv(csv + "x", ","), /8 MB/);
});

test("empty datasets and column reordering yield correct unchanged counts", () => {
  assert.deepEqual(compareCsv(parseCsv("id,v"), parseCsv("id,v"), "id").stats, {
    added: 0,
    removed: 0,
    changed: 0,
    unchanged: 0,
  });
  assert.equal(
    compareCsv(parseCsv("id,v\n001,2"), parseCsv("v,id\n2,001"), "id").stats
      .unchanged,
    1,
  );
});

test("CSV export prevents formulas and roundtrips empty and missing flags", () => {
  const csv = reportCsv([
    { type: "changed", key: "=1+1", field: "note", before: null, after: "" },
  ]);
  const parsed = Papa.parse<Record<string, string>>(csv, { header: true })
    .data[0];
  assert.equal(parsed.record_id, "'=1+1");
  assert.equal(parsed.before_missing, "true");
  assert.equal(parsed.after_missing, "false");
  assert.equal(parsed.after, "");
});

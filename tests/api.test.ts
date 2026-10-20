import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import { createPool, migrate } from "../server/db";
import { createApp } from "../server/app";
import { example } from "../shared/example";
import type { Report } from "../shared/types";
import { MAX_FILE_BYTES } from "../shared/comparison";

test("real HTTP + PostgreSQL: create/read/update/export/isolation/delete and app restart", async () => {
  assert.ok(
    process.env.DATABASE_URL,
    "DATABASE_URL is required: this test never substitutes an in-memory database.",
  );
  const pool = createPool(process.env.DATABASE_URL);
  await migrate(pool);
  const secret = randomBytes(32).toString("hex");
  const { app, store } = createApp({
    pool,
    secret,
    webOrigin: "http://localhost:5174",
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  let base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let cookie = "";
  const request = (path: string, options: RequestInit = {}, session = cookie) =>
    fetch(`${base}${path}`, {
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(session ? { Cookie: session } : {}),
        ...options.headers,
      },
    });
  let id: string | undefined;
  let edgeId: string | undefined;
  try {
    const health = await request("/api/health");
    assert.equal((await health.json()).database, "connected");
    const session = await request("/api/session");
    assert.equal(session.status, 200);
    cookie = session.headers.get("set-cookie")!.split(";")[0];
    assert.match(session.headers.get("set-cookie")!, /HttpOnly/i);
    assert.match(session.headers.get("set-cookie")!, /SameSite=Strict/i);
    const created = await request("/api/comparisons", {
      method: "POST",
      body: JSON.stringify(example),
    });
    assert.equal(created.status, 201, await created.clone().text());
    const report = (await created.json()) as Report;
    id = report.id;
    assert.deepEqual(report.stats, {
      added: 1,
      removed: 1,
      changed: 2,
      unchanged: 1,
    });
    const persisted = await pool.query(
      "SELECT result FROM ledgerdiff_reports WHERE id=$1",
      [id],
    );
    assert.equal(persisted.rows[0].result.stats.changed, 2);
    const list = await request("/api/comparisons");
    assert.equal(
      (await list.json()).reports.some((item: Report) => item.id === id),
      true,
    );
    const updated = await request(`/api/comparisons/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: "Month-end review",
        notes: "Fictional orders, reviewed.",
      }),
    });
    assert.equal(updated.status, 200);
    assert.equal((await updated.json()).name, "Month-end review");
    const edgeCreated = await request("/api/comparisons", {
      method: "POST",
      body: JSON.stringify({
        name: "Exact values",
        key: "id",
        before: {
          filename: "before.csv",
          csv: 'id,note,removed\n0001,"A, B\n""quoted""",\n90071992547409930001,unchanged,z',
        },
        after: {
          filename: "after.csv",
          csv: 'id,note,added\n0001,"A, B\n""quoted""",\n90071992547409930001,unchanged,',
        },
      }),
    });
    assert.equal(edgeCreated.status, 201);
    const exactReport = (await edgeCreated.json()) as Report;
    edgeId = exactReport.id;
    const exactSaved = await pool.query(
      "SELECT result FROM ledgerdiff_reports WHERE id=$1",
      [edgeId],
    );
    assert.ok(
      exactSaved.rows[0].result.changes.some(
        (change: {
          key: string;
          field: string;
          before: string | null;
          after: string | null;
        }) =>
          change.key === "0001" &&
          change.field === "removed" &&
          change.before === "" &&
          change.after === null,
      ),
    );
    assert.ok(
      exactSaved.rows[0].result.changes.some(
        (change: { key: string }) => change.key === "90071992547409930001",
      ),
    );
    const json = await request(`/api/comparisons/${id}/export/json`);
    assert.match(json.headers.get("content-disposition")!, /attachment/);
    assert.equal((await json.json()).notes, "Fictional orders, reviewed.");
    const csv = await request(`/api/comparisons/${id}/export/csv`);
    assert.match(await csv.text(), /before_missing,after_missing/);
    const invalid = await request("/api/comparisons", {
      method: "POST",
      body: JSON.stringify({
        ...example,
        before: { ...example.before, csv: "order_id,n\n001,a\n001,b" },
      }),
    });
    assert.equal(invalid.status, 400);
    assert.match((await invalid.json()).error, /duplicate key/);
    const uneven = await request("/api/comparisons", {
      method: "POST",
      body: JSON.stringify({
        ...example,
        before: { ...example.before, csv: "order_id,n\n001" },
      }),
    });
    assert.equal(uneven.status, 400);
    const oversized = await request("/api/comparisons", {
      method: "POST",
      body: JSON.stringify({
        ...example,
        before: { ...example.before, csv: "x".repeat(MAX_FILE_BYTES + 1) },
      }),
    });
    assert.equal(oversized.status, 400);
    assert.match((await oversized.json()).error, /8 MB/);
    const otherSession = await request("/api/session", {}, "");
    const otherCookie = otherSession.headers.get("set-cookie")!.split(";")[0];
    assert.deepEqual(
      (await (await request("/api/comparisons", {}, otherCookie)).json())
        .reports,
      [],
    );
    for (const method of ["GET", "PATCH", "DELETE"]) {
      const result = await request(
        `/api/comparisons/${id}`,
        {
          method,
          ...(method === "PATCH"
            ? { body: JSON.stringify({ name: "Not mine" }) }
            : {}),
        },
        otherCookie,
      );
      assert.equal(result.status, 404);
    }
    const isolatedExport = await request(
      `/api/comparisons/${id}/export/json`,
      {},
      otherCookie,
    );
    assert.equal(isolatedExport.status, 404);
    const noSession = await request("/api/comparisons", {}, "");
    assert.equal(noSession.status, 401);
    const badOrigin = await request("/api/comparisons", {
      method: "POST",
      body: JSON.stringify(example),
      headers: { Origin: "http://other.invalid" },
    });
    assert.equal(badOrigin.status, 403);
    const badUuid = await request("/api/comparisons/not-a-uuid");
    assert.equal(badUuid.status, 404);
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    store.close();
    const restarted = createApp({
      pool,
      secret,
      webOrigin: "http://localhost:5174",
    });
    const secondServer = restarted.app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) =>
      secondServer.once("listening", resolve),
    );
    base = `http://127.0.0.1:${(secondServer.address() as AddressInfo).port}`;
    try {
      const restored = await request(`/api/comparisons/${id}`);
      assert.equal(restored.status, 200);
      assert.equal((await restored.json()).name, "Month-end review");
      assert.equal(
        (await request(`/api/comparisons/${id}`, { method: "DELETE" })).status,
        204,
      );
      assert.equal((await request(`/api/comparisons/${id}`)).status, 404);
      assert.equal(
        (
          await pool.query("SELECT id FROM ledgerdiff_reports WHERE id=$1", [
            id,
          ])
        ).rows.length,
        0,
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        secondServer.close((error) => (error ? reject(error) : resolve())),
      );
      restarted.store.close();
    }
  } finally {
    if (id)
      await pool.query("DELETE FROM ledgerdiff_reports WHERE id=$1", [id]);
    if (edgeId)
      await pool.query("DELETE FROM ledgerdiff_reports WHERE id=$1", [edgeId]);
    if (server.listening)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    store.close();
    await pool.end();
  }
});

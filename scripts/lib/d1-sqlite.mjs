// A D1 database for tests: Node's built-in SQLite behind the part of the D1 API the functions use (prepare / bind / first /
// all / run / batch), with the real files of migrations/ applied. batch() is one transaction that rolls back whole when a
// statement fails, as in D1. No Cloudflare, no network: the tests call the endpoint handlers directly.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export function openD1(migrationsDir) {
  const raw = new DatabaseSync(":memory:");
  for (const f of fs.readdirSync(migrationsDir).filter((n) => n.endsWith(".sql")).sort()) raw.exec(fs.readFileSync(path.join(migrationsDir, f), "utf8"));
  const exec = (sql, binds) => {
    for (const b of binds) if (b === undefined) throw new Error("D1_TYPE_ERROR: undefined is not a bindable value");
    return { success: true, results: raw.prepare(sql).all(...binds).map((r) => ({ ...r })), meta: {} };
  };
  // every call is a round trip in D1: yield to the event loop first, so two requests running "at once" in a test really
  // interleave between their reads and their batches (a batch itself stays atomic)
  const trip = () => new Promise((resolve) => setImmediate(resolve));
  const statement = (sql, binds = []) => ({
    bind: (...b) => statement(sql, b),
    first: async (column) => { await trip(); const row = exec(sql, binds).results[0] ?? null; return row && column ? row[column] : row; },
    all: async () => { await trip(); return exec(sql, binds); },
    run: async () => { await trip(); return exec(sql, binds); },
    execNow: () => exec(sql, binds),
  });
  let held = null; // while an array: batches wait here until release() (see atOnce in scripts/test-wallet.mjs)
  return {
    raw,
    prepare: (sql) => statement(sql),
    /** From now on every batch waits for release(): a test lines several requests up at their writes, all reads done. */
    hold() { held = []; },
    waiting: () => (held ? held.length : 0),
    /** Lets the waiting batches through, in the order they arrived (each still atomic). `last`: stop holding. */
    release(last = false) { const go = held || []; held = last ? null : []; for (const resume of go) resume(); },
    async batch(statements) {
      await trip();
      if (held) await new Promise((resume) => held.push(resume));
      raw.exec("BEGIN IMMEDIATE");
      try {
        const out = statements.map((s) => s.execNow());
        raw.exec("COMMIT");
        return out;
      } catch (e) {
        raw.exec("ROLLBACK");
        throw e;
      }
    },
  };
}

import fs from "node:fs";
import path from "node:path";

try {
  process.loadEnvFile(path.resolve(".env.local"));
} catch {
  // .env.local is optional; production env vars may already be set.
}

import { execute, initDb, getSecurities, getActionHistory, syncActionHistory } from "../lib/db.ts";
import { runWithMetrics, type CallRecord } from "../lib/instrumented-fetch.ts";
import { BENCH_USER, seedBenchUser } from "./seed.ts";

const REPEATS = 8;

function parseArgs() {
  const argv = process.argv.slice(2);
  const sectionArg = argv.find((a) => a.startsWith("--section="))?.split("=")[1];
  return { section: sectionArg || "Baseline (before optimization)" };
}

function normalize(sql: string) {
  return sql.replace(/\s+/g, " ").trim();
}

async function rankSlowestQueries(): Promise<Map<string, { sql: string; params: unknown[]; calls: CallRecord[] }>> {
  const { metrics } = await runWithMetrics(async () => {
    const securities = await getSecurities(BENCH_USER);
    await getActionHistory(BENCH_USER);
    await syncActionHistory(BENCH_USER, securities);
  });
  const bySql = new Map<string, { sql: string; params: unknown[]; calls: CallRecord[] }>();
  for (const call of metrics.calls) {
    if (call.provider !== "turso-db" || !call.sql) continue;
    const key = normalize(call.sql);
    const bucket = bySql.get(key) || { sql: call.sql, params: call.params || [], calls: [] };
    bucket.calls.push(call);
    bySql.set(key, bucket);
  }
  return bySql;
}

function totalMs(calls: CallRecord[]) {
  return calls.reduce((sum, c) => sum + (c.serverMs ?? c.ms), 0);
}

async function explainAndTime(sql: string, params: unknown[]) {
  const { rows: planRows } = await execute(`EXPLAIN QUERY PLAN ${sql}`, params);
  const steps = planRows.map((row) => String(row.detail ?? row["detail"] ?? JSON.stringify(row)));
  const plan = steps.join(" | ");
  // A genuine full-table scan is a step reading "SCAN <table>" with nothing after it (no "USING INDEX"/
  // "USING INTEGER PRIMARY KEY"). "SCAN <table> USING INDEX ..." is a covering-index scan, not this.
  const fullTableScans = steps.filter((step) => /^SCAN \S+$/i.test(step.trim()));
  const usesScan = fullTableScans.length > 0;

  const serverTimings: number[] = [];
  for (let i = 0; i < REPEATS; i++) {
    const result = await execute(sql, params);
    if (typeof (result as any).serverMs === "number") serverTimings.push((result as any).serverMs);
  }
  const avgServerMs = serverTimings.length
    ? serverTimings.reduce((sum, v) => sum + v, 0) / serverTimings.length
    : null;

  return { plan, usesScan, fullTableScans, avgServerMs, repeats: serverTimings.length };
}

async function main() {
  const { section } = parseArgs();
  await initDb();
  await seedBenchUser(20);

  const bySql = await rankSlowestQueries();
  const ranked = [...bySql.values()].sort((a, b) => totalMs(b.calls) - totalMs(a.calls)).slice(0, 3);

  const sections: string[] = [];
  let rank = 1;
  for (const bucket of ranked) {
    const { plan, usesScan, fullTableScans, avgServerMs, repeats } = await explainAndTime(bucket.sql, bucket.params);
    const avgWallMs = bucket.calls.reduce((sum, c) => sum + c.ms, 0) / bucket.calls.length;
    const avgRowsRead = bucket.calls.some((c) => c.rowsRead !== undefined)
      ? bucket.calls.reduce((sum, c) => sum + (c.rowsRead || 0), 0) / bucket.calls.length
      : null;

    sections.push(
      [
        `### #${rank} — \`${bucket.sql.split("\n")[0].trim()}...\``,
        "",
        "```sql",
        bucket.sql.trim(),
        "```",
        "",
        `- Query plan (\`EXPLAIN QUERY PLAN\`): ${plan || "(no rows returned)"}`,
        `- Full table scan (no index used for that table): **${usesScan ? `YES — ${fullTableScans.join(", ")}` : "no"}**`,
        `- Avg server-side execution time (Turso \`query_duration_ms\`, ${repeats} repeats): ${avgServerMs === null ? "NOT MEASURED" : `${avgServerMs.toFixed(3)} ms`}`,
        `- Avg wall-clock time (includes HTTP round trip, from the live load above): ${avgWallMs.toFixed(2)} ms`,
        avgRowsRead === null ? "" : `- Avg rows read per call: ${avgRowsRead.toFixed(0)}`,
      ]
        .filter(Boolean)
        .join("\n"),
    );
    rank += 1;
  }

  const body = sections.join("\n\n");
  console.log(body);

  const entry = `\n## ${section} — DB query analysis\n\n_${new Date().toISOString()} — \`npm run db-bench -- --section="${section}"\`_\n\nTop ${ranked.length} slowest queries by total time during a full \`getSecurities\` + \`getActionHistory\` + \`syncActionHistory\` load, ranked by instrumenting \`lib/db.ts\`'s \`execute()\` (see \`lib/instrumented-fetch.ts\`).\n\n${body}\n`;
  fs.appendFileSync(path.resolve("BENCHMARKS.md"), entry);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

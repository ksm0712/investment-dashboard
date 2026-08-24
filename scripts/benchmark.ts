import fs from "node:fs";
import path from "node:path";

try {
  process.loadEnvFile(path.resolve(".env.local"));
} catch {
  // .env.local is optional; production env vars may already be set.
}

import { execute, initDb } from "../lib/db.ts";
import { refreshPrices } from "../lib/refresh.ts";
import { runWithMetrics } from "../lib/instrumented-fetch.ts";
import { BENCH_USER, loadFixture, resetBenchUser, seed } from "./seed.ts";

const RUNS = 20;
const WARMUP = 3;

type Args = { cold: boolean; holdings: 20 | 50; section: string };

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const holdingsArg = argv.find((a) => a.startsWith("--holdings="))?.split("=")[1];
  const sectionArg = argv.find((a) => a.startsWith("--section="))?.split("=")[1];
  return {
    cold: argv.includes("--cold"),
    holdings: holdingsArg === "50" ? 50 : 20,
    section: sectionArg || "Baseline (before optimization)",
  };
}

function percentile(sortedAsc: number[], p: number) {
  if (!sortedAsc.length) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil((p / 100) * sortedAsc.length) - 1));
  return sortedAsc[idx];
}

async function main() {
  const { cold, holdings, section } = parseArgs();
  await initDb();

  if (cold) {
    try {
      await execute("DELETE FROM quote_cache");
    } catch {
      // quote_cache doesn't exist until Phase 1 — a --cold run pre-Phase-1 is just a normal run.
    }
  }

  const fixture = await loadFixture(holdings);
  await resetBenchUser(BENCH_USER);
  await seed(BENCH_USER, fixture);

  const latenciesMs: number[] = [];
  const callCounts: number[] = [];
  const cacheTotals = { hit: 0, stale: 0, miss: 0 };

  for (let i = 0; i < RUNS; i++) {
    if (cold && i > 0) {
      // Each cold run should independently hit providers, matching Phase 2's "--cold, N holdings" scaling test.
      try {
        await execute("DELETE FROM quote_cache");
      } catch {
        // pre-Phase-1
      }
    }
    const start = performance.now();
    const { metrics } = await runWithMetrics(() => refreshPrices(BENCH_USER));
    const elapsed = performance.now() - start;
    if (i >= WARMUP) {
      latenciesMs.push(elapsed);
      callCounts.push(metrics.calls.filter((c) => c.provider !== "turso-db").length);
      for (const event of metrics.cache) cacheTotals[event] += 1;
    }
  }

  latenciesMs.sort((a, b) => a - b);
  const mean = latenciesMs.reduce((sum, v) => sum + v, 0) / latenciesMs.length;
  const p50 = percentile(latenciesMs, 50);
  const p95 = percentile(latenciesMs, 95);
  const max = Math.max(...latenciesMs);
  const avgCalls = callCounts.reduce((sum, v) => sum + v, 0) / callCounts.length;
  const cacheEvents = cacheTotals.hit + cacheTotals.stale + cacheTotals.miss;
  const hitRate = cacheEvents ? ((cacheTotals.hit + cacheTotals.stale) / cacheEvents) * 100 : 0;

  const rows = [
    ["Holdings", String(fixture.length)],
    ["Runs measured (after warmup)", String(latenciesMs.length)],
    ["Mean latency", `${mean.toFixed(0)} ms`],
    ["p50 latency", `${p50.toFixed(0)} ms`],
    ["p95 latency", `${p95.toFixed(0)} ms`],
    ["Max latency", `${max.toFixed(0)} ms`],
    ["Avg external API calls / load", avgCalls.toFixed(1)],
    ["Cache hit rate", `${hitRate.toFixed(1)}%`],
  ];
  const table = ["| Metric | Value |", "|---|---|", ...rows.map(([k, v]) => `| ${k} | ${v} |`)].join("\n");

  console.log(`\n${section}${cold ? " (cold cache)" : ""}\n`);
  console.log(table);

  const command = `npm run bench -- ${cold ? "--cold " : ""}--holdings=${holdings} --section="${section}"`.trim();
  const entry = `\n## ${section}${cold ? " — cold cache" : ""}\n\n_${new Date().toISOString()} — \`${command}\`_\n\n${table}\n`;
  fs.appendFileSync(path.resolve("BENCHMARKS.md"), entry);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

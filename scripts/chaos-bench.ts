import fs from "node:fs";
import path from "node:path";
import { initDb, getSecurities, execute } from "../lib/db.ts";
import { refreshPrices } from "../lib/refresh.ts";
import { BENCH_USER, seedBenchUser } from "./seed.ts";
import { installChaosFetch } from "./mock-provider-harness.ts";

try {
  process.loadEnvFile(path.resolve(".env.local"));
} catch {
  // .env.local is optional; production env vars may already be set.
}

function parseArgs() {
  const argv = process.argv.slice(2);
  const get = (flag: string) => argv.find((a) => a.startsWith(`--${flag}=`))?.split("=")[1];
  return {
    section: get("section") || "Phase 3 — Rate limit resilience",
    runs: Number(get("runs") || 100),
    failureRate: Number(get("failure-rate") || 0.3),
    retryAttempts: get("attempts"),
  };
}

const args = parseArgs();
// Compressed (not production-default) backoff constants so 100 runs finish in a practical
// benchmark window. The retry ALGORITHM under test (lib/resilient-fetch.ts: exponential
// backoff + jitter + a cap, circuit breaker after N consecutive exhausted calls) is exactly
// the production code — only these tuning knobs differ, which is the point of having them be
// env vars at all. See ENGINEERING_LOG.md Phase 3.
process.env.RETRY_BASE_MS = process.env.RETRY_BASE_MS || "15";
process.env.RETRY_CEILING_MS = process.env.RETRY_CEILING_MS || "1500";
process.env.CIRCUIT_COOLDOWN_MS = process.env.CIRCUIT_COOLDOWN_MS || "1000";
if (args.retryAttempts) process.env.RETRY_MAX_ATTEMPTS = args.retryAttempts;

async function main() {
  await initDb();
  const fixture = await seedBenchUser(20);

  const { restore, stats } = installChaosFetch(args.failureRate);
  let totalHoldings = 0;
  let totalFailedSecurities = 0;
  let totalUserVisibleErrors = 0;
  let runsWithAnyUserVisibleError = 0;

  try {
    for (let i = 0; i < args.runs; i++) {
      // Every run must genuinely hit the (mocked) provider layer — otherwise Phase 1's cache
      // shields runs 2..N almost entirely (verified: leaving the cache warm across all 100
      // runs produced ~170 total provider calls instead of thousands, and a 0% failure rate
      // that measured the cache, not the resilience code). This isolates Phase 3 from Phase 1
      // the same way scripts/benchmark.ts's --cold does for Phase 2.
      await execute("DELETE FROM quote_cache");
      const { summary } = await refreshPrices(BENCH_USER);
      totalHoldings += summary.total;
      totalFailedSecurities += summary.failed;

      const securities = await getSecurities(BENCH_USER);
      const blank = securities.filter((s) => s.refreshStatus === "failed" && (s.latestValue === null || s.latestValue === undefined));
      totalUserVisibleErrors += blank.length;
      if (blank.length > 0) runsWithAnyUserVisibleError += 1;
    }
  } finally {
    restore();
    // The mock writes fake prices through the real getQuote()/writeCache() path into the same
    // shared, global-by-symbol quote_cache other scripts and the dev server read from — leaving
    // any behind would contaminate the next real read of these symbols. Always clean up, success
    // or failure. See ENGINEERING_LOG.md Phase 3 for how this was caught.
    await execute("DELETE FROM quote_cache").catch(() => {});
  }

  const requestFailureRate = stats.total ? (stats.failed / stats.total) * 100 : 0;
  const securityFailureRate = totalHoldings ? (totalFailedSecurities / totalHoldings) * 100 : 0;
  const userVisibleErrorRate = totalHoldings ? (totalUserVisibleErrors / totalHoldings) * 100 : 0;

  const rows = [
    ["Holdings", String(fixture.length)],
    ["Runs (full portfolio loads)", String(args.runs)],
    ["Mock request failure rate (target ~30%)", `${requestFailureRate.toFixed(1)}%`],
    ["Total mock requests", String(stats.total)],
    ["Security-level refresh failure rate", `${securityFailureRate.toFixed(1)}%`],
    ["User-visible error rate (no usable price at all)", `${userVisibleErrorRate.toFixed(2)}%`],
    ["Runs with >=1 user-visible error", `${runsWithAnyUserVisibleError} / ${args.runs}`],
    ["RETRY_MAX_ATTEMPTS", String(process.env.RETRY_MAX_ATTEMPTS || 5)],
  ];
  const table = ["| Metric | Value |", "|---|---|", ...rows.map(([k, v]) => `| ${k} | ${v} |`)].join("\n");

  console.log(`\n${args.section}\n`);
  console.log(table);

  const command = `npm run chaos-bench -- --section="${args.section}" --runs=${args.runs} --failure-rate=${args.failureRate}${args.retryAttempts ? ` --attempts=${args.retryAttempts}` : ""}`;
  const entry = `\n## ${args.section}\n\n_${new Date().toISOString()} — \`${command}\`_\n\n${table}\n`;
  fs.appendFileSync(path.resolve("BENCHMARKS.md"), entry);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

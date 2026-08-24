import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import autocannon from "autocannon";

try {
  process.loadEnvFile(path.resolve(".env.local"));
} catch {
  // .env.local is optional; production env vars may already be set.
}

import { initDb } from "../lib/db.ts";
import { BENCH_USER, seedBenchUser } from "./seed.ts";

// Mirrors lib/auth.ts's encodeSession() exactly (same secret, same HMAC-SHA256 scheme), rather
// than importing it — that module's top-level `import { cookies } from "next/headers"` only
// resolves inside the Next.js server runtime, not a standalone script.
function encodeSession(user: { sub: string; email?: string; name?: string }) {
  const secret = process.env.AUTH_COOKIE_SECRET || process.env.COOKIE_SECRET || "local-dev-secret";
  const payload = JSON.stringify({ user, expires: Date.now() + 30 * 24 * 60 * 60 * 1000 });
  const value = Buffer.from(payload).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(value).digest("hex");
  return `${value}.${signature}`;
}

function parseArgs() {
  const argv = process.argv.slice(2);
  const get = (flag: string) => argv.find((a) => a.startsWith(`--${flag}=`))?.split("=")[1];
  return {
    url: get("url") || "http://localhost:3000",
    section: get("section") || "Phase 5 — Load test",
    levels: (get("levels") || "1,10,50,100").split(",").map(Number),
    duration: Number(get("duration") || 30),
    p99ThresholdMs: Number(get("p99-threshold") || 500),
  };
}

type LevelResult = {
  connections: number;
  requestsPerSec: number;
  p50Ms: number;
  p99Ms: number;
  errors: number;
  non2xx: number;
  totalRequests: number;
};

function runLevel(url: string, connections: number, duration: number, cookie: string): Promise<LevelResult> {
  return new Promise((resolve, reject) => {
    autocannon(
      {
        url,
        connections,
        duration,
        method: "POST",
        headers: { cookie: `investment_dashboard_user=${cookie}` },
      },
      (err: unknown, result: any) => {
        if (err) return reject(err);
        resolve({
          connections,
          requestsPerSec: result.requests.average,
          p50Ms: result.latency.p50,
          p99Ms: result.latency.p99,
          errors: result.errors,
          non2xx: result.non2xx,
          totalRequests: result.requests.total,
        });
      },
    );
  });
}

async function main() {
  const args = parseArgs();
  await initDb();
  await seedBenchUser(20);

  const cookie = encodeSession({ sub: BENCH_USER, email: "bench@example.com", name: "Bench User" });

  const results: LevelResult[] = [];
  for (const connections of args.levels) {
    console.log(`\n-- ${connections} connections, ${args.duration}s --`);
    const result = await runLevel(`${args.url}/api/refresh`, connections, args.duration, cookie);
    console.log(result);
    results.push(result);
  }

  const maxSustained = [...results].reverse().find((r) => r.p99Ms < args.p99ThresholdMs && r.non2xx === 0 && r.errors === 0);

  const rows = results.map((r) => [
    String(r.connections),
    r.requestsPerSec.toFixed(1),
    `${r.p50Ms} ms`,
    `${r.p99Ms} ms`,
    `${(((r.errors + r.non2xx) / Math.max(1, r.totalRequests)) * 100).toFixed(2)}%`,
  ]);
  const table = [
    "| Concurrency | Req/s | p50 | p99 | Error rate |",
    "|---|---|---|---|---|",
    ...rows.map((r) => `| ${r.join(" | ")} |`),
  ].join("\n");

  console.log(`\n${args.section}\n`);
  console.log(table);
  console.log(`Max concurrency sustained under ${args.p99ThresholdMs}ms p99, 0 errors: ${maxSustained ? maxSustained.connections : "NONE"}`);

  const command = `npm run load-test -- --url=${args.url} --section="${args.section}" --levels=${args.levels.join(",")} --duration=${args.duration}`;
  const entry = `\n## ${args.section}\n\n_${new Date().toISOString()} — \`${command}\`_\n\nTarget: \`POST ${args.url}/api/refresh\` (the live-data path), authenticated as a seeded 20-holding bench user via a signed session cookie minted with \`lib/auth.ts\`'s \`encodeSession\`. ${args.duration}s per concurrency level.\n\n${table}\n\n**Max concurrency sustained under ${args.p99ThresholdMs}ms p99 with zero errors: ${maxSustained ? maxSustained.connections : "NONE"}**\n`;
  fs.appendFileSync(path.resolve("BENCHMARKS.md"), entry);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

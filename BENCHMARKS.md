# Benchmarks

Append-only. Every number below comes from an actual run of a script in `scripts/`, shown in the section's methodology line. Nothing here is estimated or extrapolated — anything that couldn't be run is marked `NOT MEASURED`. See `ENGINEERING_LOG.md` for the reasoning behind each phase, and the "Local benchmarking environment" note there for how these were run.

## Baseline (before optimization)

_2026-08-23T22:33:13.602Z — `npm run bench -- --holdings=20 --section="Baseline (before optimization)"`_

| Metric | Value |
|---|---|
| Holdings | 20 |
| Runs measured (after warmup) | 17 |
| Mean latency | 473 ms |
| p50 latency | 421 ms |
| p95 latency | 1271 ms |
| Max latency | 1271 ms |
| Avg external API calls / load | 100.0 |
| Cache hit rate | 0.0% |

## Baseline (before optimization) — DB query analysis

_2026-08-23T22:33:54.292Z — `npm run db-bench -- --section="Baseline (before optimization)"`_

Top 3 slowest queries by total time during a full `getSecurities` + `getActionHistory` + `syncActionHistory` load, ranked by instrumenting `lib/db.ts`'s `execute()` (see `lib/instrumented-fetch.ts`).

### #1 — `INSERT INTO action_history...`
```sql
INSERT INTO action_history
          (security_id,action,previous_action,current_price,target_price,source,reasons,recorded_at)
         SELECT ?,?,?,?,?,?,?,?
         WHERE NOT EXISTS (
           SELECT 1 FROM action_history
           WHERE security_id=? AND action=?
             AND id=(SELECT MAX(id) FROM action_history WHERE security_id=?)
         )
```
- Query plan (`EXPLAIN QUERY PLAN`): SCAN CONSTANT ROW | SCALAR SUBQUERY 2 | SEARCH action_history USING INTEGER PRIMARY KEY (rowid=?) | SCALAR SUBQUERY 1 | SEARCH action_history USING COVERING INDEX idx_action_history_security_recorded (security_id=?)
- Full table scan (no index used for that table): **no**
- Avg server-side execution time (Turso `query_duration_ms`, 8 repeats): 0.018 ms
- Avg wall-clock time (includes HTTP round trip, from the live load above): 0.54 ms
- Avg rows read per call: 2

### #2 — `SELECT s.*, p.name as source, p.date as portfolio_date...`
```sql
SELECT s.*, p.name as source, p.date as portfolio_date
       FROM securities s JOIN portfolios p ON s.portfolio_id=p.id
       WHERE p.user_id=?
       ORDER BY p.date DESC, s.id DESC
```
- Query plan (`EXPLAIN QUERY PLAN`): SCAN s | SEARCH p USING INTEGER PRIMARY KEY (rowid=?) | USE TEMP B-TREE FOR ORDER BY
- Full table scan (no index used for that table): **YES — SCAN s**
- Avg server-side execution time (Turso `query_duration_ms`, 8 repeats): 0.096 ms
- Avg wall-clock time (includes HTTP round trip, from the live load above): 1.71 ms
- Avg rows read per call: 64

### #3 — `SELECT h.*, s.name AS security_name...`
```sql
SELECT h.*, s.name AS security_name
     FROM action_history h
     JOIN securities s ON s.id=h.security_id
     JOIN portfolios p ON p.id=s.portfolio_id
     WHERE p.user_id=?
     ORDER BY h.recorded_at DESC, h.id DESC
     LIMIT ?
```
- Query plan (`EXPLAIN QUERY PLAN`): SCAN h USING INDEX idx_action_history_security_recorded | SEARCH s USING INTEGER PRIMARY KEY (rowid=?) | SEARCH p USING INTEGER PRIMARY KEY (rowid=?) | USE TEMP B-TREE FOR ORDER BY
- Full table scan (no index used for that table): **no**
- Avg server-side execution time (Turso `query_duration_ms`, 8 repeats): 0.043 ms
- Avg wall-clock time (includes HTTP round trip, from the live load above): 0.88 ms
- Avg rows read per call: 28

## Baseline (before optimization) — Lighthouse (deployed app)

_2026-08-23T18:34:00-04:00 — `npx lighthouse https://investment-dashboard-ox99.vercel.app/ --output=json --output=html --only-categories=performance --chrome-flags="--headless=new --no-sandbox"`_

Target: `https://investment-dashboard-ox99.vercel.app/` (the public/landing route — the portfolio itself sits behind Google OAuth, and Lighthouse can't carry an authenticated session, so this measures the unauthenticated shell the app actually serves at that URL, not a logged-in dashboard render).

| Metric | Value |
|---|---|
| Performance score | 79 / 100 |
| First Contentful Paint | 3.6 s |
| Largest Contentful Paint | 3.7 s |
| Total Blocking Time | 0 ms |
| Speed Index | 4.9 s |
| Total page weight | 200 KiB |
| JS transferred | 150,814 bytes |

Full JSON/HTML reports saved locally at `scratch-lighthouse/baseline.report.{json,html}` (not committed — regenerable from the command above).

## Phase 1 — Quote cache

Two runs, same 20-holding fixture as the baseline:
- **`--cold`**: `quote_cache` is truncated before *every* one of the 20 iterations, so every run is forced to miss. This intentionally reproduces the baseline's no-cache behavior — it exists to give Phase 2 a clean cold-cache comparison point, not to show Phase 1's benefit (a cache that's wiped before every read can't show one).
- **warm (normal usage)**: cache persists across the 20 iterations, as it would across real repeat page loads inside the TTL window — this is the number that shows Phase 1's actual effect.

| Metric | Baseline (no cache) | `--cold` (forced miss every run) | Warm (normal usage) |
|---|---|---|---|
| Mean latency | 473 ms | 562 ms | **18 ms** |
| p50 latency | 421 ms | 572 ms | **14 ms** |
| p95 latency | 1271 ms | 820 ms | **31 ms** |
| Avg external API calls / load | 100.0 | 100.0 | **0.0** |
| Cache hit rate | 0.0% | 0.0% | **100.0%** |

Warm-cache mean latency dropped 96% (473ms → 18ms) and external API calls per load dropped 100% (100 → 0) within the TTL window — beyond the spec's 80–95% target, because the cache also removes the `marketIntelligence` race (target/sector/PE — up to 5 more provider calls per holding) that used to run on every load whenever the price response alone didn't already carry that data, not just the price race.

### `--cold` (forced miss every run)

_2026-08-24T00:40:50.385Z — `npm run bench -- --cold --holdings=20 --section="Phase 1 — Quote cache"`_

| Metric | Value |
|---|---|
| Holdings | 20 |
| Runs measured (after warmup) | 17 |
| Mean latency | 562 ms |
| p50 latency | 572 ms |
| p95 latency | 820 ms |
| Max latency | 820 ms |
| Avg external API calls / load | 100.0 |
| Cache hit rate | 0.0% |

## Phase 1 — Quote cache (warm, normal usage)

_2026-08-24T00:40:58.516Z — `npm run bench -- --holdings=20 --section="Phase 1 — Quote cache (warm, normal usage)"`_

| Metric | Value |
|---|---|
| Holdings | 20 |
| Runs measured (after warmup) | 17 |
| Mean latency | 18 ms |
| p50 latency | 14 ms |
| p95 latency | 31 ms |
| Max latency | 31 ms |
| Avg external API calls / load | 0.0 |
| Cache hit rate | 100.0% |

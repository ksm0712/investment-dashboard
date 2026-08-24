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

## Phase 2 — Concurrency and batching

All runs below are `--cold` (quote_cache truncated before every iteration — isolates this phase from Phase 1's cache effect, per spec §2.4).

**Caveat, stated plainly**: `FMP_API_KEY`'s free-tier quota was exhausted during this benchmarking session (confirmed independently via `curl` against FMP directly — both single-symbol and batch requests return `{"Error Message":"Limit Reach..."}`). Every run below has FMP failing regardless of whether batching is active, so the raw call counts can't isolate batching's live effect — that number is marked **NOT MEASURED**, not estimated. The batching *mechanism* (whether the AsyncLocalStorage-scoped batch map correctly gates the "fmp" provider leg) is verified independent of live FMP quota in `lib/fmp-batch.test.ts` (5 passing tests, no network).

What *is* measured: `REFRESH_CONCURRENCY`'s real effect on wall-clock latency, at both fixture sizes, holding everything else constant:

| Metric | 20 holdings, concurrency=6 | 20 holdings, concurrency=5 (new default) | 50 holdings, concurrency=6 | 50 holdings, concurrency=5 (new default) |
|---|---|---|---|---|
| Mean latency | 470 ms | 514 ms | 1161 ms | 1181 ms |
| p50 latency | 436 ms | 470 ms | 1122 ms | 1150 ms |
| p95 latency | 707 ms | 904 ms | 1498 ms | 1864 ms |
| Avg external calls / load | 101.0 | 101.0 | 251.0 | 251.0 |

Honest reading: lowering the cap from the old hardcoded `6` to the spec's suggested default of `5` is not a speedup here — with FMP timing out on every attempt rather than failing fast (quota exhausted), less parallelism costs slightly *more* wall-clock time, not less. What Phase 2 actually delivered is that the cap stopped being a hardcoded number in `lib/refresh.ts` and became `REFRESH_CONCURRENCY` — operable without a code change, including turning it down further if a provider starts rate-limiting harder (the scenario Phase 3 targets). Scaling 20→50 holdings (2.5×) produced 514ms→1181ms (2.3×, concurrency=5) and 101→251 calls (2.5×, exactly linear as expected) — the concurrency pool absorbs the larger fan-out close to linearly rather than blowing up, which is the property this phase needed to demonstrate.

External call reduction from FMP batch prefetching: **NOT MEASURED** (FMP quota exhausted for the remainder of this session — see caveat above; mechanism verified in `lib/fmp-batch.test.ts`).

### Raw runs

#### 20 holdings, concurrency=5 (new default)

_2026-08-24T00:46:58.938Z — `npm run bench -- --cold --holdings=20 --section="Phase 2 — Concurrency and batching"`_

| Metric | Value |
|---|---|
| Holdings | 20 |
| Runs measured (after warmup) | 17 |
| Mean latency | 514 ms |
| p50 latency | 470 ms |
| p95 latency | 904 ms |
| Max latency | 904 ms |
| Avg external API calls / load | 101.0 |
| Cache hit rate | 0.0% |

#### 50 holdings, concurrency=5 (new default)

_2026-08-24T00:48:10.810Z — `npm run bench -- --cold --holdings=50 --section="Phase 2 — Concurrency and batching"`_

| Metric | Value |
|---|---|
| Holdings | 50 |
| Runs measured (after warmup) | 17 |
| Mean latency | 1181 ms |
| p50 latency | 1150 ms |
| p95 latency | 1864 ms |
| Max latency | 1864 ms |
| Avg external API calls / load | 251.0 |
| Cache hit rate | 0.0% |

#### 20 holdings, concurrency=6 (comparison run)

_2026-08-24T00:48:33.706Z — `npm run bench -- --cold --holdings=20 --section="Phase 2 — concurrency"`_

| Metric | Value |
|---|---|
| Holdings | 20 |
| Runs measured (after warmup) | 17 |
| Mean latency | 470 ms |
| p50 latency | 436 ms |
| p95 latency | 707 ms |
| Max latency | 707 ms |
| Avg external API calls / load | 101.0 |
| Cache hit rate | 0.0% |

#### 50 holdings, concurrency=6 (comparison run)

_2026-08-24T00:49:06.124Z — `npm run bench -- --cold --holdings=50 --section="Phase 2 concurrency 6 old default"`_

| Metric | Value |
|---|---|
| Holdings | 50 |
| Runs measured (after warmup) | 17 |
| Mean latency | 1161 ms |
| p50 latency | 1122 ms |
| p95 latency | 1498 ms |
| Max latency | 1498 ms |
| Avg external API calls / load | 251.0 |
| Cache hit rate | 0.0% |

## Phase 3 — Rate limit resilience

`scripts/chaos-bench.ts` runs the full data-load path (`refreshPrices`, 20 holdings) 100 times against `scripts/mock-provider-harness.ts` — a fully mocked `fetch` that fails ~30% of provider requests with a 429 (spec §3.4), never touching real network/quota. `quote_cache` is truncated before every one of the 100 runs — the first version of this benchmark left it warm across runs and produced a 0% failure rate after run 1 for the wrong reason (Phase 1's cache, not Phase 3's resilience, was doing the work); see the "what broke" note in `ENGINEERING_LOG.md`. Compares `RETRY_MAX_ATTEMPTS=1` (no retry — the pre-Phase-3 shape) against the default `5` (retry + backoff + circuit breaker), same mock, same 30% failure rate, same 100 runs:

| Metric | Before (no retry) | After (retry + circuit breaker) |
|---|---|---|
| Security-level refresh failure rate | 3.6% | **0.0%** |
| User-visible error rate | 0.0% | 0.0% |
| Runs with ≥1 user-visible error | 0 / 100 | 0 / 100 |
| Total mock provider requests | 9,156 | 19,736 |

Security-level refresh failures dropped from 3.6% to 0.0% under identical 30% upstream throttling — meeting the spec's 0% target, from a real measured (not assumed-zero) baseline. The cost is visible and expected: total provider requests roughly doubled (retries are, definitionally, more requests), which is the traded-off resource named in `ENGINEERING_LOG.md`. The user-visible error rate was already 0% in both runs — graceful degradation (serving the last known price when a refresh fails) predates Phase 3; what Phase 3 changed is how often a refresh has to fall back to that stale value at all.

### Raw runs

#### Before — RETRY_MAX_ATTEMPTS=1 (no retry)

_2026-08-24T00:55:10.966Z — `npm run chaos-bench -- --section="Phase 3 before Phase 3 no retry single attempt" --runs=100 --failure-rate=0.3 --attempts=1`_

| Metric | Value |
|---|---|
| Holdings | 20 |
| Runs (full portfolio loads) | 100 |
| Mock request failure rate (target ~30%) | 30.4% |
| Total mock requests | 9156 |
| Security-level refresh failure rate | 3.6% |
| User-visible error rate (no usable price at all) | 0.00% |
| Runs with >=1 user-visible error | 0 / 100 |
| RETRY_MAX_ATTEMPTS | 1 |

#### After — RETRY_MAX_ATTEMPTS=5 (default: retry + backoff + circuit breaker)

_2026-08-24T00:56:19.620Z — `npm run chaos-bench -- --section="Phase 3 after full resilience" --runs=100 --failure-rate=0.3`_

| Metric | Value |
|---|---|
| Holdings | 20 |
| Runs (full portfolio loads) | 100 |
| Mock request failure rate (target ~30%) | 36.3% |
| Total mock requests | 19736 |
| Security-level refresh failure rate | 0.0% |
| User-visible error rate (no usable price at all) | 0.00% |
| Runs with >=1 user-visible error | 0 / 100 |
| RETRY_MAX_ATTEMPTS | 5 |

## Phase 4 — Database optimization

`scripts/db-bench.ts` was re-run first (spec §4.1) — updated to also warm `quote_cache` and read from it, so the ranking reflects Phase 1-3's actual hot path, not just the original three functions. Indexes were added one at a time, each measured before adding the next (spec §4.2), using SQLite's `rows_read` (from Turso's `query_duration_ms`/`rows_read` per-statement stats) as the primary signal — it's an exact count of index-vs-scan efficiency, not a noisy wall-clock number:

| Query | Before | After `idx_securities_portfolio_id` alone | After adding `idx_portfolios_user_id` too | After adding `idx_lots_security_id` |
|---|---|---|---|---|
| `getSecurities` securities↔portfolios join | `SCAN s`, **98** rows read | `SCAN s USING INDEX idx_securities_portfolio_id`, **98** rows read (unchanged) | `SEARCH p` → `SEARCH s`, **42** rows read | 42 (unaffected) |
| `getSecurities` investment_lots↔securities↔portfolios join | `SCAN l`, **137** rows read | — | — | `SEARCH p` → `SEARCH s` → `SEARCH l`, **81** rows read |
| `quote_cache` read | `SEARCH ... USING INDEX sqlite_autoindex_quote_cache_1`, 1 row read | (unaffected — `symbol` is already the primary key, already indexed) | | |

**The single-index dead end, worth reading before copying this pattern elsewhere**: adding `idx_securities_portfolio_id` alone changed the query plan's *label* (`SCAN s` → `SCAN s USING INDEX ...`) but not its *cost* — `rows_read` stayed at 98. The query filters on `portfolios.user_id`, not `securities.portfolio_id` directly; without an index on the column actually being filtered, the planner had no reason to make `portfolios` the driving table of the join, so the new index just decorated the same full scan. Adding `idx_portfolios_user_id` alongside it — the column the `WHERE` clause actually touches — is what let the planner flip the join order to `SEARCH p` → `SEARCH s`, dropping rows read to 42. Measuring the first index in isolation is what caught this; assuming "added an index on the foreign key" was sufficient would have shipped a no-op.

**Lot-level cost basis (spec §4.3)**: already a single batched query (`SELECT l.* FROM investment_lots ... WHERE p.user_id=?`, one round trip for all of a user's lots) reduced once per security in JS (`calculateAsset` in `lib/portfolio-engine.ts`) — not N+1, no per-security round trip to move into SQL. Confirmed by reading `lib/db.ts`'s `getSecurities`, not assumed. No change made here — per the spec's own rule ("do not add indexes/changes speculatively... measure before adding"), there's no query to fix, only the index above on the join column, which was added and measured.

### Raw runs

#### Before any index

_2026-08-24T01:00:08.516Z — `npm run db-bench -- --section="Phase 4 before indexing"`_

Top 3 slowest queries by total time during a full `getSecurities` + `getActionHistory` + `syncActionHistory` + warm `quote_cache` read load, ranked by instrumenting `lib/db.ts`'s `execute()` (see `lib/instrumented-fetch.ts`).

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
- Avg wall-clock time (includes HTTP round trip, from the live load above): 0.52 ms
- Avg rows read per call: 2

### #2 — `SELECT * FROM quote_cache WHERE symbol=?...`
```sql
SELECT * FROM quote_cache WHERE symbol=?
```
- Query plan (`EXPLAIN QUERY PLAN`): SEARCH quote_cache USING INDEX sqlite_autoindex_quote_cache_1 (symbol=?)
- Full table scan (no index used for that table): **no**
- Avg server-side execution time (Turso `query_duration_ms`, 8 repeats): 0.014 ms
- Avg wall-clock time (includes HTTP round trip, from the live load above): 0.49 ms
- Avg rows read per call: 1

### #3 — `SELECT s.*, p.name as source, p.date as portfolio_date...`
```sql
SELECT s.*, p.name as source, p.date as portfolio_date
       FROM securities s JOIN portfolios p ON s.portfolio_id=p.id
       WHERE p.user_id=?
       ORDER BY p.date DESC, s.id DESC
```
- Query plan (`EXPLAIN QUERY PLAN`): SCAN s | SEARCH p USING INTEGER PRIMARY KEY (rowid=?) | USE TEMP B-TREE FOR ORDER BY
- Full table scan (no index used for that table): **YES — SCAN s**
- Avg server-side execution time (Turso `query_duration_ms`, 8 repeats): 0.097 ms
- Avg wall-clock time (includes HTTP round trip, from the live load above): 3.44 ms
- Avg rows read per call: 98

#### After idx_securities_portfolio_id alone (the dead end)

_2026-08-24T01:00:46.864Z — `npm run db-bench -- --section="Phase 4 after idx_securities_portfolio_id"`_

Top 3 slowest queries by total time during a full `getSecurities` + `getActionHistory` + `syncActionHistory` + warm `quote_cache` read load, ranked by instrumenting `lib/db.ts`'s `execute()` (see `lib/instrumented-fetch.ts`).

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
- Avg server-side execution time (Turso `query_duration_ms`, 8 repeats): 0.020 ms
- Avg wall-clock time (includes HTTP round trip, from the live load above): 0.54 ms
- Avg rows read per call: 2

### #2 — `SELECT * FROM quote_cache WHERE symbol=?...`
```sql
SELECT * FROM quote_cache WHERE symbol=?
```
- Query plan (`EXPLAIN QUERY PLAN`): SEARCH quote_cache USING INDEX sqlite_autoindex_quote_cache_1 (symbol=?)
- Full table scan (no index used for that table): **no**
- Avg server-side execution time (Turso `query_duration_ms`, 8 repeats): 0.014 ms
- Avg wall-clock time (includes HTTP round trip, from the live load above): 0.54 ms
- Avg rows read per call: 1

### #3 — `SELECT s.*, p.name as source, p.date as portfolio_date...`
```sql
SELECT s.*, p.name as source, p.date as portfolio_date
       FROM securities s JOIN portfolios p ON s.portfolio_id=p.id
       WHERE p.user_id=?
       ORDER BY p.date DESC, s.id DESC
```
- Query plan (`EXPLAIN QUERY PLAN`): SCAN s USING INDEX idx_securities_portfolio_id | SEARCH p USING INTEGER PRIMARY KEY (rowid=?) | USE TEMP B-TREE FOR ORDER BY
- Full table scan (no index used for that table): **no**
- Avg server-side execution time (Turso `query_duration_ms`, 8 repeats): 0.092 ms
- Avg wall-clock time (includes HTTP round trip, from the live load above): 2.23 ms
- Avg rows read per call: 98

#### After adding idx_portfolios_user_id too

_2026-08-24T01:01:46.950Z — `npm run db-bench -- --section="Phase 4 after idx_securities_portfolio_id plus idx_portfolios_user_id"`_

Top 3 slowest queries by total time during a full `getSecurities` + `getActionHistory` + `syncActionHistory` + warm `quote_cache` read load, ranked by instrumenting `lib/db.ts`'s `execute()` (see `lib/instrumented-fetch.ts`).

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
- Avg wall-clock time (includes HTTP round trip, from the live load above): 0.53 ms
- Avg rows read per call: 2

### #2 — `SELECT * FROM quote_cache WHERE symbol=?...`
```sql
SELECT * FROM quote_cache WHERE symbol=?
```
- Query plan (`EXPLAIN QUERY PLAN`): SEARCH quote_cache USING INDEX sqlite_autoindex_quote_cache_1 (symbol=?)
- Full table scan (no index used for that table): **no**
- Avg server-side execution time (Turso `query_duration_ms`, 8 repeats): 0.014 ms
- Avg wall-clock time (includes HTTP round trip, from the live load above): 0.54 ms
- Avg rows read per call: 1

### #3 — `SELECT s.*, p.name as source, p.date as portfolio_date...`
```sql
SELECT s.*, p.name as source, p.date as portfolio_date
       FROM securities s JOIN portfolios p ON s.portfolio_id=p.id
       WHERE p.user_id=?
       ORDER BY p.date DESC, s.id DESC
```
- Query plan (`EXPLAIN QUERY PLAN`): SEARCH p USING INDEX idx_portfolios_user_id (user_id=?) | SEARCH s USING INDEX idx_securities_portfolio_id (portfolio_id=?) | USE TEMP B-TREE FOR ORDER BY
- Full table scan (no index used for that table): **no**
- Avg server-side execution time (Turso `query_duration_ms`, 8 repeats): 0.099 ms
- Avg wall-clock time (includes HTTP round trip, from the live load above): 2.29 ms
- Avg rows read per call: 42

#### After adding idx_lots_security_id too (final state)

_2026-08-24T01:02:10.317Z — `npm run db-bench -- --section="Phase 4 after all three indexes"`_

Top 3 slowest queries by total time during a full `getSecurities` + `getActionHistory` + `syncActionHistory` + warm `quote_cache` read load, ranked by instrumenting `lib/db.ts`'s `execute()` (see `lib/instrumented-fetch.ts`).

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
- Avg server-side execution time (Turso `query_duration_ms`, 8 repeats): 0.020 ms
- Avg wall-clock time (includes HTTP round trip, from the live load above): 0.54 ms
- Avg rows read per call: 2

### #2 — `SELECT * FROM quote_cache WHERE symbol=?...`
```sql
SELECT * FROM quote_cache WHERE symbol=?
```
- Query plan (`EXPLAIN QUERY PLAN`): SEARCH quote_cache USING INDEX sqlite_autoindex_quote_cache_1 (symbol=?)
- Full table scan (no index used for that table): **no**
- Avg server-side execution time (Turso `query_duration_ms`, 8 repeats): 0.014 ms
- Avg wall-clock time (includes HTTP round trip, from the live load above): 0.52 ms
- Avg rows read per call: 1

### #3 — `SELECT s.*, p.name as source, p.date as portfolio_date...`
```sql
SELECT s.*, p.name as source, p.date as portfolio_date
       FROM securities s JOIN portfolios p ON s.portfolio_id=p.id
       WHERE p.user_id=?
       ORDER BY p.date DESC, s.id DESC
```
- Query plan (`EXPLAIN QUERY PLAN`): SEARCH p USING INDEX idx_portfolios_user_id (user_id=?) | SEARCH s USING INDEX idx_securities_portfolio_id (portfolio_id=?) | USE TEMP B-TREE FOR ORDER BY
- Full table scan (no index used for that table): **no**
- Avg server-side execution time (Turso `query_duration_ms`, 8 repeats): 0.110 ms
- Avg wall-clock time (includes HTTP round trip, from the live load above): 2.28 ms
- Avg rows read per call: 42

## Phase 5 — Load test

Local only, per the constraint that this shouldn't touch a real Vercel deployment: `next build && next start` at the `baseline` git tag (in a separate worktree, port 3002) and at the final commit (port 3001), both hit with `autocannon` via `scripts/load-test.ts`, same machine, same 20-holding bench user, same 30s-per-level ramp (1/10/50/100 connections) against `POST /api/refresh` — the real live-data path (see Phase 0's finding that `GET /api/portfolio` doesn't call external providers, so it wasn't a meaningful load-test target).

**A first "after" run is not included below** — it hit the local `turso dev` dev server's default 128-connection pool limit under 50+ concurrent full-portfolio-refreshes (`"Timed out while opening database connection"`, a 429 from `sqld` itself, not from the app), which would have measured the local benchmarking environment's DB pool, not the application. Re-run with the pool raised (`SQLD_MAX_CONCURRENT_CONNECTIONS=1024`) — see `ENGINEERING_LOG.md` Phase 5 for the full story, including a second local-environment ceiling this hit.

`scripts/load-test.ts`'s printed "Error rate" column divides by autocannon's `totalRequests`, which double-counts or undercounts depending on the failure mode (`non2xx` responses are a *subset* of `totalRequests`, but connection-level `errors` — a request that never got a response at all — are *not*, so the raw script output below shows nonsensical values like "110.55%" and "15000.00%"). Corrected by hand here from the same raw counts (successful = completed requests minus `non2xx`; attempted = `totalRequests + errors`), shown transparently rather than as a single easy-to-miscompute percentage:

| Concurrency | Before: successful / attempted | Before: p99 | After: successful / attempted | After: p99 |
|---|---|---|---|---|
| 1 | 69 / 69 (100%) | 1614 ms | 414 / 414 (100%) | 455 ms |
| 10 | 72 / 72 (100%) | 8093 ms | 1075 / 1075 (100%) | 628 ms |
| 50 | 0 / 150 (0%) | — (nothing completed) | 348 / 398 (87.4%) | 6483 ms |
| 100 | 0 / 300 (0%) | — (nothing completed) | 0 / 1247 (0%) | 5060 ms |

**Max concurrency sustained under 500ms p99 with zero errors: NONE for either build** — this app's actual data-load path races 5 real external market-data providers per holding, and no amount of caching/resilience on the *application* side changes that a cache-miss under concurrent load still has to wait on real network calls. The result worth stating plainly: at low concurrency (1, 10) both builds complete 100% of requests, just far slower before optimization (p99 1614ms→455ms at 1 connection, 8093ms→628ms at 10). At 50 concurrent users the baseline completes **zero** of 150 attempted requests in 30 seconds — a hard failure, not a slowdown — while the optimized build still completes 87.4% of its (also degraded, 6.5s p99) requests. At 100 concurrent users both builds fail completely; the optimized build's cache and resilience layer measurably delays that collapse but doesn't move the ceiling of "real external API calls this many concurrent users demand" high enough to survive it locally.

### Raw runs

#### After (final commit, port 3001, boosted local DB connection pool)

_2026-08-24T01:12:24.690Z — `npm run load-test -- --url=http://localhost:3001 --section="Phase 5 after optimization current HEAD" --levels=1,10,50,100 --duration=30`_

Target: `POST http://localhost:3001/api/refresh` (the live-data path), authenticated as a seeded 20-holding bench user via a signed session cookie minted with `lib/auth.ts`'s `encodeSession`. 30s per concurrency level.

| Concurrency | Req/s | p50 | p99 | Error rate |
|---|---|---|---|---|
| 1 | 13.8 | 55 ms | 455 ms | 0.00% |
| 10 | 35.8 | 261 ms | 628 ms | 0.00% |
| 50 | 11.6 | 2191 ms | 6483 ms | 14.37% |
| 100 | 37.6 | 1007 ms | 5060 ms | 110.55% |

**Max concurrency sustained under 500ms p99 with zero errors: 1**

#### Before (baseline tag, port 3002)

_2026-08-24T01:30:40.103Z — `npm run load-test -- --url=http://localhost:3002 --section="Phase 5 before baseline pre-optimization commit" --levels=1,10,50,100 --duration=30`_

Target: `POST http://localhost:3002/api/refresh` (the live-data path), authenticated as a seeded 20-holding bench user via a signed session cookie minted with `lib/auth.ts`'s `encodeSession`. 30s per concurrency level.

| Concurrency | Req/s | p50 | p99 | Error rate |
|---|---|---|---|---|
| 1 | 2.3 | 380 ms | 1614 ms | 0.00% |
| 10 | 2.4 | 2561 ms | 8093 ms | 0.00% |
| 50 | 0.0 | 0 ms | 0 ms | 15000.00% |
| 100 | 0.0 | 0 ms | 0 ms | 30000.00% |

**Max concurrency sustained under 500ms p99 with zero errors: NONE**

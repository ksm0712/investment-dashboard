# Engineering Log

Reasoning behind each phase of the performance/reliability work in `BENCHMARKS.md`. Written for an engineer who hasn't seen the code.

## Local benchmarking environment

The spec this work follows was written assuming Supabase/Postgres. This app's actual database is Turso (libSQL — a SQLite fork accessed over HTTP), confirmed by reading `lib/db.ts`: there's no Supabase client anywhere, just a hand-rolled `execute()` that POSTs to Turso's `/v2/pipeline` endpoint. That changes some mechanics (`EXPLAIN QUERY PLAN` instead of `EXPLAIN ANALYZE`, no native `(user_id, created_at)` composite the way the spec assumed, since `user_id` lives on `portfolios` not `securities`) but not the intent.

No Turso credentials existed in this checkout — only OAuth and optional market-data provider keys. Real DB-backed numbers (query plans, index effects, cache persistence) need a real libSQL backend, not the app's in-memory demo-mode fallback. `turso dev` (Turso's own local dev server) speaks the identical HTTP wire protocol as hosted Turso and needs no account, so it's used here as the benchmarking backend: installed from GitHub release binaries (Homebrew's formula required a newer Xcode than was installed, so the prebuilt `turso-cli` and `sqld` tarballs were used directly instead), running on `127.0.0.1:8080`, with `.env.local` pointed at it. `lib/db.ts` is exercised completely unmodified against it — this is not a mock, it's the same code path production runs, against a locally-hosted instance of the same database engine.

## Phase 0 — Instrumentation and baseline

**The problem**: before touching anything, find out what "the portfolio data-load path" actually is, and how slow/expensive it is today, with real numbers.

The first thing this revealed, by reading `app/api/portfolio/route.ts`, is that the spec's assumption ("the app fetches market data from the external provider on demand" on page load) doesn't hold here. `GET /api/portfolio` only reads what's already stored in Turso — `latest_price`, `target_price`, etc. — set by the last refresh. It never calls an external provider itself. The actual live-data path is `refreshPrices(userId)` in `lib/refresh.ts`, invoked from `POST /api/refresh` (manual "Refresh" button) and a daily Vercel cron. That's the function every benchmark in this project targets — benchmarking `GET /api/portfolio` instead would have produced a trivially fast, meaningless number, since it's a database read.

The second surprise: `refreshPrices` already fans out over holdings with bounded concurrency (`mapWithConcurrency(securities, 6, worker)`), not a serial loop, and each holding itself races 5+ keyless market-data providers (yahoo-finance2, raw Yahoo, Financial Modeling Prep, Nasdaq, a scrape-proxy fallback) via `Promise.allSettled`, taking whichever responds first/richest. There's no single rate-limited API to point a "the provider" story at — Phase 2 and Phase 3 are scoped around this multi-provider reality rather than the spec's implicit single-provider model.

**Instrumentation** (`lib/instrumented-fetch.ts`): an `AsyncLocalStorage`-scoped call/cache-event recorder, exposed as `timed()` (wraps one provider call) and `timedDb()` (wraps one Turso query, also capturing Turso's own server-reported `query_duration_ms`/`rows_read` — a more precise number than our wall-clock timing, since it excludes HTTP round-trip). Outside a `runWithMetrics()` scope these are no-ops (a `getStore()` check), so production route handlers pay nothing extra unless they opt in. This single module satisfies both the external-API counter (spec §0.1) and the DB-query-timing instrumentation (spec §0.3) — one generic tool, not two.

**Baseline numbers** (20 holdings, 4 currencies, 4 exchanges — `scripts/fixtures/test-portfolio.json`):
- Mean load latency: 473 ms (p50 421 ms, p95 1271 ms) for a full `refreshPrices` run.
- 100 external API calls per load (5 providers × 20 holdings — every provider is tried for every holding today).
- 0% cache hit rate — there is no cache yet.
- Slowest DB query found by ranking instrumented `execute()` calls during a full page load: the `getSecurities` join (`securities JOIN portfolios`) does a full table scan on `securities` (`SCAN s` in `EXPLAIN QUERY PLAN`, no index on `portfolio_id`) — direct evidence for the Phase 4 index, not a guess.
- Lighthouse ran against the deployed app's public route (`https://investment-dashboard-ox99.vercel.app/`) rather than an authenticated dashboard render, since Lighthouse can't carry the app's session cookie: 79/100 performance, 3.6s FCP, 3.7s LCP, 0ms TBT, 150.8 KB JS transferred.

**Tradeoff**: the 100-external-calls-per-load number is itself the strongest evidence for Phase 1 — every holding currently pays for all 5 providers because the code races them for the *richest* result (52-week range, analyst target, sector, P/E), not just the fastest price. A cache doesn't just remove redundant calls across page loads, it removes redundant calls the multi-provider race already does *within* a single load once cache-fresh data covers 52-week range/target/sector, since `marketPriceForSecurity`'s `enrich()` step only calls `marketIntelligence` when a result is missing that data.

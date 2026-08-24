import type { ActionHistoryEntry, AddInvestmentInput, Lot, Portfolio, Security } from "./types.ts";
import { toInr } from "./format.ts";
import { getFx } from "./fx.ts";
import { calculateAsset } from "./portfolio-engine.ts";
import { buildActionHistoryEntry } from "./action-history.ts";
import { timedDb } from "./instrumented-fetch.ts";

type Row = Record<string, unknown>;

const demo = {
  nextPortfolioId: 1,
  nextSecurityId: 1,
  nextLotId: 1,
  nextActionHistoryId: 1,
  portfolios: [] as Portfolio[],
  securities: [] as Security[],
  actionHistory: [] as ActionHistoryEntry[],
};

function hasTurso() {
  return Boolean(process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN);
}

function tursoUrl() {
  const raw = process.env.TURSO_DATABASE_URL || "";
  const url = raw.startsWith("libsql://") ? `https://${raw.slice("libsql://".length)}` : raw;
  return `${url.replace(/\/$/, "")}/v2/pipeline`;
}

function arg(value: unknown) {
  if (value === null || value === undefined) return { type: "null" };
  if (typeof value === "number" && !Number.isFinite(value)) return { type: "null" };
  if (typeof value === "number" && Number.isInteger(value)) return { type: "integer", value: String(value) };
  if (typeof value === "number") return { type: "float", value };
  if (typeof value === "boolean") return { type: "integer", value: value ? "1" : "0" };
  return { type: "text", value: String(value) };
}

function val(cell: any) {
  if (!cell || typeof cell !== "object") return cell;
  if (cell.type === "null") return null;
  if (cell.type === "integer") return Number(cell.value);
  if (cell.type === "float") return Number(cell.value);
  return cell.value;
}

function real(value: unknown, fallback: number): number;
function real(value: unknown, fallback: null): number | null;
function real(value: unknown, fallback: number | null) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = typeof value === "number" ? value : Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(number) ? number : fallback;
}

export async function execute(sql: string, params: unknown[] = []) {
  if (!hasTurso()) return { rows: [] as Row[] };
  return timedDb(sql, params, () => rawExecute(sql, params));
}

async function rawExecute(sql: string, params: unknown[] = []) {
  const stmt: any = { sql };
  if (params.length) stmt.args = params.map(arg);
  const res = await fetch(tursoUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.TURSO_AUTH_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ requests: [{ type: "execute", stmt }, { type: "close" }] }),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Turso request failed: ${res.status}${text ? ` ${text.slice(0, 240)}` : ""}`);
  const payload = JSON.parse(text);
  const first = payload.results?.[0];
  if (first?.type !== "ok") throw new Error(JSON.stringify(first));
  const result = first.response?.result;
  const columns = (result?.cols || []).map((col: any) => typeof col === "string" ? col : col.name);
  const rows = (result?.rows || []).map((row: any[]) =>
    Object.fromEntries(row.map((cell, index) => [columns[index], val(cell)])),
  );
  return {
    rows: rows as Row[],
    serverMs: typeof result?.query_duration_ms === "number" ? result.query_duration_ms : undefined,
    rowsRead: typeof result?.rows_read === "number" ? result.rows_read : undefined,
  };
}

let initialized = false;

async function tableColumns(table: string) {
  const { rows } = await execute(`PRAGMA table_info(${table})`);
  return new Set(rows.map((row) => String(row.name)));
}

async function addMissingColumns(table: string, columns: Record<string, string>) {
  const existing = await tableColumns(table);
  for (const [name, definition] of Object.entries(columns)) {
    if (!existing.has(name)) {
      try {
        await execute(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
      } catch (error) {
        const message = error instanceof Error ? error.message.toLowerCase() : "";
        if (!message.includes("duplicate column") && !message.includes("already exists")) {
          throw error;
        }
      }
    }
  }
}

export async function initDb() {
  if (initialized || !hasTurso()) return;
  await execute(`CREATE TABLE IF NOT EXISTS portfolios (
    id INTEGER PRIMARY KEY, name TEXT, date TEXT, user_id TEXT,
    UNIQUE(name, date, user_id)
  )`);
  await execute(`CREATE TABLE IF NOT EXISTS securities (
    id INTEGER PRIMARY KEY, portfolio_id INTEGER, name TEXT,
    asset_type TEXT, currency TEXT, value REAL, value_inr REAL,
    annual_income REAL, return_pct REAL, quantity REAL, ticker TEXT, isin TEXT,
    price_source TEXT, price_symbol TEXT, latest_price REAL, price_as_on TEXT,
    latest_value REAL, latest_value_inr REAL, refresh_status TEXT, refresh_note TEXT,
    refreshed_at TEXT, country TEXT, pricing_mode TEXT, exchange TEXT,
    cost_price REAL, purchase_date TEXT
  )`);
  await execute(`CREATE TABLE IF NOT EXISTS investment_lots (
    id INTEGER PRIMARY KEY,
    security_id INTEGER NOT NULL,
    quantity REAL NOT NULL,
    cost_price REAL NOT NULL,
    purchase_date TEXT,
    fees REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY(security_id) REFERENCES securities(id)
  )`);
  await execute(`CREATE TABLE IF NOT EXISTS action_history (
    id INTEGER PRIMARY KEY,
    security_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    previous_action TEXT,
    current_price REAL,
    target_price REAL,
    source TEXT,
    reasons TEXT,
    recorded_at TEXT NOT NULL,
    FOREIGN KEY(security_id) REFERENCES securities(id)
  )`);
  await execute(`CREATE INDEX IF NOT EXISTS idx_action_history_security_recorded
    ON action_history(security_id, recorded_at DESC)`);
  // Added after scripts/db-bench.ts measured `SELECT s.* FROM securities s JOIN portfolios p
  // ON s.portfolio_id=p.id WHERE p.user_id=?` doing a full table scan on `securities`
  // (EXPLAIN QUERY PLAN: "SCAN s", 98 rows read for a 20-holding portfolio). Adding this index
  // alone changed the plan's label but not its cost (still 98 rows read) — the planner had no
  // reason to flip the join order without an index on the column it actually filters on,
  // portfolios.user_id, so that's added too. Together, the plan becomes
  // "SEARCH p USING INDEX idx_portfolios_user_id" -> "SEARCH s USING INDEX
  // idx_securities_portfolio_id", 98 -> 42 rows read. See BENCHMARKS.md / ENGINEERING_LOG.md
  // Phase 4 for the full before/after, including the single-index dead end.
  await execute(`CREATE INDEX IF NOT EXISTS idx_securities_portfolio_id
    ON securities(portfolio_id)`);
  await execute(`CREATE INDEX IF NOT EXISTS idx_portfolios_user_id
    ON portfolios(user_id)`);
  // Same finding as securities above, on the parallel query in getSecurities():
  // `SELECT l.* FROM investment_lots l JOIN securities s ... JOIN portfolios p ...
  // WHERE p.user_id=?` scanned all of investment_lots (137 rows read for a 20-lot portfolio)
  // before this index existed.
  await execute(`CREATE INDEX IF NOT EXISTS idx_lots_security_id
    ON investment_lots(security_id)`);
  // Extends the spec's column list (price, change_pct, high_52w, low_52w, analyst_target, pe,
  // forward_pe, peg, currency, exchange, fetched_at) with price_date/source/sector/industry/
  // target_source/target_as_on: refreshPrices() writes those to `securities` on every refresh,
  // so without them a cache hit would silently null them out. See ENGINEERING_LOG.md Phase 1.
  await execute(`CREATE TABLE IF NOT EXISTS quote_cache (
    symbol TEXT PRIMARY KEY,
    price REAL,
    change_pct REAL,
    high_52w REAL,
    low_52w REAL,
    analyst_target REAL,
    pe REAL,
    forward_pe REAL,
    peg REAL,
    currency TEXT,
    exchange TEXT,
    price_date TEXT,
    source TEXT,
    sector TEXT,
    industry TEXT,
    target_source TEXT,
    target_as_on TEXT,
    fetched_at TEXT NOT NULL
  )`);
  await addMissingColumns("portfolios", {
    user_id: "TEXT",
  });
  await addMissingColumns("securities", {
    quantity: "REAL",
    ticker: "TEXT",
    isin: "TEXT",
    price_source: "TEXT",
    price_symbol: "TEXT",
    latest_price: "REAL",
    price_as_on: "TEXT",
    latest_value: "REAL",
    latest_value_inr: "REAL",
    refresh_status: "TEXT",
    refresh_note: "TEXT",
    refreshed_at: "TEXT",
    country: "TEXT",
    pricing_mode: "TEXT",
    exchange: "TEXT",
    cost_price: "REAL",
    purchase_date: "TEXT",
    target_price: "REAL",
    target_source: "TEXT",
    target_as_on: "TEXT",
    week_52_low: "REAL",
    week_52_high: "REAL",
    change_percent: "REAL",
    sector: "TEXT",
    industry: "TEXT",
    trailing_pe: "REAL",
    forward_pe: "REAL",
    peg_ratio: "REAL",
    secondary_target_price: "REAL",
    market_data_source: "TEXT",
    market_data_as_on: "TEXT",
    allocation: "REAL",
    lots_migrated: "INTEGER NOT NULL DEFAULT 0",
  });
  await execute(`UPDATE securities SET pricing_mode = CASE
    WHEN asset_type IN ('Stock','ETF') THEN 'auto'
    WHEN asset_type='Mutual Fund' AND currency='INR' THEN 'auto'
    ELSE 'manual' END
    WHERE pricing_mode IS NULL OR TRIM(pricing_mode)=''`);
  await execute(`UPDATE securities SET country = CASE
    WHEN currency='INR' THEN 'India'
    WHEN currency='SGD' THEN 'Singapore'
    WHEN currency='USD' THEN 'United States'
    WHEN currency='GBP' THEN 'United Kingdom'
    WHEN currency='EUR' THEN 'Europe'
    WHEN currency='JPY' THEN 'Japan'
    ELSE 'Other' END
    WHERE country IS NULL OR TRIM(country)=''`);
  await execute(`UPDATE securities SET price_as_on=(
    SELECT portfolios.date FROM portfolios WHERE portfolios.id=securities.portfolio_id)
    WHERE price_as_on IS NULL OR TRIM(price_as_on)=''`);
  await execute(`INSERT INTO investment_lots (security_id,quantity,cost_price,purchase_date,fees,created_at)
    SELECT id,quantity,cost_price,purchase_date,0,COALESCE(refreshed_at,datetime('now'))
    FROM securities
    WHERE lots_migrated=0 AND quantity IS NOT NULL AND quantity>0 AND cost_price IS NOT NULL AND cost_price>=0`);
  await execute("UPDATE securities SET lots_migrated=1 WHERE lots_migrated=0");
  initialized = true;
}

function mapSecurity(row: Row): Security {
  const lots: Lot[] = [];
  const calculation = calculateAsset({
    currentPrice: real(row.latest_price, null),
    targetPrice: real(row.target_price, null),
    week52Low: real(row.week_52_low, null),
    week52High: real(row.week_52_high, null),
    allocation: real(row.allocation, null),
    lots,
  });
  return {
    ...calculation,
    id: Number(row.id),
    portfolioId: Number(row.portfolio_id),
    name: String(row.name || ""),
    assetType: String(row.asset_type || "Other") as Security["assetType"],
    currency: String(row.currency || "USD"),
    value: Number(row.value || 0),
    valueInr: Number(row.value_inr || 0),
    annualIncome: row.annual_income === null ? null : Number(row.annual_income ?? NaN),
    returnPct: row.return_pct === null ? null : Number(row.return_pct ?? NaN),
    quantity: row.quantity === null ? null : Number(row.quantity ?? NaN),
    ticker: (row.ticker as string | null) || null,
    isin: (row.isin as string | null) || null,
    priceSource: (row.price_source as string | null) || null,
    priceSymbol: (row.price_symbol as string | null) || null,
    latestPrice: row.latest_price === null ? null : Number(row.latest_price ?? NaN),
    changePercent: real(row.change_percent, null),
    sector: (row.sector as string | null) || null,
    industry: (row.industry as string | null) || null,
    trailingPe: real(row.trailing_pe, null),
    forwardPe: real(row.forward_pe, null),
    pegRatio: real(row.peg_ratio, null),
    priceAsOn: (row.price_as_on as string | null) || null,
    latestValue: row.latest_value === null ? null : Number(row.latest_value ?? row.value ?? 0),
    latestValueInr: row.latest_value_inr === null ? null : Number(row.latest_value_inr ?? row.value_inr ?? 0),
    refreshStatus: (row.refresh_status as string | null) || null,
    refreshNote: (row.refresh_note as string | null) || null,
    refreshedAt: (row.refreshed_at as string | null) || null,
    country: String(row.country || "Other"),
    pricingMode: String(row.pricing_mode || "manual") as "auto" | "manual",
    exchange: (row.exchange as string | null) || null,
    costPrice: row.cost_price === null ? null : Number(row.cost_price ?? NaN),
    purchaseDate: (row.purchase_date as string | null) || null,
    targetPrice: real(row.target_price, null),
    secondaryTargetPrice: real(row.secondary_target_price, null),
    targetSource: (row.target_source as string | null) || null,
    targetAsOn: (row.target_as_on as string | null) || null,
    week52Low: real(row.week_52_low, null),
    week52High: real(row.week_52_high, null),
    marketDataSource: (row.market_data_source as string | null) || null,
    marketDataAsOn: (row.market_data_as_on as string | null) || null,
    allocation: real(row.allocation, null),
    lots,
    source: String(row.source || "Investments"),
  };
}

function mapLot(row: Row): Lot {
  return {
    id: Number(row.id),
    securityId: Number(row.security_id),
    quantity: real(row.quantity, 0),
    costPrice: real(row.cost_price, 0),
    purchaseDate: (row.purchase_date as string | null) || null,
    fees: real(row.fees, 0),
  };
}

function withCalculation(security: Security, lots: Lot[], fx?: Record<string, number>): Security {
  const calculation = calculateAsset({
    currentPrice: security.latestPrice,
    targetPrice: security.targetPrice,
    week52Low: security.week52Low,
    week52High: security.week52High,
    allocation: security.allocation,
    lots,
  });
  return {
    ...security,
    ...calculation,
    lots,
    quantity: calculation.sharesHeld,
    costPrice: calculation.averagePurchasePrice,
    latestValue: calculation.marketValue,
    value: calculation.marketValue ?? security.value,
    latestValueInr: calculation.marketValue === null || !fx
      ? security.latestValueInr
      : toInr(calculation.marketValue, security.currency, fx),
    valueInr: calculation.marketValue === null || !fx
      ? security.valueInr
      : toInr(calculation.marketValue, security.currency, fx),
    returnPct: calculation.gainPct === null ? null : calculation.gainPct * 100,
  };
}

function demoSecurityForUser(userId: string, securityId: number) {
  const portfolioIds = new Set(demo.portfolios.filter((portfolio) => portfolio.userId === userId).map((portfolio) => portfolio.id));
  return demo.securities.find((security) => security.id === securityId && portfolioIds.has(security.portfolioId)) || null;
}

export async function getSecurities(userId: string) {
  await initDb();
  const fx = await getFx();
  if (!hasTurso()) return [...demo.securities]
    .filter((s) => demo.portfolios.find((p) => p.id === s.portfolioId)?.userId === userId)
    .map((security) => withCalculation(security, security.lots || [], fx));
  const [{ rows }, { rows: lotRows }] = await Promise.all([
    execute(
      `SELECT s.*, p.name as source, p.date as portfolio_date
       FROM securities s JOIN portfolios p ON s.portfolio_id=p.id
       WHERE p.user_id=?
       ORDER BY p.date DESC, s.id DESC`,
      [userId],
    ),
    execute(
      `SELECT l.* FROM investment_lots l
       JOIN securities s ON s.id=l.security_id
       JOIN portfolios p ON p.id=s.portfolio_id
       WHERE p.user_id=? ORDER BY l.purchase_date ASC, l.id ASC`,
      [userId],
    ),
  ]);
  const lotsBySecurity = new Map<number, Lot[]>();
  for (const row of lotRows) {
    const lot = mapLot(row);
    const lots = lotsBySecurity.get(lot.securityId) || [];
    lots.push(lot);
    lotsBySecurity.set(lot.securityId, lots);
  }
  const seen = new Set<string>();
  const securities: Security[] = [];
  for (const row of rows) {
    const raw = mapSecurity(row);
    const mapped = withCalculation(raw, lotsBySecurity.get(raw.id) || [], fx);
    const key = `${mapped.name.trim().toLowerCase()}|${mapped.assetType.toLowerCase()}|${mapped.currency.toUpperCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      securities.push(mapped);
    }
  }
  return securities;
}

async function getSecurity(userId: string, id: number) {
  await initDb();
  if (!hasTurso()) return (await getSecurities(userId)).find((s) => s.id === id) || null;
  const { rows } = await execute(
    `SELECT s.*, p.name as source, p.date as portfolio_date
     FROM securities s JOIN portfolios p ON s.portfolio_id=p.id
     WHERE p.user_id=? AND s.id=?
     LIMIT 1`,
    [userId, id],
  );
  return rows[0] ? mapSecurity(rows[0]) : null;
}

export async function getPortfolios(userId: string) {
  await initDb();
  if (!hasTurso()) return demo.portfolios.filter((p) => p.userId === userId);
  const { rows } = await execute("SELECT id,name,date,user_id FROM portfolios WHERE user_id=? ORDER BY id DESC", [userId]);
  return rows.map((row) => ({
    id: Number(row.id),
    name: String(row.name),
    date: String(row.date),
    userId: String(row.user_id || userId),
  }));
}

function mapActionHistory(row: Row): ActionHistoryEntry {
  let reasons: string[] = [];
  try {
    const parsed = JSON.parse(String(row.reasons || "[]"));
    if (Array.isArray(parsed)) reasons = parsed.map(String);
  } catch {
    reasons = [];
  }
  return {
    id: Number(row.id),
    securityId: Number(row.security_id),
    securityName: String(row.security_name || ""),
    action: String(row.action) as ActionHistoryEntry["action"],
    previousAction: row.previous_action ? String(row.previous_action) as ActionHistoryEntry["previousAction"] : null,
    currentPrice: real(row.current_price, null),
    targetPrice: real(row.target_price, null),
    source: (row.source as string | null) || null,
    reasons,
    recordedAt: String(row.recorded_at || ""),
  };
}

export async function getActionHistory(userId: string, limit = 100) {
  await initDb();
  if (!hasTurso()) {
    const allowed = new Set(demo.portfolios.filter((portfolio) => portfolio.userId === userId).map((portfolio) => portfolio.id));
    const names = new Map(demo.securities.filter((security) => allowed.has(security.portfolioId)).map((security) => [security.id, security.name]));
    return demo.actionHistory
      .filter((entry) => names.has(entry.securityId))
      .map((entry) => ({ ...entry, securityName: names.get(entry.securityId) || entry.securityName }))
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt) || b.id - a.id)
      .slice(0, limit);
  }
  const { rows } = await execute(
    `SELECT h.*, s.name AS security_name
     FROM action_history h
     JOIN securities s ON s.id=h.security_id
     JOIN portfolios p ON p.id=s.portfolio_id
     WHERE p.user_id=?
     ORDER BY h.recorded_at DESC, h.id DESC
     LIMIT ?`,
    [userId, limit],
  );
  return rows.map(mapActionHistory);
}

export async function syncActionHistory(userId: string, securities?: Security[]) {
  const holdings = securities || await getSecurities(userId);
  const history = await getActionHistory(userId, Math.max(holdings.length * 20, 100));
  const latestBySecurity = new Map<number, ActionHistoryEntry>();
  for (const entry of history) {
    if (!latestBySecurity.has(entry.securityId)) latestBySecurity.set(entry.securityId, entry);
  }
  let recorded = 0;
  for (const security of holdings) {
    const previous = latestBySecurity.get(security.id);
    const entry = buildActionHistoryEntry(security, previous);
    if (!entry) continue;
    if (!hasTurso()) {
      demo.actionHistory.push({ id: demo.nextActionHistoryId++, ...entry });
    } else {
      await execute(
        `INSERT INTO action_history
          (security_id,action,previous_action,current_price,target_price,source,reasons,recorded_at)
         SELECT ?,?,?,?,?,?,?,?
         WHERE NOT EXISTS (
           SELECT 1 FROM action_history
           WHERE security_id=? AND action=?
             AND id=(SELECT MAX(id) FROM action_history WHERE security_id=?)
         )`,
        [
          security.id, security.action, previous?.action || null, security.latestPrice,
          security.targetPrice, entry.source, JSON.stringify(security.actionReasons), entry.recordedAt,
          security.id, security.action, security.id,
        ],
      );
    }
    recorded += 1;
  }
  // Nothing changed: the history list we already fetched above is still accurate,
  // so callers can reuse it instead of paying for another round trip to re-fetch it.
  const freshHistory = recorded === 0 ? history : await getActionHistory(userId, Math.max(holdings.length * 20, 100));
  return { recorded, history: freshHistory };
}

export async function getRefreshUserIds() {
  await initDb();
  if (!hasTurso()) {
    const portfolioIds = new Set(demo.securities.filter((security) => security.pricingMode === "auto").map((security) => security.portfolioId));
    return [...new Set(demo.portfolios.filter((portfolio) => portfolioIds.has(portfolio.id)).map((portfolio) => portfolio.userId))];
  }
  const { rows } = await execute(
    `SELECT DISTINCT p.user_id
     FROM portfolios p JOIN securities s ON s.portfolio_id=p.id
     WHERE p.user_id IS NOT NULL AND TRIM(p.user_id)<>'' AND s.pricing_mode='auto'`,
  );
  return rows.map((row) => String(row.user_id));
}

export async function addInvestment(userId: string, input: AddInvestmentInput) {
  await initDb();
  const fx = await getFx();
  const today = new Date();
  const portfolioDate = today.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).replaceAll(" ", "-");
  const quantity = real(input.quantity, 0);
  const currentPrice = real(input.currentPrice, 0);
  const costPrice = real(input.costPrice, 0);
  const value = quantity * currentPrice;
  const valueInr = toInr(value, input.currency, fx);
  const defaultSource = input.pricingMode === "auto" && input.assetType === "Mutual Fund" && input.currency === "INR"
    ? "mfapi"
    : input.pricingMode === "auto" ? "yfinance" : "manual";
  const source = input.priceSource || defaultSource;
  const priceAsOn = input.priceAsOn || today.toISOString().slice(0, 10);

  if (!hasTurso()) {
    let portfolio = demo.portfolios.find((p) => p.userId === userId && p.name === "Investments");
    if (!portfolio) {
      portfolio = { id: demo.nextPortfolioId++, name: "Investments", date: portfolioDate, userId };
      demo.portfolios.push(portfolio);
    }
    const lot: Lot = {
      id: demo.nextLotId++,
      securityId: demo.nextSecurityId,
      quantity,
      costPrice,
      purchaseDate: input.purchaseDate,
      fees: 0,
    };
    const calculation = calculateAsset({
      currentPrice,
      targetPrice: input.targetPrice ?? null,
      week52Low: input.week52Low ?? null,
      week52High: input.week52High ?? null,
      allocation: input.allocation ?? null,
      lots: [lot],
    });
    demo.securities.push({
      ...calculation,
      id: demo.nextSecurityId++,
      portfolioId: portfolio.id,
      name: input.name,
      assetType: input.assetType,
      currency: input.currency,
      value,
      valueInr,
      annualIncome: null,
      returnPct: null,
      quantity,
      ticker: input.priceSymbol || null,
      isin: null,
      priceSource: source,
      priceSymbol: input.priceSymbol || null,
      latestPrice: currentPrice,
      changePercent: input.changePercent ?? null,
      sector: input.sector ?? null,
      industry: input.industry ?? null,
      trailingPe: input.trailingPe ?? null,
      forwardPe: input.forwardPe ?? null,
      pegRatio: input.pegRatio ?? null,
      priceAsOn,
      latestValue: value,
      latestValueInr: valueInr,
      refreshStatus: input.pricingMode === "auto" ? "needs_refresh" : "manual_value",
      refreshNote: input.pricingMode === "auto" ? "Ready for online price refresh." : "Manual asset. User controls value.",
      refreshedAt: today.toISOString(),
      country: input.country,
      pricingMode: input.pricingMode,
      exchange: input.exchange || null,
      costPrice,
      purchaseDate: input.purchaseDate,
      targetPrice: input.targetPrice ?? null,
      secondaryTargetPrice: input.secondaryTargetPrice ?? null,
      targetSource: input.targetSource ?? null,
      targetAsOn: input.targetAsOn ?? null,
      week52Low: input.week52Low ?? null,
      week52High: input.week52High ?? null,
      marketDataSource: source,
      marketDataAsOn: priceAsOn,
      allocation: input.allocation ?? null,
      lots: [lot],
      source: "Investments",
    });
    return;
  }

  let portfolioRows = await execute("SELECT id FROM portfolios WHERE name=? AND date=? AND user_id=?", ["Investments", portfolioDate, userId]);
  if (!portfolioRows.rows[0]) {
    await execute("INSERT INTO portfolios (name,date,user_id) VALUES (?,?,?)", ["Investments", portfolioDate, userId]);
    portfolioRows = await execute("SELECT id FROM portfolios WHERE name=? AND date=? AND user_id=?", ["Investments", portfolioDate, userId]);
  }
  const portfolioId = Number(portfolioRows.rows[0]?.id);
  if (!portfolioId) throw new Error("Could not create portfolio.");
  const inserted = await execute(
    `INSERT INTO securities (portfolio_id,name,asset_type,currency,value,value_inr,quantity,ticker,isin,price_source,
      price_symbol,latest_price,annual_income,return_pct,price_as_on,latest_value,latest_value_inr,refresh_status,
      refresh_note,refreshed_at,country,pricing_mode,exchange,cost_price,purchase_date,allocation,lots_migrated,
      target_price,target_source,target_as_on,week_52_low,week_52_high,market_data_source,market_data_as_on,
      sector,industry,trailing_pe,forward_pe,peg_ratio,secondary_target_price,change_percent)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`,
    [
      portfolioId, input.name, input.assetType, input.currency, value, valueInr, quantity, input.priceSymbol || null,
      null, source, input.priceSymbol || null, currentPrice, null, null, priceAsOn,
      value, valueInr, input.pricingMode === "auto" ? "needs_refresh" : "manual_value",
      input.pricingMode === "auto" ? "Ready for online price refresh." : "Manual asset. User controls value.",
      today.toISOString(), input.country, input.pricingMode, input.exchange || null, costPrice, input.purchaseDate,
      input.allocation ?? null, 1,
      input.targetPrice ?? null, input.targetSource ?? null, input.targetAsOn ?? null,
      input.week52Low ?? null, input.week52High ?? null, source, priceAsOn,
      input.sector ?? null, input.industry ?? null, input.trailingPe ?? null, input.forwardPe ?? null,
      input.pegRatio ?? null, input.secondaryTargetPrice ?? null, input.changePercent ?? null,
    ],
  );
  const securityId = Number(inserted.rows[0]?.id);
  if (!securityId) throw new Error("Could not create asset record.");
  await execute(
    `INSERT INTO investment_lots (security_id,quantity,cost_price,purchase_date,fees,created_at)
     VALUES (?,?,?,?,?,?)`,
    [securityId, quantity, costPrice, input.purchaseDate || null, 0, today.toISOString()],
  );
}

type SecurityUpdateFields = Partial<Pick<Security,
  "quantity" | "costPrice" | "latestPrice" | "value" | "purchaseDate" |
  "priceAsOn" | "priceSource" | "priceSymbol" | "refreshStatus" | "refreshNote" |
  "targetPrice" | "secondaryTargetPrice" | "targetSource" | "targetAsOn" | "allocation" | "week52Low" | "week52High"
>>;

export async function updateSecurity(userId: string, id: number, fields: SecurityUpdateFields) {
  await initDb();
  const security = await getSecurity(userId, id);
  if (!security) return;
  const quantity = real(fields.quantity ?? security.quantity, 0);
  const latestPrice = real(fields.latestPrice ?? security.latestPrice, 0);
  const costPrice = real(fields.costPrice ?? security.costPrice, 0);
  const nextValue = real(fields.value ?? (latestPrice && quantity ? latestPrice * quantity : security.latestValue ?? security.value), 0);
  const fx = await getFx();
  const nextValueInr = toInr(nextValue, security.currency, fx);
  const refreshedAt = new Date().toISOString();
  if (!hasTurso()) {
    const storedSecurity = demoSecurityForUser(userId, id);
    if (!storedSecurity) return;
    const updates = {
      quantity,
      costPrice,
      latestPrice,
      priceAsOn: fields.priceAsOn ?? security.priceAsOn,
      latestValue: nextValue,
      latestValueInr: nextValueInr,
      priceSource: fields.priceSource ?? security.priceSource,
      priceSymbol: fields.priceSymbol ?? security.priceSymbol,
      refreshStatus: fields.refreshStatus ?? security.refreshStatus,
      refreshNote: fields.refreshNote ?? security.refreshNote,
      purchaseDate: fields.purchaseDate ?? security.purchaseDate,
      targetPrice: fields.targetPrice ?? security.targetPrice,
      secondaryTargetPrice: fields.secondaryTargetPrice ?? security.secondaryTargetPrice,
      targetSource: fields.targetSource ?? security.targetSource,
      targetAsOn: fields.targetAsOn ?? security.targetAsOn,
      allocation: fields.allocation ?? security.allocation,
      week52Low: fields.week52Low ?? security.week52Low,
      week52High: fields.week52High ?? security.week52High,
      refreshedAt,
    };
    Object.assign(storedSecurity, updates);
    Object.assign(security, updates);
    return;
  }
  await execute(
    `UPDATE securities SET quantity=?, cost_price=?, latest_price=?, price_as_on=?, latest_value=?, latest_value_inr=?,
      purchase_date=?, refreshed_at=?, price_source=?, price_symbol=?, refresh_status=?, refresh_note=?,
      target_price=?, secondary_target_price=?, target_source=?, target_as_on=?, allocation=?, week_52_low=?, week_52_high=?
     WHERE id=? AND portfolio_id IN (SELECT id FROM portfolios WHERE user_id=?)`,
    [
      quantity, costPrice, latestPrice, fields.priceAsOn ?? security.priceAsOn,
      nextValue, nextValueInr, fields.purchaseDate ?? security.purchaseDate, refreshedAt,
      fields.priceSource ?? security.priceSource, fields.priceSymbol ?? security.priceSymbol,
      fields.refreshStatus ?? security.refreshStatus, fields.refreshNote ?? security.refreshNote,
      fields.targetPrice ?? security.targetPrice, fields.secondaryTargetPrice ?? security.secondaryTargetPrice,
      fields.targetSource ?? security.targetSource,
      fields.targetAsOn ?? security.targetAsOn, fields.allocation ?? security.allocation,
      fields.week52Low ?? security.week52Low, fields.week52High ?? security.week52High,
      id, userId,
    ],
  );
}

type LotInput = Pick<Lot, "quantity" | "costPrice"> & Partial<Pick<Lot, "purchaseDate" | "fees">>;

export async function addLot(userId: string, securityId: number, input: LotInput) {
  await initDb();
  const quantity = real(input.quantity, 0);
  const costPrice = real(input.costPrice, 0);
  const fees = real(input.fees, 0);
  if (quantity <= 0 || costPrice < 0 || fees < 0) throw new Error("Enter a positive quantity and valid cost values.");
  if (!hasTurso()) {
    const allowed = new Set(demo.portfolios.filter((portfolio) => portfolio.userId === userId).map((portfolio) => portfolio.id));
    const security = demo.securities.find((item) => item.id === securityId && allowed.has(item.portfolioId));
    if (!security) return null;
    const lot: Lot = { id: demo.nextLotId++, securityId, quantity, costPrice, purchaseDate: input.purchaseDate || null, fees };
    security.lots.push(lot);
    Object.assign(security, withCalculation(security, security.lots));
    return lot;
  }
  const security = await getSecurity(userId, securityId);
  if (!security) return null;
  const inserted = await execute(
    `INSERT INTO investment_lots (security_id,quantity,cost_price,purchase_date,fees,created_at)
     SELECT ?,?,?,?,?,? WHERE EXISTS (
       SELECT 1 FROM securities s JOIN portfolios p ON p.id=s.portfolio_id WHERE s.id=? AND p.user_id=?
     ) RETURNING id`,
    [securityId, quantity, costPrice, input.purchaseDate || null, fees, new Date().toISOString(), securityId, userId],
  );
  return inserted.rows[0] ? Number(inserted.rows[0].id) : null;
}

export async function updateLot(userId: string, lotId: number, input: Partial<LotInput>) {
  await initDb();
  if (!hasTurso()) {
    for (const security of demo.securities) {
      if (!demo.portfolios.some((p) => p.id === security.portfolioId && p.userId === userId)) continue;
      const lot = security.lots.find((item) => item.id === lotId);
      if (!lot) continue;
      if (input.quantity !== undefined) lot.quantity = real(input.quantity, 0);
      if (input.costPrice !== undefined) lot.costPrice = real(input.costPrice, 0);
      if (input.purchaseDate !== undefined) lot.purchaseDate = input.purchaseDate || null;
      if (input.fees !== undefined) lot.fees = real(input.fees, 0);
      Object.assign(security, withCalculation(security, security.lots));
      return true;
    }
    return false;
  }
  const { rows } = await execute(
    `SELECT l.* FROM investment_lots l
     JOIN securities s ON s.id=l.security_id JOIN portfolios p ON p.id=s.portfolio_id
     WHERE l.id=? AND p.user_id=? LIMIT 1`,
    [lotId, userId],
  );
  if (!rows[0]) return false;
  const existing = mapLot(rows[0]);
  const quantity = input.quantity === undefined ? existing.quantity : real(input.quantity, 0);
  const costPrice = input.costPrice === undefined ? existing.costPrice : real(input.costPrice, 0);
  const fees = input.fees === undefined ? existing.fees : real(input.fees, 0);
  if (quantity <= 0 || costPrice < 0 || fees < 0) throw new Error("Enter a positive quantity and valid cost values.");
  await execute(
    `UPDATE investment_lots SET quantity=?,cost_price=?,purchase_date=?,fees=?
     WHERE id=? AND security_id IN (
       SELECT s.id FROM securities s JOIN portfolios p ON p.id=s.portfolio_id WHERE p.user_id=?
     )`,
    [quantity, costPrice, input.purchaseDate === undefined ? existing.purchaseDate : input.purchaseDate || null, fees, lotId, userId],
  );
  return true;
}

export async function deleteLot(userId: string, lotId: number) {
  await initDb();
  if (!hasTurso()) {
    for (const security of demo.securities) {
      if (!demo.portfolios.some((p) => p.id === security.portfolioId && p.userId === userId)) continue;
      const index = security.lots.findIndex((item) => item.id === lotId);
      if (index < 0) continue;
      security.lots.splice(index, 1);
      Object.assign(security, withCalculation(security, security.lots));
      return;
    }
    return;
  }
  await execute(
    `DELETE FROM investment_lots WHERE id=? AND security_id IN (
       SELECT s.id FROM securities s JOIN portfolios p ON p.id=s.portfolio_id WHERE p.user_id=?
     )`,
    [lotId, userId],
  );
}

export async function deleteSecurity(userId: string, id: number) {
  await initDb();
  if (!hasTurso()) {
    const allowed = new Set(demo.portfolios.filter((p) => p.userId === userId).map((p) => p.id));
    const idx = demo.securities.findIndex((s) => s.id === id && allowed.has(s.portfolioId));
    if (idx >= 0) {
      demo.securities.splice(idx, 1);
      demo.actionHistory = demo.actionHistory.filter((entry) => entry.securityId !== id);
    }
    return;
  }
  await Promise.all([
    execute(
      `DELETE FROM action_history WHERE security_id=? AND security_id IN (
         SELECT s.id FROM securities s JOIN portfolios p ON p.id=s.portfolio_id WHERE p.user_id=?
       )`,
      [id, userId],
    ),
    execute(
      `DELETE FROM investment_lots WHERE security_id=? AND security_id IN (
         SELECT s.id FROM securities s JOIN portfolios p ON p.id=s.portfolio_id WHERE p.user_id=?
       )`,
      [id, userId],
    ),
  ]);
  await execute("DELETE FROM securities WHERE id=? AND portfolio_id IN (SELECT id FROM portfolios WHERE user_id=?)", [id, userId]);
}

export async function updateRefreshFields(userId: string, id: number, updates: Partial<Security>) {
  const security = await getSecurity(userId, id);
  if (!security) return;
  return updateRefreshFieldsForSecurity(userId, security, updates);
}

export async function updateRefreshFieldsForSecurity(userId: string, security: Security, updates: Partial<Security>) {
  const latestPrice = real(updates.latestPrice ?? security.latestPrice, null);
  const latestValue = real(updates.latestValue ?? security.latestValue, null);
  const latestValueInr = real(updates.latestValueInr, null) ?? (
    updates.latestValue === undefined || updates.latestValue === null
      ? real(security.latestValueInr, null)
      : toInr(real(updates.latestValue, 0), security.currency, await getFx())
  );
  if (!hasTurso()) {
    const storedSecurity = demoSecurityForUser(userId, security.id);
    if (!storedSecurity) return;
    const next = {
      latestPrice,
      changePercent: updates.changePercent ?? security.changePercent,
      priceAsOn: updates.priceAsOn ?? security.priceAsOn,
      latestValue,
      latestValueInr,
      refreshStatus: updates.refreshStatus ?? security.refreshStatus,
      refreshNote: updates.refreshNote ?? security.refreshNote,
      priceSource: updates.priceSource ?? security.priceSource,
      priceSymbol: updates.priceSymbol ?? security.priceSymbol,
      week52Low: updates.week52Low ?? security.week52Low,
      week52High: updates.week52High ?? security.week52High,
      marketDataSource: updates.marketDataSource ?? security.marketDataSource,
      marketDataAsOn: updates.marketDataAsOn ?? security.marketDataAsOn,
      targetPrice: updates.targetPrice ?? security.targetPrice,
      targetSource: updates.targetSource ?? security.targetSource,
      targetAsOn: updates.targetAsOn ?? security.targetAsOn,
      sector: updates.sector ?? security.sector,
      industry: updates.industry ?? security.industry,
      trailingPe: updates.trailingPe ?? security.trailingPe,
      forwardPe: updates.forwardPe ?? security.forwardPe,
      pegRatio: updates.pegRatio ?? security.pegRatio,
      refreshedAt: new Date().toISOString(),
    };
    Object.assign(storedSecurity, next);
    Object.assign(security, next);
    return;
  }
  const values = {
    latest_price: latestPrice,
    change_percent: updates.changePercent ?? security.changePercent,
    price_as_on: updates.priceAsOn ?? security.priceAsOn,
    latest_value: latestValue,
    latest_value_inr: latestValueInr,
    refresh_status: updates.refreshStatus ?? security.refreshStatus,
    refresh_note: updates.refreshNote ?? security.refreshNote,
    refreshed_at: new Date().toISOString(),
    price_source: updates.priceSource ?? security.priceSource,
    price_symbol: updates.priceSymbol ?? security.priceSymbol,
    week_52_low: updates.week52Low ?? security.week52Low,
    week_52_high: updates.week52High ?? security.week52High,
    market_data_source: updates.marketDataSource ?? security.marketDataSource,
    market_data_as_on: updates.marketDataAsOn ?? security.marketDataAsOn,
    target_price: updates.targetPrice ?? security.targetPrice,
    target_source: updates.targetSource ?? security.targetSource,
    target_as_on: updates.targetAsOn ?? security.targetAsOn,
    sector: updates.sector ?? security.sector,
    industry: updates.industry ?? security.industry,
    trailing_pe: updates.trailingPe ?? security.trailingPe,
    forward_pe: updates.forwardPe ?? security.forwardPe,
    peg_ratio: updates.pegRatio ?? security.pegRatio,
  };
  await execute(
    `UPDATE securities SET latest_price=?, change_percent=?, price_as_on=?, latest_value=?, latest_value_inr=?,
      refresh_status=?, refresh_note=?, refreshed_at=?, price_source=?, price_symbol=?,
      week_52_low=?,week_52_high=?,market_data_source=?,market_data_as_on=?,
      target_price=?,target_source=?,target_as_on=?,sector=?,industry=?,trailing_pe=?,forward_pe=?,peg_ratio=?
     WHERE id=? AND portfolio_id IN (SELECT id FROM portfolios WHERE user_id=?)`,
    [
      values.latest_price, values.change_percent, values.price_as_on, values.latest_value, values.latest_value_inr,
      values.refresh_status, values.refresh_note, values.refreshed_at, values.price_source,
      values.price_symbol, values.week_52_low, values.week_52_high, values.market_data_source,
      values.market_data_as_on, values.target_price, values.target_source, values.target_as_on,
      values.sector, values.industry, values.trailing_pe, values.forward_pe, values.peg_ratio,
      security.id, userId,
    ],
  );
}

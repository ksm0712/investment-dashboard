import type { AddInvestmentInput, Portfolio, Security } from "./types";
import { toInr } from "./format";
import { getFx } from "./fx";

type Row = Record<string, unknown>;

const demo = {
  nextPortfolioId: 1,
  nextSecurityId: 1,
  portfolios: [] as Portfolio[],
  securities: [] as Security[],
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
  if (typeof value === "number" && Number.isInteger(value)) return { type: "integer", value: String(value) };
  if (typeof value === "number") return { type: "float", value: String(value) };
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

export async function execute(sql: string, params: unknown[] = []) {
  if (!hasTurso()) return { rows: [] as Row[] };
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
  if (!res.ok) throw new Error(`Turso request failed: ${res.status}`);
  const payload = await res.json();
  const first = payload.results?.[0];
  if (first?.type !== "ok") throw new Error(JSON.stringify(first));
  const result = first.response?.result;
  const columns = (result?.cols || []).map((col: any) => col.name);
  const rows = (result?.rows || []).map((row: any[]) =>
    Object.fromEntries(row.map((cell, index) => [columns[index], val(cell)])),
  );
  return { rows: rows as Row[] };
}

let initialized = false;

export async function initDb() {
  if (initialized || !hasTurso()) return;
  initialized = true;
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
}

function mapSecurity(row: Row): Security {
  return {
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
    source: String(row.source || "Investments"),
  };
}

export async function getSecurities(userId: string) {
  await initDb();
  if (!hasTurso()) return [...demo.securities].filter((s) => demo.portfolios.find((p) => p.id === s.portfolioId)?.userId === userId);
  const { rows } = await execute(
    `SELECT s.*, p.name as source, p.date as portfolio_date
     FROM securities s JOIN portfolios p ON s.portfolio_id=p.id
     WHERE p.user_id=?
     ORDER BY p.date DESC, s.id DESC`,
    [userId],
  );
  const seen = new Set<string>();
  const securities: Security[] = [];
  for (const row of rows) {
    const mapped = mapSecurity(row);
    const key = `${mapped.name.trim().toLowerCase()}|${mapped.assetType.toLowerCase()}|${mapped.currency.toUpperCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      securities.push(mapped);
    }
  }
  return securities;
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

export async function addInvestment(userId: string, input: AddInvestmentInput) {
  await initDb();
  const fx = await getFx();
  const today = new Date();
  const portfolioDate = today.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).replaceAll(" ", "-");
  const value = input.quantity * input.currentPrice;
  const valueInr = toInr(value, input.currency, fx);
  const source = input.pricingMode === "auto" && input.assetType === "Mutual Fund" && input.currency === "INR"
    ? "mfapi"
    : input.pricingMode === "auto" ? "yfinance" : "manual";

  if (!hasTurso()) {
    let portfolio = demo.portfolios.find((p) => p.userId === userId && p.name === "Investments");
    if (!portfolio) {
      portfolio = { id: demo.nextPortfolioId++, name: "Investments", date: portfolioDate, userId };
      demo.portfolios.push(portfolio);
    }
    demo.securities.push({
      id: demo.nextSecurityId++,
      portfolioId: portfolio.id,
      name: input.name,
      assetType: input.assetType,
      currency: input.currency,
      value,
      valueInr,
      annualIncome: null,
      returnPct: null,
      quantity: input.quantity,
      ticker: input.priceSymbol || null,
      isin: null,
      priceSource: source,
      priceSymbol: input.priceSymbol || null,
      latestPrice: input.currentPrice,
      priceAsOn: today.toISOString().slice(0, 10),
      latestValue: value,
      latestValueInr: valueInr,
      refreshStatus: input.pricingMode === "auto" ? "needs_refresh" : "manual_value",
      refreshNote: input.pricingMode === "auto" ? "Ready for online price refresh." : "Manual asset. User controls value.",
      refreshedAt: today.toISOString(),
      country: input.country,
      pricingMode: input.pricingMode,
      exchange: input.exchange || null,
      costPrice: input.costPrice,
      purchaseDate: input.purchaseDate,
      source: "Investments",
    });
    return;
  }

  await execute("INSERT OR IGNORE INTO portfolios (name,date,user_id) VALUES (?,?,?)", ["Investments", portfolioDate, userId]);
  const portfolioRows = await execute("SELECT id FROM portfolios WHERE name=? AND date=? AND user_id=?", ["Investments", portfolioDate, userId]);
  const portfolioId = Number(portfolioRows.rows[0]?.id);
  await execute(
    `INSERT INTO securities (portfolio_id,name,asset_type,currency,value,value_inr,quantity,ticker,isin,price_source,
      price_symbol,latest_price,annual_income,return_pct,price_as_on,latest_value,latest_value_inr,refresh_status,
      refresh_note,refreshed_at,country,pricing_mode,exchange,cost_price,purchase_date)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      portfolioId, input.name, input.assetType, input.currency, value, valueInr, input.quantity, input.priceSymbol || null,
      null, source, input.priceSymbol || null, input.currentPrice, null, null, today.toISOString().slice(0, 10),
      value, valueInr, input.pricingMode === "auto" ? "needs_refresh" : "manual_value",
      input.pricingMode === "auto" ? "Ready for online price refresh." : "Manual asset. User controls value.",
      today.toISOString(), input.country, input.pricingMode, input.exchange || null, input.costPrice, input.purchaseDate,
    ],
  );
}

export async function updateSecurity(userId: string, id: number, fields: Partial<Pick<Security, "quantity" | "costPrice" | "latestPrice" | "value" | "purchaseDate">>) {
  await initDb();
  const security = (await getSecurities(userId)).find((s) => s.id === id);
  if (!security) return;
  const quantity = fields.quantity ?? security.quantity ?? 0;
  const latestPrice = fields.latestPrice ?? security.latestPrice ?? 0;
  const nextValue = fields.value ?? (latestPrice && quantity ? latestPrice * quantity : security.latestValue ?? security.value);
  const fxRate = security.value ? security.valueInr / security.value : 1;
  if (!hasTurso()) {
    Object.assign(security, {
      quantity,
      costPrice: fields.costPrice ?? security.costPrice,
      latestPrice,
      latestValue: nextValue,
      latestValueInr: nextValue * fxRate,
      purchaseDate: fields.purchaseDate ?? security.purchaseDate,
      refreshedAt: new Date().toISOString(),
    });
    return;
  }
  await execute(
    `UPDATE securities SET quantity=?, cost_price=?, latest_price=?, latest_value=?, latest_value_inr=?, purchase_date=?, refreshed_at=?
     WHERE id=? AND portfolio_id IN (SELECT id FROM portfolios WHERE user_id=? OR user_id IS NULL)`,
    [quantity, fields.costPrice ?? security.costPrice, latestPrice, nextValue, nextValue * fxRate, fields.purchaseDate ?? security.purchaseDate, new Date().toISOString(), id, userId],
  );
}

export async function deleteSecurity(userId: string, id: number) {
  await initDb();
  if (!hasTurso()) {
    const allowed = new Set(demo.portfolios.filter((p) => p.userId === userId).map((p) => p.id));
    const idx = demo.securities.findIndex((s) => s.id === id && allowed.has(s.portfolioId));
    if (idx >= 0) demo.securities.splice(idx, 1);
    return;
  }
  await execute("DELETE FROM securities WHERE id=? AND portfolio_id IN (SELECT id FROM portfolios WHERE user_id=? OR user_id IS NULL)", [id, userId]);
}

export async function updateRefreshFields(userId: string, id: number, updates: Partial<Security>) {
  const security = (await getSecurities(userId)).find((s) => s.id === id);
  if (!security) return;
  if (!hasTurso()) {
    Object.assign(security, updates, { refreshedAt: new Date().toISOString() });
    return;
  }
  const values = {
    latest_price: updates.latestPrice ?? security.latestPrice,
    price_as_on: updates.priceAsOn ?? security.priceAsOn,
    latest_value: updates.latestValue ?? security.latestValue,
    latest_value_inr: updates.latestValueInr ?? security.latestValueInr,
    refresh_status: updates.refreshStatus ?? security.refreshStatus,
    refresh_note: updates.refreshNote ?? security.refreshNote,
    refreshed_at: new Date().toISOString(),
    price_source: updates.priceSource ?? security.priceSource,
    price_symbol: updates.priceSymbol ?? security.priceSymbol,
  };
  await execute(
    `UPDATE securities SET latest_price=?, price_as_on=?, latest_value=?, latest_value_inr=?,
      refresh_status=?, refresh_note=?, refreshed_at=?, price_source=?, price_symbol=?
     WHERE id=? AND portfolio_id IN (SELECT id FROM portfolios WHERE user_id=? OR user_id IS NULL)`,
    [
      values.latest_price, values.price_as_on, values.latest_value, values.latest_value_inr,
      values.refresh_status, values.refresh_note, values.refreshed_at, values.price_source,
      values.price_symbol, id, userId,
    ],
  );
}

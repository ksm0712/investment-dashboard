"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Plus, Trash2, X } from "lucide-react";
import type { ActionHistoryEntry, AddInvestmentInput, AssetType, SearchResult, Security, User } from "@/lib/types";
import type { PortfolioAction } from "@/lib/portfolio-engine";
import { currencies, marketCurrency, marketExchanges, markets, palette } from "@/lib/constants";
import { fmt, fmtDate, fmtPct, fmtPlain, fmtUnit, fromInr } from "@/lib/format";

type PortfolioPayload = {
  user: User;
  securities: Security[];
  fx: Record<string, number>;
  actionHistory: ActionHistoryEntry[];
};

type RefreshSummary = {
  updated: number;
  unchanged: number;
  manual: number;
  not_refreshed: number;
  failed: number;
  details?: Array<{ name: string; status: string; note: string }>;
  byType?: Record<string, Record<string, number>>;
};

const PORTFOLIO_CACHE_KEY = "investment-dashboard:portfolio:v2";
function readPortfolioCache(): PortfolioPayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(PORTFOLIO_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.user || !Array.isArray(parsed?.securities) || !parsed?.fx) return null;
    return parsed as PortfolioPayload;
  } catch {
    return null;
  }
}

function writePortfolioCache(payload: PortfolioPayload | null) {
  if (typeof window === "undefined") return;
  try {
    if (payload) window.sessionStorage.setItem(PORTFOLIO_CACHE_KEY, JSON.stringify(payload));
    else window.sessionStorage.removeItem(PORTFOLIO_CACHE_KEY);
  } catch {
    // The live API remains the source of truth if browser storage is unavailable.
  }
}

const assetTypes: AssetType[] = ["Stock", "ETF", "Mutual Fund", "Bond", "Savings", "Other"];

function googleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.35-8.16 2.35-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  );
}

function Login() {
  return (
    <main className="login-page">
      <div className="login-card">
        <div className="login-title">Investments</div>
        <div className="login-subtitle">Portfolio Tracker</div>
        <a className="google-login-btn" href="/api/auth/google">
          {googleIcon()}
          Continue with Google
        </a>
        <div className="login-note">
          Your data is private to your account.<br />Sign in to access your portfolio.
        </div>
      </div>
    </main>
  );
}

function metricStats(securities: Security[], fx: Record<string, number>) {
  const totalInr = securities.reduce((sum, s) => sum + (s.latestValueInr ?? s.valueInr ?? 0), 0);
  const costInr = securities.reduce((sum, s) => sum + ((s.investedCost || 0) * (fx[s.currency] || 1)), 0);
  const gainInr = totalInr - costInr;
  const gainPct = costInr ? (gainInr / costInr) * 100 : null;
  const income = securities.reduce((sum, s) => sum + (s.annualIncome || 0), 0);
  const yieldPct = totalInr && income ? (income / totalInr) * 100 : null;
  return { totalInr, costInr, gainInr, gainPct, income, yieldPct };
}

function groupBy<T extends string>(securities: Security[], key: (s: Security) => T) {
  const map = new Map<T, Security[]>();
  for (const sec of securities) {
    const k = key(sec);
    map.set(k, [...(map.get(k) || []), sec]);
  }
  return [...map.entries()];
}

function AllocationPanel({ title, securities, by, totalInr, fx, currency }: {
  title: string;
  securities: Security[];
  by: "assetType" | "country";
  totalInr: number;
  fx: Record<string, number>;
  currency: string;
}) {
  const [open, setOpen] = useState(true);
  const rows = groupBy(securities, (s) => (by === "assetType" ? s.assetType : s.country))
    .map(([name, items]) => ({ name, valueInr: items.reduce((sum, item) => sum + (item.latestValueInr ?? item.valueInr), 0), count: items.length }))
    .sort((a, b) => b.valueInr - a.valueInr);
  return (
    <div className="panel">
      <button type="button" className="panel-title panel-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span>{title}</span>
        <ChevronDown size={16} strokeWidth={2.4} className={`panel-chevron ${open ? "open" : ""}`} />
      </button>
      {open && (
        <div className="panel-body">
          {rows.length === 0 ? <div className="alloc-meta">No data yet</div> : rows.map((row, index) => {
            const pct = totalInr ? (row.valueInr / totalInr) * 100 : 0;
            const color = palette[index % palette.length];
            return (
              <div className="alloc-row" key={row.name}>
                <div>
                  <div className="alloc-name-line">
                    <span className="alloc-dot" style={{ background: color }} />
                    <span className="alloc-name">{row.name}</span>
                  </div>
                  <div className="alloc-meta">{row.count} holdings</div>
                </div>
                <div>
                  <div className="alloc-value-line">
                    <span className="alloc-value">{fmt(fromInr(row.valueInr, currency, fx), currency)}</span>
                    <span className="alloc-pct">{pct.toFixed(1)}%</span>
                  </div>
                  <div className="alloc-track"><div className="alloc-fill" style={{ width: `${Math.min(pct, 100)}%`, background: color }} /></div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AddInvestmentModal({ fx, onClose, onSaved }: { fx: Record<string, number>; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [assetType, setAssetType] = useState<AssetType>("Stock");
  const [country, setCountry] = useState("India");
  const [identifierType, setIdentifierType] = useState("Ticker");
  const [ticker, setTicker] = useState("");
  const [exchange, setExchange] = useState("NSE");
  const [quantity, setQuantity] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [currentPrice, setCurrentPrice] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().slice(0, 10));
  const [allocation, setAllocation] = useState("");
  const [targetPrice, setTargetPrice] = useState("");
  const [targetSource, setTargetSource] = useState("");
  const [targetAsOn, setTargetAsOn] = useState("");
  const [week52Low, setWeek52Low] = useState("");
  const [week52High, setWeek52High] = useState("");
  const [priceSource, setPriceSource] = useState("");
  const [priceAsOn, setPriceAsOn] = useState("");
  const [matches, setMatches] = useState<SearchResult[]>([]);
  const [matchIndex, setMatchIndex] = useState("");
  const [busy, setBusy] = useState(false);
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [error, setError] = useState("");
  const [searchNotice, setSearchNotice] = useState("");
  const localSearchCache = useRef<Record<string, SearchResult[]>>({});
  const quoteCache = useRef<Record<string, Record<string, unknown>>>({});
  const quoteRequestId = useRef(0);

  const exchanges = marketExchanges[country] || ["Other"];

  useEffect(() => {
    if (!exchanges.includes(exchange)) setExchange(exchanges[0]);
  }, [country, exchanges, exchange]);

  async function search() {
    const key = name.trim().toLowerCase();
    if (!key) {
      setMatches([]);
      setSearchNotice("");
      return;
    }
    if (localSearchCache.current[key]) {
      const cachedResults = localSearchCache.current[key];
      setMatches(cachedResults);
      setMatchIndex("");
      setSearchNotice(cachedResults.length ? "" : `No matches found for "${name.trim()}". Try the ticker or full asset name.`);
      return;
    }
    setError("");
    setSearchNotice("");
    try {
      setBusy(true);
      const res = await fetch(`/api/search?q=${encodeURIComponent(name.trim())}`);
      const data = await res.json();
      const results = data.results || [];
      localSearchCache.current[key] = results;
      setMatchIndex("");
      setMatches(results);
      setSearchNotice(results.length ? "" : `No matches found for "${name.trim()}". Try the ticker or full asset name.`);
    } catch {
      setMatches([]);
      setSearchNotice("");
      setError("Search could not load results. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function fetchCurrentPrice(match: SearchResult) {
    if (!["Stock", "ETF", "Mutual Fund"].includes(match.assetType)) return;
    const currency = marketCurrency[match.country] || "USD";
    const key = `${match.assetType}|${match.ticker}|${currency}`;
    function applyQuote(quote: Record<string, unknown>) {
      const price = Number(quote.price);
      if (Number.isFinite(price) && price > 0) setCurrentPrice(String(Number(price.toFixed(6))));
      const target = Number(quote.targetPrice);
      setTargetPrice(Number.isFinite(target) && target > 0 ? String(Number(target.toFixed(6))) : "");
      setTargetSource(String(quote.targetSource || ""));
      setTargetAsOn(String(quote.targetAsOn || ""));
      const low = Number(quote.week52Low);
      const high = Number(quote.week52High);
      setWeek52Low(Number.isFinite(low) && low > 0 ? String(Number(low.toFixed(6))) : "");
      setWeek52High(Number.isFinite(high) && high > 0 ? String(Number(high.toFixed(6))) : "");
      setPriceSource(String(quote.source || ""));
      setPriceAsOn(String(quote.date || ""));
    }
    if (quoteCache.current[key]) {
      applyQuote(quoteCache.current[key]);
      return;
    }
    const requestId = ++quoteRequestId.current;
    try {
      setQuoteBusy(true);
      const res = await fetch("/api/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: match.name,
          assetType: match.assetType,
          country: match.country,
          currency,
          ticker: match.ticker,
          exchange: match.exchange,
          identifierType: match.identifierType,
        }),
      });
      const data = await res.json();
      if (res.ok && data.quote) {
        quoteCache.current[key] = data.quote;
        if (requestId === quoteRequestId.current) applyQuote(data.quote);
      }
    } finally {
      if (requestId === quoteRequestId.current) setQuoteBusy(false);
    }
  }

  function applyMatch(indexValue: string) {
    setMatchIndex(indexValue);
    const match = matches[Number(indexValue)];
    if (!match) return;
    setName(match.name);
    setAssetType(match.assetType);
    setCountry(match.country);
    setTicker(match.ticker);
    setExchange(match.exchange || (marketExchanges[match.country] || ["Other"])[0]);
    setIdentifierType(match.identifierType);
    setCurrentPrice("");
    setTargetPrice("");
    setTargetSource("");
    setTargetAsOn("");
    setWeek52Low("");
    setWeek52High("");
    setPriceSource("");
    setPriceAsOn("");
    fetchCurrentPrice(match);
  }

  async function save() {
    setError("");
    const q = Number(quantity);
    const c = Number(costPrice);
    const p = Number(currentPrice);
    if (!name.trim() || !country.trim()) return setError("Add the asset name and market / country.");
    if (["Stock", "ETF", "Mutual Fund"].includes(assetType) && !ticker.trim()) return setError("Add the identifier for this asset.");
    if (!q || q <= 0) return setError("Add quantity bought.");
    if (!c || c <= 0) return setError("Add cost price.");
    if (!p || p <= 0) return setError("Add current price.");
    const currency = marketCurrency[country] || "USD";
    const input: AddInvestmentInput = {
      name: name.trim(),
      assetType,
      country,
      currency,
      pricingMode: ["Stock", "ETF", "Mutual Fund"].includes(assetType) ? "auto" : "manual",
      quantity: q,
      costPrice: c,
      currentPrice: p,
      priceSymbol: ticker.trim(),
      priceSource: priceSource || null,
      priceAsOn: priceAsOn || null,
      exchange,
      purchaseDate,
      allocation: allocation ? Number(allocation) : null,
      targetPrice: targetPrice ? Number(targetPrice) : null,
      targetSource: targetSource || (targetPrice ? "manual" : null),
      targetAsOn: targetAsOn || (targetPrice ? new Date().toISOString().slice(0, 10) : null),
      week52Low: week52Low ? Number(week52Low) : null,
      week52High: week52High ? Number(week52High) : null,
    };
    try {
      setBusy(true);
      const res = await fetch("/api/investments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        return setError(data?.error || "Could not save investment. Please try again.");
      }
      onSaved();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-head">
          <div className="modal-title">Add Investment</div>
          <button className="x-btn" onClick={onClose} aria-label="Close"><X size={26} /></button>
        </div>
        <div className="slabel">Add Investment</div>
        <div className="form-section-title">Asset</div>
        <div className="search-line">
          <div className="field">
            <label>Asset name</label>
            <input value={name} onChange={(e) => { setName(e.target.value); setMatches([]); setMatchIndex(""); setSearchNotice(""); }} placeholder="Apple Inc, UTI Nifty 50 Index Fund, DBS Savings" />
          </div>
          <button type="button" className="search-btn" onClick={search} disabled={busy}>{busy ? "Searching..." : "Search"}</button>
        </div>
        {(busy || quoteBusy) && <div className="busy-note">{busy ? "Searching..." : "Fetching current price..."}</div>}
        {searchNotice && <div className="search-note">{searchNotice}</div>}
        {matches.length > 0 && (
          <select className="matches" value={matchIndex} onChange={(e) => applyMatch(e.target.value)}>
            <option value="">Select an asset to fill details</option>
            {matches.map((match, index) => <option key={`${match.ticker}-${index}`} value={index}>{match.label}</option>)}
          </select>
        )}
        {matchIndex !== "" && <div className="form-hint">Autofilled — edit any field below if needed</div>}
        <div className="form-grid grid-3" style={{ marginTop: 18 }}>
          <div className="field">
            <label>Asset type</label>
            <select value={assetType} onChange={(e) => setAssetType(e.target.value as AssetType)}>{assetTypes.map((type) => <option key={type}>{type}</option>)}</select>
          </div>
          <div className="field">
            <label>Market / country</label>
            <select value={country} onChange={(e) => setCountry(e.target.value)}>{markets.map((market) => <option key={market}>{market}</option>)}</select>
          </div>
          <div className="field">
            <label>Currency</label>
            <input value={marketCurrency[country] || "USD"} readOnly />
          </div>
        </div>
        <div className="form-section-title">Identifier</div>
        {["Stock", "ETF", "Mutual Fund", "Bond"].includes(assetType) ? (
          <div className="form-grid grid-3">
            <div className="field">
              <label>Identifier type</label>
              <select value={identifierType} onChange={(e) => setIdentifierType(e.target.value)}>
                {(assetType === "Mutual Fund" ? ["Scheme code", "ISIN"] : assetType === "Bond" ? ["None", "ISIN"] : ["Ticker", "ISIN"]).map((type) => <option key={type}>{type}</option>)}
              </select>
            </div>
            <div className="field">
              <label>{identifierType}</label>
              <input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder={identifierType === "Ticker" ? "AAPL, VOO, D05" : "US0378331005"} />
            </div>
            <div className="field">
              <label>Exchange</label>
              <select value={exchange} onChange={(e) => setExchange(e.target.value)}>{exchanges.map((item) => <option key={item}>{item}</option>)}</select>
            </div>
          </div>
        ) : <div className="alloc-meta">No ticker or scheme code needed for this asset type.</div>}
        <div className="form-section-title">Position</div>
        <div className="form-grid grid-4">
          <div className="field"><label>Quantity bought</label><input value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="1.000000" /></div>
          <div className="field"><label>Cost price</label><input value={costPrice} onChange={(e) => setCostPrice(e.target.value)} placeholder="100.00" /></div>
          <div className="field"><label>Date bought</label><input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} /></div>
          <div className="field"><label>Current price</label><input value={currentPrice} onChange={(e) => { setCurrentPrice(e.target.value); setPriceSource("manual"); setPriceAsOn(new Date().toISOString().slice(0, 10)); }} placeholder="150.00" /></div>
        </div>
        <div className="form-section-title">Strategy</div>
        <div className="form-grid grid-4">
          <div className="field"><label>Allocation limit</label><input value={allocation} onChange={(e) => setAllocation(e.target.value)} placeholder="50000" /></div>
          <div className="field"><label>Analyst target</label><input value={targetPrice} onChange={(e) => { setTargetPrice(e.target.value); setTargetSource("manual"); setTargetAsOn(new Date().toISOString().slice(0, 10)); }} placeholder={quoteBusy ? "Fetching…" : "Auto-filled when available"} /></div>
          <div className="field"><label>52-week low</label><input value={week52Low} readOnly placeholder="Auto-filled" /></div>
          <div className="field"><label>52-week high</label><input value={week52High} readOnly placeholder="Auto-filled" /></div>
        </div>
        {targetPrice && <div className="provider-note">Target source: {targetSource || "manual"}{targetAsOn ? ` · ${fmtDate(targetAsOn)}` : ""}</div>}
        {error && <div className="bad" style={{ marginTop: 14, fontWeight: 700 }}>{error}</div>}
        <button type="button" className="save-btn" style={{ marginTop: 20, width: 190 }} onClick={save}>Save Investment</button>
      </div>
    </div>
  );
}

function marketFreshness(item: Security) {
  const raw = item.marketDataAsOn || item.priceAsOn || item.refreshedAt;
  if (!raw) return { label: "No date", className: "missing" };
  const timestamp = new Date(raw).getTime();
  if (!Number.isFinite(timestamp)) return { label: "Unknown", className: "missing" };
  const ageDays = Math.max(0, (Date.now() - timestamp) / 86_400_000);
  if (ageDays <= 3) return { label: "Fresh", className: "fresh" };
  if (ageDays <= 7) return { label: "Aging", className: "aging" };
  return { label: "Stale", className: "stale" };
}

function Holdings({ securities, totalInr, actionHistory, reload }: {
  securities: Security[];
  totalInr: number;
  actionHistory: ActionHistoryEntry[];
  reload: () => void;
}) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState<number | null>(null);
  const [lotDraft, setLotDraft] = useState<Record<string, string>>({ purchaseDate: new Date().toISOString().slice(0, 10) });
  const [editingLot, setEditingLot] = useState<number | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<Record<number, { targetPrice: string; allocation: string }>>({});
  const [message, setMessage] = useState<Record<number, string>>({});
  const rows = [...securities].sort((a, b) => (b.latestValueInr ?? b.valueInr) - (a.latestValueInr ?? a.valueInr));

  function ratio(value: number | null, signed = false) {
    return fmtPct(value === null ? null : value * 100, signed);
  }

  function toggle(id: number) {
    setExpanded((current) => current.has(id) ? new Set() : new Set([id]));
    setEditingLot(null);
    setLotDraft({ purchaseDate: new Date().toISOString().slice(0, 10) });
  }

  async function removeAsset(id: number) {
    await fetch(`/api/investments/${id}`, { method: "DELETE" });
    setDeleting(null);
    await reload();
  }

  async function saveSettings(item: Security) {
    const draft = settingsDraft[item.id] || { targetPrice: String(item.targetPrice || ""), allocation: String(item.allocation || "") };
    const targetPrice = Number(draft.targetPrice);
    const allocation = Number(draft.allocation);
    const res = await fetch(`/api/investments/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetPrice: Number.isFinite(targetPrice) && targetPrice > 0 ? targetPrice : undefined,
        targetSource: Number.isFinite(targetPrice) && targetPrice > 0 ? "manual" : undefined,
        targetAsOn: Number.isFinite(targetPrice) && targetPrice > 0 ? new Date().toISOString().slice(0, 10) : undefined,
        allocation: Number.isFinite(allocation) && allocation >= 0 ? allocation : undefined,
      }),
    });
    setMessage((current) => ({ ...current, [item.id]: res.ok ? "Strategy settings saved." : "Could not save strategy settings." }));
    if (res.ok) await reload();
  }

  async function saveLot(item: Security) {
    const quantity = Number(lotDraft.quantity);
    const costPrice = Number(lotDraft.costPrice);
    const fees = Number(lotDraft.fees || 0);
    if (!(quantity > 0) || !(costPrice >= 0) || !(fees >= 0)) {
      setMessage((current) => ({ ...current, [item.id]: "Enter a positive quantity and valid cost values." }));
      return;
    }
    const url = editingLot ? `/api/lots/${editingLot}` : `/api/investments/${item.id}/lots`;
    const res = await fetch(url, {
      method: editingLot ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quantity, costPrice, fees, purchaseDate: lotDraft.purchaseDate || null }),
    });
    if (res.ok) {
      setEditingLot(null);
      setLotDraft({ purchaseDate: new Date().toISOString().slice(0, 10) });
      setMessage((current) => ({ ...current, [item.id]: "Purchase lots updated and asset totals recalculated." }));
      await reload();
    } else {
      const data = await res.json().catch(() => null);
      setMessage((current) => ({ ...current, [item.id]: data?.error || "Could not save purchase lot." }));
    }
  }

  async function removeLot(item: Security, lotId: number) {
    const res = await fetch(`/api/lots/${lotId}`, { method: "DELETE" });
    if (res.ok) {
      setMessage((current) => ({ ...current, [item.id]: "Purchase lot deleted and totals recalculated." }));
      await reload();
    }
  }

  function beginLotEdit(lot: Security["lots"][number]) {
    setEditingLot(lot.id);
    setLotDraft({
      quantity: String(lot.quantity),
      costPrice: String(lot.costPrice),
      fees: String(lot.fees || ""),
      purchaseDate: lot.purchaseDate || "",
    });
  }

  if (!rows.length) return <div className="alloc-meta">No holdings.</div>;
  return (
    <div className="holdings">
      <div className="holding-head intelligence-head">
        <span>Security</span><span>Action</span><span>Market</span><span>Target</span><span>Value</span><span className="hide-mobile">Cost</span><span className="hide-mobile">Gain/Loss</span><span className="hide-mobile">Gain %</span><span className="hide-mobile">Updated</span><span /><span />
      </div>
      {rows.map((item) => {
        const isOpen = expanded.has(item.id);
        const valueInr = item.latestValueInr ?? item.valueInr;
        const pct = totalInr ? (valueInr / totalInr) * 100 : 0;
        const settings = settingsDraft[item.id] || { targetPrice: String(item.targetPrice || ""), allocation: String(item.allocation || "") };
        const actionClass = item.action.toLowerCase().replaceAll(" ", "-");
        const freshness = marketFreshness(item);
        const itemHistory = actionHistory.filter((entry) => entry.securityId === item.id).slice(0, 5);
        const metrics = [
          ["52-week low", fmtUnit(item.week52Low, item.currency)],
          ["% above 52-week low", ratio(item.pctAbove52WeekLow, true)],
          ["52-week high", fmtUnit(item.week52High, item.currency)],
          ["% below 52-week high", ratio(item.pctBelow52WeekHigh)],
          ["Price to target", ratio(item.priceToTarget, true)],
          ["Average purchase", fmtUnit(item.averagePurchasePrice, item.currency)],
          ["Lowest purchase", fmtUnit(item.lowestPurchasePrice, item.currency)],
          ["Allocation", fmt(item.allocation, item.currency)],
          ["Remaining allocation", fmt(item.allocationRemaining, item.currency)],
          ["Aggressive sell trigger", fmtUnit(item.aggressiveSellTrigger, item.currency)],
          ["% above aggressive", ratio(item.pctAboveAggressiveTrigger, true)],
          ["Conservative sell trigger", fmtUnit(item.conservativeSellTrigger, item.currency)],
          ["% above conservative", ratio(item.pctAboveConservativeTrigger, true)],
        ];
        return (
          <div key={item.id} className="asset-record">
            <div className={`holding-row intelligence-row ${isOpen ? "open" : ""}`}>
              <button className="asset-toggle" onClick={() => toggle(item.id)} aria-expanded={isOpen}>
                <ChevronDown size={16} className={`asset-chevron ${isOpen ? "open" : ""}`} />
                <span><span className="h-name">{item.name}</span><span className="h-sub">{item.assetType} · {item.priceSymbol || item.ticker || item.exchange || item.country} · {fmtPlain(item.sharesHeld, 2)} shares · {pct.toFixed(1)}%</span></span>
              </button>
              <div className="h-cell"><span className={`action-badge ${actionClass}`}>{item.action}</span></div>
              <div className="h-cell h-num">{fmtUnit(item.latestPrice, item.currency)}</div>
              <div className="h-cell h-num">{fmtUnit(item.targetPrice, item.currency)}</div>
              <div className="h-cell h-num h-value">{fmt(item.marketValue, item.currency)}</div>
              <div className="h-cell h-num hide-mobile">{fmt(item.investedCost, item.currency)}</div>
              <div className={`h-cell h-num hide-mobile ${(item.gainLoss || 0) >= 0 ? "good" : "bad"}`}>{fmt(item.gainLoss, item.currency)}</div>
              <div className={`h-cell h-num hide-mobile ${(item.gainPct || 0) >= 0 ? "good" : "bad"}`}>{ratio(item.gainPct, true)}</div>
              <div className="h-cell h-updated hide-mobile"><span className={`freshness-pill ${freshness.className}`}>{freshness.label}</span><small>{fmtDate(item.marketDataAsOn || item.refreshedAt || item.priceAsOn)}</small></div>
              <button className="table-btn" onClick={() => toggle(item.id)}>{isOpen ? "Close" : "Details"}</button>
              <button className="icon-btn danger" aria-label={`Delete ${item.name}`} onClick={() => setDeleting(deleting === item.id ? null : item.id)}><Trash2 size={15} /></button>
            </div>

            {deleting === item.id && <div className="delete-panel"><b>Delete {item.name} and all its purchase lots?</b> This cannot be undone. <button className="table-btn danger" style={{ width: 90, marginLeft: 12 }} onClick={() => removeAsset(item.id)}>Delete</button> <button className="table-btn" style={{ width: 90 }} onClick={() => setDeleting(null)}>Cancel</button></div>}

            {isOpen && (
              <div className="intelligence-panel">
                <div className="intelligence-title-row">
                  <div><div className="intelligence-title">Investment Intelligence</div><div className="intelligence-source">Market: {item.marketDataSource || item.priceSource || "—"} · Target: {item.targetSource || "not available"}{item.targetAsOn ? ` · ${fmtDate(item.targetAsOn)}` : ""}</div></div>
                  <span className={`action-badge large ${actionClass}`}>{item.action}</span>
                </div>
                <div className="action-explanation">{item.actionReasons.map((reason) => <span key={reason}>{reason}</span>)}</div>
                <div className="metric-grid">{metrics.map(([label, value]) => <div className="metric-card" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>

                <div className="detail-section">
                  <div className="detail-section-head"><div><h3>Action history</h3><p>A new entry is saved only when the Excel-based recommendation changes.</p></div><span>{itemHistory.length ? `${itemHistory.length} recent` : "No changes yet"}</span></div>
                  {itemHistory.length > 0 ? (
                    <div className="history-list">
                      {itemHistory.map((entry) => (
                        <div className="history-row" key={entry.id}>
                          <span className="history-dot" />
                          <div><strong>{entry.previousAction ? `${entry.previousAction} → ${entry.action}` : entry.action}</strong><small>{entry.reasons[0] || "Initial recommendation recorded."}</small></div>
                          <div className="history-meta"><strong>{fmtUnit(entry.currentPrice, item.currency)}</strong><small>{fmtDate(entry.recordedAt)}</small></div>
                        </div>
                      ))}
                    </div>
                  ) : <div className="empty-history">The first recommendation will be recorded automatically.</div>}
                </div>

                <div className="detail-section">
                  <div className="detail-section-head"><div><h3>Strategy settings</h3><p>The API target updates automatically. Saving a target here creates an explicit manual override.</p></div></div>
                  <div className="compact-form">
                    <label>Target price<input value={settings.targetPrice} onChange={(e) => setSettingsDraft((current) => ({ ...current, [item.id]: { ...settings, targetPrice: e.target.value } }))} /></label>
                    <label>Allocation limit<input value={settings.allocation} onChange={(e) => setSettingsDraft((current) => ({ ...current, [item.id]: { ...settings, allocation: e.target.value } }))} /></label>
                    <button className="table-btn save-inline" onClick={() => saveSettings(item)}>Save strategy</button>
                  </div>
                </div>

                <div className="detail-section">
                  <div className="detail-section-head"><div><h3>Purchase lots</h3><p>Each purchase is stored separately; totals and actions are calculated for the asset as a whole.</p></div><span>{item.lots.length} lot{item.lots.length === 1 ? "" : "s"}</span></div>
                  <div className="lots-table">
                    <div className="lot-row lot-head"><span>Date</span><span>Quantity</span><span>Cost price</span><span>Fees</span><span>Cost value</span><span /><span /></div>
                    {item.lots.map((lot) => <div className="lot-row" key={lot.id}><span>{fmtDate(lot.purchaseDate)}</span><span>{fmtPlain(lot.quantity, 4)}</span><span>{fmtUnit(lot.costPrice, item.currency)}</span><span>{fmtUnit(lot.fees, item.currency)}</span><strong>{fmt(lot.quantity * lot.costPrice + lot.fees, item.currency)}</strong><button className="table-btn" onClick={() => beginLotEdit(lot)}>Edit</button><button className="icon-btn danger" aria-label="Delete purchase lot" onClick={() => removeLot(item, lot.id)}><Trash2 size={14} /></button></div>)}
                    {!item.lots.length && <div className="empty-lots">No purchase lots yet. Add the first purchase below.</div>}
                  </div>
                  <div className="compact-form lot-form">
                    <label>Purchase date<input type="date" value={lotDraft.purchaseDate || ""} onChange={(e) => setLotDraft({ ...lotDraft, purchaseDate: e.target.value })} /></label>
                    <label>Quantity<input value={lotDraft.quantity || ""} onChange={(e) => setLotDraft({ ...lotDraft, quantity: e.target.value })} placeholder="10" /></label>
                    <label>Cost price<input value={lotDraft.costPrice || ""} onChange={(e) => setLotDraft({ ...lotDraft, costPrice: e.target.value })} placeholder="100.00" /></label>
                    <label>Fees<input value={lotDraft.fees || ""} onChange={(e) => setLotDraft({ ...lotDraft, fees: e.target.value })} placeholder="0.00" /></label>
                    <button className="table-btn save-inline" onClick={() => saveLot(item)}><Plus size={14} /> {editingLot ? "Update lot" : "Add lot"}</button>
                    {editingLot && <button className="table-btn" onClick={() => { setEditingLot(null); setLotDraft({ purchaseDate: new Date().toISOString().slice(0, 10) }); }}>Cancel</button>}
                  </div>
                </div>
                {message[item.id] && <div className="inline-message">{message[item.id]}</div>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function Page() {
  const [data, setData] = useState<PortfolioPayload | null>(null);
  const [loginChecked, setLoginChecked] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [tab, setTab] = useState("All");
  const [currency, setCurrency] = useState<Record<string, string>>({ All: "USD" });
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<RefreshSummary | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState<"All" | PortfolioAction>("All");
  const [holdingQuery, setHoldingQuery] = useState("");

  async function load() {
    try {
      const res = await fetch("/api/portfolio", { cache: "no-store" });
      if (res.status === 401) {
        writePortfolioCache(null);
        setData(null);
        setLoginChecked(true);
        return;
      }
      const next = await res.json();
      writePortfolioCache(next);
      setData(next);
    } finally {
      setLoginChecked(true);
    }
  }

  useEffect(() => {
    const cached = readPortfolioCache();
    if (cached) {
      setData(cached);
      setLoginChecked(true);
    }
    load();
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    writePortfolioCache(null);
    setData(null);
  }

  async function refresh() {
    setLoading(true);
    setSummary(null);
    try {
      const res = await fetch(`/api/refresh?ts=${Date.now()}`, { method: "POST", cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not refresh prices.");
      setSummary(json.summary);
      setLastRefreshedAt(new Date().toISOString());
      if (json.securities && data) {
        setData((prev) => {
          const next = prev ? { ...prev, securities: json.securities, fx: json.fx || prev.fx, actionHistory: json.actionHistory || prev.actionHistory || [] } : prev;
          writePortfolioCache(next);
          return next;
        });
      } else {
        await load();
      }
    } catch (error) {
      const note = error instanceof Error ? error.message : "Could not refresh prices.";
      setSummary({ updated: 0, unchanged: 0, manual: 0, not_refreshed: 0, failed: 1, details: [{ name: "Refresh", status: "failed", note }] });
    } finally {
      setLoading(false);
    }
  }

  const securities = data?.securities || [];
  const fx = data?.fx || { INR: 1, USD: 83.5 };
  const countries = useMemo(() => [...new Set(securities.map((s) => s.country))].sort(), [securities]);
  const countryVisible = tab === "All" ? securities : securities.filter((s) => s.country === tab);
  const visible = countryVisible.filter((security) => {
    const matchesAction = actionFilter === "All" || security.action === actionFilter;
    const needle = holdingQuery.trim().toLowerCase();
    const matchesQuery = !needle || [security.name, security.priceSymbol, security.ticker, security.assetType, security.country]
      .some((value) => String(value || "").toLowerCase().includes(needle));
    return matchesAction && matchesQuery;
  });
  const stats = metricStats(countryVisible, fx);
  const currentCurrency = currency[tab] || (tab === "All" ? "USD" : marketCurrency[tab] || countryVisible[0]?.currency || "USD");
  const actionOptions: Array<"All" | PortfolioAction> = ["All", "Sell", "Review to Sell", "Buy", "Review to Buy", "Continue to Monitor", "Insufficient Data"];
  const actionCounts = new Map(actionOptions.map((action) => [action, action === "All" ? countryVisible.length : countryVisible.filter((security) => security.action === action).length]));
  const attentionCount = countryVisible.filter((security) => ["Sell", "Review to Sell", "Buy", "Review to Buy"].includes(security.action)).length;
  const recentChanges = (data?.actionHistory || []).filter((entry) => entry.previousAction).slice(0, 3);

  useEffect(() => {
    if (tab !== "All" && !currency[tab]) setCurrency((prev) => ({ ...prev, [tab]: marketCurrency[tab] || countryVisible[0]?.currency || "USD" }));
  }, [tab, currency, countryVisible]);

  if (!loginChecked) return <main className="login-page"><div className="login-card"><div className="login-title">Investments</div></div></main>;
  if (!data) return <Login />;

  const refreshedAtText = lastRefreshedAt ? new Date(lastRefreshedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "";
  const refreshText = summary ? [
    `Prices refreshed${refreshedAtText ? ` at ${refreshedAtText}` : ""}`,
    `${summary.updated || 0} updated`,
    summary.unchanged ? `${summary.unchanged} unchanged` : "",
    summary.manual ? `${summary.manual} manual` : "",
    summary.not_refreshed ? `${summary.not_refreshed} need setup` : "",
    summary.failed ? `${summary.failed} failed` : "",
  ].filter(Boolean).join(" · ") : "";
  const refreshDetails = summary?.details?.length ? summary.details.map((item) => `${item.name}: ${item.note}`).join(" · ") : "";

  return (
    <main className="page">
      <nav className="topnav">
        <div className="brand"><div className="brand-name">Investments</div></div>
        <div className="actions">
          <button className="primary-btn" onClick={() => setModalOpen(true)}>＋ Add Investment</button>
          <div className="profile-chip" title={data.user.email || data.user.name || "Signed in user"}>
            {data.user.picture ? (
              <img className="profile-pic" src={data.user.picture} alt={data.user.name || data.user.email || "Signed in user"} referrerPolicy="no-referrer" />
            ) : (
              <div className="profile-fallback">{(data.user.name || data.user.email || "U").charAt(0).toUpperCase()}</div>
            )}
          </div>
          <button className="ghost-btn" onClick={logout}>Sign out</button>
        </div>
      </nav>

      {securities.length === 0 ? (
        <div className="empty"><div className="empty-icon">📂</div><div className="empty-title">No investments yet</div><div className="empty-sub">Click <b style={{ color: "#2563eb" }}>＋ Add Investment</b> above to get started</div></div>
      ) : (
        <>
          <div className="control-row"><button className="refresh-btn" onClick={refresh} disabled={loading}>{loading ? "Refreshing..." : "Refresh Prices"}</button>{refreshText && <span className="refresh-results">{refreshText}{refreshDetails ? ` (${refreshDetails})` : ""}</span>}</div>
          <div className="tabs">{["All", ...countries].map((item) => <button key={item} className={`tab ${tab === item ? "on" : ""}`} onClick={() => setTab(item)}>{item}</button>)}</div>
          <div className="select-row"><div className="select-wrap"><label>View in currency</label><select value={currentCurrency} onChange={(e) => setCurrency({ ...currency, [tab]: e.target.value })}>{currencies.map((cur) => <option key={cur}>{cur}</option>)}</select></div></div>
          <section className="register-strip">
            <div className="register-metric"><div className="register-metric-label">{tab === "All" ? "Total Portfolio" : "Market Value"}</div><div className="register-metric-value">{fmt(fromInr(stats.totalInr, currentCurrency, fx), currentCurrency)}</div></div>
            <div className="register-metric"><div className="register-metric-label">Total Cost</div><div className="register-metric-value">{stats.costInr ? fmt(fromInr(stats.costInr, currentCurrency, fx), currentCurrency) : "—"}</div></div>
            <div className="register-metric"><div className="register-metric-label">Gain / Loss</div><div className={`register-metric-value ${(stats.gainPct || 0) >= 0 ? "good" : "bad"}`}>{stats.costInr ? fmt(fromInr(stats.gainInr, currentCurrency, fx), currentCurrency) : "—"}</div></div>
            <div className="register-metric"><div className="register-metric-label">Gain %</div><div className={`register-metric-value ${(stats.gainPct || 0) >= 0 ? "good" : "bad"}`}>{fmtPct(stats.gainPct)}</div></div>
            <div className="register-metric"><div className="register-metric-label">Annual Income</div><div className="register-metric-value">{stats.income ? fmt(fromInr(stats.income, currentCurrency, fx), currentCurrency) : "—"}</div></div>
            <div className="register-metric"><div className="register-metric-label">Yield</div><div className="register-metric-value">{fmtPct(stats.yieldPct)}</div></div>
          </section>
          <section className="decision-center">
            <div className="decision-copy"><span className="eyebrow">Decision center</span><h2>{attentionCount ? `${attentionCount} holding${attentionCount === 1 ? "" : "s"} need attention` : "Your portfolio is in monitoring mode"}</h2><p>Recommendations update from live price, 52-week range, analyst target, allocation, and every purchase lot.</p></div>
            <div className="decision-status"><span>Automatic refresh</span><strong>Daily · 10:00 SGT</strong></div>
          </section>
          {recentChanges.length > 0 && <section className="change-strip"><div><span className="eyebrow">Recent changes</span>{recentChanges.map((entry) => <span className="change-item" key={entry.id}><strong>{entry.securityName}</strong> {entry.previousAction} → {entry.action}</span>)}</div></section>}
          <section className="action-toolbar">
            <div className="action-filters">{actionOptions.map((action) => <button key={action} className={`action-filter ${actionFilter === action ? "on" : ""}`} onClick={() => setActionFilter(action)}><span>{action}</span><strong>{actionCounts.get(action) || 0}</strong></button>)}</div>
            <input className="holding-search" aria-label="Search holdings" placeholder="Search holdings" value={holdingQuery} onChange={(event) => setHoldingQuery(event.target.value)} />
          </section>
          <section className="panel-grid"><AllocationPanel title="Asset Allocation" securities={countryVisible} by="assetType" totalInr={stats.totalInr} fx={fx} currency={currentCurrency} />{tab === "All" && <AllocationPanel title="By Country" securities={countryVisible} by="country" totalInr={stats.totalInr} fx={fx} currency={currentCurrency} />}</section>
          <div className="slabel">Holdings <span className="result-count">{visible.length} of {countryVisible.length}</span></div>
          <Holdings securities={visible} totalInr={stats.totalInr} actionHistory={data.actionHistory || []} reload={load} />
        </>
      )}
      {modalOpen && <AddInvestmentModal fx={fx} onClose={() => setModalOpen(false)} onSaved={load} />}
    </main>
  );
}

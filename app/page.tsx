"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import type { AddInvestmentInput, AssetType, SearchResult, Security, User } from "@/lib/types";
import { currencies, marketCurrency, marketExchanges, markets, palette } from "@/lib/constants";
import { fmt, fmtDate, fmtPct, fmtPlain, fmtUnit, fromInr, toInr } from "@/lib/format";

type PortfolioPayload = {
  user: User;
  securities: Security[];
  fx: Record<string, number>;
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

const PORTFOLIO_CACHE_KEY = "investment-dashboard:portfolio:v1";

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
  const costInr = securities.reduce((sum, s) => sum + ((s.quantity || 0) * (s.costPrice || 0) * (fx[s.currency] || 1)), 0);
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
  const [matches, setMatches] = useState<SearchResult[]>([]);
  const [matchIndex, setMatchIndex] = useState("");
  const [busy, setBusy] = useState(false);
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [error, setError] = useState("");
  const [searchNotice, setSearchNotice] = useState("");
  const localSearchCache = useRef<Record<string, SearchResult[]>>({});
  const quoteCache = useRef<Record<string, string>>({});
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
    if (quoteCache.current[key]) {
      setCurrentPrice(quoteCache.current[key]);
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
      const price = Number(data.quote?.price);
      if (res.ok && Number.isFinite(price) && price > 0) {
        const formatted = String(Number(price.toFixed(6)));
        quoteCache.current[key] = formatted;
        if (requestId === quoteRequestId.current) setCurrentPrice(formatted);
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
      exchange,
      purchaseDate,
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
          <div className="field"><label>Current price</label><input value={currentPrice} onChange={(e) => setCurrentPrice(e.target.value)} placeholder="150.00" /></div>
        </div>
        {error && <div className="bad" style={{ marginTop: 14, fontWeight: 700 }}>{error}</div>}
        <button type="button" className="save-btn" style={{ marginTop: 20, width: 190 }} onClick={save}>Save Investment</button>
      </div>
    </div>
  );
}

function Holdings({ securities, fx, currency, totalInr, reload, onUpdate }: {
  securities: Security[];
  fx: Record<string, number>;
  currency: string;
  totalInr: number;
  reload: () => void;
  onUpdate: (id: number, fields: Partial<Pick<Security, "quantity" | "costPrice" | "latestPrice" | "value" | "purchaseDate">>) => void;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const rows = [...securities].sort((a, b) => (b.latestValueInr ?? b.valueInr) - (a.latestValueInr ?? a.valueInr));

  async function save(id: number) {
    const body = {
      quantity: draft.quantity ? Number(draft.quantity) : undefined,
      costPrice: draft.costPrice ? Number(draft.costPrice) : undefined,
      latestPrice: draft.latestPrice ? Number(draft.latestPrice) : undefined,
      value: draft.value ? Number(draft.value) : undefined,
      purchaseDate: draft.purchaseDate || undefined,
    };
    setEditing(null);
    setDraft({});
    onUpdate(id, body);
    try {
      const res = await fetch(`/api/investments/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) await reload();
    } catch {
      await reload();
    }
  }

  async function remove(id: number) {
    await fetch(`/api/investments/${id}`, { method: "DELETE" });
    setDeleting(null);
    reload();
  }

  function beginEdit(item: Security) {
    setEditing(item.id);
    setDeleting(null);
    setDraft({
      quantity: String(item.quantity || ""),
      costPrice: String(item.costPrice || ""),
      latestPrice: String(item.latestPrice || ""),
      value: String(item.latestValue || item.value || ""),
      purchaseDate: item.purchaseDate || "",
    });
  }

  if (!rows.length) return <div className="alloc-meta">No holdings.</div>;
  return (
    <div className="holdings">
      <div className="holding-head">
        <span>Security</span><span>Cur</span><span>Qty</span><span>Mkt Price</span><span>Value</span><span className="hide-mobile">Cost</span><span className="hide-mobile">Gain/Loss</span><span className="hide-mobile">Gain %</span><span className="hide-mobile">Updated</span><span /><span />
      </div>
      {rows.map((item) => {
        const isEditing = editing === item.id;
        const draftQuantity = Number(draft.quantity || 0);
        const draftLatestPrice = Number(draft.latestPrice || 0);
        const draftValue = Number(draft.value || (draftQuantity && draftLatestPrice ? draftQuantity * draftLatestPrice : 0));
        const draftCost = draftQuantity * Number(draft.costPrice || 0);
        const draftGain = draftValue - draftCost;
        const draftGainPct = draftCost ? (draftGain / draftCost) * 100 : null;
        const valueInr = item.latestValueInr ?? item.valueInr;
        const nativeValue = item.latestValue ?? item.value ?? (item.quantity || 0) * (item.latestPrice || 0);
        const nativeCost = (item.quantity || 0) * (item.costPrice || 0);
        const nativeGain = nativeValue - nativeCost;
        const gainPct = nativeCost ? (nativeGain / nativeCost) * 100 : null;
        const pct = totalInr ? (valueInr / totalInr) * 100 : 0;
        return (
          <div key={item.id}>
            <div className={`holding-row ${isEditing ? "editing" : ""}`}>
              <div><div className="h-name">{item.name}</div><div className="h-sub">{isEditing ? "Editing position" : `${item.assetType} · ${pct.toFixed(1)}%`}</div></div>
              <div className="h-cell h-cur">{item.currency}</div>
              <div className="h-cell h-num">{isEditing ? <input className="inline-input" aria-label="Quantity" value={draft.quantity || ""} onChange={(e) => setDraft({ ...draft, quantity: e.target.value })} /> : fmtPlain(item.quantity, 2)}</div>
              <div className="h-cell h-num">{isEditing ? <input className="inline-input" aria-label="Market price" value={draft.latestPrice || ""} onChange={(e) => setDraft({ ...draft, latestPrice: e.target.value })} /> : fmtUnit(item.latestPrice, item.currency)}</div>
              <div className="h-cell h-num h-value">{isEditing ? <input className="inline-input" aria-label="Current value" value={draft.value || ""} onChange={(e) => setDraft({ ...draft, value: e.target.value })} /> : fmt(nativeValue, item.currency)}</div>
              <div className="h-cell h-num hide-mobile">{isEditing ? <input className="inline-input" aria-label="Unit cost" value={draft.costPrice || ""} onChange={(e) => setDraft({ ...draft, costPrice: e.target.value })} /> : nativeCost ? fmt(nativeCost, item.currency) : "—"}</div>
              <div className={`h-cell h-num hide-mobile ${((isEditing ? draftGainPct : gainPct) || 0) >= 0 ? "good" : "bad"}`}>{isEditing ? (draftCost ? fmt(draftGain, item.currency) : "—") : nativeCost ? fmt(nativeGain, item.currency) : "—"}</div>
              <div className={`h-cell h-num hide-mobile ${((isEditing ? draftGainPct : gainPct) || 0) >= 0 ? "good" : "bad"}`}>{fmtPct(isEditing ? draftGainPct : gainPct, true)}</div>
              <div className="h-cell h-updated hide-mobile">
                {isEditing ? (
                  <input className="inline-input date" aria-label="Purchase date" type="date" value={draft.purchaseDate || ""} onChange={(e) => setDraft({ ...draft, purchaseDate: e.target.value })} />
                ) : (
                  fmtDate(item.refreshedAt || item.priceAsOn)
                )}
              </div>
              {isEditing ? (
                <>
                  <button className="table-btn save-inline" onClick={() => save(item.id)}>Save</button>
                  <button className="table-btn" onClick={() => { setEditing(null); setDraft({}); }}>Cancel</button>
                </>
              ) : (
                <>
                  <button className="table-btn" onClick={() => beginEdit(item)}>Edit</button>
                  <button className="table-btn danger" onClick={() => { setDeleting(deleting === item.id ? null : item.id); setEditing(null); }}>Delete</button>
                </>
              )}
            </div>
            {deleting === item.id && <div className="delete-panel"><b>Delete {item.name}?</b> This cannot be undone. <button className="table-btn danger" style={{ width: 90, marginLeft: 12 }} onClick={() => remove(item.id)}>Delete</button> <button className="table-btn" style={{ width: 90 }} onClick={() => setDeleting(null)}>Cancel</button></div>}
          </div>
        );
      })}
    </div>
  );
}

export default function Page() {
  const [initialPortfolio] = useState<PortfolioPayload | null>(() => readPortfolioCache());
  const [data, setData] = useState<PortfolioPayload | null>(initialPortfolio);
  const [loginChecked, setLoginChecked] = useState(Boolean(initialPortfolio));
  const [modalOpen, setModalOpen] = useState(false);
  const [tab, setTab] = useState("All");
  const [currency, setCurrency] = useState<Record<string, string>>({ All: "USD" });
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<RefreshSummary | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);

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

  useEffect(() => { load(); }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    writePortfolioCache(null);
    setData(null);
  }

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch("/api/refresh", { method: "POST" });
      const json = await res.json();
      setSummary(json.summary);
      setLastRefreshedAt(new Date().toISOString());
      if (json.securities && data) {
        setData((prev) => {
          const next = prev ? { ...prev, securities: json.securities, fx: json.fx || prev.fx } : prev;
          writePortfolioCache(next);
          return next;
        });
      } else {
        await load();
      }
    } finally {
      setLoading(false);
    }
  }

  const securities = data?.securities || [];
  const fx = data?.fx || { INR: 1, USD: 83.5 };
  const countries = useMemo(() => [...new Set(securities.map((s) => s.country))].sort(), [securities]);
  const visible = tab === "All" ? securities : securities.filter((s) => s.country === tab);
  const stats = metricStats(visible, fx);
  const currentCurrency = currency[tab] || (tab === "All" ? "USD" : marketCurrency[tab] || visible[0]?.currency || "USD");

  function updateSecurityLocal(id: number, fields: Partial<Pick<Security, "quantity" | "costPrice" | "latestPrice" | "value" | "purchaseDate">>) {
    setData((prev) => {
      if (!prev) return prev;
      const next = {
        ...prev,
        securities: prev.securities.map((sec) => {
          if (sec.id !== id) return sec;
          const quantity = fields.quantity ?? sec.quantity ?? 0;
          const latestPrice = fields.latestPrice ?? sec.latestPrice ?? 0;
          const latestValue = fields.value ?? (latestPrice && quantity ? latestPrice * quantity : sec.latestValue ?? sec.value);
          return {
            ...sec,
            quantity,
            costPrice: fields.costPrice ?? sec.costPrice,
            latestPrice,
            latestValue,
            latestValueInr: toInr(latestValue, sec.currency, fx),
            purchaseDate: fields.purchaseDate ?? sec.purchaseDate,
            refreshedAt: new Date().toISOString(),
          };
        }),
      };
      writePortfolioCache(next);
      return next;
    });
  }

  useEffect(() => {
    if (tab !== "All" && !currency[tab]) setCurrency((prev) => ({ ...prev, [tab]: marketCurrency[tab] || visible[0]?.currency || "USD" }));
  }, [tab, currency, visible]);

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
          <section className="panel-grid"><AllocationPanel title="Asset Allocation" securities={visible} by="assetType" totalInr={stats.totalInr} fx={fx} currency={currentCurrency} />{tab === "All" && <AllocationPanel title="By Country" securities={visible} by="country" totalInr={stats.totalInr} fx={fx} currency={currentCurrency} />}</section>
          <div className="slabel">Holdings</div>
          <Holdings securities={visible} fx={fx} currency={currentCurrency} totalInr={stats.totalInr} reload={load} onUpdate={updateSecurityLocal} />
        </>
      )}
      {modalOpen && <AddInvestmentModal fx={fx} onClose={() => setModalOpen(false)} onSaved={load} />}
    </main>
  );
}

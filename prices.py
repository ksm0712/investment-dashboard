from datetime import datetime, timedelta
import time
import requests
import yfinance as yf
from database import conn, _ex

# Manual ticker overrides for ambiguous names
TICKER_OVERRIDES = {
    ("sap se", "EUR"): "SAP.DE",
    ("dbs group holdings ltd", "SGD"): "D05.SI",
    ("alphabet, inc.- class a", "USD"): "GOOGL",
    ("alphabet inc class a", "USD"): "GOOGL",
    ("visa inc-class a shares", "USD"): "V",
    ("visa inc class a shares", "USD"): "V",
    ("terumo corp", "JPY"): "4543.T",
    ("rorze corp", "JPY"): "6323.T",
    ("google", "USD"): "GOOGL",
    ("microsoft", "USD"): "MSFT",
    ("apple", "USD"): "AAPL",
    ("amazon", "USD"): "AMZN",
    ("nvidia", "USD"): "NVDA",
    ("meta", "USD"): "META",
    ("tesla", "USD"): "TSLA",
    ("abbott", "USD"): "ABT",
    ("abott", "USD"): "ABT",
    ("softbank", "JPY"): "9984.T",
    ("singtel", "SGD"): "Z74.SI",
    ("singapore airlines", "SGD"): "C6L.SI",
    ("sk hynix", "EUR"): "000660.KS",
}

# MFAPI uses numeric scheme codes in its price endpoint. Some imports may only
# have an ISIN or abbreviated statement name, so keep known mappings here and
# resolve the rest from MFAPI's scheme catalogue.
MF_SCHEME_OVERRIDES = {
    "axis focused 25-g": "117560",
    "axis focused fund - regular plan - growth option": "117560",
    "inf846k01ch7": "117560",
    "inf846k01cq8": "120468",
    "hdfc hybrid equity-g": "102948",
    "hdfc hybrid equity fund - growth plan": "102948",
    "inf179k01as4": "102948",
    "icici pru bluechip-g": "108466",
    "icici prudential bluechip fund - growth": "108466",
    "icici prudential large cap fund (erstwhile bluechip fund) - growth": "108466",
    "inf109k01bl4": "108466",
    "mirae asset large cap reg-g": "107578",
    "mirae asset large cap fund - growth plan": "107578",
    "inf769k01010": "107578",
    "uti flexi cap reg-g": "100669",
    "uti - flexi cap fund-growth option": "100669",
    "inf789f01513": "100669",
}

# Currency → common exchange suffix for yfinance
CURRENCY_EXCHANGE_SUFFIXES = {
    "SGD": [".SI"],
    "EUR": [".DE", ".PA", ".AS", ".MI", ".MC", ""],
    "GBP": [".L"],
    "JPY": [".T"],
    "HKD": [".HK"],
    "AUD": [".AX"],
    "CAD": [".TO"],
    "CHF": [".SW"],
    "CNY": [".SS", ".SZ"],
}

FX_FALLBACK = {
    "INR": 1, "USD": 83.5, "SGD": 62.0, "EUR": 91.0,
    "GBP": 106.0, "JPY": 0.55, "AUD": 55.0, "CAD": 61.0,
    "CHF": 94.0, "HKD": 10.7, "CNY": 11.6, "AED": 22.7,
}

def _now():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

def _parse_date(value):
    for fmt in ("%d-%b-%Y", "%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(str(value), fmt)
        except (TypeError, ValueError):
            continue
    return None

def _status(sec_id, status, note, **updates):
    fields = {"refresh_status": status, "refresh_note": note, "refreshed_at": _now(), **updates}
    assignments = ", ".join(f"{k} = ?" for k in fields)
    conn.execute(f"UPDATE securities SET {assignments} WHERE id = ?", [*fields.values(), sec_id])

def _carry_forward(sec_id, value, value_inr, price_as_on):
    _status(sec_id, "carried_forward", "Carrying forward latest value (no live price source for this asset type).",
            latest_value=value, latest_value_inr=value_inr, price_as_on=price_as_on)

def _bump_type(summary, asset_type, bucket):
    by_type = summary.setdefault("by_type", {})
    type_summary = by_type.setdefault(asset_type or "Other", {
        "updated": 0,
        "unchanged": 0,
        "manual": 0,
        "not_refreshed": 0,
        "failed": 0,
    })
    type_summary[bucket] += 1

def _live_fx(currency):
    if currency == "INR":
        return 1.0
    try:
        r = requests.get("https://api.exchangerate-api.com/v4/latest/INR", timeout=4).json()
        rate = r["rates"].get(currency)
        return 1 / rate if rate else FX_FALLBACK.get(currency, 1)
    except Exception:
        return FX_FALLBACK.get(currency, 1)

def _get_json(url, *, params=None, timeout=12, attempts=3):
    last_exc = None
    for attempt in range(attempts):
        try:
            r = requests.get(url, params=params, timeout=timeout)
            r.raise_for_status()
            return r.json()
        except Exception as exc:
            last_exc = exc
            if attempt < attempts - 1:
                time.sleep(0.5 * (attempt + 1))
    raise last_exc

# ── Mutual fund (Indian, mfapi.in) ────────────────────────────────────────────

def _mf_search(name):
    for query in [name, _normalise_fund_name(name), " ".join(name.split()[:5]), " ".join(name.split()[:4])]:
        q = query.strip()
        if not q:
            continue
        try:
            matches = _get_json("https://api.mfapi.in/mf/search", params={"q": q}, timeout=12)
            if matches:
                return str(_best_mf_match(matches)["schemeCode"])
        except Exception:
            continue
    return None

_mf_catalogue_cache = None

def _normalise_fund_name(name):
    normalised = str(name or "")
    replacements = {
        " Pru ": " Prudential ",
        "-G": " Growth",
        "Reg-G": "Regular Growth",
        "Large Cap Reg": "Large Cap Fund Regular",
        "Focused 25": "Focused Fund",
    }
    for old, new in replacements.items():
        normalised = normalised.replace(old, new)
    return normalised

def _best_mf_match(matches):
    def score(match):
        name = match.get("schemeName", "").lower()
        points = 0
        if "growth" in name:
            points += 20
        if "regular" in name or "regular plan" in name:
            points += 10
        if "direct" in name:
            points -= 8
        if "idcw" in name or "dividend" in name:
            points -= 20
        return points

    return sorted(matches, key=score, reverse=True)[0]

def _mf_catalogue():
    global _mf_catalogue_cache
    if _mf_catalogue_cache is None:
        _mf_catalogue_cache = _get_json("https://api.mfapi.in/mf", timeout=30)
    return _mf_catalogue_cache

def _resolve_mf_scheme(identifier, name):
    candidates = [identifier, name, _normalise_fund_name(name)]
    for candidate in candidates:
        cleaned = str(candidate or "").strip()
        if not cleaned:
            continue
        if cleaned.isdigit():
            return cleaned
        override = MF_SCHEME_OVERRIDES.get(cleaned.lower())
        if override:
            return override

    ident = str(identifier or "").strip().upper()
    if ident.startswith("INF"):
        try:
            for scheme in _mf_catalogue():
                if ident in {
                    str(scheme.get("isinGrowth") or "").upper(),
                    str(scheme.get("isinDivReinvestment") or "").upper(),
                }:
                    return str(scheme["schemeCode"])
        except Exception:
            pass

    return _mf_search(name)

def _mf_data(scheme_code):
    return _get_json(f"https://api.mfapi.in/mf/{scheme_code}", timeout=20)["data"]

def _latest_nav(data):
    row = data[0]
    return float(row["nav"]), row["date"]

def _nav_near(data, target_date):
    for row in data:
        try:
            d = datetime.strptime(row["date"], "%d-%m-%Y")
            if d <= target_date:
                return float(row["nav"]), row["date"]
        except (KeyError, ValueError):
            continue
    return None, None

def _nav_fresh(date_text, max_days=10):
    try:
        return datetime.now() - datetime.strptime(date_text, "%d-%m-%Y") <= timedelta(days=max_days)
    except (TypeError, ValueError):
        return False

def _refresh_indian_mf(sec_id, name, value, price_symbol, portfolio_date, quantity):
    scheme_code = _resolve_mf_scheme(price_symbol, name)
    if not scheme_code:
        _status(sec_id, "needs_mapping", "No mfapi match found. Enter the MFAPI scheme code manually.")
        return "needs_mapping"
    data = _mf_data(scheme_code)
    nav, nav_date = _latest_nav(data)
    if not _nav_fresh(nav_date):
        _status(sec_id, "needs_mapping", f"mfapi scheme {scheme_code} matched but NAV is stale ({nav_date}).",
                price_symbol=scheme_code, price_source="mfapi")
        return "needs_mapping"
    qty = quantity
    note = f"mfapi scheme {scheme_code}."
    if not qty:
        stmt_nav, stmt_date = _nav_near(data, _parse_date(portfolio_date)) if portfolio_date else (None, None)
        if stmt_nav:
            qty = value / stmt_nav
            note += f" Units inferred from {stmt_date} NAV."
    updates = dict(price_source="mfapi", price_symbol=scheme_code, latest_price=nav, price_as_on=nav_date)
    if qty:
        _status(sec_id, "updated", note + f" NAV {nav} on {nav_date}.",
                quantity=qty, latest_value=nav * qty, latest_value_inr=nav * qty, **updates)
        return "updated"
    _status(sec_id, "needs_quantity", "mfapi matched but units unknown — enter quantity manually.", **updates)
    return "needs_quantity"

# ── yfinance (Stocks, ETFs, non-INR funds) ────────────────────────────────────

def _yf_latest(symbol):
    for attempt in range(3):
        try:
            hist = yf.Ticker(symbol).history(period="7d")
            if not hist.empty:
                return float(hist["Close"].iloc[-1]), hist.index[-1].strftime("%Y-%m-%d")
        except Exception:
            pass
        if attempt < 2:
            time.sleep(0.5 * (attempt + 1))
    return None, None

def _yf_near(symbol, target_date):
    try:
        start = (target_date - timedelta(days=10)).strftime("%Y-%m-%d")
        end   = (target_date + timedelta(days=3)).strftime("%Y-%m-%d")
        hist  = yf.Ticker(symbol).history(start=start, end=end)
        if hist.empty:
            return None, None
        hist = hist[hist.index.tz_localize(None) <= target_date + timedelta(days=1)]
        if hist.empty:
            return None, None
        return float(hist["Close"].iloc[-1]), hist.index[-1].strftime("%Y-%m-%d")
    except Exception:
        return None, None

def _yf_search(name, currency):
    """Try multiple strategies to find a working yfinance ticker."""
    # 1. Try manual overrides
    override = TICKER_OVERRIDES.get((name.strip().lower(), currency.upper()))
    if override:
        p, _ = _yf_latest(override)
        if p:
            return override

    # 2. Try yfinance search matching currency
    try:
        quotes = yf.Search(name, max_results=10).quotes or []
        preferred = {"EQUITY", "ETF", "MUTUALFUND"}
        # currency-matched first
        for q in quotes:
            sym = q.get("symbol"); qt = q.get("quoteType"); qc = q.get("currency", "")
            if sym and qt in preferred and qc.upper() == currency.upper():
                p, _ = _yf_latest(sym)
                if p:
                    return sym
        # any match
        for q in quotes:
            sym = q.get("symbol"); qt = q.get("quoteType")
            if sym and qt in preferred:
                p, _ = _yf_latest(sym)
                if p:
                    return sym
    except Exception:
        pass

    # 3. Try ticker with exchange suffixes based on currency
    candidate = name.strip().upper().split()[0]
    for suffix in CURRENCY_EXCHANGE_SUFFIXES.get(currency.upper(), []):
        sym = candidate + suffix
        p, _ = _yf_latest(sym)
        if p:
            return sym

    # 4. Try yfinance search with shortened name, no currency filter
    for length in [4, 3]:
        short = " ".join(name.split()[:length])
        try:
            quotes = yf.Search(short, max_results=5).quotes or []
            for q in quotes:
                sym = q.get("symbol"); qt = q.get("quoteType")
                if sym and qt in {"EQUITY", "ETF", "MUTUALFUND"}:
                    p, _ = _yf_latest(sym)
                    if p:
                        return sym
        except Exception:
            pass

    return None

def _refresh_market(sec_id, name, currency, value, value_inr, quantity, price_symbol, portfolio_date):
    symbol = (TICKER_OVERRIDES.get((name.strip().lower(), currency.upper()))
              or price_symbol
              or _yf_search(name, currency))
    if not symbol:
        _status(sec_id, "needs_mapping", "No yfinance ticker found. Enter the ticker manually.")
        return "needs_mapping"

    latest_price, latest_date = _yf_latest(symbol)
    if latest_price is None:
        _status(sec_id, "failed", f"Ticker {symbol} found but price fetch failed.")
        return "failed"

    fx = _live_fx(currency)
    qty = quantity
    note = f"Ticker {symbol}."

    # If quantity is known, use it directly — no plausibility check needed
    if qty:
        latest_value = latest_price * qty
        _status(sec_id, "updated", note + f" Close {latest_price} on {latest_date}.",
                quantity=qty,
                price_source="yfinance", price_symbol=symbol, ticker=symbol,
                latest_price=latest_price, price_as_on=latest_date,
                latest_value=latest_value,
                latest_value_inr=latest_value if currency == "INR" else latest_value * fx)
        return "updated"

    # Quantity unknown — infer from statement-date price
    stmt_price, stmt_date = (None, None)
    if portfolio_date:
        pd_parsed = _parse_date(portfolio_date)
        if pd_parsed:
            stmt_price, stmt_date = _yf_near(symbol, pd_parsed)

    if stmt_price and value:
        qty = value / stmt_price
        note += f" Units inferred from {stmt_date} close."
        latest_value = latest_price * qty
        # Sanity check only when inferring quantity
        ratio = latest_value / value if value else 0
        if not (0.3 <= ratio <= 5.0):
            _status(sec_id, "needs_review",
                    note + f" Value changed {ratio:.1f}x — review ticker/units before applying.",
                    price_source="yfinance", price_symbol=symbol, ticker=symbol,
                    latest_price=latest_price, price_as_on=latest_date, quantity=qty)
            return "needs_review"
        _status(sec_id, "updated", note + f" Close {latest_price} on {latest_date}.",
                quantity=qty,
                price_source="yfinance", price_symbol=symbol, ticker=symbol,
                latest_price=latest_price, price_as_on=latest_date,
                latest_value=latest_value,
                latest_value_inr=latest_value if currency == "INR" else latest_value * fx)
        return "updated"

    _status(sec_id, "needs_quantity",
            f"Ticker {symbol} found but statement-date price unavailable — enter quantity manually.",
            price_source="yfinance", price_symbol=symbol, ticker=symbol,
            latest_price=latest_price, price_as_on=latest_date)
    return "needs_quantity"

# ── Main entry point ───────────────────────────────────────────────────────────

def refresh_prices():
    rows = conn.execute("""
        SELECT s.id, s.name, s.asset_type, s.currency, s.value, s.value_inr,
               s.quantity, s.price_symbol, p.date, COALESCE(s.pricing_mode, ''),
               s.isin
        FROM securities s
        JOIN portfolios p ON s.portfolio_id = p.id
    """).fetchall()

    summary = {
        "updated": 0,
        "unchanged": 0,
        "manual": 0,
        "not_refreshed": 0,
        "failed": 0,
        "total": len(rows),
        "by_type": {},
    }

    for row in rows:
        sec_id, name, asset_type, currency, value, value_inr, quantity, price_symbol, portfolio_date, pricing_mode, isin = row
        try:
            if asset_type == "Mutual Fund" and currency == "INR":
                result = _refresh_indian_mf(sec_id, name, value, price_symbol or isin, portfolio_date, quantity)

            elif asset_type in {"Stock", "ETF"} or (asset_type == "Mutual Fund" and currency != "INR"):
                # Non-INR mutual funds are often exchange-traded — try yfinance
                sym = price_symbol or (isin if isin else None)
                result = _refresh_market(sec_id, name, currency, value, value_inr, quantity, sym, portfolio_date)

            elif asset_type in {"Savings", "Bond", "Other"}:
                _carry_forward(sec_id, value, value_inr, portfolio_date)
                result = "manual"

            else:
                _carry_forward(sec_id, value, value_inr, portfolio_date)
                result = "manual"

        except Exception as exc:
            # On error, keep last known value if it's recent
            latest = conn.execute(
                "SELECT latest_value, latest_value_inr, price_as_on, refresh_status FROM securities WHERE id = ?",
                (sec_id,),
            ).fetchone()
            lv, lvi, pao, existing = latest or (None, None, None, None)
            if lv is not None:
                _status(sec_id, existing or "failed", f"Refresh error: {exc}. Keeping last known value.")
                result = "unchanged"
            else:
                _carry_forward(sec_id, value, value_inr, portfolio_date)
                result = "unchanged"

        bucket = ("updated" if result == "updated" else
                  "failed" if result == "failed" else
                  "manual" if result == "manual" else
                  "not_refreshed" if result != "unchanged" else
                  "unchanged")
        summary[bucket] += 1
        _bump_type(summary, asset_type, bucket)

    conn.commit()
    return summary


if __name__ == "__main__":
    print(refresh_prices())

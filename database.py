import sqlite3
import pandas as pd
from datetime import datetime

conn = sqlite3.connect("investments.db", check_same_thread=False)
cursor = conn.cursor()

def create_tables():
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS portfolios (
            id INTEGER PRIMARY KEY,
            name TEXT,
            date TEXT,
            UNIQUE(name, date)
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS securities (
            id INTEGER PRIMARY KEY,
            portfolio_id INTEGER,
            name TEXT,
            asset_type TEXT,
            currency TEXT,
            value REAL,
            value_inr REAL,
            annual_income REAL,
            return_pct REAL
        )
    """)
    _ensure_security_columns()
    _backfill_price_as_on()
    conn.commit()

def _ensure_security_columns():
    existing = {
        row[1] for row in cursor.execute("PRAGMA table_info(securities)").fetchall()
    }
    columns = {
        "quantity": "REAL",
        "ticker": "TEXT",
        "isin": "TEXT",
        "price_source": "TEXT",
        "price_symbol": "TEXT",
        "latest_price": "REAL",
        "price_as_on": "TEXT",
        "latest_value": "REAL",
        "latest_value_inr": "REAL",
        "refresh_status": "TEXT",
        "refresh_note": "TEXT",
        "refreshed_at": "TEXT",
        "country": "TEXT",
        "pricing_mode": "TEXT",
        "exchange": "TEXT",
        "cost_price": "REAL",
        "purchase_date": "TEXT",
    }
    for name, definition in columns.items():
        if name not in existing:
            cursor.execute(f"ALTER TABLE securities ADD COLUMN {name} {definition}")
    conn.commit()
    cursor.execute("""
        UPDATE securities
        SET pricing_mode = CASE
            WHEN asset_type IN ('Stock', 'ETF') THEN 'auto'
            WHEN asset_type = 'Mutual Fund' AND currency = 'INR' THEN 'auto'
            ELSE 'manual'
        END
        WHERE pricing_mode IS NULL OR TRIM(pricing_mode) = ''
    """)
    cursor.execute("""
        UPDATE securities
        SET country = CASE
            WHEN currency = 'INR' THEN 'India'
            WHEN currency = 'SGD' THEN 'Singapore'
            WHEN currency = 'USD' THEN 'United States'
            WHEN currency = 'GBP' THEN 'United Kingdom'
            WHEN currency = 'EUR' THEN 'Europe'
            WHEN currency = 'JPY' THEN 'Japan'
            ELSE 'Other'
        END
        WHERE country IS NULL OR TRIM(country) = ''
    """)
    conn.commit()

def _backfill_price_as_on():
    cursor.execute("""
        UPDATE securities
        SET price_as_on = (
            SELECT portfolios.date
            FROM portfolios
            WHERE portfolios.id = securities.portfolio_id
        )
        WHERE price_as_on IS NULL OR TRIM(price_as_on) = ''
    """)
    conn.commit()

def save_portfolio(portfolio):
    cursor.execute(
        "INSERT OR IGNORE INTO portfolios (name, date) VALUES (?, ?)",
        (portfolio.name, portfolio.date)
    )
    row = cursor.execute(
        "SELECT id FROM portfolios WHERE name = ? AND date = ?",
        (portfolio.name, portfolio.date)
    ).fetchone()
    portfolio_id = row[0]

    # Clear old securities for this portfolio and re-insert
    cursor.execute("DELETE FROM securities WHERE portfolio_id = ?", (portfolio_id,))
    for s in portfolio.securities:
        cursor.execute("""
            INSERT INTO securities (
                portfolio_id, name, asset_type, currency, value, value_inr,
                quantity, ticker, isin, price_source, price_symbol, latest_price,
                annual_income, return_pct, price_as_on, refresh_status, refresh_note
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            portfolio_id, s.name, s.asset_type, s.currency, s.value, s.value_inr,
            s.quantity, s.ticker, s.isin, s.price_source, s.price_symbol,
            s.latest_price, s.annual_income, s.return_pct, portfolio.date, "needs_refresh", "Not refreshed yet"
        ))
    conn.commit()

def _date_key(date_text):
    try:
        return datetime.strptime(date_text, "%d-%b-%Y")
    except (TypeError, ValueError):
        return datetime.min

def get_all_portfolios():
    rows = cursor.execute("SELECT id, name, date FROM portfolios").fetchall()
    return sorted(rows, key=lambda row: (_date_key(row[2]), row[0]), reverse=True)

def rename_portfolio(portfolio_id, name):
    cursor.execute(
        "UPDATE portfolios SET name = ? WHERE id = ?",
        (name.strip(), portfolio_id),
    )
    conn.commit()

def delete_portfolio(portfolio_id):
    cursor.execute("DELETE FROM securities WHERE portfolio_id = ?", (portfolio_id,))
    cursor.execute("DELETE FROM portfolios WHERE id = ?", (portfolio_id,))
    conn.commit()

def create_manual_portfolio(name, date):
    cleaned = name.strip()
    cursor.execute(
        "INSERT OR IGNORE INTO portfolios (name, date) VALUES (?, ?)",
        (cleaned, date),
    )
    row = cursor.execute(
        "SELECT id FROM portfolios WHERE name = ? AND date = ?",
        (cleaned, date),
    ).fetchone()
    conn.commit()
    return row[0]

def add_manual_security(
    portfolio_id, name, asset_type, currency, country, pricing_mode,
    quantity, latest_price, value, value_inr, annual_income, return_pct, price_symbol,
    exchange=None, cost_price=None, purchase_date=None
):
    latest_value = value
    if quantity is not None and latest_price is not None and quantity > 0 and latest_price > 0:
        latest_value = quantity * latest_price
    if value:
        fx_ratio = value_inr / value
    else:
        fx_ratio = 1
    latest_value_inr = latest_value * fx_ratio
    refresh_status = "needs_refresh" if pricing_mode == "auto" else "manual_value"
    refresh_note = "Ready for online price refresh." if pricing_mode == "auto" else "Manual asset. User controls value."
    price_source = "manual"
    if pricing_mode == "auto" and asset_type == "Mutual Fund" and currency == "INR":
        price_source = "mfapi"
    elif pricing_mode == "auto":
        price_source = "yfinance"

    cursor.execute("""
        INSERT INTO securities (
            portfolio_id, name, asset_type, currency, value, value_inr,
            quantity, ticker, isin, price_source, price_symbol, latest_price,
            annual_income, return_pct, price_as_on, latest_value, latest_value_inr,
            refresh_status, refresh_note, refreshed_at, country, pricing_mode,
            exchange, cost_price, purchase_date
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        portfolio_id, name.strip(), asset_type, currency, latest_value, latest_value_inr,
        quantity, price_symbol, None, price_source, price_symbol, latest_price,
        annual_income, return_pct, datetime.now().strftime("%d %b %Y"),
        latest_value, latest_value_inr, refresh_status, refresh_note,
        datetime.now().strftime("%Y-%m-%d %H:%M:%S"), country, pricing_mode,
        exchange, cost_price, purchase_date,
    ))
    conn.commit()

def get_securities(portfolio_id=None):
    if portfolio_id:
        rows = cursor.execute("""
            SELECT
                s.id,
                s.name, s.asset_type, s.currency,
                COALESCE(s.latest_value, s.value) AS value,
                COALESCE(s.latest_value_inr, s.value_inr) AS value_inr,
                s.annual_income, s.return_pct,
                s.quantity, s.ticker, s.isin, s.price_source, s.price_symbol,
                s.latest_price, COALESCE(s.price_as_on, p.date) AS price_as_on,
                s.refresh_status, s.refresh_note, s.refreshed_at,
                s.country, s.pricing_mode, s.exchange, s.cost_price, s.purchase_date, p.name
            FROM securities s
            JOIN portfolios p ON s.portfolio_id = p.id
            WHERE s.portfolio_id = ?
        """, (portfolio_id,)).fetchall()
        return pd.DataFrame(rows, columns=[
            "ID", "Name", "Asset Type", "Currency", "Value", "Value INR", "Annual Income", "Return %",
            "Quantity", "Ticker", "ISIN", "Price Source", "Price Symbol",
            "Latest Price", "Price As Of", "Refresh Status", "Refresh Note", "Refreshed At",
            "Country", "Pricing Mode", "Exchange", "Cost Price", "Purchase Date", "Source"
        ])

    rows = cursor.execute("""
        SELECT
            s.id,
            s.name, s.asset_type, s.currency,
            COALESCE(s.latest_value, s.value) AS value,
            COALESCE(s.latest_value_inr, s.value_inr) AS value_inr,
            s.annual_income, s.return_pct,
            s.quantity, s.ticker, s.isin, s.price_source, s.price_symbol,
            s.latest_price, COALESCE(s.price_as_on, p.date) AS price_as_on,
            s.refresh_status, s.refresh_note, s.refreshed_at,
            s.country, s.pricing_mode, s.exchange, s.cost_price, s.purchase_date,
            p.name, p.date, p.id
        FROM securities s
        JOIN portfolios p ON s.portfolio_id = p.id
    """).fetchall()
    df = pd.DataFrame(rows, columns=[
        "ID", "Name", "Asset Type", "Currency", "Value", "Value INR", "Annual Income", "Return %",
        "Quantity", "Ticker", "ISIN", "Price Source", "Price Symbol",
        "Latest Price", "Price As Of", "Refresh Status", "Refresh Note", "Refreshed At",
        "Country", "Pricing Mode", "Exchange", "Cost Price", "Purchase Date", "Source", "Portfolio Date", "Portfolio ID"
    ])
    if df.empty:
        return df.drop(columns=["Portfolio Date", "Portfolio ID"])

    df["_date_key"] = df["Portfolio Date"].apply(_date_key)
    df["_security_key"] = (
        df["Name"].str.strip().str.lower() + "|" +
        df["Asset Type"].str.strip().str.lower() + "|" +
        df["Currency"].str.strip().str.upper()
    )
    df = (
        df.sort_values(["_date_key", "Portfolio ID"])
          .drop_duplicates("_security_key", keep="last")
          .sort_values(["_date_key", "Portfolio ID"], ascending=False)
    )
    return df[[
        "ID", "Name", "Asset Type", "Currency", "Value", "Value INR", "Annual Income", "Return %",
        "Quantity", "Ticker", "ISIN", "Price Source", "Price Symbol",
        "Latest Price", "Price As Of", "Refresh Status", "Refresh Note", "Refreshed At",
        "Country", "Pricing Mode", "Exchange", "Cost Price", "Purchase Date", "Source"
    ]].reset_index(drop=True)

def get_refresh_setup_items():
    rows = cursor.execute("""
        SELECT id, name, asset_type, currency, value, refresh_status
        FROM securities
        WHERE refresh_status IN ('needs_mapping', 'needs_quantity', 'needs_review')
        ORDER BY asset_type, name
    """).fetchall()
    return pd.DataFrame(rows, columns=[
        "ID", "Name", "Asset Type", "Currency", "Current Value", "Refresh Status"
    ])

def update_security_manual_value(security_id, value):
    row = cursor.execute(
        "SELECT currency, value, value_inr FROM securities WHERE id = ?",
        (security_id,),
    ).fetchone()
    if not row:
        return
    currency, old_value, old_value_inr = row
    fx = old_value_inr / old_value if old_value and currency != "INR" else 1
    latest_value_inr = value if currency == "INR" else value * fx
    cursor.execute(
        """
        UPDATE securities
        SET latest_value = ?, latest_value_inr = ?, refresh_status = ?, refresh_note = ?, refreshed_at = ?
        WHERE id = ?
        """,
        (value, latest_value_inr, "manual_value", "User entered current value.", datetime.now().strftime("%Y-%m-%d %H:%M:%S"), security_id),
    )
    conn.commit()

def update_security_manual_price(security_id, latest_price, price_as_on, quantity=None):
    row = cursor.execute(
        "SELECT currency, value, value_inr, quantity FROM securities WHERE id = ?",
        (security_id,),
    ).fetchone()
    if not row:
        return
    currency, old_value, old_value_inr, old_quantity = row
    quantity = old_quantity if quantity is None else quantity
    fx = old_value_inr / old_value if old_value and currency != "INR" else 1
    latest_value = latest_price * quantity if quantity is not None else old_value
    latest_value_inr = latest_value if currency == "INR" else latest_value * fx
    cursor.execute(
        """
        UPDATE securities
        SET quantity = ?, latest_price = ?, price_as_on = ?, latest_value = ?, latest_value_inr = ?,
            refresh_status = ?, refresh_note = ?, refreshed_at = ?
        WHERE id = ?
        """,
        (
            quantity,
            latest_price,
            price_as_on,
            latest_value,
            latest_value_inr,
            "manual_price",
            "User entered latest price.",
            datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            security_id,
        ),
    )
    conn.commit()

def delete_security(security_id):
    cursor.execute("DELETE FROM securities WHERE id = ?", (security_id,))
    conn.commit()

def update_security_fields(security_id, quantity=None, cost_price=None, latest_price=None, value=None, purchase_date=None):
    row = cursor.execute(
        "SELECT currency, value as v, value_inr FROM securities WHERE id = ?", (security_id,)
    ).fetchone()
    if not row:
        return
    currency, old_value, old_value_inr = row
    fx_rate = old_value_inr / old_value if old_value and currency != "INR" else 1

    updates = {}
    if quantity is not None:
        updates["quantity"] = quantity
    if cost_price is not None:
        updates["cost_price"] = cost_price
    if latest_price is not None:
        updates["latest_price"] = latest_price
        qty_row = cursor.execute("SELECT quantity FROM securities WHERE id=?", (security_id,)).fetchone()
        qty = quantity if quantity is not None else (qty_row[0] if qty_row else None)
        if qty:
            updates["latest_value"] = latest_price * qty
            updates["latest_value_inr"] = latest_price * qty * fx_rate
    if value is not None:
        updates["latest_value"] = value
        updates["latest_value_inr"] = value * fx_rate
    if purchase_date is not None:
        updates["purchase_date"] = purchase_date

    if not updates:
        return
    updates["refreshed_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    set_clause = ", ".join(f"{k} = ?" for k in updates)
    cursor.execute(f"UPDATE securities SET {set_clause} WHERE id = ?", (*updates.values(), security_id))
    conn.commit()

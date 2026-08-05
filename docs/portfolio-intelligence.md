# Portfolio intelligence architecture

## Product goal

Translate the decision system in `Global Stocks Portfolio.xlsx` into a multi-user web product. Each asset appears once, contains any number of purchase lots, receives refreshed market and target data, and exposes an auditable action.

## Core data model

```text
User -> Portfolio -> Asset -> Purchase lots
                         -> Market-data snapshot
                         -> Target-price snapshot or manual override
                         -> Derived metrics and action
```

An **asset** is the instrument: Apple on NASDAQ, DBS on SGX, or an Indian mutual fund. A **lot** is one purchase of that asset. This distinction is necessary because live price and target data belong to the asset, while quantity, cost and purchase date belong to a lot.

An instrument must be identified by a provider symbol plus exchange. A display name alone is not a stable identifier.

## Calculation ownership

`lib/portfolio-engine.ts` is the single source of truth for all spreadsheet-derived calculations. API routes and UI components consume its results; they must not reimplement the formulas independently.

Percentage values are stored internally as decimal ratios (`0.25` means 25%) and converted to display percentages only at the UI boundary.

## Exact spreadsheet formulas

```text
shares held                  = sum(lot quantity)
invested cost                = sum(lot quantity * lot price + fees)
average purchase price       = invested cost / shares held
lowest purchase price        = min(lot price)
market value                 = current price * shares held
gain/loss                    = market value - invested cost
gain %                       = gain/loss / invested cost
% above 52-week low          = (price - low) / low
% below 52-week high         = (high - price) / high
price to target              = (target - price) / target
remaining allocation         = allocation - invested cost
aggressive sell trigger      = max(52-week high, target)
% above aggressive trigger   = (price - aggressive trigger) / price
conservative sell trigger    = min(52-week high, target)
% above conservative trigger = (price - conservative trigger) / price
```

The denominator conventions intentionally match the spreadsheet even where a conventional finance metric might use the current price or original cost instead.

## Action precedence

Actions are mutually exclusive and evaluated from top to bottom:

1. **Sell:** aggressive-trigger gap is at least -5%.
2. **Review to Sell:** aggressive-trigger gap is at least -10% but below -5%.
3. **Buy:** price is more than 25% below both high and target, price is at or below the lowest purchase (or no lots exist), and allocation remains.
4. **Review to Buy:** the same buy gates at an 18% threshold.
5. **Continue to Monitor:** no threshold matched.
6. **Insufficient Data:** current price, target, or 52-week high is unavailable, so a reliable action cannot be produced.

## Safe delivery sequence

1. Add and test the pure calculation engine.
2. Introduce an additive `investment_lots` table and market/target fields. Preserve every existing holding as its first lot.
3. Extend quote refresh behind a provider interface. Market fields and target fields retain their own source and timestamp.
4. Return consolidated asset results through the portfolio API.
5. Add an expandable analysis-and-lots experience to the existing holdings UI.
6. Add action-change history and alerts only after calculations and data freshness are proven reliable.

The deployed `main` branch remains unchanged until this feature branch is reviewed and explicitly merged.

## Target-provider policy

For stocks, the backend queries multiple target providers and normalizes them into one value, source and as-of date. Provider precedence is Twelve Data's international analyst average, Financial Modeling Prep consensus, Nasdaq analyst consensus, then Alpha Vantage analyst target. Twelve Data, FMP and Alpha Vantage require server-side API keys; Nasdaq is the no-key fallback for supported U.S. securities. A provider failure must never be presented as a valid action.

ETFs generally do not receive company-style analyst consensus price targets. The product must label any future ETF target methodology accurately (for example, model target or NAV-based target) instead of presenting a 52-week high as analyst consensus.

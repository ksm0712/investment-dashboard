import type { Security } from "./types";

function cell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function portfolioCsv(securities: Security[]) {
  const headers = [
    "Name", "Ticker", "Asset type", "Market", "Currency", "Shares", "Price",
    "Market value", "Invested cost", "Gain / loss", "Gain %", "Action", "Updated",
  ];
  const rows = securities.map((security) => [
    security.name,
    security.priceSymbol || security.ticker || "",
    security.assetType,
    security.country,
    security.currency,
    security.sharesHeld,
    security.latestPrice,
    security.marketValue,
    security.investedCost,
    security.gainLoss,
    security.gainPct === null ? "" : security.gainPct * 100,
    security.action,
    security.marketDataAsOn || security.priceAsOn || security.refreshedAt || "",
  ]);
  return [headers, ...rows].map((row) => row.map(cell).join(",")).join("\n");
}

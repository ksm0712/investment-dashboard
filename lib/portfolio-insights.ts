import type { Security } from "./types";

export type PortfolioAttention = {
  actionable: Security[];
  incomplete: Security[];
  stale: Security[];
  concentrated: Security[];
  largestWeight: number;
};

const ACTIONABLE = new Set(["Sell", "Review to Sell", "Buy", "Review to Buy"]);

function marketValue(security: Security) {
  return security.latestValueInr ?? security.valueInr ?? 0;
}

export function isMarketDataStale(security: Security, now = Date.now()) {
  const raw = security.marketDataAsOn || security.priceAsOn || security.refreshedAt;
  if (!raw) return true;
  const timestamp = new Date(raw).getTime();
  if (!Number.isFinite(timestamp)) return true;
  return now - timestamp > 7 * 86_400_000;
}

export function portfolioAttention(securities: Security[], now = Date.now()): PortfolioAttention {
  const total = securities.reduce((sum, security) => sum + marketValue(security), 0);
  const weight = (security: Security) => total > 0 ? marketValue(security) / total : 0;
  const byWeight = [...securities].sort((a, b) => weight(b) - weight(a));

  return {
    actionable: securities
      .filter((security) => ACTIONABLE.has(security.action))
      .sort((a, b) => (a.action === "Sell" ? -1 : 0) - (b.action === "Sell" ? -1 : 0) || weight(b) - weight(a)),
    incomplete: securities
      .filter((security) => security.action === "Insufficient Data" || security.allocation === null || !security.targetPrice)
      .sort((a, b) => weight(b) - weight(a)),
    stale: securities.filter((security) => isMarketDataStale(security, now)).sort((a, b) => weight(b) - weight(a)),
    concentrated: byWeight.filter((security) => weight(security) >= 0.25),
    largestWeight: byWeight.length ? weight(byWeight[0]) : 0,
  };
}

export function portfolioHealthScore(securities: Security[], now = Date.now()) {
  if (!securities.length) return 100;
  const attention = portfolioAttention(securities, now);
  const incompletePenalty = (attention.incomplete.length / securities.length) * 45;
  const stalePenalty = (attention.stale.length / securities.length) * 25;
  const concentrationPenalty = Math.max(0, attention.largestWeight - 0.35) * 60;
  return Math.max(0, Math.round(100 - incompletePenalty - stalePenalty - concentrationPenalty));
}

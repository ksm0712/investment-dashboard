import type { ActionHistoryEntry, Security } from "./types";

export function buildActionHistoryEntry(
  security: Security,
  previous: ActionHistoryEntry | undefined,
  recordedAt = new Date().toISOString(),
): Omit<ActionHistoryEntry, "id"> | null {
  if (previous?.action === security.action) return null;
  return {
    securityId: security.id,
    securityName: security.name,
    action: security.action,
    previousAction: previous?.action || null,
    currentPrice: security.latestPrice,
    targetPrice: security.targetPrice,
    source: security.marketDataSource || security.priceSource,
    reasons: security.actionReasons,
    recordedAt,
  };
}

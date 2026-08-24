export type MarketPhase = "open" | "closed" | "weekend_holiday";

type TradingWindow = {
  timeZone: string;
  openMinute: number;
  closeMinute: number;
};

// Minimum coverage per spec: NYSE/NASDAQ, LSE, and one Asian exchange (NSE — India).
// An exchange not listed here defaults to "closed" rather than a guessed "open": that's the
// safer direction to be wrong in, since it produces the longer (not shorter) cache TTL.
const TRADING_WINDOWS: Record<string, TradingWindow> = {
  NYSE: { timeZone: "America/New_York", openMinute: 9 * 60 + 30, closeMinute: 16 * 60 },
  NASDAQ: { timeZone: "America/New_York", openMinute: 9 * 60 + 30, closeMinute: 16 * 60 },
  LSE: { timeZone: "Europe/London", openMinute: 8 * 60, closeMinute: 16 * 60 + 30 },
  NSE: { timeZone: "Asia/Kolkata", openMinute: 9 * 60 + 15, closeMinute: 15 * 60 + 30 },
};

function localParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
  const weekday = get("weekday");
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  return { weekday, minutesSinceMidnight: hour * 60 + minute };
}

/**
 * Not a holiday calendar — a market holiday on a weekday reads as "closed", the same TTL
 * bucket a regular closed-market evening gets. That's a known gap (documented in
 * ENGINEERING_LOG.md), not a fabricated schedule.
 */
export function marketPhase(exchange: string | null | undefined, now: Date = new Date()): MarketPhase {
  const window = TRADING_WINDOWS[String(exchange || "").toUpperCase()];
  if (!window) return "closed";

  const { weekday, minutesSinceMidnight } = localParts(now, window.timeZone);
  if (weekday === "Sat" || weekday === "Sun") return "weekend_holiday";
  if (minutesSinceMidnight >= window.openMinute && minutesSinceMidnight < window.closeMinute) return "open";
  return "closed";
}

export function isExchangeOpen(exchange: string | null | undefined, now: Date = new Date()) {
  return marketPhase(exchange, now) === "open";
}

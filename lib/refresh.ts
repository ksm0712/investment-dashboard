import { getSecurities, updateRefreshFields } from "./db";
import { getFx } from "./fx";
import type { Security } from "./types";

async function yahooPrice(symbol: string) {
  const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`, {
    headers: { "User-Agent": "Mozilla/5.0" },
    cache: "no-store",
  });
  const data = await res.json();
  const result = data.chart?.result?.[0];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const timestamps = result?.timestamp || [];
  for (let i = closes.length - 1; i >= 0; i--) {
    if (closes[i]) {
      return {
        price: Number(closes[i]),
        date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10),
      };
    }
  }
  throw new Error("No Yahoo price");
}

async function mfPrice(code: string) {
  const res = await fetch(`https://api.mfapi.in/mf/${encodeURIComponent(code)}`, { cache: "no-store" });
  const data = await res.json();
  const nav = data.data?.[0];
  if (!nav) throw new Error("No NAV");
  return {
    price: Number(nav.nav),
    date: String(nav.date),
  };
}

function bucketName(result: string) {
  if (result === "updated") return "updated";
  if (result === "manual") return "manual";
  if (result === "failed") return "failed";
  if (result === "unchanged") return "unchanged";
  return "not_refreshed";
}

export async function refreshPrices(userId: string) {
  const securities = await getSecurities(userId);
  const fx = await getFx();
  const summary: any = { updated: 0, unchanged: 0, manual: 0, not_refreshed: 0, failed: 0, total: securities.length, byType: {} };

  async function mark(sec: Security, result: string) {
    const bucket = bucketName(result);
    summary[bucket] += 1;
    summary.byType[sec.assetType] ||= { updated: 0, unchanged: 0, manual: 0, not_refreshed: 0, failed: 0 };
    summary.byType[sec.assetType][bucket] += 1;
  }

  for (const sec of securities) {
    try {
      if (["Savings", "Bond", "Other"].includes(sec.assetType) || sec.pricingMode === "manual") {
        await updateRefreshFields(userId, sec.id, {
          refreshStatus: "manual_value",
          refreshNote: "Manual asset. User controls value.",
          latestValue: sec.latestValue ?? sec.value,
          latestValueInr: sec.latestValueInr ?? sec.valueInr,
        });
        await mark(sec, "manual");
        continue;
      }
      const symbol = sec.priceSymbol || sec.ticker || "";
      if (!symbol) {
        await updateRefreshFields(userId, sec.id, { refreshStatus: "needs_mapping", refreshNote: "Missing identifier." });
        await mark(sec, "not_refreshed");
        continue;
      }
      const latest = sec.assetType === "Mutual Fund" && sec.currency === "INR" ? await mfPrice(symbol) : await yahooPrice(symbol);
      if (!sec.quantity) {
        await updateRefreshFields(userId, sec.id, {
          latestPrice: latest.price,
          priceAsOn: latest.date,
          refreshStatus: "needs_quantity",
          refreshNote: "Price found but quantity missing.",
        });
        await mark(sec, "not_refreshed");
        continue;
      }
      const latestValue = latest.price * sec.quantity;
      const latestValueInr = sec.currency === "INR" ? latestValue : latestValue * (fx[sec.currency] || 1);
      await updateRefreshFields(userId, sec.id, {
        latestPrice: latest.price,
        priceAsOn: latest.date,
        latestValue,
        latestValueInr,
        refreshStatus: "updated",
        refreshNote: `Updated price ${latest.price} on ${latest.date}.`,
      });
      await mark(sec, "updated");
    } catch (error) {
      await updateRefreshFields(userId, sec.id, {
        refreshStatus: "failed",
        refreshNote: error instanceof Error ? error.message : "Refresh failed.",
      });
      await mark(sec, "failed");
    }
  }
  return summary;
}

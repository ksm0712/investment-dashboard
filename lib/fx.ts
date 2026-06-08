import { fxFallback } from "./constants";

let fxCache: { at: number; data: Record<string, number> } | null = null;

export async function getFx() {
  if (fxCache && Date.now() - fxCache.at < 60 * 60 * 1000) return fxCache.data;
  try {
    const res = await fetch("https://api.exchangerate-api.com/v4/latest/INR", { next: { revalidate: 3600 } });
    const data = await res.json();
    const fx: Record<string, number> = { INR: 1 };
    for (const cur of Object.keys(fxFallback)) {
      if (cur !== "INR" && data.rates?.[cur]) fx[cur] = 1 / data.rates[cur];
    }
    fxCache = { at: Date.now(), data: { ...fxFallback, ...fx } };
    return fxCache.data;
  } catch {
    return fxFallback;
  }
}

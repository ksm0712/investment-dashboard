import { symbols } from "./constants";

export function toInr(value: number, currency: string, fx: Record<string, number>) {
  return value * (fx[currency] ?? 1);
}

export function fromInr(value: number, currency: string, fx: Record<string, number>) {
  return currency === "INR" ? value : value / (fx[currency] ?? 1);
}

export function fmt(value: number | null | undefined, currency: string) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const symbol = symbols[currency] ?? `${currency} `;
  const abs = Math.abs(value);
  if (currency === "INR") {
    if (abs >= 1e7) return `₹${(value / 1e7).toFixed(2)} Cr`;
    if (abs >= 1e5) return `₹${(value / 1e5).toFixed(1)}L`;
    return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  }
  if (abs >= 1e6) return `${symbol}${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${symbol}${(value / 1e3).toFixed(1)}K`;
  return `${symbol}${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function fmtUnit(value: number | null | undefined, currency: string) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const symbol = symbols[currency] ?? `${currency} `;
  const abs = Math.abs(value);
  const digits = abs < 1 ? 4 : abs < 1000 ? 2 : 0;
  const locale = currency === "INR" ? "en-IN" : undefined;
  return `${symbol}${value.toLocaleString(locale, {
    minimumFractionDigits: Number.isInteger(value) ? 0 : Math.min(digits, 2),
    maximumFractionDigits: digits,
  })}`;
}

export function fmtPlain(value: number | null | undefined, decimals = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function fmtPct(value: number | null | undefined, signed = false) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const prefix = signed && value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(1)}%`;
}

export function fmtDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getDate()} ${date.toLocaleString("en", { month: "short", year: "numeric" })}`;
}

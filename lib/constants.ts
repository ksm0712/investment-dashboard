export const currencies = ["INR", "USD", "SGD", "EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "HKD", "CNY", "AED"];

export const symbols: Record<string, string> = {
  INR: "₹",
  USD: "$",
  SGD: "S$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  AUD: "A$",
  CAD: "C$",
  CHF: "CHF ",
  HKD: "HK$",
  CNY: "¥",
  AED: "د.إ",
};

export const marketCurrency: Record<string, string> = {
  India: "INR",
  "United States": "USD",
  Singapore: "SGD",
  "United Kingdom": "GBP",
  Europe: "EUR",
  Japan: "JPY",
  "Hong Kong": "HKD",
  China: "CNY",
  Australia: "AUD",
  Canada: "CAD",
  Switzerland: "CHF",
  Germany: "EUR",
  France: "EUR",
  Netherlands: "EUR",
  UAE: "AED",
};

export const markets = [
  "India",
  "United States",
  "Singapore",
  "United Kingdom",
  "Europe",
  "Japan",
  "Hong Kong",
  "China",
  "Australia",
  "Canada",
  "Switzerland",
  "Germany",
  "France",
  "Netherlands",
  "UAE",
  "Other",
];

export const marketExchanges: Record<string, string[]> = {
  India: ["NSE", "BSE", "Other"],
  "United States": ["NASDAQ", "NYSE", "AMEX", "OTC", "Other"],
  Singapore: ["SGX", "Other"],
  "United Kingdom": ["LSE", "Other"],
  Europe: ["Euronext", "XETRA", "SIX", "Borsa Italiana", "Madrid", "Other"],
  Japan: ["TSE", "Other"],
  "Hong Kong": ["HKEX", "Other"],
  China: ["SSE", "SZSE", "Other"],
  Australia: ["ASX", "Other"],
  Canada: ["TSX", "TSXV", "Other"],
  Switzerland: ["SIX", "Other"],
  Germany: ["XETRA", "Frankfurt", "Other"],
  France: ["Euronext", "Other"],
  Netherlands: ["Euronext", "Other"],
  UAE: ["DFM", "ADX", "Nasdaq Dubai", "Other"],
  Other: ["Other"],
};

export const fxFallback: Record<string, number> = {
  INR: 1,
  USD: 83.5,
  SGD: 62,
  EUR: 91,
  GBP: 106,
  JPY: 0.55,
  AUD: 55,
  CAD: 61,
  CHF: 94,
  HKD: 10.7,
  CNY: 11.6,
  AED: 22.7,
};

export const palette = ["#111827", "#2563eb", "#047857", "#b45309", "#7c3aed", "#be123c", "#0891b2", "#4b5563"];

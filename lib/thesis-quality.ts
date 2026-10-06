export type ThesisQualityCheck = {
  id: "specific" | "direction" | "timeframe" | "risk";
  label: string;
  passed: boolean;
  guidance: string;
};

const METRIC_PATTERN = /\b(revenue|sales|margin|earnings|eps|cash flow|fcf|customers?|subscribers?|arr|bookings?|market share|debt|returns?|roic|roe|ebitda|profit|costs?|volume|units?|retention|churn)\b/i;
const DIRECTION_PATTERN = /\b(grow|increase|expand|improve|rise|accelerate|decline|decrease|contract|fall|remain|stay|hold|stabil|above|below|at least|no more than|outperform)\w*/i;
const TIME_PATTERN = /\b(next|within|over)\s+(quarter|year|\d+\s*(?:months?|quarters?|years?))\b|\b(20\d{2}|q[1-4]|fy\s*\d{2,4}|near[- ]term|long[- ]term)\b/i;
const RISK_PATTERN = /\b(risk|unless|could fail|downside|concern|threat|competition|regulation|concentration|execution|dilution|debt|slowdown)\b/i;

export function thesisQuality(thesis: string) {
  const text = thesis.trim();
  const checks: ThesisQualityCheck[] = [
    { id: "specific", label: "Measurable driver", passed: METRIC_PATTERN.test(text), guidance: "Name the operating or financial metric you expect to change." },
    { id: "direction", label: "Expected direction", passed: DIRECTION_PATTERN.test(text), guidance: "State whether the metric should grow, decline, or remain above a threshold." },
    { id: "timeframe", label: "Time horizon", passed: TIME_PATTERN.test(text), guidance: "Add a quarter, year, or explicit period for the claim." },
    { id: "risk", label: "Failure condition", passed: RISK_PATTERN.test(text), guidance: "Name the risk or evidence that would invalidate the thesis." },
  ];
  const passed = checks.filter((check) => check.passed).length;
  return { score: Math.round((passed / checks.length) * 100), checks };
}

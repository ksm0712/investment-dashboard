import assert from "node:assert/strict";
import test from "node:test";
import type { AiProvider } from "./ai-provider.ts";
import { analyzeResearch, validateResearchAnalysis } from "./ai-research.ts";
import { calculateAsset } from "./portfolio-engine.ts";
import type { Security } from "./types.ts";

function security(): Security {
  const calculation = calculateAsset({ currentPrice: 75, targetPrice: 120, week52Low: 65, week52High: 115, allocation: 2_000, lots: [] });
  return {
    ...calculation,
    id: 7, portfolioId: 1, name: "Example Systems", assetType: "Stock", currency: "USD", value: 0, valueInr: 0,
    annualIncome: null, returnPct: null, quantity: null, ticker: "TEST", isin: null, priceSource: null, priceSymbol: "TEST",
    latestPrice: 75, changePercent: -2, sector: "Technology", industry: "Software", trailingPe: null, forwardPe: null,
    pegRatio: null, priceAsOn: null, latestValue: null, latestValueInr: null, refreshStatus: null, refreshNote: null,
    refreshedAt: null, country: "United States", pricingMode: "auto", exchange: "NASDAQ", costPrice: null, purchaseDate: null,
    targetPrice: 120, secondaryTargetPrice: null, targetSource: null, targetAsOn: null, week52Low: 65, week52High: 115,
    marketDataSource: null, marketDataAsOn: null, allocation: 2_000, lots: [], source: "Investments",
  };
}

test("validateResearchAnalysis rejects citations outside retrieved context", () => {
  assert.throws(() => validateResearchAnalysis({
    businessOutlook: "mixed", riskLevel: "medium", evidenceSignal: "unclear", summary: "Evidence is mixed.",
    positiveEvidence: [{ claim: "Revenue grew.", citationIds: ["C99"] }], risks: [], thesisChecks: [], limitations: [],
  }, ["C1"]), /unknown citation/);
});

test("analyzeResearch keeps the deterministic action separate and returns validated citations", async () => {
  const provider: AiProvider = {
    name: "test",
    model: "scripted",
    async generate(request) {
      assert.match(request.prompt, /numericalAction/);
      assert.match(request.prompt, /Do not recommend buying, selling/);
      return {
        provider: "test", model: "scripted", inputTokens: 200, outputTokens: 80,
        content: JSON.stringify({
          businessOutlook: "mixed",
          riskLevel: "high",
          evidenceSignal: "contradicts",
          summary: "Customer losses contradict the growth thesis.",
          positiveEvidence: [{ claim: "Recurring revenue increased.", citationIds: ["C1"] }],
          risks: [{ claim: "The largest customer ended its contract.", citationIds: ["C1"] }],
          thesisChecks: [{ statement: "Enterprise demand will grow.", status: "contradicted", explanation: "A major customer ended its contract.", citationIds: ["C1"] }],
          limitations: ["Only one report was analyzed."],
        }),
      };
    },
  };
  const result = await analyzeResearch({
    security: security(),
    thesis: "Enterprise demand and recurring revenue will grow.",
    document: {
      title: "Example Systems Q2 report",
      url: "https://example.com/q2",
      text: "Recurring revenue increased by 12%. However, the largest enterprise customer ended its contract and management reduced next-quarter guidance. ".repeat(5),
    },
    provider,
  });
  assert.equal(result.numericalAction, security().action);
  assert.equal(result.analysis.evidenceSignal, "contradicts");
  assert.equal(result.citations[0].sourceUrl, "https://example.com/q2");
  assert.equal(result.provider, "test");
});

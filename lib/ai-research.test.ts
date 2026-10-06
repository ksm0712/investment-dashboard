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
    positiveEvidence: [{ claim: "Revenue grew.", citationIds: ["C99"] }], risks: [], thesisChecks: [], evidenceGaps: [], monitoringQuestions: [], limitations: [],
  }, ["C1"]), /unknown citation/);
});

test("analyzeResearch keeps the deterministic action separate and returns validated citations", async () => {
  const provider: AiProvider = {
    name: "test",
    model: "scripted",
    async generate(request) {
      assert.doesNotMatch(request.prompt, /numericalAction/);
      assert.match(request.prompt, /Do not make a buy, sell/);
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
          evidenceGaps: [],
          monitoringQuestions: ["Does enterprise recurring revenue return to growth next quarter?"],
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

test("missing disclosure cannot be promoted into positive thesis evidence", async () => {
  const provider: AiProvider = {
    name: "test",
    model: "scripted",
    async generate() {
      return {
        provider: "test", model: "scripted", inputTokens: 100, outputTokens: 50,
        content: JSON.stringify({
          businessOutlook: "positive",
          riskLevel: "low",
          evidenceSignal: "supports",
          summary: "The model claimed the thesis was supported.",
          positiveEvidence: [{ claim: "Customer spending grew.", citationIds: ["C1"] }],
          risks: [],
          thesisChecks: [{ statement: "Existing-customer spending grew.", status: "supported", explanation: "Spending grew.", citationIds: ["C1"] }],
          evidenceGaps: [],
          monitoringQuestions: [],
          limitations: [],
        }),
      };
    },
  };
  const result = await analyzeResearch({
    security: security(),
    thesis: "Existing-customer spending will grow.",
    document: {
      title: "Example Systems update",
      text: "The company did not separate existing-customer spending from new-customer revenue, so comparable growth data was not disclosed. ".repeat(5),
    },
    provider,
  });
  assert.equal(result.analysis.evidenceSignal, "unclear");
  assert.equal(result.analysis.riskLevel, "medium");
  assert.equal(result.analysis.businessOutlook, "mixed");
  assert.deepEqual(result.analysis.positiveEvidence, []);
  assert.equal(result.analysis.thesisChecks[0].status, "unclear");
});

test("generic filing risks are removed when they do not address the thesis", async () => {
  const provider: AiProvider = {
    name: "test",
    model: "scripted",
    async generate() {
      return {
        provider: "test", model: "scripted", inputTokens: 100, outputTokens: 50,
        content: JSON.stringify({
          businessOutlook: "mixed",
          riskLevel: "medium",
          evidenceSignal: "unclear",
          summary: "The filing does not directly establish stability in recurring revenue.",
          positiveEvidence: [{ claim: "Services and subscription revenue increased.", citationIds: ["C2"] }],
          risks: [{ claim: "Supply constraints may adversely affect revenue.", citationIds: ["C1"] }],
          thesisChecks: [{ statement: "Recurring revenue will remain stable.", status: "unclear", explanation: "The passage is not about recurring revenue.", citationIds: ["C1"] }],
          evidenceGaps: [{ claim: "Recurring revenue will remain stable.", neededEvidence: "Comparable recurring revenue or retention data." }],
          monitoringQuestions: ["Did recurring revenue and retention remain stable?"],
          limitations: [],
        }),
      };
    },
  };
  const document = {
    title: "Example Systems filing",
    text: "A sufficiently long filing body for the test. ".repeat(10),
  };
  const result = await analyzeResearch({
    security: security(),
    thesis: "Recurring revenue will remain stable.",
    document,
    provider,
    retrievedEvidence: {
      chunks: [
        { id: "C1", text: "Supply chain constraints may adversely affect total revenue.", heading: "Risk factors", sourceTitle: document.title, lexicalScore: 0.1, score: 0.1 },
        { id: "C2", text: "Services net sales and paid subscriptions increased year over year.", heading: "Results", sourceTitle: document.title, lexicalScore: 1, score: 1 },
      ],
      retrievalMethod: "lexical",
      totalChunks: 2,
    },
  });
  assert.deepEqual(result.analysis.risks, []);
  assert.equal(result.analysis.positiveEvidence.length, 1);
  assert.deepEqual(result.analysis.thesisChecks[0].citationIds, []);
  assert.deepEqual(result.citations.map((citation) => citation.chunkId), ["C2"]);
});

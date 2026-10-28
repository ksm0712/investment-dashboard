import assert from "node:assert/strict";
import test from "node:test";
import type { AiProvider } from "./ai-provider.ts";
import { analyzeResearch, evidenceQualityFor, researchInputHash, validateResearchAnalysis } from "./ai-research.ts";
import { RESEARCH_PIPELINE_VERSION } from "./research-version.ts";
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
  assert.equal(result.pipelineVersion, RESEARCH_PIPELINE_VERSION);
});

test("research cache identity includes the current analysis method", () => {
  const hash = researchInputHash(security(), "Recurring revenue will grow next year.", { title: "Report", text: "Evidence ".repeat(20) });
  assert.equal(hash.length, 64);
  assert.equal(RESEARCH_PIPELINE_VERSION, 4);
});

test("evidence quality reports direct answers separately from citations", () => {
  const quality = evidenceQualityFor({
    businessOutlook: "mixed", riskLevel: "medium", evidenceSignal: "unclear", summary: "Mixed.", positiveEvidence: [], risks: [], evidenceGaps: [], monitoringQuestions: [], limitations: [],
    thesisChecks: [
      { statement: "Revenue grows", status: "supported", explanation: "Direct.", citationIds: ["C1"] },
      { statement: "Margin expands", status: "unclear", explanation: "Missing.", citationIds: [] },
    ],
  }, [{ title: "10-Q", text: "Evidence", date: "2026-06-30" }]);
  assert.deepEqual(quality, { rating: "partial", directlyAnswered: 1, citationRate: 50, sourceCount: 1, freshestSourceDate: "2026-06-30" });
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

test("analysis repairs one malformed structured response instead of failing the run", async () => {
  let calls = 0;
  const provider: AiProvider = {
    name: "test",
    model: "repair",
    async generate(request) {
      calls += 1;
      if (calls === 1) return { provider: "test", model: "repair", inputTokens: 10, outputTokens: 5, content: "not valid json" };
      assert.match(request.prompt, /PREVIOUS_INVALID_OUTPUT/);
      return { provider: "test", model: "repair", inputTokens: 12, outputTokens: 8, content: `Here is the corrected result:\n${JSON.stringify({
        businessOutlook: "mixed", riskLevel: "medium", evidenceSignal: "unclear", summary: "The filing does not establish future growth.",
        positiveEvidence: [], risks: [], thesisChecks: [{ statement: "Recurring revenue will grow.", status: "unclear", explanation: "Only historical revenue was reported.", citationIds: [] }],
        evidenceGaps: [{ claim: "Recurring revenue growth", neededEvidence: "Current recurring revenue guidance." }], monitoringQuestions: ["What is current recurring revenue growth?"], limitations: [],
      })}` };
    },
  };
  const result = await analyzeResearch({ security: security(), thesis: "Recurring revenue will grow next year.", document: { title: "Report", text: "Historical revenue increased, but no forward guidance was provided. ".repeat(8) }, provider });
  assert.equal(calls, 2);
  assert.equal(result.analysis.evidenceSignal, "unclear");
  assert.equal(result.inputTokens, 22);
  assert.equal(result.outputTokens, 13);
});

test("analysis adds an explicit unclear check when the model skips a thesis claim", async () => {
  const provider: AiProvider = {
    name: "test",
    model: "incomplete-checks",
    async generate() {
      return { provider: "test", model: "incomplete-checks", inputTokens: 20, outputTokens: 10, content: JSON.stringify({
        businessOutlook: "positive", riskLevel: "low", evidenceSignal: "supports", summary: "The thesis is fully supported.",
        positiveEvidence: [{ claim: "Recurring revenue grew.", citationIds: ["C1"] }], risks: [],
        thesisChecks: [{ statement: "Recurring revenue will grow", status: "supported", explanation: "Recurring revenue grew 20 percent.", citationIds: ["C1"] }],
        evidenceGaps: [], monitoringQuestions: [], limitations: [],
      }) };
    },
  };
  const result = await analyzeResearch({
    security: security(),
    thesis: "Recurring revenue will grow while gross margin remains above 60%.",
    document: { title: "Report", text: "Management expects recurring revenue to grow 20 percent under its current guidance. ".repeat(12) },
    provider,
  });
  assert.deepEqual(result.analysis.thesisChecks.map((check) => check.status), ["supported", "unclear"]);
  assert.equal(result.analysis.evidenceSignal, "unclear");
  assert.deepEqual(result.analysis.coverage, { totalClaims: 2, supported: 1, contradicted: 0, unclear: 1, citedClaims: 1 });
  assert.match(result.analysis.summary, /1 supported, 1 still unclear/);
});

test("historical results alone cannot support a forward-looking thesis", async () => {
  const provider: AiProvider = {
    name: "test", model: "historical-only",
    async generate() {
      return { provider: "test", model: "historical-only", inputTokens: 10, outputTokens: 10, content: JSON.stringify({
        businessOutlook: "positive", riskLevel: "low", evidenceSignal: "supports", summary: "Revenue growth supports the thesis.",
        positiveEvidence: [{ claim: "Revenue grew 20 percent.", citationIds: ["C1"] }], risks: [],
        thesisChecks: [{ statement: "Revenue will grow next year", status: "supported", explanation: "Revenue grew historically.", citationIds: ["C1"] }],
        evidenceGaps: [], monitoringQuestions: [], limitations: [],
      }) };
    },
  };
  const result = await analyzeResearch({ security: security(), thesis: "Revenue will grow next year.", document: { title: "10-K", text: "Revenue grew 20 percent during the completed fiscal year. ".repeat(12) }, provider });
  assert.equal(result.analysis.thesisChecks[0].status, "unclear");
  assert.equal(result.analysis.evidenceSignal, "unclear");
  assert.match(result.analysis.thesisChecks[0].explanation, /historical performance/);
});

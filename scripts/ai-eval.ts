import { analyzeResearch, retrieveResearchEvidence } from "../lib/ai-research.ts";
import { getAiProvider } from "../lib/ai-provider.ts";
import { calculateAsset } from "../lib/portfolio-engine.ts";
import { tokenize } from "../lib/research-retrieval.ts";
import type { Security } from "../lib/types.ts";
import { AI_EVAL_CASES, evalDocument } from "./fixtures/ai-eval-cases.ts";

function security(id: number, name: string): Security {
  const calculation = calculateAsset({ currentPrice: 70, targetPrice: 120, week52Low: 60, week52High: 115, allocation: 5_000, lots: [] });
  return {
    ...calculation, id, portfolioId: 1, name, assetType: "Stock", currency: "USD", value: 0, valueInr: 0,
    annualIncome: null, returnPct: null, quantity: null, ticker: `EVAL${id}`, isin: null, priceSource: "fixture", priceSymbol: `EVAL${id}`,
    latestPrice: 70, changePercent: 0, sector: null, industry: null, trailingPe: null, forwardPe: null, pegRatio: null,
    priceAsOn: "2026-06-30", latestValue: null, latestValueInr: null, refreshStatus: null, refreshNote: null, refreshedAt: null,
    country: "United States", pricingMode: "manual", exchange: "NASDAQ", costPrice: null, purchaseDate: null, targetPrice: 120,
    secondaryTargetPrice: null, targetSource: "fixture", targetAsOn: "2026-06-30", week52Low: 60, week52High: 115,
    marketDataSource: "fixture", marketDataAsOn: "2026-06-30", allocation: 5_000, lots: [], source: "AI evaluation",
  };
}

function percentile(values: number[], percentileValue: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(percentileValue * sorted.length) - 1)];
}

async function main() {
const requestedLimit = Number(process.argv.find((argument) => argument.startsWith("--limit="))?.split("=")[1] || AI_EVAL_CASES.length);
const requestedCase = process.argv.find((argument) => argument.startsWith("--case="))?.split("=")[1];
const cases = requestedCase
  ? AI_EVAL_CASES.filter((testCase) => testCase.id === requestedCase)
  : AI_EVAL_CASES.slice(0, Math.max(1, Math.min(requestedLimit, AI_EVAL_CASES.length)));
if (!cases.length) throw new Error(`Unknown evaluation case: ${requestedCase}`);
const provider = getAiProvider();
const latencies: number[] = [];
let retrievalHits = 0;
let structuredValid = 0;
let signalCorrect = 0;
let riskCorrect = 0;
let citationRelevant = 0;
let citationTotal = 0;
let inputTokens = 0;
let outputTokens = 0;
let hybridRuns = 0;
const prepared: Array<{
  document: ReturnType<typeof evalDocument>;
  retrieval: Awaited<ReturnType<typeof retrieveResearchEvidence>>;
  relevantIds: Set<string>;
}> = [];

for (let index = 0; index < cases.length; index += 1) {
  const testCase = cases[index];
  const document = evalDocument(testCase);
  const retrieval = await retrieveResearchEvidence(document, testCase.thesis, provider, 5);
  if (retrieval.retrievalMethod === "hybrid") hybridRuns += 1;
  const evidenceTerms = new Set(tokenize(testCase.evidence));
  const relevantIds = new Set(retrieval.chunks.filter((chunk) => {
    if (testCase.markers.some((marker) => chunk.text.includes(marker))) return true;
    const terms = [...new Set(tokenize(chunk.text))];
    const overlap = terms.filter((term) => evidenceTerms.has(term)).length;
    return overlap / Math.max(1, evidenceTerms.size) >= 0.3;
  }).map((chunk) => chunk.id));
  if (relevantIds.size > 0) retrievalHits += 1;
  prepared.push({ document, retrieval, relevantIds });
}

for (let index = 0; index < cases.length; index += 1) {
  const testCase = cases[index];
  const { document, retrieval, relevantIds } = prepared[index];
  const started = performance.now();
  try {
    const run = await analyzeResearch({ security: security(index + 1, testCase.company), thesis: testCase.thesis, document, provider, topK: 5, retrievedEvidence: retrieval });
    structuredValid += 1;
    latencies.push(performance.now() - started);
    if (run.analysis.evidenceSignal === testCase.expectedSignal) signalCorrect += 1;
    if (run.analysis.riskLevel === testCase.expectedRisk) riskCorrect += 1;
    if (run.inputTokens) inputTokens += run.inputTokens;
    if (run.outputTokens) outputTokens += run.outputTokens;
    for (const citation of run.citations) {
      citationTotal += 1;
      if (relevantIds.has(citation.chunkId)) citationRelevant += 1;
    }
    process.stdout.write(`${testCase.id}\t${run.analysis.evidenceSignal}/${testCase.expectedSignal}\t${run.analysis.riskLevel}/${testCase.expectedRisk}\t${run.retrievalMethod}\t${run.latencyMs}ms\n`);
    if (process.argv.includes("--verbose")) process.stdout.write(`${JSON.stringify({ analysis: run.analysis, citations: run.citations.map((citation) => citation.chunkId), relevantIds: [...relevantIds] }, null, 2)}\n`);
  } catch (error) {
    latencies.push(performance.now() - started);
    process.stdout.write(`${testCase.id}\tERROR\t${error instanceof Error ? error.message : String(error)}\n`);
  }
}

const percentage = (value: number, denominator: number) => denominator ? Number((100 * value / denominator).toFixed(1)) : null;
const result = {
  measuredAt: new Date().toISOString(),
  provider: provider.name,
  model: provider.model,
  cases: cases.length,
  retrievalRecallAt5Pct: percentage(retrievalHits, cases.length),
  structuredOutputValidityPct: percentage(structuredValid, cases.length),
  evidenceSignalAccuracyPct: percentage(signalCorrect, cases.length),
  riskLevelAccuracyPct: percentage(riskCorrect, cases.length),
  citationPrecisionPct: percentage(citationRelevant, citationTotal),
  hybridRetrievalPct: percentage(hybridRuns, cases.length),
  p50EndToEndLatencyMs: Math.round(percentile(latencies, 0.5) || 0),
  p95EndToEndLatencyMs: Math.round(percentile(latencies, 0.95) || 0),
  averageInputTokens: structuredValid ? Math.round(inputTokens / structuredValid) : null,
  averageOutputTokens: structuredValid ? Math.round(outputTokens / structuredValid) : null,
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (structuredValid !== cases.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

export type EvidenceSignal = "supports" | "unclear" | "contradicts";
export type BusinessOutlook = "positive" | "mixed" | "negative";
export type ResearchRisk = "low" | "medium" | "high";
export type ThesisCheckStatus = "supported" | "unclear" | "contradicted";

export type ResearchChunk = {
  id: string;
  text: string;
  heading?: string | null;
  sourceTitle: string;
  sourceUrl?: string | null;
  sourceDate?: string | null;
};

export type ResearchCitation = {
  chunkId: string;
  excerpt: string;
  sourceTitle: string;
  sourceUrl: string | null;
};

export type ResearchClaim = {
  claim: string;
  citationIds: string[];
};

export type ThesisCheck = {
  statement: string;
  status: ThesisCheckStatus;
  explanation: string;
  citationIds: string[];
};

export type ResearchAnalysis = {
  businessOutlook: BusinessOutlook;
  riskLevel: ResearchRisk;
  evidenceSignal: EvidenceSignal;
  summary: string;
  positiveEvidence: ResearchClaim[];
  risks: ResearchClaim[];
  thesisChecks: ThesisCheck[];
  limitations: string[];
};

export type ResearchRun = {
  securityId: number;
  thesis: string;
  numericalAction: string;
  analysis: ResearchAnalysis;
  citations: ResearchCitation[];
  sourceTitle: string;
  sourceUrl: string | null;
  sourceDate: string | null;
  provider: string;
  model: string;
  retrievalMethod: "lexical" | "hybrid";
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  cached: boolean;
  createdAt: string;
};

export type ResearchRecord = {
  thesis: string;
  analysis: ResearchRun | null;
};

export type ResearchDocument = {
  title: string;
  text: string;
  url?: string | null;
  date?: string | null;
};


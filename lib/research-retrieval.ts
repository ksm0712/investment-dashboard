import type { ResearchChunk, ResearchDocument } from "./ai-research-types.ts";

const STOP_WORDS = new Set([
  "a", "about", "after", "all", "also", "an", "and", "are", "as", "at", "be", "because", "been", "before",
  "but", "by", "can", "company", "could", "did", "do", "does", "for", "from", "had", "has", "have", "how",
  "i", "if", "in", "into", "is", "it", "its", "may", "more", "most", "not", "of", "on", "or", "our", "should",
  "so", "than", "that", "the", "their", "then", "there", "these", "they", "this", "to", "up", "was", "we", "were",
  "what", "when", "which", "while", "who", "will", "with", "would", "you", "your",
]);

const QUERY_EXPANSIONS: Array<[RegExp, string]> = [
  [/\b(recurring|subscription|subscriptions|renewal|renewals)\b/i, "recurring subscription subscriptions renewal renewals retention churn ARR annual recurring revenue services"],
  [/\b(revenue|sales)\b/i, "revenue sales net sales turnover bookings billings"],
  [/\b(stable|steady|unchanged|maintain|maintaining|remain)\b/i, "stable steady unchanged maintain maintained flat consistent"],
  [/\b(grow|growth|increase|expand|expansion)\b/i, "grow growth grew increase increased expand expanded expansion guidance outlook"],
  [/\b(decline|decrease|fall|weaken|contraction)\b/i, "decline declined decrease decreased fell fall weakened contraction"],
  [/\b(margin|profit|profitability|earnings)\b/i, "gross margin operating margin profit profitability earnings income loss costs expenses"],
  [/\b(customer|customers|client|clients)\b/i, "customer customers client clients retention churn renewal concentration demand"],
  [/\b(demand|orders|backlog|bookings)\b/i, "demand orders backlog bookings pipeline volume units shipments"],
  [/\b(cash flow|cashflow|liquidity|financing)\b/i, "cash flow cashflow liquidity financing debt covenant capital expenditure"],
  [/\b(market share|competition|competitive)\b/i, "market share competition competitive competitor pricing adoption"],
  [/\b(regulation|regulatory|approval|certification)\b/i, "regulation regulatory approval certification investigation compliance regulator"],
];

export type RankedChunk = ResearchChunk & { lexicalScore: number; semanticScore?: number; score: number };

export function tokenize(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9%$.-]+/g, " ")
    .split(/\s+/)
    .map((term) => term.replace(/^[.$-]+|[.$-]+$/g, ""))
    .filter((term) => term.length > 1 && !STOP_WORDS.has(term));
}

function meaningfulFacet(text: string) {
  return tokenize(text).length >= 2;
}

/** Split a thesis into independently retrievable claims without asking the model first. */
export function extractThesisFacets(thesis: string) {
  const normalized = thesis.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const clauses = normalized
    .split(/(?:[.;\n]+|\b(?:while|whereas|but|however|and the main risk is|main risk is)\b)/i)
    .map((part) => part.replace(/^\s*(?:i\s+(?:expect|believe|think)|that)\s+/i, "").trim())
    .filter(meaningfulFacet);
  const unique = [...new Set(clauses)];
  return (unique.length ? unique : [normalized]).slice(0, 5);
}

function expandQuery(query: string) {
  const expansions = QUERY_EXPANSIONS
    .filter(([pattern]) => pattern.test(query))
    .map(([, terms]) => terms);
  return [query, ...expansions].join(" ");
}

export function buildResearchQueries(thesis: string) {
  const facets = extractThesisFacets(thesis);
  return [...new Set([thesis, ...facets].map(expandQuery))];
}

function cleanDocumentText(text: string) {
  return text
    .replace(/\r/g, "")
    .replace(/[\t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function chunkDocument(document: ResearchDocument, maxChars = 1_800, overlapChars = 240): ResearchChunk[] {
  const clean = cleanDocumentText(document.text);
  if (!clean) return [];
  const paragraphs = clean.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
  const chunks: ResearchChunk[] = [];
  let current = "";
  let currentHeading: string | null = null;

  function isHeading(paragraph: string) {
    if (paragraph.length > 140 || /[.!?]$/.test(paragraph)) return false;
    return /^(?:item\s+\d+[a-z]?\.?|part\s+[ivx]+|business|risk factors|management['’]s discussion|results of operations|liquidity|segment information|outlook|guidance)/i.test(paragraph)
      || (paragraph.length >= 4 && paragraph === paragraph.toUpperCase() && /[A-Z]/.test(paragraph));
  }

  function pushCurrent() {
    const text = current.trim();
    if (!text) return;
    chunks.push({
      id: `C${chunks.length + 1}`,
      text,
      heading: currentHeading,
      sourceTitle: document.title,
      sourceUrl: document.url || null,
      sourceDate: document.date || null,
    });
    current = "";
  }

  for (const paragraph of paragraphs) {
    if (isHeading(paragraph)) {
      pushCurrent();
      currentHeading = paragraph;
      continue;
    }
    if (paragraph.length > maxChars) {
      if (current.trim()) pushCurrent();
      let start = 0;
      while (start < paragraph.length) {
        let end = Math.min(start + maxChars, paragraph.length);
        if (end < paragraph.length) {
          const boundary = Math.max(paragraph.lastIndexOf(". ", end), paragraph.lastIndexOf(" ", end));
          if (boundary > start + Math.floor(maxChars * 0.6)) end = boundary + 1;
        }
        const slice = paragraph.slice(start, end).trim();
        if (slice) {
          chunks.push({
            id: `C${chunks.length + 1}`,
            text: slice,
            heading: currentHeading,
            sourceTitle: document.title,
            sourceUrl: document.url || null,
            sourceDate: document.date || null,
          });
        }
        start = Math.max(end - overlapChars, start + 1);
      }
      current = "";
      continue;
    }
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length > maxChars && current) pushCurrent();
    current = current ? `${current}\n\n${paragraph}` : paragraph;
  }
  if (current.trim()) pushCurrent();
  return chunks;
}

function termFrequencies(tokens: string[]) {
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
  return counts;
}

export function rankLexically(chunks: ResearchChunk[], query: string): RankedChunk[] {
  if (!chunks.length) return [];
  const queryTerms = [...new Set(tokenize(query))];
  const tokenized = chunks.map((chunk) => tokenize(`${chunk.heading || ""} ${chunk.text}`));
  const frequencies = tokenized.map(termFrequencies);
  const documentFrequency = new Map<string, number>();
  for (const terms of queryTerms) {
    documentFrequency.set(terms, frequencies.filter((frequency) => frequency.has(terms)).length);
  }
  const averageLength = tokenized.reduce((sum, terms) => sum + terms.length, 0) / Math.max(1, tokenized.length);
  const k1 = 1.2;
  const b = 0.75;

  return chunks
    .map((chunk, index) => {
      let lexicalScore = 0;
      for (const term of queryTerms) {
        const frequency = frequencies[index].get(term) || 0;
        if (!frequency) continue;
        const containing = documentFrequency.get(term) || 0;
        const inverseFrequency = Math.log(1 + (chunks.length - containing + 0.5) / (containing + 0.5));
        const normalized = frequency * (k1 + 1)
          / (frequency + k1 * (1 - b + b * tokenized[index].length / Math.max(1, averageLength)));
        lexicalScore += inverseFrequency * normalized;
      }
      return { ...chunk, lexicalScore, score: lexicalScore };
    })
    .sort((a, bChunk) => bChunk.score - a.score || a.id.localeCompare(bChunk.id));
}

export function cosineSimilarity(left: number[], right: number[]) {
  if (!left.length || left.length !== right.length) return 0;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] ** 2;
    rightMagnitude += right[index] ** 2;
  }
  if (!leftMagnitude || !rightMagnitude) return 0;
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

export function rankHybrid(
  lexical: RankedChunk[],
  queryEmbedding: number[],
  chunkEmbeddings: number[][],
): RankedChunk[] {
  const maxLexical = Math.max(...lexical.map((chunk) => chunk.lexicalScore), 1);
  return lexical
    .map((chunk, index) => {
      const semanticScore = cosineSimilarity(queryEmbedding, chunkEmbeddings[index] || []);
      const score = 0.45 * (chunk.lexicalScore / maxLexical) + 0.55 * Math.max(0, semanticScore);
      return { ...chunk, semanticScore, score };
    })
    .sort((a, bChunk) => bChunk.score - a.score || a.id.localeCompare(bChunk.id));
}

/**
 * Rank once per thesis facet, then fuse the lists. This prevents a broad clause
 * from drowning out a smaller but decision-critical clause such as retention.
 */
export function rankAcrossQueries(chunks: ResearchChunk[], queries: string[]): RankedChunk[] {
  if (!chunks.length) return [];
  const rankings = (queries.length ? queries : [""]).map((query) => rankLexically(chunks, query));
  const scores = new Map<string, { reciprocalRank: number; bestNormalized: number }>();
  for (const ranking of rankings) {
    const maxScore = Math.max(...ranking.map((chunk) => chunk.lexicalScore), 0);
    ranking.forEach((chunk, index) => {
      const current = scores.get(chunk.id) || { reciprocalRank: 0, bestNormalized: 0 };
      if (chunk.lexicalScore > 0) current.reciprocalRank += 1 / (20 + index);
      current.bestNormalized = Math.max(current.bestNormalized, maxScore > 0 ? chunk.lexicalScore / maxScore : 0);
      scores.set(chunk.id, current);
    });
  }
  return chunks
    .map((chunk) => {
      const fused = scores.get(chunk.id) || { reciprocalRank: 0, bestNormalized: 0 };
      const lexicalScore = fused.bestNormalized;
      return { ...chunk, lexicalScore, score: 0.75 * fused.bestNormalized + 0.25 * fused.reciprocalRank };
    })
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
}

export function rankHybridAcrossQueries(
  lexical: RankedChunk[],
  queryEmbeddings: number[][],
  chunkEmbeddings: number[][],
): RankedChunk[] {
  return lexical
    .map((chunk, index) => {
      const semanticScore = Math.max(0, ...queryEmbeddings.map((query) => cosineSimilarity(query, chunkEmbeddings[index] || [])));
      const score = 0.45 * chunk.lexicalScore + 0.55 * semanticScore;
      return { ...chunk, semanticScore, score };
    })
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
}

export function buildResearchQuery(thesis: string) {
  return buildResearchQueries(thesis).join(" ");
}

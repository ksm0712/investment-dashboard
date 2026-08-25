import type { ResearchChunk, ResearchDocument } from "./ai-research-types.ts";

const STOP_WORDS = new Set([
  "a", "about", "after", "all", "also", "an", "and", "are", "as", "at", "be", "because", "been", "before",
  "but", "by", "can", "company", "could", "did", "do", "does", "for", "from", "had", "has", "have", "how",
  "i", "if", "in", "into", "is", "it", "its", "may", "more", "most", "not", "of", "on", "or", "our", "should",
  "so", "than", "that", "the", "their", "then", "there", "these", "they", "this", "to", "up", "was", "we", "were",
  "what", "when", "which", "while", "who", "will", "with", "would", "you", "your",
]);

export type RankedChunk = ResearchChunk & { lexicalScore: number; semanticScore?: number; score: number };

export function tokenize(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9%$.-]+/g, " ")
    .split(/\s+/)
    .map((term) => term.replace(/^[.$-]+|[.$-]+$/g, ""))
    .filter((term) => term.length > 1 && !STOP_WORDS.has(term));
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

  function pushCurrent() {
    const text = current.trim();
    if (!text) return;
    chunks.push({
      id: `C${chunks.length + 1}`,
      text,
      sourceTitle: document.title,
      sourceUrl: document.url || null,
      sourceDate: document.date || null,
    });
    current = text.slice(Math.max(0, text.length - overlapChars));
  }

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      if (current.trim()) pushCurrent();
      let start = 0;
      while (start < paragraph.length) {
        const end = Math.min(start + maxChars, paragraph.length);
        const slice = paragraph.slice(start, end).trim();
        if (slice) {
          chunks.push({
            id: `C${chunks.length + 1}`,
            text: slice,
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

export function buildResearchQuery(thesis: string) {
  return [
    thesis,
    "revenue growth decline demand margin profitability guidance outlook risk regulation competition customer loss",
    "management expects increased decreased material adverse uncertainty",
  ].filter(Boolean).join(" ");
}


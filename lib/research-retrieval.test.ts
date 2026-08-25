import assert from "node:assert/strict";
import test from "node:test";
import { buildResearchQuery, chunkDocument, cosineSimilarity, rankHybrid, rankLexically } from "./research-retrieval.ts";

test("chunkDocument creates stable, bounded citation ids", () => {
  const chunks = chunkDocument({
    title: "Example quarterly report",
    url: "https://example.com/report",
    text: ["Revenue grew by 18% during the quarter.", "Demand remained strong in enterprise markets.", "Management identified regulation as a material risk."].join("\n\n"),
  }, 65, 10);
  assert.ok(chunks.length >= 2);
  assert.deepEqual(chunks.map((chunk) => chunk.id), chunks.map((_, index) => `C${index + 1}`));
  assert.ok(chunks.every((chunk) => chunk.text.length <= 75));
});

test("lexical retrieval ranks the passage relevant to the thesis first", () => {
  const chunks = chunkDocument({
    title: "Example report",
    text: [
      "The company opened a new office and appointed two directors.",
      "Services revenue grew 24% and recurring subscription demand remained strong.",
      "Foreign exchange rates changed during the reporting period.",
    ].join("\n\n"),
  }, 90, 0);
  const ranked = rankLexically(chunks, buildResearchQuery("Services revenue and recurring subscriptions will grow."));
  assert.match(ranked[0].text, /Services revenue grew 24%/);
  assert.ok(ranked[0].score > ranked[1].score);
});

test("hybrid retrieval combines semantic and lexical scores", () => {
  const chunks = [
    { id: "C1", text: "Revenue expanded", sourceTitle: "Report", lexicalScore: 2, score: 2 },
    { id: "C2", text: "Demand weakened", sourceTitle: "Report", lexicalScore: 0.1, score: 0.1 },
  ];
  const ranked = rankHybrid(chunks, [1, 0], [[0, 1], [1, 0]]);
  assert.equal(ranked[0].id, "C2");
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
});

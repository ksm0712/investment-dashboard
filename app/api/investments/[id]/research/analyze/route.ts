import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getSecurities } from "@/lib/db";
import { AiProviderUnavailableError } from "@/lib/ai-provider";
import { analyzeResearch, researchInputHash } from "@/lib/ai-research";
import type { ResearchDocument, ResearchRun } from "@/lib/ai-research-types";
import { fetchLatestSecFiling, SecFilingError } from "@/lib/sec-filings";
import {
  AiRateLimitError,
  consumeAiRequest,
  getCachedResearchRun,
  getResearchRecord,
  saveResearchRun,
  saveResearchThesis,
} from "@/lib/research-store";

const MAX_MANUAL_DOCUMENT_CHARS = 250_000;

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: rawId } = await context.params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Invalid investment id." }, { status: 400 });
  const securities = await getSecurities(user.sub);
  const security = securities.find((item) => item.id === id);
  if (!security) return NextResponse.json({ error: "Investment not found." }, { status: 404 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "A JSON request body is required." }, { status: 400 });
  let thesis = typeof body.thesis === "string" ? body.thesis.trim() : "";
  if (!thesis) thesis = (await getResearchRecord(user.sub, id)).thesis;
  if (thesis.length < 10 || thesis.length > 2_000) {
    return NextResponse.json({ error: "Save an investment thesis between 10 and 2,000 characters first." }, { status: 400 });
  }
  await saveResearchThesis(user.sub, id, thesis);

  let document: ResearchDocument;
  const manualText = typeof body.documentText === "string" ? body.documentText.trim() : "";
  if (manualText) {
    if (manualText.length < 100 || manualText.length > MAX_MANUAL_DOCUMENT_CHARS) {
      return NextResponse.json({ error: `Report text must be between 100 and ${MAX_MANUAL_DOCUMENT_CHARS.toLocaleString()} characters.` }, { status: 400 });
    }
    let sourceUrl: string | null = null;
    if (typeof body.sourceUrl === "string" && body.sourceUrl.trim()) {
      try {
        const parsed = new URL(body.sourceUrl.trim());
        if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("unsupported protocol");
        sourceUrl = parsed.toString();
      } catch {
        return NextResponse.json({ error: "Source URL must be a valid HTTP or HTTPS address." }, { status: 400 });
      }
    }
    document = {
      title: typeof body.sourceTitle === "string" && body.sourceTitle.trim() ? body.sourceTitle.trim().slice(0, 200) : `${security.name} supplied report`,
      text: manualText,
      url: sourceUrl,
      date: typeof body.sourceDate === "string" ? body.sourceDate.slice(0, 10) : null,
    };
  } else {
    const ticker = security.priceSymbol || security.ticker;
    if (security.assetType !== "Stock" || security.country !== "United States" || !ticker) {
      return NextResponse.json({ error: "Automatic SEC research is available for U.S. stocks. Paste report text for this holding." }, { status: 400 });
    }
    try {
      document = await fetchLatestSecFiling(ticker);
    } catch (error) {
      if (error instanceof SecFilingError) return NextResponse.json({ error: error.message }, { status: error.code === "upstream" ? 502 : 400 });
      throw error;
    }
  }

  const inputHash = researchInputHash(security, thesis, document);
  const cached = await getCachedResearchRun(user.sub, id, inputHash);
  if (cached) return NextResponse.json({ run: cached, usage: { cached: true } });

  try {
    const usage = await consumeAiRequest(user.sub, id);
    const result = await analyzeResearch({ security, thesis, document });
    const run: ResearchRun = { ...result, cached: false };
    await saveResearchRun(user.sub, id, inputHash, run);
    return NextResponse.json({ run, usage: { ...usage, cached: false } });
  } catch (error) {
    if (error instanceof AiRateLimitError) return NextResponse.json({ error: error.message, limit: error.limit }, { status: 429 });
    if (error instanceof AiProviderUnavailableError) return NextResponse.json({ error: error.message }, { status: 503 });
    console.error("AI research failed", error);
    const message = error instanceof Error ? error.message : "AI research failed.";
    return NextResponse.json({ error: `AI research failed: ${message}` }, { status: 502 });
  }
}

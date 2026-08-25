import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getSecurities } from "@/lib/db";
import { providerConfigured } from "@/lib/ai-provider";
import { getResearchRecord, saveResearchThesis } from "@/lib/research-store";

async function ownedSecurity(userId: string, rawId: string) {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const securities = await getSecurities(userId);
  return securities.find((security) => security.id === id) || null;
}

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const security = await ownedSecurity(user.sub, id);
  if (!security) return NextResponse.json({ error: "Investment not found." }, { status: 404 });
  const record = await getResearchRecord(user.sub, security.id);
  const automaticSourceAvailable = security.assetType === "Stock"
    && security.country === "United States"
    && Boolean(security.priceSymbol || security.ticker);
  return NextResponse.json({ ...record, providerConfigured: providerConfigured(), automaticSourceAvailable });
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const security = await ownedSecurity(user.sub, id);
  if (!security) return NextResponse.json({ error: "Investment not found." }, { status: 404 });
  const body = await request.json().catch(() => null);
  const thesis = typeof body?.thesis === "string" ? body.thesis.trim() : "";
  if (thesis.length < 10 || thesis.length > 2_000) {
    return NextResponse.json({ error: "Investment thesis must be between 10 and 2,000 characters." }, { status: 400 });
  }
  await saveResearchThesis(user.sub, security.id, thesis);
  return NextResponse.json({ ok: true, thesis });
}

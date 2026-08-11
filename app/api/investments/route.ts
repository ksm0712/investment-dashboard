import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { addInvestment } from "@/lib/db";
import { latestPriceForInput } from "@/lib/refresh";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json();
    if (body.pricingMode === "auto" && ["Stock", "ETF", "Mutual Fund"].includes(body.assetType)) {
      try {
        const quote = await latestPriceForInput({
          name: body.name,
          assetType: body.assetType,
          currency: body.currency,
          country: body.country,
          ticker: body.priceSymbol,
          exchange: body.exchange,
        });
        body.currentPrice = quote.price;
        body.priceSource = quote.source;
        body.priceAsOn = quote.date;
        body.week52Low = quote.week52Low ?? body.week52Low ?? null;
        body.week52High = quote.week52High ?? body.week52High ?? null;
        body.targetPrice = quote.targetPrice ?? body.targetPrice ?? null;
        body.targetSource = quote.targetSource ?? body.targetSource ?? null;
        body.targetAsOn = quote.targetAsOn ?? body.targetAsOn ?? null;
        body.sector = quote.sector ?? body.sector ?? null;
        body.industry = quote.industry ?? body.industry ?? null;
        body.trailingPe = quote.trailingPe ?? body.trailingPe ?? null;
        body.forwardPe = quote.forwardPe ?? body.forwardPe ?? null;
        body.pegRatio = quote.pegRatio ?? body.pegRatio ?? null;
      } catch {
        // Preserve valid user-entered values if a provider is temporarily unavailable.
      }
    }
    await addInvestment(user.sub, body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Could not save investment", error);
    const detail = error instanceof Error ? error.message : "Unknown server error";
    return NextResponse.json({ error: `Could not save investment: ${detail}` }, { status: 500 });
  }
}

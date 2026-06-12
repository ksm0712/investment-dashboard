import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { deleteSecurity, updateRefreshFields, updateSecurity } from "@/lib/db";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  try {
    const body = await request.json();
    const isRefreshSave = "priceAsOn" in body || "priceSource" in body || "refreshStatus" in body || "refreshNote" in body;
    if (isRefreshSave) {
      await updateRefreshFields(user.sub, Number(id), {
        latestPrice: body.latestPrice,
        priceAsOn: body.priceAsOn,
        latestValue: body.value ?? body.latestValue,
        latestValueInr: body.latestValueInr,
        refreshStatus: body.refreshStatus,
        refreshNote: body.refreshNote,
        priceSource: body.priceSource,
        priceSymbol: body.priceSymbol,
      });
    } else {
      await updateSecurity(user.sub, Number(id), body);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Could not update investment", error);
    const detail = error instanceof Error ? error.message : "Unknown server error";
    return NextResponse.json({ error: `Could not update investment: ${detail}` }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  await deleteSecurity(user.sub, Number(id));
  return NextResponse.json({ ok: true });
}

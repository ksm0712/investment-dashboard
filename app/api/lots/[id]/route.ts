import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { deleteLot, syncActionHistory, updateLot } from "@/lib/db";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { id } = await context.params;
    const updated = await updateLot(user.sub, Number(id), await request.json());
    if (!updated) return NextResponse.json({ error: "Lot not found." }, { status: 404 });
    await syncActionHistory(user.sub);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Could not update lot.";
    return NextResponse.json({ error: detail }, { status: 400 });
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  await deleteLot(user.sub, Number(id));
  await syncActionHistory(user.sub);
  return NextResponse.json({ ok: true });
}

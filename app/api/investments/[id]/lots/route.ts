import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { addLot } from "@/lib/db";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { id } = await context.params;
    const result = await addLot(user.sub, Number(id), await request.json());
    if (result === null) return NextResponse.json({ error: "Asset not found." }, { status: 404 });
    return NextResponse.json({ ok: true, lotId: typeof result === "number" ? result : result.id });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Could not add lot.";
    return NextResponse.json({ error: detail }, { status: 400 });
  }
}

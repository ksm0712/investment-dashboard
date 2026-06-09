import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { addInvestment } from "@/lib/db";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json();
    await addInvestment(user.sub, body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Could not save investment", error);
    const detail = error instanceof Error ? error.message : "Unknown server error";
    return NextResponse.json({ error: `Could not save investment: ${detail}` }, { status: 500 });
  }
}

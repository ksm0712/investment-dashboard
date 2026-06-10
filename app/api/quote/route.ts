import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { latestPriceForInput } from "@/lib/refresh";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json();
    const quote = await latestPriceForInput(body);
    return NextResponse.json({ quote });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not fetch current price.";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}

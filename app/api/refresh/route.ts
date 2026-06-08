import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { refreshPrices } from "@/lib/refresh";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ summary: await refreshPrices(user.sub) });
}

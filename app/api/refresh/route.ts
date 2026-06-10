import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getSecurities } from "@/lib/db";
import { getFx } from "@/lib/fx";
import { refreshPrices } from "@/lib/refresh";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const summary = await refreshPrices(user.sub);
  const [securities, fx] = await Promise.all([getSecurities(user.sub), getFx()]);
  return NextResponse.json({ summary, securities, fx });
}

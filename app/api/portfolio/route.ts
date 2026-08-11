import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getPortfolios, getSecurities, syncActionHistory } from "@/lib/db";
import { getFx } from "@/lib/fx";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const securities = await getSecurities(user.sub);
  const [sync, portfolios, fx] = await Promise.all([
    syncActionHistory(user.sub, securities),
    getPortfolios(user.sub),
    getFx(),
  ]);
  return NextResponse.json({ securities, portfolios, fx, actionHistory: sync.history, user });
}

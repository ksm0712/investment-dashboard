import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getActionHistory, getPortfolios, getSecurities, syncActionHistory } from "@/lib/db";
import { getFx } from "@/lib/fx";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const securities = await getSecurities(user.sub);
  await syncActionHistory(user.sub, securities);
  const [portfolios, fx, actionHistory] = await Promise.all([
    getPortfolios(user.sub),
    getFx(),
    getActionHistory(user.sub),
  ]);
  return NextResponse.json({ securities, portfolios, fx, actionHistory, user });
}

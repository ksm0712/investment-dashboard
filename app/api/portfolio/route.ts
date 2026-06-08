import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getPortfolios, getSecurities } from "@/lib/db";
import { getFx } from "@/lib/fx";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [securities, portfolios, fx] = await Promise.all([
    getSecurities(user.sub),
    getPortfolios(user.sub),
    getFx(),
  ]);
  return NextResponse.json({ securities, portfolios, fx, user });
}

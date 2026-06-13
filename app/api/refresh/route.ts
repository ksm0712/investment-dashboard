import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getSecurities } from "@/lib/db";
import { getFx } from "@/lib/fx";
import { refreshPrices } from "@/lib/refresh";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const summary = await refreshPrices(user.sub);
    const [securities, fx] = await Promise.all([getSecurities(user.sub), getFx()]);
    return NextResponse.json(
      { summary, securities, fx },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } },
    );
  } catch (error) {
    console.error("Could not refresh prices", error);
    const detail = error instanceof Error ? error.message : "Unknown server error";
    return NextResponse.json(
      { error: `Could not refresh prices: ${detail}` },
      { status: 500, headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } },
    );
  }
}

import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getRefreshUserIds } from "@/lib/db";
import { refreshPrices } from "@/lib/refresh";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorised(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!secret || !supplied) return false;
  const expectedBuffer = Buffer.from(secret);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer);
}

export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Scheduled refresh is not configured." }, { status: 503 });
  }
  if (!authorised(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userIds = await getRefreshUserIds();
  const results: Array<{ status: "fulfilled" | "rejected" }> = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(2, userIds.length) }, async () => {
    while (cursor < userIds.length) {
      const userId = userIds[cursor++];
      try {
        await refreshPrices(userId);
        results.push({ status: "fulfilled" });
      } catch {
        results.push({ status: "rejected" });
      }
    }
  });
  await Promise.all(workers);

  const failed = results.filter((result) => result.status === "rejected").length;
  return NextResponse.json({
    ok: failed === 0,
    accounts: userIds.length,
    refreshed: results.length - failed,
    failed,
    completedAt: new Date().toISOString(),
  }, { status: failed ? 207 : 200 });
}

import { NextRequest, NextResponse } from "next/server";
import { appUrl, googleRedirectUri, setSession } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code) return NextResponse.redirect(`${appUrl()}/?auth_error=missing_code`);
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID || "",
        client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
        redirect_uri: googleRedirectUri(),
        grant_type: "authorization_code",
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokens.access_token) {
      return NextResponse.redirect(`${appUrl()}/?auth_error=${encodeURIComponent(tokens.error_description || tokens.error || "no_access_token")}`);
    }
    const userRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const user = await userRes.json();
    await setSession(user);
    return NextResponse.redirect(appUrl());
  } catch (error) {
    const detail = error instanceof Error ? error.message : "callback_failed";
    return NextResponse.redirect(`${appUrl()}/?auth_error=${encodeURIComponent(detail)}`);
  }
}

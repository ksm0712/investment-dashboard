import { NextResponse } from "next/server";
import { googleRedirectUri } from "@/lib/auth";

export async function GET() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId && process.env.NODE_ENV !== "production") {
    return NextResponse.redirect(new URL("/", "http://localhost:3000"));
  }
  const params = new URLSearchParams({
    client_id: clientId || "",
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: "openid email profile",
    prompt: "select_account",
  });
  return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}

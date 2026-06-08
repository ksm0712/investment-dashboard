import { NextResponse } from "next/server";
import { appUrl, googleRedirectUri } from "@/lib/auth";

export async function GET() {
  return NextResponse.json({
    appUrl: appUrl(),
    redirectUri: googleRedirectUri(),
    hasGoogleClientId: Boolean(process.env.GOOGLE_CLIENT_ID),
  });
}

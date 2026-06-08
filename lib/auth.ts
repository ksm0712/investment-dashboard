import crypto from "node:crypto";
import { cookies } from "next/headers";
import type { User } from "./types";

const COOKIE_NAME = "investment_dashboard_user";

function secret() {
  return process.env.AUTH_COOKIE_SECRET || process.env.COOKIE_SECRET || "local-dev-secret";
}

function sign(value: string) {
  return crypto.createHmac("sha256", secret()).update(value).digest("hex");
}

export function encodeSession(user: User) {
  const payload = JSON.stringify({
    user: {
      sub: user.sub,
      email: user.email,
      name: user.name,
      picture: user.picture,
    },
    expires: Date.now() + 30 * 24 * 60 * 60 * 1000,
  });
  const value = Buffer.from(payload).toString("base64url");
  return `${value}.${sign(value)}`;
}

export function decodeSession(value?: string): User | null {
  if (!value) return null;
  try {
    const [payload, signature] = value.split(".");
    if (!payload || !signature || !crypto.timingSafeEqual(Buffer.from(sign(payload)), Buffer.from(signature))) {
      return null;
    }
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data.expires || Date.now() > data.expires) return null;
    return data.user as User;
  } catch {
    return null;
  }
}

export async function getCurrentUser() {
  const store = await cookies();
  const user = decodeSession(store.get(COOKIE_NAME)?.value);
  if (user) return user;
  if (process.env.NODE_ENV !== "production") {
    return { sub: "dev-user", email: "local@example.com", name: "Local User" };
  }
  return null;
}

export async function setSession(user: User) {
  const store = await cookies();
  store.set(COOKIE_NAME, encodeSession(user), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });
}

export async function clearSession() {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export function appUrl() {
  return (process.env.APP_URL || process.env.NEXTAUTH_URL || "http://localhost:3000").replace(/\/$/, "");
}

export function googleRedirectUri() {
  return `${appUrl()}/api/auth/callback`;
}

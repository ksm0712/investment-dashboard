export type AppUrlEnvironment = Record<string, string | undefined>;

export function resolveAppUrl(environment: AppUrlEnvironment) {
  const previewUrl = environment.VERCEL_BRANCH_URL
    || environment.NEXT_PUBLIC_VERCEL_BRANCH_URL
    || environment.VERCEL_URL
    || environment.NEXT_PUBLIC_VERCEL_URL;
  if (environment.VERCEL_ENV === "preview" && previewUrl) {
    return `https://${previewUrl}`.replace(/\/$/, "");
  }
  const productionUrl = environment.VERCEL_PROJECT_PRODUCTION_URL || environment.VERCEL_URL;
  const url = environment.APP_URL || environment.NEXTAUTH_URL || (productionUrl ? `https://${productionUrl}` : "http://localhost:3000");
  return url.replace(/\/$/, "");
}

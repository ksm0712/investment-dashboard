# Next.js Deployment

Deploy this branch to Vercel for the fast React version.

## Vercel

1. Import `ksm0712/investment-dashboard`.
2. Select branch `nextjs-app`.
3. Framework preset: `Next.js`.
4. Build command: `npm run build`.
5. Output directory: leave default.

## Environment Variables

Add these in Vercel project settings:

```text
TURSO_DATABASE_URL=libsql://investment-dashboard-karansm.aws-ap-northeast-1.turso.io
TURSO_AUTH_TOKEN=your_turso_token
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
AUTH_COOKIE_SECRET=use_a_long_random_secret
APP_URL=https://your-vercel-url.vercel.app
```

## Google OAuth Redirect

In Google Cloud, add this redirect URI to the same OAuth web client:

```text
https://your-vercel-url.vercel.app/api/auth/callback
```

If you add a custom Vercel domain later, add the same callback path for that domain too.

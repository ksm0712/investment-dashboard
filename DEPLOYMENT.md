# Deployment

The production app is a Next.js application deployed from the `main` branch on Vercel:

**[thesis-karan.vercel.app](https://thesis-karan.vercel.app/)**

This guide records the current deployment. The older Streamlit deployment is no longer used.

## 1. Create the database

Create a Turso database and save its URL and token:

```bash
turso db create investment-dashboard
turso db show --http-url investment-dashboard
turso db tokens create investment-dashboard
```

The application creates and migrates its tables when it starts.

## 2. Configure Google OAuth

Create a Google OAuth client with the application type **Web application**.

Add the production origin:

```text
https://thesis-karan.vercel.app
```

Add the production callback:

```text
https://thesis-karan.vercel.app/api/auth/callback
```

For local authentication, add:

```text
http://localhost:3000/api/auth/callback
```

Preview deployments use their Vercel branch URL for the callback. If a preview needs real Google sign-in, that callback must also be allowed in the OAuth client.

## 3. Import the repository into Vercel

Import `ksm0712/investment-dashboard` and use these settings:

| Setting | Value |
|---|---|
| Production branch | `main` |
| Framework preset | Next.js |
| Build command | `npm run build` |
| Output directory | Next.js default |

The project includes [vercel.json](vercel.json), which schedules the portfolio refresh route once per day.

## 4. Add production environment variables

Configure these values in the Vercel project:

```text
TURSO_DATABASE_URL=libsql://your-database.turso.io
TURSO_AUTH_TOKEN=your_turso_token

GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
AUTH_COOKIE_SECRET=your_long_random_secret
APP_URL=https://thesis-karan.vercel.app

CRON_SECRET=your_long_random_cron_secret
SEC_USER_AGENT=Thesis portfolio research your-email@example.com
```

Generate the two secrets independently. For example:

```bash
openssl rand -base64 32
```

Do not enable `DEV_AUTH` in Vercel.

## 5. Optional providers

Yahoo Finance is the primary no-key source. These keys add fallback coverage:

```text
FMP_API_KEY=
TWELVE_DATA_API_KEY=
ALPHA_VANTAGE_API_KEY=
```

The hosted evidence-analysis configuration is:

```text
AI_PROVIDER=groq
GROQ_API_KEY=
GROQ_MODEL=openai/gpt-oss-20b
AI_DAILY_REQUEST_LIMIT=10
```

Local Ollama settings should not be copied into production unless the deployment can reach that Ollama server.

## 6. Verify a release

After Vercel reports a successful deployment:

1. Open the production URL in a private browser window.
2. Confirm that Google sign-in returns to `/api/auth/callback` and opens an empty private portfolio.
3. Add a test position and confirm that it survives a new browser session.
4. Refresh prices and inspect the source and date on the expanded position.
5. Add a second purchase lot and confirm that the average cost and invested amount update.
6. Export the active holdings view and inspect the CSV.
7. Sign in with a second account and confirm that it cannot see the first account's data.
8. For an eligible U.S. stock, save a thesis and run filing analysis.
9. Confirm that `/api/cron/refresh` rejects a request without the Vercel cron authorization header.

## 7. Release checks

Run the same checks locally before pushing:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Vercel deploys each push to `main`. A release is complete only after the Git commit status is successful and the production site serves the new assets.

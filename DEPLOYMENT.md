# Free Deployment Guide

This branch deploys the existing Streamlit investment dashboard with the same UI and behavior, but with production-safe multi-user storage and login.

## Stack

- App hosting: Streamlit Community Cloud
- Database: Turso free cloud database
- Login: Streamlit native Google OIDC login
- Source branch: `deploy-free`
- Main file: `dashboard.py`

## 1. Create Turso Database

1. Sign up at `https://turso.tech`.
2. Install/login to the Turso CLI if you want the fastest setup:

```bash
brew install tursodatabase/tap/turso
turso auth login
turso db create investment-dashboard
turso db show --http-url investment-dashboard
turso db tokens create investment-dashboard
```

3. Save these two values:

```text
TURSO_DATABASE_URL
TURSO_AUTH_TOKEN
```

The app creates its own tables on first launch.

## 2. Create Google OAuth Client

1. Go to `https://console.cloud.google.com/apis/credentials`.
2. Create or select a Google Cloud project.
3. Configure the OAuth consent screen.
4. Create OAuth client credentials:
   - Application type: `Web application`
   - Name: `Investment Dashboard`
5. Add authorized redirect URIs:

```text
http://localhost:8501/oauth2callback
https://YOUR_STREAMLIT_APP_NAME.streamlit.app/oauth2callback
```

6. Save:

```text
client_id
client_secret
```

## 3. Create Streamlit App

1. Go to `https://share.streamlit.io`.
2. Click `Create app`.
3. Choose:
   - Repository: `ksm0712/investment-dashboard`
   - Branch: `deploy-free`
   - Main file path: `dashboard.py`
4. Pick an app URL, for example:

```text
investment-dashboard-ksm.streamlit.app
```

Use this exact URL in the Google redirect URI above.

## 4. Add Streamlit Secrets

In Streamlit Cloud, open app settings and paste this into `Secrets`.

```toml
TURSO_DATABASE_URL = "https://your-database-your-org.turso.io"
TURSO_AUTH_TOKEN = "your_turso_database_auth_token"

[auth]
redirect_uri = "https://YOUR_STREAMLIT_APP_NAME.streamlit.app/oauth2callback"
cookie_secret = "replace_with_a_long_random_string"
client_id = "your_google_oauth_client_id"
client_secret = "your_google_oauth_client_secret"
server_metadata_url = "https://accounts.google.com/.well-known/openid-configuration"
```

For `cookie_secret`, use a long random value. Example command:

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

## 5. Deploy and Verify

After Streamlit finishes building:

1. Open the app URL in a fresh browser/private window.
2. Confirm it shows the login screen.
3. Sign in with Google.
4. Confirm the dashboard opens.
5. Add one stock.
6. Add one mutual fund.
7. Add one savings/manual asset.
8. Click `Refresh Prices`.
9. Confirm stocks/mutual funds refresh and savings/manual assets stay manual.
10. Sign out.
11. Sign in with a different Google account.
12. Confirm that the second account does not see the first account's investments.

## 6. After Testing

When the deployed branch works:

```bash
git switch main
git merge deploy-free
git push origin main
```

Then update the Streamlit app to deploy from `main`.

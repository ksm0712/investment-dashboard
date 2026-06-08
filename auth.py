import os
import json
import html
import urllib.parse
import requests
import streamlit as st
from datetime import datetime, timedelta

GOOGLE_AUTH_URL  = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_INFO_URL  = "https://www.googleapis.com/oauth2/v3/userinfo"
SESSION_FILE     = ".session.json"

def _secret(name, default=""):
    if os.getenv(name):
        return os.getenv(name)
    try:
        return st.secrets.get(name, default)
    except Exception:
        return default

def _auth_secret(name, default=""):
    try:
        auth = st.secrets.get("auth", {})
        return auth.get(name, default)
    except Exception:
        return default

def _native_auth_configured():
    return bool(
        _auth_secret("redirect_uri")
        and _auth_secret("cookie_secret")
        and _auth_secret("client_id")
        and _auth_secret("client_secret")
        and _auth_secret("server_metadata_url")
    )

def _oauth_value(auth_name, env_name=None, default=""):
    env_name = env_name or auth_name.upper()
    return _secret(env_name) or _auth_secret(auth_name, default)

def _use_local_session_file():
    return not _native_auth_configured()

def _redirect_uri():
    return _oauth_value("redirect_uri", "GOOGLE_REDIRECT_URI", "http://localhost:8501")

def _load_session():
    if not _use_local_session_file():
        return None
    try:
        if os.path.exists(SESSION_FILE):
            with open(SESSION_FILE) as f:
                data = json.load(f)
            if datetime.fromisoformat(data["expires"]) > datetime.now():
                return data["user"]
    except Exception:
        pass
    return None

def _save_session(user):
    if not _use_local_session_file():
        return
    with open(SESSION_FILE, "w") as f:
        json.dump({"user": user, "expires": (datetime.now() + timedelta(days=30)).isoformat()}, f)

def _delete_session():
    try:
        os.remove(SESSION_FILE)
    except Exception:
        pass

def get_login_url():
    params = {
        "client_id":     _oauth_value("client_id", "GOOGLE_CLIENT_ID", ""),
        "redirect_uri":  _redirect_uri(),
        "response_type": "code",
        "scope":         "openid email profile",
        "prompt":        "select_account",
    }
    return GOOGLE_AUTH_URL + "?" + urllib.parse.urlencode(params)

def _exchange_code(code):
    resp = requests.post(GOOGLE_TOKEN_URL, data={
        "code":          code,
        "client_id":     _oauth_value("client_id", "GOOGLE_CLIENT_ID", ""),
        "client_secret": _oauth_value("client_secret", "GOOGLE_CLIENT_SECRET", ""),
        "redirect_uri":  _redirect_uri(),
        "grant_type":    "authorization_code",
    }, timeout=10)
    return resp.json()

def _get_user_info(access_token):
    resp = requests.get(GOOGLE_INFO_URL,
                        headers={"Authorization": f"Bearer {access_token}"},
                        timeout=10)
    return resp.json()

def handle_auth_callback():
    # In deployment, keep auth in each browser session instead of a shared server file.
    if not st.session_state.get("user"):
        user = _load_session()
        if user:
            st.session_state["user"] = user

    if st.session_state.get("user"):
        return

    code = st.query_params.get("code")
    if not code:
        return

    try:
        tokens = _exchange_code(code)
        if "access_token" in tokens:
            user = _get_user_info(tokens["access_token"])
            st.session_state["user"] = user
            _save_session(user)
            st.query_params.clear()
        else:
            detail = tokens.get("error_description") or tokens.get("error") or str(tokens)
            st.session_state["auth_error"] = f"Google did not return an access token. {detail}"
            st.query_params.clear()
    except Exception as e:
        st.session_state["auth_error"] = str(e)
        st.query_params.clear()
    st.rerun()

def is_logged_in():
    return bool(st.session_state.get("user"))

def get_current_user():
    return st.session_state.get("user")

def logout():
    _delete_session()
    st.session_state.clear()
    st.rerun()

def show_login_page():
    login_url = get_login_url()
    safe_login_url = html.escape(login_url, quote=True)
    err = st.session_state.pop("auth_error", None)
    st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
html,body,[class*="css"],*{font-family:'Inter',sans-serif!important}
.stApp{background:#f8fafc;color:#111827}
#MainMenu,footer,header{display:none!important}
.block-container{display:flex;align-items:center;justify-content:center;min-height:100vh;padding:0!important}
.login-card{background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;padding:52px 44px 48px;
            box-shadow:0 24px 60px rgba(15,23,42,0.10);text-align:center;max-width:420px;margin:0 auto}
.login-title{font-size:28px;font-weight:900;color:#111827;margin-bottom:6px;letter-spacing:0}
.login-subtitle{font-size:13px;color:#64748b;font-weight:600;margin-bottom:40px;text-transform:uppercase;letter-spacing:0.12em}
.google-login-btn{display:flex;align-items:center;justify-content:center;gap:12px;background:#ffffff;
    border:1px solid #d1d5db;border-radius:10px;padding:13px 20px;box-shadow:0 2px 8px rgba(15,23,42,0.06);
    font-size:15px;font-weight:700;color:#111827!important;font-family:Inter,sans-serif;text-decoration:none!important}
.google-login-btn:hover{border-color:#9ca3af;box-shadow:0 5px 14px rgba(15,23,42,0.10)}
.login-note{margin-top:28px;font-size:12px;color:#94a3b8;line-height:1.6;text-align:center}
</style>
""", unsafe_allow_html=True)
    _, mid, _ = st.columns([1, 1.2, 1])
    with mid:
        if err:
            st.error(f"Login failed: {err}")
        st.markdown(f"""
<div class="login-card">
  <div class="login-title">Investments</div>
  <div class="login-subtitle">Portfolio Tracker</div>
  <a class="google-login-btn" href="{safe_login_url}">
    <svg width="20" height="20" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.35-8.16 2.35-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
      <path fill="none" d="M0 0h48v48H0z"/>
    </svg>
    Continue with Google
  </a>
  <div class="login-note">
    Your data is private to your account.<br>Sign in to access your portfolio.
  </div>
</div>
""", unsafe_allow_html=True)

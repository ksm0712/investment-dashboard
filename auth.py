import os
import urllib.parse
import requests
import streamlit as st

GOOGLE_AUTH_URL  = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_INFO_URL  = "https://www.googleapis.com/oauth2/v3/userinfo"

def _redirect_uri():
    return os.getenv("GOOGLE_REDIRECT_URI", "http://localhost:8501")

def get_login_url():
    params = {
        "client_id":     os.getenv("GOOGLE_CLIENT_ID", ""),
        "redirect_uri":  _redirect_uri(),
        "response_type": "code",
        "scope":         "openid email profile",
        "prompt":        "select_account",
    }
    return GOOGLE_AUTH_URL + "?" + urllib.parse.urlencode(params)

def _exchange_code(code):
    resp = requests.post(GOOGLE_TOKEN_URL, data={
        "code":          code,
        "client_id":     os.getenv("GOOGLE_CLIENT_ID", ""),
        "client_secret": os.getenv("GOOGLE_CLIENT_SECRET", ""),
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
    """Call once at the very top of the app to process the OAuth redirect."""
    if st.session_state.get("user"):
        return
    code = st.query_params.get("code")
    if not code:
        return
    st.query_params.clear()
    try:
        tokens = _exchange_code(code)
        if "access_token" in tokens:
            user = _get_user_info(tokens["access_token"])
            st.session_state["user"] = user
    except Exception:
        pass
    st.rerun()

def is_logged_in():
    return bool(st.session_state.get("user"))

def get_current_user():
    return st.session_state.get("user")

def logout():
    st.session_state.clear()
    st.rerun()

def show_login_page():
    login_url = get_login_url()
    st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
html,body,[class*="css"],*{font-family:'Inter',sans-serif!important}
.stApp{background:#f8fafc;color:#111827}
#MainMenu,footer,header{display:none!important}
.block-container{display:flex;align-items:center;justify-content:center;min-height:100vh;padding:0!important}
</style>
""", unsafe_allow_html=True)

    _, mid, _ = st.columns([1, 1.2, 1])
    with mid:
        st.markdown(f"""
<div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;padding:52px 44px 48px;
            box-shadow:0 24px 60px rgba(15,23,42,0.10);text-align:center;max-width:420px;margin:0 auto">
  <div style="font-size:28px;font-weight:900;color:#111827;margin-bottom:6px;letter-spacing:-0.5px">Investments</div>
  <div style="font-size:13px;color:#64748b;font-weight:600;margin-bottom:40px;text-transform:uppercase;letter-spacing:0.12em">Portfolio Tracker</div>
  <a href="{login_url}" style="text-decoration:none">
    <div style="display:flex;align-items:center;justify-content:center;gap:12px;
                background:#ffffff;border:1px solid #d1d5db;border-radius:10px;
                padding:13px 20px;cursor:pointer;transition:all 0.15s;
                box-shadow:0 2px 8px rgba(15,23,42,0.06);font-size:15px;font-weight:700;color:#111827">
      <svg width="20" height="20" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.35-8.16 2.35-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
        <path fill="none" d="M0 0h48v48H0z"/>
      </svg>
      Continue with Google
    </div>
  </a>
  <div style="margin-top:28px;font-size:12px;color:#94a3b8;line-height:1.6">
    Your data is private to your account.<br>Sign in to access your portfolio.
  </div>
</div>
""", unsafe_allow_html=True)

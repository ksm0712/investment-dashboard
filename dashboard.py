import streamlit as st
import html, re
from datetime import datetime, date as date_cls
import plotly.graph_objects as go
import pandas as pd
import requests
from dotenv import load_dotenv
from database import (
    create_tables, get_securities, get_all_portfolios,
    rename_portfolio, delete_portfolio, create_manual_portfolio, add_manual_security,
    delete_security, update_security_fields,
)
from prices import refresh_prices
from auth import handle_auth_callback, is_logged_in, get_current_user, logout, show_login_page

load_dotenv()
create_tables()

st.set_page_config(layout="wide", page_title="Investments", page_icon="I")

handle_auth_callback()

if not is_logged_in():
    show_login_page()
    st.stop()

_user    = get_current_user()
_user_id = _user.get("sub")

st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
html, body, [class*="css"], * { font-family: 'Inter', sans-serif !important; }
[data-testid="stIconMaterial"] {
    font-family:'Material Symbols Rounded','Material Symbols Outlined' !important;
    font-weight:normal !important;
    font-style:normal !important;
    line-height:1 !important;
    letter-spacing:normal !important;
    text-transform:none !important;
    display:inline-flex !important;
    align-items:center !important;
    justify-content:center !important;
}
.stApp { background:#f8fafc; color:#111827; }
.block-container { padding: 28px 48px 48px !important; max-width: 1400px !important; }
#MainMenu, footer, header { display: none !important; }
[data-testid="stSidebar"] { display: none !important; }

/* ── Topnav ── */
.topnav { display:flex; align-items:center; justify-content:space-between; padding-bottom:24px; border-bottom:1px solid #dfe7f1; margin-bottom:34px; }
.brand { display:flex; align-items:center; gap:10px; padding-top:2px; color:#111827; }
.brand-copy { display:flex; flex-direction:column; gap:2px; line-height:1; }
.brand-name { font-size:18px; font-weight:900; letter-spacing:0; }
.brand-sub { font-size:9px; font-weight:850; text-transform:uppercase; letter-spacing:0.12em; color:#64748b; white-space:nowrap; }

/* ── Currency switcher ── */
.cur-row { display:flex; gap:6px; }
.cur-btn { padding:6px 14px; border-radius:99px; font-size:12px; font-weight:700; border:1px solid #cfd8e6; color:#4b5870; background:#ffffff; cursor:pointer; letter-spacing:0.02em; transition:all 0.1s; }
.cur-btn:hover { border-color:#9ca3af; color:#111827; }
.cur-btn.on { background:#111827; border-color:#111827; color:#fff; }

/* ── Hero ── */
.hero { margin-bottom:22px; }
.hero-eyebrow { font-size:11px; font-weight:850; color:#718096; text-transform:uppercase; letter-spacing:0.14em; margin-bottom:10px; }
.hero-amount { font-size:54px; font-weight:900; color:#111827; letter-spacing:0; line-height:1.04; margin-bottom:12px; white-space:nowrap; }
.hero-sub { font-size:15px; color:#526071; font-weight:650; line-height:1.6; }

/* ── Executive summary ── */
.summary-grid { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:12px; margin-bottom:22px; }
.stat-card { min-height:112px; background:#ffffff; border:1px solid #e5e7eb; border-radius:10px; padding:18px 19px; display:flex; flex-direction:column; justify-content:space-between; box-shadow:0 8px 20px rgba(15,23,42,0.035); }
.summary-grid .stat-card:nth-child(1),
.summary-grid .stat-card:nth-child(2),
.summary-grid .stat-card:nth-child(3),
.summary-grid .stat-card:nth-child(4) { background:#ffffff; border-color:#e5e7eb; }
.stat-label { font-size:10px; font-weight:850; color:#667085; text-transform:uppercase; letter-spacing:0.12em; line-height:1.3; }
.stat-value { font-size:24px; font-weight:850; color:#111827; line-height:1.1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.stat-note { font-size:13px; color:#5f6b7a; line-height:1.4; }
.good { color:#047857 !important; }
.bad { color:#be123c !important; }
.neutral { color:#b45309 !important; }

/* ── Currency cards ── */
.currency-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(168px, 1fr)); gap:14px; align-items:stretch; }
.cc { min-height:168px; background:#ffffff; border:1px solid #e5e7eb; border-radius:10px; padding:18px; display:flex; flex-direction:column; justify-content:space-between; box-shadow:0 8px 20px rgba(15,23,42,0.035); position:relative; overflow:hidden; }
.cc:before { content:""; position:absolute; inset:0 0 auto 0; height:3px; background:#111827; }
.cc-head { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:18px; }
.cc-flag { font-size:23px; line-height:1; }
.cc-cur { font-size:11px; font-weight:850; color:#506078; text-transform:uppercase; letter-spacing:0.12em; }
.cc-val { font-size:25px; font-weight:850; color:#111827; letter-spacing:0; line-height:1.15; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.cc-inr { font-size:13px; color:#344054; margin-top:8px; font-weight:750; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.cc-n { font-size:12px; color:#667085; line-height:1.45; margin-top:4px; }

/* ── Allocation panel ── */
.allocation-panel { background:#ffffff; border:1px solid #e5e7eb; border-radius:10px; padding:22px; min-height:392px; box-shadow:0 8px 20px rgba(15,23,42,0.035); }
.panel-head { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; margin-bottom:18px; }
.panel-title { font-size:11px; font-weight:850; color:#667085; text-transform:uppercase; letter-spacing:0.14em; }
.panel-total { color:#111827; font-size:21px; font-weight:850; text-align:right; line-height:1.1; }
.panel-caption { color:#667085; font-size:12px; margin-top:4px; text-align:right; }
.alloc-hero { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:18px; }
.alloc-chip { background:#ffffff; border:1px solid #e5e7eb; border-radius:8px; padding:12px; min-width:0; box-shadow:none; }
.alloc-chip-label { font-size:10px; color:#667085; font-weight:850; text-transform:uppercase; letter-spacing:0.1em; margin-bottom:6px; }
.alloc-chip-value { font-size:16px; color:#111827; font-weight:850; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.alloc-list { display:flex; flex-direction:column; gap:13px; }
.alloc-row { display:grid; grid-template-columns:minmax(100px, 1fr) minmax(130px, 1.2fr); gap:14px; align-items:center; }
.alloc-name-line { display:flex; align-items:center; gap:9px; min-width:0; }
.alloc-dot { width:10px; height:10px; border-radius:3px; flex:0 0 auto; }
.alloc-name { font-size:14px; color:#111827; font-weight:800; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.alloc-meta { font-size:12px; color:#667085; margin-top:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.alloc-right { min-width:0; }
.alloc-value-line { display:flex; justify-content:space-between; gap:10px; align-items:baseline; margin-bottom:7px; }
.alloc-value { color:#111827; font-size:14px; font-weight:850; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.alloc-pct { color:#475467; font-size:13px; font-weight:800; }
.alloc-track { height:9px; background:#e8edf3; border-radius:999px; overflow:hidden; }
.alloc-fill { height:100%; border-radius:999px; }
.portfolio-actions { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin:4px 0 22px; }
.refresh-results { display:flex; flex-wrap:wrap; gap:8px; }
.refresh-pill { background:#ffffff; border:1px solid #e5e7eb; border-radius:999px; color:#475467; font-size:12px; font-weight:800; padding:7px 11px; box-shadow:none; }
.refresh-pill.good-pill { color:#047857; border-color:#d1d5db; background:#f9fafb; }
.refresh-pill.warn-pill { color:#475467; border-color:#cbd5e1; background:#ffffff; }
.refresh-pill.bad-pill { color:#be123c; border-color:#fecdd3; background:#fff1f2; }
.register-header { display:grid; grid-template-columns:minmax(280px, 1fr) auto; gap:24px; align-items:end; margin-bottom:20px; }
.register-total-label { font-size:11px; color:#6b7280; font-weight:850; text-transform:uppercase; letter-spacing:0.14em; margin-bottom:8px; }
.register-total { color:#111827; font-size:48px; font-weight:900; letter-spacing:0; line-height:1; margin-bottom:10px; }
.register-meta { color:#526071; font-size:14px; font-weight:700; line-height:1.5; }
.register-actions { display:flex; flex-direction:column; align-items:flex-end; gap:9px; min-width:260px; }
.register-strip { display:grid; grid-template-columns:repeat(auto-fit, minmax(170px, 1fr)); gap:10px; margin-bottom:20px; }
.register-metric { background:#ffffff; border:1px solid #e5e7eb; border-radius:8px; padding:13px 14px; box-shadow:0 8px 18px rgba(15,23,42,0.03); min-width:0; }
.register-metric-label { color:#667085; font-size:10px; font-weight:850; text-transform:uppercase; letter-spacing:0.1em; margin-bottom:5px; }
.register-metric-value { color:#111827; font-size:18px; font-weight:850; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.breakdown-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:10px; margin-bottom:20px; }
.breakdown-grid .allocation-panel { min-height:260px; padding:18px; }

/* ── Dialog ── */
[role="dialog"] {
    background:#ffffff !important;
    color:#111827 !important;
    border:1px solid #e5e7eb !important;
    border-radius:10px !important;
    box-shadow:0 22px 60px rgba(15,23,42,0.22) !important;
}
[role="dialog"] * {
    color:inherit;
}
[role="dialog"] h1,
[role="dialog"] h2,
[role="dialog"] h3,
[role="dialog"] [data-testid="stHeading"] {
    color:#111827 !important;
}
[role="dialog"] .slabel,
[role="dialog"] .form-section-title {
    color:#667085 !important;
}
[role="dialog"] label,
[role="dialog"] .stTextInput label,
[role="dialog"] .stNumberInput label,
[role="dialog"] .stDateInput label,
[role="dialog"] .stSelectbox label {
    color:#475467 !important;
}
[role="dialog"] .stTextInput [data-baseweb="input"],
[role="dialog"] .stNumberInput [data-baseweb="input"],
[role="dialog"] .stDateInput [data-baseweb="input"],
[role="dialog"] .stSelectbox [data-baseweb="select"] > div {
    background:#ffffff !important;
    border:1px solid #d1d5db !important;
    box-shadow:0 6px 14px rgba(15,23,42,0.03) !important;
}
[role="dialog"] input {
    background:#ffffff !important;
    color:#111827 !important;
    caret-color:#111827 !important;
}
[role="dialog"] input::placeholder {
    color:#98a2b3 !important;
    opacity:1 !important;
}
[role="dialog"] [data-baseweb="select"] div,
[role="dialog"] [data-baseweb="select"] span {
    color:#111827 !important;
}
[role="dialog"] button[aria-label="Close"] {
    color:#475467 !important;
    background:transparent !important;
    box-shadow:none !important;
}
[role="dialog"] button[aria-label="Close"]:hover {
    color:#111827 !important;
    background:#f1f5f9 !important;
}
[data-testid="stDialog"] ~ div,
[data-testid="stModalOverlay"] {
    background:rgba(15,23,42,0.42) !important;
}

/* ── Section label ── */
.slabel { font-size:11px; font-weight:850; color:#667085; text-transform:uppercase; letter-spacing:0.14em; margin-bottom:14px; }

/* ── Upload area ── */
.upload-box { background:#ffffff; border:1.5px dashed #cfd8e6; border-radius:10px; padding:40px; text-align:center; }

/* ── Tabs ── */
.stTabs [data-baseweb="tab-list"] { background:transparent; border-bottom:1px solid #e5e7eb; gap:0; }
.stTabs [data-baseweb="tab"] { background:transparent !important; color:#667085 !important; font-size:14px; font-weight:700; padding:10px 18px !important; border:none !important; border-radius:0 !important; }
.stTabs [aria-selected="true"] { color:#111827 !important; border-bottom:3px solid #111827 !important; }
.stTabs [data-baseweb="tab-highlight"] { background-color:#111827 !important; }
.stTabs [data-baseweb="tab-border"] { background-color:#e5e7eb !important; }
.stTabs [data-baseweb="tab-panel"] { padding:20px 0 0 !important; }

/* ── Table ── */
[data-testid="stDataFrame"] > div { border:1px solid #d9e0ea !important; border-radius:14px !important; overflow:hidden; box-shadow:0 10px 24px rgba(22,34,51,0.045); }
.holdings-wrap { max-height:620px; overflow:auto; border:1px solid #e5e7eb; border-radius:10px; background:#ffffff; box-shadow:0 8px 20px rgba(15,23,42,0.035); }
.holdings-table { width:100%; table-layout:fixed; border-collapse:separate; border-spacing:0; font-size:13px; color:#172033; }
.holdings-table thead th { position:sticky; top:0; z-index:1; background:#f8fafc; color:#475467; font-size:10px; font-weight:850; text-transform:uppercase; letter-spacing:0.06em; text-align:left; padding:12px 10px; border-bottom:1px solid #e5e7eb; white-space:nowrap; }
.holdings-table tbody td { padding:13px 10px; border-bottom:1px solid #edf1f6; vertical-align:middle; white-space:nowrap; }
.holdings-table tbody tr:hover td { background:#f8fafc; }
.holdings-table .name-cell { white-space:normal; font-weight:650; color:#111827; }
.holdings-table .num { text-align:right; font-variant-numeric:tabular-nums; }
.holdings-table .muted { color:#667085; }
.holdings-table .ret-good { color:#047857; font-weight:800; }
.holdings-table .ret-bad { color:#be123c; font-weight:800; }
.holdings-table .ret-flat { color:#475467; font-weight:800; }
.holdings-table .small-num { font-size:12px; }
.holdings-table .action-cell { text-align:center; }

/* ── Selectbox ── */
.stSelectbox label { color:#475467 !important; font-size:12px !important; font-weight:800 !important; }
.stSelectbox [data-baseweb="select"] > div { background:#ffffff !important; border:1px solid #d1d5db !important; border-radius:10px !important; color:#111827 !important; font-size:15px !important; min-height:48px !important; box-shadow:0 6px 14px rgba(15,23,42,0.03); display:flex !important; align-items:center !important; }
.stSelectbox [data-baseweb="select"] [data-testid="stMarkdownContainer"] p,
.stSelectbox [data-baseweb="select"] div { line-height:1.2 !important; }
.stSelectbox [data-baseweb="select"]:focus-within > div {
    border-color:#2563eb !important;
    box-shadow:0 0 0 3px rgba(37,99,235,0.14), 0 8px 18px rgba(15,23,42,0.06) !important;
}

/* ── Form fields ── */
.stTextInput,
.stNumberInput,
.stDateInput,
.stSelectbox {
    margin-bottom:4px !important;
}
.stTextInput [data-baseweb="input"],
.stNumberInput [data-baseweb="input"],
.stDateInput [data-baseweb="input"] {
    background:#ffffff !important;
    border:1px solid #d1d5db !important;
    border-radius:10px !important;
    min-height:48px !important;
    height:48px !important;
    box-shadow:0 6px 14px rgba(15,23,42,0.03) !important;
    overflow:hidden !important;
}
.stTextInput [data-baseweb="input"]:focus-within,
.stNumberInput [data-baseweb="input"]:focus-within,
.stDateInput [data-baseweb="input"]:focus-within,
.stSelectbox [data-baseweb="select"]:focus-within > div {
    border-color:#2563eb !important;
    box-shadow:0 0 0 3px rgba(37,99,235,0.14), 0 8px 18px rgba(15,23,42,0.06) !important;
}
.stTextInput [data-baseweb="input"] > div,
.stNumberInput [data-baseweb="input"] > div,
.stDateInput [data-baseweb="input"] > div,
.stTextInput input,
.stNumberInput input,
.stDateInput input {
    background:#ffffff !important;
    color:#111827 !important;
    border:0 !important;
    border-radius:0 !important;
    box-shadow:none !important;
    outline:none !important;
    min-height:46px !important;
    height:46px !important;
    caret-color:#111827 !important;
}
.stTextInput input:focus,
.stNumberInput input:focus,
.stDateInput input:focus {
    border:0 !important;
    box-shadow:none !important;
    outline:none !important;
}
.stTextInput input::placeholder { color:#98a2b3 !important; opacity:1 !important; }
.stNumberInput button,
.stNumberInput [data-testid="stNumberInputStepUp"],
.stNumberInput [data-testid="stNumberInputStepDown"] {
    display:none !important;
}
.stTextInput label,
.stNumberInput label,
.stDateInput label {
    color:#475467 !important;
    font-size:12px !important;
    font-weight:800 !important;
}
.form-section-title {
    margin:22px 0 10px;
    color:#111827;
    font-size:14px;
    font-weight:850;
    letter-spacing:0;
}
.form-section-title:first-child { margin-top:0; }
.form-hint {
    color:#667085;
    font-size:12px;
    font-weight:650;
    margin-top:-4px;
    margin-bottom:6px;
}

/* ── File uploader ── */
[data-testid="stFileUploader"] { max-width:620px; }
[data-testid="stFileUploader"] section {
    background:#f8fafc !important;
    border:1px dashed #cbd5e1 !important;
    border-radius:10px !important;
    padding:14px 16px !important;
    box-shadow:none !important;
    min-height:72px !important;
}
[data-testid="stFileUploader"] section > div { gap:12px !important; align-items:center !important; }
[data-testid="stFileUploader"] section [data-testid="stMarkdownContainer"] p {
    font-size:13px !important;
    font-weight:650 !important;
    line-height:1.2 !important;
    margin:0 !important;
    color:#64748b !important;
}
[data-testid="stFileUploader"] section button {
    background:#ffffff !important;
    border:1px solid #cbd5e1 !important;
    color:#111827 !important;
    border-radius:8px !important;
    box-shadow:none !important;
}
[data-testid="stFileUploader"] section button:has([data-testid="stMarkdownContainer"]) {
    min-width:96px !important;
    min-height:34px !important;
    padding:0 14px !important;
}
[data-testid="stFileUploader"] section button:has([data-testid="stMarkdownContainer"]) [data-testid="stIconMaterial"] {
    display:none !important;
}
[data-testid="stFileUploader"] section button:not(:has([data-testid="stMarkdownContainer"])) {
    min-width:34px !important;
    width:34px !important;
    height:34px !important;
    padding:0 !important;
    border-radius:999px !important;
}
[data-testid="stFileUploader"] [data-testid="stFileUploaderFile"] {
    background:#f8fafc !important;
    border:1px solid #d9e0ea !important;
    border-radius:8px !important;
    padding:10px 12px !important;
}
[data-testid="stFileUploader"] [data-testid="stFileUploaderFile"] button {
    min-width:32px !important;
    width:32px !important;
    height:32px !important;
    padding:0 !important;
    border-radius:999px !important;
    background:#ffffff !important;
    border:1px solid #cfd8e6 !important;
}
[data-testid="stFileUploader"] small,
[data-testid="stFileUploader"] [data-testid="stFileUploaderDropzoneInstructions"] { color:#526071 !important; font-size:14px !important; line-height:1.4 !important; }

/* ── Default buttons ── */
.stButton > button { background:#111827 !important; color:#fff !important; border:1px solid #111827 !important; border-radius:10px !important; font-weight:800 !important; font-size:14px !important; min-height:44px; box-shadow:0 10px 22px rgba(15,23,42,0.14); transition:background 0.12s ease, box-shadow 0.12s ease !important; display:flex !important; align-items:center !important; justify-content:center !important; line-height:1 !important; padding:0 18px !important; }
.stButton > button:hover { background:#0f172a !important; border-color:#0f172a !important; box-shadow:0 12px 26px rgba(15,23,42,0.18); }

/* ── Add Investment button ── */
[class*="st-key-add_inv_btn"] button {
    background:#ffffff !important; color:#374151 !important;
    border:1px solid #d1d5db !important; border-radius:8px !important;
    font-size:11px !important; font-weight:850 !important;
    text-transform:uppercase !important; letter-spacing:0.1em !important;
    min-height:36px !important; height:36px !important;
    box-shadow:none !important; padding:0 14px !important;
}
[class*="st-key-add_inv_btn"] button:hover {
    background:#f8fafc !important; border-color:#9ca3af !important;
    color:#111827 !important; box-shadow:none !important;
}
[class*="st-key-add_inv_btn"] button:focus,
[class*="st-key-add_inv_btn"] button:focus-visible,
[class*="st-key-add_inv_btn"] button:active {
    background:#ffffff !important;
    border-color:#d1d5db !important;
    color:#374151 !important;
    box-shadow:none !important;
    outline:none !important;
}
[class*="st-key-back_btn"] button { background:#f1f5f9 !important; color:#374151 !important; border:1px solid #e5e7eb !important; box-shadow:none !important; min-height:36px !important; font-size:13px !important; font-weight:700 !important; }
[class*="st-key-back_btn"] button:hover { background:#e2e8f0 !important; }

/* ── Sign out button ── */
[class*="st-key-logout_nav_btn"] button { background:transparent !important; color:#94a3b8 !important; border:none !important; box-shadow:none !important; min-height:32px !important; font-size:12px !important; font-weight:600 !important; padding:0 !important; }
[class*="st-key-logout_nav_btn"] button:hover { background:transparent !important; color:#be123c !important; box-shadow:none !important; }


/* ── Currency dropdowns ── */
[class*="st-key-ov_cur_select"] [data-baseweb="select"] > div,
[class*="st-key-select_"] [data-baseweb="select"] > div {
    min-height:36px !important; height:36px !important;
    font-size:13px !important; font-weight:700 !important;
    border-radius:8px !important; background:#ffffff !important;
    border:1px solid #d1d5db !important; box-shadow:none !important;
    padding-right:8px !important;
}
[class*="st-key-ov_cur_select"] [data-baseweb="select"] svg,
[class*="st-key-select_"] [data-baseweb="select"] svg {
    display:block !important; opacity:1 !important; color:#667085 !important;
}
[class*="st-key-ov_cur_select"] label,
[class*="st-key-select_"] label {
    font-size:11px !important; font-weight:850 !important; color:#667085 !important;
    text-transform:uppercase !important; letter-spacing:0.1em !important;
}
.stButton > button [data-testid="stMarkdownContainer"],
.stButton > button p { margin:0 !important; padding:0 !important; line-height:1 !important; display:flex !important; align-items:center !important; justify-content:center !important; width:100%; height:100%; }

/* ── Portfolio dropdown ── */
[data-testid="stPopover"] > button {
    background:#ffffff !important;
    color:#111827 !important;
    border:1px solid #d1d5db !important;
    border-radius:10px !important;
    box-shadow:0 6px 14px rgba(15,23,42,0.03) !important;
    justify-content:flex-start !important;
    min-height:48px !important;
}
[data-testid="stPopover"] > button:hover {
    background:#ffffff !important;
    border-color:#9ca3af !important;
    box-shadow:0 8px 18px rgba(15,23,42,0.06) !important;
}
[data-testid="stPopover"] > button p {
    justify-content:flex-start !important;
    text-align:left !important;
    font-weight:500 !important;
}
[data-testid="stPopoverBody"] .stButton > button {
    background:#ffffff !important;
    color:#111827 !important;
    border:1px solid #e5e7eb !important;
    box-shadow:none !important;
    min-height:40px !important;
    border-radius:8px !important;
    font-weight:600 !important;
}
[data-testid="stPopoverBody"] .stButton > button:hover {
    background:#f8fafc !important;
    border-color:#cbd5e1 !important;
}
[data-testid="stPopoverBody"] [data-testid="column"]:last-child .stButton > button {
    color:#dc2626 !important;
    border-color:#fecaca !important;
    padding:0 !important;
}
[data-testid="stPopoverBody"] [data-testid="column"]:last-child .stButton > button:hover {
    background:#fef2f2 !important;
    border-color:#fca5a5 !important;
}

/* ── Spinner ── */
.stSpinner > div { border-top-color:#111827 !important; }

/* ── Alerts ── */
.stAlert { border-radius:10px !important; }

/* ── Radio as pills ── */
.stRadio { margin-top:4px !important; }
.stRadio > div { flex-direction:row !important; gap:6px !important; flex-wrap:wrap; align-items:center; }
.stRadio div[role="radiogroup"] { display:flex; flex-direction:row; gap:6px; }
.stRadio div[role="radiogroup"] label { position:relative !important; display:block !important; background:#ffffff !important; border:1px solid #cfd8e6 !important; border-radius:999px !important; padding:0 !important; height:40px !important; min-height:40px !important; width:78px !important; min-width:78px !important; font-size:12px !important; font-weight:850 !important; color:#526071 !important; margin:0 !important; cursor:pointer !important; white-space:nowrap; box-shadow:0 5px 12px rgba(15,23,42,0.035); line-height:1 !important; box-sizing:border-box !important; }
.stRadio label:hover { border-color:#9ca3af !important; background:#f9fafb !important; }
.stRadio label:has(input:checked) { background:#111827 !important; border-color:#111827 !important; color:#fff !important; box-shadow:0 8px 18px rgba(15,23,42,0.14); }
.stRadio label p, .stRadio label span { color:#526071 !important; font-weight:850 !important; }
.stRadio label:has(input:checked) p, .stRadio label:has(input:checked) span { color:#ffffff !important; }
.stRadio div[role="radiogroup"] label > div:last-of-type { position:absolute !important; inset:0 !important; display:grid !important; place-items:center !important; width:100% !important; height:100% !important; margin:0 !important; padding:0 !important; }
.stRadio div[role="radiogroup"] label [data-testid="stMarkdownContainer"] { position:static !important; display:block !important; height:auto !important; width:auto !important; margin:0 !important; padding:0 !important; transform:none !important; }
.stRadio div[role="radiogroup"] label p { position:static !important; transform:none !important; margin:0 !important; padding:0 !important; line-height:1 !important; text-align:center !important; width:auto !important; height:auto !important; }
.stRadio input, .stRadio label svg, .stRadio label [data-baseweb="radio"], .stRadio label div:has(input), .stRadio label > div:first-child:not([data-testid="stMarkdownContainer"]) { display:none !important; }
.stRadio > label { display:none !important; }

/* Final portfolio picker overrides. Keep this after the global button rules. */
button[data-testid="stPopoverButton"] {
    background:#ffffff !important;
    color:#111827 !important;
    border:1px solid #d1d5db !important;
    border-radius:10px !important;
    box-shadow:0 6px 14px rgba(15,23,42,0.03) !important;
    min-height:48px !important;
    justify-content:center !important;
}
button[data-testid="stPopoverButton"]:hover {
    background:#ffffff !important;
    border-color:#9ca3af !important;
}
button[data-testid="stPopoverButton"] p {
    color:#111827 !important;
    justify-content:center !important;
    text-align:center !important;
    font-weight:500 !important;
}
button[data-testid="stPopoverButton"] [data-testid="stMarkdownContainer"] {
    margin-left:12px !important;
}
button[data-testid="stPopoverButton"] [data-testid="stIconMaterial"] {
    color:#667085 !important;
    font-size:20px !important;
}
[data-testid="stPopoverBody"] {
    background:#ffffff !important;
    color:#111827 !important;
    border:1px solid #d1d5db !important;
    box-shadow:0 18px 42px rgba(15,23,42,0.16) !important;
}
[data-testid="stPopoverBody"] > div,
[data-testid="stPopoverBody"] [data-testid="stVerticalBlock"] {
    background:#ffffff !important;
    color:#111827 !important;
}
[data-testid="stPopover"] button[data-testid="stBaseButton-secondary"] {
    background:#ffffff !important;
    color:#111827 !important;
    border:0 !important;
    box-shadow:none !important;
    min-height:34px !important;
    border-radius:6px !important;
    font-weight:500 !important;
    justify-content:center !important;
    padding:0 4px !important;
}
[data-testid="stPopover"] button[data-testid="stBaseButton-secondary"]:hover {
    background:#f8fafc !important;
}
[data-testid="stPopover"] [data-testid="column"]:last-child button[data-testid="stBaseButton-secondary"] {
    color:#dc2626 !important;
    border:0 !important;
    background:#fff !important;
    padding:0 !important;
    min-width:28px !important;
    min-height:28px !important;
    justify-content:center !important;
}
[data-testid="stPopover"] [data-testid="column"]:last-child button[data-testid="stBaseButton-secondary"]:hover {
    background:#fef2f2 !important;
}
[class*="st-key-delete_portfolio_"] button[data-testid="stBaseButton-secondary"] {
    background:#fff !important;
    color:#dc2626 !important;
    border:0 !important;
    box-shadow:none !important;
    min-width:28px !important;
    min-height:28px !important;
    padding:0 !important;
    justify-content:center !important;
}
[class*="st-key-edit_portfolio_"] button[data-testid="stBaseButton-secondary"] {
    background:#fff !important;
    color:#2563eb !important;
    border:0 !important;
    box-shadow:none !important;
    min-width:28px !important;
    min-height:28px !important;
    padding:0 !important;
    justify-content:center !important;
}
[class*="st-key-edit_portfolio_"] button[data-testid="stBaseButton-secondary"] [data-testid="stIconMaterial"] {
    color:#2563eb !important;
    font-size:18px !important;
}
[class*="st-key-edit_portfolio_"] button[data-testid="stBaseButton-secondary"]:hover {
    background:#eff6ff !important;
    color:#1d4ed8 !important;
}
[class*="st-key-edit_price_"] button[data-testid="stBaseButton-secondary"] {
    background:#fff !important;
    color:#2563eb !important;
    border:0 !important;
    box-shadow:none !important;
    min-width:28px !important;
    min-height:28px !important;
    padding:0 !important;
    justify-content:center !important;
}
[class*="st-key-edit_price_"] button[data-testid="stBaseButton-secondary"] [data-testid="stIconMaterial"] {
    color:#2563eb !important;
    font-size:18px !important;
}
[class*="st-key-edit_price_"] button[data-testid="stBaseButton-secondary"]:hover {
    background:#eff6ff !important;
    color:#1d4ed8 !important;
}
[class*="st-key-delete_portfolio_"] button[data-testid="stBaseButton-secondary"] [data-testid="stIconMaterial"] {
    color:#dc2626 !important;
    font-size:18px !important;
}
[class*="st-key-delete_portfolio_"] button[data-testid="stBaseButton-secondary"]:hover {
    background:#fef2f2 !important;
    color:#b91c1c !important;
}
[class*="st-key-select_portfolio_"] button[data-testid="stBaseButton-secondary"],
[class*="st-key-select_all_portfolios"] button[data-testid="stBaseButton-secondary"] {
    background:#fff !important;
    color:#111827 !important;
    border:0 !important;
    box-shadow:none !important;
    justify-content:center !important;
    padding:0 4px !important;
}
[class*="st-key-select_portfolio_"] button[data-testid="stBaseButton-secondary"] p,
[class*="st-key-select_all_portfolios"] button[data-testid="stBaseButton-secondary"] p {
    justify-content:center !important;
    text-align:center !important;
    font-weight:500 !important;
}
[class*="st-key-select_portfolio_"] button[data-testid="stBaseButton-secondary"]:hover,
[class*="st-key-select_all_portfolios"] button[data-testid="stBaseButton-secondary"]:hover {
    background:#f8fafc !important;
}

hr { border:none !important; border-top:1px solid #d9e0ea !important; margin:28px 0 !important; }

/* ── Expanders ── */
[data-testid="stExpander"] { border:1px solid #e5e7eb !important; border-radius:10px !important; background:#ffffff !important; box-shadow:0 8px 20px rgba(15,23,42,0.035) !important; margin-bottom:16px !important; overflow:hidden !important; }
[data-testid="stExpander"] summary { background:#ffffff !important; padding:14px 18px !important; font-size:11px !important; font-weight:850 !important; color:#667085 !important; text-transform:uppercase !important; letter-spacing:0.12em !important; border-radius:10px !important; }
[data-testid="stExpander"] summary:hover { background:#f8fafc !important; }
[data-testid="stExpander"] summary svg { color:#667085 !important; }
[data-testid="stExpander"] > div > div { padding:0 18px 12px !important; }

/* ── Country cards ── */
.country-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:12px; margin-bottom:28px; }
.ccard { background:#fff; border:2px solid #e5e7eb; border-radius:12px; padding:16px 18px; cursor:pointer; transition:border-color 0.12s, box-shadow 0.12s; }
.ccard.active { border-color:#111827; box-shadow:0 8px 22px rgba(15,23,42,0.10); }
.ccard:hover { border-color:#9ca3af; }
.ccard-label { font-size:10px; font-weight:850; color:#667085; text-transform:uppercase; letter-spacing:0.12em; margin-bottom:8px; }
.ccard-value { font-size:20px; font-weight:850; color:#111827; margin-bottom:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ccard-gain { font-size:13px; font-weight:700; margin-bottom:2px; }
.ccard-meta { font-size:11px; color:#667085; }

/* ── Holdings row table ── */
.htable-wrap { background:#ffffff; border:1px solid #e5e7eb; border-radius:10px; overflow:hidden; box-shadow:0 8px 20px rgba(15,23,42,0.035); margin-bottom:8px; }
.htable-head { display:grid; background:#f8fafc; border-bottom:1px solid #e5e7eb; padding:10px 10px; }
.htable-head span { font-size:10px; font-weight:850; color:#475467; text-transform:uppercase; letter-spacing:0.06em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.hrow { border-bottom:1px solid #edf1f6; padding:0 10px; display:flex; align-items:center; }
.hrow:last-child { border-bottom:none; }
.hrow:hover { background:#f8fafc; }
.hrow-name { font-weight:650; color:#111827; font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.hrow-sub { font-size:11px; color:#667085; margin-top:2px; }
.hrow-num { font-size:13px; color:#172033; font-variant-numeric:tabular-nums; text-align:right; }
.hrow-ret-good { color:#047857; font-weight:800; font-size:13px; text-align:right; }
.hrow-ret-bad  { color:#be123c; font-weight:800; font-size:13px; text-align:right; }
.hrow-ret-flat { color:#475467; font-weight:800; font-size:13px; text-align:right; }
.hrow-muted { color:#667085; font-size:12px; text-align:right; }

/* Icon action buttons */
/* ── Row action buttons ── */
[class*="st-key-e_"] button,
[class*="st-key-d_"] button {
    min-height:32px !important; height:32px !important;
    min-width:56px !important;
    padding:0 10px !important; border-radius:6px !important;
    font-size:11px !important; font-weight:800 !important;
    letter-spacing:0.03em !important;
    line-height:1 !important; box-shadow:none !important;
    margin-top:8px !important;
}
[class*="st-key-e_"] button { background:#f8fafc !important; border:1px solid #d1d5db !important; color:#374151 !important; }
[class*="st-key-e_"] button:hover { background:#f1f5f9 !important; border-color:#9ca3af !important; color:#111827 !important; }
[class*="st-key-d_"] button { background:#fff1f2 !important; border:1px solid #fecdd3 !important; color:#be123c !important; }
[class*="st-key-d_"] button:hover { background:#ffe4e6 !important; border-color:#fca5a5 !important; }
[class*="st-key-dok_"] button { background:#be123c !important; border-color:#be123c !important; color:#fff !important; min-height:36px !important; height:36px !important; width:100% !important; font-size:13px !important; }
[class*="st-key-dcan_"] button { background:#fff !important; border:1px solid #d1d5db !important; color:#374151 !important; min-height:36px !important; height:36px !important; width:100% !important; font-size:13px !important; }
[class*="st-key-es_"] button { min-height:36px !important; height:36px !important; font-size:13px !important; }

/* Edit form panel */
.edit-panel { background:#f8fafc; border:1px solid #e5e7eb; border-radius:10px; padding:18px 20px 20px; margin:4px 0 8px; }
.edit-panel-title { font-size:12px; font-weight:850; color:#374151; text-transform:uppercase; letter-spacing:0.1em; margin-bottom:14px; }
@media (max-width: 760px) {
    .block-container { padding:24px 18px 36px !important; }
    .hero-amount { font-size:40px; white-space:normal; }
    .summary-grid { grid-template-columns:1fr; }
    .register-header { grid-template-columns:1fr; }
    .register-actions { align-items:stretch; min-width:0; }
    .register-strip { grid-template-columns:repeat(2, minmax(0, 1fr)); }
    .breakdown-grid { grid-template-columns:1fr; }
    .register-total { font-size:40px; }
    .currency-grid { grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:12px; }
    .cc { min-height:150px; padding:16px; }
    .cc-val { font-size:21px; }
    .allocation-panel { min-height:0; }
    .alloc-hero { grid-template-columns:1fr; }
    .alloc-row { grid-template-columns:1fr; gap:6px; }
}
</style>
""", unsafe_allow_html=True)

SYM  = {
    "INR":"₹", "USD":"$", "SGD":"S$", "EUR":"€", "GBP":"£", "JPY":"¥",
    "AUD":"A$", "CAD":"C$", "CHF":"CHF ", "HKD":"HK$", "CNY":"¥",
    "AED":"د.إ", "NZD":"NZ$", "SEK":"kr", "NOK":"kr", "DKK":"kr",
}
FLG  = {"INR":"🇮🇳","USD":"🇺🇸","SGD":"🇸🇬","EUR":"🇪🇺","GBP":"🇬🇧","JPY":"🇯🇵"}
CLRS = ["#111827","#475569","#64748b","#0f766e","#7c3aed","#b45309","#be123c"]
CURS = ["INR","USD","SGD","EUR","GBP","JPY","AUD","CAD","CHF","HKD","CNY","AED"]
CUSTOM_MARKET = "Other / type manually"
MARKETS = [
    "India", "United States", "Singapore", "United Kingdom", "Europe",
    "Australia", "Canada", "Hong Kong", "Japan", "China", "Switzerland",
    "Germany", "France", "Netherlands", "UAE", "New Zealand", "Ireland",
    "Luxembourg", "Italy", "Spain", "Sweden", "Norway", "Denmark",
    "South Korea", "Taiwan", "Indonesia", "Malaysia", "Thailand",
    "Philippines", "Vietnam", "Brazil", "Mexico", "South Africa",
    CUSTOM_MARKET,
]
MARKET_CURRENCY = {
    "India": "INR", "United States": "USD", "Singapore": "SGD", "United Kingdom": "GBP",
    "Europe": "EUR", "Japan": "JPY", "Hong Kong": "HKD", "China": "CNY",
    "Australia": "AUD", "Canada": "CAD", "Switzerland": "CHF", "Germany": "EUR",
    "France": "EUR", "Netherlands": "EUR", "UAE": "AED", "New Zealand": "NZD",
    "Ireland": "EUR", "Luxembourg": "EUR", "Italy": "EUR", "Spain": "EUR",
    "Sweden": "SEK", "Norway": "NOK", "Denmark": "DKK", "South Korea": "USD",
    "Taiwan": "USD", "Indonesia": "USD", "Malaysia": "USD", "Thailand": "USD",
    "Philippines": "USD", "Vietnam": "USD", "Brazil": "USD", "Mexico": "USD",
    "South Africa": "USD",
}
MARKET_EXCHANGES = {
    "India": ["NSE", "BSE", "Other"],
    "United States": ["NASDAQ", "NYSE", "AMEX", "OTC", "Other"],
    "Singapore": ["SGX", "Other"],
    "United Kingdom": ["LSE", "Other"],
    "Europe": ["Euronext", "XETRA", "SIX", "Borsa Italiana", "Madrid", "Other"],
    "Japan": ["TSE", "Other"],
    "Hong Kong": ["HKEX", "Other"],
    "China": ["SSE", "SZSE", "Other"],
    "Australia": ["ASX", "Other"],
    "Canada": ["TSX", "TSXV", "Other"],
    "Switzerland": ["SIX", "Other"],
    "Germany": ["XETRA", "Frankfurt", "Other"],
    "France": ["Euronext", "Other"],
    "Netherlands": ["Euronext", "Other"],
    "UAE": ["DFM", "ADX", "Nasdaq Dubai", "Other"],
    "Australia": ["ASX", "Other"],
    "Canada": ["TSX", "TSXV", "Other"],
    "New Zealand": ["NZX", "Other"],
    "Ireland": ["Euronext Dublin", "Other"],
    "Luxembourg": ["LuxSE", "Other"],
    "Italy": ["Borsa Italiana", "Other"],
    "Spain": ["Madrid", "Other"],
    "Sweden": ["Nasdaq Stockholm", "Other"],
    "Norway": ["Oslo", "Other"],
    "Denmark": ["Nasdaq Copenhagen", "Other"],
    "South Korea": ["KRX", "Other"],
    "Taiwan": ["TWSE", "TPEX", "Other"],
    "Indonesia": ["IDX", "Other"],
    "Malaysia": ["Bursa Malaysia", "Other"],
    "Thailand": ["SET", "Other"],
    "Philippines": ["PSE", "Other"],
    "Vietnam": ["HOSE", "HNX", "Other"],
    "Brazil": ["B3", "Other"],
    "Mexico": ["BMV", "Other"],
    "South Africa": ["JSE", "Other"],
}

@st.cache_data(ttl=3600)
def get_fx():
    try:
        r = requests.get("https://api.exchangerate-api.com/v4/latest/INR", timeout=4).json()
        rt = r["rates"]
        currencies = ["USD","SGD","EUR","GBP","JPY","AUD","CAD","CHF","HKD","CNY","AED","NZD","SEK","NOK","DKK"]
        return {c: 1/rt[c] for c in currencies if c in rt} | {"INR":1.0}
    except:
        return {
            "INR":1, "USD":83.5, "SGD":62.0, "EUR":91.0, "GBP":106.0, "JPY":0.55,
            "AUD":55.0, "CAD":61.0, "CHF":94.0, "HKD":10.7, "CNY":11.6,
            "AED":22.7, "NZD":51.0, "SEK":8.3, "NOK":8.0, "DKK":12.2,
        }

def to_inr(val, cur, fx): return val * fx.get(cur, 1)
def from_inr(inr, cur, fx): return inr if cur=="INR" else inr / fx.get(cur, 1)

def fmt(val, cur):
    s = SYM.get(cur, cur+" ")
    if cur == "INR":
        if abs(val)>=1e7: return f"₹{val/1e7:.2f} Cr"
        if abs(val)>=1e5: return f"₹{val/1e5:.1f}L"
        return f"₹{val:,.0f}"
    if abs(val)>=1e6: return f"{s}{val/1e6:.2f}M"
    if abs(val)>=1e3: return f"{s}{val/1e3:.1f}K"
    return f"{s}{val:,.0f}"

def fmt_pct(val):
    return "—" if pd.isna(val) else f"{val:.1f}%"

def fmt_signed_pct(val):
    return "—" if pd.isna(val) else f"{val:+.1f}%"

def fmt_plain(val, decimals=0):
    if pd.isna(val):
        return "—"
    try:
        number = float(val)
    except (TypeError, ValueError):
        return "—"
    if decimals:
        return f"{number:,.{decimals}f}"
    return f"{number:,.0f}"

def parse_decimal(value):
    text = str(value).replace(",", "").strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None

def fmt_price(val, cur):
    if pd.isna(val):
        return "—"
    return fmt(float(val), cur)

def fmt_date(value):
    if pd.isna(value) or not str(value).strip():
        return "—"
    raw = str(value).strip()
    for pattern in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d-%b-%Y", "%d-%B-%Y", "%d %b %Y", "%d %B %Y"):
        try:
            parsed = datetime.strptime(raw, pattern)
            return f"{parsed.day} {parsed.strftime('%b %Y')}"
        except ValueError:
            continue
    return raw

def tone_class(val):
    if pd.isna(val): return ""
    if val > 0: return "good"
    if val < 0: return "bad"
    return "neutral"

def market_symbol(ticker, exchange):
    cleaned = ticker.strip().upper()
    if not cleaned:
        return None
    if "." in cleaned or exchange in {"NASDAQ", "NYSE", "AMEX", "OTC"}:
        return cleaned
    suffixes = {
        "NSE": ".NS",
        "BSE": ".BO",
        "SGX": ".SI",
        "LSE": ".L",
        "TSE": ".T",
        "Euronext": ".PA",
        "XETRA": ".DE",
        "Frankfurt": ".F",
        "SIX": ".SW",
        "Borsa Italiana": ".MI",
        "Madrid": ".MC",
        "HKEX": ".HK",
        "ASX": ".AX",
        "TSX": ".TO",
        "TSXV": ".V",
        "NZX": ".NZ",
        "Euronext Dublin": ".IR",
        "LuxSE": ".LU",
        "Nasdaq Stockholm": ".ST",
        "Oslo": ".OL",
        "Nasdaq Copenhagen": ".CO",
        "KRX": ".KS",
        "TWSE": ".TW",
        "TPEX": ".TWO",
        "IDX": ".JK",
        "Bursa Malaysia": ".KL",
        "SET": ".BK",
        "PSE": ".PS",
        "HOSE": ".VN",
        "HNX": ".VN",
        "B3": ".SA",
        "BMV": ".MX",
        "JSE": ".JO",
    }
    return cleaned + suffixes.get(exchange, "")

def allocation_html(df, group_col, total_inr, dc, fx, limit=6):
    if group_col not in df.columns or df.empty:
        return '<div class="alloc-meta">No data yet</div>'
    grouped = (
        df.assign(**{group_col: df[group_col].fillna("Other").replace("", "Other")})
          .groupby(group_col, dropna=False)
          .agg(value_inr=("Value INR", "sum"), count=("Name", "count"))
          .reset_index()
          .sort_values("value_inr", ascending=False)
          .head(limit)
    )
    rows = []
    for idx, item in grouped.iterrows():
        pct = item["value_inr"] / total_inr * 100 if total_inr else 0
        color = CLRS[idx % len(CLRS)]
        rows.append(f"""
        <div class="alloc-row">
            <div>
                <div class="alloc-name-line">
                    <span class="alloc-dot" style="background:{color}"></span>
                    <span class="alloc-name">{html.escape(str(item[group_col]))}</span>
                </div>
                <div class="alloc-meta">{int(item["count"])} holdings</div>
            </div>
            <div class="alloc-right">
                <div class="alloc-value-line">
                    <span class="alloc-value">{fmt(from_inr(item["value_inr"], dc, fx), dc)}</span>
                    <span class="alloc-pct">{pct:.1f}%</span>
                </div>
                <div class="alloc-track"><div class="alloc-fill" style="width:{pct:.1f}%;background:{color}"></div></div>
            </div>
        </div>
        """)
    return "".join(rows)

def performance_html(df, group_col, dc, fx, limit=6):
    if group_col not in df.columns or df.empty:
        return '<div class="alloc-meta">No data yet</div>'
    grouped = (
        df.assign(**{group_col: df[group_col].fillna("Other").replace("", "Other")})
          .groupby(group_col, dropna=False)
          .agg(cost_inr=("Cost Basis INR", "sum"), gain_inr=("Gain INR", "sum"), value_inr=("Value INR", "sum"))
          .reset_index()
    )
    grouped["gain_pct"] = grouped.apply(
        lambda row: row["gain_inr"] / row["cost_inr"] * 100 if row["cost_inr"] else None,
        axis=1,
    )
    grouped = grouped.sort_values("value_inr", ascending=False).head(limit)
    rows = []
    for _, item in grouped.iterrows():
        gain = item["gain_inr"]
        gain_pct = item["gain_pct"]
        color_class = "good" if gain >= 0 else "bad"
        rows.append(f"""
        <div class="alloc-row">
            <div>
                <div class="alloc-name-line">
                    <span class="alloc-dot" style="background:#111827"></span>
                    <span class="alloc-name">{html.escape(str(item[group_col]))}</span>
                </div>
                <div class="alloc-meta">Cost {fmt(from_inr(item["cost_inr"], dc, fx), dc) if item["cost_inr"] else "—"}</div>
            </div>
            <div class="alloc-right">
                <div class="alloc-value-line">
                    <span class="alloc-value {color_class}">{fmt(from_inr(gain, dc, fx), dc)}</span>
                    <span class="alloc-pct">{fmt_pct(gain_pct)}</span>
                </div>
                <div class="alloc-track"><div class="alloc-fill" style="width:{min(abs(gain_pct or 0), 100):.1f}%;background:#111827"></div></div>
            </div>
        </div>
        """)
    return "".join(rows)

def asset_allocation_html(frame, display_cur, fx_rates, total_inr):
    if frame.empty or total_inr == 0:
        return ""
    grp = (
        frame.groupby("Asset Type")["Value INR"].sum()
             .reset_index().sort_values("Value INR", ascending=False)
    )
    parts = []
    for i, row in grp.iterrows():
        pct = row["Value INR"] / total_inr * 100
        val = from_inr(row["Value INR"], display_cur, fx_rates)
        color = CLRS[i % len(CLRS)]
        parts.append(f"""
        <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #edf1f6">
            <div style="width:10px;height:10px;border-radius:3px;background:{color};flex-shrink:0"></div>
            <div style="flex:1;min-width:0">
                <div style="font-size:13px;font-weight:700;color:#111827">{html.escape(str(row['Asset Type']))}</div>
            </div>
            <div style="font-size:13px;font-weight:700;color:#111827;font-variant-numeric:tabular-nums">{fmt(val,display_cur)}</div>
            <div style="font-size:12px;color:#667085;width:48px;text-align:right;white-space:nowrap">{pct:.1f}%</div>
            <div style="width:80px;height:6px;background:#e8edf3;border-radius:999px;overflow:hidden;flex-shrink:0">
                <div style="width:{pct:.1f}%;height:100%;background:{color};border-radius:999px"></div>
            </div>
        </div>""")
    return "".join(parts)

def delete_portfolio_and_reset(portfolio_id):
    delete_portfolio(portfolio_id)
    if st.session_state.get("selected_portfolio_id") == portfolio_id:
        st.session_state.selected_portfolio_id = None

def save_portfolio_name(portfolio_id, key):
    cleaned = st.session_state.get(key, "").strip()
    if cleaned:
        rename_portfolio(portfolio_id, cleaned)
        st.session_state.edit_portfolio_id = None

# ── Init ───────────────────────────────────────────────────────────────────────
fx = get_fx()
if "cur"  not in st.session_state: st.session_state.cur = "INR"
if "selected_portfolio_id" not in st.session_state: st.session_state.selected_portfolio_id = None
if "edit_portfolio_id" not in st.session_state: st.session_state.edit_portfolio_id = None
if "adding_platform" not in st.session_state: st.session_state.adding_platform = False
if "editing_security_id" not in st.session_state: st.session_state.editing_security_id = None
if "confirm_delete_id" not in st.session_state: st.session_state.confirm_delete_id = None
if "selected_country_filter" not in st.session_state: st.session_state.selected_country_filter = None

portfolios = get_all_portfolios(user_id=_user_id)
all_df = get_securities(user_id=_user_id)
if "selected_country_filter" not in st.session_state:
    st.session_state.selected_country_filter = "All Countries"

@st.dialog("Add Investment", width="large")
def add_investment_dialog():
    st.markdown('<div class="slabel">Add Investment</div>', unsafe_allow_html=True)
    platform_lookup = {}
    for portfolio in portfolios:
        platform_lookup.setdefault(portfolio[1], portfolio)
    if not platform_lookup:
        st.session_state.adding_platform = True

    st.markdown('<div class="form-section-title">Asset</div>', unsafe_allow_html=True)
    row1 = st.columns([1.6, 1, 1])
    with row1[0]:
        holding_name = st.text_input("Asset name", placeholder="Apple Inc, UTI Nifty 50 Index Fund, DBS Savings")
    with row1[1]:
        asset_type = st.selectbox("Asset type", ["Stock", "ETF", "Mutual Fund", "Bond", "Savings", "Other"])
    with row1[2]:
        country_choice = st.selectbox("Market / country", MARKETS)
    if country_choice == CUSTOM_MARKET:
        country = st.text_input("Custom market / country", placeholder="Brazil, Indonesia, Luxembourg")
        exchange_market = CUSTOM_MARKET
    else:
        country = country_choice
        exchange_market = country_choice

    st.markdown('<div class="form-section-title">Identifier</div>', unsafe_allow_html=True)
    exchange = None
    raw_symbol = None
    identifier_type = None
    if asset_type in {"Stock", "ETF"}:
        row2 = st.columns([1, 1.2, 1])
        with row2[0]:
            identifier_type = st.selectbox("Identifier type", ["Ticker", "ISIN"])
        with row2[1]:
            raw_symbol = st.text_input(identifier_type, placeholder="AAPL, VOO, D05" if identifier_type == "Ticker" else "US0378331005")
        with row2[2]:
            if identifier_type == "Ticker":
                exchange = st.selectbox("Exchange", MARKET_EXCHANGES.get(exchange_market, ["Other"]))
    elif asset_type == "Mutual Fund":
        row2 = st.columns([1, 1.2, 1])
        with row2[0]:
            identifier_type = st.selectbox("Identifier type", ["Scheme code", "ISIN"])
        with row2[1]:
            raw_symbol = st.text_input(identifier_type, placeholder="120716" if identifier_type == "Scheme code" else "INF789F1AUX7")
    elif asset_type == "Bond":
        row2 = st.columns([1, 1.2, 1])
        with row2[0]:
            identifier_type = st.selectbox("Identifier type", ["None", "ISIN"])
        with row2[1]:
            if identifier_type == "ISIN":
                raw_symbol = st.text_input("ISIN", placeholder="US1234567890")
    else:
        st.markdown('<div class="form-hint">No ticker or scheme code needed for this asset type.</div>', unsafe_allow_html=True)

    st.markdown('<div class="form-section-title">Position</div>', unsafe_allow_html=True)
    row4 = st.columns([1, 1, 1, 1])
    with row4[0]:
        quantity_raw = st.text_input("Quantity bought", placeholder="1.000000")
    with row4[1]:
        cost_price_raw = st.text_input("Cost price", placeholder="100.00")
    with row4[2]:
        purchase_date = st.date_input("Date bought", value=date_cls.today(), max_value=date_cls.today(), format="DD/MM/YYYY")
    with row4[3]:
        current_price_raw = st.text_input("Current price", placeholder="150.00")

    save_col, _ = st.columns([1, 5])
    submitted = save_col.button("Save Investment", use_container_width=True)

    if submitted:
        cleaned_holding = holding_name.strip()
        cleaned_country = country.strip()
        quantity = parse_decimal(quantity_raw)
        cost_price = parse_decimal(cost_price_raw)
        current_price = parse_decimal(current_price_raw)
        auto_asset = asset_type in {"Stock", "ETF", "Mutual Fund"}
        price_symbol = raw_symbol.strip() if raw_symbol else None
        if asset_type in {"Stock", "ETF"} and identifier_type == "Ticker":
            price_symbol = market_symbol(price_symbol or "", exchange)
        if not cleaned_holding or not cleaned_country:
            st.error("Add the asset name and market / country.")
        elif auto_asset and not price_symbol:
            st.error("Add the identifier for this asset.")
        elif quantity is None or quantity <= 0:
            st.error("Add quantity bought.")
        elif cost_price is None or cost_price <= 0:
            st.error("Add cost price.")
        elif current_price is None or current_price <= 0:
            st.error("Add current price.")
        else:
            currency = MARKET_CURRENCY.get(country_choice, "USD")
            pricing_mode = "auto" if auto_asset else "manual"
            current_value = current_price * quantity
            portfolio_id = create_manual_portfolio("Investments", datetime.now().strftime("%d-%b-%Y"), user_id=_user_id)
            add_manual_security(
                portfolio_id=portfolio_id,
                name=cleaned_holding,
                asset_type=asset_type,
                currency=currency,
                country=cleaned_country,
                pricing_mode=pricing_mode,
                quantity=quantity if quantity else None,
                latest_price=current_price,
                value=current_value,
                value_inr=to_inr(current_value, currency, fx),
                annual_income=None,
                return_pct=None,
                price_symbol=price_symbol,
                exchange=exchange,
                cost_price=cost_price,
                purchase_date=purchase_date.strftime("%Y-%m-%d"),
            )
            st.session_state.adding_platform = False
            if pricing_mode == "auto":
                with st.spinner("Fetching latest price..."):
                    refresh_prices()
            st.success(f"Saved {cleaned_holding}.")
            st.rerun()

# ── Top nav ────────────────────────────────────────────────────────────────────
_pic  = _user.get("picture", "")
_name = (_user.get("given_name") or (_user.get("name", "").split()[0] if _user.get("name") else _user.get("email", "User")))

n1, n_add, n_out = st.columns([4, 1.2, 0.6])
with n1:
    st.markdown(f"""
<div style="display:flex;align-items:center;gap:12px">
  <img src="{_pic}" referrerpolicy="no-referrer"
       style="width:32px;height:32px;border-radius:50%;object-fit:cover;border:1.5px solid #e5e7eb;flex-shrink:0"/>
  <span class="brand-name">Investments</span>
</div>""", unsafe_allow_html=True)
with n_add:
    if st.button("＋  Add Investment", key="add_inv_btn", use_container_width=True):
        add_investment_dialog()
with n_out:
    if st.button("Sign out", key="logout_nav_btn", use_container_width=True):
        logout()

st.markdown("<hr style='margin:0 0 28px'>", unsafe_allow_html=True)

dc = "INR"  # Totals in INR; individual assets display their own currency.

# ── Dashboard ──────────────────────────────────────────────────────────────────
if not all_df.empty:
    all_df = all_df.copy()
    all_df["Country"] = all_df["Country"].fillna("Other").replace("", "Other")
    all_df["Cost Basis INR"] = (
        all_df["Quantity"].fillna(0)
        * all_df.get("Cost Price", pd.Series(0, index=all_df.index)).fillna(0)
        * all_df["Currency"].map(lambda c: fx.get(c, 1))
    )
    all_df["Gain INR"] = all_df["Value INR"] - all_df["Cost Basis INR"]

    countries_list = sorted(all_df["Country"].unique())

    def country_stats(frame):
        vinr = frame["Value INR"].sum()
        cinr = frame["Cost Basis INR"].sum()
        ginr = frame["Gain INR"].sum()
        gpct = ginr / cinr * 100 if cinr else None
        inc  = (frame["Annual Income"].fillna(0) * frame["Currency"].map(lambda c: fx.get(c, 1))).sum()
        return vinr, cinr, ginr, gpct, inc, len(frame)

    def dominant_currency(country):
        frame = all_df[all_df["Country"] == country]
        if frame.empty:
            return MARKET_CURRENCY.get(country, "USD")
        return frame.groupby("Currency")["Value INR"].sum().idxmax()

    def mark_currency_override(country):
        st.session_state[f"dc_override_{country}"] = True

    def refresh_type_text(rs, bucket):
        type_counts = []
        for asset_type, counts in sorted(rs.get("by_type", {}).items()):
            count = counts.get(bucket, 0)
            if count:
                label = asset_type if count == 1 or str(asset_type).endswith("s") else f"{asset_type}s"
                type_counts.append(f"{count} {label}")
        return ", ".join(type_counts)

    # ── Refresh + tab bar ─────────────────────────────────────────────────────
    ref_col, _ = st.columns([1, 3])
    with ref_col:
        if st.button("Refresh Prices", use_container_width=True, key="main_refresh"):
            with st.spinner("Updating prices..."):
                st.session_state["_refresh_summary"] = refresh_prices()
            st.rerun()
        if st.session_state.get("_refresh_summary"):
            rs = st.session_state["_refresh_summary"]
            updated_types = refresh_type_text(rs, "updated")
            parts = [f'{rs.get("updated",0)} updated' + (f" ({updated_types})" if updated_types else "")]
            if rs.get("unchanged", 0):
                unchanged_types = refresh_type_text(rs, "unchanged")
                parts.append(f'{rs.get("unchanged",0)} unchanged' + (f" ({unchanged_types})" if unchanged_types else ""))
            if rs.get("manual", 0):
                manual_types = refresh_type_text(rs, "manual")
                parts.append(f'{rs.get("manual",0)} manual' + (f" ({manual_types})" if manual_types else ""))
            if rs.get("not_refreshed", 0):
                setup_types = refresh_type_text(rs, "not_refreshed")
                parts.append(f'{rs.get("not_refreshed",0)} need setup' + (f" ({setup_types})" if setup_types else ""))
            if rs.get("failed", 0):
                failed_types = refresh_type_text(rs, "failed")
                parts.append(f'{rs.get("failed",0)} failed' + (f" ({failed_types})" if failed_types else ""))
            st.markdown(f'<div style="font-size:11px;color:#047857;font-weight:700;margin-top:4px">{" · ".join(parts)}</div>', unsafe_allow_html=True)

    st.markdown("<div style='height:12px'></div>", unsafe_allow_html=True)

    country_tabs = st.tabs(["All"] + countries_list)

    # Helper: render holdings with inline edit/delete buttons
    def render_holdings(frame, tab_prefix, dc, total_inr_for_pct):
        if frame.empty:
            st.markdown("<div style='color:#667085;font-size:13px;padding:16px 0'>No holdings.</div>", unsafe_allow_html=True)
            return
        # Clear edit/delete state if the target security isn't in this tab's frame
        ids_in_frame = set(frame["ID"].tolist())
        if st.session_state.editing_security_id not in ids_in_frame:
            st.session_state.editing_security_id = None
        if st.session_state.confirm_delete_id not in ids_in_frame:
            st.session_state.confirm_delete_id = None
        filt = frame.copy()
        filt["_tc_inr"] = filt["Quantity"].fillna(0) * filt["Cost Price"].fillna(0) * filt["Currency"].map(lambda c: fx.get(c,1))
        filt["_g_inr"]  = filt["Value INR"] - filt["_tc_inr"]
        filt["_gp"]     = filt.apply(lambda r: r["_g_inr"]/r["_tc_inr"]*100 if r["_tc_inr"] else None, axis=1)
        filt["_pp"]     = filt["Value INR"] / total_inr_for_pct * 100 if total_inr_for_pct else 0
        filt = filt.sort_values("Value INR", ascending=False)

        # Single HTML block for header
        st.markdown("""
        <div style='display:grid;grid-template-columns:2.4fr 0.55fr 0.8fr 1fr 1fr 1fr 1fr 0.7fr 0.9fr 0.7fr 0.7fr;
        gap:0;padding:8px 6px 6px;border-bottom:1px solid #e5e7eb'>
        <span style='font-size:10px;font-weight:850;color:#475467;text-transform:uppercase;letter-spacing:0.06em'>Security</span>
        <span style='font-size:10px;font-weight:850;color:#475467;text-transform:uppercase;letter-spacing:0.06em'>Cur</span>
        <span style='font-size:10px;font-weight:850;color:#475467;text-transform:uppercase;letter-spacing:0.06em;text-align:right'>Qty</span>
        <span style='font-size:10px;font-weight:850;color:#475467;text-transform:uppercase;letter-spacing:0.06em;text-align:right'>Mkt Price</span>
        <span style='font-size:10px;font-weight:850;color:#475467;text-transform:uppercase;letter-spacing:0.06em;text-align:right'>Value</span>
        <span style='font-size:10px;font-weight:850;color:#475467;text-transform:uppercase;letter-spacing:0.06em;text-align:right'>Cost</span>
        <span style='font-size:10px;font-weight:850;color:#475467;text-transform:uppercase;letter-spacing:0.06em;text-align:right'>Gain/Loss</span>
        <span style='font-size:10px;font-weight:850;color:#475467;text-transform:uppercase;letter-spacing:0.06em;text-align:right'>Gain %</span>
        <span style='font-size:10px;font-weight:850;color:#475467;text-transform:uppercase;letter-spacing:0.06em;text-align:right'>Updated</span>
        <span></span><span></span>
        </div>""", unsafe_allow_html=True)

        COLS = [2.4, 0.55, 0.8, 1, 1, 1, 1, 0.7, 0.9, 0.7, 0.7]
        for _, item in filt.iterrows():
            sid = item["ID"]
            cur = item["Currency"]
            is_editing  = st.session_state.editing_security_id == sid
            is_deleting = st.session_state.confirm_delete_id   == sid
            v_d  = from_inr(item["Value INR"], dc, fx)
            tc_d = from_inr(item["_tc_inr"], dc, fx) if item["_tc_inr"] else None
            g_d  = from_inr(item["_g_inr"],  dc, fx) if item["_tc_inr"] else None
            gp   = item["_gp"]
            gc   = "#047857" if (gp or 0) >= 0 else "#be123c"
            gt   = f"{gp:+.1f}%" if pd.notna(gp) else "—"
            lp_d = from_inr(item.get("Latest Price",0)*fx.get(cur,1), dc, fx) if pd.notna(item.get("Latest Price")) else None

            c = st.columns(COLS)
            c[0].markdown(f"<div style='font-size:13px;font-weight:650;color:#111827;padding:10px 4px 2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis'>{html.escape(str(item['Name']))}</div><div style='font-size:11px;color:#667085;padding-bottom:8px'>{html.escape(str(item['Asset Type']))} · {item['_pp']:.1f}%</div>", unsafe_allow_html=True)
            c[1].markdown(f"<div style='font-size:12px;color:#667085;padding:12px 2px'>{html.escape(cur)}</div>", unsafe_allow_html=True)
            c[2].markdown(f"<div style='font-size:13px;color:#374151;text-align:right;padding:12px 2px;font-variant-numeric:tabular-nums'>{fmt_plain(item['Quantity'],2) if pd.notna(item.get('Quantity')) else '—'}</div>", unsafe_allow_html=True)
            c[3].markdown(f"<div style='font-size:13px;color:#374151;text-align:right;padding:12px 2px;font-variant-numeric:tabular-nums'>{fmt(lp_d,dc) if lp_d else '—'}</div>", unsafe_allow_html=True)
            c[4].markdown(f"<div style='font-size:13px;font-weight:700;color:#111827;text-align:right;padding:12px 2px;font-variant-numeric:tabular-nums'>{fmt(v_d,dc)}</div>", unsafe_allow_html=True)
            c[5].markdown(f"<div style='font-size:13px;color:#374151;text-align:right;padding:12px 2px;font-variant-numeric:tabular-nums'>{fmt(tc_d,dc) if tc_d else '—'}</div>", unsafe_allow_html=True)
            c[6].markdown(f"<div style='font-size:13px;font-weight:700;color:{gc};text-align:right;padding:12px 2px;font-variant-numeric:tabular-nums'>{fmt(g_d,dc) if g_d is not None else '—'}</div>", unsafe_allow_html=True)
            c[7].markdown(f"<div style='font-size:13px;font-weight:800;color:{gc};text-align:right;padding:12px 2px'>{gt}</div>", unsafe_allow_html=True)
            c[8].markdown(f"<div style='font-size:12px;color:#667085;text-align:right;padding:12px 2px'>{fmt_date(item['Price As Of'])}</div>", unsafe_allow_html=True)
            with c[9]:
                if st.button("Edit", key=f"e_{tab_prefix}_{sid}", use_container_width=True):
                    st.session_state.editing_security_id = None if is_editing else sid
                    st.session_state.confirm_delete_id = None
                    st.rerun()
            with c[10]:
                if st.button("Delete", key=f"d_{tab_prefix}_{sid}", use_container_width=True):
                    st.session_state.confirm_delete_id = None if is_deleting else sid
                    st.session_state.editing_security_id = None
                    st.rerun()
            st.markdown("<div style='height:1px;background:#edf1f6'></div>", unsafe_allow_html=True)

            if is_deleting:
                with st.container(border=True):
                    st.markdown(f"<span style='font-size:13px;font-weight:700'>Delete <b>{html.escape(str(item['Name']))}</b>? This cannot be undone.</span>", unsafe_allow_html=True)
                    d1,d2,_ = st.columns([1,1,5])
                    if d1.button("Delete", key=f"dok_{tab_prefix}_{sid}", use_container_width=True):
                        delete_security(int(sid)); st.session_state.confirm_delete_id = None; st.rerun()
                    if d2.button("Cancel", key=f"dcan_{tab_prefix}_{sid}", use_container_width=True):
                        st.session_state.confirm_delete_id = None; st.rerun()

            if is_editing:
                with st.container(border=True):
                    st.markdown(f"<div style='font-size:11px;font-weight:850;color:#667085;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:12px'>Edit · {html.escape(str(item['Name']))}</div>", unsafe_allow_html=True)
                    e1,e2,e3,e4,e5 = st.columns(5)
                    nq  = e1.text_input("Quantity",     value=fmt_plain(item['Quantity'],4)     if pd.notna(item.get('Quantity'))     else "", key=f"eq_{tab_prefix}_{sid}")
                    nc  = e2.text_input("Unit Cost",    value=fmt_plain(item['Cost Price'],4)   if pd.notna(item.get('Cost Price'))   else "", key=f"ec_{tab_prefix}_{sid}")
                    np_ = e3.text_input("Latest Price", value=fmt_plain(item['Latest Price'],4) if pd.notna(item.get('Latest Price')) else "", key=f"ep_{tab_prefix}_{sid}")
                    nv  = e4.text_input("Current Value",value=fmt_plain(item['Value'],2)        if pd.notna(item.get('Value'))        else "", key=f"ev_{tab_prefix}_{sid}")
                    nd  = e5.text_input("Purchase Date",value=str(item['Purchase Date'])        if pd.notna(item.get('Purchase Date'))else "", key=f"ed_{tab_prefix}_{sid}")
                    sv,_ = st.columns([1,5])
                    if sv.button("Save", key=f"es_{tab_prefix}_{sid}", use_container_width=True):
                        update_security_fields(int(sid),
                            quantity=parse_decimal(nq) if nq.strip() else None,
                            cost_price=parse_decimal(nc) if nc.strip() else None,
                            latest_price=parse_decimal(np_) if np_.strip() else None,
                            value=parse_decimal(nv) if nv.strip() else None,
                            purchase_date=nd.strip() if nd.strip() else None)
                        st.session_state.editing_security_id = None; st.rerun()

    # ── ALL tab ───────────────────────────────────────────────────────────────
    with country_tabs[0]:
        all_vinr, all_cinr, all_ginr, all_gpct, all_inc, all_n = country_stats(all_df)
        all_inc_count = int(all_df["Annual Income"].notna().sum())
        all_yield = all_inc / all_vinr * 100 if all_vinr else 0
        gcc = "good" if (all_gpct or 0) >= 0 else "bad"

        ov_curs = ["INR"] + [c for c in CURS if c != "INR"]
        if "ov_cur" not in st.session_state: st.session_state.ov_cur = "USD"
        _, cur_col = st.columns([3, 1])
        with cur_col:
            st.session_state.ov_cur = st.selectbox("View in currency", ov_curs,
                index=ov_curs.index(st.session_state.ov_cur), key="ov_cur_select")
        oc = st.session_state.ov_cur

        st.markdown(f"""
        <div class="register-strip">
            <div class="register-metric"><div class="register-metric-label">Total Portfolio</div><div class="register-metric-value">{fmt(from_inr(all_vinr,oc,fx),oc)}</div></div>
            <div class="register-metric"><div class="register-metric-label">Total Cost</div><div class="register-metric-value">{fmt(from_inr(all_cinr,oc,fx),oc) if all_cinr else "—"}</div></div>
            <div class="register-metric"><div class="register-metric-label">Gain / Loss</div><div class="register-metric-value {gcc}">{fmt(from_inr(all_ginr,oc,fx),oc) if all_cinr else "—"}</div></div>
            <div class="register-metric"><div class="register-metric-label">Gain %</div><div class="register-metric-value {gcc}">{fmt_pct(all_gpct)}</div></div>
            <div class="register-metric"><div class="register-metric-label">Annual Income</div><div class="register-metric-value">{fmt(from_inr(all_inc,oc,fx),oc) if all_inc_count else "—"}</div></div>
            <div class="register-metric"><div class="register-metric-label">Yield</div><div class="register-metric-value">{fmt_pct(all_yield) if all_inc_count else "—"}</div></div>
        </div>
        """, unsafe_allow_html=True)

        br1, br2 = st.columns(2)
        with br1:
            with st.expander("Asset Allocation", expanded=True):
                st.markdown(asset_allocation_html(all_df, oc, fx, all_vinr), unsafe_allow_html=True)
        with br2:
            with st.expander("By Country", expanded=True):
                grp_c = all_df.groupby("Country")["Value INR"].sum().reset_index().sort_values("Value INR", ascending=False)
                parts = []
                for i, row in grp_c.iterrows():
                    pct = row["Value INR"] / all_vinr * 100
                    color = CLRS[i % len(CLRS)]
                    parts.append(f"""<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #edf1f6">
                        <div style="width:10px;height:10px;border-radius:3px;background:{color};flex-shrink:0"></div>
                        <div style="flex:1;font-size:13px;font-weight:700;color:#111827">{html.escape(str(row['Country']))}</div>
                        <div style="font-size:13px;font-weight:700;color:#111827;font-variant-numeric:tabular-nums">{fmt(from_inr(row['Value INR'],oc,fx),oc)}</div>
                        <div style="font-size:12px;color:#667085;width:48px;text-align:right;white-space:nowrap">{pct:.1f}%</div>
                        <div style="width:80px;height:6px;background:#e8edf3;border-radius:999px;overflow:hidden;flex-shrink:0">
                            <div style="width:{pct:.1f}%;height:100%;background:{color};border-radius:999px"></div>
                        </div></div>""")
                st.markdown("".join(parts), unsafe_allow_html=True)

        st.markdown('<div class="slabel">Holdings</div>', unsafe_allow_html=True)
        render_holdings(all_df, "all", oc, all_vinr)

    # ── Per-country tabs ──────────────────────────────────────────────────────
    for tab, country in zip(country_tabs[1:], countries_list):
        with tab:
            df = all_df[all_df["Country"] == country].copy()
            vinr, cinr, ginr, gpct, inc, n_hold = country_stats(df)
            inc_count = int(df["Annual Income"].notna().sum())
            inc_yield = inc / vinr * 100 if vinr else 0
            gcc = "good" if (gpct or 0) >= 0 else "bad"

            holding_curs = df["Currency"].unique().tolist()
            extra_curs = [c for c in holding_curs if c not in CURS and c != "INR"]
            avail_curs = CURS + extra_curs
            dc_key = f"dc_{country}"
            default_cur = dominant_currency(country)
            if default_cur not in avail_curs:
                default_cur = MARKET_CURRENCY.get(country, avail_curs[0])
            if default_cur not in avail_curs:
                default_cur = avail_curs[0]
            select_key = f"select_{country}"
            override_key = f"dc_override_{country}"
            should_reset_default = (
                dc_key not in st.session_state
                or st.session_state[dc_key] not in avail_curs
                or (
                    not st.session_state.get(override_key)
                    and st.session_state[dc_key] == "USD"
                    and default_cur != "USD"
                )
            )
            if should_reset_default:
                st.session_state[dc_key] = default_cur
            if (
                select_key not in st.session_state
                or st.session_state[select_key] not in avail_curs
                or (
                    not st.session_state.get(override_key)
                    and st.session_state[select_key] == "USD"
                    and default_cur != "USD"
                )
            ):
                st.session_state[select_key] = st.session_state[dc_key]

            _, cur_col2 = st.columns([3, 1])
            with cur_col2:
                st.session_state[dc_key] = st.selectbox("View in currency", avail_curs,
                    index=avail_curs.index(st.session_state[dc_key]), key=select_key,
                    on_change=mark_currency_override, args=(country,))
            dc = st.session_state[dc_key]

            st.markdown(f"""
            <div class="register-strip">
                <div class="register-metric"><div class="register-metric-label">Market Value</div><div class="register-metric-value">{fmt(from_inr(vinr,dc,fx),dc)}</div></div>
                <div class="register-metric"><div class="register-metric-label">Total Cost</div><div class="register-metric-value">{fmt(from_inr(cinr,dc,fx),dc) if cinr else "—"}</div></div>
                <div class="register-metric"><div class="register-metric-label">Gain / Loss</div><div class="register-metric-value {gcc}">{fmt(from_inr(ginr,dc,fx),dc) if cinr else "—"}</div></div>
                <div class="register-metric"><div class="register-metric-label">Gain %</div><div class="register-metric-value {gcc}">{fmt_pct(gpct)}</div></div>
                <div class="register-metric"><div class="register-metric-label">Annual Income</div><div class="register-metric-value">{fmt(from_inr(inc,dc,fx),dc) if inc_count else "—"}</div></div>
                <div class="register-metric"><div class="register-metric-label">Yield</div><div class="register-metric-value">{fmt_pct(inc_yield) if inc_count else "—"}</div></div>
            </div>
            """, unsafe_allow_html=True)

            with st.expander("Asset Allocation", expanded=True):
                st.markdown(asset_allocation_html(df, dc, fx, vinr), unsafe_allow_html=True)

            st.markdown('<div class="slabel">Holdings</div>', unsafe_allow_html=True)
            ckey = country.replace(" ","_").replace("/","_")
            render_holdings(df, ckey, dc, vinr)

else:
    st.markdown("""
    <div style="text-align:center;padding:100px 0">
        <div style="font-size:48px;margin-bottom:20px">📂</div>
        <div style="font-size:24px;font-weight:900;color:#111827;letter-spacing:0;margin-bottom:8px">No investments yet</div>
        <div style="font-size:14px;color:#526071">Click <b style="color:#2563eb">＋ Add Investment</b> above to get started</div>
    </div>
    """, unsafe_allow_html=True)

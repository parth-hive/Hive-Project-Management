import { useState, useEffect } from "react";

// ── Supabase ──────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_KEY = process.env.REACT_APP_SUPABASE_KEY;

async function sb(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_KEY,
      "Content-Type": "application/json",
      Prefer: options.prefer || "return=representation",
      ...options.headers,
    },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.hint || `HTTP ${res.status}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function hashPassword(password) {
  const encoded = new TextEncoder().encode(password);
  const hash = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// ── Session Management ────────────────────────────────────────────────────────
const SESSION_KEY = "hiveboard_session";
const SESSION_EXPIRY_DAYS = 30;

function saveSession(user) {
  const session = {
    user,
    expiresAt: Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (Date.now() > session.expiresAt) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return session.user;
  } catch { return null; }
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

// ── Biometric Authentication ──────────────────────────────────────────────────
async function checkBiometricAvailable() {
  // Only return true if platform supports it AND we're not on iOS Safari
  // iOS requires full passkey registration flow which we don't support yet
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  if (isIOS) return false;
  if (!window.PublicKeyCredential) return false;
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch { return false; }
}

// ── Push Notifications ────────────────────────────────────────────────────────
const VAPID_PUBLIC_KEY = process.env.REACT_APP_VAPID_PUBLIC_KEY;

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

async function registerPush(userId) {
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return;

    // Register service worker
    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;

    // Get push subscription
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }

    // Save to Supabase (upsert by deleting old then inserting)
    await sb(`push_subscriptions?user_id=eq.${encodeURIComponent(userId)}`, {
      method: "DELETE", prefer: "return=minimal",
    });
    await sb("push_subscriptions", {
      method: "POST", prefer: "return=minimal",
      body: JSON.stringify({ user_id: userId, subscription: sub.toJSON() }),
    });
  } catch (e) {
    console.warn("Push registration failed:", e.message);
  }
}

async function sendPushNotification(userId, title, body) {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/send-push-notification`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_KEY,
      },
      body: JSON.stringify({ user_id: userId, title, body }),
    });
  } catch (e) {
    console.warn("Push send failed:", e.message);
  }
}

// ── Icons ─────────────────────────────────────────────────────────────────────
const Icon = {
  Hexagon: () => (
    <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
      <polygon points="13,2 23,7.5 23,18.5 13,24 3,18.5 3,7.5" stroke="#1A1916" strokeWidth="1.5" fill="none"/>
      <polygon points="13,7 19,10.5 19,15.5 13,19 7,15.5 7,10.5" fill="#1A1916" opacity=".12"/>
    </svg>
  ),
  Task:     () => <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="3" width="14" height="2" rx="1"/><rect x="1" y="7" width="14" height="2" rx="1"/><rect x="1" y="11" width="8" height="2" rx="1"/></svg>,
  Clock:    () => <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5" fill="none"/><path d="M7 4v3l2 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none"/></svg>,
  Urgent:   () => <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M7 1L13 12H1L7 1Z" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinejoin="round"/><rect x="6.3" y="5" width="1.4" height="4" rx=".7"/><circle cx="7" cy="10.5" r=".8"/></svg>,
  Comment:  () => <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M2 2h10a1 1 0 011 1v6a1 1 0 01-1 1H5L2 12V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinejoin="round"/></svg>,
  Logout:   () => <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M10 8H3M7 5L3 8l4 3M9 3h3a1 1 0 011 1v8a1 1 0 01-1 1H9" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  Plus:     () => <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>,
  User:     () => <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><circle cx="7" cy="5" r="3" stroke="currentColor" strokeWidth="1.3" fill="none"/><path d="M1 13c0-3.3 2.7-5 6-5s6 1.7 6 5" stroke="currentColor" strokeWidth="1.3" fill="none"/></svg>,
  Key:      () => <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><circle cx="5.5" cy="5.5" r="3.5" stroke="currentColor" strokeWidth="1.3" fill="none"/><path d="M8.5 8.5L13 13M10 11l1.5-1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  Eye:      () => <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M1 7s2.5-4.5 6-4.5S13 7 13 7s-2.5 4.5-6 4.5S1 7 1 7z" stroke="currentColor" strokeWidth="1.3" fill="none"/><circle cx="7" cy="7" r="1.8" stroke="currentColor" strokeWidth="1.3" fill="none"/></svg>,
  EyeOff:   () => <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M1 1l12 12M5.5 5.6A1.8 1.8 0 009.3 9M3 3.8C2 4.7 1.3 5.9 1 7c.8 3 3.6 4.5 6 4.5 1.2 0 2.4-.4 3.4-1M6.5 2.6C6.8 2.5 7 2.5 7 2.5c3.5 0 6 4.5 6 4.5s-.4.7-1.2 1.6" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round"/></svg>,
  Overview: () => <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.3" fill="none"/><rect x="9" y="1" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.3" fill="none"/><rect x="1" y="9" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.3" fill="none"/><rect x="9" y="9" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.3" fill="none"/></svg>,
  Edit:     () => <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M9.5 2.5l2 2L4 12H2v-2L9.5 2.5z" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinejoin="round"/><path d="M8 4l2 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  UserPlus: () => <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><circle cx="6" cy="5" r="3" stroke="currentColor" strokeWidth="1.4" fill="none"/><path d="M1 14c0-3.3 2.2-5 5-5s5 1.7 5 5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round"/><path d="M12 6v4M10 8h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  UserMinus: () => <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><circle cx="6" cy="5" r="3" stroke="currentColor" strokeWidth="1.4" fill="none"/><path d="M1 14c0-3.3 2.2-5 5-5s5 1.7 5 5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round"/><path d="M10 8h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  Trash:    () => <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M2 4h10M5 4V2.5a.5.5 0 01.5-.5h3a.5.5 0 01.5.5V4M6 6.5v4M8 6.5v4M3 4l.8 7.2a1 1 0 001 .8h4.4a1 1 0 001-.8L11 4" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  Refresh:  () => <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M12 7A5 5 0 112 7" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round"/><path d="M12 3v4h-4" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  Bell:     () => <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M7 1.5a4 4 0 014 4v3l1 1H2l1-1v-3a4 4 0 014-4z" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinejoin="round"/><path d="M5.5 11.5a1.5 1.5 0 003 0" stroke="currentColor" strokeWidth="1.3" fill="none"/></svg>,
  Track:    () => <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.3" fill="none"/><path d="M4.5 7l2 2 3-3" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  OffTrack: () => <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.3" fill="none"/><path d="M5 5l4 4M9 5l-4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
};

const STATUS_COLORS = {
  "not started": { bg: "#FDF2F2", border: "#EDD5D5", text: "#C0392B", dot: "#C0392B" },
  "in progress": { bg: "#F2F5FD", border: "#D5DEF0", text: "#1A4A7A", dot: "#1A4A7A" },
  "completed":   { bg: "#F2FAF6", border: "#D5EDE3", text: "#27664A", dot: "#27664A" },
};
const STATUS_LABELS = ["not started", "in progress", "completed"];

const STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500;1,600&family=Inter:wght@300;400;500;600&display=swap');
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  :root{
    --bg:#FAFAF8;--surface:#fff;--surface2:#F5F4F0;--border:#E8E6E0;--border2:#D4D0C8;
    --text:#1A1916;--text2:#6B6860;--text3:#A8A49C;
    --accent:#1A1916;--accent2:#3D3A34;--accent-dim:rgba(26,25,22,.06);
    --danger:#C0392B;--danger-dim:rgba(192,57,43,.08);
    --success:#27664A;--info:#1A4A7A;
    --radius:6px;--radius2:10px;
  }
  body{font-family:'Inter',sans-serif;background:var(--bg);color:var(--text);min-height:100vh;font-size:14px}
  input,textarea,select{font-family:'Inter',sans-serif;background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:var(--radius);padding:10px 14px;font-size:13px;width:100%;outline:none;transition:border-color .2s,box-shadow .2s;-webkit-appearance:none}
  input:focus,textarea:focus,select:focus{border-color:var(--text);box-shadow:0 0 0 3px rgba(26,25,22,.07)}
  input::placeholder,textarea::placeholder{color:var(--text3)}
  textarea{resize:vertical;min-height:80px;line-height:1.6}
  select{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%236B6860' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;padding-right:36px;cursor:pointer}
  select option{background:#fff}
  button{font-family:'Inter',sans-serif;font-weight:500;cursor:pointer;border:none;border-radius:var(--radius);transition:all .18s;font-size:13px}
  button:active{transform:scale(.98)}
  button:disabled{opacity:.6;cursor:not-allowed}
  .btn-primary{background:var(--accent);color:#fff;padding:10px 20px}
  .btn-primary:hover:not(:disabled){background:var(--accent2)}
  .btn-ghost{background:transparent;color:var(--text2);padding:9px 16px;border:1px solid var(--border)}
  .btn-ghost:hover:not(:disabled){border-color:var(--border2);color:var(--text);background:var(--surface2)}
  .btn-danger{background:var(--danger-dim);color:var(--danger);padding:9px 16px;border:1px solid rgba(192,57,43,.18)}
  .btn-danger:hover:not(:disabled){background:rgba(192,57,43,.14)}
  label{font-family:'Inter',sans-serif;font-size:11px;font-weight:600;letter-spacing:.07em;color:var(--text2);display:block;margin-bottom:6px;text-transform:uppercase}
  .field{margin-bottom:18px}
  .scrollbar::-webkit-scrollbar{width:4px}
  .scrollbar::-webkit-scrollbar-thumb{background:var(--border2);border-radius:4px}
  @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
  @keyframes spin{to{transform:rotate(360deg)}}
  .fadein{animation:fadeIn .22s ease both}
  .spinner{width:32px;height:32px;border:2.5px solid var(--border);border-top-color:var(--text);border-radius:50%;animation:spin .7s linear infinite;margin:0 auto}
  .check-pill{display:flex;align-items:center;gap:10px;cursor:pointer;user-select:none;font-family:'Inter',sans-serif;font-size:13px;color:var(--text2)}
  .check-pill input{display:none}
  .check-box{width:18px;height:18px;border-radius:4px;border:1.5px solid var(--border2);background:var(--surface);display:flex;align-items:center;justify-content:center;transition:all .15s;flex-shrink:0}
  .check-pill input:checked~.check-box{background:var(--accent);border-color:var(--accent)}
  .check-pill input:checked~span{color:var(--text)}
  .tag{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:4px;font-family:'Inter',sans-serif;font-size:11px;font-weight:500}
  .tag-urgent{background:var(--danger-dim);color:var(--danger);border:1px solid rgba(192,57,43,.18)}
  .modal-backdrop{position:fixed;inset:0;background:rgba(26,25,22,.5);display:flex;align-items:center;justify-content:center;z-index:100;padding:20px;backdrop-filter:blur(6px)}
  .modal{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius2);padding:32px;width:100%;max-width:520px;max-height:88vh;overflow-y:auto;animation:fadeIn .2s ease;box-shadow:0 20px 60px rgba(26,25,22,.12)}
  .modal-title{font-family:'Cormorant Garamond',serif;font-size:22px;font-weight:600;margin-bottom:24px;display:flex;align-items:center;gap:10px;letter-spacing:-.01em}
  .nav-pill{display:flex;align-items:center;gap:10px;padding:8px 14px;border-radius:var(--radius);cursor:pointer;transition:all .15s;font-family:'Inter',sans-serif;font-size:13px;color:var(--text2);background:transparent}
  .nav-pill:hover{background:var(--surface2);color:var(--text)}
  .nav-pill.active{background:var(--accent-dim);color:var(--text);font-weight:500}
  .task-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius2);padding:20px 22px;transition:border-color .2s,box-shadow .2s;cursor:pointer;margin-bottom:12px}
  .task-card:hover{border-color:var(--border2);box-shadow:0 4px 16px rgba(26,25,22,.06)}
  .task-card.urgent{border-left:2px solid var(--danger)}
  .status-pill{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:4px;font-family:'Inter',sans-serif;font-size:11px;font-weight:500}
  .status-dot{width:6px;height:6px;border-radius:50%}
  .member-chip{display:inline-flex;align-items:center;gap:6px;background:var(--surface2);border:1px solid var(--border);border-radius:4px;padding:3px 9px;font-size:11px;color:var(--text2);font-weight:500}
  .comment-bubble{background:var(--surface2);border-radius:var(--radius);padding:12px 14px;margin-bottom:10px;border-left:2px solid var(--border2)}
  .comment-meta{font-size:11px;color:var(--text3);margin-bottom:5px;font-weight:500}
  .comment-text{font-size:13px;color:var(--text2);line-height:1.6}
  .login-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg)}
  .login-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius2);padding:44px 40px;width:100%;max-width:380px;animation:fadeIn .3s ease;box-shadow:0 8px 40px rgba(26,25,22,.08)}
  .divider{height:1px;background:var(--border);margin:22px 0}
  .overview-stat{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius2);padding:20px 24px}
  .overview-stat-num{font-family:'Cormorant Garamond',serif;font-size:38px;font-weight:500;line-height:1}
  .overview-stat-label{font-size:11px;font-weight:500;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-top:6px}
  .progress-bar-bg{background:var(--surface2);border-radius:99px;height:3px;overflow:hidden}
  .progress-bar-fill{height:100%;border-radius:99px;background:var(--text);transition:width .4s ease}
  .pw-wrap{position:relative}
  .pw-wrap input{padding-right:40px}
  .pw-eye{position:absolute;right:12px;top:50%;transform:translateY(-50%);background:transparent;color:var(--text3);padding:0;display:flex}
  .pw-eye:hover{color:var(--text)}
  .empty{text-align:center;padding:70px 20px}
  .empty-icon{font-size:36px;margin-bottom:14px}
  .empty-label{font-family:'Cormorant Garamond',serif;font-size:18px;font-style:italic;color:var(--text2)}
  .page-header{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:28px;gap:16px}
  .page-title{font-family:'Cormorant Garamond',serif;font-size:28px;font-weight:600;letter-spacing:-.02em;line-height:1.2}
  .page-title em{font-style:italic}
  .subtitle{font-size:12px;color:var(--text3);margin-top:4px}
  .grid-2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  .grid-4{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
  @media(max-width:640px){.grid-4{grid-template-columns:1fr 1fr}.grid-2{grid-template-columns:1fr}}
  .flex{display:flex}.items-center{align-items:center}.justify-between{justify-content:space-between}
  .gap-8{gap:8px}.gap-12{gap:12px}.flex-1{flex:1}
  .mb-8{margin-bottom:8px}.mb-12{margin-bottom:12px}.mb-16{margin-bottom:16px}
  .mt-8{margin-top:8px}.w-full{width:100%}.flex-wrap{flex-wrap:wrap}.text-sm{font-size:12px;color:var(--text3)}
  .app-layout{display:flex;min-height:100vh}
  .sidebar{width:230px;min-height:100vh;flex-shrink:0;background:var(--surface);border-right:1px solid var(--border);display:flex;flex-direction:column;padding:28px 16px;position:sticky;top:0;height:100vh;overflow-y:auto}
  .sidebar-logo{display:flex;align-items:center;gap:8px;margin-bottom:36px;padding:0 6px}
  .sidebar-logo-text{font-family:'Cormorant Garamond',serif;font-size:20px;font-weight:600;color:var(--text);letter-spacing:-.01em}
  .sidebar-logo-sub{font-size:10px;color:var(--text3);letter-spacing:.03em}
  .sidebar-section{font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--text3);padding:0 14px;margin-bottom:6px;margin-top:22px}
  .main-content{flex:1;padding:40px 40px 48px;overflow-x:hidden;background:var(--bg)}
  .sidebar-bottom{margin-top:auto;padding-top:20px;border-top:1px solid var(--border)}
  @media(max-width:768px){
    .sidebar{width:60px;padding:16px 8px}
    .sidebar-logo-text,.sidebar-logo-sub,.nav-pill span,.sidebar-section{display:none}
    .nav-pill{padding:10px;justify-content:center}
    .main-content{padding:20px 16px}
    .sidebar-logo{justify-content:center}
    .page-title{font-size:22px}
    .grid-2{grid-template-columns:1fr}
  }
  .toast{position:fixed;bottom:24px;right:24px;background:var(--text);color:#fff;padding:12px 20px;border-radius:var(--radius);font-size:13px;z-index:200;animation:fadeIn .2s ease;box-shadow:0 8px 24px rgba(26,25,22,.2)}
  .toast.error{background:var(--danger)}
`;

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatDate(d) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
function daysUntil(d) {
  if (!d) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const deadline = new Date(d); deadline.setHours(0, 0, 0, 0);
  return Math.ceil((deadline - today) / (1000 * 60 * 60 * 24));
}
function deadlineLabel(d) {
  if (!d) return null;
  const days = daysUntil(d);
  if (days < 0) return { text: `${Math.abs(days)}d overdue`, color: "var(--danger)", urgent: true };
  if (days === 0) return { text: "Due today", color: "var(--danger)", urgent: true };
  if (days === 1) return { text: "1 day left", color: "var(--danger)", urgent: true };
  if (days <= 3) return { text: `${days} days left`, color: "var(--warning, #B45309)", urgent: false };
  return { text: `${days} days left`, color: "var(--text3)", urgent: false };
}

function Toast({ msg, type, onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 3000); return () => clearTimeout(t); }, [onDone]);
  return <div className={`toast${type === "error" ? " error" : ""}`}>{msg}</div>;
}

function PasswordInput({ value, onChange, placeholder = "Password" }) {
  const [show, setShow] = useState(false);
  return (
    <div className="pw-wrap">
      <input type={show ? "text" : "password"} value={value} onChange={onChange} placeholder={placeholder} />
      <button className="pw-eye" type="button" onClick={() => setShow(s => !s)}>
        {show ? <Icon.EyeOff /> : <Icon.Eye />}
      </button>
    </div>
  );
}

function StatusPill({ status }) {
  const c = STATUS_COLORS[status] || STATUS_COLORS["not started"];
  return (
    <span className="status-pill" style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}>
      <span className="status-dot" style={{ background: c.dot }} />{status}
    </span>
  );
}

// ── Task Modal ────────────────────────────────────────────────────────────────
function TaskModal({ task, currentUser, members, onClose, onUpdateStatus, onAddComment, onUpdateTrack, onToggleAttention, onDeleteTask }) {
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isAdmin = currentUser.role === "admin";
  const memberName = members.find(m => m.id === task.assigned_to)?.name || task.assigned_to;
  const dl = task.deadline ? deadlineLabel(task.deadline) : null;

  async function changeStatus(s) {
    setSaving(true); await onUpdateStatus(task.id, s); setSaving(false);
  }
  async function submitComment() {
    if (!comment.trim()) return;
    setSaving(true); await onAddComment(task.id, comment.trim()); setComment(""); setSaving(false);
  }
  async function handleDelete() {
    setSaving(true); await onDeleteTask(task.id); setSaving(false);
  }

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal scrollbar fadein">
        <div className="flex items-center justify-between mb-16">
          <div className="modal-title" style={{ margin: 0 }}>
            {task.urgent && <span className="tag tag-urgent"><Icon.Urgent /> Urgent</span>}
            <span>{task.title}</span>
          </div>
          <div className="flex gap-8 items-center">
            {isAdmin && !confirmDelete && (
              <button className="btn-danger" style={{ padding: "6px 12px", display: "flex", alignItems: "center", gap: 5, fontSize: 12 }}
                onClick={() => setConfirmDelete(true)}>
                <Icon.Trash /> Delete
              </button>
            )}
            {isAdmin && confirmDelete && (
              <div className="flex gap-8 items-center">
                <span style={{ fontSize: 12, color: "var(--danger)", fontWeight: 500 }}>Sure?</span>
                <button className="btn-danger" style={{ padding: "6px 12px", fontSize: 12 }} onClick={handleDelete} disabled={saving}>
                  {saving ? "Deleting…" : "Yes, Delete"}
                </button>
                <button className="btn-ghost" style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => setConfirmDelete(false)}>
                  Cancel
                </button>
              </div>
            )}
            <button className="btn-ghost" style={{ padding: "6px 12px" }} onClick={onClose}>✕</button>
          </div>
        </div>

        <div className="flex items-center gap-8 flex-wrap mb-16">
          <StatusPill status={task.status} />
          <span className="member-chip"><Icon.User /> {memberName}</span>
          {dl && (
            <span className="member-chip" style={{ color: dl.urgent ? "var(--danger)" : dl.color, borderColor: dl.urgent ? "#EDD5D5" : "var(--border)", background: dl.urgent ? "#FDF2F2" : "var(--surface2)", fontWeight: dl.urgent ? 600 : 400 }}>
              <Icon.Clock /> {formatDate(task.deadline)} · {dl.text}
            </span>
          )}
        </div>

        {!isAdmin && (
          <div className="mb-16">
            <label>Change Status</label>
            <div className="flex gap-8 flex-wrap">
              {STATUS_LABELS.map(s => {
                const c = STATUS_COLORS[s];
                return (
                  <button key={s} onClick={() => changeStatus(s)} disabled={saving} style={{
                    padding: "7px 14px", borderRadius: 99, cursor: "pointer",
                    background: task.status === s ? c.bg : "var(--surface2)",
                    color: task.status === s ? c.text : "var(--text3)",
                    border: `1.5px solid ${task.status === s ? c.border : "var(--border)"}`,
                    fontWeight: 600, fontSize: 12,
                  }}>{s}</button>
                );
              })}
            </div>
          </div>
        )}

        {!isAdmin && (
          <div className="mb-16">
            <label>Is this task on track?</label>
            <div className="flex gap-8">
              <button onClick={() => onUpdateTrack(task.id, "on_track")} disabled={saving} style={{
                padding: "7px 16px", borderRadius: 99, cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
                background: task.track_status === "on_track" ? "#F2FAF6" : "var(--surface2)",
                color: task.track_status === "on_track" ? "#27664A" : "var(--text3)",
                border: `1.5px solid ${task.track_status === "on_track" ? "#D5EDE3" : "var(--border)"}`,
                fontWeight: 600, fontSize: 12,
              }}><Icon.Track /> On Track</button>
              <button onClick={() => onUpdateTrack(task.id, "off_track")} disabled={saving} style={{
                padding: "7px 16px", borderRadius: 99, cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
                background: task.track_status === "off_track" ? "#FDF2F2" : "var(--surface2)",
                color: task.track_status === "off_track" ? "#C0392B" : "var(--text3)",
                border: `1.5px solid ${task.track_status === "off_track" ? "#EDD5D5" : "var(--border)"}`,
                fontWeight: 600, fontSize: 12,
              }}><Icon.OffTrack /> Off Track</button>
            </div>
          </div>
        )}

        {!isAdmin && (
          <div className="mb-16">
            <label className="check-pill" style={{ cursor: "pointer" }}>
              <input type="checkbox" checked={!!task.needs_attention} onChange={e => onToggleAttention(task.id, e.target.checked)} style={{ display: "none" }} />
              <span className="check-box" style={{ background: task.needs_attention ? "#FFF7ED" : "var(--surface2)", borderColor: task.needs_attention ? "#FCD34D" : "var(--border2)" }}>
                {task.needs_attention && <span style={{ fontSize: 10 }}>✓</span>}
              </span>
              <span style={{ color: task.needs_attention ? "#B45309" : "var(--text2)", fontWeight: task.needs_attention ? 600 : 400 }}>
                🔔 Needs Admin Attention
              </span>
            </label>
            {task.needs_attention && <div style={{ fontSize: 11, color: "#B45309", marginTop: 6, marginLeft: 28 }}>Admin has been notified.</div>}
          </div>
        )}

        {task.description && (
          <div className="mb-16">
            <label>Description</label>
            <div style={{ background: "var(--surface2)", borderRadius: 8, padding: "12px 14px", fontSize: 13, color: "var(--text2)", lineHeight: 1.7 }}>{task.description}</div>
          </div>
        )}

        <div style={{ height: 1, background: "var(--border)", margin: "20px 0" }} />

        <div className="mb-12">
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}><Icon.Comment /> Comments ({task.comments?.length || 0})</label>
          {(!task.comments || task.comments.length === 0) && <div style={{ color: "var(--text3)", fontSize: 12, padding: "8px 0" }}>No comments yet.</div>}
          {task.comments?.map((c, i) => (
            <div className="comment-bubble" key={i}>
              <div className="comment-meta">{members.find(m => m.id === c.author)?.name || c.author} · {new Date(c.created_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
              <div className="comment-text">{c.text}</div>
            </div>
          ))}
        </div>

        <div className="flex gap-8">
          <textarea value={comment} onChange={e => setComment(e.target.value)} placeholder="Add a comment…" style={{ minHeight: 60, flex: 1 }} onKeyDown={e => { if (e.key === "Enter" && e.ctrlKey) submitComment(); }} />
          <button className="btn-primary" style={{ alignSelf: "flex-end" }} onClick={submitComment} disabled={saving}>Send</button>
        </div>
        <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4 }}>Ctrl+Enter to send</div>
      </div>
    </div>
  );
}

// ── Create Task Modal ─────────────────────────────────────────────────────────
function CreateTaskModal({ members, lockedTo, onClose, onCreate }) {
  const [form, setForm] = useState({ title: "", description: "", deadline: "", urgent: false, assignedTo: lockedTo?.id || members[0]?.id || "" });
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!form.title.trim()) { setErr("Task title is required."); return; }
    setSaving(true);
    try { await onCreate({ ...form, title: form.title.trim(), description: form.description.trim() }); }
    catch (e) { setErr(e.message); setSaving(false); }
  }

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal scrollbar fadein">
        <div className="modal-title"><Icon.Plus /> New Task</div>

        {lockedTo && (
          <div style={{ background: "var(--accent-dim)", border: "1px solid var(--border2)", borderRadius: 8, padding: "10px 14px", marginBottom: 20, display: "flex", alignItems: "center", gap: 10 }}>
            <Icon.User />
            <span style={{ fontSize: 13, fontWeight: 600 }}>Assigning to <strong>{lockedTo.name}</strong></span>
            <span className="member-chip" style={{ marginLeft: "auto" }}>{lockedTo.id}</span>
          </div>
        )}

        <div className="field"><label>Task Title *</label><input placeholder="What needs to be done?" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} autoFocus /></div>
        <div className="field"><label>Description</label><textarea placeholder="Add details, context, instructions…" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
        <div className={lockedTo ? "" : "grid-2"}>
          <div className="field"><label>Deadline (optional)</label><input type="date" value={form.deadline} onChange={e => setForm(f => ({ ...f, deadline: e.target.value }))} /></div>
          {!lockedTo && (
            <div className="field"><label>Assign To *</label>
              <select value={form.assignedTo} onChange={e => setForm(f => ({ ...f, assignedTo: e.target.value }))}>
                {members.map(m => <option key={m.id} value={m.id}>{m.name} ({m.id})</option>)}
              </select>
            </div>
          )}
        </div>
        <div className="field">
          <label className="check-pill">
            <input type="checkbox" checked={form.urgent} onChange={e => setForm(f => ({ ...f, urgent: e.target.checked }))} />
            <span className="check-box"><Icon.Urgent /></span>
            <span>Mark as Urgent</span>
          </label>
        </div>
        {err && <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 14 }}>{err}</div>}
        <div className="flex gap-8" style={{ justifyContent: "flex-end" }}>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={saving}>{saving ? "Creating…" : "Create Task"}</button>
        </div>
      </div>
    </div>
  );
}

// ── Reset Password Modal ──────────────────────────────────────────────────────
function ResetPasswordModal({ users, onClose, onReset }) {
  const [sel, setSel] = useState(users[0]?.id || "");
  const [pw, setPw] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  async function submit() {
    if (!pw.trim()) return;
    setSaving(true); await onReset(sel, pw.trim()); setSaving(false); setDone(true); setPw("");
  }

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal fadein">
        <div className="modal-title"><Icon.Key /> Reset Password</div>
        <div className="field"><label>Select User</label>
          <select value={sel} onChange={e => { setSel(e.target.value); setDone(false); }}>
            {users.map(u => <option key={u.id} value={u.id}>{u.id} · {u.name}</option>)}
          </select>
        </div>
        <div className="field"><label>New Password</label><PasswordInput value={pw} onChange={e => { setPw(e.target.value); setDone(false); }} /></div>
        {done && <div style={{ color: "var(--success)", fontSize: 12, marginBottom: 14 }}>✓ Password updated for {sel}</div>}
        <div className="flex gap-8" style={{ justifyContent: "flex-end" }}>
          <button className="btn-ghost" onClick={onClose}>Close</button>
          <button className="btn-primary" onClick={submit} disabled={saving}>{saving ? "Saving…" : "Update Password"}</button>
        </div>
      </div>
    </div>
  );
}

// ── Rename Members Modal ──────────────────────────────────────────────────────
function RenameMembersModal({ users, onClose, onRename }) {
  const [names, setNames] = useState(() => Object.fromEntries(users.map(u => [u.id, u.name])));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function submit() {
    setSaving(true);
    await onRename(Object.fromEntries(Object.entries(names).map(([id, n]) => [id, n.trim() || id])));
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal fadein">
        <div className="modal-title"><Icon.Edit /> Rename Members</div>
        {users.map(u => (
          <div className="field" key={u.id}>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}><span className="member-chip">{u.id}</span> Display Name</label>
            <input value={names[u.id] || ""} onChange={e => { setNames(n => ({ ...n, [u.id]: e.target.value })); setSaved(false); }} placeholder={u.id} />
          </div>
        ))}
        {saved && <div style={{ color: "var(--success)", fontSize: 12, marginBottom: 14 }}>✓ Names updated</div>}
        <div className="flex gap-8" style={{ justifyContent: "flex-end" }}>
          <button className="btn-ghost" onClick={onClose}>Close</button>
          <button className="btn-primary" onClick={submit} disabled={saving}>{saving ? "Saving…" : "Save Names"}</button>
        </div>
      </div>
    </div>
  );
}

// ── Add Member Modal ──────────────────────────────────────────────────────────
function AddMemberModal({ existingUsers, onClose, onAdd }) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [added, setAdded] = useState(null);

  const nextId = (() => {
    const nums = existingUsers.map(u => u.id.match(/^Hive(\d+)$/i)?.[1]).filter(Boolean).map(Number);
    return `Hive${String(nums.length ? Math.max(...nums) + 1 : 1).padStart(3, "0")}`;
  })();

  async function submit() {
    if (!name.trim()) { setErr("Display name is required."); return; }
    if (!password.trim()) { setErr("Password is required."); return; }
    setSaving(true);
    try {
      await onAdd({ id: nextId, name: name.trim(), password: password.trim(), role: "member" });
      setAdded({ id: nextId, name: name.trim() }); setName(""); setPassword(""); setErr("");
    } catch (e) { setErr(e.message); }
    setSaving(false);
  }

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal fadein">
        <div className="modal-title"><Icon.UserPlus /> Add New Member</div>
        <div style={{ background: "var(--accent-dim)", border: "1px solid var(--border2)", borderRadius: 8, padding: "10px 14px", marginBottom: 20, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: ".08em" }}>Auto ID</span>
          <span style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 18, fontWeight: 600 }}>{nextId}</span>
          <span style={{ fontSize: 11, color: "var(--text3)", marginLeft: "auto" }}>assigned automatically</span>
        </div>
        <div className="field"><label>Display Name *</label><input placeholder="e.g. Alex Johnson" value={name} onChange={e => { setName(e.target.value); setErr(""); setAdded(null); }} autoFocus /></div>
        <div className="field"><label>Password *</label><PasswordInput value={password} onChange={e => { setPassword(e.target.value); setErr(""); setAdded(null); }} placeholder="Set a password" /></div>
        {err && <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 14 }}>{err}</div>}
        {added && <div style={{ color: "var(--success)", fontSize: 12, marginBottom: 14 }}>✓ <strong>{added.name}</strong> added as <strong>{added.id}</strong></div>}
        <div className="flex gap-8" style={{ justifyContent: "flex-end" }}>
          <button className="btn-ghost" onClick={onClose}>Close</button>
          <button className="btn-primary" onClick={submit} disabled={saving}>{saving ? "Adding…" : "Add Member"}</button>
        </div>
      </div>
    </div>
  );
}

// ── Task Card ─────────────────────────────────────────────────────────────────
function TaskCard({ task, members, onClick }) {
  const memberName = members.find(m => m.id === task.assigned_to)?.name || task.assigned_to;
  const dl = task.deadline ? deadlineLabel(task.deadline) : null;

  const trackColors = {
    "on_track":  { bg: "#F2FAF6", border: "#D5EDE3", text: "#27664A" },
    "off_track": { bg: "#FDF2F2", border: "#EDD5D5", text: "#C0392B" },
  };

  return (
    <div className={`task-card fadein ${task.urgent ? "urgent" : ""}`} onClick={onClick}>
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-8 flex-wrap">
          <StatusPill status={task.status} />
          {task.urgent && <span className="tag tag-urgent"><Icon.Urgent /> Urgent</span>}
          {task.needs_attention && (
            <span className="tag" style={{ background: "#FFF7ED", color: "#B45309", border: "1px solid #FCD34D" }}>
              <Icon.Bell /> Needs Attention
            </span>
          )}
          {task.track_status && (
            <span className="tag" style={trackColors[task.track_status] ? { background: trackColors[task.track_status].bg, color: trackColors[task.track_status].text, border: `1px solid ${trackColors[task.track_status].border}` } : {}}>
              {task.track_status === "on_track" ? <><Icon.Track /> On Track</> : <><Icon.OffTrack /> Off Track</>}
            </span>
          )}
        </div>
        <span className="text-sm" style={{ fontSize: 11 }}>#{task.id}</span>
      </div>

      <div style={{ fontFamily: "'Cormorant Garamond',serif", fontWeight: 600, fontSize: 17, marginBottom: 6, lineHeight: 1.4 }}>{task.title}</div>
      {task.description && <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 10, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{task.description}</div>}

      <div className="flex items-center gap-8 flex-wrap" style={{ marginTop: 10 }}>
        <span className="member-chip"><Icon.User /> {memberName}</span>
        {task.comments?.length > 0 && <span className="member-chip"><Icon.Comment /> {task.comments.length}</span>}
        {dl && (
          <span className="member-chip" style={{ color: dl.urgent ? "var(--danger)" : dl.color, borderColor: dl.urgent ? "#EDD5D5" : "var(--border)", background: dl.urgent ? "#FDF2F2" : "var(--surface2)", fontWeight: dl.urgent ? 600 : 400 }}>
            <Icon.Clock /> {formatDate(task.deadline)} · {dl.text}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Admin Overview ────────────────────────────────────────────────────────────
function AdminOverview({ tasks, members, onSelectMember }) {
  const done = tasks.filter(t => t.status === "completed").length;
  const inprog = tasks.filter(t => t.status === "in progress").length;
  const urgent = tasks.filter(t => t.urgent).length;
  return (
    <div className="fadein">
      <div className="page-header"><div><div className="page-title"><em>Overview</em></div><div className="subtitle">{tasks.length} total tasks across all members</div></div></div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        {[{ label: "Total", num: tasks.length, color: "var(--text)" }, { label: "Completed", num: done, color: "var(--success)" }, { label: "In Progress", num: inprog, color: "var(--info)" }, { label: "Urgent", num: urgent, color: "var(--danger)" }].map(s => (
          <div className="overview-stat" key={s.label}>
            <div className="overview-stat-num" style={{ color: s.color }}>{s.num}</div>
            <div className="overview-stat-label">{s.label}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 14, color: "var(--text3)", textTransform: "uppercase", letterSpacing: ".08em" }}>Per Member</div>
      {members.map(m => {
        const mt = tasks.filter(t => t.assigned_to === m.id);
        const md = mt.filter(t => t.status === "completed").length;
        const pct = mt.length ? Math.round((md / mt.length) * 100) : 0;
        return (
          <div key={m.id}
            onClick={() => onSelectMember(m.id)}
            style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "16px 20px", marginBottom: 10, cursor: "pointer", transition: "border-color .15s, box-shadow .15s" }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--border2)"; e.currentTarget.style.boxShadow = "0 4px 16px rgba(26,25,22,.06)"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.boxShadow = "none"; }}
          >
            {/* Top row: ID chip + name */}
            <div className="flex items-center gap-8 mb-8" style={{ flexWrap: "wrap" }}>
              <span className="member-chip" style={{ flexShrink: 0 }}><Icon.User /> {m.id}</span>
              <span style={{ fontFamily: "'Cormorant Garamond',serif", fontWeight: 600, fontSize: 16, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</span>
            </div>

            {/* Progress bar */}
            <div className="progress-bar-bg mb-8"><div className="progress-bar-fill" style={{ width: `${pct}%` }} /></div>

            {/* Bottom row: stats + link */}
            <div className="flex items-center justify-between" style={{ flexWrap: "wrap", gap: 6 }}>
              <div className="flex gap-8 flex-wrap">
                {STATUS_LABELS.map(s => { const cnt = mt.filter(t => t.status === s).length; if (!cnt) return null; const c = STATUS_COLORS[s]; return <span key={s} className="tag" style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}>{cnt} {s}</span>; })}
                {mt.filter(t => t.urgent).length > 0 && <span className="tag tag-urgent"><Icon.Urgent /> {mt.filter(t => t.urgent).length} urgent</span>}
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", flexShrink: 0 }}>
                <span style={{ fontSize: 11, color: "var(--text3)" }}>{md}/{mt.length} completed · {pct}%</span>
                <span style={{ fontSize: 11, color: "var(--text3)" }}>View tasks →</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Change Password Inline (used inside Settings page) ────────────────────────
function ChangePasswordInline({ currentUser, onSave, showToast }) {
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    if (!pw.trim()) { setErr("Please enter a new password."); return; }
    if (pw.trim().length < 6) { setErr("Password must be at least 6 characters."); return; }
    if (pw.trim() !== confirm.trim()) { setErr("Passwords do not match."); return; }
    setSaving(true);
    try {
      await onSave(currentUser.id, pw.trim());
      setPw(""); setConfirm(""); setErr("");
      showToast("Password updated successfully!");
    } catch (e) { setErr(e.message); }
    setSaving(false);
  }

  return (
    <div>
      <div className="field"><label>New Password</label><PasswordInput value={pw} onChange={e => { setPw(e.target.value); setErr(""); }} placeholder="Enter new password" /></div>
      <div className="field"><label>Confirm Password</label><PasswordInput value={confirm} onChange={e => { setConfirm(e.target.value); setErr(""); }} placeholder="Re-enter new password" /></div>
      {err && <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 14 }}>{err}</div>}
      <button className="btn-primary" onClick={submit} disabled={saving} style={{ width: "100%", padding: 12 }}>
        {saving ? "Saving…" : "Update Password"}
      </button>
    </div>
  );
}

// ── Change Password Modal (for members) ──────────────────────────────────────
function ChangePasswordModal({ currentUser, onClose, onSave }) {
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    if (!pw.trim()) { setErr("Please enter a new password."); return; }
    if (pw.trim().length < 6) { setErr("Password must be at least 6 characters."); return; }
    if (pw.trim() !== confirm.trim()) { setErr("Passwords do not match."); return; }
    setSaving(true);
    try {
      await onSave(currentUser.id, pw.trim());
      setDone(true); setPw(""); setConfirm(""); setErr("");
    } catch (e) { setErr(e.message); }
    setSaving(false);
  }

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal fadein">
        <div className="modal-title"><Icon.Key /> Change Password</div>

        <div style={{ background: "var(--accent-dim)", border: "1px solid var(--border2)", borderRadius: 8, padding: "10px 14px", marginBottom: 20, display: "flex", alignItems: "center", gap: 10 }}>
          <Icon.User />
          <span style={{ fontSize: 13, fontWeight: 600 }}>{currentUser.name}</span>
          <span className="member-chip" style={{ marginLeft: "auto" }}>{currentUser.id}</span>
        </div>

        <div className="field">
          <label>New Password</label>
          <PasswordInput value={pw} onChange={e => { setPw(e.target.value); setErr(""); setDone(false); }} placeholder="Enter new password" />
        </div>

        <div className="field">
          <label>Confirm New Password</label>
          <PasswordInput value={confirm} onChange={e => { setConfirm(e.target.value); setErr(""); setDone(false); }} placeholder="Re-enter new password" />
        </div>

        {err && <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 14 }}>{err}</div>}
        {done && <div style={{ color: "var(--success)", fontSize: 12, marginBottom: 14 }}>✓ Password updated successfully!</div>}

        <div className="flex gap-8" style={{ justifyContent: "flex-end" }}>
          <button className="btn-ghost" onClick={onClose}>Close</button>
          <button className="btn-primary" onClick={submit} disabled={saving}>{saving ? "Saving…" : "Update Password"}</button>
        </div>
      </div>
    </div>
  );
}

// ── Delete Member Modal ───────────────────────────────────────────────────────
function DeleteMemberModal({ users, tasks, onClose, onDelete }) {
  const [sel, setSel] = useState(users[0]?.id || "");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const memberTasks = tasks.filter(t => t.assigned_to === sel);
  const selectedMember = users.find(u => u.id === sel);
  const isConfirmed = confirm.trim() === sel;

  async function submit() {
    if (!isConfirmed) { setErr(`Type "${sel}" to confirm deletion.`); return; }
    setSaving(true);
    try {
      await onDelete(sel);
      onClose();
    } catch (e) { setErr(e.message); setSaving(false); }
  }

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal fadein">
        <div className="modal-title" style={{ color: "var(--danger)" }}>
          <Icon.UserMinus /> Remove Member
        </div>

        <div className="field">
          <label>Select Member</label>
          <select value={sel} onChange={e => { setSel(e.target.value); setConfirm(""); setErr(""); }}>
            {users.map(u => <option key={u.id} value={u.id}>{u.id} · {u.name}</option>)}
          </select>
        </div>

        {selectedMember && (
          <div style={{ background: "var(--danger-dim)", border: "1px solid rgba(192,57,43,.2)", borderRadius: 8, padding: "14px 16px", marginBottom: 20 }}>
            <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 16, fontWeight: 600, marginBottom: 6 }}>
              {selectedMember.name} <span style={{ color: "var(--text3)", fontSize: 13 }}>({sel})</span>
            </div>
            <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.7 }}>
              This will permanently delete this member and{" "}
              <strong style={{ color: "var(--danger)" }}>
                {memberTasks.length} task{memberTasks.length !== 1 ? "s" : ""}
              </strong>{" "}
              assigned to them. This action cannot be undone.
            </div>
          </div>
        )}

        <div className="field">
          <label>Type <strong>{sel}</strong> to confirm</label>
          <input
            placeholder={sel}
            value={confirm}
            onChange={e => { setConfirm(e.target.value); setErr(""); }}
            style={{ borderColor: confirm && !isConfirmed ? "var(--danger)" : undefined }}
          />
        </div>

        {err && <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 14 }}>{err}</div>}

        <div className="flex gap-8" style={{ justifyContent: "flex-end" }}>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-danger" onClick={submit} disabled={saving || !isConfirmed}
            style={{ opacity: isConfirmed ? 1 : 0.5 }}>
            {saving ? "Removing…" : "Remove Member"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [users, setUsers] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [appLoading, setAppLoading] = useState(false);
  const [loginId, setLoginId] = useState("");
  const [loginPw, setLoginPw] = useState("");
  const [loginErr, setLoginErr] = useState("");
  const [page, setPage] = useState("tasks");
  const [showCreate, setShowCreate] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [showRename, setShowRename] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [showDeleteMember, setShowDeleteMember] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [selectedTask, setSelectedTask] = useState(null);
  const [filterMember, setFilterMember] = useState("all");
  const [toast, setToast] = useState(null);
  const [sessionUser, setSessionUser] = useState(null);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [showBiometricPrompt, setShowBiometricPrompt] = useState(false);
  const [showAttentionPopup, setShowAttentionPopup] = useState(false);

  // Check for saved session and biometric support on mount
  useEffect(() => {
    async function init() {
      const saved = loadSession();
      const bioAvail = await checkBiometricAvailable();
      setBiometricAvailable(bioAvail);
      if (saved) {
        setSessionUser(saved);
        setShowBiometricPrompt(true);
      }
    }
    init();
  }, []);

  function showToast(msg, type = "success") { setToast({ msg, type }); }

  async function fetchUsers() {
    const data = await sb("users?select=*&order=id");
    setUsers(data || []); return data || [];
  }
  async function fetchTasks() {
    const data = await sb("tasks?select=*,comments(id,author,text,created_at)&order=created_at.desc");
    setTasks(data || []); return data || [];
  }
  async function refreshAll() {
    setLoading(true);
    try { await Promise.all([fetchUsers(), fetchTasks()]); }
    catch (e) { showToast("Refresh failed: " + e.message, "error"); }
    setLoading(false);
  }

  async function login() {
    if (!loginId.trim() || !loginPw.trim()) { setLoginErr("Please enter your ID and password."); return; }
    setAppLoading(true); setLoginErr("");
    try {
      const hash = await hashPassword(loginPw.trim());
      const rows = await sb(`users?id=eq.${encodeURIComponent(loginId.trim())}&password_hash=eq.${hash}&select=*`);
      if (!rows || rows.length === 0) { setLoginErr("Invalid ID or password."); setAppLoading(false); return; }
      const user = rows[0];
      saveSession(user);
      await resumeSession(user);
    } catch (e) { setLoginErr("Login failed: " + e.message); }
    setAppLoading(false);
  }

  async function resumeSession(user) {
    setCurrentUser(user); setLoginId(""); setLoginPw("");
    await Promise.all([fetchUsers(), fetchTasks()]);
    setPage(user.role === "admin" ? "overview" : "tasks");
    registerPush(user.id);
    // Show attention popup for admin if there are flagged tasks
    if (user.role === "admin") {
      const allTasks = await sb("tasks?select=*,comments(id,author,text,created_at)&order=created_at.desc");
      const attentionCount = (allTasks || []).filter(t => t.needs_attention).length;
      if (attentionCount > 0) setShowAttentionPopup(true);
    }
  }

  async function handleBiometricLogin() {
    setAppLoading(true);
    try {
      // Use the browser's native user verification (Windows Hello / Touch ID on Mac)
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const credential = await navigator.credentials.get({
        publicKey: {
          challenge,
          timeout: 60000,
          userVerification: "required",
          rpId: window.location.hostname,
          allowCredentials: [],
        },
      }).catch(() => null);

      if (credential) {
        setShowBiometricPrompt(false);
        await resumeSession(sessionUser);
      } else {
        // Biometric cancelled — fall back to password login
        setShowBiometricPrompt(false);
        setSessionUser(null);
        clearSession();
      }
    } catch {
      setShowBiometricPrompt(false);
      setSessionUser(null);
      clearSession();
    }
    setAppLoading(false);
  }

  function skipBiometric() {
    setShowBiometricPrompt(false);
    setSessionUser(null);
    clearSession();
  }

  function logout() {
    clearSession();
    setCurrentUser(null); setUsers([]); setTasks([]); setPage("tasks");
    setSessionUser(null); setShowBiometricPrompt(false);
  }

  async function createTask(form) {
    await sb("tasks", { method: "POST", prefer: "return=representation", body: JSON.stringify({ title: form.title, description: form.description || null, deadline: form.deadline || null, urgent: form.urgent, assigned_to: form.assignedTo, status: "not started" }) });
    await fetchTasks(); setShowCreate(false); showToast("Task created!");
    // Notify the assigned member
    sendPushNotification(
      form.assignedTo,
      "New Task Assigned 📋",
      `You have a new task: "${form.title}"`
    );
  }

  async function updateStatus(taskId, status) {
    await sb(`tasks?id=eq.${taskId}`, { method: "PATCH", prefer: "return=representation", body: JSON.stringify({ status }) });
    const updated = await fetchTasks();
    const fresh = (updated || []).find(t => t.id === taskId);
    if (fresh && selectedTask?.id === taskId) setSelectedTask(fresh);
  }

  async function addComment(taskId, text) {
    await sb("comments", { method: "POST", prefer: "return=representation", body: JSON.stringify({ task_id: taskId, author: currentUser.id, text }) });
    const updated = await fetchTasks();
    const fresh = (updated || []).find(t => t.id === taskId);
    if (fresh) setSelectedTask(fresh);
  }

  async function clearDoneTasks() {
    await sb("tasks?status=eq.completed", { method: "DELETE", prefer: "return=minimal" });
    await fetchTasks(); showToast("Completed tasks cleared.");
  }

  async function deleteTask(taskId) {
    await sb(`tasks?id=eq.${taskId}`, { method: "DELETE", prefer: "return=minimal" });
    await fetchTasks();
    setSelectedTask(null);
    showToast("Task deleted.");
  }

  async function updateTrack(taskId, track_status) {
    await sb(`tasks?id=eq.${taskId}`, { method: "PATCH", prefer: "return=representation", body: JSON.stringify({ track_status }) });
    const updated = await fetchTasks();
    const fresh = (updated || []).find(t => t.id === taskId);
    if (fresh && selectedTask?.id === taskId) setSelectedTask(fresh);
  }

  async function toggleAttention(taskId, needs_attention) {
    await sb(`tasks?id=eq.${taskId}`, { method: "PATCH", prefer: "return=representation", body: JSON.stringify({ needs_attention }) });
    const updated = await fetchTasks();
    const fresh = (updated || []).find(t => t.id === taskId);
    if (fresh && selectedTask?.id === taskId) setSelectedTask(fresh);
    if (needs_attention) showToast("Admin has been notified ✓");
  }

  async function resetPassword(userId, pw) {
    const hash = await hashPassword(pw);
    await sb(`users?id=eq.${encodeURIComponent(userId)}`, { method: "PATCH", prefer: "return=representation", body: JSON.stringify({ password_hash: hash }) });
    if (currentUser.id === userId) setCurrentUser(u => ({ ...u, password_hash: hash }));
    showToast(`Password updated for ${userId}`);
  }

  async function renameMembers(nameMap) {
    await Promise.all(Object.entries(nameMap).map(([id, name]) =>
      sb(`users?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", prefer: "return=representation", body: JSON.stringify({ name }) })
    ));
    await fetchUsers(); showToast("Names updated!");
  }

  async function addMember({ id, name, password, role }) {
    const hash = await hashPassword(password);
    await sb("users", { method: "POST", prefer: "return=representation", body: JSON.stringify({ id, name, role, password_hash: hash }) });
    await fetchUsers(); showToast(`${name} added as ${id}`);
  }

  async function deleteMember(userId) {
    // Delete all tasks assigned to this member first
    await sb(`tasks?assigned_to=eq.${encodeURIComponent(userId)}`, { method: "DELETE", prefer: "return=minimal" });
    // Then delete the user
    await sb(`users?id=eq.${encodeURIComponent(userId)}`, { method: "DELETE", prefer: "return=minimal" });
    await Promise.all([fetchUsers(), fetchTasks()]);
    showToast(`Member ${userId} removed.`);
  }

  async function markSeen(taskId) {
    await sb(`tasks?id=eq.${taskId}`, { method: "PATCH", prefer: "return=representation", body: JSON.stringify({ seen_by_assignee: true }) });
    setTasks(ts => ts.map(t => t.id === taskId ? { ...t, seen_by_assignee: true } : t));
  }

  const isAdmin = currentUser?.role === "admin";
  const members = users.filter(u => u.role === "member");

  const allVisible = isAdmin
    ? (filterMember === "all" ? tasks : tasks.filter(t => t.assigned_to === filterMember))
    : tasks.filter(t => t.assigned_to === currentUser?.id);

  const sortFn = (a, b) => {
    if (a.urgent && !b.urgent) return -1;
    if (!a.urgent && b.urgent) return 1;
    return new Date(b.created_at) - new Date(a.created_at);
  };

  const activeTasks = [...allVisible.filter(t => t.status !== "completed")].sort(sortFn);
  const completedTasks = [...allVisible.filter(t => t.status === "completed")].sort(sortFn);
  const attentionTasks = tasks.filter(t => t.needs_attention);

  const navItems = isAdmin
    ? [
        { id: "overview",   label: "Overview",        icon: <Icon.Overview /> },
        { id: "tasks",      label: "All Tasks",        icon: <Icon.Task /> },
        { id: "completed",  label: "Completed",        icon: <Icon.Track /> },
        { id: "attention",  label: "Needs Attention",  icon: <Icon.Bell />, badge: attentionTasks.length },
      ]
    : [
        { id: "tasks",      label: "My Tasks",         icon: <Icon.Task /> },
        { id: "completed",  label: "Completed",        icon: <Icon.Track /> },
        { id: "settings",   label: "Settings",         icon: <Icon.Key /> },
      ];

  // ── Biometric Prompt ──────────────────────────────────────────────────────
  if (showBiometricPrompt && sessionUser) {
    return (
      <>
        <style>{STYLES}</style>
        <div className="login-wrap">
          <div className="login-card" style={{ textAlign: "center" }}>
            <div style={{ fontSize: 56, marginBottom: 16 }}>
              {biometricAvailable ? "🔐" : "👋"}
            </div>
            <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 24, fontWeight: 600, marginBottom: 8 }}>
              Welcome back,
            </div>
            <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 28, fontWeight: 600, fontStyle: "italic", marginBottom: 4 }}>
              {sessionUser.name}
            </div>
            <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 32 }}>{sessionUser.id}</div>

            {biometricAvailable ? (
              <>
                <button className="btn-primary w-full" style={{ padding: 14, borderRadius: 6, fontSize: 15, marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
                  onClick={handleBiometricLogin} disabled={appLoading}>
                  {appLoading ? "Verifying…" : "🔐 Use Biometrics"}
                </button>
                <button className="btn-ghost w-full" style={{ padding: 12, borderRadius: 6 }} onClick={skipBiometric}>
                  Use Password Instead
                </button>
              </>
            ) : (
              <>
                <button className="btn-primary w-full" style={{ padding: 14, borderRadius: 6, fontSize: 15, marginBottom: 12 }}
                  onClick={() => { setShowBiometricPrompt(false); resumeSession(sessionUser); }} disabled={appLoading}>
                  {appLoading ? "Loading…" : `Continue as ${sessionUser.name}`}
                </button>
                <button className="btn-ghost w-full" style={{ padding: 12, borderRadius: 6 }} onClick={skipBiometric}>
                  Sign in as someone else
                </button>
              </>
            )}
          </div>
        </div>
      </>
    );
  }

  // ── Login ───────────────────────────────────────────────────────────────────
  if (!currentUser) {
    return (
      <>
        <style>{STYLES}</style>
        <div className="login-wrap">
          <div className="login-card">
            <div style={{ textAlign: "center", marginBottom: 24 }}>
              <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 32, fontWeight: 600, letterSpacing: "-.01em" }}>
                Hive <em style={{ fontStyle: "italic" }}>Inc.</em>
              </div>
            </div>
            <div className="divider" />
            <div className="field" style={{ marginTop: 12 }}>
              <label>Access ID</label>
              <input placeholder="Admin / Hive001 / Hive002…" value={loginId} onChange={e => setLoginId(e.target.value)} onKeyDown={e => e.key === "Enter" && login()} />
            </div>
            <div className="field">
              <label>Password</label>
              <PasswordInput value={loginPw} onChange={e => setLoginPw(e.target.value)} />
            </div>
            {loginErr && <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 14 }}>{loginErr}</div>}
            <button className="btn-primary w-full" style={{ padding: 12, borderRadius: 6 }} onClick={login} disabled={appLoading}>
              {appLoading ? "Signing in…" : "Sign In"}
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <style>{STYLES}</style>
      {toast && <Toast msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}

      <div className="app-layout">
        <aside className="sidebar">
          <div className="sidebar-logo">
            <Icon.Hexagon />
            <div>
              <div className="sidebar-logo-text">Hive<em style={{ fontStyle: "italic" }}>Board</em></div>
              <div className="sidebar-logo-sub">Task Manager</div>
            </div>
          </div>

          <div className="sidebar-section">Navigation</div>
          {navItems.map(n => (
            <div key={n.id} className={`nav-pill ${page === n.id ? "active" : ""}`} onClick={() => setPage(n.id)}
              style={{ position: "relative" }}>
              {n.icon}
              <span style={{ flex: 1 }}>{n.label}</span>
              {n.badge > 0 && (
                <span style={{
                  background: "#E8392A", color: "#fff",
                  borderRadius: "50%", fontSize: 10, fontWeight: 700,
                  minWidth: 18, height: 18,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  padding: "0 4px", lineHeight: 1, flexShrink: 0,
                }}>
                  {n.badge > 99 ? "99+" : n.badge}
                </span>
              )}
            </div>
          ))}

          {isAdmin && (
            <>
              <div className="sidebar-section">Admin</div>
              <div className="nav-pill" onClick={() => setShowReset(true)}><Icon.Key /> <span>Reset Password</span></div>
              <div className="nav-pill" onClick={() => setShowRename(true)}><Icon.Edit /> <span>Rename Members</span></div>
              <div className="nav-pill" onClick={() => setShowAddMember(true)}><Icon.UserPlus /> <span>Add Member</span></div>
              <div className="nav-pill" onClick={() => setShowDeleteMember(true)} style={{ color: "var(--danger)" }}><Icon.UserMinus /> <span>Remove Member</span></div>
            </>
          )}

          {!isAdmin && (
            <>
              <div className="sidebar-section">Account</div>
              <div className="nav-pill" onClick={() => setShowChangePassword(true)} title="Change Password"><Icon.Key /> <span>Change Password</span></div>
            </>
          )}

          <div className="sidebar-bottom">
            <div style={{ padding: "0 8px", marginBottom: 10 }}>
              <div style={{ fontFamily: "'Cormorant Garamond',serif", fontWeight: 600, fontSize: 15 }}>{currentUser.name}</div>
              <div style={{ fontSize: 11, color: "var(--text3)" }}>{currentUser.id}</div>
            </div>
            <div className="nav-pill" onClick={refreshAll} title="Refresh"><Icon.Refresh /> <span>Refresh</span></div>
            <div className="nav-pill" onClick={logout} title="Sign Out"><Icon.Logout /> <span>Sign Out</span></div>
          </div>
        </aside>

        <main className="main-content scrollbar">
          {loading && <div style={{ textAlign: "center", padding: "80px 0" }}><div className="spinner" /></div>}

          {!loading && page === "overview" && isAdmin && <AdminOverview tasks={tasks} members={members} onSelectMember={(memberId) => { setFilterMember(memberId); setPage("tasks"); }} />}

          {!loading && page === "attention" && isAdmin && (
            <div className="fadein">
              <div className="page-header">
                <div>
                  <div className="page-title"><em>Needs Attention</em></div>
                  <div className="subtitle">{tasks.filter(t => t.needs_attention).length} task{tasks.filter(t => t.needs_attention).length !== 1 ? "s" : ""} flagged by members</div>
                </div>
              </div>
              {tasks.filter(t => t.needs_attention).length === 0
                ? <div className="empty"><div className="empty-icon">✅</div><div className="empty-label">No tasks need your attention</div></div>
                : tasks.filter(t => t.needs_attention).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).map(t => (
                    <TaskCard key={t.id} task={t} members={members} onClick={() => setSelectedTask(t)} />
                  ))
              }
            </div>
          )}

          {!loading && page === "tasks" && (
            <div className="fadein">
              <div className="page-header">
                <div>
                  <div className="page-title">{isAdmin ? <>All <em>Tasks</em></> : <>My <em>Tasks</em></>}</div>
                  <div className="subtitle">{activeTasks.length} active task{activeTasks.length !== 1 ? "s" : ""}</div>
                </div>
                <div className="flex gap-8 items-center">
                  <button className="btn-primary" style={{ display: "flex", alignItems: "center", gap: 6 }} onClick={() => setShowCreate(true)}>
                    <Icon.Plus /> New Task
                  </button>
                </div>
              </div>

              {isAdmin && (
                <div className="flex gap-8 flex-wrap mb-16">
                  {[{ id: "all", name: "All Members" }, ...members].map(m => (
                    <button key={m.id} onClick={() => setFilterMember(m.id)} style={{
                      padding: "7px 14px", borderRadius: 99, cursor: "pointer",
                      fontWeight: 600, fontSize: 12,
                      background: filterMember === m.id ? "var(--accent-dim)" : "var(--surface2)",
                      color: filterMember === m.id ? "var(--accent)" : "var(--text3)",
                      border: `1.5px solid ${filterMember === m.id ? "var(--accent)" : "var(--border)"}`,
                      transition: "all .15s",
                    }}>{m.id === "all" ? "All Members" : `${m.name} · ${m.id}`}</button>
                  ))}
                </div>
              )}

              {activeTasks.length === 0
                ? <div className="empty"><div className="empty-icon">🎉</div><div className="empty-label">All caught up! No active tasks.</div></div>
                : activeTasks.map(t => {
                    const isNew = !isAdmin && !t.seen_by_assignee;
                    return (
                      <div key={t.id} onClick={() => { if (isNew) markSeen(t.id); setSelectedTask(t); }}
                        style={{ position: "relative" }}>
                        {isNew && (
                          <div style={{ position: "absolute", top: 10, right: 12, background: "var(--danger)", color: "#fff", borderRadius: 99, fontSize: 10, fontWeight: 700, padding: "2px 8px", zIndex: 1 }}>New</div>
                        )}
                        <div className={`task-card fadein ${t.urgent ? "urgent" : ""}`}
                          style={{ background: isNew ? "#FFF5F5" : undefined, borderColor: isNew ? "#EDD5D5" : undefined, cursor: "pointer" }}>
                          <div className="flex items-center justify-between mb-8">
                            <div className="flex items-center gap-8 flex-wrap">
                              <StatusPill status={t.status} />
                              {t.urgent && <span className="tag tag-urgent"><Icon.Urgent /> Urgent</span>}
                              {t.needs_attention && <span className="tag" style={{ background: "#FFF7ED", color: "#B45309", border: "1px solid #FCD34D" }}><Icon.Bell /> Needs Attention</span>}
                              {t.track_status && (
                                <span className="tag" style={t.track_status === "on_track" ? { background: "#F2FAF6", color: "#27664A", border: "1px solid #D5EDE3" } : { background: "#FDF2F2", color: "#C0392B", border: "1px solid #EDD5D5" }}>
                                  {t.track_status === "on_track" ? <><Icon.Track /> On Track</> : <><Icon.OffTrack /> Off Track</>}
                                </span>
                              )}
                            </div>
                            <span className="text-sm" style={{ fontSize: 11 }}>#{t.id}</span>
                          </div>
                          <div style={{ fontFamily: "'Cormorant Garamond',serif", fontWeight: 600, fontSize: 17, marginBottom: 6, lineHeight: 1.4 }}>{t.title}</div>
                          {t.description && <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 10, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{t.description}</div>}
                          <div className="flex items-center gap-8 flex-wrap" style={{ marginTop: 10 }}>
                            <span className="member-chip"><Icon.User /> {members.find(m => m.id === t.assigned_to)?.name || t.assigned_to}</span>
                            {t.comments?.length > 0 && <span className="member-chip"><Icon.Comment /> {t.comments.length}</span>}
                            {t.deadline && (() => { const dl = deadlineLabel(t.deadline); return (
                              <span className="member-chip" style={{ color: dl.urgent ? "var(--danger)" : dl.color, borderColor: dl.urgent ? "#EDD5D5" : "var(--border)", background: dl.urgent ? "#FDF2F2" : "var(--surface2)", fontWeight: dl.urgent ? 600 : 400 }}>
                                <Icon.Clock /> {formatDate(t.deadline)} · {dl.text}
                              </span>
                            ); })()}
                          </div>
                        </div>
                      </div>
                    );
                  })
              }
            </div>
          )}

          {!loading && page === "completed" && (
            <div className="fadein">
              <div className="page-header">
                <div>
                  <div className="page-title"><em>Completed</em></div>
                  <div className="subtitle">{completedTasks.length} completed task{completedTasks.length !== 1 ? "s" : ""}</div>
                </div>
                {isAdmin && completedTasks.length > 0 && (
                  <button className="btn-danger" style={{ display: "flex", alignItems: "center", gap: 6 }} onClick={clearDoneTasks}>
                    <Icon.Trash /> Clear All
                  </button>
                )}
              </div>

              {isAdmin && (
                <div className="flex gap-8 flex-wrap mb-16">
                  {[{ id: "all", name: "All Members" }, ...members].map(m => (
                    <button key={m.id} onClick={() => setFilterMember(m.id)} style={{
                      padding: "7px 14px", borderRadius: 99, cursor: "pointer",
                      fontWeight: 600, fontSize: 12,
                      background: filterMember === m.id ? "var(--accent-dim)" : "var(--surface2)",
                      color: filterMember === m.id ? "var(--accent)" : "var(--text3)",
                      border: `1.5px solid ${filterMember === m.id ? "var(--accent)" : "var(--border)"}`,
                      transition: "all .15s",
                    }}>{m.id === "all" ? "All Members" : `${m.name} · ${m.id}`}</button>
                  ))}
                </div>
              )}

              {completedTasks.length === 0
                ? <div className="empty"><div className="empty-icon">📭</div><div className="empty-label">No completed tasks yet.</div></div>
                : completedTasks.map(t => <TaskCard key={t.id} task={t} members={members} onClick={() => setSelectedTask(t)} />)
              }
            </div>
          )}

          {!loading && page === "settings" && !isAdmin && (
            <div className="fadein">
              <div className="page-header">
                <div>
                  <div className="page-title"><em>Settings</em></div>
                  <div className="subtitle">Manage your account</div>
                </div>
              </div>

              {/* Profile card */}
              <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "20px 24px", marginBottom: 16 }}>
                <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 11, fontWeight: 600, letterSpacing: ".08em", color: "var(--text3)", textTransform: "uppercase", marginBottom: 12 }}>Account</div>
                <div className="flex items-center gap-12">
                  <div style={{ width: 44, height: 44, borderRadius: "50%", background: "var(--accent-dim)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Icon.User />
                  </div>
                  <div>
                    <div style={{ fontFamily: "'Cormorant Garamond',serif", fontWeight: 600, fontSize: 18 }}>{currentUser.name}</div>
                    <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>{currentUser.id}</div>
                  </div>
                </div>
              </div>

              {/* Change password card */}
              <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "20px 24px", marginBottom: 16 }}>
                <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 11, fontWeight: 600, letterSpacing: ".08em", color: "var(--text3)", textTransform: "uppercase", marginBottom: 16 }}>Security</div>
                <ChangePasswordInline currentUser={currentUser} onSave={resetPassword} showToast={showToast} />
              </div>
            </div>
          )}
        </main>
      </div>

      {showCreate && <CreateTaskModal members={members} lockedTo={!isAdmin ? currentUser : null} onClose={() => setShowCreate(false)} onCreate={createTask} />}
      {showReset && <ResetPasswordModal users={users} onClose={() => setShowReset(false)} onReset={resetPassword} />}
      {showRename && <RenameMembersModal users={members} onClose={() => setShowRename(false)} onRename={renameMembers} />}
      {showAddMember && <AddMemberModal existingUsers={users} onClose={() => setShowAddMember(false)} onAdd={addMember} />}
      {showDeleteMember && <DeleteMemberModal users={members} tasks={tasks} onClose={() => setShowDeleteMember(false)} onDelete={deleteMember} />}
      {showChangePassword && <ChangePasswordModal currentUser={currentUser} onClose={() => setShowChangePassword(false)} onSave={resetPassword} />}
      {selectedTask && <TaskModal task={selectedTask} currentUser={currentUser} members={members} onClose={() => setSelectedTask(null)} onUpdateStatus={updateStatus} onAddComment={addComment} onUpdateTrack={updateTrack} onToggleAttention={toggleAttention} onDeleteTask={deleteTask} />}

      {showAttentionPopup && isAdmin && (
        <div className="modal-backdrop" onClick={() => setShowAttentionPopup(false)}>
          <div className="modal fadein" style={{ maxWidth: 420, textAlign: "center" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🔔</div>
            <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 24, fontWeight: 600, marginBottom: 8 }}>
              Needs Your Attention
            </div>
            <div style={{ fontSize: 14, color: "var(--text2)", marginBottom: 24, lineHeight: 1.6 }}>
              <strong style={{ color: "var(--danger)" }}>{attentionTasks.length} task{attentionTasks.length !== 1 ? "s" : ""}</strong> {attentionTasks.length === 1 ? "has" : "have"} been flagged by your team members and require your attention.
            </div>
            <div style={{ marginBottom: 20 }}>
              {attentionTasks.slice(0, 3).map(t => (
                <div key={t.id} style={{ background: "#FFF7ED", border: "1px solid #FCD34D", borderRadius: 8, padding: "10px 14px", marginBottom: 8, textAlign: "left" }}>
                  <div style={{ fontFamily: "'Cormorant Garamond',serif", fontWeight: 600, fontSize: 15 }}>{t.title}</div>
                  <div style={{ fontSize: 11, color: "#B45309", marginTop: 3 }}>
                    {members.find(m => m.id === t.assigned_to)?.name || t.assigned_to} · {t.status}
                  </div>
                </div>
              ))}
              {attentionTasks.length > 3 && <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 4 }}>+{attentionTasks.length - 3} more</div>}
            </div>
            <div className="flex gap-8" style={{ justifyContent: "center" }}>
              <button className="btn-ghost" onClick={() => setShowAttentionPopup(false)}>Dismiss</button>
              <button className="btn-primary" onClick={() => { setShowAttentionPopup(false); setPage("attention"); }}>
                View All
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
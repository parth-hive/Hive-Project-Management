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

// Only store safe fields in session — never store password_hash
function safeUser(user) {
  return { id: user.id, name: user.name, role: user.role, email: user.email || "" };
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

async function sendEmailNotification(payload) {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/send-email-notification`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.warn("Email send failed:", e.message);
  }
}

// ── Batched Email Notifications ──────────────────────────────────────────────
// Collects changes per user+task, flushes as one email after 2s of inactivity
const _emailBatch = {};
const _emailTimers = {};
const BATCH_DELAY = 2000;

function queueEmailChange(userId, taskTitle, change) {
  const key = `${userId}::${taskTitle}`;
  if (!_emailBatch[key]) _emailBatch[key] = { user_id: userId, task: { title: taskTitle }, changes: [] };
  _emailBatch[key].changes.push(change);
  clearTimeout(_emailTimers[key]);
  _emailTimers[key] = setTimeout(() => {
    const batch = _emailBatch[key];
    delete _emailBatch[key];
    delete _emailTimers[key];
    sendEmailNotification({ ...batch, type: "task_updated" });
  }, BATCH_DELAY);
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
  Settings: () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><circle cx="7" cy="7" r="2.2"/><path d="M7 1.5v1M7 11.5v1M1.5 7h1M11.5 7h1M2.9 2.9l.7.7M10.4 10.4l.7.7M11.1 2.9l-.7.7M3.6 10.4l-.7.7"/></svg>,
  Moon:     () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><path d="M12.5 7.5a5.5 5.5 0 01-6-6 5.5 5.5 0 106 6z"/></svg>,
  Sun:      () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><circle cx="7" cy="7" r="3"/><path d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M2.75 2.75l1.06 1.06M10.19 10.19l1.06 1.06M11.25 2.75l-1.06 1.06M3.81 10.19l-1.06 1.06"/></svg>,
};

const STATUS_COLORS_LIGHT = {
  "not started": { bg: "#FDF2F2", border: "#EDD5D5", text: "#C0392B", dot: "#C0392B" },
  "in progress": { bg: "#F2F5FD", border: "#D5DEF0", text: "#1A4A7A", dot: "#1A4A7A" },
  "completed":   { bg: "#F2FAF6", border: "#D5EDE3", text: "#27664A", dot: "#27664A" },
};
const STATUS_COLORS_DARK = {
  "not started": { bg: "rgba(192,57,43,.15)", border: "rgba(192,57,43,.3)", text: "#E74C3C", dot: "#E74C3C" },
  "in progress": { bg: "rgba(52,152,219,.15)", border: "rgba(52,152,219,.3)", text: "#5DADE2", dot: "#5DADE2" },
  "completed":   { bg: "rgba(39,174,96,.15)", border: "rgba(39,174,96,.3)", text: "#58D68D", dot: "#58D68D" },
};
function getStatusColors() {
  return document.documentElement.getAttribute("data-theme") === "dark" ? STATUS_COLORS_DARK : STATUS_COLORS_LIGHT;
}
const STATUS_COLORS = new Proxy({}, { get: (_, key) => getStatusColors()[key] });
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
    --warn-bg:#FFF7ED;--warn-border:#FCD34D;--warn-text:#B45309;
    --attn-bg:#FFF7ED;--attn-border:#FCD34D;--attn-text:#B45309;
    --new-bg:#FFF5F5;--new-border:#EDD5D5;
    --track-on-bg:#F2FAF6;--track-on-border:#D5EDE3;--track-on-text:#27664A;
    --track-off-bg:#FDF2F2;--track-off-border:#EDD5D5;--track-off-text:#C0392B;
  }
  [data-theme="dark"]{
    --bg:#141414;--surface:#1E1E1E;--surface2:#2A2A2A;--border:#333;--border2:#444;
    --text:#E8E6E0;--text2:#A8A49C;--text3:#6B6860;
    --accent:#E8E6E0;--accent2:#C4C0B8;--accent-dim:rgba(232,230,224,.08);
    --danger:#E74C3C;--danger-dim:rgba(231,76,60,.12);
    --success:#58D68D;--info:#5DADE2;
    --warn-bg:rgba(180,131,9,.12);--warn-border:rgba(252,211,77,.25);--warn-text:#FCD34D;
    --attn-bg:rgba(180,131,9,.12);--attn-border:rgba(252,211,77,.25);--attn-text:#FCD34D;
    --new-bg:rgba(192,57,43,.12);--new-border:rgba(192,57,43,.3);
    --track-on-bg:rgba(39,174,96,.12);--track-on-border:rgba(39,174,96,.25);--track-on-text:#58D68D;
    --track-off-bg:rgba(192,57,43,.12);--track-off-border:rgba(192,57,43,.25);--track-off-text:#E74C3C;
  }
  body{font-family:'Inter',sans-serif;background:var(--bg);color:var(--text);min-height:100vh;font-size:14px}
  input,textarea,select{font-family:'Inter',sans-serif;background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:var(--radius);padding:10px 14px;font-size:13px;width:100%;outline:none;transition:border-color .2s,box-shadow .2s;-webkit-appearance:none}
  input:focus,textarea:focus,select:focus{border-color:var(--text);box-shadow:0 0 0 3px rgba(26,25,22,.07)}
  input::placeholder,textarea::placeholder{color:var(--text3)}
  textarea{resize:vertical;min-height:80px;line-height:1.6}
  select{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%236B6860' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;padding-right:36px;cursor:pointer}
  select option{background:var(--surface)}
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
  .overview-stat{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius2);padding:16px 18px}
  .overview-stat-num{font-family:'Cormorant Garamond',serif;font-size:32px;font-weight:500;line-height:1}
  .overview-stat-label{font-size:10px;font-weight:500;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-top:6px}
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
    .sidebar-bottom{padding-top:12px}
    .sidebar-bottom > div:first-child{display:none}
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
  if (days <= 3) return { text: `${days} days left`, color: "var(--attn-text)", urgent: false };
  return { text: `${days} days left`, color: "var(--text3)", urgent: false };
}

function Toast({ msg, type, onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 3000); return () => clearTimeout(t); }, [onDone]);
  return <div className={`toast${type === "error" ? " error" : ""}`}>{msg}</div>;
}

function PasswordInput({ value, onChange, placeholder = "Password", onKeyDown }) {
  const [show, setShow] = useState(false);
  return (
    <div className="pw-wrap">
      <input type={show ? "text" : "password"} value={value} onChange={onChange} placeholder={placeholder} onKeyDown={onKeyDown} />
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
function TaskModal({ task, currentUser, members, onClose, onUpdateStatus, onAddComment, onUpdateTrack, onToggleAttention, onDeleteTask, onUpdateDeadline }) {
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editingDeadline, setEditingDeadline] = useState(false);
  const [deadlineVal, setDeadlineVal] = useState(task.deadline || "");
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
  async function saveDeadline() {
    setSaving(true);
    await onUpdateDeadline(task.id, deadlineVal || null);
    setEditingDeadline(false);
    setSaving(false);
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

          {/* Deadline — editable by admin, read-only for members */}
          {isAdmin ? (
            editingDeadline ? (
              <div className="flex items-center gap-8">
                <input type="date" value={deadlineVal} onChange={e => setDeadlineVal(e.target.value)}
                  style={{ width: "auto", padding: "4px 10px", fontSize: 12 }} />
                <button className="btn-primary" style={{ padding: "4px 12px", fontSize: 12 }} onClick={saveDeadline} disabled={saving}>
                  {saving ? "…" : "Save"}
                </button>
                <button className="btn-ghost" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => { setEditingDeadline(false); setDeadlineVal(task.deadline || ""); }}>
                  Cancel
                </button>
                {deadlineVal && (
                  <button className="btn-danger" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => { setDeadlineVal(""); }} title="Clear deadline">
                    ✕
                  </button>
                )}
              </div>
            ) : (
              <span className="member-chip" onClick={() => setEditingDeadline(true)}
                style={{ cursor: "pointer", color: dl?.urgent ? "var(--danger)" : "var(--text2)", borderColor: dl?.urgent ? "var(--track-off-border)" : "var(--border)", background: dl?.urgent ? "var(--track-off-bg)" : "var(--surface2)", fontWeight: dl?.urgent ? 600 : 400 }}
                title="Click to edit deadline">
                <Icon.Clock />
                {dl ? `${formatDate(task.deadline)} · ${dl.text}` : <span style={{ color: "var(--text3)" }}>Set deadline</span>}
                <span style={{ fontSize: 10, color: "var(--text3)", marginLeft: 2 }}>✎</span>
              </span>
            )
          ) : (
            dl && (
              <span className="member-chip" style={{ color: dl.urgent ? "var(--danger)" : dl.color, borderColor: dl.urgent ? "var(--track-off-border)" : "var(--border)", background: dl.urgent ? "var(--track-off-bg)" : "var(--surface2)", fontWeight: dl.urgent ? 600 : 400 }}>
                <Icon.Clock /> {formatDate(task.deadline)} · {dl.text}
              </span>
            )
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
            <label>Is this project on track?</label>
            <div className="flex gap-8">
              <button onClick={() => onUpdateTrack(task.id, "on_track")} disabled={saving} style={{
                padding: "7px 16px", borderRadius: 99, cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
                background: task.track_status === "on_track" ? "var(--track-on-bg)" : "var(--surface2)",
                color: task.track_status === "on_track" ? "var(--track-on-text)" : "var(--text3)",
                border: `1.5px solid ${task.track_status === "on_track" ? "var(--track-on-border)" : "var(--border)"}`,
                fontWeight: 600, fontSize: 12,
              }}><Icon.Track /> On Track</button>
              <button onClick={() => onUpdateTrack(task.id, "off_track")} disabled={saving} style={{
                padding: "7px 16px", borderRadius: 99, cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
                background: task.track_status === "off_track" ? "var(--track-off-bg)" : "var(--surface2)",
                color: task.track_status === "off_track" ? "var(--track-off-text)" : "var(--text3)",
                border: `1.5px solid ${task.track_status === "off_track" ? "var(--track-off-border)" : "var(--border)"}`,
                fontWeight: 600, fontSize: 12,
              }}><Icon.OffTrack /> Off Track</button>
            </div>
          </div>
        )}

        {!isAdmin && (
          <div className="mb-16">
            <label className="check-pill" style={{ cursor: "pointer" }}>
              <input type="checkbox" checked={!!task.needs_attention} onChange={e => onToggleAttention(task.id, e.target.checked)} style={{ display: "none" }} />
              <span className="check-box" style={{ background: task.needs_attention ? "var(--attn-bg)" : "var(--surface2)", borderColor: task.needs_attention ? "var(--attn-border)" : "var(--border2)" }}>
                {task.needs_attention && <span style={{ fontSize: 10 }}>✓</span>}
              </span>
              <span style={{ color: task.needs_attention ? "#B45309" : "var(--text2)", fontWeight: task.needs_attention ? 600 : 400 }}>
                🔔 Needs Admin Attention
              </span>
            </label>
            {task.needs_attention && <div style={{ fontSize: 11, color: "var(--attn-text)", marginTop: 6, marginLeft: 28 }}>Admin has been notified.</div>}
          </div>
        )}

        {isAdmin && task.needs_attention && (
          <div className="mb-16" style={{ background: "var(--attn-bg)", border: "1px solid var(--attn-border)", borderRadius: 8, padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div className="flex items-center gap-8">
              <Icon.Bell />
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--attn-text)" }}>This project needs your attention</span>
            </div>
            <button
              onClick={() => onToggleAttention(task.id, false)}
              disabled={saving}
              style={{ padding: "6px 14px", borderRadius: 6, cursor: "pointer", background: "var(--surface)", color: "var(--attn-text)", border: "1px solid var(--attn-border)", fontWeight: 600, fontSize: 12, whiteSpace: "nowrap", flexShrink: 0 }}>
              ✓ Dismiss
            </button>
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

// ── Create Project Modal ─────────────────────────────────────────────────────────
function CreateTaskModal({ members, lockedTo, onClose, onCreate }) {
  const [form, setForm] = useState({ title: "", description: "", deadline: "", urgent: false, assignedTo: lockedTo?.id || members[0]?.id || "" });
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!form.title.trim()) { setErr("Project title is required."); return; }
    setSaving(true);
    try { await onCreate({ ...form, title: form.title.trim(), description: form.description.trim() }); }
    catch (e) { setErr(e.message); setSaving(false); }
  }

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal scrollbar fadein">
        <div className="modal-title"><Icon.Plus /> New Project</div>

        {lockedTo && (
          <div style={{ background: "var(--accent-dim)", border: "1px solid var(--border2)", borderRadius: 8, padding: "10px 14px", marginBottom: 20, display: "flex", alignItems: "center", gap: 10 }}>
            <Icon.User />
            <span style={{ fontSize: 13, fontWeight: 600 }}>Assigning to <strong>{lockedTo.name}</strong></span>
            <span className="member-chip" style={{ marginLeft: "auto" }}>{lockedTo.id}</span>
          </div>
        )}

        <div className="field"><label>Project Title *</label><input placeholder="What needs to be done?" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} autoFocus /></div>
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
          <button className="btn-primary" onClick={submit} disabled={saving}>{saving ? "Creating…" : "Create Project"}</button>
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

// ── Edit Emails Modal ────────────────────────────────────────────────────────
function EditEmailsModal({ users, onClose, onSave }) {
  const [emails, setEmails] = useState(() => Object.fromEntries(users.map(u => [u.id, u.email || ""])));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function submit() {
    setSaving(true);
    await onSave(Object.fromEntries(Object.entries(emails).map(([id, e]) => [id, e.trim() || null])));
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal fadein">
        <div className="modal-title"><Icon.Bell /> Member Emails</div>
        <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 16, lineHeight: 1.5 }}>
          Members with an email will receive notifications when their projects are created or updated.
        </div>
        {users.map(u => (
          <div className="field" key={u.id}>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}><span className="member-chip">{u.id}</span> {u.name}</label>
            <input type="email" value={emails[u.id] || ""} onChange={e => { setEmails(n => ({ ...n, [u.id]: e.target.value })); setSaved(false); }} placeholder="email@example.com" />
          </div>
        ))}
        {saved && <div style={{ color: "var(--success)", fontSize: 12, marginBottom: 14 }}>&#10003; Emails updated</div>}
        <div className="flex gap-8" style={{ justifyContent: "flex-end" }}>
          <button className="btn-ghost" onClick={onClose}>Close</button>
          <button className="btn-primary" onClick={submit} disabled={saving}>{saving ? "Saving…" : "Save Emails"}</button>
        </div>
      </div>
    </div>
  );
}

// ── Add Member Modal ──────────────────────────────────────────────────────────
function AddMemberModal({ existingUsers, onClose, onAdd }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
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
      await onAdd({ id: nextId, name: name.trim(), password: password.trim(), role: "member", email: email.trim() || null });
      setAdded({ id: nextId, name: name.trim() }); setName(""); setPassword(""); setEmail(""); setErr("");
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
        <div className="field"><label>Email</label><input type="email" placeholder="e.g. alex@example.com" value={email} onChange={e => { setEmail(e.target.value); setErr(""); setAdded(null); }} /></div>
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
    "on_track":  { bg: "var(--track-on-bg)", border: "var(--track-on-border)", text: "var(--track-on-text)" },
    "off_track": { bg: "var(--track-off-bg)", border: "var(--track-off-border)", text: "var(--track-off-text)" },
  };

  return (
    <div className={`task-card fadein ${task.urgent ? "urgent" : ""}`} onClick={onClick}>
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-8 flex-wrap">
          <StatusPill status={task.status} />
          {task.urgent && <span className="tag tag-urgent"><Icon.Urgent /> Urgent</span>}
          {task.needs_attention && (
            <span className="tag" style={{ background: "var(--attn-bg)", color: "var(--attn-text)", border: "1px solid var(--attn-border)" }}>
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
          <span className="member-chip" style={{ color: dl.urgent ? "var(--danger)" : dl.color, borderColor: dl.urgent ? "var(--track-off-border)" : "var(--border)", background: dl.urgent ? "var(--track-off-bg)" : "var(--surface2)", fontWeight: dl.urgent ? 600 : 400 }}>
            <Icon.Clock /> {formatDate(task.deadline)} · {dl.text}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Admin Overview ────────────────────────────────────────────────────────────
function AdminOverview({ tasks, members, onSelectMember, overviewFilter, onCardClick, onTaskClick, clearDoneTasks }) {
  const done = tasks.filter(t => t.status === "completed").length;
  const inprog = tasks.filter(t => t.status === "in progress").length;
  const notStarted = tasks.filter(t => t.status === "not started").length;
  const urgent = tasks.filter(t => t.urgent).length;
  const cards = [
    { key: "total", label: "Total", num: tasks.length, color: "var(--text)" },
    { key: "not started", label: "Not Started", num: notStarted, color: "var(--danger)" },
    { key: "in progress", label: "In Progress", num: inprog, color: "var(--info)" },
    { key: "completed", label: "Completed", num: done, color: "var(--success)" },
    { key: "urgent", label: "Urgent", num: urgent, color: "var(--danger)" },
  ];

  const filteredTasks = overviewFilter
    ? overviewFilter === "total" ? tasks
      : overviewFilter === "urgent" ? tasks.filter(t => t.urgent)
      : tasks.filter(t => t.status === overviewFilter)
    : null;

  const filterTitle = overviewFilter
    ? cards.find(c => c.key === overviewFilter)?.label || "Projects"
    : null;

  return (
    <div className="fadein">
      <div className="page-header"><div><div className="page-title"><em>Overview</em></div><div className="subtitle">{tasks.length} total projects across all members</div></div></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 16 }}>
        {cards.map(s => (
          <div className="overview-stat" key={s.key}
            onClick={() => onCardClick(overviewFilter === s.key ? null : s.key)}
            style={{ cursor: "pointer", outline: overviewFilter === s.key ? `2px solid ${s.color}` : "none", outlineOffset: -2, transition: "outline .15s, box-shadow .15s" }}
            onMouseEnter={e => { e.currentTarget.style.boxShadow = "0 4px 16px rgba(26,25,22,.08)"; }}
            onMouseLeave={e => { e.currentTarget.style.boxShadow = "none"; }}
          >
            <div className="overview-stat-num" style={{ color: s.color }}>{s.num}</div>
            <div className="overview-stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      {filteredTasks ? (
        <>
          <div className="flex items-center justify-between mb-16">
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text3)", textTransform: "uppercase", letterSpacing: ".08em" }}>{filterTitle} · {filteredTasks.length} project{filteredTasks.length !== 1 ? "s" : ""}</div>
            {overviewFilter === "completed" && filteredTasks.length > 0 && (
              <button className="btn-danger" style={{ display: "flex", alignItems: "center", gap: 6 }} onClick={clearDoneTasks}>
                <Icon.Trash /> Clear All
              </button>
            )}
          </div>
          {filteredTasks.length === 0
            ? <div className="empty"><div className="empty-icon">📭</div><div className="empty-label">No {filterTitle.toLowerCase()} projects.</div></div>
            : filteredTasks.map(t => <TaskCard key={t.id} task={t} members={members} onClick={() => onTaskClick(t)} />)
          }
        </>
      ) : (
        <>
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
                <span style={{ fontSize: 11, color: "var(--text3)" }}>View projects →</span>
              </div>
            </div>
          </div>
        );
      })}
        </>
      )}
    </div>
  );
}

// ── Change Password Inline (used inside Settings page) ────────────────────────
function EmailInlineEdit({ currentUser, onSave, showToast }) {
  const [email, setEmail] = useState(currentUser.email || "");
  const [saving, setSaving] = useState(false);
  const hasChanged = email.trim() !== (currentUser.email || "");

  async function submit() {
    if (!email.trim()) { showToast("Please enter an email address.", "error"); return; }
    setSaving(true);
    try {
      await onSave(email.trim());
    } catch (e) { showToast("Failed: " + e.message, "error"); }
    setSaving(false);
  }

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "20px 24px", marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".08em", color: "var(--text3)", textTransform: "uppercase", marginBottom: 12 }}>Email Notifications</div>
      {!currentUser.email && (
        <div style={{ background: "var(--attn-bg)", border: "1px solid var(--attn-border)", borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "var(--attn-text)", lineHeight: 1.5 }}>
          Add your email to receive notifications when projects are assigned or updated.
        </div>
      )}
      <div className="flex gap-8 items-center">
        <input type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} style={{ flex: 1 }} />
        <button className="btn-primary" onClick={submit} disabled={saving || !hasChanged} style={{ whiteSpace: "nowrap" }}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

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
                {memberTasks.length} project{memberTasks.length !== 1 ? "s" : ""}
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
// ── Email Prompt Modal ───────────────────────────────────────────────────────
function EmailPromptModal({ currentUser, onClose, onSave }) {
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    if (!email.trim()) { setErr("Please enter your email address."); return; }
    setSaving(true);
    try {
      await onSave(email.trim());
      onClose();
    } catch (e) { setErr(e.message); }
    setSaving(false);
  }

  return (
    <div className="modal-backdrop">
      <div className="modal fadein" style={{ maxWidth: 440, textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>&#9993;</div>
        <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 24, fontWeight: 600, marginBottom: 8 }}>
          Add Your Email
        </div>
        <div style={{ fontSize: 13, color: "var(--text2)", marginBottom: 24, lineHeight: 1.6 }}>
          Stay in the loop! Add your email to receive notifications when projects are assigned or updated.
        </div>
        <div className="field" style={{ textAlign: "left" }}>
          <label>Email Address</label>
          <input type="email" placeholder="you@example.com" value={email} onChange={e => { setEmail(e.target.value); setErr(""); }} autoFocus />
        </div>
        {err && <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 14 }}>{err}</div>}
        <div className="flex gap-8" style={{ justifyContent: "center" }}>
          <button className="btn-ghost" onClick={onClose}>Skip for Now</button>
          <button className="btn-primary" onClick={submit} disabled={saving}>{saving ? "Saving…" : "Save Email"}</button>
        </div>
      </div>
    </div>
  );
}

function getInitialTheme() {
  try { return localStorage.getItem("hiveboard_theme") || "light"; } catch { return "light"; }
}

export default function App() {
  const [theme, setTheme] = useState(getInitialTheme);
  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("hiveboard_theme", next);
  };
  // Apply theme on mount
  React.useEffect(() => { document.documentElement.setAttribute("data-theme", theme); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [currentUser, setCurrentUser] = useState(null);
  const [users, setUsers] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [appLoading, setAppLoading] = useState(false);
  const [loginId, setLoginId] = useState("");
  const [loginPw, setLoginPw] = useState("");
  const [loginErr, setLoginErr] = useState("");
  const [page, setPage] = useState("tasks");
  const [overviewFilter, setOverviewFilter] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [showRename, setShowRename] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [showDeleteMember, setShowDeleteMember] = useState(false);
  const [showEditEmails, setShowEditEmails] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [selectedTask, setSelectedTask] = useState(null);
  const [filterMember, setFilterMember] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterUrgency, setFilterUrgency] = useState("all");
  const [sortBy, setSortBy] = useState("default");
  const [toast, setToast] = useState(null);
  const [showAttentionPopup, setShowAttentionPopup] = useState(false);
  const [showEmailPrompt, setShowEmailPrompt] = useState(false);

  // Check for saved session on mount and auto-resume
  useEffect(() => {
    async function init() {
      const saved = loadSession();
      if (saved) {
        // Re-verify user still exists in DB and get fresh role
        try {
          const fresh = await sb(`users?id=eq.${encodeURIComponent(saved.id)}&select=id,name,role,email`);
          if (!fresh || fresh.length === 0) { clearSession(); return; }
          const verifiedUser = safeUser(fresh[0]);
          await resumeSession(verifiedUser);
        } catch { clearSession(); }
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
      saveSession(safeUser(user));
      await resumeSession(safeUser(user));
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
    // Prompt member to add email if missing
    if (!user.email) {
      setShowEmailPrompt(true);
    }
  }

  async function saveMyEmail(email) {
    await sb(`users?id=eq.${encodeURIComponent(currentUser.id)}`, { method: "PATCH", prefer: "return=representation", body: JSON.stringify({ email }) });
    setCurrentUser(u => ({ ...u, email }));
    saveSession({ ...currentUser, email });
    await fetchUsers();
    showToast("Email saved!");
  }

  function logout() {
    clearSession();
    setCurrentUser(null); setUsers([]); setTasks([]); setPage("tasks");
  }

  async function createTask(form) {
    await sb("tasks", { method: "POST", prefer: "return=representation", body: JSON.stringify({ title: form.title, description: form.description || null, deadline: form.deadline || null, urgent: form.urgent, assigned_to: form.assignedTo, status: "not started" }) });
    await fetchTasks(); setShowCreate(false); showToast("Project created!");
    // Notify the assigned member
    sendPushNotification(
      form.assignedTo,
      "New Project Assigned 📋",
      `You have a new project: "${form.title}"`
    );
    if (isAdmin) {
      sendEmailNotification({
        user_id: form.assignedTo, type: "task_created",
        task: { title: form.title, description: form.description || "", deadline: form.deadline || null, assigned_to: form.assignedTo },
      });
    }
  }

  async function updateStatus(taskId, status) {
    const oldTask = tasks.find(t => t.id === taskId);
    await sb(`tasks?id=eq.${taskId}`, { method: "PATCH", prefer: "return=representation", body: JSON.stringify({ status }) });
    const updated = await fetchTasks();
    const fresh = (updated || []).find(t => t.id === taskId);
    if (fresh && selectedTask?.id === taskId) setSelectedTask(fresh);
    if (oldTask) {
      if (isAdmin) {
        queueEmailChange(oldTask.assigned_to, oldTask.title, { field: "Status", from: oldTask.status, to: status });
      }
      // Notify admin when a member marks a task as completed
      if (status === "completed" && !isAdmin) {
        const admin = users.find(u => u.role === "admin");
        if (admin) {
          sendEmailNotification({
            user_id: admin.id, type: "task_updated",
            task: { title: oldTask.title },
            changes: [{ field: "Status", from: oldTask.status, to: status }, { field: "Completed by", to: currentUser.name || currentUser.id }],
          });
        }
      }
    }
  }

  async function addComment(taskId, text) {
    await sb("comments", { method: "POST", prefer: "return=representation", body: JSON.stringify({ task_id: taskId, author: currentUser.id, text }) });
    const updated = await fetchTasks();
    const fresh = (updated || []).find(t => t.id === taskId);
    if (fresh) setSelectedTask(fresh);
    if (isAdmin) {
      const task = tasks.find(t => t.id === taskId);
      if (task) {
        sendEmailNotification({
          user_id: task.assigned_to, type: "comment_added",
          task: { title: task.title },
          comment: { author: currentUser.name || currentUser.id, text },
        });
      }
    }
  }

  async function clearDoneTasks() {
    await sb("tasks?status=eq.completed", { method: "DELETE", prefer: "return=minimal" });
    await fetchTasks(); showToast("Completed projects cleared.");
  }

  async function deleteTask(taskId) {
    await sb(`tasks?id=eq.${taskId}`, { method: "DELETE", prefer: "return=minimal" });
    await fetchTasks();
    setSelectedTask(null);
    showToast("Project deleted.");
  }

  async function updateDeadline(taskId, deadline) {
    const oldTask = tasks.find(t => t.id === taskId);
    await sb(`tasks?id=eq.${taskId}`, { method: "PATCH", prefer: "return=representation", body: JSON.stringify({ deadline: deadline || null }) });
    const updated = await fetchTasks();
    const fresh = (updated || []).find(t => t.id === taskId);
    if (fresh && selectedTask?.id === taskId) setSelectedTask(fresh);
    showToast(deadline ? "Deadline updated!" : "Deadline removed.");
    if (oldTask && isAdmin) {
      queueEmailChange(oldTask.assigned_to, oldTask.title, { field: "Deadline", from: oldTask.deadline || "No deadline", to: deadline || "No deadline" });
    }
  }

  async function updateTrack(taskId, track_status) {
    const oldTask = tasks.find(t => t.id === taskId);
    await sb(`tasks?id=eq.${taskId}`, { method: "PATCH", prefer: "return=representation", body: JSON.stringify({ track_status }) });
    const updated = await fetchTasks();
    const fresh = (updated || []).find(t => t.id === taskId);
    if (fresh && selectedTask?.id === taskId) setSelectedTask(fresh);
    if (oldTask && isAdmin) {
      queueEmailChange(oldTask.assigned_to, oldTask.title, { field: "Track Status", from: oldTask.track_status || "Not set", to: track_status });
    }
  }

  async function toggleAttention(taskId, needs_attention) {
    await sb(`tasks?id=eq.${taskId}`, { method: "PATCH", prefer: "return=representation", body: JSON.stringify({ needs_attention }) });
    const updated = await fetchTasks();
    const fresh = (updated || []).find(t => t.id === taskId);
    if (fresh && selectedTask?.id === taskId) setSelectedTask(fresh);
    if (needs_attention) showToast("Admin has been notified ✓");
    if (isAdmin) {
      const task = tasks.find(t => t.id === taskId);
      if (task) {
        queueEmailChange(task.assigned_to, task.title, { field: "Needs Attention", to: needs_attention ? "Yes — flagged for admin" : "Dismissed" });
      }
    }
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

  async function updateEmails(emailMap) {
    await Promise.all(Object.entries(emailMap).map(([id, email]) =>
      sb(`users?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", prefer: "return=representation", body: JSON.stringify({ email }) })
    ));
    await fetchUsers(); showToast("Emails updated!");
  }

  async function addMember({ id, name, password, role, email }) {
    const hash = await hashPassword(password);
    await sb("users", { method: "POST", prefer: "return=representation", body: JSON.stringify({ id, name, role, password_hash: hash, email: email || null }) });
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
    if (sortBy === "deadline") {
      if (!a.deadline && !b.deadline) return 0;
      if (!a.deadline) return 1;
      if (!b.deadline) return -1;
      return new Date(a.deadline) - new Date(b.deadline);
    }
    if (sortBy === "status") {
      const order = { "not started": 0, "in progress": 1, "completed": 2 };
      if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    }
    if (sortBy === "urgent") {
      if (a.urgent && !b.urgent) return -1;
      if (!a.urgent && b.urgent) return 1;
    }
    if (sortBy === "default" || sortBy === "urgent") {
      if (a.urgent && !b.urgent) return -1;
      if (!a.urgent && b.urgent) return 1;
    }
    return new Date(b.created_at) - new Date(a.created_at);
  };

  let filteredActive = allVisible.filter(t => t.status !== "completed");
  if (filterStatus !== "all") filteredActive = filteredActive.filter(t => t.status === filterStatus);
  if (filterUrgency === "urgent") filteredActive = filteredActive.filter(t => t.urgent);
  if (filterUrgency === "not_urgent") filteredActive = filteredActive.filter(t => !t.urgent);
  const activeTasks = [...filteredActive].sort(sortFn);
  const completedTasks = [...allVisible.filter(t => t.status === "completed")].sort(sortFn);
  const attentionTasks = tasks.filter(t => t.needs_attention);

  const navItems = isAdmin
    ? [
        { id: "overview",   label: "Overview",        icon: <Icon.Overview /> },
        { id: "tasks",      label: "All Projects",        icon: <Icon.Task /> },
        { id: "attention",  label: "Needs Attention",  icon: <Icon.Bell />, badge: attentionTasks.length },
        { id: "settings",   label: "Admin Settings",  icon: <Icon.Settings /> },
      ]
    : [
        { id: "tasks",      label: "My Projects",         icon: <Icon.Task /> },
        { id: "completed",  label: "Completed",        icon: <Icon.Track /> },
        { id: "settings",   label: "My Account",       icon: <Icon.User /> },
      ];

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
              <PasswordInput value={loginPw} onChange={e => setLoginPw(e.target.value)} onKeyDown={e => e.key === "Enter" && login()} />
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
            <div key={n.id} className={`nav-pill ${page === n.id ? "active" : ""}`} onClick={() => { setPage(n.id); if (n.id !== "overview") setOverviewFilter(null); if (n.id !== "tasks") { setFilterStatus("all"); setFilterUrgency("all"); setSortBy("default"); } }}
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
            <div className="nav-pill" onClick={toggleTheme} title={theme === "dark" ? "Light Mode" : "Dark Mode"}>{theme === "dark" ? <Icon.Sun /> : <Icon.Moon />} <span>{theme === "dark" ? "Light Mode" : "Dark Mode"}</span></div>
            <div className="nav-pill" onClick={refreshAll} title="Refresh"><Icon.Refresh /> <span>Refresh</span></div>
            <div className="nav-pill" onClick={logout} title="Sign Out"><Icon.Logout /> <span>Sign Out</span></div>
          </div>
        </aside>

        <main className="main-content scrollbar">
          {loading && <div style={{ textAlign: "center", padding: "80px 0" }}><div className="spinner" /></div>}

          {!loading && page === "overview" && isAdmin && <AdminOverview tasks={tasks} members={members} onSelectMember={(memberId) => { setFilterMember(memberId); setPage("tasks"); }} overviewFilter={overviewFilter} onCardClick={setOverviewFilter} onTaskClick={setSelectedTask} clearDoneTasks={clearDoneTasks} />}

          {!loading && page === "attention" && isAdmin && (
            <div className="fadein">
              <div className="page-header">
                <div>
                  <div className="page-title"><em>Needs Attention</em></div>
                  <div className="subtitle">{tasks.filter(t => t.needs_attention).length} project{tasks.filter(t => t.needs_attention).length !== 1 ? "s" : ""} flagged by members</div>
                </div>
                {tasks.filter(t => t.needs_attention).length > 1 && (
                  <button className="btn-ghost" style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}
                    onClick={() => tasks.filter(t => t.needs_attention).forEach(t => toggleAttention(t.id, false))}>
                    ✓ Dismiss All
                  </button>
                )}
              </div>
              {tasks.filter(t => t.needs_attention).length === 0
                ? <div className="empty"><div className="empty-icon">✅</div><div className="empty-label">No projects need your attention</div></div>
                : tasks.filter(t => t.needs_attention).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).map(t => (
                    <div key={t.id} style={{ background: "var(--surface)", border: "1px solid var(--attn-border)", borderRadius: 10, marginBottom: 12, overflow: "hidden" }}>
                      <div onClick={() => setSelectedTask(t)} style={{ cursor: "pointer" }}>
                        <TaskCard task={t} members={members} onClick={() => setSelectedTask(t)} />
                      </div>
                      <div style={{ borderTop: "1px solid var(--attn-border)", padding: "10px 22px", background: "var(--attn-bg)", display: "flex", alignItems: "center", gap: 12 }}>
                        <span style={{ fontSize: 12, color: "var(--attn-text)", fontWeight: 500 }}>🔔 Flagged for your attention</span>
                        <button
                          onClick={e => { e.stopPropagation(); toggleAttention(t.id, false); }}
                          style={{ padding: "6px 16px", borderRadius: 6, background: "var(--surface)", color: "var(--attn-text)", border: "1px solid var(--attn-border)", fontWeight: 600, fontSize: 12, cursor: "pointer" }}>
                          ✓ Dismiss
                        </button>
                      </div>
                    </div>
                  ))
              }
            </div>
          )}

          {!loading && page === "tasks" && (
            <div className="fadein">
              <div className="page-header">
                <div>
                  <div className="page-title">{isAdmin ? <>All <em>Projects</em></> : <>My <em>Projects</em></>}</div>
                  <div className="subtitle">{activeTasks.length} active project{activeTasks.length !== 1 ? "s" : ""}</div>
                </div>
                <div className="flex gap-8 items-center">
                  <button className="btn-primary" style={{ display: "flex", alignItems: "center", gap: 6 }} onClick={() => setShowCreate(true)}>
                    <Icon.Plus /> New Project
                  </button>
                </div>
              </div>

              {isAdmin && (
                <div className="flex gap-8 flex-wrap mb-12">
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

              <div className="flex gap-8 flex-wrap items-center mb-16">
                <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{
                  padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                  background: filterStatus !== "all" ? "var(--accent-dim)" : "var(--surface2)",
                  color: filterStatus !== "all" ? "var(--accent)" : "var(--text3)",
                  border: `1.5px solid ${filterStatus !== "all" ? "var(--accent)" : "var(--border)"}`,
                  cursor: "pointer", outline: "none", transition: "all .15s",
                }}>
                  <option value="all">All Statuses</option>
                  <option value="not started">Not Started</option>
                  <option value="in progress">In Progress</option>
                </select>
                <select value={filterUrgency} onChange={e => setFilterUrgency(e.target.value)} style={{
                  padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                  background: filterUrgency !== "all" ? "var(--accent-dim)" : "var(--surface2)",
                  color: filterUrgency !== "all" ? "var(--accent)" : "var(--text3)",
                  border: `1.5px solid ${filterUrgency !== "all" ? "var(--accent)" : "var(--border)"}`,
                  cursor: "pointer", outline: "none", transition: "all .15s",
                }}>
                  <option value="all">All Priority</option>
                  <option value="urgent">Urgent Only</option>
                  <option value="not_urgent">Not Urgent</option>
                </select>
                <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{
                  padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                  background: sortBy !== "default" ? "var(--accent-dim)" : "var(--surface2)",
                  color: sortBy !== "default" ? "var(--accent)" : "var(--text3)",
                  border: `1.5px solid ${sortBy !== "default" ? "var(--accent)" : "var(--border)"}`,
                  cursor: "pointer", outline: "none", transition: "all .15s",
                }}>
                  <option value="default">Sort: Default</option>
                  <option value="deadline">Sort: Deadline</option>
                  <option value="status">Sort: Status</option>
                  <option value="urgent">Sort: Urgent First</option>
                </select>
                {(filterStatus !== "all" || filterUrgency !== "all" || sortBy !== "default") && (
                  <button onClick={() => { setFilterStatus("all"); setFilterUrgency("all"); setSortBy("default"); }} style={{
                    padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                    background: "none", color: "var(--text3)", border: "1.5px solid var(--border)",
                    cursor: "pointer", transition: "all .15s",
                  }}>Clear</button>
                )}
              </div>

              {activeTasks.length === 0
                ? <div className="empty"><div className="empty-icon">🎉</div><div className="empty-label">All caught up! No active projects.</div></div>
                : activeTasks.map(t => {
                    const isNew = !isAdmin && !t.seen_by_assignee;
                    return (
                      <div key={t.id} onClick={() => { if (isNew) markSeen(t.id); setSelectedTask(t); }}
                        style={{ position: "relative" }}>
                        {isNew && (
                          <div style={{ position: "absolute", top: 10, right: 12, background: "var(--danger)", color: "#fff", borderRadius: 99, fontSize: 10, fontWeight: 700, padding: "2px 8px", zIndex: 1 }}>New</div>
                        )}
                        <div className={`task-card fadein ${t.urgent ? "urgent" : ""}`}
                          style={{ background: isNew ? "var(--new-bg)" : undefined, borderColor: isNew ? "var(--new-border)" : undefined, cursor: "pointer" }}>
                          <div className="flex items-center justify-between mb-8">
                            <div className="flex items-center gap-8 flex-wrap">
                              <StatusPill status={t.status} />
                              {t.urgent && <span className="tag tag-urgent"><Icon.Urgent /> Urgent</span>}
                              {t.needs_attention && <span className="tag" style={{ background: "var(--attn-bg)", color: "var(--attn-text)", border: "1px solid var(--attn-border)" }}><Icon.Bell /> Needs Attention</span>}
                              {t.track_status && (
                                <span className="tag" style={t.track_status === "on_track" ? { background: "var(--track-on-bg)", color: "var(--track-on-text)", border: "1px solid var(--track-on-border)" } : { background: "var(--track-off-bg)", color: "var(--track-off-text)", border: "1px solid var(--track-off-border)" }}>
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
                              <span className="member-chip" style={{ color: dl.urgent ? "var(--danger)" : dl.color, borderColor: dl.urgent ? "var(--track-off-border)" : "var(--border)", background: dl.urgent ? "var(--track-off-bg)" : "var(--surface2)", fontWeight: dl.urgent ? 600 : 400 }}>
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
                  <div className="subtitle">{completedTasks.length} completed project{completedTasks.length !== 1 ? "s" : ""}</div>
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
                ? <div className="empty"><div className="empty-icon">📭</div><div className="empty-label">No completed projects yet.</div></div>
                : completedTasks.map(t => <TaskCard key={t.id} task={t} members={members} onClick={() => setSelectedTask(t)} />)
              }
            </div>
          )}

          {!loading && page === "settings" && isAdmin && (
            <div className="fadein">
              <div className="page-header">
                <div>
                  <div className="page-title">Admin <em>Settings</em></div>
                  <div className="subtitle">Manage team members and access</div>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {[
                  { icon: <Icon.Key />, label: "Reset Password", desc: "Reset a member's password", onClick: () => setShowReset(true) },
                  { icon: <Icon.Edit />, label: "Rename Members", desc: "Update member display names", onClick: () => setShowRename(true) },
                  { icon: <Icon.Bell />, label: "Edit Emails", desc: "Manage notification emails", onClick: () => setShowEditEmails(true) },
                  { icon: <Icon.UserPlus />, label: "Add Member", desc: "Invite a new team member", onClick: () => setShowAddMember(true) },
                  { icon: <Icon.UserMinus />, label: "Remove Member", desc: "Remove a member from the team", onClick: () => setShowDeleteMember(true), danger: true },
                ].map(item => (
                  <div key={item.label} onClick={item.onClick}
                    style={{
                      background: "var(--surface)", border: `1px solid ${item.danger ? "var(--danger-dim)" : "var(--border)"}`,
                      borderRadius: 10, padding: "20px 22px", cursor: "pointer",
                      transition: "border-color .15s, box-shadow .15s",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = item.danger ? "var(--danger)" : "var(--border2)"; e.currentTarget.style.boxShadow = "0 4px 16px rgba(26,25,22,.06)"; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = item.danger ? "var(--danger-dim)" : "var(--border)"; e.currentTarget.style.boxShadow = "none"; }}
                  >
                    <div className="flex items-center gap-8 mb-8" style={{ color: item.danger ? "var(--danger)" : "var(--text)" }}>
                      {item.icon}
                      <span style={{ fontFamily: "'Cormorant Garamond',serif", fontWeight: 600, fontSize: 17 }}>{item.label}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text3)" }}>{item.desc}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!loading && page === "settings" && !isAdmin && (
            <div className="fadein">
              <div className="page-header">
                <div>
                  <div className="page-title"><em>My Account</em></div>
                  <div className="subtitle">Manage your profile and security</div>
                </div>
              </div>

              {/* Profile card */}
              <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "20px 24px", marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".08em", color: "var(--text3)", textTransform: "uppercase", marginBottom: 12 }}>Profile</div>
                <div className="flex items-center gap-12">
                  <div style={{ width: 48, height: 48, borderRadius: "50%", background: "var(--accent-dim)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Icon.User />
                  </div>
                  <div>
                    <div style={{ fontFamily: "'Cormorant Garamond',serif", fontWeight: 600, fontSize: 20 }}>{currentUser.name}</div>
                    <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>{currentUser.id}</div>
                  </div>
                </div>
              </div>

              {/* Email card */}
              <EmailInlineEdit currentUser={currentUser} onSave={saveMyEmail} showToast={showToast} />

              {/* Change password card */}
              <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "20px 24px", marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".08em", color: "var(--text3)", textTransform: "uppercase", marginBottom: 16 }}>Change Password</div>
                <ChangePasswordInline currentUser={currentUser} onSave={resetPassword} showToast={showToast} />
              </div>

              {/* Sign out */}
              <button className="btn-danger w-full" style={{ padding: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }} onClick={logout}>
                <Icon.Logout /> Sign Out
              </button>
            </div>
          )}
        </main>
      </div>

      {showCreate && <CreateTaskModal members={members} lockedTo={!isAdmin ? currentUser : null} onClose={() => setShowCreate(false)} onCreate={createTask} />}
      {showReset && <ResetPasswordModal users={users} onClose={() => setShowReset(false)} onReset={resetPassword} />}
      {showRename && <RenameMembersModal users={members} onClose={() => setShowRename(false)} onRename={renameMembers} />}
      {showEditEmails && <EditEmailsModal users={members} onClose={() => setShowEditEmails(false)} onSave={updateEmails} />}
      {showEmailPrompt && <EmailPromptModal currentUser={currentUser} onClose={() => setShowEmailPrompt(false)} onSave={saveMyEmail} />}
      {showAddMember && <AddMemberModal existingUsers={users} onClose={() => setShowAddMember(false)} onAdd={addMember} />}
      {showDeleteMember && <DeleteMemberModal users={members} tasks={tasks} onClose={() => setShowDeleteMember(false)} onDelete={deleteMember} />}
      {showChangePassword && <ChangePasswordModal currentUser={currentUser} onClose={() => setShowChangePassword(false)} onSave={resetPassword} />}
      {selectedTask && <TaskModal task={selectedTask} currentUser={currentUser} members={members} onClose={() => setSelectedTask(null)} onUpdateStatus={updateStatus} onAddComment={addComment} onUpdateTrack={updateTrack} onToggleAttention={toggleAttention} onDeleteTask={deleteTask} onUpdateDeadline={updateDeadline} />}

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
                <div key={t.id} style={{ background: "var(--attn-bg)", border: "1px solid var(--attn-border)", borderRadius: 8, padding: "10px 14px", marginBottom: 8, textAlign: "left" }}>
                  <div style={{ fontFamily: "'Cormorant Garamond',serif", fontWeight: 600, fontSize: 15 }}>{t.title}</div>
                  <div style={{ fontSize: 11, color: "var(--attn-text)", marginTop: 3 }}>
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
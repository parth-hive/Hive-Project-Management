const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") || "Hiveboard <notifications@hiveny.com>";

// Matches the app's design: Inter body, Cormorant Garamond headings,
// --bg:#FAFAF8, --surface:#fff, --border:#E8E6E0, --text:#1A1916,
// --text2:#6B6860, --text3:#A8A49C, --accent:#1A1916, --danger:#C0392B,
// --success:#27664A, --info:#1A4A7A

function wrap(badge: string, badgeColor: string, title: string, body: string) {
  return `
<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:#FAFAF8;font-family:'Inter','Helvetica Neue',Arial,sans-serif;color:#1A1916;font-size:14px">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#FAFAF8;padding:48px 20px">
    <tr><td align="center">
      <table width="540" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #E8E6E0;border-radius:10px;overflow:hidden;box-shadow:0 8px 40px rgba(26,25,22,.08)">

        <!-- Header -->
        <tr><td style="padding:24px 32px;border-bottom:1px solid #E8E6E0">
          <table cellpadding="0" cellspacing="0"><tr>
            <td style="font-family:'Cormorant Garamond',Georgia,serif;font-size:20px;font-weight:600;color:#1A1916;letter-spacing:-.01em">&#x2B22; Hiveboard</td>
          </tr></table>
        </td></tr>

        <!-- Badge + Title -->
        <tr><td style="padding:32px 32px 0 32px">
          <div style="display:inline-block;padding:4px 12px;border-radius:4px;font-family:'Inter',sans-serif;font-size:10px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:${badgeColor};background:${badgeColor}14;border:1px solid ${badgeColor}30">${badge}</div>
          <div style="font-family:'Cormorant Garamond',Georgia,serif;font-size:26px;font-weight:600;color:#1A1916;line-height:1.3;margin-top:16px;letter-spacing:-.02em">${escapeHtml(title)}</div>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:24px 32px 36px 32px;font-family:'Inter',sans-serif">
          ${body}
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:16px 32px;background:#F5F4F0;border-top:1px solid #E8E6E0">
          <table width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="font-family:'Inter',sans-serif;font-size:11px;color:#A8A49C">Hiveboard &mdash; Project Tracker</td>
            <td align="right" style="font-family:'Inter',sans-serif;font-size:10px;color:#D4D0C8;letter-spacing:.05em;text-transform:uppercase">Automated</td>
          </tr></table>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body></html>`;
}

function taskCreatedHtml(task: { title: string; description?: string; deadline?: string; assigned_to: string }) {
  let body = "";

  if (task.description) {
    body += `<div style="font-size:13px;color:#6B6860;line-height:1.7;margin-bottom:20px">${escapeHtml(task.description)}</div>`;
  }

  body += `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px">
      <tr>
        <td style="padding:14px 18px;background:#F5F4F0;border:1px solid #E8E6E0;border-right:none;border-radius:6px 0 0 6px;width:50%">
          <div style="font-family:'Inter',sans-serif;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:#A8A49C;margin-bottom:6px">Status</div>
          <div style="font-family:'Inter',sans-serif;font-size:13px;color:#1A1916;font-weight:500">
            <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#C0392B;margin-right:6px;vertical-align:middle"></span>Not Started
          </div>
        </td>
        <td style="padding:14px 18px;background:#F5F4F0;border:1px solid #E8E6E0;border-left:none;border-radius:0 6px 6px 0;width:50%">
          <div style="font-family:'Inter',sans-serif;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:#A8A49C;margin-bottom:6px">Deadline</div>
          <div style="font-family:'Inter',sans-serif;font-size:13px;color:#1A1916;font-weight:500">${task.deadline ? formatDateEmail(task.deadline) : "None set"}</div>
        </td>
      </tr>
    </table>
    <div style="text-align:center">
      <span style="font-family:'Inter',sans-serif;font-size:12px;color:#A8A49C">Log in to Hiveboard to view details.</span>
    </div>`;

  return wrap("New Project", "#C0392B", task.title, body);
}

function taskUpdatedHtml(task: { title: string }, changes: { field: string; from?: string; to?: string }[]) {
  let rows = "";
  changes.forEach((c, i) => {
    const isLast = i === changes.length - 1;
    const border = isLast ? "" : "border-bottom:1px solid #E8E6E0;";
    rows += `
      <tr>
        <td style="padding:11px 16px;${border}vertical-align:top;width:110px">
          <div style="font-family:'Inter',sans-serif;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:#A8A49C">${escapeHtml(c.field)}</div>
        </td>
        <td style="padding:11px 16px;${border}font-family:'Inter',sans-serif;font-size:13px;color:#1A1916">
          ${c.from ? `<span style="color:#A8A49C;text-decoration:line-through">${escapeHtml(c.from)}</span><span style="color:#D4D0C8;padding:0 8px">&rarr;</span>` : ""}<span style="font-weight:600;color:#1A1916">${escapeHtml(c.to || "\u2014")}</span>
        </td>
      </tr>`;
  });

  const body = `
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F4F0;border:1px solid #E8E6E0;border-radius:6px;overflow:hidden;margin-bottom:20px">
      <tr><td colspan="2" style="padding:10px 16px;border-bottom:1px solid #E8E6E0">
        <span style="font-family:'Inter',sans-serif;font-size:10px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:#6B6860">What Changed</span>
      </td></tr>
      ${rows}
    </table>
    <div style="text-align:center">
      <span style="font-family:'Inter',sans-serif;font-size:12px;color:#A8A49C">Log in to Hiveboard to view the full project.</span>
    </div>`;

  return wrap(changes.length === 1 ? "Updated" : `${changes.length} Changes`, "#1A4A7A", task.title, body);
}

function commentAddedHtml(task: { title: string }, comment: { author: string; text: string }) {
  const body = `
    <div style="background:#F5F4F0;border:1px solid #E8E6E0;border-left:2px solid #D4D0C8;border-radius:6px;padding:16px 18px;margin-bottom:20px">
      <div style="font-family:'Inter',sans-serif;font-size:11px;font-weight:600;color:#6B6860;margin-bottom:8px">${escapeHtml(comment.author)} wrote:</div>
      <div style="font-family:'Inter',sans-serif;font-size:13px;color:#1A1916;line-height:1.7">${escapeHtml(comment.text)}</div>
    </div>
    <div style="text-align:center">
      <span style="font-family:'Inter',sans-serif;font-size:12px;color:#A8A49C">Log in to Hiveboard to reply.</span>
    </div>`;

  return wrap("New Comment", "#27664A", task.title, body);
}

function taskPendingReviewHtml(task: { title: string }, submittedBy: string) {
  const body = `
    <div style="font-size:13px;color:#6B6860;line-height:1.7;margin-bottom:20px">
      <strong style="color:#1A1916">${escapeHtml(submittedBy)}</strong> has submitted this project for your review.
    </div>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F4F0;border:1px solid #E8E6E0;border-radius:6px;overflow:hidden;margin-bottom:20px">
      <tr>
        <td style="padding:14px 18px">
          <div style="font-family:'Inter',sans-serif;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:#A8A49C;margin-bottom:6px">Status</div>
          <div style="font-family:'Inter',sans-serif;font-size:13px;color:#B45309;font-weight:500">
            <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#B45309;margin-right:6px;vertical-align:middle"></span>Pending Review
          </div>
        </td>
      </tr>
    </table>
    <div style="text-align:center">
      <span style="font-family:'Inter',sans-serif;font-size:12px;color:#A8A49C">Log in to Hiveboard to approve or reject.</span>
    </div>`;

  return wrap("Pending Review", "#B45309", task.title, body);
}

function taskReviewCompletedHtml(task: { title: string }, approved: boolean, reason?: string | null) {
  const statusText = approved ? "Approved" : "Sent Back for Revision";
  const statusColor = approved ? "#27664A" : "#C0392B";
  const statusDot = approved ? "#27664A" : "#C0392B";

  let body = `
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F4F0;border:1px solid #E8E6E0;border-radius:6px;overflow:hidden;margin-bottom:20px">
      <tr>
        <td style="padding:14px 18px">
          <div style="font-family:'Inter',sans-serif;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:#A8A49C;margin-bottom:6px">Review Result</div>
          <div style="font-family:'Inter',sans-serif;font-size:13px;color:${statusColor};font-weight:600">
            <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${statusDot};margin-right:6px;vertical-align:middle"></span>${statusText}
          </div>
        </td>
      </tr>
    </table>`;

  if (!approved && reason) {
    body += `
    <div style="background:#FDF2F2;border:1px solid #EDD5D5;border-left:2px solid #C0392B;border-radius:6px;padding:16px 18px;margin-bottom:20px">
      <div style="font-family:'Inter',sans-serif;font-size:11px;font-weight:600;color:#C0392B;margin-bottom:8px">Reason:</div>
      <div style="font-family:'Inter',sans-serif;font-size:13px;color:#1A1916;line-height:1.7">${escapeHtml(reason)}</div>
    </div>`;
  }

  body += `
    <div style="text-align:center">
      <span style="font-family:'Inter',sans-serif;font-size:12px;color:#A8A49C">${approved ? "Great work! The project has been marked as completed." : "Please review the feedback and update your project."}</span>
    </div>`;

  const badge = approved ? "Approved" : "Revision Needed";
  const badgeColor = approved ? "#27664A" : "#C0392B";
  return wrap(badge, badgeColor, task.title, body);
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatDateEmail(d: string): string {
  const date = new Date(d + "T00:00:00");
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { user_id, type, task, changes, comment, submitted_by, approved, reason } = await req.json();

    // Look up user email
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/users?id=eq.${encodeURIComponent(user_id)}&select=email,name`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    const users = await res.json();
    const user = users?.[0];
    if (!user?.email) {
      return new Response(JSON.stringify({ ok: false, reason: "no_email" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let subject: string;
    let html: string;

    switch (type) {
      case "task_created":
        subject = `New Project: ${task.title}`;
        html = taskCreatedHtml(task);
        break;
      case "task_updated": {
        const isCompleted = Array.isArray(changes) && changes.some((c: any) => c.field === "Status" && c.to === "completed");
        subject = isCompleted ? `Project Completed: ${task.title}` : `Project Updated: ${task.title}`;
        html = taskUpdatedHtml(task, changes);
      }
        break;
      case "comment_added":
        subject = `New Comment on: ${task.title}`;
        html = commentAddedHtml(task, comment);
        break;
      case "task_pending_review":
        subject = `Pending Review: ${task.title}`;
        html = taskPendingReviewHtml(task, submitted_by || "A team member");
        break;
      case "task_review_completed":
        subject = approved ? `Project Approved: ${task.title}` : `Revision Needed: ${task.title}`;
        html = taskReviewCompletedHtml(task, approved, reason);
        break;
      default:
        return new Response(JSON.stringify({ ok: false, reason: "unknown_type" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    // Send via Resend
    const sendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [user.email],
        subject,
        html,
      }),
    });

    if (!sendRes.ok) {
      const err = await sendRes.text();
      console.error("Resend error:", err);
      return new Response(JSON.stringify({ ok: false, reason: "send_failed", detail: err }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Email notification error:", e);
    return new Response(JSON.stringify({ ok: false, reason: "error", detail: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

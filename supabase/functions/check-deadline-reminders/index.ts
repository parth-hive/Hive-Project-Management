const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") || "Hiveboard <notifications@hiveny.com>";

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatDate(d: string): string {
  const date = new Date(d + "T00:00:00");
  return date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function deadlineReminderHtml(task: { title: string; deadline: string }) {
  return `
<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:#FAFAF8;font-family:'Inter','Helvetica Neue',Arial,sans-serif;color:#1A1916;font-size:14px">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#FAFAF8;padding:48px 20px">
    <tr><td align="center">
      <table width="540" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #E8E6E0;border-radius:10px;overflow:hidden;box-shadow:0 8px 40px rgba(26,25,22,.08)">

        <tr><td style="padding:24px 32px;border-bottom:1px solid #E8E6E0">
          <span style="font-family:'Cormorant Garamond',Georgia,serif;font-size:20px;font-weight:600;color:#1A1916">&#x2B22; Hiveboard</span>
        </td></tr>

        <tr><td style="padding:32px 32px 0 32px">
          <div style="display:inline-block;padding:4px 12px;border-radius:4px;font-family:'Inter',sans-serif;font-size:10px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:#C0392B;background:rgba(192,57,43,.08);border:1px solid rgba(192,57,43,.18)">Deadline Tomorrow</div>
          <div style="font-family:'Cormorant Garamond',Georgia,serif;font-size:26px;font-weight:600;color:#1A1916;line-height:1.3;margin-top:16px;letter-spacing:-.02em">${escapeHtml(task.title)}</div>
        </td></tr>

        <tr><td style="padding:24px 32px 36px 32px">
          <div style="background:#F5F4F0;border:1px solid #E8E6E0;border-radius:6px;padding:16px 18px;margin-bottom:20px">
            <div style="font-family:'Inter',sans-serif;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:#A8A49C;margin-bottom:6px">Due Date</div>
            <div style="font-family:'Inter',sans-serif;font-size:15px;font-weight:600;color:#C0392B">${formatDate(task.deadline)}</div>
            <div style="font-family:'Inter',sans-serif;font-size:12px;color:#6B6860;margin-top:4px">Deadline ends at 11:00 AM EST</div>
          </div>
          <div style="text-align:center">
            <span style="font-family:'Inter',sans-serif;font-size:12px;color:#A8A49C">Log in to Hiveboard to update your progress.</span>
          </div>
        </td></tr>

        <tr><td style="padding:16px 32px;background:#F5F4F0;border-top:1px solid #E8E6E0">
          <table width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="font-family:'Inter',sans-serif;font-size:11px;color:#A8A49C">Hiveboard &mdash; Project Tracker</td>
            <td align="right" style="font-family:'Inter',sans-serif;font-size:10px;color:#D4D0C8;letter-spacing:.05em;text-transform:uppercase">Deadline Reminder</td>
          </tr></table>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body></html>`;
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
    // Calculate tomorrow's date in EST (UTC-5)
    const now = new Date();
    const estOffset = -5 * 60;
    const estNow = new Date(now.getTime() + (estOffset + now.getTimezoneOffset()) * 60000);
    const tomorrow = new Date(estNow);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split("T")[0]; // YYYY-MM-DD

    // Fetch tasks with deadline = tomorrow that are not completed
    const tasksRes = await fetch(
      `${SUPABASE_URL}/rest/v1/tasks?deadline=eq.${tomorrowStr}&status=neq.completed&select=id,title,deadline,assigned_to`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    const tasks = await tasksRes.json();

    if (!tasks || tasks.length === 0) {
      console.log(`No tasks due tomorrow (${tomorrowStr})`);
      return new Response(JSON.stringify({ ok: true, sent: 0, date: tomorrowStr }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch all users to get emails
    const usersRes = await fetch(
      `${SUPABASE_URL}/rest/v1/users?select=id,email,name`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    const users = await usersRes.json();
    const userMap = Object.fromEntries((users || []).map((u: any) => [u.id, u]));

    let sent = 0;
    for (const task of tasks) {
      const user = userMap[task.assigned_to];
      if (!user?.email) continue;

      const html = deadlineReminderHtml(task);
      const sendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: [user.email],
          subject: `Deadline Tomorrow: ${task.title}`,
          html,
        }),
      });

      if (sendRes.ok) {
        sent++;
        console.log(`Reminder sent to ${user.email} for "${task.title}"`);
      } else {
        const err = await sendRes.text();
        console.error(`Failed to send to ${user.email}:`, err);
      }
    }

    console.log(`Sent ${sent} deadline reminders for ${tomorrowStr}`);
    return new Response(JSON.stringify({ ok: true, sent, date: tomorrowStr }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Deadline reminder error:", e);
    return new Response(JSON.stringify({ ok: false, reason: "error", detail: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// Morning Whetstone: serves the site, handles email sign-ups and sends the daily question.
import { questionOfTheDay, londonDate } from "../public/questions.js";

const SEND_HOUR = 7; // 7am London time

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/subscribe" && request.method === "POST") return await subscribe(request, env);
      if (url.pathname === "/api/confirm") return await confirm(url, env);
      if (url.pathname === "/api/unsubscribe") return await unsubscribe(request, url, env);
    } catch (err) {
      console.error(err);
      return json({ error: "Something went wrong on our side. Try again in a minute." }, 500);
    }
    return env.ASSETS.fetch(request); // everything else is the static site
  },

  // Runs from the cron schedule in wrangler.toml.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(sendDaily(env));
  },
};

// ---------- sign-up ----------

async function subscribe(request, env) {
  const body = await request.json().catch(() => ({}));
  if (body.website) return json({ ok: true }); // honeypot: bots fill hidden fields
  const email = String(body.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) {
    return json({ error: "Enter a full email address, like you@example.com." }, 400);
  }

  const now = new Date().toISOString();
  const existing = await env.DB.prepare("SELECT token, confirmed, created_at FROM subscribers WHERE email = ?").bind(email).first();

  // Same reply whether or not they're already subscribed, so the form can't be used to check who's on the list.
  if (existing?.confirmed) return json({ ok: true });
  if (existing && Date.now() - Date.parse(existing.created_at) < 5 * 60 * 1000) return json({ ok: true });

  const token = existing?.token || randomToken();
  await env.DB.prepare(
    "INSERT INTO subscribers (email, token, confirmed, created_at) VALUES (?, ?, 0, ?) ON CONFLICT(email) DO UPDATE SET created_at = excluded.created_at"
  ).bind(email, token, now).run();

  const link = `${env.SITE_URL}/api/confirm?token=${token}`;
  await sendEmail(env, [{
    to: email,
    subject: "Confirm your Morning Whetstone subscription",
    html: shell(`<p style="margin:0 0 16px">Tap below to start getting one thinking question every morning at 7am.</p>
      ${button(link, "Confirm my subscription")}
      <p style="margin:24px 0 0;color:#76726A;font-size:13px">If you didn't sign up, ignore this email and you won't hear from us again.</p>`),
    text: `Confirm your subscription to Morning Whetstone:\n${link}\n\nIf you didn't sign up, ignore this email.`,
  }]);
  return json({ ok: true });
}

async function confirm(url, env) {
  const token = url.searchParams.get("token") || "";
  const res = await env.DB.prepare("UPDATE subscribers SET confirmed = 1, confirmed_at = ? WHERE token = ?")
    .bind(new Date().toISOString(), token).run();
  return Response.redirect(`${env.SITE_URL}/?status=${res.meta.changes ? "subscribed" : "invalid"}`, 303);
}

async function unsubscribe(request, url, env) {
  const token = url.searchParams.get("token") || "";
  // GET shows a button (so email link-scanners can't unsubscribe people by accident).
  // POST does it, which is also what mail apps' one-click "Unsubscribe" sends.
  if (request.method === "POST") {
    const body = await request.text();
    await env.DB.prepare("DELETE FROM subscribers WHERE token = ?").bind(token).run();
    if (body.includes("One-Click")) return new Response("Unsubscribed"); // mail app's one-click button
    return Response.redirect(`${env.SITE_URL}/?status=unsubscribed`, 303);
  }
  const page = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Unsubscribe · Morning Whetstone</title>
<body style="margin:0;background:#ECEAE5;color:#2A2927;font-family:Helvetica,Arial,sans-serif;padding:48px 16px">
<div style="max-width:420px;margin:0 auto;background:#F6F5F1;border:1px solid #D5D1C8;padding:32px">
<h1 style="font-family:Georgia,serif;font-weight:600;font-size:20px;margin:0 0 12px">Stop the daily question?</h1>
<p style="margin:0 0 20px;line-height:1.6">You'll stop getting the 7am email. You can still use the site any time.</p>
<form method="post"><button style="background:#2A2927;color:#F6F5F1;border:0;padding:10px 20px;font:inherit;cursor:pointer">Unsubscribe</button></form>
</div></body>`;
  return new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } });
}

// ---------- daily send ----------

async function sendDaily(env) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "numeric", hour12: false }).format(new Date()));
  // Two cron times cover both GMT and BST; only the one that lands on 7am London time sends.
  if (hour !== SEND_HOUR && env.SEND_ANY_HOUR !== "true") return;

  const today = londonDate();
  const q = questionOfTheDay(today);
  const niceDate = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "long", day: "numeric", month: "long" }).format(new Date());

  // Send in batches of 100 (the email provider's batch limit). last_sent stops anyone getting it twice.
  for (;;) {
    const { results } = await env.DB.prepare(
      "SELECT email, token FROM subscribers WHERE confirmed = 1 AND (last_sent IS NULL OR last_sent <> ?) LIMIT 100"
    ).bind(today).all();
    if (!results.length) break;

    const messages = results.map(s => {
      const unsub = `${env.SITE_URL}/api/unsubscribe?token=${s.token}`;
      const solve = `${env.SITE_URL}/?q=today`;
      return {
        to: s.email,
        subject: `Today's question: ${q.theme}`,
        headers: { "List-Unsubscribe": `<${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
        html: shell(`<p style="margin:0 0 6px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#76726A">${esc(niceDate)} · ${esc(q.theme)}</p>
          <p style="margin:0 0 24px;font-family:Georgia,'Times New Roman',serif;font-size:21px;line-height:1.55;white-space:pre-line">${esc(q.q)}</p>
          <p style="margin:0 0 20px;line-height:1.6">Give yourself 10 minutes. Think it through on paper or in your head before you look anything up.</p>
          ${button(solve, "Start the timer, hints and answer")}`,
          `<a href="${unsub}" style="color:#76726A">Unsubscribe</a>`),
        text: `${niceDate} · ${q.theme}\n\n${q.q}\n\nGive yourself 10 minutes. Timer, hints and answer:\n${solve}\n\nUnsubscribe: ${unsub}`,
      };
    });

    await sendEmail(env, messages);
    const marks = results.map(s => env.DB.prepare("UPDATE subscribers SET last_sent = ? WHERE email = ?").bind(today, s.email));
    await env.DB.batch(marks);
  }
}

// ---------- email via Resend ----------

async function sendEmail(env, messages) {
  const payload = messages.map(m => ({ from: env.FROM_EMAIL, ...m }));
  const single = payload.length === 1;
  const base = env.EMAIL_API_BASE || "https://api.resend.com"; // overridable for local testing
  const res = await fetch(`${base}/emails${single ? "" : "/batch"}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(single ? payload[0] : payload),
  });
  if (!res.ok) throw new Error(`Email send failed: ${res.status} ${await res.text()}`);
}

// ---------- helpers ----------

function shell(inner, footer = "") {
  return `<!doctype html><html><body style="margin:0;background:#ECEAE5;padding:32px 16px;font-family:Helvetica,Arial,sans-serif;color:#2A2927">
  <div style="max-width:520px;margin:0 auto">
    <p style="margin:0 0 16px;font-family:Georgia,serif;font-size:16px"><span style="color:#2F4A6B">砥</span>&nbsp; Morning Whetstone</p>
    <div style="background:#F6F5F1;border:1px solid #D5D1C8;padding:28px">${inner}</div>
    <p style="margin:16px 0 0;font-size:12px;color:#76726A">${footer}</p>
  </div></body></html>`;
}
function button(href, label) {
  return `<a href="${href}" style="display:inline-block;background:#2A2927;color:#F6F5F1;text-decoration:none;padding:11px 20px;font-size:14px">${esc(label)}</a>`;
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function randomToken() {
  const b = new Uint8Array(24); crypto.getRandomValues(b);
  return [...b].map(x => x.toString(16).padStart(2, "0")).join("");
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}

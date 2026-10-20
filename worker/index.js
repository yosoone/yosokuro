/* Yoso contact form: a Cloudflare Worker at https://forms.yoso.one/contact
   It checks the message, checks Cloudflare Turnstile (the invisible spam check),
   then emails it to Yoso's verified address. Replying in Gmail goes to the sender.

   Settings live in wrangler.toml; the Turnstile secret is a Worker secret
   (npx wrangler secret put TURNSTILE_SECRET). Nothing secret is in this file. */
import { EmailMessage } from "cloudflare:email";

// Sites allowed to send messages here. Add another Yoso site's address to use the same form.
const ORIGINS = ["https://kuro.yoso.one"];
const TOPICS = { print: "Print request", general: "General", other: "Other" };
const LIMIT = { name: 120, email: 254, photo: 40, message: 5000 };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const allowed = ORIGINS.includes(origin) || (env.DEV_ORIGIN && origin === env.DEV_ORIGIN);
    const cors = allowed ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin" } : { "Vary": "Origin" };

    if (url.pathname !== "/contact") return new Response("Not found", { status: 404 });
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { ...cors,
        "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400" } });
    }
    if (request.method !== "POST") return reply(cors, 405, "method");
    if (!allowed) return reply(cors, 403, "origin");

    let form;
    try { form = await request.formData(); } catch { return reply(cors, 400, "form"); }
    const get = k => String(form.get(k) || "").trim();

    // Honeypot: a hidden field people never fill in. Bots that do get a quiet 'ok'.
    if (get("website")) return reply(cors, 200);

    const name = oneLine(get("name")).slice(0, LIMIT.name);
    const email = oneLine(get("email")).slice(0, LIMIT.email);
    const topic = TOPICS[get("topic")] ? get("topic") : "general";
    const photo = oneLine(get("photo")).replace(/[^A-Za-z0-9_-]/g, "").slice(0, LIMIT.photo);
    const message = get("message").slice(0, LIMIT.message);

    if (!name || !message) return reply(cors, 400, "missing");
    if (!/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email)) return reply(cors, 400, "email");

    // Turnstile: Cloudflare confirms the visitor is a person.
    const check = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: new URLSearchParams({
        secret: env.TURNSTILE_SECRET || "",
        response: get("cf-turnstile-response"),
        remoteip: request.headers.get("CF-Connecting-IP") || "",
      }),
    }).then(r => r.json()).catch(() => ({ success: false }));
    if (!check.success) return reply(cors, 403, "spam");

    const site = new URL(origin).host;
    const subject = `${TOPICS[topic]}${photo ? " · " + photo.toUpperCase() : ""} · ${name} (${site})`;
    const body = [
      `From: ${name} <${email}>`,
      `Topic: ${TOPICS[topic]}`,
      photo ? `Photograph: ${photo.toUpperCase()} (https://${site}/#f-${photo.toLowerCase()})` : null,
      `Sent from: ${site}`,
      "",
      message,
      "",
      "—",
      "Reply to this email to answer them directly.",
    ].filter(l => l !== null).join("\r\n");

    const raw = mime({
      from: `Yoso website <${env.FROM}>`,
      to: env.TO,
      replyTo: `${word(name)} <${email}>`,
      subject,
      body,
      domain: env.FROM.split("@")[1],
    });

    try {
      await env.MAILER.send(new EmailMessage(env.FROM, env.TO, raw));
    } catch (e) {
      console.log("send failed", e && e.message);
      return reply(cors, 502, "send");
    }
    return reply(cors, 200);
  },
};

function reply(cors, status, error) {
  return new Response(JSON.stringify(error ? { ok: false, error } : { ok: true }), {
    status, headers: { ...cors, "Content-Type": "application/json" },
  });
}

// Header values: no line breaks (stops anyone adding their own email headers).
function oneLine(s) { return s.replace(/[\r\n]+/g, " ").trim(); }

// UTF-8 text for email headers (names and subjects may be in Japanese).
function word(s) { return /^[\x20-\x7e]*$/.test(s) ? `"${s.replace(/["\\]/g, "")}"` : `=?UTF-8?B?${b64(s)}?=`; }

function b64(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function mime({ from, to, replyTo, subject, body, domain }) {
  const encoded = b64(body).replace(/.{1,76}/g, "$&\r\n");
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Reply-To: ${replyTo}`,
    `Subject: ${/^[\x20-\x7e]*$/.test(subject) ? subject : `=?UTF-8?B?${b64(subject)}?=`}`,
    `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    encoded,
  ].join("\r\n");
}

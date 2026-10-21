/* Yoso forms: a Cloudflare Worker at https://forms.yoso.one
     /contact    the contact forms (kuro, shinsei, one.yoso.one): emails the message to Yoso
                 (and, if ticked, adds the sender to the mailing list)
     /subscribe  the mailing-list form on every Yoso site (assets/list-choice.js):
                 adds the reader to Buttondown with the newsletters they ticked
   Both check Cloudflare Turnstile (the mostly invisible spam check) first.

   Settings live in wrangler.toml. Two Worker secrets, never in this file:
     npx wrangler secret put TURNSTILE_SECRET   (Turnstile widget 'Yoso forms')
     npx wrangler secret put BUTTONDOWN_KEY     (Buttondown API key) */
import { EmailMessage } from "cloudflare:email";

// Yoso sites allowed to use these forms. A new site: add it here, add its hostname to the
// Turnstile widget, and redeploy (npx wrangler deploy).
const ORIGINS = [
  "https://kuro.yoso.one",
  "https://hub.yoso.one",
  "https://shinsei.yoso.one",
  "https://river.yoso.one",
  "https://on.yoso.one",
  "https://one.yoso.one",
];
// The newsletters readers can choose; each is a Buttondown tag. Same list as check.py on every site.
const NEWSLETTERS = ["one", "yosokuro", "shinsei", "river", "on"];
// Topics a contact form may offer (each site shows its own choice of these).
const TOPICS = { print: "Print request", work: "About a work", note: "About a note", commission: "Commission",
                 exhibition: "Exhibition", general: "General", other: "Other" };
const LIMIT = { name: 120, email: 254, photo: 40, work: 160, note: 160, message: 5000 };
const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const route = { "/contact": contact, "/subscribe": subscribe }[url.pathname];
    if (!route) return new Response("Not found", { status: 404 });

    const origin = request.headers.get("Origin") || "";
    const allowed = ORIGINS.includes(origin) || (env.DEV_ORIGIN && origin === env.DEV_ORIGIN);
    const cors = allowed ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin" } : { "Vary": "Origin" };

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

    const ctx = { request, env, form, get, cors, site: new URL(origin).host,
                  ip: request.headers.get("CF-Connecting-IP") || "" };
    return route(ctx);
  },
};

async function contact({ env, get, cors, site, ip }) {
  const name = oneLine(get("name")).slice(0, LIMIT.name);
  const email = oneLine(get("email")).slice(0, LIMIT.email);
  const topic = TOPICS[get("topic")] ? get("topic") : "general";
  const photo = oneLine(get("photo")).replace(/[^A-Za-z0-9_-]/g, "").slice(0, LIMIT.photo);
  const work = oneLine(get("work")).slice(0, LIMIT.work);
  const note = oneLine(get("note")).slice(0, LIMIT.note);
  const message = get("message").slice(0, LIMIT.message);
  // 'Also join the mailing list': the box's value is that site's newsletter tag.
  const join = NEWSLETTERS.includes(get("subscribe")) ? get("subscribe") : "";

  if (!name || !message) return reply(cors, 400, "missing");
  if (!EMAIL.test(email)) return reply(cors, 400, "email");
  if (!(await human(env, get("cf-turnstile-response"), ip))) return reply(cors, 403, "spam");

  const subject = `${TOPICS[topic]}${photo ? " · " + photo.toUpperCase() : ""} · ${name} (${site})`;
  const body = [
    `From: ${name} <${email}>`,
    `Topic: ${TOPICS[topic]}`,
    photo ? `Photograph: ${photo.toUpperCase()} (https://${site}/#f-${photo.toLowerCase()})` : null,
    work ? `Work: ${work}` : null,
    note ? `Note: ${note}` : null,
    `Sent from: ${site}`,
    join ? `Mailing list: asked to join (${join}); Buttondown confirms by email if needed` : null,
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

  // The message has gone; a mailing-list problem never turns it into an error.
  if (join) await addToList(env, email, [join], ip, site);
  return reply(cors, 200);
}

async function subscribe({ env, form, get, cors, site, ip }) {
  const email = oneLine(get("email")).slice(0, LIMIT.email);
  const tags = [...new Set(form.getAll("tag").map(String))].filter(t => NEWSLETTERS.includes(t));

  if (!EMAIL.test(email)) return reply(cors, 400, "email");
  if (!tags.length) return reply(cors, 400, "none");
  if (!(await human(env, get("cf-turnstile-response"), ip))) return reply(cors, 403, "spam");

  return (await addToList(env, email, tags, ip, site)) ? reply(cors, 200) : reply(cors, 502, "list");
}

// Turnstile: Cloudflare confirms the visitor is a person.
async function human(env, token, ip) {
  if (!token) return false;
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: new URLSearchParams({ secret: env.TURNSTILE_SECRET || "", response: token, remoteip: ip }),
  }).then(r => r.json()).catch(() => ({ success: false }));
  return !!r.success;
}

// Buttondown: every sign-up must be confirmed by the reader (double opt-in).
//  - New address: created as usual; Buttondown sends its confirmation email.
//  - Already an active subscriber: the ticked newsletters are added as tags; no email needed.
//  - Known but not active (unsubscribed, removed, still unconfirmed): set back to 'unactivated',
//    which sends a fresh confirmation email. Never re-subscribed directly, so nobody can put
//    someone else back on the list just by typing their address.
//  - Blocked, bounced or complained addresses are left alone.
// The reader's own IP goes along for Buttondown's spam check.
const ACTIVE = ["regular", "premium", "gifted", "trialed", "churning", "past_due", "paused", "cancelled", "unpaid"];
const LEAVE = ["blocked", "complained", "undeliverable", "spammy"];

async function addToList(env, email, tags, ip, site) {
  const key = (env.BUTTONDOWN_KEY || "").trim();
  if (!key) { console.log("buttondown: no key"); return false; }
  const api = "https://api.buttondown.com/v1/subscribers";
  const auth = { "Authorization": `Token ${key}`, "Content-Type": "application/json" };
  const base = { email_address: email, tags, ip_address: ip || undefined, referrer_url: `https://${site}/` };
  try {
    let r = await fetch(api, { method: "POST", headers: auth, body: JSON.stringify(base) });
    if (r.ok) return true;
    const first = (await r.text()).slice(0, 300);
    if (r.status !== 400) { console.log("buttondown create", r.status, first); return false; }

    // 400: most likely the address already exists. Look it up.
    const g = await fetch(`${api}/${encodeURIComponent(email)}`, { headers: auth });
    if (!g.ok) { console.log("buttondown create", r.status, first, "| lookup", g.status); return false; }
    const type = String((await g.json()).type || "");
    if (LEAVE.includes(type)) { console.log("buttondown: left alone, type", type); return true; }

    const body = ACTIVE.includes(type) ? base : { ...base, type: "unactivated" };
    r = await fetch(api, {
      method: "POST",
      headers: { ...auth, "X-Buttondown-Collision-Behavior": "add" },
      body: JSON.stringify(body),
    });
    if (r.ok) return true;
    console.log("buttondown update", type, r.status, (await r.text()).slice(0, 300));
  } catch (e) {
    console.log("buttondown failed", e && e.message);
  }
  return false;
}

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

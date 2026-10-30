/* Yosokuro print shop, part of the Yoso forms Worker (https://forms.yoso.one).
     GET  /prices          the price list, for the site to show prices and totals
     POST /checkout        the cart (JSON) -> a Stripe Checkout page; returns { url }
     POST /stripe-webhook  Stripe tells us an order is paid -> email the order to Yoso
   Prices are set HERE and only here: the site shows them, but the Worker works out every
   amount itself, so nobody can change a price in their browser.

   Two Worker secrets (never in this file):
     npx wrangler secret put STRIPE_SECRET_KEY      sk_test_... while testing, sk_live_... to go live
     npx wrangler secret put STRIPE_WEBHOOK_SECRET  whsec_... from the Stripe webhook endpoint */
import { EmailMessage } from "cloudflare:email";

// ---- Price list (Japanese yen, consumption tax included). PLACEHOLDERS: Yoso sets the real ones. ----
export const SHOP = {
  currency: "jpy",
  papers: {
    standard: { name: "Standard", desc: "Printed by PRIO" },
    premium:  { name: "Premium",  desc: "Archival, printed by Tokugawa" },
  },
  sizes: { A3: "A3 · 297 × 420 mm", A2: "A2 · 420 × 594 mm" },
  borders: ["White border", "No border"],
  prices: {            // yen, per print
    standard: { A3: 8000,  A2: 12000 },
    premium:  { A3: 18000, A2: 28000 },
  },
  shipping: {          // yen, per order
    jp:   { name: "Japan",          amount: 1500, days: [5, 9] },
    intl: { name: "Outside Japan",  amount: 4500, days: [10, 21] },
  },
  maxQty: 5,           // per line
  maxLines: 20,
};

// Countries Stripe may ship to when 'Outside Japan' is chosen (Japan is excluded there).
const INTL = ["AU","AT","BE","CA","CH","CN","CZ","DE","DK","ES","FI","FR","GB","GR","HK","HU","IE","IL","IN","IS",
  "IT","KR","LU","MX","MY","NL","NO","NZ","PH","PL","PT","SE","SG","TH","TW","US","VN","ZA","AE","BR","AR","CL","ID"];

const SITE = "https://kuro.yoso.one";
let worksCache = { at: 0, ids: null };

// The frames that exist right now, read from the site's own list of works (assets/works.js).
// A frame that has been retired from the site can no longer be bought.
async function liveIds() {
  if (worksCache.ids && Date.now() - worksCache.at < 5 * 60 * 1000) return worksCache.ids;
  const js = await fetch(`${SITE}/assets/works.js`, { cf: { cacheTtl: 60 } }).then(r => r.text());
  const m = js.match(/R\s*:\s*\{([^}]*)\}/);
  const ids = new Set(m ? [...m[1].matchAll(/"([a-z0-9_]+)"\s*:/gi)].map(x => x[1]) : []);
  worksCache = { at: Date.now(), ids };
  return ids;
}

const label = id => id.toUpperCase().replace(/^R0(?=2)/, "_R0");
const yen = n => "¥" + n.toLocaleString("en-US");

export function prices(cors) {
  return json(cors, 200, { ok: true, shop: SHOP });
}

export async function checkout(request, env, cors) {
  if (!env.STRIPE_SECRET_KEY) return json(cors, 503, { ok: false, error: "closed" });
  let body;
  try { body = await request.json(); } catch { return json(cors, 400, { ok: false, error: "form" }); }
  const ship = SHOP.shipping[body && body.ship] ? body.ship : null;
  const items = Array.isArray(body && body.items) ? body.items.slice(0, SHOP.maxLines) : [];
  if (!ship) return json(cors, 400, { ok: false, error: "ship" });
  if (!items.length) return json(cors, 400, { ok: false, error: "empty" });

  const ids = await liveIds();
  const lines = [];
  for (const it of items) {
    const id = String(it.id || "").toLowerCase();
    const paper = SHOP.papers[it.paper] ? it.paper : null;
    const size = SHOP.sizes[it.size] ? it.size : null;
    const border = SHOP.borders.includes(it.border) ? it.border : SHOP.borders[0];
    const qty = Math.max(1, Math.min(SHOP.maxQty, parseInt(it.qty, 10) || 1));
    if (!ids.has(id)) return json(cors, 409, { ok: false, error: "retired", id });
    if (!paper || !size) return json(cors, 400, { ok: false, error: "options", id });
    lines.push({ id, paper, size, border, qty, amount: SHOP.prices[paper][size] });
  }

  const p = new URLSearchParams();
  p.set("mode", "payment");
  p.set("locale", "auto");
  p.set("success_url", `${SITE}/full.html?order=paid&session={CHECKOUT_SESSION_ID}#prints`);
  p.set("cancel_url", `${SITE}/full.html#prints`);
  p.set("billing_address_collection", "auto");
  p.set("phone_number_collection[enabled]", "true");
  lines.forEach((l, i) => {
    const k = `line_items[${i}]`;
    p.set(`${k}[quantity]`, String(l.qty));
    p.set(`${k}[price_data][currency]`, SHOP.currency);
    p.set(`${k}[price_data][unit_amount]`, String(l.amount));
    p.set(`${k}[price_data][product_data][name]`, `Yosokuro ${label(l.id)} · ${l.size} · ${SHOP.papers[l.paper].name}`);
    p.set(`${k}[price_data][product_data][description]`, `${SHOP.sizes[l.size]} · ${SHOP.papers[l.paper].desc} · ${l.border}`);
    p.set(`${k}[price_data][product_data][images][0]`, `${SITE}/img/thumb/${l.id}.jpg`);
  });
  const s = SHOP.shipping[ship];
  (ship === "jp" ? ["JP"] : INTL).forEach((c, i) => p.set(`shipping_address_collection[allowed_countries][${i}]`, c));
  p.set("shipping_options[0][shipping_rate_data][type]", "fixed_amount");
  p.set("shipping_options[0][shipping_rate_data][display_name]", `Tracked delivery · ${s.name}`);
  p.set("shipping_options[0][shipping_rate_data][fixed_amount][amount]", String(s.amount));
  p.set("shipping_options[0][shipping_rate_data][fixed_amount][currency]", SHOP.currency);
  p.set("shipping_options[0][shipping_rate_data][delivery_estimate][minimum][unit]", "business_day");
  p.set("shipping_options[0][shipping_rate_data][delivery_estimate][minimum][value]", String(s.days[0]));
  p.set("shipping_options[0][shipping_rate_data][delivery_estimate][maximum][unit]", "business_day");
  p.set("shipping_options[0][shipping_rate_data][delivery_estimate][maximum][value]", String(s.days[1]));
  // The order, kept on the payment so the webhook (and Yoso, in the Stripe dashboard) can read it.
  p.set("metadata[shop]", "yosokuro");
  p.set("metadata[ship]", ship);
  p.set("metadata[items]", lines.map(l => `${l.id}|${l.size}|${l.paper}|${l.border === "No border" ? "nb" : "wb"}|${l.qty}`).join(",").slice(0, 500));
  p.set("payment_intent_data[description]", `Yosokuro prints · ${lines.length} line(s)`);

  const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.STRIPE_SECRET_KEY.trim()}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: p,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.url) {
    console.log("stripe checkout", r.status, JSON.stringify(j.error || j).slice(0, 400));
    return json(cors, 502, { ok: false, error: "stripe" });
  }
  return json(cors, 200, { ok: true, url: j.url });
}

// Stripe -> here when a payment completes. Verifies Stripe's signature, then emails the order.
export async function webhook(request, env) {
  const raw = await request.text();
  if (!(await verify(raw, request.headers.get("Stripe-Signature") || "", env.STRIPE_WEBHOOK_SECRET || ""))) {
    return new Response("bad signature", { status: 400 });
  }
  let ev;
  try { ev = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }
  if (ev.type !== "checkout.session.completed") return new Response("ignored", { status: 200 });
  const s = ev.data && ev.data.object || {};
  if (!s.metadata || s.metadata.shop !== "yosokuro" || s.payment_status !== "paid") return new Response("ignored", { status: 200 });

  const cust = s.customer_details || {};
  const shipd = (s.collected_information && s.collected_information.shipping_details) || s.shipping_details || {};
  const a = shipd.address || {};
  const items = String(s.metadata.items || "").split(",").filter(Boolean).map(x => {
    const [id, size, paper, b, qty] = x.split("|");
    const each = SHOP.prices[paper] && SHOP.prices[paper][size];
    return `${qty} × ${label(id)} · ${size} · ${(SHOP.papers[paper] || {}).name || paper} · ${b === "nb" ? "No border" : "White border"}` +
           (each ? ` · ${yen(each)} each` : "") + `\n    ${SITE}/full.html#f-${id}`;
  });
  const order = (s.payment_intent || s.id || "").slice(-8).toUpperCase();
  const body = [
    `New Yosokuro order ${order}${s.livemode ? "" : " (TEST MODE: no real payment)"}`,
    "",
    "Prints:",
    ...items.map(x => "  " + x),
    "",
    `Total paid: ${yen(s.amount_total || 0)} (shipping ${yen((s.total_details && s.total_details.amount_shipping) || 0)})`,
    "",
    "Ship to:",
    `  ${shipd.name || cust.name || ""}`,
    `  ${[a.line1, a.line2].filter(Boolean).join(", ")}`,
    `  ${[a.postal_code, a.city, a.state].filter(Boolean).join(" ")}`,
    `  ${a.country || ""}`,
    cust.phone ? `  Phone: ${cust.phone}` : null,
    "",
    `Buyer: ${cust.name || ""} <${cust.email || ""}>`,
    `Stripe: https://dashboard.stripe.com/${s.livemode ? "" : "test/"}payments/${s.payment_intent || ""}`,
    "",
    "Reply to this email to write to the buyer.",
  ].filter(l => l !== null).join("\r\n");

  const subject = `${s.livemode ? "" : "[TEST] "}Yosokuro order ${order} · ${items.length} print line(s) · ${yen(s.amount_total || 0)}`;
  const raw2 = mime(env, subject, body, cust.email || "", cust.name || "");
  try {
    await env.MAILER.send(new EmailMessage(env.FROM, env.TO, raw2));
  } catch (e) {
    console.log("order email failed", e && e.message);
    return new Response("email failed", { status: 500 }); // Stripe retries later
  }
  return new Response("ok", { status: 200 });
}

// Stripe signature: header 't=...,v1=...'; HMAC-SHA256 of `${t}.${body}` with the endpoint secret.
async function verify(payload, header, secret) {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(header.split(",").map(kv => kv.split("=")).filter(x => x.length === 2).map(([k, v]) => [k.trim(), v]));
  const sigs = header.split(",").filter(x => x.startsWith("v1=")).map(x => x.slice(3));
  const t = parts.t;
  if (!t || !sigs.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 600) return false; // older than 10 minutes
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret.trim()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`));
  const hex = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, "0")).join("");
  return sigs.some(s => timingSafeEqual(s, hex));
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function json(cors, status, obj) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

function b64(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function mime(env, subject, body, replyEmail, replyName) {
  const ascii = s => /^[\x20-\x7e]*$/.test(s);
  const word = s => ascii(s) ? `"${s.replace(/["\\\r\n]/g, "")}"` : `=?UTF-8?B?${b64(s)}?=`;
  const safeEmail = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(replyEmail) ? replyEmail : "";
  return [
    `From: Yosokuro shop <${env.FROM}>`,
    `To: ${env.TO}`,
    safeEmail ? `Reply-To: ${word(replyName || safeEmail)} <${safeEmail}>` : null,
    `Subject: ${ascii(subject) ? subject : `=?UTF-8?B?${b64(subject)}?=`}`,
    `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${crypto.randomUUID()}@${env.FROM.split("@")[1]}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64(body).replace(/.{1,76}/g, "$&\r\n"),
  ].filter(l => l !== null).join("\r\n");
}

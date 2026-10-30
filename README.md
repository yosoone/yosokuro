# Yosokuro

**Yosokuro** is a lifelong black-and-white photography project by Yoso, documenting Japan's urban reality and the spirit of the Kami.

- **Live site:** <https://kuro.yoso.one>
- **RSS:** <https://kuro.yoso.one/feed.xml>

## Structure

- `index.html` — the whole site (photographs and profile)
- `img/full/` — 2400 px images for the full-screen viewer
- `img/thumb/` — 960 px images for the grid
- `img/mini/` — 400 px images for the contact sheet on the full-screen test version (`full.html`)
- `assets/works.js` — the one list of photographs: each frame's shape and which chapter it sits in, in order

## Adding photographs

1. Export from Lightroom: JPEG, sRGB, 2400 px on the long edge, about 80% quality.
2. Make a 960 px copy of each for the grid, and a 400 px copy for the contact sheet.
3. Name both copies after the frame number in lower case without the underscore (`_R025300.jpg` becomes `r025300.jpg`) and put them in `img/full/`, `img/thumb/` and `img/mini/`.
4. In `assets/works.js`, add the frame's width ÷ height to `R` and its name to a chapter's list in `CH`, where its position sets the order. A new chapter is one more line in `CH`.
5. Add an item for each new frame to `feed.xml`, then publish with `python3 release.py "What changed"`.
- `feed.xml` — RSS feed, one item per photograph
- `CNAME` — custom domain for GitHub Pages

© Yoso. All photographs are copyright and may not be reused without permission.

## Publishing an update (beta number)

The footer of every page shows the site's beta number, for example 'Beta 0.4'. It goes up by one with each update. To publish, in this folder:

```
python3 release.py "What changed"
```

That moves the number up (kept in `VERSION`), writes it into every footer, runs the check below, and commits and pushes. If the check fails, nothing is changed and the number stays where it was. Edits made straight on GitHub's website do not move the number; the next `release.py` run catches up.

## Safety: check, publish, undo

**Before publishing**, run the check in this folder:

```
python3 check.py
```

It looks for broken HTML, links to missing files, script errors, a missing hub link or mailing-list form, and a broken `feed.xml` or `robots.txt`. GitHub runs the same check on every push ('Check and publish' under the Actions tab). Once Settings → Pages → Source is set to **GitHub Actions**, a version that fails the check is never published: the live site keeps its last good version, and GitHub emails you what went wrong.

**To undo the last change**, in this folder:

```
git revert HEAD
git push
```

**To go back to a known-good version** (kept as branches named `good-YYYY-MM-DD`):

```
git fetch origin
git checkout origin/good-2026-10-20 -- .
git commit -m "Back to the good version of 20 October 2026"
git push
```

A full copy of this site, with its history, is also backed up to the external drive (`BLACK_PUNK_/00 Yoso_one Websites Back up`).

## Contact form

The Contact section posts to a small Cloudflare Worker at `https://forms.yoso.one/contact`, which emails each message to yosotattoo@gmail.com. Replying in Gmail answers the sender. 'Request a print' buttons, and 'Request this print' in the photograph viewer, open the form with the topic (and the photograph) filled in.

- The Worker's code is in `worker/` (`index.js` and `wrangler.toml`). It runs on the Workers Free plan.
- Spam is stopped by Cloudflare Turnstile (invisible for most visitors) and a hidden honeypot field. The site key is in the form's `data-sitekey`; the secret is a Worker secret, never in this repo.
- To let another Yoso site use the same form, add its address to `ORIGINS` at the top of `worker/index.js`, add its hostname to the Turnstile widget, and redeploy.
- To change the Worker, edit `worker/`, then in that folder run `npx wrangler deploy`.
- If the form ever fails, the email address beside it still works.

## Print shop (full.html, Stripe)

The print list on `full.html` is the cart. Buyers choose size (A3, A2), paper (Standard by PRIO, Premium archival by Tokugawa), border and quantity, pick 'Ship to', then **Checkout** opens Stripe's own payment page, which collects their name, address, phone and card. No form on this site.

- **Prices, papers, sizes and shipping** are set in one place only: `SHOP` at the top of `worker/shop.js`. The site reads them from `https://forms.yoso.one/prices`. The Worker works out every amount itself at checkout, so prices can't be changed in a browser. After changing them: `npx wrangler deploy` in `worker/`.
- **A retired photograph can't be bought:** the Worker checks each frame against `assets/works.js` on the live site. Remove a frame there and it leaves the shop too.
- **Orders:** when a payment completes, Stripe tells the Worker (`/stripe-webhook`), which emails the order to yosotattoo@gmail.com with the frames, sizes, paper, border, quantities, address and a link to the payment in Stripe. Replying to that email writes to the buyer. Stripe emails the buyer's receipt.
- **Secrets** (never in this repo), set in `worker/` with `npx wrangler secret put`: `STRIPE_SECRET_KEY` (sk_test_… for testing, sk_live_… to go live) and `STRIPE_WEBHOOK_SECRET` (whsec_… from the webhook endpoint in Stripe, listening for `checkout.session.completed` at `https://forms.yoso.one/stripe-webhook`). Test mode and live mode each have their own keys and their own webhook endpoint.
- **Shop terms** (特定商取引法に基づく表記) are the `#terms` panel in `full.html`. Gold text in square brackets is a placeholder for Yoso to fill in.

## Mailing list

The sign-up form asks for an email address first; pressing **Continue** shows a list of Yoso's newsletters (One, Yosokuro, Shinsei, River, On), with this site's own one already ticked. Each ticked box reaches Buttondown as a tag (`one`, `yosokuro`, `shinsei`, `river`, `on`), so to write to one newsletter's readers, send to that tag. The step is run by `assets/list-choice.js`, which is the same file on every site; without it the boxes simply show under the email field and the form still works. To add or rename a newsletter, change the boxes in every form, `NEWSLETTERS` in `check.py`, and this list, on every site.

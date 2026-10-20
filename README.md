# Yosokuro

**Yosokuro** is a lifelong black-and-white photography project by Yoso, documenting Japan's urban reality and the spirit of the Kami.

- **Live site:** <https://kuro.yoso.one>
- **RSS:** <https://kuro.yoso.one/feed.xml>

## Structure

- `index.html` — the whole site (photographs and profile)
- `img/full/` — 2400 px images for the full-screen viewer
- `img/thumb/` — 960 px images for the grid
- `feed.xml` — RSS feed, one item per photograph
- `CNAME` — custom domain for GitHub Pages

© Yoso. All photographs are copyright and may not be reused without permission.

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

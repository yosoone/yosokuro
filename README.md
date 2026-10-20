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

## Mailing list

The sign-up form asks for an email address first; pressing **Continue** shows a list of Yoso's newsletters (The Vault, Yosokuro, Shinsei, River, On), with this site's own one already ticked. Each ticked box reaches Buttondown as a tag (`one`, `yosokuro`, `shinsei`, `river`, `on`), so to write to one newsletter's readers, send to that tag. The step is run by `assets/list-choice.js`, which is the same file on every site; without it the boxes simply show under the email field and the form still works. To add or rename a newsletter, change the boxes in every form, `NEWSLETTERS` in `check.py`, and this list, on every site.

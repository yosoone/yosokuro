/* Visit counts for Yoso's sites, through GoatCounter (yoso.goatcounter.com).
 *
 * The same file is used on every site (assets/stats.js), loaded once per page with
 * <script src="assets/stats.js" defer></script>. No cookies and no personal data:
 * GoatCounter counts the page, the referring site, the browser, the screen size and
 * the country, and keeps nothing that identifies the reader.
 *
 * One dashboard serves all the sites, so every path starts with the site's name,
 * taken from its address: shinsei.yoso.one/works.html is counted as
 * 'shinsei/works.html'. On a one-page site that moves between sections with #
 * (add data-hash to the script tag), each section is counted as its own page.
 * A site that already set up GoatCounter itself (River) is left alone.
 */
(function () {
  "use strict";
  if (window.goatcounter) return;
  var host = location.hostname;
  if (!/\.yoso\.one$/.test(host)) return;           // not on localhost or previews
  var site = host.split(".")[0];
  var me = document.currentScript;
  var hash = me && me.hasAttribute("data-hash");
  var path = function () { return site + location.pathname + (hash ? (location.hash || "") : ""); };

  window.goatcounter = { no_onload: true };
  var s = document.createElement("script");
  s.async = true;
  s.src = "https://gc.zgo.at/count.js";
  s.setAttribute("data-goatcounter", "https://yoso.goatcounter.com/count");
  s.onload = function () {
    var count = function () {
      try { window.goatcounter.count({ path: path(), title: document.title }); } catch (e) {}
    };
    count();
    if (hash) window.addEventListener("hashchange", count);
  };
  document.head.appendChild(s);
})();

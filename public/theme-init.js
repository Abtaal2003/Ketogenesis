/* Set the theme BEFORE the page paints, so dark-mode visitors never see
   a white flash. Reads the saved choice if there is one, otherwise the
   system preference.

   This must be a same-origin <script src> rather than an inline <script>:
   the site's CSP (public/_headers) sets `script-src 'self'` with no
   `'unsafe-inline'`, so an inline block here would simply be blocked by
   the browser and never run — silently defeating the anti-flash logic
   it exists for. Keeping it as its own tiny file keeps the CSP strict
   while still running early, since <script src> without defer/async
   blocks rendering just like an inline block would. */
(function () {
  try {
    var saved = localStorage.getItem("theme");
    var dark = saved ? saved === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches;
    if (dark) document.documentElement.setAttribute("data-theme", "dark");
  } catch (e) {}
})();

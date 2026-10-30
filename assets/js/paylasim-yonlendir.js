/* /d/<slug> paylaşım bağlantısı → r2-arsiv-worker (GitHub Pages'te 404 sayfası bu betiği yükler; bkz. 404.md, 0123). */
(function () {
  var m = location.pathname.match(/^\/d\/([A-Za-z0-9-]{6,80})\/?$/);
  if (!m) return;
  var ek = /[?&]o=1\b/.test(location.search) ? "?o=1" : "";
  document.title = "Bağlantı açılıyor…";
  document.addEventListener("DOMContentLoaded", function () { var h = document.querySelector("main h1, h1"); if (h) h.textContent = "Bağlantı açılıyor…"; });
  location.replace("https://r2-arsiv-worker.aeymena.workers.dev/d/" + m[1].toLowerCase() + ek);
})();

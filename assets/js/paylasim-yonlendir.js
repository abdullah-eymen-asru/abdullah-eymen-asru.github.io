/* /d/<slug> paylaşım bağlantısı → r2-arsiv-worker bilgi sayfası (GitHub Pages'te 404 sayfası bu betiği yükler; bkz. 404.md, 0123/0124).
 * Statik sunucu dinamik yol bilmediği için adres 404 olarak gelir; burada "Sayfa bulunamadı" metni gösterilmez, kullanıcı doğrudan
 * dosya bilgi sayfasına (ad, boyut, tür, süre + İndir düğmesi) yönlendirilir. Yönlendirme engellenirse elle tıklanabilir bağlantı görünür. */
(function () {
  /* /m/<yazi>/<dosya>: yazı medyası (PDF, veri seti, her tür dosya) doğrudan Worker'a gider (0128) */
  var mm = location.pathname.match(/^\/m\/([a-z0-9][a-z0-9-]{0,119})\/([A-Za-z0-9][A-Za-z0-9._-]{0,150})$/);
  if (mm) { location.replace("https://r2-arsiv-worker.aeymena.workers.dev/m/" + mm[1] + "/" + encodeURIComponent(mm[2])); return; }
  /* Temiz adres: /<yazi-anahtari>/<dosya.uzanti> (örn. /china-turkiye-relations/rapor.pdf) → Worker /m/ (yalnızca uzantılı dosya adları) */
  var tm = location.pathname.match(/^\/([a-z0-9][a-z0-9-]{0,119})\/([A-Za-z0-9][A-Za-z0-9._-]{0,150}\.[A-Za-z0-9]{1,10})$/);
  if (tm) { location.replace("https://r2-arsiv-worker.aeymena.workers.dev/m/" + tm[1] + "/" + encodeURIComponent(tm[2])); return; }
  var m = location.pathname.match(/^\/d\/([A-Za-z0-9-]{6,80})\/?$/);
  if (!m) return;
  var ek = /[?&]o=1\b/.test(location.search) ? "?o=1" : "";
  var hedef = "https://r2-arsiv-worker.aeymena.workers.dev/d/" + m[1].toLowerCase() + ek;
  document.title = "Paylaşılan dosya açılıyor…";
  function metniDegistir() {
    var ana = document.querySelector("main") || document.body;
    if (!ana) return;
    var kok = ana.querySelector(".page-content, article, .post") || ana;
    var baslik = document.createElement("h1"); baslik.textContent = "Paylaşılan dosya açılıyor…";
    var aciklama = document.createElement("p"); aciklama.textContent = "Dosya bilgi sayfasına yönlendiriliyorsun. Otomatik açılmazsa aşağıdaki bağlantıyı kullan.";
    var a = document.createElement("a"); a.href = hedef; a.rel = "noopener nofollow"; a.textContent = "Dosya sayfasını aç";
    var p2 = document.createElement("p"); p2.append(a);
    kok.replaceChildren(baslik, aciklama, p2);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", metniDegistir); else metniDegistir();
  location.replace(hedef);
})();

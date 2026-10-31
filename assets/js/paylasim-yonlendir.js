/* Paylaşılan dosya adreslerini (GitHub Pages'te 404 olarak gelir) r2-arsiv-worker bilgi sayfasına yönlendirir.
 *   /d/<slug>                    → paylaşım bağlantısı (0123)
 *   /m/<yazi>/<dosya>            → yazı medyası (0128)
 *   /<yazi>/<dosya.uzanti>       → yazı medyası, temiz adres (örn. /china-turkiye-relations/rapor.pdf)
 * Statik sunucu dinamik yol bilmediği için adres 404 gelir; "Sayfa bulunamadı" metni GÖSTERİLMEZ: sayfa hemen "dosya açılıyor"a çevrilir ve
 * kullanıcı dosya bilgi sayfasına (ad, tür, boyut, tarih + İndir düğmesi) gider. Yönlendirme engellenirse elle tıklanabilir bağlantı kalır. */
(function () {
  var WORKER = "https://r2-arsiv-worker.aeymena.workers.dev";
  var yol = location.pathname, hedef = null, ek = /[?&]o=1\b/.test(location.search) ? "?o=1" : "";
  var mm = yol.match(/^\/m\/([a-z0-9][a-z0-9-]{0,119})\/([A-Za-z0-9][A-Za-z0-9._-]{0,150})$/);
  var tm = yol.match(/^\/([a-z0-9][a-z0-9-]{0,119})\/([A-Za-z0-9][A-Za-z0-9._-]{0,150}\.[A-Za-z0-9]{1,10})$/);
  var dm = yol.match(/^\/d\/([A-Za-z0-9-]{6,80})\/?$/);
  if (mm) hedef = WORKER + "/m/" + mm[1] + "/" + encodeURIComponent(mm[2]) + ek;
  else if (tm) hedef = WORKER + "/m/" + tm[1] + "/" + encodeURIComponent(tm[2]) + ek;
  else if (dm) hedef = WORKER + "/d/" + dm[1].toLowerCase() + ek;
  if (!hedef) return;
  document.title = "Paylaşılan dosya açılıyor…";
  function metniDegistir() {
    var ana = document.querySelector("main") || document.body; if (!ana) return;
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

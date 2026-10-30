/* /d/<slug> paylaşım bağlantısı → r2-arsiv-worker bilgi sayfası (GitHub Pages'te 404 sayfası bu betiği yükler; bkz. 404.md, 0123/0124).
 * Statik sunucu dinamik yol bilmediği için adres 404 olarak gelir; burada "Sayfa bulunamadı" metni gösterilmez, kullanıcı doğrudan
 * dosya bilgi sayfasına (ad, boyut, tür, süre + İndir düğmesi) yönlendirilir. Yönlendirme engellenirse elle tıklanabilir bağlantı görünür. */
(function () {
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

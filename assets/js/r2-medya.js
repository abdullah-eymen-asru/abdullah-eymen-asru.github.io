/*
 * assets/js/r2-medya.js — Yazı/proje sayfalarında R2 medyası (görsel) yükleyici. Adres biçimi: /m/<yazi-slug>/<dosya>
 * • Site sahibi Yetki/Sistem'den medyayı KAPATABİLİR (R2 kotası): kapalıyken görsel yerine açıklama gösterilir, R2'ye hiç istek gitmez.
 * • "Görseller otomatik yüklensin" kapalıysa her görsel "🖼️ Görseli göster" düğmesiyle (tıklayınca) yüklenir.
 * • Durum bilgisi Worker'dan tek istekle gelir ve 5 dk oturum önbelleğinde tutulur (sayfa başına ek istek yok).
 * • Çalışmayan JS'te bile PDF/dosya bağlantıları (/m/...) 404 sayfası ya da Pages fonksiyonu üzerinden Worker'a yönlenir.
 * CSP: harici dosya; inline stil/olay işleyici yok.
 */
(function () {
  var WORKER = "https://r2-arsiv-worker.aeymena.workers.dev";
  var ES = /^\/m\/[a-z0-9][a-z0-9-]{0,119}\/[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/;
  var imgs = Array.prototype.filter.call(document.querySelectorAll("img[src^='/m/']"), function (i) { return ES.test(i.getAttribute("src").split("?")[0]); });
  var baglar = Array.prototype.filter.call(document.querySelectorAll("a[href^='/m/']"), function (a) { return ES.test(a.getAttribute("href").split("?")[0]); });
  if (!imgs.length && !baglar.length) return;

  function durumOku() {
    try { var k = JSON.parse(sessionStorage.getItem("r2_medya_durum") || "null"); if (k && Date.now() - k.t < 300000) return Promise.resolve(k.v); } catch (e) { /* yoksay */ }
    return fetch(WORKER + "/medya-durum", { credentials: "omit", referrerPolicy: "no-referrer" }).then(function (r) { return r.ok ? r.json() : { acik: true, gorsel_otomatik: true }; })
      .then(function (v) { try { sessionStorage.setItem("r2_medya_durum", JSON.stringify({ t: Date.now(), v: v })); } catch (e) { /* yoksay */ } return v; })
      .catch(function () { return { acik: true, gorsel_otomatik: true }; });
  }
  function yukle(img, yol) { img.src = WORKER + yol; img.loading = "lazy"; img.decoding = "async"; img.referrerPolicy = "no-referrer"; }

  durumOku().then(function (d) {
    imgs.forEach(function (img) {
      var yol = img.getAttribute("src").split("?")[0], alt = img.getAttribute("alt") || "Görsel";
      if (!d.acik) {                                              // kapalı: R2'ye istek yok
        var p = document.createElement("p"); p.className = "r2-medya-kapali"; p.textContent = "🖼️ " + alt + " — görsel şu an gösterilmiyor."; img.replaceWith(p); return;
      }
      if (d.gorsel_otomatik === false) {                          // tıklayınca yükle
        var b = document.createElement("button"); b.type = "button"; b.className = "r2-medya-goster"; b.textContent = "🖼️ Görseli göster: " + alt;
        b.addEventListener("click", function () { var yeni = document.createElement("img"); yeni.alt = alt; yukle(yeni, yol); b.replaceWith(yeni); });
        img.replaceWith(b); return;
      }
      yukle(img, yol);
    });
    baglar.forEach(function (a) { if (!d.acik) { a.classList.add("r2-medya-kapali-baglanti"); a.setAttribute("aria-disabled", "true"); a.title = "Medya şu an kapalı"; a.addEventListener("click", function (e) { e.preventDefault(); }); } });
  });
})();

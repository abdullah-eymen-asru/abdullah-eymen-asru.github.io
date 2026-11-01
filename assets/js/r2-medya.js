/*
 * assets/js/r2-medya.js — Yazı/proje sayfalarında R2 medyasını GÖSTERİR (her format).
 *   • Görsel (png/jpg/gif/webp/avif)  → <figure> içinde; konum (sola/sağa/ortala/tam), boyut (%25-%100) ve altyazı editördeki seçimlere göre
 *   • PDF                             → sayfa içinde okuyucu (iframe; "Burada oku" düğmesiyle) + indirme/aç bağlantısı
 *   • Ses (mp3, m4a, wav, ogg, flac…) → <audio controls>   • Video (mp4, webm, mov) → <video controls>
 *   • Diğer her dosya (docx, xlsx, zip, csv…) → indirme kartı (bilgi sayfası + İndir)
 * İşaretleme (editör üretir): <figure/div data-r2="<yazi-anahtari>/<dosya>" data-tur="gorsel|pdf|ses|video|dosya" …>. Eski biçim ![](/m/…) de desteklenir.
 * Site sahibi medyayı KAPATIRSA hiçbir istek R2'ye gitmez; "görseller otomatik" kapalıysa görsel “Görseli göster” ile tıklanınca yüklenir.
 * Durum Worker'dan tek istekle gelir, 5 dk oturum önbelleğinde tutulur. CSP: harici dosya; inline stil/olay işleyici yok.
 */
(function () {
  var WORKER = "https://r2-arsiv-worker.aeymena.workers.dev";
  var YOL = /^[a-z0-9][a-z0-9-]{0,119}\/[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/;
  var bloklar = Array.prototype.slice.call(document.querySelectorAll("[data-r2]")).filter(function (e) { return YOL.test(e.getAttribute("data-r2") || ""); });
  var eskiGorsel = Array.prototype.filter.call(document.querySelectorAll("img[src^='/m/']"), function (i) { return YOL.test(i.getAttribute("src").slice(3).split("?")[0]); });
  var eskiBag = Array.prototype.filter.call(document.querySelectorAll("a[href^='/m/']"), function (a) { return YOL.test(a.getAttribute("href").slice(3).split("?")[0]); });
  if (!bloklar.length && !eskiGorsel.length && !eskiBag.length) return;

  function durumOku() {
    try { var k = JSON.parse(sessionStorage.getItem("r2_medya_durum") || "null"); if (k && Date.now() - k.t < 300000) return Promise.resolve(k.v); } catch (e) { /* yoksay */ }
    return fetch(WORKER + "/medya-durum", { credentials: "omit", referrerPolicy: "no-referrer" }).then(function (r) { return r.ok ? r.json() : { acik: true, gorsel_otomatik: true }; })
      .then(function (v) { try { sessionStorage.setItem("r2_medya_durum", JSON.stringify({ t: Date.now(), v: v })); } catch (e) { /* yoksay */ } return v; })
      .catch(function () { return { acik: true, gorsel_otomatik: true }; });
  }
  var adres = function (yol, ek) { return WORKER + "/m/" + yol.split("/").map(encodeURIComponent).join("/") + (ek || ""); };
  var ad = function (yol) { return yol.split("/")[1]; };
  function yap(etiket, sinif, metin) { var e = document.createElement(etiket); if (sinif) e.className = sinif; if (metin != null) e.textContent = metin; return e; }
  function bagla(yol, metin, sinif, ek) { var a = yap("a", sinif, metin); a.href = adres(yol, ek); a.target = "_blank"; a.rel = "noopener nofollow"; return a; }
  function kapaliNotu(simge, baslik) { return yap("p", "r2-medya-kapali", simge + " " + baslik + " — medya şu an gösterilmiyor."); }
  function dugme(metin, tikla) { var b = yap("button", "r2-medya-goster", metin); b.type = "button"; b.addEventListener("click", tikla); return b; }

  function gorsel(blok, yol, d) {
    var img = blok.querySelector("img") || blok.appendChild(yap("img")), alt = img.getAttribute("alt") || ad(yol);
    var yukle = function () { img.src = adres(yol); img.loading = "lazy"; img.decoding = "async"; img.referrerPolicy = "no-referrer"; };
    if (d.gorsel_otomatik === false) { var b = dugme("🖼️ Görseli göster: " + alt, function () { b.remove(); img.hidden = false; yukle(); }); img.hidden = true; img.removeAttribute("src"); blok.insertBefore(b, img); } else yukle();
  }
  function pdf(blok, yol) {
    var baslik = blok.getAttribute("data-baslik") || ad(yol), yuk = parseInt(blok.getAttribute("data-yukseklik"), 10) || 600, gom = blok.getAttribute("data-gom") !== "0";
    blok.replaceChildren(); blok.classList.add("r2-pdf");
    var ust = yap("div", "r2-kart-ust"); ust.append(yap("span", "r2-kart-ikon", "📕"), yap("strong", "r2-kart-ad", baslik));
    var eylem = yap("div", "r2-kart-eylem"), alan = yap("div", "r2-pdf-alan");
    if (gom) eylem.append(dugme("📖 Burada oku", function () {
      if (alan.firstChild) { alan.replaceChildren(); return; }
      var f = yap("iframe", "r2-pdf-cerceve"); f.src = adres(yol, "?o=1"); f.title = baslik; f.loading = "lazy"; f.setAttribute("data-yuk", String(yuk)); f.referrerPolicy = "no-referrer"; f.classList.add(yuk >= 800 ? "r2-yuk-800" : "r2-yuk-600"); alan.append(f);
    }));
    eylem.append(bagla(yol, "⬇ İndir / yeni sekmede aç", "r2-kart-btn"));
    blok.append(ust, eylem, alan);
  }
  function oynatici(blok, yol, tur) {
    var baslik = blok.getAttribute("data-baslik") || ad(yol), m = document.createElement(tur === "ses" ? "audio" : "video");
    m.controls = true; m.preload = "none"; m.src = adres(yol); if (tur === "video") { m.setAttribute("playsinline", ""); m.classList.add("r2-video-oynatici"); } else m.classList.add("r2-ses-oynatici");
    blok.replaceChildren(); blok.classList.add("r2-oynatici"); var ust = yap("div", "r2-kart-ust"); ust.append(yap("span", "r2-kart-ikon", tur === "ses" ? "🎧" : "🎬"), yap("strong", "r2-kart-ad", baslik));
    blok.append(ust, m, bagla(yol, "⬇ İndir", "r2-kart-btn"));
  }
  function dosya(blok, yol) {
    var baslik = blok.getAttribute("data-baslik") || ad(yol); blok.replaceChildren(); blok.classList.add("r2-dosya");
    var ust = yap("div", "r2-kart-ust"); ust.append(yap("span", "r2-kart-ikon", "📄"), yap("strong", "r2-kart-ad", baslik));
    blok.append(ust, bagla(yol, "⬇ İndir", "r2-kart-btn"));
  }

  durumOku().then(function (d) {
    bloklar.forEach(function (blok) {
      var yol = blok.getAttribute("data-r2"), tur = blok.getAttribute("data-tur") || "dosya", baslik = blok.getAttribute("data-baslik") || ad(yol);
      if (!d.acik) { var n = kapaliNotu(tur === "gorsel" ? "🖼️" : "📎", baslik); blok.replaceChildren(n); return; }
      if (tur === "gorsel") gorsel(blok, yol, d); else if (tur === "pdf") pdf(blok, yol); else if (tur === "ses" || tur === "video") oynatici(blok, yol, tur); else dosya(blok, yol);
    });
    eskiGorsel.forEach(function (img) {
      var yol = img.getAttribute("src").slice(3).split("?")[0], alt = img.getAttribute("alt") || "Görsel";
      if (!d.acik) { img.replaceWith(kapaliNotu("🖼️", alt)); return; }
      if (d.gorsel_otomatik === false) { var b = dugme("🖼️ Görseli göster: " + alt, function () { var y = yap("img"); y.alt = alt; y.src = adres(yol); y.loading = "lazy"; b.replaceWith(y); }); img.replaceWith(b); return; }
      img.src = adres(yol); img.loading = "lazy"; img.decoding = "async"; img.referrerPolicy = "no-referrer";
    });
    eskiBag.forEach(function (a) { if (!d.acik) { a.classList.add("r2-medya-kapali-baglanti"); a.setAttribute("aria-disabled", "true"); a.title = "Medya şu an kapalı"; a.addEventListener("click", function (e) { e.preventDefault(); }); } });
  });
})();

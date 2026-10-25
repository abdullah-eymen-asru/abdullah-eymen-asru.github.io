/*
 * assets/js/core/surum-kontrol.js — SÜRÜM KONTROLÜ + "HER GEÇİŞTE GÜNCEL KOD" (klasik script, defer; bağımlılık yok).
 * -----------------------------------------------------------------------------------------------------------------
 * SORUN: GitHub Pages statik dosyalara 10 dk tarayıcı önbelleği koyar ve bunu değiştirmene izin vermez. Panel tek sayfalık
 *        (SPA) olduğundan sekmeler arası geçişte sayfa hiç yeniden yüklenmez → eski kabuk/eski modül, tarayıcıyı elle
 *        yenileyene kadar kalıyordu.
 * ÇÖZÜM (iki katman, ikisi de oturumu ETKİLEMEZ — çıkış yaptırmaz):
 *   1) /sw-bildirim.js (Service Worker) aynı kaynaklı sayfa/JS/CSS isteklerini HER SEFERİNDE sunucuyla doğrular (ETag → değişmediyse
 *      304, yani neredeyse bedava). Böylece bir sayfaya/modüle her gidişte en yeni dosya gelir; 10 dk önbellek artık eski kod vermez.
 *   2) Bu betik: yüklenen sayfanın derleme kimliğini (<meta name="aea-build">) /surum.json (no-store) ile karşılaştırır. Yeni
 *      sürüm varsa window.aeaYeniSurumVarMi() true döner; panel (dashboard.js) sekme geçişinde bunu görür, kaydedilmemiş iş
 *      sorusundan sonra sayfayı kendisi yeniler. Açık sayfa dışı (herkese açık) sayfalarda bir sonraki gezinti zaten yeni dosyayı alır.
 * Kontrol sıklığı: sekme öne gelince, 5 dk'da bir (gizli sekmede değil) ve panelde geçişte en çok 30 sn'de bir. Ağ yoksa sessiz.
 */
(function () {
  "use strict";
  var meta = document.querySelector('meta[name="aea-build"]');
  var YUKLU = meta ? meta.getAttribute("content") : "";
  var yeni = false, sonKontrol = 0, ucusta = null;

  /** Sunucudaki güncel derleme kimliğini sorar; yeni sürüm varsa true. Hata/ağ yok → false (asla yanlış alarm yok). */
  function kontrolEt(zorla) {
    if (!YUKLU || YUKLU.indexOf("{{") !== -1) return Promise.resolve(false);   // yerel (derlenmemiş) ortam
    if (yeni) return Promise.resolve(true);
    if (!zorla && Date.now() - sonKontrol < 30000) return Promise.resolve(false);
    if (ucusta) return ucusta;
    sonKontrol = Date.now();
    var k = new AbortController(), z = setTimeout(function () { k.abort(); }, 4000);
    ucusta = fetch("/surum.json?_=" + Date.now(), { cache: "no-store", credentials: "omit", signal: k.signal })
      .then(function (r) { clearTimeout(z); return r.ok ? r.json() : null; })
      .then(function (j) {
        if (j && typeof j.build === "string" && /^\d{8,14}$/.test(j.build) && j.build !== YUKLU && j.build > YUKLU) {
          yeni = true;
          try { window.dispatchEvent(new CustomEvent("aea:yeni-surum", { detail: { yukluOlan: YUKLU, yeni: j.build } })); } catch (e) { /* yok say */ }
        }
        return yeni;
      })
      .catch(function () { clearTimeout(z); return false; })
      .then(function (v) { ucusta = null; return v; });
    return ucusta;
  }

  window.aeaSurumKontrol = kontrolEt;
  window.aeaYeniSurumVarMi = function () { return yeni; };

  // Service Worker: güncel kod doğrulaması (kayıt tekrarlı çağrıda zararsız; mesajlaşma bildirimleri aynı dosyayı kullanır).
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    window.addEventListener("load", function () {
      try { navigator.serviceWorker.register("/sw-bildirim.js", { scope: "/" }).catch(function () { /* SW olmadan da çalışır */ }); } catch (e) { /* yok say */ }
    });
  }

  document.addEventListener("visibilitychange", function () { if (!document.hidden) kontrolEt(false); });
  setInterval(function () { if (!document.hidden) kontrolEt(true); }, 5 * 60 * 1000);
  window.addEventListener("online", function () { kontrolEt(true); });
})();

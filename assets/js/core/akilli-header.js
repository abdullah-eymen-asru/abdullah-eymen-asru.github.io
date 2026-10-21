/*
 * assets/js/core/akilli-header.js — AKILLI, KAYDIRMAYA DUYARLI ÜST MENÜ
 * Aşağı kaydırırken üst çubuk yukarı doğru yumuşakça gizlenir (okuma alanı genişler); YUKARI doğru en ufak harekette anında geri gelir.
 * Masaüstü ve mobilde aynı mantık. Kural dışı durumlar (menü gizlenmez):
 *   • sayfanın en üstüne yakınken (< 80px), • mobil menü paneli açıkken, • odak/imleç menü içindeyken (klavye + ekran okuyucu),
 *   • iOS "lastik bandı" taşmasında (scrollY < 0 ya da sayfa sonunu aşan), • kullanıcı hareket azaltmayı seçtiyse animasyon yok (yine gizler/gösterir).
 * Gizliyken html'e "header-gizli" sınıfı eklenir: dashboard'un yapışkan yan menü/üst şeridi (--dash-header-h) o boşluğu kendiliğinden kullanır.
 * Sıfır bağımlılık, pasif dinleyici, requestAnimationFrame ile en çok kare başına 1 iş. Bkz. style.css "AKILLI ÜST MENÜ".
 */
(function () {
  "use strict";
  var GIZLE_ESIGI = 80;      // bu kadar aşağı inmeden gizleme
  var ASAGI_TOLERANS = 6;    // gizlemek için gereken ardışık aşağı kaydırma (px) — titreşimi eler
  var YUKARI_TOLERANS = 2;   // göstermek için gereken yukarı hareket (px) — "en ufak hareket"

  function kur() {
    var header = document.querySelector(".site-header");
    if (!header) return;
    var kok = document.documentElement;
    var sonY = window.scrollY || 0;
    var birikim = 0;           // yön değişince sıfırlanan birikmiş hareket
    var bekliyor = false;

    function gizli() { return header.classList.contains("site-header--gizli"); }
    function ayarla(gizle) {
      if (gizle === gizli()) return;
      header.classList.toggle("site-header--gizli", gizle);
      kok.classList.toggle("header-gizli", gizle);
    }
    function menuMesgul() {
      var d = document.getElementById("nav-toggle");
      if (d && d.getAttribute("aria-expanded") === "true") return true;       // mobil panel açık
      var a = document.activeElement;
      return !!(a && header.contains(a) && a !== document.body);               // odak menü içinde
    }

    function guncelle() {
      bekliyor = false;
      var maks = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      var y = window.scrollY || 0;
      if (y < 0 || y > maks + 1) { sonY = Math.min(Math.max(y, 0), maks); return; }          // lastik bandı taşması
      var fark = y - sonY;
      sonY = y;
      if (y < GIZLE_ESIGI || menuMesgul()) { birikim = 0; ayarla(false); return; }
      if (fark === 0) return;
      if ((fark > 0) !== (birikim > 0)) birikim = 0;                                          // yön değişti
      birikim += fark;
      if (birikim > ASAGI_TOLERANS) ayarla(true);
      else if (birikim < -YUKARI_TOLERANS) ayarla(false);
    }

    window.addEventListener("scroll", function () {
      if (!bekliyor) { bekliyor = true; window.requestAnimationFrame(guncelle); }
    }, { passive: true });
    // Klavye/ekran okuyucu: menüye odaklanınca (Tab) çubuk geri gelir.
    header.addEventListener("focusin", function () { ayarla(false); });
    // Sayfa içi çapa atlamasında ve yeniden boyutlandırmada durumu tazele.
    window.addEventListener("hashchange", function () { ayarla(false); });
    window.addEventListener("resize", function () { ayarla(false); }, { passive: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", kur);
  else kur();
})();

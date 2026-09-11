/*
 * assets/js/core/mobil-nav.js
 *
 * Mobil hamburger menü düğmesi (#nav-toggle) ile tam ekran açılır panelin
 * (#mobile-nav-panel) aç/kapa mantığı. Bkz. _layouts/default.html ve
 * assets/style.css'teki ".mobile-nav-panel" / ".nav-toggle" kurallarının
 * başındaki notlar — panel BİLEREK position:fixed, bu dosyanın kendisi o
 * kararı etkilemiyor, sadece görünürlüğü/etkileşimi yönetiyor.
 *
 * Bu script her sayfada <head>'de defer ile yüklenir (site-islemleri.js
 * ile aynı desen) — panel/düğme sadece mobil genişlikte GÖRÜNÜR olsa da,
 * öğeler HER genişlikte DOM'da var olduğu için dinleyicileri koşulsuz
 * bağlıyoruz; CSS zaten masaüstünde düğmeyi/paneli gizliyor.
 */
(function () {
  function kur() {
    const toggleBtn = document.getElementById("nav-toggle");
    const panel = document.getElementById("mobile-nav-panel");
    if (!toggleBtn || !panel) return;

    const header = document.querySelector(".site-header");

    // Panelin üstten boşluğunu (padding-top), header'ın GERÇEK/güncel
    // yüksekliğine göre ayarlıyoruz — sabit bir piksel değeri (ör. 64px)
    // yazı boyutu/tema/ekran genişliğine göre header boyu değişirse
    // (ör. çok uzun bir site başlığı ikinci satıra düşerse) marka veya
    // hamburger'ın panel tarafından örtülmesine yol açabilirdi. Panel
    // her açıldığında ve pencere yeniden boyutlandığında yeniden ölçüyoruz.
    function ustBosluguAyarla() {
      if (!header) return;
      const yukseklik = header.getBoundingClientRect().height;
      panel.style.setProperty("--mobile-nav-top", yukseklik + "px");
    }

    function panelAc() {
      ustBosluguAyarla();
      panel.hidden = false;
      toggleBtn.setAttribute("aria-expanded", "true");
      toggleBtn.setAttribute("aria-label", "Menüyü kapat");
      // Panel açıkken arka plan (body) kaydırılamasın — kullanıcı panel
      // içinde kaydırırken kazara arkadaki sayfanın da kaymasını/panelin
      // "geride kalmış" hissi vermesini önler. position:fixed panel zaten
      // scroll pozisyonundan bağımsız ekranda sabit durur, ama body'nin
      // kendisi yine de scroll edilebilir kalırsa dokunmatik cihazlarda
      // arka plan içeriği panelin ARKASINDA kayabilir (görsel karışıklık).
      document.body.style.overflow = "hidden";
      window.addEventListener("resize", ustBosluguAyarla);
    }

    function panelKapat() {
      panel.hidden = true;
      toggleBtn.setAttribute("aria-expanded", "false");
      toggleBtn.setAttribute("aria-label", "Menüyü aç");
      document.body.style.overflow = "";
      window.removeEventListener("resize", ustBosluguAyarla);
    }

    toggleBtn.addEventListener("click", () => {
      if (panel.hidden) {
        panelAc();
      } else {
        panelKapat();
      }
    });

    // Panel içindeki bir linke tıklanınca (sayfa değişecek olsa bile)
    // paneli kapatıyoruz — geri/ileri tuşuyla ya da view-transition ile
    // aynı sayfaya dönülürse panel açık kalmış görünmesin diye.
    panel.addEventListener("click", (e) => {
      if (e.target.closest("a")) {
        panelKapat();
      }
    });

    // Escape ile kapat (klavye erişilebilirliği).
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !panel.hidden) {
        panelKapat();
        toggleBtn.focus();
      }
    });

    // Ekran mobil genişlikten masaüstü genişliğe büyütülürse (ör. tablet
    // döndürme, pencere yeniden boyutlandırma) panel açık kalmışsa
    // otomatik kapat — CSS zaten masaüstünde paneli gizler ama aria-
    // expanded/body scroll kilidini de tutarlı tutmak için.
    const genislikSorgusu = window.matchMedia("(min-width: 641px)");
    genislikSorgusu.addEventListener("change", (e) => {
      if (e.matches && !panel.hidden) panelKapat();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", kur);
  } else {
    kur();
  }
})();

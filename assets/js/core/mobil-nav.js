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
 *
 * KAPATMA YOLU ARTIK ÜÇ KATMANLI (BUG FİX): eskiden panelin TEK kapatma
 * yolu, dıştaki hamburger düğmesine (#nav-toggle) TEKRAR basmaktı. Panel
 * <header>'ın dışına taşındıktan sonra (bkz. default.html'deki BUG FİX
 * notu) hamburger, panel açıkken görsel olarak panelin ALTINDA/arkasında
 * kalıyordu — bazı mobil WebView'lerde (uygulama içi tarayıcılar) bu
 * düğmeye dokunmak mümkün olmuyordu, kullanıcının tek çaresi telefonun
 * "geri" tuşuna basıp SAYFADAN TAMAMEN ÇIKMAK oluyordu. Şimdi panelin
 * kendi İÇİNDE, her zaman erişilebilir bir "Kapat" düğmesi var
 * (#mobile-nav-kapat) — bu, dıştaki hamburger'a hiç bağımlı değil. Buna
 * ek olarak Escape tuşu ve panel dışına (varsa) tıklama da hâlâ çalışıyor
 * — üç yol da AYNI panelKapat() fonksiyonuna çıkıyor.
 */
(function () {
  function kur() {
    const toggleBtn = document.getElementById("nav-toggle");
    const panel = document.getElementById("mobile-nav-panel");
    const kapatBtn = document.getElementById("mobile-nav-kapat");
    if (!toggleBtn || !panel) return;

    // Panel açılmadan ÖNCE odağın hangi elemanda olduğunu saklıyoruz —
    // kapatınca odağı KULLANICININ AÇTIĞI yere (genelde hamburger'ın
    // kendisi) geri veriyoruz. Bu, ekran okuyucu/klavye kullanıcısının
    // "menüyü kapattım, şimdi sayfada neredeyim?" sorusuna kesin bir
    // cevap veriyor — panel kapanınca odak sayfanın en başına ya da
    // rastgele bir yere sıçramıyor.
    let acilmadanOncekiOdak = null;

    function panelAc() {
      acilmadanOncekiOdak = document.activeElement;
      panel.hidden = false;
      toggleBtn.setAttribute("aria-expanded", "true");
      // Panel açıkken arka plan (body) kaydırılamasın — kullanıcı panel
      // içinde kaydırırken kazara arkadaki sayfanın da kaymasını/panelin
      // "geride kalmış" hissi vermesini önler.
      document.body.style.overflow = "hidden";
      // ERİŞİLEBİLİRLİK: panel bir "dialog" (bkz. default.html'deki
      // role="dialog" aria-modal="true") olduğu için, açılır açılmaz
      // odağı panelin İÇİNE (Kapat düğmesine) taşımak standart pratiktir
      // — ekran okuyucu kullanıcısı artık "yeni bir pencere açıldı, işte
      // içeriği" akışını takip edebiliyor, odak sayfanın gerisinde
      // kalmıyor. setTimeout(…, 0): panel "hidden" durumundan yeni
      // çıktığı için bazı tarayıcılar aynı event-loop turunda focus()
      // çağrısını yok sayabiliyor, bir sonraki turda çalıştırmak bunu
      // güvenilir hale getiriyor.
      setTimeout(() => {
        (kapatBtn || panel).focus();
      }, 0);
    }

    function panelKapat() {
      panel.hidden = true;
      toggleBtn.setAttribute("aria-expanded", "false");
      document.body.style.overflow = "";
      // Odağı, paneli açan yere (ya da artık DOM'da yoksa hamburger'a)
      // geri veriyoruz.
      const geriDonulecekOdak =
        acilmadanOncekiOdak && document.body.contains(acilmadanOncekiOdak)
          ? acilmadanOncekiOdak
          : toggleBtn;
      geriDonulecekOdak.focus();
    }

    // KAPATMA YOLU 1: dıştaki hamburger düğmesi — bazı WebView'lerde
    // panel açıkken erişilemese de, KAPALI durumda (paneli AÇMAK için)
    // her zaman kullanılabilir olmalı; panel zaten açıksa (ör. masaüstü
    // genişliğinde ya da hamburger'a yine de ulaşılabiliyorsa) tekrar
    // basmak da kapatsın diye toggle mantığı korunuyor.
    toggleBtn.addEventListener("click", () => {
      if (panel.hidden) {
        panelAc();
      } else {
        panelKapat();
      }
    });

    // KAPATMA YOLU 2 (ASIL/GÜVENİLİR YOL): panelin kendi İÇİNDEKİ "Kapat"
    // düğmesi — bkz. dosya başındaki BUG FİX notu, bu artık kullanıcının
    // birincil kapatma yöntemi.
    if (kapatBtn) {
      kapatBtn.addEventListener("click", panelKapat);
    }

    // Panel içindeki bir linke tıklanınca (sayfa değişecek olsa bile)
    // paneli kapatıyoruz — geri/ileri tuşuyla ya da view-transition ile
    // aynı sayfaya dönülürse panel açık kalmış görünmesin diye.
    panel.addEventListener("click", (e) => {
      if (e.target.closest("a")) {
        panelKapat();
      }
    });

    // KAPATMA YOLU 3: Escape tuşu (klavye erişilebilirliği).
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !panel.hidden) {
        panelKapat();
      }
    });

    // ODAK TUZAĞI (FOCUS TRAP): panel role="dialog" aria-modal="true"
    // taşıdığı için (bkz. default.html), Tab tuşuyla dolaşımın panelin
    // İÇİNDE kalması beklenir — aksi halde klavye kullanıcısı Tab'a
    // basa basa panelin ARKASINDAKİ (görünmeyen/kapalı) sayfa içeriğine
    // geçebilir, ki bu hem kafa karıştırıcı hem de "modal" olma amacına
    // aykırıdır. Panel içindeki odaklanabilir TÜM elemanları (linkler +
    // Kapat düğmesi + varsa hesap menüsü butonu) topluyoruz; Tab son
    // elemandaysa başa, Shift+Tab ilk elemandaysa sona sarıyoruz.
    panel.addEventListener("keydown", (e) => {
      if (e.key !== "Tab") return;
      const odaklanabilirler = Array.from(
        panel.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')
      ).filter((el) => el.offsetParent !== null); // gizli (display:none) olanları hariç tut
      if (odaklanabilirler.length === 0) return;

      const ilk = odaklanabilirler[0];
      const son = odaklanabilirler[odaklanabilirler.length - 1];

      if (e.shiftKey && document.activeElement === ilk) {
        e.preventDefault();
        son.focus();
      } else if (!e.shiftKey && document.activeElement === son) {
        e.preventDefault();
        ilk.focus();
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

/*
 * assets/js/okuma-araclari/secim-baloncugu.js
 *
 * Yazı gövdesi (.project-body) içinde fareyle/dokunarak metin seçildiğinde
 * beliren küçük baloncuk: "Kopyala" (tırnak içinde, navigator.clipboard.
 * writeText) ve "X'te Paylaş" (tweet intent linki, yeni sekmede açılır).
 *
 * CSP UYUMU: onclick YOK — tüm olaylar addEventListener ile bağlanıyor.
 * Konumlandırma inline style="" ATTRIBUTE'U ile DEĞİL, CSS custom
 * property'leriyle (--baloncuk-sol / --baloncuk-ust) yapılıyor;
 * .style.setProperty() (bkz. okuma-ilerleme-cubugu.js'teki aynı gerekçe)
 * inline style attribute'u SAYILMAZ.
 *
 * SADECE .project-body İÇİNDEKİ seçimlerde tetiklenir — sayfanın geri
 * kalanında (nav, menü, meta bilgiler, atıf kutusu vb.) normal tarayıcı
 * seçim davranışı bozulmaz.
 */
(function () {
  const GOVDE_SECICI = ".project-body";
  const MAKS_ALINTI_UZUNLUK = 280; // çok uzun seçimlerde tweet linki taşmasın diye kırpılır

  function kurulumYap() {
    const govdeler = document.querySelectorAll(GOVDE_SECICI);
    if (!govdeler.length) return;

    const baloncuk = document.createElement("div");
    baloncuk.className = "secim-baloncugu";
    baloncuk.hidden = true;

    const kopyalaBtn = document.createElement("button");
    kopyalaBtn.type = "button";
    kopyalaBtn.className = "secim-baloncugu-btn";
    kopyalaBtn.textContent = "❝ Kopyala";

    const paylasBtn = document.createElement("a");
    paylasBtn.className = "secim-baloncugu-btn";
    paylasBtn.target = "_blank";
    paylasBtn.rel = "noopener noreferrer";
    paylasBtn.textContent = "𝕏 Paylaş";

    baloncuk.appendChild(kopyalaBtn);
    baloncuk.appendChild(paylasBtn);
    document.body.appendChild(baloncuk);

    let mevcutSecim = "";
    let gizlemeZamanlayici = null;

    function baloncuguGizle() {
      baloncuk.hidden = true;
      mevcutSecim = "";
    }

    function govdeIcindeMi(node) {
      return Array.from(govdeler).some((el) => el.contains(node));
    }

    function secimDegistiginde() {
      const secim = window.getSelection();
      const metin = secim ? secim.toString().trim() : "";

      if (!metin || !secim.rangeCount) {
        baloncuguGizle();
        return;
      }

      const aralik = secim.getRangeAt(0);
      // Seçimin (en azından başlangıç ucunun) yazı gövdesinin içinde
      // olduğundan emin ol — sayfanın başka bir yerinde seçim yapılırsa
      // baloncuk hiç görünmesin.
      if (!govdeIcindeMi(aralik.startContainer)) {
        baloncuguGizle();
        return;
      }

      mevcutSecim = metin;

      const dikdortgen = aralik.getBoundingClientRect();
      if (!dikdortgen || (dikdortgen.width === 0 && dikdortgen.height === 0)) {
        baloncuguGizle();
        return;
      }

      const kaydirmaY = window.scrollY || document.documentElement.scrollTop || 0;
      const kaydirmaX = window.scrollX || document.documentElement.scrollLeft || 0;
      const ust = dikdortgen.top + kaydirmaY - 44; // baloncuk seçimin biraz üstünde
      const sol = dikdortgen.left + kaydirmaX + dikdortgen.width / 2;

      baloncuk.style.setProperty("--baloncuk-ust", `${Math.max(8, ust)}px`);
      baloncuk.style.setProperty("--baloncuk-sol", `${sol}px`);

      const tweetMetni = metin.length > MAKS_ALINTI_UZUNLUK ? `${metin.slice(0, MAKS_ALINTI_UZUNLUK - 1)}…` : metin;
      paylasBtn.href = `https://twitter.com/intent/tweet?text=${encodeURIComponent(`"${tweetMetni}"`)}&url=${encodeURIComponent(
        window.location.href
      )}`;

      baloncuk.hidden = false;
    }

    function gecikmeliKontrolEt() {
      // "selectionchange" seçim SIRASINDA sürekli tetiklenir (fare hâlâ
      // basılıyken de) — kısa bir gecikmeyle kontrol ediyoruz, aksi halde
      // seçim tam bitmeden baloncuk yanlış konumda titreşerek belirebilir.
      if (gizlemeZamanlayici) clearTimeout(gizlemeZamanlayici);
      gizlemeZamanlayici = setTimeout(secimDegistiginde, 60);
    }

    document.addEventListener("selectionchange", gecikmeliKontrolEt);

    kopyalaBtn.addEventListener("click", () => {
      if (!mevcutSecim) return;
      const tirnakli = `"${mevcutSecim}"`;

      function geriBildirimGoster(basarili) {
        const eskiMetin = kopyalaBtn.textContent;
        kopyalaBtn.textContent = basarili ? "✓ Kopyalandı" : "Kopyalanamadı";
        setTimeout(() => {
          kopyalaBtn.textContent = eskiMetin;
        }, 1400);
      }

      // WEBVIEW UYUMLULUĞU: navigator.clipboard bazı WebView'lerde hiç
      // tanımlı olmayabilir/reddedebilir (bkz. _includes/share.html'deki
      // aynı desen) — bu durumda kullanıcıya "kopyalanamadı" bildiriliyor,
      // sessizce başarısız olunmuyor.
      if (!navigator.clipboard || !navigator.clipboard.writeText) {
        geriBildirimGoster(false);
        return;
      }
      navigator.clipboard
        .writeText(tirnakli)
        .then(() => geriBildirimGoster(true))
        .catch(() => geriBildirimGoster(false));
    });

    // Sayfa kaydırılırken baloncuk seçimin üstünde asılı kalmasın diye
    // gizlenir; seçim hâlâ geçerliyse "selectionchange" yeniden tetiklenip
    // konumu güncelleyecektir.
    window.addEventListener(
      "scroll",
      () => {
        if (!baloncuk.hidden) baloncuguGizle();
      },
      { passive: true }
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", kurulumYap);
  } else {
    kurulumYap();
  }
})();

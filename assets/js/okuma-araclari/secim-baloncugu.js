/*
 * assets/js/okuma-araclari/secim-baloncugu.js
 *
 * Yazı gövdesi (.project-body) içinde fareyle/dokunarak metin seçildiğinde
 * beliren küçük baloncuk: SADECE "❝ Kopyala" (tırnak içinde,
 * navigator.clipboard.writeText). Paylaşma işlevi BİLEREK burada YOK —
 * kopyalanan alıntı sessionStorage'a yazılıp sayfanın en altındaki
 * _includes/share.html paylaşım kutusuna aktarılıyor; kullanıcı hangi
 * platformda paylaşacağını orada, normal paylaş butonlarından seçiyor.
 * Bu, önceki sürümdeki "baloncuktan direkt X'e paylaş" tasarımının YERİNE
 * geçiyor (kullanıcı geri bildirimi: baloncuk ekranda yanlış konumda
 * kalıyordu ve kaybolmuyordu).
 *
 * KONUMLANDIRMA DÜZELTMESİ: önceki sürüm position:absolute + sayfa
 * kaydırma ofseti (scrollY/scrollX) kullanıyordu — bu, sayfadaki bazı
 * kapsayıcıların (ör. transform/filter uygulanan ata elementler, burada
 * .content/.wrap) yeni bir "containing block" oluşturması durumunda
 * absolute konumlamayı o kapsayıcıya göre hesaplatıp baloncuğu ekranın
 * sol üst köşesine yapıştırabiliyordu. Bunun yerine position:fixed +
 * getBoundingClientRect()'in DOĞRUDAN döndürdüğü (kaydırma ofseti
 * EKLENMEMİŞ) viewport-relative koordinatlar kullanılıyor — fixed
 * elementler HER ZAMAN viewport'a göre konumlanır, ara kapsayıcılardan
 * etkilenmez (position/transform olmayan normal bir sayfada bu absolute
 * ile aynı sonucu verirdi, ama etkilenen durumlarda da doğru çalışır).
 *
 * GÜVENİLİR GİZLENME: önceki sürüm sadece "selectionchange" olayına
 * güveniyordu — bazı tarayıcılarda (özellikle dokunmatik cihazlarda)
 * seçim boşaltıldığında bu olay her zaman GÜVENİLİR şekilde tetiklenmez.
 * Bu sürüm EK olarak: (1) baloncuğun dışında herhangi bir yere
 * tıklanınca/dokununca, (2) sayfa kaydırılınca, (3) Esc tuşuna basılınca
 * baloncuğu kapatıyor — böylece "ekranda takılı kalma" ihtimali pratikte
 * ortadan kalkıyor.
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
  const MAKS_ALINTI_UZUNLUK = 600; // aşırı uzun paragraf seçimlerinde bile paylaşım linkleri makul kalsın diye üst sınır

  function alintiAnahtariUret() {
    return "paylas-alinti:" + window.location.pathname;
  }

  /** Kopyalanan alıntıyı, sayfa sonundaki paylaş kutusunun okuyacağı biçimde saklar. */
  function alintiyiKaydet(metin) {
    try {
      sessionStorage.setItem(alintiAnahtariUret(), JSON.stringify({ metin, zaman: Date.now() }));
      document.dispatchEvent(new CustomEvent("secim-alinti-guncellendi"));
    } catch (e) {
      // sessionStorage kapalı/dolu olabilir (ör. gizli sekme kısıtları) —
      // sessizce yok say, kopyalama işlevi bundan bağımsız zaten çalıştı.
    }
  }

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

    baloncuk.appendChild(kopyalaBtn);
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

      const dikdortgen = aralik.getBoundingClientRect();
      if (!dikdortgen || (dikdortgen.width === 0 && dikdortgen.height === 0)) {
        baloncuguGizle();
        return;
      }

      mevcutSecim = metin.length > MAKS_ALINTI_UZUNLUK ? `${metin.slice(0, MAKS_ALINTI_UZUNLUK - 1)}…` : metin;

      // position:fixed KULLANILDIĞI İÇİN kaydırma ofseti EKLENMEZ —
      // getBoundingClientRect() zaten viewport'a göre (yani fixed'in
      // referans aldığı sisteme göre) koordinat döndürüyor.
      const BALONCUK_YUKSEKLIK_TAHMINI = 44;
      const KENAR_BOSLUGU = 8;
      let ust = dikdortgen.top - BALONCUK_YUKSEKLIK_TAHMINI;
      // Seçim ekranın en üstüne çok yakınsa (yukarı taşacaksa) baloncuğu
      // seçimin ÜSTÜNE değil ALTINA yerleştir.
      if (ust < KENAR_BOSLUGU) {
        ust = dikdortgen.bottom + 10;
      }
      const sol = Math.min(
        Math.max(dikdortgen.left + dikdortgen.width / 2, 60),
        window.innerWidth - 60
      );

      baloncuk.style.setProperty("--baloncuk-ust", `${ust}px`);
      baloncuk.style.setProperty("--baloncuk-sol", `${sol}px`);
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
      const kopyalananMetin = mevcutSecim;

      function basariliOldu() {
        alintiyiKaydet(kopyalananMetin);
        kopyalaBtn.textContent = "✓ Kopyalandı";
        // Kısa bir onay sonrası baloncuk KENDİLİĞİNDEN kapanır — kullanıcı
        // ekranda asılı bir buton görmeye devam etmesin, işini bitirdi.
        setTimeout(baloncuguGizle, 700);
      }

      function basarisizOldu() {
        kopyalaBtn.textContent = "Kopyalanamadı";
        setTimeout(() => {
          kopyalaBtn.textContent = "❝ Kopyala";
        }, 1400);
      }

      // WEBVIEW UYUMLULUĞU: navigator.clipboard bazı WebView'lerde hiç
      // tanımlı olmayabilir/reddedebilir (bkz. _includes/share.html'deki
      // aynı desen) — bu durumda kullanıcıya "kopyalanamadı" bildiriliyor,
      // sessizce başarısız olunmuyor.
      if (!navigator.clipboard || !navigator.clipboard.writeText) {
        basarisizOldu();
        return;
      }
      navigator.clipboard.writeText(tirnakli).then(basariliOldu).catch(basarisizOldu);
    });

    // GÜVENİLİR GİZLENME — bkz. dosya başındaki gerekçe. Üç ek tetikleyici:
    window.addEventListener(
      "scroll",
      () => {
        if (!baloncuk.hidden) baloncuguGizle();
      },
      { passive: true }
    );

    document.addEventListener("pointerdown", (e) => {
      if (baloncuk.hidden) return;
      if (baloncuk.contains(e.target)) return; // butona tıklama işlemi kendi handler'ında yönetiliyor
      baloncuguGizle();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !baloncuk.hidden) baloncuguGizle();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", kurulumYap);
  } else {
    kurulumYap();
  }
})();

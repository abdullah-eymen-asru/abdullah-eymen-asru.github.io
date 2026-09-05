/*
 * assets/js/okuma-araclari/secim-baloncugu.js
 *
 * Yazı gövdesi (.project-body) içinde fareyle/dokunarak metin seçildiğinde
 * beliren küçük "❝ Kopyala" baloncuğu, ve kopyalama BAŞARILI olduğunda
 * ekranın ORTASINDA kısa süreliğine beliren, kendiliğinden kaybolan bir
 * bilgilendirme ("...aşağıdan paylaşabilirsin"). Paylaşma işlevi BİLEREK
 * baloncukta YOK — kopyalanan alıntı sessionStorage'a yazılıp sayfanın en
 * altındaki _includes/share.html paylaşım kutusuna aktarılıyor.
 *
 * ÜÇÜNCÜ SÜRÜM — önceki ikisinde yaşanan iki somut soruna karşı yeniden
 * yazıldı:
 *
 * 1) "Sol üstte kalıcı Kopyala" hayaleti: önceki sürüm baloncuğu tek bir
 *    DOM elementi olarak SÜREKLİ document.body'ye bağlı tutuyor, sadece
 *    `hidden` ile gösterip gizliyordu. `position: fixed` + `hidden`
 *    ikilisi, TARAYICI SEKME/PENCERE YENİDEN BOYUTLANDIĞINDA ya da
 *    `bfcache`'den (geri/ileri tuşu) geri gelindiğinde, `hidden` durumu
 *    korunsa bile bazı motorlarda son `--baloncuk-ust/--baloncuk-sol`
 *    DEĞERLERİ (0px'e sıfırlanmış CSS custom property) kalıcı hâle
 *    gelip, bir SONRAKİ `hidden = false` anında (ör. gecikmeli bir
 *    selectionchange geç tetiklendiğinde) baloncuğun konumu HENÜZ
 *    hesaplanmadan bir an için (0,0)'da (sol üst köşe) görünmesine yol
 *    açabiliyordu. KESİN ÇÖZÜM: baloncuk artık HER seçimde SIFIRDAN
 *    oluşturulup, gizlenirken DOM'dan TAMAMEN KALDIRILIYOR (remove()) —
 *    ortada "durum taşıyan" tek bir persistent element yok, bu yüzden
 *    hiçbir eski konum değeri bir sonraki gösterimde miras kalamaz.
 *
 * 2) Kopyalama onayının kaybolmaması: "✓ Kopyalandı" metni ESKİDEN
 *    baloncuğun KENDİ üzerinde gösteriliyordu (seçimin hemen üstünde) ve
 *    baloncuğu gizleyen setTimeout'un kendisi de sonradan gizleme
 *    zincirine karışıp bazen hiç tetiklenmeden kalabiliyordu. KESİN
 *    ÇÖZÜM: kopyalama başarılı olur olmaz (a) seçim baloncuğu ANINDA ve
 *    KOŞULSUZ kaldırılır, (b) TAMAMEN AYRI, ekranın ORTASINDA sabit
 *    duran, `pointer-events: none` (hiçbir tıklamayı/etkileşimi
 *    engellemeyen) bir toast elementi gösterilip 2.2 saniye sonra
 *    kendiliğinden kaldırılır. Toast'ın kendi ömrü baloncuktan bağımsız
 *    çalışır, bu yüzden baloncuğun durumu ne olursa olsun toast her
 *    zaman zamanında kaybolur.
 *
 * CSP UYUMU: onclick YOK — tüm olaylar addEventListener ile bağlanıyor.
 * Konumlandırma inline style="" ATTRIBUTE'U ile DEĞİL, CSS custom
 * property'leriyle (--baloncuk-sol / --baloncuk-ust) yapılıyor;
 * .style.setProperty() inline style attribute'u SAYILMAZ (bkz.
 * okuma-ilerleme-cubugu.js'teki aynı gerekçe).
 *
 * SADECE .project-body İÇİNDEKİ seçimlerde tetiklenir.
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

  /*
   * ORTA-EKRAN TOAST: kopyalama başarılı olduğunda çağrılır. Her çağrıda
   * YENİ bir element oluşturup DOM'a ekliyoruz ve kendi zamanlayıcısıyla
   * kaldırıyoruz — böylece art arda hızlı kopyalamalarda bile önceki
   * toast'ın zamanlayıcısı yenisini iptal edip yarım bırakamaz.
   */
  function ortaEkranToastGoster(mesaj) {
    const toast = document.createElement("div");
    toast.className = "secim-kopyalandi-toast";
    toast.textContent = mesaj;
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    document.body.appendChild(toast);

    // Bir sonraki frame'de "gorunur" sınıfını ekleyerek CSS geçişini
    // (fade-in) tetikliyoruz — aynı anda class'la birlikte eklenirse
    // tarayıcı geçişi atlayabilir.
    requestAnimationFrame(() => {
      toast.classList.add("gorunur");
    });

    setTimeout(() => {
      toast.classList.remove("gorunur");
      // CSS geçişi (fade-out) bitene kadar bekleyip SONRA DOM'dan kaldır
      // — aksi halde toast aniden kesilerek kaybolur.
      setTimeout(() => toast.remove(), 300);
    }, 2200);
  }

  function kurulumYap() {
    const govdeler = document.querySelectorAll(GOVDE_SECICI);
    if (!govdeler.length) return;

    // Baloncuk KALICI bir element DEĞİL — sadece bir seçim aktifken var
    // olur, gizlenirken tamamen kaldırılır (bkz. dosya başındaki 1.
    // madde). Bu değişken, o an DOM'da olan baloncuğu (varsa) tutar.
    let aktifBaloncuk = null;
    let aktifSecimMetni = "";
    let gizlemeZamanlayici = null;

    function baloncuguKaldir() {
      if (aktifBaloncuk) {
        aktifBaloncuk.remove();
        aktifBaloncuk = null;
      }
      aktifSecimMetni = "";
    }

    function govdeIcindeMi(node) {
      return Array.from(govdeler).some((el) => el.contains(node));
    }

    function baloncukOlustur(ust, sol, secilenMetin) {
      baloncuguKaldir(); // olası eskisini temizle (normalde olmaz, güvenlik amaçlı)

      const baloncuk = document.createElement("div");
      baloncuk.className = "secim-baloncugu";
      baloncuk.style.setProperty("--baloncuk-ust", `${ust}px`);
      baloncuk.style.setProperty("--baloncuk-sol", `${sol}px`);

      const kopyalaBtn = document.createElement("button");
      kopyalaBtn.type = "button";
      kopyalaBtn.className = "secim-baloncugu-btn";
      kopyalaBtn.textContent = "❝ Kopyala";

      kopyalaBtn.addEventListener("click", () => {
        const kopyalananMetin = secilenMetin;
        const tirnakli = `"${kopyalananMetin}"`;

        function basariliOldu() {
          alintiyiKaydet(kopyalananMetin);
          // Baloncuk ANINDA ve KOŞULSUZ kalkar — "ekranda takılı kalma"
          // ihtimalini sıfırlıyoruz, hiçbir gecikmeli/duruma bağlı
          // gizleme mantığına güvenmiyoruz.
          baloncuguKaldir();
          window.getSelection()?.removeAllRanges();
          ortaEkranToastGoster("✓ Kopyalandı — aşağıdan paylaşabilirsin");
        }

        function basarisizOldu() {
          baloncuguKaldir();
          window.getSelection()?.removeAllRanges();
          ortaEkranToastGoster("Kopyalanamadı, tekrar dener misin?");
        }

        // WEBVIEW UYUMLULUĞU: navigator.clipboard bazı WebView'lerde hiç
        // tanımlı olmayabilir/reddedebilir — bu durumda kullanıcıya
        // "kopyalanamadı" bildiriliyor, sessizce başarısız olunmuyor.
        if (!navigator.clipboard || !navigator.clipboard.writeText) {
          basarisizOldu();
          return;
        }
        navigator.clipboard.writeText(tirnakli).then(basariliOldu).catch(basarisizOldu);
      });

      baloncuk.appendChild(kopyalaBtn);
      document.body.appendChild(baloncuk);
      aktifBaloncuk = baloncuk;
      aktifSecimMetni = secilenMetin;
    }

    function secimDegistiginde() {
      const secim = window.getSelection();
      const metin = secim ? secim.toString().trim() : "";

      if (!metin || !secim.rangeCount) {
        baloncuguKaldir();
        return;
      }

      const aralik = secim.getRangeAt(0);
      // Seçimin (en azından başlangıç ucunun) yazı gövdesinin içinde
      // olduğundan emin ol — sayfanın başka bir yerinde seçim yapılırsa
      // baloncuk hiç görünmesin.
      if (!govdeIcindeMi(aralik.startContainer)) {
        baloncuguKaldir();
        return;
      }

      const dikdortgen = aralik.getBoundingClientRect();
      if (!dikdortgen || (dikdortgen.width === 0 && dikdortgen.height === 0)) {
        baloncuguKaldir();
        return;
      }

      const kirpilmisMetin =
        metin.length > MAKS_ALINTI_UZUNLUK ? `${metin.slice(0, MAKS_ALINTI_UZUNLUK - 1)}…` : metin;

      // Aynı seçim için baloncuk zaten AÇIKSA (kullanıcı sadece fareyi
      // hareket ettirdi, seçim değişmedi) gereksiz yere yeniden
      // oluşturma — titremeyi önler.
      if (aktifBaloncuk && aktifSecimMetni === kirpilmisMetin) return;

      // position:fixed KULLANILDIĞI İÇİN kaydırma ofseti EKLENMEZ —
      // getBoundingClientRect() zaten viewport'a göre koordinat döndürür.
      const BALONCUK_YUKSEKLIK_TAHMINI = 44;
      const KENAR_BOSLUGU = 8;
      let ust = dikdortgen.top - BALONCUK_YUKSEKLIK_TAHMINI;
      // Seçim ekranın en üstüne çok yakınsa (yukarı taşacaksa) baloncuğu
      // seçimin ÜSTÜNE değil ALTINA yerleştir.
      if (ust < KENAR_BOSLUGU) {
        ust = dikdortgen.bottom + 10;
      }
      const sol = Math.min(Math.max(dikdortgen.left + dikdortgen.width / 2, 60), window.innerWidth - 60);

      baloncukOlustur(ust, sol, kirpilmisMetin);
    }

    function gecikmeliKontrolEt() {
      // "selectionchange" seçim SIRASINDA sürekli tetiklenir (fare hâlâ
      // basılıyken de) — kısa bir gecikmeyle kontrol ediyoruz, aksi halde
      // seçim tam bitmeden baloncuk yanlış konumda titreşerek belirebilir.
      if (gizlemeZamanlayici) clearTimeout(gizlemeZamanlayici);
      gizlemeZamanlayici = setTimeout(secimDegistiginde, 60);
    }

    document.addEventListener("selectionchange", gecikmeliKontrolEt);

    // GÜVENİLİR GİZLENME: sayfa kaydırılınca, baloncuğun dışında bir yere
    // tıklanınca/dokununca ya da Esc'e basılınca baloncuk kaldırılır.
    window.addEventListener(
      "scroll",
      () => {
        if (aktifBaloncuk) baloncuguKaldir();
      },
      { passive: true }
    );

    document.addEventListener("pointerdown", (e) => {
      if (!aktifBaloncuk) return;
      if (aktifBaloncuk.contains(e.target)) return; // butona tıklama işlemi kendi handler'ında yönetiliyor
      baloncuguKaldir();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && aktifBaloncuk) baloncuguKaldir();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", kurulumYap);
  } else {
    kurulumYap();
  }
})();

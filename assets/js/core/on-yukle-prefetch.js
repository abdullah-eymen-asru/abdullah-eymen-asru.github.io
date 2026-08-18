/*
 * assets/js/core/on-yukle-prefetch.js
 *
 * SEKMELER ARASI HIZLI/MODERN GEÇİŞ — parça 2/2 (bkz. assets/style.css
 * sonundaki "@view-transition" kuralının başındaki not; o kural GEÇİŞİN
 * GÖRSEL/animasyon tarafını, bu dosya ise HIZ tarafını halleder).
 *
 * SORUN: Panel içindeki "sekmeler" (Admin Paneli, Üye Ayarları, Admin
 * Güvenliği, Sohbet/Mesajlar, GitHub Yönetimi vb.) bu sitede aslında AYRI
 * Jekyll sayfalarıdır — her tıklamada tarayıcı HTML'i, CSS'i ve modül
 * script'lerini SIFIRDAN indirir. Bu, özellikle mobil/yavaş bağlantılarda
 * "sekme değiştirme" hissini yavaşlatır.
 *
 * ÇÖZÜM: Bir bağlantının üzerine gelindiğinde (fare) ya da dokunulduğunda
 * (mobil), kullanıcı GERÇEKTEN tıklamadan ÖNCE — yani tam tıklama anını
 * beklemeden — hedef sayfayı tarayıcının kendi HTTP önbelleğine
 * "prefetch" ile indiriyoruz. Kullanıcı gerçekten tıkladığında sayfa
 * çoğunlukla ZATEN önbellektedir, bu yüzden geçiş gözle görülür şekilde
 * daha hızlı hissettirir. Bu teknik ("hover/touch-intent prefetching")
 * yaygın ve iyi desteklenen bir tarayıcı özelliğidir (<link rel=prefetch>),
 * hiçbir üçüncü parti kütüphane/derleme adımı gerektirmez.
 *
 * KAPSAM/GÜVENLİK ÖNLEMLERİ:
 *   - SADECE aynı orijindeki (bu sitenin kendi) linkler prefetch edilir —
 *     dış siteler asla önceden indirilmez (gizlilik + gereksiz trafik).
 *   - Sayfa-içi çapa linkleri (#...), mailto:/tel:, target="_blank",
 *     download niteliği olan linkler ve zaten mevcut sayfanın adresiyle
 *     aynı olan linkler ATLANIR.
 *   - "Veri Tasarrufu" (Data Saver) açık ya da bağlantı türü yavaşsa
 *     (2g/slow-2g, navigator.connection) HİÇ prefetch YAPILMAZ — mobil veri
 *     kullanan ziyaretçinin kotasını boşa harcamayız.
 *   - Aynı adres için birden fazla <link rel=prefetch> eklenmez (dedupe).
 *   - <link rel=prefetch> tarayıcı tarafından zaten düşük öncelikli/boşta
 *     zaman kaynağı olarak ele alınır — asıl sayfanın kendi ağ isteklerini
 *     (Supabase sorguları vb.) YAVAŞLATMAZ.
 */
(function () {
  // Tarayıcı <link rel="prefetch">'i desteklemiyorsa (çok eski tarayıcılar)
  // sessizce hiçbir şey yapma — site zaten prefetch olmadan normal çalışır.
  const testLink = document.createElement("link");
  if (!testLink.relList || !testLink.relList.supports || !testLink.relList.supports("prefetch")) {
    return;
  }

  // Veri Tasarrufu / yavaş bağlantı: prefetch'i tamamen devre dışı bırak.
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (conn && (conn.saveData || /^(slow-2g|2g)$/.test(conn.effectiveType || ""))) {
    return;
  }

  const onceIndirilenler = new Set();

  function prefetchEdilebilirMi(a) {
    if (!a || !a.href) return false;
    if (a.target && a.target !== "" && a.target !== "_self") return false;
    if (a.hasAttribute("download")) return false;

    let hedef;
    try {
      hedef = new URL(a.href, window.location.href);
    } catch (_e) {
      return false;
    }

    // Sadece http(s) ve AYNI ORİJİN.
    if (hedef.origin !== window.location.origin) return false;
    if (hedef.protocol !== "http:" && hedef.protocol !== "https:") return false;

    // Aynı sayfanın kendisine (sadece hash farkıyla) veya zaten şu an
    // açık olan sayfaya işaret eden linkleri atla.
    if (hedef.pathname === window.location.pathname && hedef.search === window.location.search) {
      return false;
    }

    return true;
  }

  function prefetchEt(a) {
    if (!prefetchEdilebilirMi(a)) return;
    const hedef = new URL(a.href, window.location.href);
    const anahtar = hedef.pathname + hedef.search;
    if (onceIndirilenler.has(anahtar)) return;
    onceIndirilenler.add(anahtar);

    const link = document.createElement("link");
    link.rel = "prefetch";
    link.href = hedef.href;
    link.as = "document";
    document.head.appendChild(link);
  }

  // Fare: üzerine gelip biraz (60ms) bekleyince tetikle — sayfa üzerinde
  // hızlıca geçen imleç için her linki gereksiz yere indirmeyi önler.
  let zamanlayici = null;
  document.addEventListener(
    "pointerover",
    (e) => {
      if (e.pointerType === "touch") return; // dokunmatik ayrı ele alınıyor (aşağıda)
      const a = e.target.closest ? e.target.closest("a[href]") : null;
      if (!a) return;
      clearTimeout(zamanlayici);
      zamanlayici = setTimeout(() => prefetchEt(a), 60);
    },
    { passive: true }
  );

  // Dokunmatik/mobil: parmağın linke DEĞMESİ zaten net bir niyet
  // sinyalidir (hover kavramı yok), bu yüzden gecikmesiz prefetch ediyoruz
  // — gerçek "tap" (click) olayından biraz önce tetiklenir.
  document.addEventListener(
    "touchstart",
    (e) => {
      const a = e.target.closest ? e.target.closest("a[href]") : null;
      if (a) prefetchEt(a);
    },
    { passive: true }
  );

  // Klavyeyle gezinenler için: bir linke odaklanmak da niyet sinyalidir.
  document.addEventListener(
    "focusin",
    (e) => {
      const a = e.target.closest ? e.target.closest("a[href]") : null;
      if (a) prefetchEt(a);
    },
    { passive: true }
  );
})();

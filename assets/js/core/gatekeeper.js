/*
 * assets/js/core/gatekeeper.js — Alan Adı & Sayfa Erişim Kalkanı (istemci tarafı)
 * -----------------------------------------------------------------------------
 * _layouts/default.html <head>'inde, style.css'ten HEMEN SONRA, senkron (defer YOK)
 * yüklenir. Neden tam orada:
 *   - style.css'ten SONRA: kilit kartının stilleri script çalışırken hazır olsun
 *     (tarayıcı, bekleyen stylesheet varken sonraki scriptleri zaten bekletir).
 *   - Geri kalan her şeyden ÖNCE: kilitlenirse window.stop() ile ayrıştırma durur;
 *     sonraki <head> scriptleri (GA, Umami, çerez) ve <body> ÇALIŞMAZ, uçuştaki
 *     görsel/script istekleri İPTAL edilir.
 *     DÜRÜST SINIR (Chromium'da ölçüldü): tarayıcının preload scanner'ı, bu script
 *     çalışmadan önce de HTML'in devamındaki <img>/<script> adreslerini keşfedip
 *     istek BAŞLATABİLİR. window.stop() bunları iptal eder ama "hiç istenmedi"
 *     garantisi vermez; istemci tarafı kilit bunu tek başına sağlayamaz.
 *
 * KARAR AKIŞI (ucuzdan pahalıya; ilk eşleşen kazanır)
 *   1) localhost / özel ağ / bilinmeyen alan adı -> HİÇBİR ŞEY yapma (geliştirici asla kilitlenmez).
 *   2) /hesap/, /panel/, gizlilik politikası      -> asla kilitlenmez (giriş kapısı + yasal sayfa).
 *   3) Ayar önbelleği taze (<60 sn)               -> ağ isteği YOK, anında karar.
 *      Bayat/yok                                  -> sayfa gizlenir (gk-bekle), ayar çekilir (2 sn zaman aşımı).
 *   4) Kilitli değilse                            -> bitti (oturum/RPC'ye hiç bakılmaz).
 *   5) Kilitli + oturum anahtarı yok (anonim)     -> kilit ekranı, ekstra API çağrısı YOK.
 *   6) Kilitli + oturum var                       -> gk_bypass_var_mi() RPC (5 dk önbellekli).
 *
 * NOT: bu bir PERDEDİR, KASA DEĞİL. Statik host'ta içerik HTML olarak herkese zaten
 * servis edilir; kilit yalnızca tarayıcıda çizilir (view-source/curl/feed/R2 URL'i
 * etkilenmez). Gerçek sunucu tarafı kilit için bkz. sohbetteki Cloudflare Pages
 * Functions önerisi. Asıl veri güvenliği RLS'tedir.
 *
 * CSP: inline script/style YOK. Kilit kartı DOM API ile kurulur (metinler textContent),
 * görünüm style.css'teki .gk-* sınıflarından gelir.
 *
 * Aynı dosya hem tarayıcıda (window.AeaGatekeeper) hem Node testinde
 * (module.exports) çalışır — saf fonksiyonlar tests/gatekeeper.test.js'te sınanır.
 */
(function () {
  "use strict";

  // Public değerler (assets/js/core/supabase-client.js ile AYNI; anon key gizli değildir).
  // supabase-client.js bir ES modülü ve window.supabase'e bağımlı olduğundan, senkron
  // başlayan bu script onu import edemez — bu yüzden iki sabit burada da duruyor.
  var SB_URL = "https://eahvcirspmvntffzphye.supabase.co";
  var SB_ANON =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVhaHZjaXJzcG12bnRmZnpwaHllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxOTgxODMsImV4cCI6MjEwMTc3NDE4M30._f-GKSsffxFo66w3g0NJfmOWEhlsjU4Y6mlcTlcPJ2E";
  var PROJE_REF = "eahvcirspmvntffzphye";

  var AYAR_ANAHTARI = "aea_gk_ayar_v1"; // localStorage: {t, v, hata}
  var BYPASS_ANAHTARI = "aea_gk_bypass_v1"; // sessionStorage: {uid, ok, t}
  var TEST_ANAHTARI = "aea_gk_test_host"; // SADECE localhost'ta: "github.io" | "pages.dev"
  var OTURUM_TERCIH_ANAHTARI = "aea_oturumu_hatirla"; // supabase-client.js ile aynı

  var TAZE_MS = 60 * 1000; // ayar bu süre taze sayılır: kilit değişikliği en geç ~1 dk içinde yayılır
  var HATA_TAZE_MS = 5 * 60 * 1000; // tablo yok/boş (migration çalışmamış): sık sık sorma
  var AYAR_ZAMAN_ASIMI_MS = 2000;
  var BYPASS_ZAMAN_ASIMI_MS = 4000;
  var BYPASS_EVET_TTL_MS = 5 * 60 * 1000;
  var BYPASS_HAYIR_TTL_MS = 60 * 1000; // yeni izin verilen kişi uzun beklemesin

  var VARSAYILAN_MESAJ = "Bu sayfa şu an bakımda. Kısa süre sonra yeniden açılacak.";

  /* ===================== SAF FONKSİYONLAR (test edilebilir) ===================== */

  // Panelin matrisi ve karar mantığı AYNI kataloğu kullanır (tek doğruluk kaynağı).
  // anahtar = kilitli_rotalar içinde saklanan mantıksal ad, dosya yolu DEĞİL.
  var ROTALAR = [
    { anahtar: "/", ad: "Anasayfa" },
    { anahtar: "/blog", ad: "Blog (liste + yazılar)" },
    { anahtar: "/projeler", ad: "Akademik Projeler" },
    { anahtar: "/iletisim", ad: "İletişim" },
    { anahtar: "/listelerim", ad: "Listelerim (izlediklerim / okuduklarım)" },
    { anahtar: "/cv", ad: "Özgeçmiş (CV)" },
  ];

  // Alan adı komple kapalı olsa BİLE açık kalanlar. /hesap: yönetici kapıdan girebilsin
  // (kilitli sitede giriş sayfası da kilitli olsaydı kimse kendi sitesine giremezdi).
  // /panel: kendi auth-guard'ı var. Gizlilik politikası: KVKK/yasal metin erişilebilir kalmalı.
  var DAIMA_ACIK = ["/hesap", "/panel", "/kurumsal/gizlilik-politikasi"];

  function altinda(norm, kok) {
    return norm === kok || norm.indexOf(kok + "/") === 0;
  }

  // "/Icerik//Blog.html" -> "/icerik/blog" ; "/index.html" -> "/" ; "/blog/x/" -> "/blog/x"
  function yolNormalle(pathname) {
    var s = String(pathname == null ? "/" : pathname);
    try {
      s = decodeURIComponent(s);
    } catch (e) {
      /* bozuk % dizisi: ham haliyle devam */
    }
    s = s.toLowerCase().replace(/\/{2,}/g, "/");
    s = s.replace(/\/index\.html?$/, "/").replace(/\.html?$/, "");
    if (s.length > 1) s = s.replace(/\/+$/, "");
    if (s.charAt(0) !== "/") s = "/" + s;
    return s;
  }

  function daimaAcikMi(norm) {
    for (var i = 0; i < DAIMA_ACIK.length; i++) {
      if (altinda(norm, DAIMA_ACIK[i])) return true;
    }
    return false;
  }

  // Gerçek URL -> mantıksal rota anahtarı (ya da hiçbir gruba ait değilse null).
  // Blog yazıları /blog/<slug>/ (panel permalink'i) ve Supabase'te yayınlananlar
  // /icerik/supabase-yazi olduğu için "Blog" grubu üçünü birden kapsar.
  function rotaAnahtari(norm) {
    if (norm === "/") return "/";
    if (altinda(norm, "/icerik/blog") || altinda(norm, "/blog") || altinda(norm, "/icerik/supabase-yazi")) return "/blog";
    if (altinda(norm, "/icerik/akademik-projeler") || altinda(norm, "/projects")) return "/projeler";
    if (altinda(norm, "/kurumsal/iletisim")) return "/iletisim";
    if (altinda(norm, "/icerik/izlediklerim") || altinda(norm, "/icerik/okuduklarim")) return "/listelerim";
    if (altinda(norm, "/cv")) return "/cv";
    return null;
  }

  function yerelMi(h) {
    if (h === "localhost" || h === "[::1]" || h === "::1" || h === "0.0.0.0") return true;
    if (/\.localhost$/.test(h) || /\.local$/.test(h)) return true;
    var m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(h);
    if (!m) return false;
    var a = +m[1];
    var b = +m[2];
    return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
  }

  // -> "yerel" | "github.io" | "pages.dev" | "diger" (özel alan adı: dokunulmaz)
  function hostTuru(hostname) {
    var h = String(hostname || "").toLowerCase();
    if (yerelMi(h)) return "yerel";
    if (h === "github.io" || /\.github\.io$/.test(h)) return "github.io";
    if (h === "pages.dev" || /\.pages\.dev$/.test(h)) return "pages.dev";
    return "diger";
  }

  // ayar: site_ayarlari satırı ya da null. Eksik/bozuk veri HER ZAMAN "açık" demektir
  // (=== false aranır): yanlış bir null yüzünden site kendini kapatmasın.
  function karar(ayar, tur, norm) {
    var acik = { kilitli: false, neden: null };
    if (!ayar || (tur !== "github.io" && tur !== "pages.dev")) return acik;
    if (daimaAcikMi(norm)) return acik;
    var aktif = tur === "github.io" ? ayar.github_io_aktif : ayar.pages_dev_aktif;
    if (aktif === false) return { kilitli: true, neden: "alan_adi" };
    var liste = ayar.kilitli_rotalar && ayar.kilitli_rotalar[tur];
    var anahtar = rotaAnahtari(norm);
    if (anahtar && Array.isArray(liste) && liste.indexOf(anahtar) !== -1) {
      return { kilitli: true, neden: "rota" };
    }
    return acik;
  }

  var API = {
    ROTALAR: ROTALAR,
    DAIMA_ACIK: DAIMA_ACIK,
    AYAR_ANAHTARI: AYAR_ANAHTARI,
    yolNormalle: yolNormalle,
    daimaAcikMi: daimaAcikMi,
    rotaAnahtari: rotaAnahtari,
    hostTuru: hostTuru,
    karar: karar,
  };

  if (typeof window === "undefined" || typeof document === "undefined") {
    if (typeof module !== "undefined" && module.exports) module.exports = API;
    return;
  }
  window.AeaGatekeeper = API;

  /* ============================ TARAYICI TARAFI ============================ */

  function depo(ad) {
    try {
      return window[ad];
    } catch (e) {
      return null; // WebView'de DOM Storage kapalıysa erişimin kendisi SecurityError atar
    }
  }
  function oku(d, anahtar) {
    try {
      var s = d && d.getItem(anahtar);
      return s ? JSON.parse(s) : null;
    } catch (e) {
      return null;
    }
  }
  function yaz(d, anahtar, deger) {
    try {
      if (d) d.setItem(anahtar, JSON.stringify(deger));
    } catch (e) {
      /* kota/kapalı depo: önbelleksiz devam */
    }
  }

  var kok = document.documentElement;
  function sinif(ekle, cikar) {
    for (var i = 0; i < cikar.length; i++) kok.classList.remove(cikar[i]);
    if (ekle) kok.classList.add(ekle);
  }
  // gk-bekle      : ayar henüz bilinmiyor. CSS tarafında 3.5 sn sonra kendiliğinden açılır
  //                 (JS çökerse bile site sonsuza dek boş kalmaz; fetch zaten 2 sn'de bırakılır).
  // gk-kilit-bekle: ayar "kilitli" dedi, bypass sorgulanıyor. CSS yedeği YOK: karar
  //                 verilene (en geç 4 sn) kadar içerik kesinlikle görünmez.
  function bekle() {
    sinif("gk-bekle", ["gk-kilit-bekle"]);
  }
  function kilitBekle() {
    sinif("gk-kilit-bekle", ["gk-bekle"]);
  }
  function ac() {
    sinif(null, ["gk-bekle", "gk-kilit-bekle"]);
  }

  function ayarGetir() {
    var url =
      SB_URL +
      "/rest/v1/site_ayarlari?id=eq.1&select=github_io_aktif,pages_dev_aktif,kilitli_rotalar,bakim_mesaji,guncellenme_tarihi";
    var kontrol = typeof AbortController === "function" ? new AbortController() : null;
    var zamanlayici = setTimeout(function () {
      if (kontrol) kontrol.abort();
    }, AYAR_ZAMAN_ASIMI_MS);
    return fetch(url, {
      credentials: "omit",
      signal: kontrol ? kontrol.signal : undefined,
      headers: {
        apikey: SB_ANON,
        Authorization: "Bearer " + SB_ANON,
        Accept: "application/vnd.pgrst.object+json",
      },
    })
      .then(function (r) {
        clearTimeout(zamanlayici);
        // Tablo yok (404) ya da satır yok (406): migration çalışmamış -> "ayar yok" = açık.
        if (r.status === 404 || r.status === 406) return null;
        if (!r.ok) throw new Error("site_ayarlari " + r.status);
        return r.json();
      })
      .catch(function (e) {
        clearTimeout(zamanlayici);
        throw e;
      });
  }

  function oturumDeposu() {
    var ls = depo("localStorage");
    var ss = depo("sessionStorage");
    var anahtar = "sb-" + PROJE_REF + "-auth-token";
    // "Oturumumu hatırla" kapalıysa SDK oturumu sessionStorage'a yazar (supabase-client.js).
    var sirali = safeGet(ls, OTURUM_TERCIH_ANAHTARI) === "0" ? [ss, ls] : [ls, ss];
    for (var i = 0; i < sirali.length; i++) {
      var o = oku(sirali[i], anahtar);
      if (o && typeof o === "object") return o;
    }
    return null;
  }
  function safeGet(d, k) {
    try {
      return d.getItem(k);
    } catch (e) {
      return null;
    }
  }

  function rpcBypass(token) {
    return fetch(SB_URL + "/rest/v1/rpc/gk_bypass_var_mi", {
      method: "POST",
      credentials: "omit",
      headers: { apikey: SB_ANON, Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: "{}",
    }).then(function (r) {
      if (!r.ok) throw new Error("gk_bypass_var_mi " + r.status);
      return r.json().then(function (v) {
        return v === true;
      });
    });
  }

  // Access token süresi dolmuşsa (1 saatten uzun süre sonra dönen herkes) token'ı BİZ
  // yenilemeyiz: SDK ile yarışıp refresh-token ailesini geçersiz kılabiliriz. Bunun yerine
  // sitenin kendi istemcisini yükleriz; getSession() yenilemeyi ve saklamayı doğru yapar.
  function sdkIleBypass() {
    return new Promise(function (coz, red) {
      function git() {
        var taban = kok.getAttribute("data-baseurl") || "";
        import(taban + "/assets/js/core/supabase-client.js")
          .then(function (m) {
            return m.supabase.auth.getSession().then(function (r) {
              if (!r.data || !r.data.session) return false;
              return m.supabase.rpc("gk_bypass_var_mi").then(function (x) {
                if (x.error) throw x.error;
                return x.data === true;
              });
            });
          })
          .then(coz, red);
      }
      if (window.supabase) git();
      else document.addEventListener("DOMContentLoaded", git, { once: true });
    });
  }

  function bypassKontrol() {
    var oturum = oturumDeposu();
    var uid = oturum && oturum.user && oturum.user.id;
    var ss = depo("sessionStorage");
    var onb = oku(ss, BYPASS_ANAHTARI);
    if (uid && onb && onb.uid === uid && Date.now() - onb.t < (onb.ok ? BYPASS_EVET_TTL_MS : BYPASS_HAYIR_TTL_MS)) {
      return Promise.resolve(!!onb.ok);
    }
    var tokenGecerli =
      oturum && oturum.access_token && typeof oturum.expires_at === "number" && oturum.expires_at * 1000 - 30000 > Date.now();
    var sonuc = tokenGecerli
      ? rpcBypass(oturum.access_token).catch(function () {
          return sdkIleBypass();
        })
      : sdkIleBypass();
    var zamanAsimi = new Promise(function (_, red) {
      setTimeout(function () {
        red(new Error("bypass zaman aşımı"));
      }, BYPASS_ZAMAN_ASIMI_MS);
    });
    return Promise.race([sonuc, zamanAsimi]).then(function (ok) {
      if (uid) yaz(ss, BYPASS_ANAHTARI, { uid: uid, ok: ok, t: Date.now() });
      return ok;
    });
  }

  function svgKilit() {
    var NS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.6");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    var g = document.createElementNS(NS, "rect");
    g.setAttribute("x", "5");
    g.setAttribute("y", "11");
    g.setAttribute("width", "14");
    g.setAttribute("height", "9");
    g.setAttribute("rx", "2");
    var p = document.createElementNS(NS, "path");
    p.setAttribute("d", "M8 11V8a4 4 0 0 1 8 0v3");
    svg.appendChild(g);
    svg.appendChild(p);
    return svg;
  }

  function kilitle(ayar, neden) {
    // 1) Ağır içeriği derhal durdur: bekleyen görsel/script/fetch istekleri ve ayrıştırıcı.
    try {
      window.stop();
    } catch (e) {
      /* eski tarayıcı: görsel kilit yine de uygulanır */
    }
    sinif("gk-kilitli", ["gk-bekle", "gk-kilit-bekle"]);

    // 2) Arama motorları (JS çalıştıranlar) kilit kartını sayfa içeriği diye indekslemesin.
    var meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    (document.head || kok).appendChild(meta);
    document.title = neden === "alan_adi" ? "Site erişime kapalı" : "Sayfa erişime kapalı";

    // 3) Kartı DOM API ile kur (bakim_mesaji kullanıcı verisi: yalnızca textContent).
    //
    // CLS (düzen kayması) NOTU: eskiden burada body'nin TÜM çocukları senkron silinip yerine
    // kart konuyordu. Sayfa o ana kadar boyanmışsa (bayat önbellek / bypass sorgusu sürerken
    // içerik zaten yerleşmiş olur) bu, "bütün sayfa bir anda yok oldu" diye ölçülür ve Core Web
    // Vitals'ta büyük bir CLS (ör. 0.56) üretir. Artık kart, tam ekran SABİT bir katman olarak
    // ÜSTE eklenir; eski içerik önce visibility:hidden ile görünmez kalır (düzeni değiştirmez,
    // CLS saymaz — bkz. style.css .gk-kilitli) ve ancak kart boyandıktan SONRA DOM'dan sökülür.
    var govde = document.body;
    if (!govde) {
      govde = document.createElement("body");
      kok.appendChild(govde);
    }
    var eskiler = [];
    for (var c = govde.firstChild; c; c = c.nextSibling) eskiler.push(c);

    var mesaj = (ayar && typeof ayar.bakim_mesaji === "string" && ayar.bakim_mesaji.trim()) || VARSAYILAN_MESAJ;
    var taban = kok.getAttribute("data-baseurl") || "";

    var katman = document.createElement("div");
    katman.className = "gk-govde";
    var kart = document.createElement("main");
    kart.className = "gk-kart";
    var ikon = document.createElement("div");
    ikon.className = "gk-ikon";
    ikon.appendChild(svgKilit());
    var baslik = document.createElement("h1");
    baslik.className = "gk-baslik";
    baslik.textContent = neden === "alan_adi" ? "Bu site şu an erişime kapalı" : "Bu sayfa şu an erişime kapalı";
    var metin = document.createElement("p");
    metin.className = "gk-mesaj";
    metin.textContent = mesaj.slice(0, 500);
    var alt = document.createElement("p");
    alt.className = "gk-alt";
    var giris = document.createElement("a");
    giris.className = "gk-giris";
    giris.rel = "nofollow";
    giris.href = taban + "/hesap/giris.html?donus=" + encodeURIComponent(location.pathname + location.search);
    giris.textContent = "Yetkili Girişi";
    alt.appendChild(giris);
    kart.appendChild(ikon);
    kart.appendChild(baslik);
    kart.appendChild(metin);
    kart.appendChild(alt);
    katman.appendChild(kart);
    govde.appendChild(katman);

    function eskileriSok() {
      for (var i = 0; i < eskiler.length; i++) {
        if (eskiler[i].parentNode === govde) govde.removeChild(eskiler[i]);
      }
    }
    if (eskiler.length) {
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(function () {
          requestAnimationFrame(eskileriSok);
        });
      } else {
        setTimeout(eskileriSok, 50);
      }
    }
  }

  function basla() {
    var tur = hostTuru(location.hostname);
    if (tur === "yerel") {
      // Yerelde kilit ekranını denemek için (yalnızca burada geçerli):
      //   localStorage.setItem("aea_gk_test_host", "github.io")  -> sayfayı yenile
      var t = safeGet(depo("localStorage"), TEST_ANAHTARI);
      if (t !== "github.io" && t !== "pages.dev") return;
      tur = t;
    }
    if (tur === "diger") return;

    var norm = yolNormalle(location.pathname);
    if (daimaAcikMi(norm)) return;

    function uygula(ayar) {
      var k = karar(ayar, tur, norm);
      if (!k.kilitli) return ac();
      var s = oturumDeposu();
      if (!s) return kilitle(ayar, k.neden); // anonim: ek API çağrısı yok
      kilitBekle();
      bypassKontrol().then(
        function (ok) {
          if (ok) ac();
          else kilitle(ayar, k.neden);
        },
        function () {
          kilitle(ayar, k.neden); // kilitli + doğrulanamadı: kapalı kal
        }
      );
    }

    var ls = depo("localStorage");
    var kayit = oku(ls, AYAR_ANAHTARI);
    if (kayit && Date.now() - kayit.t < (kayit.hata ? HATA_TAZE_MS : TAZE_MS)) {
      uygula(kayit.v);
      return;
    }

    bekle();
    ayarGetir().then(
      function (v) {
        yaz(ls, AYAR_ANAHTARI, { t: Date.now(), v: v, hata: v === null });
        uygula(v);
      },
      function () {
        // Ağ/Supabase hatası: son bilinen ayara (bayat bile olsa) uy; hiç yoksa AÇIK kal.
        // Gerekçe: erişilebilirlik > kısıtlama; kilit zaten istemci tarafı bir perde.
        uygula(kayit ? kayit.v : null);
      }
    );
  }

  basla();
})();

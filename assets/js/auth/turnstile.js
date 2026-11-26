/*
 * assets/js/auth/turnstile.js — Cloudflare Turnstile (bot koruması) ↔ Supabase Auth köprüsü.
 *
 * NE YAPAR?
 *   Supabase Dashboard → Authentication → Attack Protection'da "Enable Captcha protection" (Turnstile) AÇIKKEN,
 *   Supabase şu auth isteklerinde geçerli bir `captchaToken` ister: signInWithPassword, signUp,
 *   resetPasswordForEmail, resend, signInWithOtp. Bu dosya o token'ı kullanıcıdan HİÇBİR ŞEY İSTEMEDEN
 *   (görünmez/"interaction-only" widget) alır ve ilgili çağrılara otomatik ekler.
 *
 * NEDEN BÖYLE (MİMARİ KARAR):
 *   - Doğrulamayı (siteverify) Supabase kendisi yapar: secret yalnızca Supabase Dashboard'da durur. Sitede/
 *     Worker'da secret YOKTUR, ekstra Worker/proxy GEREKMEZ (statik site mimarisi bozulmaz).
 *   - Token, `supabase.auth.*` metodlarının İÇİNDE eklendiği için auth-pages.js, notlar.js, sistem-durumu.js
 *     gibi çağıranların hiçbiri değişmeden korunur; yeni bir auth çağrısı eklense bile otomatik korunur.
 *
 * ETKİNLEŞTİRME: _config.yml → `turnstile_sitekey: "0x4AAA..."` (herkese açık Site Key; secret DEĞİL).
 *   Boşsa bu dosya HİÇBİR ŞEY yapmaz (site eskisi gibi çalışır). Supabase'de captcha açıkken anahtar boş
 *   bırakılırsa giriş/kayıt "captcha verification process failed" ile reddedilir — bkz. rehber/02-supabase-sistemi.md.
 *
 * KULLANICI DENEYİMİ:
 *   - Giriş/kayıt/şifre sıfırlama sayfalarında widget görünür ("Doğrulanıyor → Başarılı!") ama Managed modda tıklama
 *     GEREKTİRMEZ; diğer sayfalarda (görünmez yedek kutu) yalnızca Cloudflare etkileşim isterse kutu çıkar.
 *   - Giriş/kayıt sayfalarında sayfa açılır açılmaz arka planda çözülür (token submit'ten önce hazırdır).
 *   - Token TEK KULLANIMLIKTIR: her auth çağrısından sonra widget sıfırlanır, bir sonraki deneme için yenisi hazırlanır.
 *   - Turnstile yüklenemezse (reklam engelleyici, ağ yok) çağrı token'sız gönderilir: çevrimdışı/kesinti giriş
 *     akışları doğal hata türünü almaya devam eder; Supabase captcha istiyorsa kullanıcıya Türkçe açıklama gösterilir.
 *
 * CSP: harici script (challenges.cloudflare.com) mevcut `script-src https:` / `frame-src https:` kurallarıyla zaten
 *      izinlidir; inline stil/script YOKTUR (yalnızca CSSOM ile özellik atanır).
 */

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const SAYFA_KUTUSU_ID = "turnstile-kutu";
const DURUM_ID = "turnstile-durum";

/** Supabase'in captcha istediği auth metodları. resetPasswordForEmail'in imzası farklıdır (email, {redirectTo, captchaToken}). */
const KORUNAN_METODLAR = ["signInWithPassword", "signUp", "signInWithOtp", "resend", "resetPasswordForEmail"];

export const CAPTCHA_HATA_METNI =
  "Güvenlik doğrulaması tamamlanamadı. Reklam/içerik engelleyiciyi bu site için kapatıp sayfayı yenile ve tekrar dene.";

/** Site Key: <meta name="turnstile-sitekey"> (layout'ta _config.yml'den basılır). Boşsa özellik KAPALI. */
export function turnstileSiteKey() {
  try {
    return document.querySelector('meta[name="turnstile-sitekey"]')?.content?.trim() || "";
  } catch {
    return "";
  }
}
export function turnstileAktifMi() {
  return !!turnstileSiteKey();
}

// ---------------------------------------------------------------- widget durumu (sayfa başına TEK widget)
const w = { id: null, token: null, hata: false, hataKodu: "", etkilesim: false, kutu: null, hazirSozu: null, tema: null, otoYeniden: 0 };

const SCRIPT_ONEK = "https://challenges.cloudflare.com/turnstile/v0/api.js";

let scriptSozu = null;
function scriptYukle() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptSozu) return scriptSozu;
  scriptSozu = new Promise((coz, reddet) => {
    // Sayfa (layout) api.js'i zaten ön-yüklediyse (mobilde gecikmeyi azaltmak için) ikinci kez EKLEME — yüklenmesini bekle.
    const var_ = document.querySelector(`script[src^="${SCRIPT_ONEK}"]`);
    const s = var_ || document.createElement("script");
    const zamanAsimi = setTimeout(() => reddet(new Error("turnstile script zaman aşımı")), 20000);
    const bitti = () => {
      clearTimeout(zamanAsimi);
      window.turnstile ? coz(window.turnstile) : reddet(new Error("turnstile bulunamadı"));
    };
    if (var_) {
      if (window.turnstile) return bitti();
      // load olayı kaçmış olabilir: hem dinle hem kısa aralıkla yokla
      s.addEventListener("load", bitti, { once: true });
      s.addEventListener("error", () => { clearTimeout(zamanAsimi); reddet(new Error("turnstile script yüklenemedi")); }, { once: true });
      const y = setInterval(() => { if (window.turnstile) { clearInterval(y); bitti(); } }, 100);
      setTimeout(() => clearInterval(y), 20000);
      return;
    }
    s.src = SCRIPT_URL;
    s.async = true;
    s.defer = true;
    s.onload = bitti;
    s.onerror = () => {
      clearTimeout(zamanAsimi);
      reddet(new Error("turnstile script yüklenemedi"));
    };
    document.head.appendChild(s);
  }).catch((h) => {
    scriptSozu = null; // sonraki denemede yeniden dene
    throw h;
  });
  return scriptSozu;
}

function temaAl() {
  try {
    return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

/** Sayfada #turnstile-kutu varsa onu, yoksa gerektiğinde (yalnızca etkileşim istenirse görünen) sabit bir kutu kullanır. */
function kutuBul() {
  const sayfaKutusu = document.getElementById(SAYFA_KUTUSU_ID);
  if (sayfaKutusu) return sayfaKutusu;
  const eski = document.getElementById("turnstile-yedek-kutu");
  if (eski) return eski;
  const k = document.createElement("div");
  k.id = "turnstile-yedek-kutu";
  // CSP: setAttribute("style") DEĞİL, CSSOM özellik ataması (style-src ihlali olmaz).
  k.style.position = "fixed";
  k.style.right = "16px";
  k.style.bottom = "16px";
  k.style.zIndex = "2147483000";
  document.body.appendChild(k);
  return k;
}

/** Durum satırı: metin + (istenirse) "Yeniden dene" düğmesi. Yalnızca DOM API (CSP uyumlu). */
function durumYaz(metin, yenidenDeneDugmesi = false) {
  const e = document.getElementById(DURUM_ID);
  if (!e) return;
  e.textContent = metin || "";
  e.hidden = !metin;
  if (metin && yenidenDeneDugmesi) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "auth-link-btn";
    b.textContent = "Yeniden dene";
    b.setAttribute("data-turnstile-yeniden", "1");
    b.addEventListener("click", () => {
      w.otoYeniden = 0;
      durumYaz("");
      captchaSifirla();
    });
    e.append(" ", b);
  }
}

/** Cloudflare hata kodlarını (error-callback) anlaşılır Türkçe ipucuna çevirir. */
function hataMetni(kod) {
  const k = String(kod || "");
  if (/^110(100|110|200)/.test(k) || k.startsWith("1101")) {
    return `Bu alan adı Turnstile widget'ında yetkili değil (kod ${k}). Cloudflare → Turnstile → widget → Hostname listesine bu siteyi ekle.`;
  }
  if (/^(1102|1103|1104)/.test(k)) return `Turnstile yapılandırma hatası (kod ${k}). Site Key'i kontrol et.`;
  if (/^(6000|6001|6002)/.test(k) || /^(3000|3001)/.test(k)) {
    return `Güvenlik doğrulaması bu tarayıcıda tamamlanamadı (kod ${k}). Parmak izi koruması (Mullvad/Tor/Brave/Firefox "fingerprinting" koruması), VPN, üçüncü taraf çerez engeli veya içerik engelleyici Cloudflare kutusunu bozuyor olabilir; bu siteyi bu korumalardan muaf tut ya da başka bir tarayıcı dene. Google ile giriş bu doğrulamayı gerektirmez.`;
  }
  return `Güvenlik doğrulaması şu an yapılamadı${k ? ` (kod ${k})` : ""}.`;
}

function widgetCiz(ts) {
  w.kutu = kutuBul();
  const sayfaKutusu = w.kutu.id === SAYFA_KUTUSU_ID;
  w.tema = temaAl();
  w.id = ts.render(w.kutu, {
    sitekey: turnstileSiteKey(),
    // Sayfadaki kutuda widget GÖRÜNÜR ("Doğrulanıyor… → Başarılı!"; Managed modda tıklama GEREKMEZ), kullanıcı korumanın
    // çalıştığını görür. Sayfasız (yedek) kutuda yalnızca etkileşim gerekirse görünür.
    appearance: sayfaKutusu ? "always" : "interaction-only",
    theme: w.tema, // site teması (data-theme); tema değişince widget yeniden çizilir (bkz. temaIzle)
    language: "tr",
    size: sayfaKutusu ? "flexible" : "normal",
    retry: "auto",
    "retry-interval": 4000, // mobil/zayıf ağda hata sonrası 4 sn'de bir otomatik yeniden dene
    "refresh-expired": "auto",
    "refresh-timeout": "auto",
    callback: (token) => {
      w.token = token;
      w.hata = false;
      w.hataKodu = "";
      w.etkilesim = false;
      w.otoYeniden = 0;
      durumYaz("");
    },
    "expired-callback": () => {
      w.token = null;
    },
    "timeout-callback": () => {
      w.token = null;
    },
    "unsupported-callback": () => {
      w.hata = true;
      durumYaz("Tarayıcın Turnstile'ı desteklemiyor. Güncel bir tarayıcı dene.");
    },
    "error-callback": (kod) => {
      w.token = null;
      w.hata = true;
      w.hataKodu = String(kod || "");
      // Geçici hatalarda (mobil ağ/zaman aşımı) 2 kez sessizce sıfırla; olmazsa kullanıcıya kod + "Yeniden dene" göster.
      if (w.otoYeniden < 2) {
        w.otoYeniden += 1;
        setTimeout(() => { try { window.turnstile.reset(w.id); } catch { /* widget kaldırıldı */ } }, 1500 * w.otoYeniden);
      } else {
        durumYaz(hataMetni(kod), true);
      }
      return true; // hatayı biz ele aldık (konsola ek uyarı yazılmasın)
    },
    "before-interactive-callback": () => {
      w.etkilesim = true;
      durumYaz("Lütfen güvenlik kutusunu onayla.");
    },
    "after-interactive-callback": () => {
      w.etkilesim = false;
    },
  });
}

function widgetHazirla() {
  if (w.hazirSozu) return w.hazirSozu;
  w.hazirSozu = scriptYukle()
    .then((ts) => {
      if (w.id === null) widgetCiz(ts);
      temaIzle();
      return ts;
    })
    .catch((h) => {
      w.hazirSozu = null;
      throw h;
    });
  return w.hazirSozu;
}

/** Widget'ı kaldırıp güncel temayla yeniden çizer (token yokken / token tüketildiğinde). */
function yenidenCiz() {
  try {
    window.turnstile.remove(w.id);
  } catch {
    /* zaten kaldırılmış */
  }
  w.id = null;
  w.token = null;
  w.hata = false;
  w.otoYeniden = 0;
  w.kutu?.classList.remove("auth-turnstile--ters");
  try {
    widgetCiz(window.turnstile);
  } catch {
    w.hazirSozu = null; // bir sonraki captchaTokenAl yeniden dener
  }
}

/** Site teması (açık/koyu) değişince widget'ı yeni temayla yeniden çizer: Turnstile temayı yalnızca render'da alır. */
let temaGozlemcisi = null;
function temaIzle() {
  if (temaGozlemcisi || typeof MutationObserver === "undefined") return;
  temaGozlemcisi = new MutationObserver(() => {
    if (w.id === null || !window.turnstile) return;
    const yeni = temaAl();
    if (w.token) {
      // Doğrulama ZATEN tamamlandı: widget'ı yeniden çizmek yeni bir doğrulama başlatırdı. Token geçerliliğini korur, yalnızca
      // görünümü CSS ile yeni temaya uydururuz (içerik değişmez, güvenlik etkisi yok). Gerçek yeniden çizim, token
      // kullanılıp sıfırlandığında (captchaSifirla) yeni temayla yapılır.
      w.kutu?.classList.toggle("auth-turnstile--ters", w.tema !== yeni);
      return;
    }
    if (yeni === w.tema) return;
    yenidenCiz();
  });
  temaGozlemcisi.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}

/** Hazır token'ı verir; yoksa en fazla ~30 sn (etkileşim gerekiyorsa 2 dk) bekler. Alınamazsa undefined (HİÇ fırlatmaz). */
export async function captchaTokenAl() {
  if (!turnstileAktifMi()) return undefined;
  try {
    await widgetHazirla();
  } catch {
    return undefined;
  }
  if (w.token) return w.token;
  const basla = Date.now();
  let bekleniyorYazildi = false;
  return new Promise((coz) => {
    const t = setInterval(() => {
      if (w.token) {
        clearInterval(t);
        durumYaz("");
        coz(w.token);
        return;
      }
      const gecen = Date.now() - basla;
      if (!bekleniyorYazildi && gecen > 700 && !w.etkilesim) {
        bekleniyorYazildi = true;
        durumYaz("Güvenlik doğrulaması yapılıyor…");
      }
      if (gecen > (w.etkilesim ? 120000 : 30000)) {
        clearInterval(t);
        durumYaz("");
        coz(undefined);
      }
    }, 150);
  });
}

/** Token tek kullanımlık: her auth isteğinden sonra çağır; yeni token arka planda hazırlanır. */
export function captchaSifirla() {
  try {
    w.token = null;
    if (w.id === null || !window.turnstile) return;
    if (w.tema !== temaAl()) yenidenCiz(); // doğrulama sırasında tema değişmişse yeni token'ı güncel temayla iste
    else window.turnstile.reset(w.id);
  } catch {
    /* widget yoksa/kaldırıldıysa sessizce geç */
  }
}

/** Giriş/kayıt/şifre-sıfırlama sayfalarında widget'ı sayfa açılır açılmaz çözmeye başlatır (kullanıcı beklemesin). */
export function captchaSayfaHazirla() {
  if (!turnstileAktifMi()) return;
  const basla = () => {
    if (document.getElementById(SAYFA_KUTUSU_ID)) widgetHazirla().catch(() => {});
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", basla, { once: true });
  else basla();
}

function captchaHatasiMi(hata) {
  if (!hata) return false;
  return hata.code === "captcha_failed" || /captcha/i.test(String(hata.message || ""));
}

/**
 * Bir Supabase istemcisinin auth metodlarını sarar: token yoksa otomatik ekler. İdempotent.
 * Çağıran zaten `captchaToken` verdiyse dokunmaz.
 */
export function captchaKur(istemci) {
  const auth = istemci?.auth;
  if (!auth || auth.__aeaCaptcha) return istemci;
  auth.__aeaCaptcha = true;

  for (const ad of KORUNAN_METODLAR) {
    const orijinal = auth[ad];
    if (typeof orijinal !== "function") continue;

    auth[ad] = async (...args) => {
      if (!turnstileAktifMi()) return orijinal.apply(auth, args);

      const seceneklerBurada = ad === "resetPasswordForEmail" ? args[1] : args[0]?.options;
      if (seceneklerBurada?.captchaToken) return orijinal.apply(auth, args);

      const token = await captchaTokenAl(); // alınamazsa undefined → token'sız gönder (doğal hata türü korunur)
      let yeniArgs = args;
      if (token) {
        yeniArgs =
          ad === "resetPasswordForEmail"
            ? [args[0], { ...(args[1] || {}), captchaToken: token }]
            : [{ ...(args[0] || {}), options: { ...(args[0]?.options || {}), captchaToken: token } }, ...args.slice(1)];
      }

      try {
        const sonuc = await orijinal.apply(auth, yeniArgs);
        if (sonuc && captchaHatasiMi(sonuc.error)) sonuc.error.message = CAPTCHA_HATA_METNI;
        return sonuc;
      } catch (h) {
        if (captchaHatasiMi(h)) h.message = CAPTCHA_HATA_METNI;
        throw h;
      } finally {
        if (token) captchaSifirla(); // kullanılan token geçersiz; bir sonraki deneme için yenisini hazırla
      }
    };
  }
  return istemci;
}

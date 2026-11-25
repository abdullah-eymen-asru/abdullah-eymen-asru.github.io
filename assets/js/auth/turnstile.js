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
const w = { id: null, token: null, hata: false, etkilesim: false, kutu: null, hazirSozu: null };

let scriptSozu = null;
function scriptYukle() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptSozu) return scriptSozu;
  scriptSozu = new Promise((coz, reddet) => {
    const s = document.createElement("script");
    s.src = SCRIPT_URL;
    s.async = true;
    s.defer = true;
    const zamanAsimi = setTimeout(() => reddet(new Error("turnstile script zaman aşımı")), 15000);
    s.onload = () => {
      clearTimeout(zamanAsimi);
      window.turnstile ? coz(window.turnstile) : reddet(new Error("turnstile bulunamadı"));
    };
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

function durumYaz(metin) {
  const e = document.getElementById(DURUM_ID);
  if (!e) return;
  e.textContent = metin || "";
  e.hidden = !metin;
}

function widgetHazirla() {
  if (w.hazirSozu) return w.hazirSozu;
  w.hazirSozu = scriptYukle()
    .then((ts) => {
      if (w.id !== null) return ts;
      w.kutu = kutuBul();
      w.id = ts.render(w.kutu, {
        sitekey: turnstileSiteKey(),
        // Sayfadaki kutuda widget GÖRÜNÜR ("Doğrulanıyor… → Başarılı!"; Managed modda tıklama GEREKMEZ), kullanıcı korumanın
        // çalıştığını görür. Sayfasız (yedek) kutuda yalnızca etkileşim gerekirse görünür.
        appearance: w.kutu.id === SAYFA_KUTUSU_ID ? "always" : "interaction-only",
        theme: temaAl(),
        language: "tr",
        size: w.kutu.id === SAYFA_KUTUSU_ID ? "flexible" : "normal",
        "refresh-expired": "auto",
        callback: (token) => {
          w.token = token;
          w.hata = false;
          w.etkilesim = false;
          durumYaz("");
        },
        "expired-callback": () => {
          w.token = null;
        },
        "timeout-callback": () => {
          w.token = null;
        },
        "error-callback": () => {
          w.token = null;
          w.hata = true;
          return false; // Turnstile'ın kendi otomatik yeniden denemesi sürsün
        },
        "before-interactive-callback": () => {
          w.etkilesim = true;
          durumYaz("Lütfen güvenlik kutusunu onayla.");
        },
        "after-interactive-callback": () => {
          w.etkilesim = false;
        },
      });
      return ts;
    })
    .catch((h) => {
      w.hazirSozu = null;
      throw h;
    });
  return w.hazirSozu;
}

/** Hazır token'ı verir; yoksa en fazla ~20 sn (etkileşim gerekiyorsa 2 dk) bekler. Alınamazsa undefined (HİÇ fırlatmaz). */
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
      if (gecen > (w.etkilesim ? 120000 : 20000)) {
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
    if (w.id !== null && window.turnstile) window.turnstile.reset(w.id);
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

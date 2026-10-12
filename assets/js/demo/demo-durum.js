/*
 * assets/js/demo/demo-durum.js — Demo / Vitrin Modu: ortak durum, görünürlük yapılandırması, bildirim (toast).
 * -----------------------------------------------------------------------
 * Bu dosya KASITLI olarak bağımlılıksızdır (supabase-client.js bunu statik import eder; döngü olmasın).
 *
 *  • isDemoMode: sessionStorage bayrağı (yalnızca BU sekme; sekme kapanınca demo biter). Depo kapalıysa
 *    (WebView/gizli sekme) bellekteki yedek bayrak kullanılır.
 *  • Demo ziyaretçisi OTURUMSUZDUR: Supabase'e giriş yapmaz, sahte (mock) oturum + sahte veriyle çalışır
 *    (bkz. demo-supabase.js). Gerçek veri/R2/Worker'a erişim yoktur.
 *  • Yapılandırma (hangi sekme/alt özellik görünür): Supabase `demo_config` tablosundan, YALNIZCA
 *    `demo_config_getir()` RPC'siyle okunur (anon çağırabilir; yalnızca görünürlük JSON'u döner, gizli veri yok).
 *    Bu, demo modunda Supabase'e giden TEK istektir; ağ kalkanından bilerek geçen tek kapıdır (gercekFetch).
 *    Okunamazsa: önbellek → VARSAYILAN_CONFIG (hepsi açık). 90 sn önbellek (kota koruması).
 *  • CSP: inline stil/olay YOK; toast sınıfları assets/css/demo.css'te.
 */

const BAYRAK = "aea_demo_modu";
const UYE_BAYRAK = "aea_demo_uye"; // GERÇEK, 'demo' rolündeki üye girişi (anonim ziyaretçi değil) — herkese açık anahtarından bağımsız girer
const CFG_ONBELLEK = "aea_demo_cfg";
const CFG_TTL_MS = 90 * 1000;

export const DEMO_MESAJI =
  "Bu işlem vitrin modunda salt-okunur olarak çalışmaktadır. Değişiklikler kaydedilmez ve gerçek sunucuya iletilmez.";

export const DEMO_EPOSTA = "demo@sistem.local";
export const DEMO_UID = "00000000-0000-4000-8000-00000000de10"; // sabit, geçerli biçimli SAHTE UUID (gerçek hiçbir satırla eşleşmez)

/** Sahte profil: role 'demo' (SQL tarafındaki 'demo' rolüyle aynı ad). */
export const DEMO_PROFIL = Object.freeze({
  id: DEMO_UID,
  email: DEMO_EPOSTA,
  first_name: "Demo",
  last_name: "Ziyaretçi",
  full_name: "Demo Ziyaretçi",
  role: "demo",
  is_suspended: false,
  kvkk_onay_verildi: true,
  kvkk_onay_versiyonu: "v1.0",
  kvkk_onay_tarihi: "2026-01-01T00:00:00.000Z",
  yurtdisi_onay_verildi: false,
  yurtdisi_onay_versiyonu: null,
  yurtdisi_onay_tarihi: null,
});

/** Yapılandırma sözleşmesi (SQL: demo_config_gecerli_mi ile birebir aynı anahtarlar). */
export const VARSAYILAN_CONFIG = Object.freeze({
  v: 1,
  adminlerDegistirebilir: false,
  herkeseAcik: false, // anonim (hesapsız) demo girişi: VARSAYILAN KAPALI; yalnızca Site Sahibi açar (owner_demo_herkese_acik_ayarla)
  hub: { aktif: true, kartlar: { "content-notlar": true, "media-arsiv": true, "lib-kutuphane": true, "sys-metrik": true } },
  pdf: { aktif: true, duzenlemeAraclari: true },
  arsiv: { aktif: true, zipInceleme: true },
  notlar: { aktif: true, filtreCipleri: true },
  sistem: { aktif: true },
});

/** Demo'da açılabilecek sekmeler ↔ hangi yapılandırma bölümüne bağlı. (Bunun DIŞINDAKİ hiçbir sekme demoda yoktur.) */
export const DEMO_SEKMELERI = Object.freeze({
  "me-hub": "hub",
  "content-notlar": "notlar",
  "media-arsiv": "arsiv",
  "lib-kutuphane": "pdf",
  "sys-metrik": "sistem",
});

/* ------------------------------ bayrak ------------------------------ */
let bellekBayragi = false;

export function demoModuAktifMi() {
  try {
    return sessionStorage.getItem(BAYRAK) === "1" || bellekBayragi;
  } catch {
    return bellekBayragi;
  }
}

/** Global bayrak: istemci durumunda `isDemoMode` (modüller bunu okuyabilir). */
export const isDemoMode = demoModuAktifMi();
if (isDemoMode) {
  window.AEA_DEMO = Object.freeze({ isDemoMode: true });
  document.documentElement.dataset.demo = "1";
}

/** Gerçek hesabıyla demo rolünde giren üye mi? (Anonim ziyaretçi değil.) */
export function demoUyeMi() {
  try { return sessionStorage.getItem(UYE_BAYRAK) === "1"; } catch { return false; }
}

/** @param {{uye?: boolean}} opts uye=true → 'demo' rolündeki GERÇEK hesap (auth-guard). Anonim girişte uye=false. */
export function demoBaslat({ uye = false } = {}) {
  bellekBayragi = true;
  try {
    sessionStorage.setItem(BAYRAK, "1");
    if (uye) sessionStorage.setItem(UYE_BAYRAK, "1");
  } catch {
    /* depo kapalı: bellek bayrağı yetmez (sayfa değişince kaybolur) ama kritik değil */
  }
}

export function demoBitir() {
  bellekBayragi = false;
  try {
    sessionStorage.removeItem(BAYRAK);
    sessionStorage.removeItem(UYE_BAYRAK);
    sessionStorage.removeItem(CFG_ONBELLEK);
  } catch {
    /* yok say */
  }
}

/* --------------------------- yapılandırma --------------------------- */
function birlestir(taban, gelen) {
  const cikti = JSON.parse(JSON.stringify(taban));
  if (!gelen || typeof gelen !== "object") return cikti;
  for (const bolum of ["hub", "pdf", "arsiv", "notlar", "sistem"]) {
    const g = gelen[bolum];
    if (!g || typeof g !== "object") continue;
    for (const alan of Object.keys(cikti[bolum])) {
      if (alan === "kartlar") {
        for (const kart of Object.keys(cikti.hub.kartlar)) {
          if (typeof g.kartlar?.[kart] === "boolean") cikti.hub.kartlar[kart] = g.kartlar[kart];
        }
      } else if (typeof g[alan] === "boolean") {
        cikti[bolum][alan] = g[alan];
      }
    }
  }
  cikti.adminlerDegistirebilir = gelen.adminlerDegistirebilir === true;
  cikti.herkeseAcik = gelen.herkeseAcik === true; // alan yoksa/okunamazsa KAPALI (güvenli varsayılan)
  return cikti;
}
export const configBirlestir = birlestir;

let aktifConfig = birlestir(VARSAYILAN_CONFIG, null);
let configSozu = null;
// Ağ kalkanı kurulmadan ÖNCE yakalanan gerçek fetch: yalnızca demo_config_getir() için kullanılır.
const gercekFetch = window.fetch.bind(window);

function onbellekOku() {
  try {
    const o = JSON.parse(sessionStorage.getItem(CFG_ONBELLEK) || "null");
    if (o && typeof o.t === "number" && o.cfg) return o;
  } catch {
    /* yok say */
  }
  return null;
}

/** supabase-client.js, demo modunda modül yüklenirken bir kez çağırır. */
export function configiBaslat(supabaseUrl, anonAnahtar) {
  if (!demoModuAktifMi() || configSozu) return configSozu;
  configSozu = (async () => {
    const onb = onbellekOku();
    if (onb && Date.now() - onb.t < CFG_TTL_MS) {
      aktifConfig = birlestir(VARSAYILAN_CONFIG, onb.cfg);
      return aktifConfig;
    }
    try {
      const ctrl = new AbortController();
      const zamanAsimi = setTimeout(() => ctrl.abort(), 6000);
      const r = await gercekFetch(`${supabaseUrl}/rest/v1/rpc/demo_config_getir`, {
        method: "POST",
        headers: { apikey: anonAnahtar, Authorization: `Bearer ${anonAnahtar}`, "Content-Type": "application/json" },
        body: "{}",
        signal: ctrl.signal,
      });
      clearTimeout(zamanAsimi);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      aktifConfig = birlestir(VARSAYILAN_CONFIG, j);
      try {
        sessionStorage.setItem(CFG_ONBELLEK, JSON.stringify({ t: Date.now(), cfg: j }));
      } catch {
        /* yok say */
      }
    } catch (h) {
      console.warn("Demo yapılandırması okunamadı, önbellek/varsayılan kullanılıyor:", h?.message || h);
      aktifConfig = birlestir(VARSAYILAN_CONFIG, onb?.cfg || null);
    }
    // GÜVENLİK ANAHTARI: anonim demo kapalıysa (varsayılan) ve bu bir 'demo' rollü gerçek üye değilse demo oturumu sonlandırılır.
    // Bayrağı elle açmış/eski sekmede bırakmış ziyaretçiyi de yakalar. Okunamazsa (ağ/önbellek yok) KAPALI sayılır.
    if (!aktifConfig.herkeseAcik && !demoUyeMi()) {
      demoBitir();
      window.location.replace("/hesap/giris.html?demo=kapali");
      await new Promise(() => {}); // yönlendirme sürerken panelin çizilmesine izin verme
    }
    return aktifConfig;
  })();
  return configSozu;
}

/**
 * Giriş sayfası için: anonim demo şu an herkese açık mı? ÖNBELLEKSİZ taze okuma (düğme göstermeden/tıklamadan önce).
 * Okunamazsa false (kapalı). Gönderilen tek istek: demo_config_getir() (anon; yalnızca görünürlük JSON'u döner).
 */
export async function demoHerkeseAcikMi(supabaseUrl, anonAnahtar) {
  try {
    const ctrl = new AbortController();
    const zamanAsimi = setTimeout(() => ctrl.abort(), 6000);
    const r = await gercekFetch(`${supabaseUrl}/rest/v1/rpc/demo_config_getir`, {
      method: "POST",
      headers: { apikey: anonAnahtar, Authorization: `Bearer ${anonAnahtar}`, "Content-Type": "application/json" },
      body: "{}",
      signal: ctrl.signal,
    });
    clearTimeout(zamanAsimi);
    if (!r.ok) return false;
    return (await r.json())?.herkeseAcik === true;
  } catch {
    return false;
  }
}

/** Yapılandırma hazır olana dek bekler (kalıcı olarak asılı kalmaz: en geç ~6 sn). */
export async function configHazir() {
  if (configSozu) await configSozu;
  return aktifConfig;
}
export const configAl = () => aktifConfig;

/** "pdf.duzenlemeAraclari" gibi yol; bilinmeyen yol → false. */
export function ozellikAcikMi(yol, cfg = aktifConfig) {
  let n = cfg;
  for (const p of String(yol).split(".")) {
    if (n == null || typeof n !== "object") return false;
    n = n[p];
  }
  return n === true;
}

/** Sekme demoda görünür mü? (izinli sekme + bölüm anahtarı açık) */
export function demoSekmeAcikMi(sekmeId, cfg = aktifConfig) {
  const bolum = DEMO_SEKMELERI[sekmeId];
  return !!bolum && cfg[bolum]?.aktif === true;
}

/** Ana Ekran kartı demoda görünür mü? (sekme açık + kart anahtarı kapatılmamış) */
export function demoHubKartiAcikMi(sekmeId, cfg = aktifConfig) {
  return demoSekmeAcikMi(sekmeId, cfg) && cfg.hub.kartlar?.[sekmeId] !== false;
}

/* ------------------------------- toast ------------------------------- */
let toastKutusu = null;
let sonToast = 0;

/** Zarif bilgilendirme bildirimi. Aynı mesaj art arda tetiklenirse (1,5 sn) tekrar basılmaz. */
export function demoBildir(mesaj = DEMO_MESAJI, { sureMs = 5200 } = {}) {
  const simdi = Date.now();
  if (simdi - sonToast < 1500) return;
  sonToast = simdi;
  const kur = () => {
    if (!toastKutusu || !document.body.contains(toastKutusu)) {
      toastKutusu = document.createElement("div");
      toastKutusu.className = "demo-toast-kutu";
      toastKutusu.setAttribute("role", "status");
      toastKutusu.setAttribute("aria-live", "polite");
      document.body.append(toastKutusu);
    }
    const t = document.createElement("div");
    t.className = "demo-toast";
    const ikon = document.createElement("span");
    ikon.className = "demo-toast-ikon";
    ikon.setAttribute("aria-hidden", "true");
    ikon.textContent = "🎭";
    const metin = document.createElement("span");
    metin.textContent = mesaj;
    t.append(ikon, metin);
    toastKutusu.append(t);
    setTimeout(() => {
      t.classList.add("demo-toast--kapaniyor");
      setTimeout(() => t.remove(), 320);
    }, sureMs);
  };
  if (document.body) kur();
  else document.addEventListener("DOMContentLoaded", kur, { once: true });
}

/** Salt-okunur hata nesnesi (modüller error.message'ı ekrana basar). */
export function demoHatasi() {
  return { message: DEMO_MESAJI, code: "DEMO_READONLY", details: null, hint: null, status: 403 };
}

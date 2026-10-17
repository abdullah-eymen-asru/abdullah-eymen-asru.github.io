/**
 * izin-yardim.js — Tarayıcı/işletim sistemi tespiti + "izin nasıl açılır" adımları (konum ve bildirim). Saf JS, ağ yok.
 * Konum veya bildirim izni REDDEDİLDİĞİNDE tarayıcılar sayfaya yeniden sorma izni vermez; kullanıcı izni tarayıcı ayarlarından açmalıdır.
 * Burası, kullanıcının KENDİ tarayıcısına/cihazına özel adımları ilk sırada gösterir; diğerleri "Diğer tarayıcılar" altındadır.
 */
export function tarayiciTespit(nav = (typeof navigator !== "undefined" ? navigator : {}), win = (typeof window !== "undefined" ? window : {})) {
  const ua = nav.userAgent || "";
  const ios = /iPad|iPhone|iPod/.test(ua) || (nav.platform === "MacIntel" && (nav.maxTouchPoints || 0) > 1);
  const android = /Android/i.test(ua);
  const os = ios ? "ios" : android ? "android" : /Mac/i.test(nav.platform || ua) ? "mac" : /Win/i.test(nav.platform || ua) ? "windows" : "linux";
  let ad = "diger";
  if (/SamsungBrowser/i.test(ua)) ad = "samsung";
  else if (/Edg(e|A|iOS)?\//.test(ua)) ad = "edge";
  else if (/OPR\/|Opera/i.test(ua)) ad = "opera";
  else if (/Firefox|FxiOS/i.test(ua)) ad = "firefox";
  else if (/CriOS|Chrome\//.test(ua)) ad = "chrome";
  else if (/Safari\//.test(ua)) ad = "safari";
  const standalone = !!(win.matchMedia?.("(display-mode: standalone)")?.matches || nav.standalone);
  return { ad, os, mobil: ios || android, standalone };
}
/** Brave kendini UA'da gizler; yalnızca bu asenkron kontrol bulur. */
export async function braveMi(nav = navigator) { try { return !!(nav.brave && (await nav.brave.isBrave())); } catch { return false; } }

export const TARAYICI_ADLARI = { chrome: "Chrome", edge: "Edge", firefox: "Firefox", safari: "Safari", samsung: "Samsung Internet", opera: "Opera", brave: "Brave", diger: "Tarayıcın" };
export const OS_ADLARI = { ios: "iPhone/iPad", android: "Android", mac: "macOS", windows: "Windows", linux: "Linux" };

const K = "Konum", B = "Bildirimler";
/** Kısa yardımcı: konu = "Konum" | "Bildirimler" */
const ADIM = {
  chrome_masaustu: (c, u) => [
    `Adres çubuğunun solundaki simgeye (🔒 veya ayar simgesi) tıkla.`,
    `"Site ayarları" → "${c}" satırını bul → "İzin ver" seç.`,
    `Sayfayı yenile (⌘/Ctrl + R) ve tekrar dene.`,
    `Alternatif: adres çubuğuna yaz → chrome://settings/content/${u} → "Engelli" listesinde bu siteyi bulup kaldır.`,
  ],
  chrome_android: (c) => [
    `Adres çubuğundaki 🔒 simgesine dokun → "İzinler" (veya "Site ayarları").`,
    `"${c}" → "İzin ver".`,
    `Olmuyorsa: ⋮ menü → Ayarlar → Site ayarları → ${c} → bu siteyi "İzin ver" yap.`,
  ],
  edge: (c, u) => [
    `Adres çubuğundaki 🔒 simgesine tıkla → "Bu site için izinler".`,
    `"${c}" → "İzin ver".`,
    `Alternatif: adres çubuğuna yaz → edge://settings/content/${u}`,
  ],
  firefox_masaustu: (c) => [
    `Adres çubuğunda "${c}" izninin yanındaki simgeye (🔒 / izin simgesi) tıkla.`,
    `Engellenen izin satırının yanındaki ✕ ile engeli kaldır, sayfayı yenile ve tekrar izin ver.`,
    `Alternatif: about:preferences#privacy → "İzinler" → ${c} → "Ayarlar" → bu siteyi "İzin ver" yap.`,
  ],
  firefox_android: (c) => [`Adres çubuğundaki 🔒 simgesine dokun → "Site ayarlarını düzenle".`, `"${c}" → "İzin ver" seç ve sayfayı yenile.`],
  safari_mac: (c) => [
    `Safari menüsü → "Ayarlar…" (Settings) → "Web Siteleri" sekmesi.`,
    `Soldan "${c}" seç → bu site için "İzin ver" yap.`,
    c === K ? `Hâlâ olmuyorsa: Sistem Ayarları → Gizlilik ve Güvenlik → Konum Servisleri → "Safari Web Siteleri" açık olmalı.` : `macOS Sonoma (14) veya üstü gerekir; Sistem Ayarları → Bildirimler → Safari de açık olmalı.`,
  ],
  safari_ios: (c) => c === K ? [
    `Ayarlar → Gizlilik ve Güvenlik → Konum Servisleri → açık olsun.`,
    `Aynı ekranda "Safari Web Siteleri" → "Uygulamayı Kullanırken" seç.`,
    `Safari'de adres çubuğundaki "aA" simgesi → "Web Sitesi Ayarları" → Konum → "İzin ver".`,
  ] : [
    `iPhone/iPad'de web bildirimleri yalnızca ANA EKRANA EKLENMİŞ uygulamada (iOS 16.4+) çalışır: Paylaş (⬆️) → "Ana Ekrana Ekle".`,
    `HavaStil'i ana ekrandaki simgeden aç ve izni orada ver.`,
    `Daha önce reddettiysen: Ayarlar → Bildirimler → HavaStil → "Bildirimlere İzin Ver".`,
  ],
  samsung: (c) => [
    `Adres çubuğundaki 🔒 simgesine dokun → "İzinler" → "${c}" → "İzin ver".`,
    `Olmuyorsa: ☰ menü → Ayarlar → "Siteler ve indirmeler" → "Site izinleri" → ${c} → bu siteyi bul ve "İzin ver" yap.`,
  ],
  opera: (c, u) => [`Adres çubuğundaki 🔒 simgesine tıkla → "Site ayarları" → "${c}" → "İzin ver".`, `Alternatif: opera://settings/content/${u}`],
  brave: (c, u) => [
    `Adres çubuğundaki 🔒 simgesine tıkla → "Site ayarları" → "${c}" → "İzin ver".`,
    `Alternatif: brave://settings/content/${u}`,
    c === B ? `Brave'de push bildirimleri için brave://settings/privacy → "Push mesajlaşması için Google hizmetlerini kullan" açık olmalı.` : `Konum için Brave "Konum hizmetleri" ayarının açık olduğunu da kontrol et (brave://settings/privacy).`,
  ],
  diger: (c) => [`Adres çubuğundaki 🔒/ayar simgesine tıkla, site izinlerinden "${c}" seçeneğini "İzin ver" yap, sayfayı yenile.`],
};
const OS_NOTU = {
  konum: {
    mac: "Mac'te ayrıca: Sistem Ayarları → Gizlilik ve Güvenlik → Konum Servisleri → tarayıcın AÇIK olmalı.",
    windows: "Windows'ta ayrıca: Ayarlar → Gizlilik ve güvenlik → Konum → \"Konum hizmetleri\" ve \"Masaüstü uygulamalarının konuma erişmesine izin ver\" AÇIK olmalı.",
    android: "Android'de ayrıca: Ayarlar → Konum AÇIK olmalı ve tarayıcıya konum izni verilmiş olmalı (Ayarlar → Uygulamalar → tarayıcı → İzinler → Konum).",
    ios: "iPhone/iPad'de ayrıca: Ayarlar → Gizlilik ve Güvenlik → Konum Servisleri AÇIK olmalı.",
    linux: "Linux'ta konum için sistemde bir konum servisi (GeoClue) çalışıyor olmalı; yoksa arama kutusundan şehir yazman yeterli.",
  },
  bildirim: {
    mac: "Mac'te ayrıca: Sistem Ayarları → Bildirimler → tarayıcın izinli olmalı ve \"Rahatsız Etme\" kapalı olmalı.",
    windows: "Windows'ta ayrıca: Ayarlar → Sistem → Bildirimler açık olmalı; \"Odaklanma yardımı/Rahatsız etme\" bildirimleri gizleyebilir.",
    android: "Android'de ayrıca: Ayarlar → Uygulamalar → tarayıcı → Bildirimler AÇIK olmalı.",
    ios: "", linux: "",
  },
};
function secimHaritasi(ad, os, konu) {
  const c = konu === "konum" ? K : B, u = konu === "konum" ? "location" : "notifications";
  const mobil = os === "android" || os === "ios";
  switch (ad) {
    case "chrome": return os === "ios" ? ADIM.safari_ios(c) : mobil ? ADIM.chrome_android(c) : ADIM.chrome_masaustu(c, u);
    case "edge": return ADIM.edge(c, u);
    case "firefox": return mobil ? ADIM.firefox_android(c) : ADIM.firefox_masaustu(c);
    case "safari": return os === "ios" ? ADIM.safari_ios(c) : ADIM.safari_mac(c);
    case "samsung": return ADIM.samsung(c);
    case "opera": return ADIM.opera(c, u);
    case "brave": return ADIM.brave(c, u);
    default: return ADIM.diger(c);
  }
}
/** @param {"konum"|"bildirim"} konu @returns {{baslik:string, adimlar:string[], osNotu:string}} */
export function izinAdimlari(konu, tarayici, os) {
  return {
    baslik: `${TARAYICI_ADLARI[tarayici] || "Tarayıcı"} (${OS_ADLARI[os] || ""})`,
    adimlar: secimHaritasi(tarayici, os, konu),
    osNotu: OS_NOTU[konu]?.[os] || "",
  };
}
/** Tüm tarayıcılar için (kullanıcının tarayıcısı hariç) adım listesi — "Diğer tarayıcılar" için */
export function digerTarayicilar(konu, mevcut, os) {
  const mobil = os === "android" || os === "ios";
  const adaylar = mobil ? (os === "ios" ? ["safari", "chrome", "firefox", "edge"] : ["chrome", "samsung", "firefox", "edge", "opera", "brave"]) : ["chrome", "edge", "firefox", "safari", "opera", "brave"];
  return adaylar.filter((a) => a !== mevcut).map((a) => ({ id: a, ...izinAdimlari(konu, a, os) }));
}

/** İzin durumu (Permissions API; desteklenmiyorsa 'bilinmiyor'). */
export async function izinDurumu(ad) {
  try { if (navigator.permissions?.query) return (await navigator.permissions.query({ name: ad })).state; } catch { /* Safari: desteklenmez */ }
  return "bilinmiyor";
}
/** getCurrentPosition hata kodu → kullanıcıya anlamlı metin */
export function konumHataMetni(hata) {
  if (!hata) return "Konum alınamadı.";
  if (hata.code === 1) return "Konum izni reddedilmiş. Tarayıcı bunu bir daha sormaz; izni ayarlardan açman gerekiyor.";
  if (hata.code === 2) return "Cihaz konumu belirleyemedi. Cihazın konum servisi kapalı olabilir (aşağıdaki işletim sistemi notuna bak).";
  if (hata.code === 3) return "Konum zaman aşımına uğradı. Açık alanda tekrar dene ya da şehir adı yaz.";
  return "Konum alınamadı.";
}

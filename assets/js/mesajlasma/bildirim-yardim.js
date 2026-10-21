/*
 * assets/js/mesajlasma/bildirim-yardim.js — "🔕 Tarayıcıda engelli" için etkileşimli çözüm penceresi.
 * Notification.permission === "denied" iken tarayıcı sitenin tekrar izin istemesine İZİN VERMEZ; yalnızca kullanıcı tarayıcı ayarından
 * açabilir. Bu pencere tarayıcıyı/platformu tespit eder, adım adım yönergeyi gösterir ve "Ayarı değiştirdim, kontrol et" ile durumu yeniden okur.
 * Platform tespiti kullanıcı-aracısı (UA) tahminidir; yanlış çıkarsa "Diğer tarayıcılar" yönergesi her zaman altta durur.
 */
import { h } from "./dom.js";

export function platformTespit(ua = navigator.userAgent || "", platform = navigator.platform || "", dokunmatikNokta = navigator.maxTouchPoints || 0) {
  const ios = /iPhone|iPad|iPod/.test(ua) || (platform === "MacIntel" && dokunmatikNokta > 1);
  const android = /Android/i.test(ua);
  let tarayici = "diger";
  if (/Edg(A|iOS)?\//.test(ua)) tarayici = "edge";
  else if (/SamsungBrowser/i.test(ua)) tarayici = "samsung";
  else if (/Firefox|FxiOS/i.test(ua)) tarayici = "firefox";
  else if (/OPR\/|Opera/i.test(ua)) tarayici = "opera";
  else if (/CriOS|Chrome\//.test(ua)) tarayici = "chrome";
  else if (/Safari\//.test(ua)) tarayici = "safari";
  const mobil = ios || android;
  return { ios, android, mobil, tarayici, masaustu: !mobil };
}

const ADIMLAR = {
  "chrome-masaustu": ["Adres çubuğunun solundaki ayar (kilit / ayarlar) simgesine tıkla.", "“Site ayarları”nı aç (ya da “Bildirimler” satırını bul).", "Bildirimler: “Engelle” → “Sor” ya da “İzin ver” yap.", "Sayfayı yenile ve aşağıdaki düğmeye bas."],
  "edge-masaustu": ["Adres çubuğunun solundaki kilit simgesine tıkla → “Bu site için izinler”.", "Bildirimler: “Engelle” → “Sor” ya da “İzin ver”.", "Sayfayı yenile ve aşağıdaki düğmeye bas."],
  "firefox-masaustu": ["Adres çubuğunun solundaki kilit simgesine tıkla → “Bağlantı güvenli” › “Daha fazla bilgi”.", "“İzinler” sekmesinde “Bildirimleri göster” için “Varsayılanı kullan” işaretini kaldırıp “İzin ver” seç (ya da engeli kaldır).", "Sayfayı yenile ve aşağıdaki düğmeye bas."],
  "safari-masaustu": ["Safari menüsü → Ayarlar → Web Siteleri → Bildirimler.", "Bu sitenin yanındaki seçeneği “Reddet” → “İzin Ver” yap.", "Sayfayı yenile ve aşağıdaki düğmeye bas."],
  "opera-masaustu": ["Adres çubuğunun solundaki kilit simgesine tıkla → “Site ayarları”.", "Bildirimler: “Engelle” → “Sor” ya da “İzin ver”.", "Sayfayı yenile ve aşağıdaki düğmeye bas."],
  "chrome-android": ["Adres çubuğunun solundaki simgeye dokun → “İzinler” (ya da “Site ayarları”).", "Bildirimler’i aç / “İzin ver” yap.", "Olmazsa: Android Ayarlar → Uygulamalar → Chrome → Bildirimler’in açık olduğundan emin ol.", "Sayfaya dön ve aşağıdaki düğmeye bas."],
  "samsung-android": ["Adres çubuğunun solundaki kilit simgesine dokun → “İzinler”.", "Bildirimler’i “İzin ver” yap.", "Olmazsa: Android Ayarlar → Uygulamalar → Samsung Internet → Bildirimler.", "Sayfaya dön ve aşağıdaki düğmeye bas."],
  "firefox-android": ["Adres çubuğunun solundaki kilit simgesine dokun → “Site ayarlarını düzenle”.", "Bildirim iznini “İzin ver” yap.", "Sayfaya dön ve aşağıdaki düğmeye bas."],
  "safari-ios": ["iPhone/iPad’de web bildirimi yalnızca siteyi Ana Ekrana eklediğinde çalışır: Paylaş (↑) → “Ana Ekrana Ekle”.", "Ana ekrandaki simgeden siteyi aç ve bildirimi orada aç.", "Daha önce reddettiysen: Ayarlar → Bildirimler → bu sitenin uygulama simgesi → “Bildirimlere İzin Ver”.", "Safari’de reddettiysen: Ayarlar → Safari → Web Siteleri → Bildirimler üzerinden de bakabilirsin."],
  "chrome-ios": ["iOS’ta Chrome web bildirimi göndermez; Safari ile siteyi aç → Paylaş (↑) → “Ana Ekrana Ekle”.", "Ana ekrandaki simgeden siteyi aç ve bildirimi orada aç.", "Daha önce reddettiysen: Ayarlar → Bildirimler → site simgesi → “Bildirimlere İzin Ver”."],
};
const GENEL = ["Adres çubuğundaki kilit / ayarlar simgesine tıkla ve “Site ayarları”nı aç.", "“Bildirimler” iznini “Sor” ya da “İzin ver” yap.", "Sayfayı yenile ve aşağıdaki düğmeye bas."];
const AD = { chrome: "Chrome", edge: "Microsoft Edge", firefox: "Firefox", safari: "Safari", samsung: "Samsung Internet", opera: "Opera", diger: "Tarayıcın" };

/** Pencereyi açar. kontrol(): güncel durumu ("acik" | "reddedildi" | …) döndüren işlev. Dönüş: izin artık engelli değilse true. */
export function bildirimEngelYardimiAc(kontrol) {
  return new Promise((coz) => {
    const p = platformTespit();
    const anahtar = `${p.tarayici}-${p.ios ? "ios" : p.android ? "android" : "masaustu"}`;
    const adimlar = ADIMLAR[anahtar] || GENEL;
    const onceki = document.activeElement;
    const sonuc = h("p", { class: "msj-modal-metin", role: "status", "aria-live": "polite", hidden: true });
    const kapat = (v) => { kaplama.remove(); document.removeEventListener("keydown", tus, true); onceki?.focus?.(); coz(v); };
    const tus = (e) => { if (e.key === "Escape") { e.stopPropagation(); kapat(false); } };
    const kontrolBtn = h("button", { type: "button", class: "msj-btn msj-btn--birincil", text: "Ayarı Değiştirdim, Kontrol Et" });
    const vazgec = h("button", { type: "button", class: "msj-btn msj-btn--ikincil", text: "Kapat", onclick: () => kapat(false) });
    kontrolBtn.addEventListener("click", async () => {
      kontrolBtn.disabled = true;
      try {
        const d = await kontrol();
        if (d === "reddedildi") {
          sonuc.textContent = "Tarayıcı bu site için bildirimi hâlâ engelli gösteriyor. Ayarı değiştirdikten sonra sayfayı yenilemen gerekebilir; olmazsa yukarıdaki adımları tekrar kontrol et.";
          sonuc.hidden = false;
        } else { kapat(true); }
      } finally { kontrolBtn.disabled = false; }
    });
    const kutu = h("div", { class: "msj-modal", role: "dialog", "aria-modal": "true", "aria-label": "Bildirim İznini Sıfırla" },
      h("h3", { class: "msj-modal-baslik", text: "Bildirim İznini Sıfırla" }),
      h("p", { class: "msj-modal-metin", text: `${AD[p.tarayici]} (${p.ios ? "iOS" : p.android ? "Android" : "bilgisayar"}) bu site için bildirimi engelledi. Tarayıcılar engellenen bir izni siteden tekrar sormaya izin vermez; ayarı senin değiştirmen gerekir:` }),
      h("ol", { class: "msj-yardim-adimlar" }, adimlar.map((a) => h("li", { text: a }))),
      anahtar in ADIMLAR ? h("details", { class: "msj-yardim-diger" }, h("summary", { text: "Başka bir tarayıcı mı kullanıyorsun?" }), h("ol", { class: "msj-yardim-adimlar" }, GENEL.map((a) => h("li", { text: a })))) : null,
      sonuc,
      h("div", { class: "msj-modal-eylem" }, vazgec, kontrolBtn));
    const kaplama = h("div", { class: "msj-modal-kaplama", onclick: (e) => { if (e.target === kaplama) kapat(false); } }, kutu);
    document.body.append(kaplama);
    document.addEventListener("keydown", tus, true);
    kontrolBtn.focus();
  });
}

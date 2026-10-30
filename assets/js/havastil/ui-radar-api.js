/*
 * ui-radar-api.js — HavaStil › Ayarlar › "Radar API & Kota"
 * Radar ekranının kullandığı HER servis, ücretsiz/ücretli kademeleriyle (hangi kaynak, anahtar gerekir mi, limit nedir) tek yerde.
 * Radar tahmin ızgarası Open-Meteo'dur: anahtar/kota/plan "Open-Meteo API & Kota" kartından yönetilir (aynı anahtar radarda da geçerli).
 * Gözlem radarı (RainViewer) anahtarsızdır; isteğe bağlı olarak RainViewer-uyumlu KENDİ sunucun (örn. self-host LibreWXR) adresi girilebilir.
 * Bu cihazda saklanır; sunucuya gitmez; gizli anahtar tutulmaz. CSP: inline stil/işleyici yok. Limit bilgileri 2026-10 tarihli resmî sayfalardandır.
 */
import { el, kart, bolumBasligi, ipucu, olay } from "./ui-temel.js";
import { radarKaynakOku, radarKaynakYaz, radarAdresiDogrula } from "./radar-kaynak.js";

const KADEMELER = [
  { ad: "Open-Meteo — tahmin ızgarası (yağış/rüzgâr/sıcaklık katmanları)", kademe: [
    ["Ücretsiz (anahtarsız, ticari olmayan)", "600/dk · 5.000/sa · 10.000/gün · 300.000/ay (IP başına)"],
    ["Ücretli (Standard/Professional/Enterprise)", "Kendi API anahtarın: yüksek limit + ticari kullanım. Güncel fiyat/limit: open-meteo.com/en/pricing"]],
    not: "Çağrı ağırlığı ≈ nokta × ceil(gün/14). Radar bunu otomatik sınırlar; aynı görünüm 20 dk önbellekten gelir.", bag: "https://open-meteo.com/en/pricing" },
  { ad: "RainViewer — canlı radar gözlemi", kademe: [
    ["Ücretsiz (anahtar yok)", "Yalnızca geçmiş radar (10 dk aralık) · en çok yakınlaştırma 7 · 100 istek/IP/dk · kişisel/eğitim amaçlı, atıf zorunlu"],
    ["Ücretli kademe", "Şu an yok. Daha fazlası için kendi RainViewer-uyumlu sunucunu aşağıdan ekleyebilirsin."]],
    not: "Animasyon karelerinin her biri ayrı karo isteğidir; bu yüzden radar yalnızca son ~1 saati (6 kare) oynatır.", bag: "https://www.rainviewer.com/api/transition-faq.html" },
  { ad: "NASA GIBS — günlük uydu görüntüsü", kademe: [["Ücretsiz (anahtar yok)", "Adil kullanım; sabit bir kota yayımlanmaz."], ["Ücretli kademe", "Yok."]], bag: "https://nasa-gibs.github.io/gibs-api-docs/" },
  { ad: "EUMETSAT View — bulut tipi (MTG)", kademe: [["Ücretsiz (anahtar yok)", "Adil kullanım; yoğun kullanımda sınırlanabilir."], ["Ücretli kademe", "Yok (kurumsal erişim ayrıdır)."]], bag: "https://view.eumetsat.int/" },
  { ad: "Esri / OpenStreetMap — harita altlığı", kademe: [["Ücretsiz", "Atıf zorunlu; OSM karo sunucusu ağır/otomatik kullanıma kapalıdır."], ["Ücretli kademe", "Esri: ArcGIS Location Platform (kota/fatura)."]], bag: "https://operations.osmfoundation.org/policies/tiles/" },
];

export function radarApiKarti() {
  const kok = kart("hv-om-kart hv-radar-api-kart", bolumBasligi("🛰️ Radar API & Kota"));
  kok.append(ipucu("Radarın kullandığı servisler, anahtar gerekip gerekmediği ve her kademenin limiti. Tahmin katmanlarının kotası/anahtarı yukarıdaki Open-Meteo kartındadır (aynı anahtar radarda da geçerli)."));
  for (const k of KADEMELER) {
    kok.append(el("details", { class: "hv-radar-api-ogesi" },
      el("summary", { text: k.ad }),
      el("dl", { class: "hv-kademe-liste" }, ...k.kademe.flatMap(([a, d]) => [el("dt", { text: a }), el("dd", { text: d })])),
      k.not ? el("p", { class: "hv-ipucu", text: k.not }) : null,
      el("a", { href: k.bag, target: "_blank", rel: "noopener noreferrer", text: "Resmî sayfa ↗" })));
  }
  // kaynak tercihi (Open-Meteo kartındaki "API kaynağım" ile aynı mantık)
  const t = radarKaynakOku();
  const sec = el("select", { class: "hv-girdi", "aria-label": "Radar gözlem kaynağı" },
    el("option", { value: "otomatik", text: "Otomatik (RainViewer ücretsiz)" }), el("option", { value: "kendi", text: "Kendi RainViewer-uyumlu sunucum" }));
  sec.value = t.kaynak;
  const adres = el("input", { type: "url", class: "hv-girdi", placeholder: "https://radar.alanadin.com", value: t.kaynak === "kendi" ? t.adres : "", autocomplete: "off", spellcheck: "false", "aria-label": "Radar sunucu adresi" });
  const mesaj = el("p", { class: "hv-ipucu", role: "status" });
  const kaydet = olay(el("button", { type: "button", class: "hv-btn hv-btn-birincil hv-btn-ince", text: "Kaynağı kaydet" }), "click", () => {
    try { radarKaynakYaz(sec.value, adres.value); mesaj.classList.remove("hv-uyari"); mesaj.textContent = "Kaydedildi (bu cihazda). Radar sekmesini yeniden açınca uygulanır."; }
    catch (h) { mesaj.classList.add("hv-uyari"); mesaj.textContent = h.message; }
  });
  olay(sec, "change", () => { adres.hidden = sec.value !== "kendi"; });
  adres.hidden = sec.value !== "kendi";
  kok.append(el("h3", { text: "Radar kaynağım" }), el("label", { class: "hv-om-alan" }, el("span", { class: "muted", text: "Kaynak" }), sec), adres, kaydet,
    ipucu("Kendi sunucun için adres /public/weather-maps.json uç noktasını sunmalıdır (RainViewer v2 uyumu). Bu adres yalnızca bu cihazda saklanır; anahtar/şifre girilmez."), mesaj);
  void radarAdresiDogrula;
  return kok;
}

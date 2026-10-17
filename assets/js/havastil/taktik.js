/**
 * taktik.js — HABER → GİYİM KURALI motoru (yerel, deterministik, LLM YOK). Türkçe + İngilizce.
 *  1) kurallariCikar(): temiz başlık/özetten hava olayı kurallarını çıkarır (fırtına, çöl tozu, don, sağanak/dolu/sel, kar, sıcak, sis).
 *  2) dogrula(): kuralı Open-Meteo verisiyle ÇAPRAZ KONTROL eder ("haber doğrulama"): uyuşuyor / çelişiyor / ölçülemiyor.
 *  3) kisitlaraCevir(): uygulanacak kuralları cekirdek.js'in beklediği kısıt nesnesine çevirir (yama değil; kombin seçimi bu kısıtlarla yapılır).
 */
import { normalize } from "./iller.js";

const SEVIYE_SIRA = { uyari: 0, sari: 1, turuncu: 2, kirmizi: 3 };
const SEVIYE_AD = { uyari: "Uyarı", sari: "Sarı kod", turuncu: "Turuncu kod", kirmizi: "Kırmızı kod" };
export const seviyeAdi = (s) => SEVIYE_AD[s] || "Uyarı";

function renkKodu(t) {
  if (/kirmizi kod|red (weather )?(warning|alert)/.test(t)) return "kirmizi";
  if (/turuncu kod|orange (weather )?(warning|alert)/.test(t)) return "turuncu";
  if (/sari kod|yellow (weather )?(warning|alert)/.test(t)) return "sari";
  return "uyari";
}

/** id, ikon, etiket, öncelik, kısa (kullanıcıya ne yapacağı), var (metin testi), dogrula (veri testi) */
export const KURALLAR = [
  { id: "firtina", ikon: "🌪️", etiket: "Fırtına / kuvvetli rüzgâr", oncelik: 5, kisa: "Şemsiyeyi bırak, kapüşonlu rüzgâr geçirmez bir dış kat giy.",
    var: (t) => {
      const duz = t.replace(/(kar|toz|snow ?|dust ?|sand ?|ice |winter |thunder ?)(firtinasi|storm)/g, " ");   // kar/toz/gök gürültülü fırtına ayrı kurallardır
      return /(^|[^a-z0-9])(firtina|lodos|poyraz|kasirga|hortum|gale|hurricane|typhoon|cyclone|tornado|storm)/.test(duz)
        || /(kuvvetli|siddetli|sert) ruzgar|ruzgar (uyarisi|siddeti)|saatte \d+ km hizla esen|(strong|high|damaging|gusty|severe) winds?|wind warning|gusts? (of|up to)/.test(t);
    },
    dogrula: (h) => (Math.max(h.gust ?? 0, h.wind ?? 0) >= 45 ? "ok" : Math.max(h.gust ?? 0, h.wind ?? 0) < 28 ? "celisiyor" : "belirsiz"),
    veriNotu: (h) => `Modelde hamle ${Math.round(h.gust ?? h.wind ?? 0)} km/s` },
  { id: "col_tozu", ikon: "🏜️", etiket: "Çöl tozu / toz taşınımı", oncelik: 4, kisa: "Açık renk giyme, maske tak, gözlük kullan.",
    var: (t) => /col tozu|sahra tozu|saharadan|toz tasinimi|toz bulutu|toz firtinasi|sand ?storm|dust ?storm|saharan dust|dust cloud/.test(t),
    dogrula: (h) => (h.dust == null ? "bilinmiyor" : h.dust >= 60 || (h.pm10 ?? 0) >= 100 ? "ok" : h.dust < 15 ? "celisiyor" : "belirsiz"),
    veriNotu: (h) => (h.dust == null ? "Toz verisi yok" : `Modelde toz ${h.dust} µg/m³`) },
  { id: "don", ikon: "🧊", etiket: "Don / buzlanma", oncelik: 5, kisa: "Derin kauçuk dişli (kaymaz) bot giy; düz tabanlı ayakkabıdan kaçın.",
    var: (t) => /buzlanma|gizli buz|zirai don|(^|[^a-z0-9])don (olayi|riski|uyarisi|olacak|bekleniyor)|(^|[^a-z0-9])donma|black ice|(^|[^a-z0-9])frost|freezing (rain|fog|temperatures)|ice warning|icy (roads|conditions)/.test(t),
    dogrula: (h) => ((h.minRaw ?? 20) <= 2 ? "ok" : (h.minRaw ?? 20) > 6 ? "celisiyor" : "belirsiz"),
    veriNotu: (h) => `Modelde en düşük ${h.minRaw}°C` },
  { id: "saganak", ikon: "⛈️", etiket: "Sağanak / dolu / sel", oncelik: 5, kisa: "Su geçirmez dış kat ve su geçirmez ayakkabı giy.",
    var: (t) => /saganak|(siddetli|kuvvetli|cok kuvvetli) yagis|sel (uyarisi|riski|tehlikesi|baskini)|su baskini|(^|[^a-z0-9])dolu([^a-z0-9]|$)|heavy rain|torrential|downpour|flash flood|flood(ing)? (warning|risk|alert)|(^|[^a-z0-9])hail/.test(t)
      || (/(sari|turuncu|kirmizi) kod|(yellow|orange|red) (weather )?(warning|alert)/.test(t) && /yagis|yagmur|sel([^a-z0-9]|$)|rain|flood/.test(t)),
    dogrula: (h) => ((h.rainProb ?? 0) >= 50 || (h.precip ?? 0) >= 1 ? "ok" : (h.rainProb ?? 0) < 15 && (h.precip ?? 0) < 0.1 ? "celisiyor" : "belirsiz"),
    veriNotu: (h) => `Modelde yağış ihtimali %${h.rainProb}` },
  { id: "kar", ikon: "❄️", etiket: "Kar / tipi", oncelik: 4, kisa: "Sıcak dış kat, su geçirmez ve kaymaz kışlık bot giy.",
    var: (t) => /(yogun|kuvvetli|siddetli) kar|kar yagisi|(^|[^a-z0-9])tipi|kar firtinasi|heavy snow|snow ?storm|blizzard|snow warning|winter storm/.test(t),
    dogrula: (h) => ((h.raw ?? 20) <= 3 && ((h.precip ?? 0) > 0 || (h.snow ?? 0) > 0 || (h.rainProb ?? 0) >= 40) ? "ok" : (h.raw ?? 20) > 7 ? "celisiyor" : "belirsiz"),
    veriNotu: (h) => `Modelde ${h.raw}°C` },
  { id: "sicak", ikon: "🥵", etiket: "Sıcak hava dalgası", oncelik: 3, kisa: "En hafif, açık renk kıyafeti seç; bol su iç.",
    var: (t) => /sicak hava dalgasi|asiri sicak|bunaltici sicak|sicaklik uyarisi|heat ?wave|extreme heat|heat warning|scorching/.test(t),
    dogrula: (h) => ((h.maxRaw ?? 20) >= 33 ? "ok" : (h.maxRaw ?? 20) < 28 ? "celisiyor" : "belirsiz"),
    veriNotu: (h) => `Modelde en yüksek ${h.maxRaw}°C` },
  { id: "sis", ikon: "🌫️", etiket: "Yoğun sis", oncelik: 2, kisa: "Trafikte görünür ol: parlak veya yansıtıcı bir parça ekle.",
    var: (t) => /yogun sis|sis uyarisi|gorus mesafesi|dense fog|thick fog|fog warning/.test(t),
    dogrula: (h) => (h.gorus != null ? (h.gorus < 2000 ? "ok" : h.gorus > 8000 ? "celisiyor" : "belirsiz") : "bilinmiyor"),
    veriNotu: (h) => (h.gorus != null ? `Modelde görüş ${(h.gorus / 1000).toFixed(1)} km` : "Görüş verisi yok") },
];

export function kurallariCikar({ baslik, ozet }) {
  const t = normalize(`${baslik} ${ozet || ""}`);
  const seviye = renkKodu(t);
  return KURALLAR.filter((k) => k.var(t)).map((k) => ({ id: k.id, ikon: k.ikon, etiket: k.etiket, oncelik: k.oncelik, seviye }));
}
export const seviyePuani = (kurallar) => Math.max(0, ...kurallar.map((k) => SEVIYE_SIRA[k.seviye] * 10 + k.oncelik));

/** Kuralı hava verisiyle karşılaştır. @returns {{durum:'uyusuyor'|'celisiyor'|'belirsiz'|'olculemiyor', metin:string}} */
export function dogrula(kural, h) {
  const k = KURALLAR.find((x) => x.id === kural.id);
  if (!k || !h) return { durum: "olculemiyor", metin: "Hava verisiyle kıyaslanamadı." };
  const s = k.dogrula(h);
  const not = k.veriNotu(h);
  if (s === "ok") return { durum: "uyusuyor", metin: `Hava verisiyle uyuşuyor (${not}).` };
  if (s === "celisiyor") return { durum: "celisiyor", metin: `Hava verisi farklı gösteriyor (${not}).` };
  if (s === "bilinmiyor") return { durum: "olculemiyor", metin: `${not}; kıyaslanamadı.` };
  return { durum: "belirsiz", metin: `Kısmen uyuşuyor (${not}).` };
}

/**
 * Kullanılacak kuralları (id başına en yüksek seviye) cekirdek.js kısıtına çevir.
 * @param {Array<{kurallar:Array}>} uygulananlar  haber.js'te "uygulandi" olarak işaretlenen uyarılar
 */
export function kisitlaraCevir(uygulananlar) {
  const kurallar = {};
  for (const u of uygulananlar) for (const k of u.kurallar) {
    const o = kurallar[k.id];
    if (!o || SEVIYE_SIRA[k.seviye] > SEVIYE_SIRA[o.seviye]) kurallar[k.id] = { seviye: k.seviye };
  }
  return { kurallar };
}

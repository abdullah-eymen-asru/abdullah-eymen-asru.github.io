/**
 * kirletici.js — HavaStil · HAVA KALİTESİ SÖZLÜĞÜ (saf fonksiyonlar; DOM ve ağ yok, Node'da test edilebilir).
 * -----------------------------------------------------------------------------------------------------------------
 * Her kirletici ekranda ÖNCE sade Türkçe adı + tek cümlelik açıklamasıyla, hemen yanında BİLİMSEL adı ve kimyasal formülüyle (örn. "Azot dioksit · NO₂") anılır.
 * Değer her zaman SAYI + BİRİM olarak yazılır (örn. "35,2 µg/m³"; karbonmonoksitte "0,45 mg/m³") ve yanında "iyi/kötü" yerine seviye sınırları gösterilir.
 * Kısa kimlikler (pm25, no2 …) kodda ve veri alanlarında yaşar.
 *
 * SEVİYE ÖLÇEĞİ: Avrupa Çevre Ajansı (EEA) Avrupa Hava Kalitesi İndeksi (EAQI, 2023 güncellemesi) — 6 bant.
 *   Kirletici başına eşikler (µg/m³, üst sınırlar): ince toz 5/15/50/90/140 · kaba toz 15/45/120/195/270 · ozon 60/100/120/160/180 ·
 *   azot dioksit 10/25/60/100/150 · kükürt dioksit 20/40/125/190/275.
 *   Karbonmonoksit EAQI'de yoktur: DSÖ 2021 (24 sa için 4 mg/m³) ve AB 8 saatlik sınırı (10 mg/m³) esas alınmıştır.
 *   Çöl tozu için resmî bir indeks yoktur: eşikler HavaStil'in kendi görsel ölçeğidir (not düşülür).
 * "Rehber değeri": DSÖ 2021 hava kalitesi rehberi (24 saatlik; ozon için 8 saatlik tepe). Yüzde = ölçüm ÷ rehber değeri.
 */
import { aqiSeviye } from "./hava-kodlari.js";

export const SEVIYELER = [
  { ad: "Çok iyi", sinif: "d1" }, { ad: "İyi", sinif: "d1" }, { ad: "Orta", sinif: "d2" },
  { ad: "Kötü", sinif: "d3" }, { ad: "Çok kötü", sinif: "d4" }, { ad: "Aşırı kötü", sinif: "d5" },
];

/** Gösterim sırası: en çok soruları yanıtlayandan en az bilinene. */
export const KIRLETICILER = [
  { id: "pm25", ad: "İnce Toz ve Egzoz Parçacıkları", bilimsel: "İnce partikül madde", formul: "PM₂.₅", boyut: "2,5 mikrometreden küçük", aciklama: "Akciğerlere inen mikroskobik kirleticiler", ikon: "🫁", esik: [5, 15, 50, 90, 140], rehber: 15 },
  { id: "pm10", ad: "Kaba Toz ve Polen", bilimsel: "Kaba partikül madde", formul: "PM₁₀", boyut: "10 mikrometreden küçük", aciklama: "Solunum yollarını etkileyen havadaki partiküller", ikon: "🌾", esik: [15, 45, 120, 195, 270], rehber: 45 },
  { id: "o3", ad: "Yüzey Ozonu", bilimsel: "Ozon", formul: "O₃", aciklama: "Güneş ışığı ve trafik gazlarıyla oluşan gaz", ikon: "☀️", esik: [60, 100, 120, 160, 180], rehber: 100 },
  { id: "no2", ad: "Trafik ve Yakıt Gazı (Azot)", bilimsel: "Azot dioksit", formul: "NO₂", aciklama: "Araç egzozları ve ısınma kaynaklı kirlilik", ikon: "🚗", esik: [10, 25, 60, 100, 150], rehber: 25 },
  { id: "co", ad: "Karbonmonoksit", bilimsel: "Karbon monoksit", formul: "CO", aciklama: "Eksik yanma ve egzoz kaynaklı renksiz gaz", ikon: "🔥", esik: [2000, 4000, 10000, 20000, 30000], rehber: 4000 },
  { id: "so2", ad: "Kükürt Gazı", bilimsel: "Kükürt dioksit", formul: "SO₂", aciklama: "Sanayi ve fosil yakıt kaynaklı gaz", ikon: "🏭", esik: [20, 40, 125, 190, 275], rehber: 40 },
  { id: "dust", ad: "Çöl Tozu", bilimsel: "Mineral toz (Sahra tozu)", formul: "toz", aciklama: "Sahra ve çöllerden rüzgârla taşınan ince toz", ikon: "🏜️", esik: [15, 40, 80, 150, 300], rehber: null, resmiIndeksYok: true },
];
export const KIRLETICI = Object.fromEntries(KIRLETICILER.map((k) => [k.id, k]));
export const ANA_KIRLETICILER = ["pm25", "pm10", "o3", "no2", "co", "so2"];

/** 0..5 bant dizini (EAQI mantığı: değer ≤ üst sınır). Geçersiz değer → null. */
export function seviyeIndeks(id, v) {
  const k = KIRLETICI[id];
  if (!k || !Number.isFinite(v) || v < 0) return null;
  const i = k.esik.findIndex((e) => v <= e);
  return i < 0 ? 5 : i;
}
export const seviye = (id, v) => { const i = seviyeIndeks(id, v); return i == null ? null : { idx: i, ...SEVIYELER[i] }; };
/** Ölçümün DSÖ rehber değerine oranı (yüzde, yuvarlanmış). Rehber yoksa null. */
export function rehberYuzde(id, v) { const r = KIRLETICI[id]?.rehber; return r && Number.isFinite(v) ? Math.round((v / r) * 100) : null; }
/** Gösterge çubuğu doluluğu 0..1: bant dizinine göre doğrusal (renk bantlarıyla uyumlu). */
export function doluluk(id, v) {
  const k = KIRLETICI[id], i = seviyeIndeks(id, v);
  if (!k || i == null) return 0;
  const alt = i === 0 ? 0 : k.esik[i - 1], ust = i === 5 ? k.esik[4] * 1.5 : k.esik[i];
  return Math.min(1, (i + Math.min(1, Math.max(0, (v - alt) / (ust - alt || 1)))) / 6);
}

const sayiYaz = (x, n) => Number(x).toLocaleString("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: n });
/** Değer + birim: { sayi:"35,2", birim:"µg/m³", tam:"35,2 µg/m³" }. Karbonmonoksit mg/m³ (µg/m³ ÷ 1000) ile yazılır; diğerleri µg/m³. Değer yoksa null. */
export function degerSayisi(id, v) {
  if (!Number.isFinite(v)) return null;
  const sayi = id === "co" ? sayiYaz(v / 1000, 2) : sayiYaz(v, v < 10 ? 1 : 0), birim = id === "co" ? "mg/m³" : "µg/m³";
  return { sayi, birim, tam: `${sayi} ${birim}` };
}
/** Seviye sınırları (üst sınırlar) sayı + birimle: [{ ad, ust:"≤ 15 µg/m³", sinif }] — son bant "üstü". Ekranda "iyi/kötü" yerine gerçek eşikleri göstermek için. */
export function sinirlar(id) {
  const k = KIRLETICI[id]; if (!k) return [];
  const b = (x) => degerSayisi(id, x).tam;
  return SEVIYELER.map((sv, i) => ({ ad: sv.ad, sinif: sv.sinif, idx: i, ust: i < 5 ? `≤ ${b(k.esik[i])}` : `> ${b(k.esik[4])}` }));
}
/** "Dünya Sağlık Örgütü rehberi 15 µg/m³" ya da null. */
export const rehberMetni = (id) => (KIRLETICI[id]?.rehber ? degerSayisi(id, KIRLETICI[id].rehber).tam : null);
/** Ekranda başlığın yanındaki bilimsel ad: "Azot dioksit · NO₂" (ince/kaba toz için boyutla). */
export const bilimselAd = (id) => { const k = KIRLETICI[id]; if (!k) return ""; return k.formul && k.formul !== "toz" ? `${k.bilimsel} · ${k.formul}${k.boyut ? ` (${k.boyut})` : ""}` : k.bilimsel; };

/** Değerleri sade Türkçe ile yazar: "metreküpte 35 mikrogram" (karbonmonoksit için miligram). */
export function degerMetni(id, v) {
  if (!Number.isFinite(v)) return "ölçüm yok";
  if (id === "co" && v >= 1000) return `metreküpte ${(v / 1000).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} miligram`;
  return `metreküpte ${Math.round(v * 10) / 10} mikrogram`.replace(".", ",");
}

/** Birimli istasyon ölçümünü µg/m³'e çevirir (25 °C, 1 atm). Tanınmayan birim → null. */
const MOL = { no2: 46.01, o3: 48.0, so2: 64.07, co: 28.01 };
export function mikrogramaCevir(id, deger, birim) {
  if (!Number.isFinite(deger)) return null;
  const b = String(birim || "").toLowerCase().replace(/\s/g, "").replace("μ", "µ");
  if (b === "µg/m³" || b === "µg/m3" || b === "ug/m3") return deger;
  if (b === "mg/m³" || b === "mg/m3") return deger * 1000;
  if (!MOL[id]) return null;
  const ppb = b === "ppb" ? deger : b === "ppm" ? deger * 1000 : null;
  return ppb == null ? null : ppb * (MOL[id] / 24.45);
}

/** İki koordinat arası km (haversine). */
export function mesafeKm(a1, o1, a2, o2) {
  const r = Math.PI / 180, dA = (a2 - a1) * r, dO = (o2 - o1) * r;
  const x = Math.sin(dA / 2) ** 2 + Math.cos(a1 * r) * Math.cos(a2 * r) * Math.sin(dO / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(x)));
}

/** Verilen değerlerden (id → µg/m³) en kötü bant ve baskın kirletici. Hiç değer yoksa null. */
export function genelDurum(degerler) {
  let en = null;
  for (const id of ANA_KIRLETICILER) {
    const v = degerler?.[id], i = seviyeIndeks(id, v);
    if (i == null) continue;
    const y = rehberYuzde(id, v) ?? 0;
    if (!en || i > en.idx || (i === en.idx && y > en.yuzde)) en = { idx: i, id, yuzde: y };
  }
  return en ? { idx: en.idx, ...SEVIYELER[en.idx], baskin: en.id } : null;
}
/** Avrupa AQI sayısından (Open-Meteo) bant dizini. */
export const eaqiIndeks = (aqi) => (!Number.isFinite(aqi) ? null : aqi <= 20 ? 0 : aqi <= 40 ? 1 : aqi <= 60 ? 2 : aqi <= 80 ? 3 : aqi <= 100 ? 4 : 5);
export { aqiSeviye };

/* ------------------------------ yaşam tavsiyeleri ------------------------------ */
const GENEL = [
  "Hava tertemiz; pencereleri açıp havalandırabilirsin.",
  "Hava temiz; her şeyi normal yapabilirsin.",
  "Çoğu kişi için sorun yok; çok hassassan yoğun eforu kısa tut.",
  "Dışarıda uzun süre kalmak yorabilir; yoğun egzersizi ertele.",
  "Dışarıdaki süreyi kısalt, mümkünse işlerini iç mekâna al.",
  "Dışarı çıkmaktan kaçın; çıkman gerekiyorsa maske tak.",
];
const HASSAS = [
  "Önlem gerekmez.", "Önlem gerekmez.",
  "Astım, kalp ya da akciğer rahatsızlığın varsa ilacını yanında taşı.",
  "Çocuklar, yaşlılar ve solunum hastaları dışarıdaki süreyi azaltsın.",
  "Hassas kişiler dışarı çıkmasın; iç mekânda kalsın.",
  "Hassas kişiler kesinlikle içeride kalsın; kapı ve pencereleri kapat.",
];
const SPOR = [
  "Dışarıda koşu ve bisiklet için uygun.", "Dışarıda spor yapabilirsin.", "Orta tempoda dışarıda spor yapılabilir.",
  "Yoğun sporu iç mekâna al ya da temposunu düşür.", "Dışarıda spor yapma.", "Dışarıda spor yapma; iç mekânda bile hafif tut.",
];
const PENCERE = [
  "Havalandırmak için uygun zaman.", "Havalandırabilirsin.", "Kısa süre havalandır.",
  "Havalandırmayı kısa tut, yoğun trafik saatlerinden kaçın.", "Pencereleri kapalı tut.", "Pencereleri kapalı tut; mümkünse hava temizleyici kullan.",
];
const BASKIN_NOT = {
  pm25: "Baskın kirletici: ince toz ve egzoz parçacıkları. FFP2 maske bu parçacıklara karşı en etkili önlemdir.",
  pm10: "Baskın kirletici: kaba toz ve polen. Alerjin varsa gözlerin ve burnun etkilenebilir.",
  o3: "Baskın kirletici: yüzey ozonu. Öğleden sonra güneşli saatlerde en yüksektir; sabah ya da akşam dışarı çık.",
  no2: "Baskın kirletici: trafik gazı. Yoğun yollardan ve trafik saatlerinden uzak dur.",
  co: "Baskın kirletici: karbonmonoksit. Kapalı mekânda soba, şofben ve motor çalıştırma.",
  so2: "Baskın kirletici: kükürt gazı. Sanayi bölgelerinden uzak dur.",
};
export function tavsiyeler(idx, baskinId) {
  const i = Math.min(5, Math.max(0, idx ?? 1));
  return {
    genel: GENEL[i], hassas: HASSAS[i], spor: SPOR[i], pencere: PENCERE[i],
    maske: i >= 4 ? "FFP2/N95 maske tak." : i === 3 ? "Uzun süre dışarıdaysan FFP2 maske düşün." : "Maske gerekmez.",
    baskinNot: i >= 2 ? BASKIN_NOT[baskinId] || "" : "",
  };
}

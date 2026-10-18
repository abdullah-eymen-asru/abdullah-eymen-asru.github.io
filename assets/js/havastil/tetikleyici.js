/**
 * tetikleyici.js — "Hangi veri hangi öneriyi tetikledi?" haritası (saf JS, DOM yok).
 * cekirdek.js kısıtları çıkarınca burada AKTİF TETİKLEYİCİLER listelenir; her kombin parçası ve her ekstra öneri,
 * hangi tetikleyicilerden doğduğunu id listesiyle taşır. Arayüz (Kombin sekmesi) iki yönlü gösterir:
 *   öneri → onu tetikleyenler,  tetikleyici → etkilediği öneriler.
 */
import { ESIK } from "./yagis-fizigi.js";

const SIRA = ["isi", "plan", "tolerans", "delta", "yagis", "surpriz", "zararsiz", "ruzgar", "firtina", "zemin", "buz", "kar", "sicak", "uv", "hava", "sis"];

/** Ekstra öneri grubu → olası tetikleyiciler (yalnızca aktif olanlar eklenir). */
const GRUP_TETIK = {
  "Yağış": ["yagis", "surpriz", "firtina", "plan"], "Rüzgâr": ["ruzgar", "firtina"], "Soğuk": ["isi", "ruzgar", "tolerans"], "Güneş": ["uv", "sicak"],
  "Hava": ["hava"], "Görünürlük": ["sis", "yagis"], "Ulaşım": ["yagis", "buz", "kar"], "Gün içi": ["delta", "plan"],
};
/** Kombin parçası → olası tetikleyiciler. */
const PARCA_TETIK = {
  b: ["isi", "plan", "tolerans", "sicak"],
  m: ["isi", "delta", "tolerans", "plan"],
  o: ["yagis", "surpriz", "ruzgar", "firtina", "kar", "isi"],
  p: ["yagis", "kar", "isi"],
  a: ["yagis", "zemin", "buz", "kar", "surpriz", "zararsiz"],
};

export function tetikleyicileriBul({ h, k, hedef, fz, tol, senaryoAd }) {
  const L = [];
  const ekle = (id, ikon, kisa, ad, olcum, esik, etki) => L.push({ id, ikon, kisa, ad, olcum, esik, etki });
  const gust = Math.round(h.gust ?? h.wind ?? 0);

  ekle("isi", "🌡️", "Isı", "Hissedilen sıcaklık", `${h.apparent}° (etkin ${hedef.etkin}°)`, `hedef yalıtım ${hedef.clo} CLO`, "İç kat, orta kat ve dış kabuğun toplam kalınlığını belirler.");
  ekle("plan", "🗓️", "Plan", `Planın: ${senaryoAd}`, "", "", "Aktivite düzeyini (ne kadar ısı ürettiğini) ve gün içi katman değişimini belirler.");
  if (tol) ekle("tolerans", "🧍", "Algın", "Sıcaklık algın", `${tol > 0 ? "çabuk terlerim" : "çabuk üşürüm"} (${tol > 0 ? "+" : ""}${tol}°)`, "", "Etkin sıcaklığı kaydırır; kombin daha ince ya da daha kalın seçilir.");
  if (k.moduler) ekle("delta", "↕️", "Gün içi fark", "Gün içi sıcaklık farkı", `ΔT = ${h.delta ?? 0}°`, "ΔT ≥ 8° veya gün boyu dışarıda", "Çıkarılabilir orta kat ve onu taşıyacak çanta/bağlama planı eklenir.");

  if (k.surpriz) ekle("surpriz", "⚡", "Sürpriz sağanak", "Sürpriz sağanak dedektörü", `CAPE ${fz?.capeMax ?? "—"} J/kg`, `PoP ≤ %${ESIK.surprizPop}, showers > 0, CAPE > ${ESIK.surprizCape}`, "Olasılık düşük görünse de su geçirmez kabuk ve bot; şemsiye yerine kapüşon.");
  if (k.yagis >= 1 && !k.surpriz) ekle("yagis", "🌧️", "Yağış", `Yağış: ${fz?.seviyeAd ?? "var"}`, fz ? `toplam ${fz.toplamMm} mm · E ${fz.beklenenMm} mm` : `%${h.rainProb}`, `saatlik ≥ ${ESIK.yagmurSaatlikMm} mm veya E ≥ ${ESIK.zararsizHacim} mm`, "Su geçirmez/itici dış kat, su itici pantolon ve ayakkabı; şemsiye ya da kapüşon.");
  if (k.zararsiz) ekle("zararsiz", "🌦️", "Zararsız çisenti", "Sahte alarm engelleyici", fz ? `PoP %${fz.enYuksekPop} ama E ${fz.beklenenMm} mm` : "", `PoP ≥ %${ESIK.zararsizPop} ve E < ${ESIK.zararsizHacim} mm`, "Şemsiye ve ağır bot ÖNERİLMEZ; ayakkabı ve kıyafet normal kalır.");
  if (k.ruzgar >= 1) ekle("ruzgar", "💨", "Rüzgâr", "Rüzgâr hamlesi", `${gust} km/s`, "≥ 35 km/s uyarı · > 40 km/s şemsiye yasak", "Rüzgâr geçirmez dış kat, boyunluk; gevşek parça taşınmaz.");
  if (k.semsiyeYasak) ekle("firtina", "🌪️", "Fırtına", "Şemsiye kırıcı", `CAPE ${fz?.capeMax ?? "—"} J/kg · hamle ${fz?.hamleMax ?? gust} km/s`, `CAPE > ${ESIK.firtinaCape} J/kg veya hamle > ${ESIK.firtinaHamle} km/s`, "Şemsiye listeden çıkar; kapüşonlu teknik kabuk giyilir.");
  if ((h.recentPrecip ?? 0) >= 1) ekle("zemin", "💧", "Islak zemin", "Son 6 saatte yağış", `${h.recentPrecip} mm`, "≥ 1 mm", "Zemin ıslak: su itici/kaymaz ayakkabı.");
  if (k.buz) ekle("buz", "🧊", "Don", "Don riski", `en düşük ${h.minRaw}°`, "≤ 1° veya don uyarısı", "Kaymaz taban, yün çorap, dikkatli adım.");
  if (k.kar) ekle("kar", "❄️", "Kar", "Kar / karla karışık yağış", "", "", "Su geçirmez, kaymaz ve sıcak tutan parçalar.");
  if (k.sicak) ekle("sicak", "🔥", "Sıcak", "Yüksek etkin sıcaklık", `${hedef.etkin}°`, "≥ 27°", "İnce, nefes alan kumaşlar; su ve gölge önerileri.");
  if ((h.uv ?? 0) >= 3) ekle("uv", "☀️", "UV", "UV indeksi", `${h.uv}`, "≥ 3", "Güneş kremi, gözlük, şapka.");
  if (k.col || (h.aqi ?? 0) >= 80) ekle("hava", "😷", "Hava kalitesi", "Hava kalitesi / toz", k.col ? "çöl tozu" : `AQI ${h.aqi}`, "AQI ≥ 80 veya yüksek toz", "Maske ve iç mekân önlemleri.");
  if (k.sis) ekle("sis", "🌫️", "Sis", "Sis uyarısı", "", "", "Görünür kalmak için yansıtıcı detay.");

  L.sort((a, b) => SIRA.indexOf(a.id) - SIRA.indexOf(b.id));
  const var_ = new Set(L.map((x) => x.id));
  const aktif = (liste) => liste.filter((i) => var_.has(i));
  const parca = Object.fromEntries(Object.entries(PARCA_TETIK).map(([s, l]) => [s, aktif(l)]));
  const grup = (g) => aktif(GRUP_TETIK[g] || []);
  return { liste: L, parca, grup };
}

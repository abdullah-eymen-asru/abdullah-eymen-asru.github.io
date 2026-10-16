/**
 * taktik.js — MOD A: YEREL KURAL MOTORU (sıfır maliyet, LLM yok). Filtreden geçmiş temiz başlığı doğrudan GİYİM kurallarına çevirir
 * ve cekirdek.js'in kararının ÜSTÜNE bindirir (çekirdek bozulmaz; aynı girdi → aynı çıktı).
 * Kullanıcının istediği 4 kural: fırtına/lodos · çöl tozu · don/buzlanma · sarı/turuncu(/kırmızı) kodlu sağanak.
 * Benim eklediklerim: kar/tipi · sıcak hava dalgası · yoğun sis.
 */
import { normalize } from "./iller.js";
import { KATMAN } from "./cekirdek.js";

const SEVIYE_SIRA = { uyari: 0, sari: 1, turuncu: 2, kirmizi: 3 };
const SEVIYE_AD = { uyari: "Uyarı", sari: "Sarı kod", turuncu: "Turuncu kod", kirmizi: "Kırmızı kod" };

function renkKodu(t) { return /kirmizi kod/.test(t) ? "kirmizi" : /turuncu kod/.test(t) ? "turuncu" : /sari kod/.test(t) ? "sari" : "uyari"; }

export const KURALLAR = [
  { id: "firtina", ikon: "🌪️", etiket: "Fırtına / lodos / kuvvetli rüzgâr", oncelik: 5,
    var: (t) => /(^|[^a-z0-9])(firtina|lodos|poyraz|kasirga|hortum)/.test(t) || /(kuvvetli|siddetli|sert) ruzgar|ruzgar (uyarisi|siddeti)|saatte \d+ km hizla esen/.test(t) },
  { id: "col_tozu", ikon: "🏜️", etiket: "Çöl tozu / toz taşınımı", oncelik: 4,
    var: (t) => /col tozu|sahra tozu|saharadan|toz tasinimi|toz bulutu|toz firtinasi/.test(t) },
  { id: "don", ikon: "🧊", etiket: "Don / buzlanma", oncelik: 5,
    var: (t) => /buzlanma|gizli buz|zirai don|(^|[^a-z0-9])don (olayi|riski|uyarisi|olacak|bekleniyor)|(^|[^a-z0-9])donma/.test(t) },
  { id: "saganak", ikon: "⛈️", etiket: "Sağanak / kuvvetli yağış", oncelik: 5,
    var: (t) => /saganak|(siddetli|kuvvetli|cok kuvvetli) yagis|sel (uyarisi|riski|tehlikesi|baskini)/.test(t) || (/(sari|turuncu|kirmizi) kod/.test(t) && /yagis|yagmur|sel([^a-z0-9]|$)/.test(t)) },
  { id: "kar", ikon: "❄️", etiket: "Kar / tipi", oncelik: 4,
    var: (t) => /(yogun|kuvvetli|siddetli) kar|kar yagisi|(^|[^a-z0-9])tipi|kar firtinasi/.test(t) },
  { id: "sicak", ikon: "🥵", etiket: "Sıcak hava dalgası", oncelik: 3,
    var: (t) => /sicak hava dalgasi|asiri sicak|bunaltici sicak|sicaklik uyarisi/.test(t) },
  { id: "sis", ikon: "🌫️", etiket: "Yoğun sis", oncelik: 2,
    var: (t) => /yogun sis|sis uyarisi|goruş mesafesi|gorus mesafesi/.test(t) },
];

/** Temiz başlığı (+özet) kurallara çevir. Eşleşme yoksa [] → haber "kritik" sayılmaz. */
export function kurallariCikar({ baslik, ozet }) {
  const t = normalize(`${baslik} ${ozet || ""}`);
  const seviye = renkKodu(t);
  return KURALLAR.filter((k) => k.var(t)).map((k) => ({ id: k.id, ikon: k.ikon, etiket: k.etiket, oncelik: k.oncelik, seviye }));
}
export const seviyeAdi = (s) => SEVIYE_AD[s] || "Uyarı";
export const seviyePuani = (kurallar) => Math.max(0, ...kurallar.map((k) => SEVIYE_SIRA[k.seviye] * 10 + k.oncelik));

const AGIR = new Set(["o_orta", "o_teknik_dolgulu", "o_kalin"]);
const KISA = {
  firtina: "Şemsiyeyi bırak, kapüşonlu rüzgarlık giy.",
  col_tozu: "Açık renk giyme, maske tak.",
  don: "Derin kauçuk dişli (kaymaz) bot giy.",
  saganak: "Su geçirmez dış kabuk giy.",
  kar: "Su geçirmez, kaymaz kışlık bot ve sıcak dış kat giy.",
  sicak: "En hafif, açık renk kıyafeti seç; su taşı.",
  sis: "Trafikte görünür ol: parlak/yansıtıcı bir parça ekle.",
};

/**
 * Çekirdek sonucuna taktik kurallarını bindirir. Girdi DEĞİŞMEZ; yeni nesne döner.
 * @param {object} sonuc degerlendir() çıktısı  @param {Array} kurallar kurallariCikar() birleşimi (id başına en yüksek seviye)
 */
export function taktikUygula(sonuc, kurallar) {
  if (!kurallar?.length) return sonuc;
  const idler = new Map();
  for (const k of kurallar) { const o = idler.get(k.id); if (!o || SEVIYE_SIRA[k.seviye] > SEVIYE_SIRA[o.seviye]) idler.set(k.id, k); }
  const var_ = (id) => idler.has(id);
  const kodlar = { ...sonuc.kodlar };
  const katmanlar = { ...sonuc.katmanlar };
  let aks = [...sonuc.aksesuar], ayak = sonuc.ayakkabi, renk = sonuc.renk;
  const yasaklar = [], notlar = [];
  const ata = (anah, kod) => { kodlar[anah] = kod; katmanlar[{ b: "cekirdek", m: "orta", o: "kabuk" }[anah]] = { kod, ...KATMAN[kod] }; };
  const ekle = (x) => { if (!aks.includes(x)) aks.push(x); };
  const cikar = (alt) => { aks = aks.filter((a) => !a.toLowerCase().includes(alt)); };

  if (var_("sicak")) { ata("b", "b_hafif"); ata("m", "m_yok"); ata("o", "o_yok"); ekle("🧢 Şapka"); ekle("💧 Su matarası"); }
  if (var_("kar")) {
    if (["o_yok", "o_ruzgarlik", "o_hafif_kabuk", "o_yagmurluk", "o_orta"].includes(kodlar.o)) ata("o", sonuc.clo >= 1.2 ? "o_kalin" : "o_teknik_dolgulu");
    ekle("🧤 Eldiven"); ekle("🧢 Bere");
    ayak = "Kar/tipi uyarısı: su geçirmez, kaymaz tabanlı kışlık bot giy.";
  }
  if (var_("saganak")) {
    const sev = idler.get("saganak").seviye;
    if (["o_yok", "o_ruzgarlik", "o_hafif_kabuk"].includes(kodlar.o) || (["turuncu", "kirmizi"].includes(sev) && kodlar.o === "o_orta")) ata("o", "o_yagmurluk");
    else if (AGIR.has(kodlar.o)) notlar.push("Dış katman su itici olmalı; değilse üstüne yağmurluk ekle.");
    if (!var_("firtina")) ekle("🌂 Katlanır şemsiye");
    ayak = var_("don") ? ayak : "Sağanak uyarısı: su geçirmez (kauçuk/membranlı) bot veya ayakkabı giy; süet ve bez ayakkabıdan kaçın.";
    yasaklar.push("Süet / bez ayakkabı");
  }
  if (var_("firtina")) {
    if (kodlar.o === "o_yok") ata("o", "o_ruzgarlik");
    else notlar.push("Dış katman rüzgâr geçirmez ve kapüşonlu olsun.");
    cikar("şemsiye"); yasaklar.push("Şemsiye (rüzgâr ters çevirir)"); ekle("🧣 Boğazı koruyan ince atkı");
  }
  if (var_("col_tozu")) {
    renk = "Çöl tozu uyarısı: açık renk giyme (toz ve çamurlu yağmur lekesi çok belli olur); orta/koyu ton ve kapalı yaka seç.";
    ekle("😷 FFP2/N95 maske"); ekle("🕶️ Kapalı çerçeveli gözlük"); yasaklar.push("Açık renk kıyafet");
  }
  if (var_("don")) {
    ayak = "Don/buzlanma uyarısı: derin kauçuk dişli (kaymaz tabanlı) bot giy; düz tabanlı sneaker ve deri taban yasak.";
    ekle("🧤 Eldiven"); yasaklar.push("Düz / deri tabanlı ayakkabı");
  }
  if (var_("sis")) { renk = "Yoğun sis: trafikte görünür olmak için parlak veya yansıtıcı bir dış parça seç."; ekle("🦺 Yansıtıcı detay"); }
  if (var_("sicak")) renk = "Sıcak hava dalgası: güneşi yansıtan açık tonlar (beyaz, bej) ve geniş, bol kesimler.";

  const ust = [...idler.values()].sort((a, b) => (SEVIYE_SIRA[b.seviye] * 10 + b.oncelik) - (SEVIYE_SIRA[a.seviye] * 10 + a.oncelik))[0];
  const hukum = `⚠ ${ust.etiket} (${seviyeAdi(ust.seviye)}): ${KISA[ust.id]}`;
  const gorunen = [KATMAN[kodlar.b].ad, kodlar.m !== "m_yok" ? KATMAN[kodlar.m].ad : null, kodlar.o !== "o_yok" ? KATMAN[kodlar.o].ad : null].filter(Boolean).join(" + ");
  return {
    ...sonuc, kodlar, katmanlar, aksesuar: aks, ayakkabi: ayak, renk, hukum, gorunenKatmanMetni: gorunen,
    taktikler: [...idler.values()].map((k) => ({ id: k.id, ikon: k.ikon, etiket: k.etiket, seviye: k.seviye, kisa: KISA[k.id] })),
    yasaklar, taktikNotlari: notlar,
  };
}

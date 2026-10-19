/**
 * cekirdek.js — HavaStil DETERMİNİSTİK KARAR MOTORU v2 (saf JS: DOM yok, ağ yok, AI yok).
 * ---------------------------------------------------------------------------------------------------------------
 * Aynı girdi (+ aynı gün) HER ZAMAN aynı çıktıyı verir. Yapay zekâ (Groq) yalnızca sonradan eklenen yorumdur; karara karışmaz.
 *
 * 1) HEDEF CLO (şartname § 2.F):   Hedef = (33 − T_etkin) / 15 − aktivite          (0,25 … 2,6 arası sınırlanır)
 *      T_etkin = T_hissedilen + kişisel tolerans (−3/0/+3) + küçük nem/ıslaklık düzeltmesi.
 *      (Hissedilen sıcaklık Open-Meteo'da rüzgâr, nem ve güneş ışınımını ZATEN içerir → burada ikinci kez sayılmaz.)
 * 2) GERÇEK GİYSİLERLE TOPLAM:      Toplam = 0,10 (iç çamaşırı+çorap) + 0,85 × Σ giysi CLO'su   (ISO 9920'ye yakın basit model)
 *      Kombin, katalogdaki (katalog.js) ~70 parça arasından tüm üst/orta/kabuk/alt kombinasyonları puanlanarak seçilir:
 *      hedefe yakınlık + kısıtlar (yağış, rüzgâr, buz/kar, sıcak ofis, modülerlik, sıcak hava, UV) + stil + günlük çeşitleme.
 * 3) ÇEŞİTLİLİK: stil=auto iken günün tarihinden türeyen "tohum" öncelikli stil ve eşit parçalar arasındaki seçimi döndürür;
 *      her çalıştırmada 3 farklı kombin (ana + 2 alternatif) döner.
 * 4) ZAMAN PLANI: sabah/öğle/akşam için ayrı CLO ihtiyacı → "şunu çıkar / şunu ekle".
 * Haber taktikleri (taktik.js) bu motora KISIT olarak girer (ek.kurallar); sonradan üstüne yama yapılmaz.
 * v3: yağış ve fırtına kısıtları artık yagis-fizigi.js'ten gelir (ek.fizik): saatlik PoP × hacim, showers, CAPE ve hamle kuralları.
 *     Zararsız çisentide şemsiye/ağır bot kısıtı YOK; CAPE > 1500 J/kg veya hamle > 40 km/s ise şemsiye sistemden çıkar.
 * v5: KAR/BUZLANMA algılanınca (karZorunlu) şemsiye KESİNLİKLE iptal; derin kauçuk dişli kar botu, termal içlik (iç kat), yün/polar ara katman, dış kabuk ve bere + eldiven ZORUNLU kılınır (aday listeleri bu parçalarla sınırlanır).
 */
import { tetikleyicileriBul } from "./tetikleyici.js";
import { KATALOG, SLOT_LISTE, STILLER, ARALIK, OZEL } from "./katalog.js";

export { KATALOG, STILLER };
export const SENARYOLAR = {
  toplu:        { ad: "🚶 Yaya / Toplu taşıma",   aktivite: 0.15, ipucu: "Kısa yürüyüşler, dur-kalk." },
  yuruyus_ofis: { ad: "🏢 Yürüyüş + sıcak ofis",  aktivite: 0.10, ipucu: "≈40 dk yürüyüş, ardından 21–23 °C ofis: çekirdek ofiste rahat, kabuk yürüyüşte koruyucu." },
  disari:       { ad: "🌳 Gün boyu dışarıda",     aktivite: 0.10, ipucu: "Sabah–akşam farkı için çıkarılabilir katmanlar." },
  arac:         { ad: "🚗 Araç / kapıdan kapıya", aktivite: 0.25, ipucu: "Isıtmalı araç, kısa mesafe." },
  gezi:         { ad: "🧭 Gün boyu gezi",         aktivite: 0.20, ipucu: "Uzun yürüyüş, durup bakma, açık havada bekleme." },
  spor:         { ad: "🏃 Koşu / spor",           aktivite: 0.35, ipucu: "Yüksek efor: vücut ısınır, normalden bir kat az giy." },
};
export const CANTA_SECENEKLERI = { yok: "👖 Çantam yok", el: "👜 El çantası", sirt: "🎒 Sırt çantası" };
export const TOLERANSLAR = { "-3": "❄️ Çabuk üşürüm", "0": "⚖️ Normal", "3": "🔥 Çabuk terlerim" };
export const STIL_SECENEKLERI = { auto: "🎲 Otomatik (günlük)", K: "🎩 Klasik", S: "🏃 Sportif", C: "🧢 Sokak", M: "◻️ Minimalist", D: "🏔️ Dış mekân" };

const sinirla = (x, a, b) => Math.min(b, Math.max(a, x));
const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const TABAN_CLO = 0.10, KATSAYI = 0.85;
export const toplamClo = (parcalar) => r2(TABAN_CLO + KATSAYI * parcalar.reduce((t, p) => t + (p ? p.clo : 0), 0));

/** Hedef CLO. h = { apparent, raw, hum, precip }; tolerans ve senaryo kişisel. */
export function hedefClo(h, tolerans, senaryo) {
  const s = SENARYOLAR[senaryo] || SENARYOLAR.toplu;
  const tol = Number(tolerans) || 0;
  const notlar = [];
  let etkin = h.apparent + tol;
  if (tol) notlar.push(`Kişisel tolerans ${tol > 0 ? "+" : ""}${tol} °C`);
  if ((h.raw ?? 20) <= 10 && (h.hum ?? 0) >= 85) { etkin -= 1; notlar.push("Soğuk + yüksek nem: −1 °C"); }
  if ((h.precip ?? 0) >= 0.5) { etkin -= 1; notlar.push("Islak kıyafet daha çabuk üşütür: −1 °C"); }
  const ham = (33 - etkin) / 15 - s.aktivite;
  return { clo: r2(sinirla(ham, 0.25, 2.6)), etkin: r1(etkin), aktivite: s.aktivite, notlar };
}

/* ------------------------------ yardımcılar ------------------------------ */
function karma(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0); }
/** Günün tohumu: konumun yerel tarihi (guncelleme "YYYY-MM-DDTHH:MM") — aynı gün aynı sonuç, ertesi gün farklı çeşitleme. */
function tohumHesapla(h, t) {
  const gun = String(h.guncelleme || "").slice(0, 10);
  const [y, a, g] = gun.split("-").map(Number);
  const gunNo = Number.isFinite(y) ? Math.floor(Date.UTC(y, a - 1, g) / 864e5) : 0;
  return gunNo + (Number(t.tohumKaydir) || 0);
}
const STIL_SIRASI = ["C", "K", "S", "M", "D"];

function kisitlariCikar(h, t, ek) {
  const kural = ek?.kurallar || {};        // { firtina:{seviye}, saganak:{seviye}, don, kar, sicak, col_tozu, sis }
  const sev = (id) => ({ uyari: 1, sari: 1, turuncu: 2, kirmizi: 3 }[kural[id]?.seviye] || (kural[id] ? 1 : 0));
  const gust = h.gust ?? (h.wind || 0) * 1.4;
  const fz = ek?.fizik || null;
  // Yağış: fizik motoru varsa onun seviyesi (PoP tek başına karar vermez); yoksa eski olasılık kuralı. Islak zemin (son 6 saat ≥ 1 mm) her durumda ayakkabıyı etkiler.
  const yagis = fz
    ? Math.max(fz.kisit.yagis, (h.recentPrecip ?? 0) >= 1 ? 1 : 0, sev("saganak"))
    : Math.max(
      (h.rainProb ?? 0) >= 40 || (h.precip ?? 0) >= 0.2 || (h.recentPrecip ?? 0) >= 1 ? 1 : 0,
      (h.precip ?? 0) >= 1.5 ? 2 : 0, (h.precip ?? 0) >= 4 ? 3 : 0, sev("saganak"));
  const ruzgar = Math.max((gust >= 35 || (h.wind || 0) >= 25) ? 1 : 0, (gust >= 55 || (h.wind || 0) >= 38) ? 2 : 0, sev("firtina") ? 2 : 0, fz?.kisit.ruzgar ?? 0);
  const buz = (h.minRaw ?? 20) <= 1 || !!kural.don || (fz?.buzlanma?.maxSeviye ?? 0) >= 2;
  const kar = !!kural.kar || ((h.raw ?? 20) <= 2 && (h.precip ?? 0) > 0) || (h.snow ?? 0) > 0 || !!fz?.kar?.var;
  // v5: kar/buzlanma KESİN algılandı (fizik motoru, ya da doğrulanmış haber kuralı: kar/don) → şemsiye iptal + zorunlu kış donanımı
  const karZorunlu = !!fz?.kisit?.karZorunlu || !!kural.kar || !!kural.don;
  const sicak = !!kural.sicak || (h.__etkin ?? h.apparent) >= 27;
  return { yagis, ruzgar, semsiyeYasak: !!fz?.semsiyeYasak || ruzgar >= 2 || karZorunlu, zararsiz: !!fz?.zararsiz, surpriz: !!fz?.surpriz, buz, kar, karZorunlu, sicak, sicakAsiri: (h.__etkin ?? h.apparent) >= 32, sis: !!kural.sis, col: !!kural.col_tozu || (h.dust ?? 0) >= 80,
    uv: h.uv ?? 0, ofis: t.senaryo === "yuruyus_ofis", spor: t.senaryo === "spor", arac: t.senaryo === "arac",
    cantaYok: t.canta === "yok", canta: t.canta || "el",
    moduler: ((h.delta ?? 0) >= 8 && t.senaryo !== "arac") || t.senaryo === "disari" || t.senaryo === "gezi" };
}

const var_ = (p, e) => !!p && p.etiket.has(e);
/** v5 zorunlu kış donanımı: termal içlik (iç kat), yün/polar ara katman, derin kauçuk dişli kar botu. */
const KAR_TERMAL = new Set(["b_termal_ic", "b_merino_orta"]);
const yunPolar = (x) => !!x && (var_(x, "y") || String(x.id).includes("polar"));
const zorunluParca = (slot, x) => (slot === "b" ? KAR_TERMAL.has(x.id) : slot === "m" ? yunPolar(x) : slot === "a" ? x.id === "a_kar_botu" : false);

/** Bir kombinin (b,m,o,p) kısıt cezası ve bonusu. Ayakkabı ayrıca değerlendirilir. */
const sadeceSpor = (x) => x && x.stil.has("S") && !x.stil.has("K") && !x.stil.has("C") && !x.stil.has("M");
const sadeceKlasik = (x) => x && x.stil.has("K") && !x.stil.has("S") && !x.stil.has("C") && !x.stil.has("M");
function kombinPuani(k, b, m, o, p, hedef, st, tercihStiller, tohum, ceza) {
  const toplam = TABAN_CLO + KATSAYI * (b.clo + (m?.clo || 0) + (o?.clo || 0) + p.clo);
  let puan = -150 * Math.abs(toplam - hedef) - (ceza.get(b.id) || 0) - (m ? ceza.get(m.id) || 0 : 0) - (o ? ceza.get(o.id) || 0 : 0) - (ceza.get(p.id) || 0);
  // stil tutarlılığı: sportif-yalnız ile klasik-yalnız parça aynı kombinde olmasın
  const parcalar = [b, m, o, p].filter(Boolean);
  if (parcalar.some(sadeceSpor) && parcalar.some(sadeceKlasik)) puan -= 14;
  // --- yağış ---
  if (k.yagis >= 2 && o && !var_(o, "g")) puan -= 110;
  if (k.yagis >= 2 && !o) puan -= 140;
  if (k.yagis === 1 && o && !var_(o, "s") && !var_(o, "g")) puan -= 12;   // şemsiye ile tolere edilir
  if (k.yagis >= 1 && var_(p, "s")) puan += 5;
  // --- rüzgâr ---
  if (k.ruzgar >= 1 && o && !var_(o, "r")) puan -= 60;
  if (k.ruzgar >= 2 && !o) puan -= 90;
  // --- kar / buz ---
  if (k.kar && o && !var_(o, "s") && !var_(o, "g")) puan -= 40;
  if (k.kar && p.clo < 0.3) puan -= 25;
  if (k.karZorunlu) {                                             // v5: termal içlik + yün/polar ara kat + dış kabuk zorunlu
    if (!KAR_TERMAL.has(b.id)) puan -= 220;
    if (!yunPolar(m)) puan -= 220;
    if (!o) puan -= 200;
  }
  // --- sıcak hava ---
  if (k.sicak) {
    if (m) puan -= 140;
    if (o && !(var_(o, "h") && (k.yagis || k.ruzgar))) puan -= 140;
    if (!var_(b, "n") && !var_(b, "t")) puan -= 40;
    if (!var_(p, "n") && p.clo > 0.2) puan -= 40;
  }
  // --- sıcak ofis: çekirdek (iç kat) ofiste rahat olmalı; kalın yün/tek parça yasak ---
  if (k.ofis) {
    const cekirdek = TABAN_CLO + KATSAYI * (b.clo + (m?.clo || 0) + p.clo + 0.06);
    if (cekirdek > 0.80) puan -= 500 * (cekirdek - 0.80);
    if (var_(b, "a") || var_(m, "a")) puan -= 300;
    if (m && !var_(m, "p")) puan -= 25;
    if (!var_(b, "o")) puan -= 12;
    if (o && !(var_(o, "h") || var_(o, "r") || var_(o, "s") || var_(o, "g"))) puan -= 8;
  }
  // --- çanta yok: şemsiye/elde taşıma zor → yağmurlukla çöz; çıkaracağın katman cebe/bele sığmalı ---
  if (k.cantaYok) {
    if (k.yagis >= 1 && o && !(var_(o, "g") || var_(o, "s"))) puan -= 30;
    if (k.moduler && m && m.clo > 0.3) puan -= 22;
    if (k.moduler && o && o.clo > 0.45 && toplam < 1.7) puan -= 18;
  }
  // --- spor: nefes alan/hızlı kuruyan ---
  if (k.spor) {
    if (!var_(b, "t")) puan -= 25;
    if (!var_(p, "t") && !var_(p, "n")) puan -= 12;
    if (m && m.clo > 0.3) puan -= 15;
  }
  // --- modüler gün: ara katman çıkarılabilir olmalı ---
  if (k.moduler) {
    if (m && !var_(m, "p")) puan -= 35;
    if (o && o.clo > 0.5 && !var_(o, "h") && toplam < 1.6) puan -= 18;
  }
  // --- UV: uzun kollu/koruyucu üst küçük bonus ---
  if (k.uv >= 6 && (var_(b, "u") || b.clo >= 0.2)) puan += 4;
  // --- stil + günlük çeşitleme ---
  const eslesme = [b, m, o, p].filter(Boolean).reduce((t, x) => t + [...x.stil].filter((s) => tercihStiller.includes(s)).length, 0);
  puan += st * eslesme;
  puan += (karma(`${tohum}|${b.id}|${m?.id}|${o?.id}|${p.id}`) % 1000) / 1000 * 13; // ±0,09 CLO içindeki kombinler 'eşit iyi' sayılır → günlük çeşitleme
  return { puan, toplam: r2(toplam) };
}

function ayakkabiPuani(k, a, hedefAyak, tercihStiller, tohum, st, ceza) {
  let puan = -(ceza.get(a.id) || 0);
  if ((a.etiket.has("g")) && k.yagis === 0 && !k.buz && !k.kar) puan -= 8;      // kuru havada gereksiz teknik ayakkabı
  if ((k.buz || k.kar) && !var_(a, "k")) puan -= 120;
  if (k.karZorunlu) puan += a.id === "a_kar_botu" ? 400 : -150;       // v5: derin kauçuk dişli kar botu zorunlu
  if (k.kar && !var_(a, "g")) puan -= 80;
  if (k.buz && !var_(a, "s") && !var_(a, "g")) puan -= 30;
  if (k.yagis >= 1 && var_(a, "x")) puan -= 90;
  if (k.yagis >= 2 && !var_(a, "g")) puan -= 40;
  if (k.yagis === 1 && !var_(a, "s") && !var_(a, "g")) puan -= 15;
  if (k.sicak && a.clo > 0.1) puan -= 50;
  if (!k.sicak && hedefAyak > 1.4 && a.clo < 0.1) puan -= 20;
  if (hedefAyak > 1.9 && a.clo < 0.2) puan -= 25;
  if (k.ofis && !var_(a, "o") && !var_(a, "k")) puan -= 6;
  puan += st * [...a.stil].filter((s) => tercihStiller.includes(s)).length;
  puan += (karma(`${tohum}|${a.id}`) % 1000) / 1000 * 4;
  return puan;
}

/** Kombindeki parçalarda en çok geçen stil (tercih edilen kümeye öncelik). */
function baskinStil(parcalar, kume) {
  const say = {};
  for (const x of parcalar.filter(Boolean)) for (const s of x.stil) say[s] = (say[s] || 0) + (kume.includes(s) ? 1.5 : 1);
  return Object.entries(say).sort((a, b) => b[1] - a[1])[0]?.[0] || kume[0];
}
/** Kombin nesnesi (UI/AI için). */
const parca = (x) => (x ? { id: x.id, ad: x.ad, slot: x.slot, clo: x.clo, kumas: x.kumas } : null);

/* ------------------------------ ekstralar, renk, kaçın ------------------------------ */
/**
 * Gündelik hayata uygun ek öneriler. Her biri: { grup, ikon, ad, neden, oncelik:'sart'|'iyi'|'olabilir', agirlik:'hafif'|'orta'|'agir', cebeSigar:boolean }
 * Çanta durumu (t.canta: yok/el/sirt) önerileri değiştirir: çantası yoksa ağır/büyük şeyler yerine cebe sığanlar (yağmurluk, ince eldiven) öne çıkar.
 */
function ekstralar(k, h, etkin, kombin) {
  const e = [];
  const ekle = (grup, ikon, ad, neden, oncelik = "iyi", agirlik = "hafif", cebeSigar = true) => e.push({ grup, ikon, ad, neden, oncelik, agirlik, cebeSigar });
  const gust = Math.round(h.gust ?? h.wind ?? 0);
  const disarida = !k.arac;

  // ---- Yağış ----
  if (k.yagis >= 1) {
    const kapusonVar = kombin?.o && (var_(kombin.o, "g") || var_(kombin.o, "s"));
    if (k.cantaYok || k.semsiyeYasak || k.spor || k.surpriz) {
      ekle("Yağış", "🧥", kapusonVar ? "Kapüşonu kullan (dış kat su geçirmez/itici)" : "Hafif kapüşonlu yağmurluk / panço", k.cantaYok ? "Çantan yok: şemsiye elini bağlar, yağmurluk eller serbest ve ~150 g, cebe sığar" : k.semsiyeYasak ? "Hamle/fırtına riski: şemsiye açmak tehlikeli ve işlevsiz, kapüşon güvenli" : k.surpriz ? "Ani sağanakta şemsiye açmaya vakit kalmaz; kapüşon anında devrede" : "Rüzgârda şemsiye ters döner, kapüşon güvenli", "sart", "hafif", true);
    } else {
      ekle("Yağış", "🌂", "Katlanır şemsiye", `Yağış ihtimali %${h.rainProb}; ~300 g, ${k.canta === "sirt" ? "sırt çantasının yan cebine" : "çantana"} sığar`, k.yagis >= 2 ? "sart" : "iyi", "orta", false);
      if (k.yagis === 1 && disarida) ekle("Yağış", "🧥", "Yedek: ince yağmurluk", "Şemsiyeyi unutursan ya da rüzgâr çıkarsa", "olabilir", "hafif", true);
    }
    if (k.yagis >= 2) ekle("Yağış", "📱", "Telefon için su geçirmez kılıf / zip poşet", "Kuvvetli yağışta cihaz ve cüzdanı korur", "iyi", "hafif", true);
    if (k.yagis >= 2 && (k.ofis || k.arac === false)) ekle("Yağış", "🧦", "Yedek çorap", "Islak ayakla gün boyu oturmak üşütür", "iyi", "hafif", k.canta !== "yok");
    if (k.yagis >= 2 && k.canta === "sirt") ekle("Yağış", "🎒", "Sırt çantası yağmur kılıfı", "Laptop/evrak ıslanmasın", "iyi", "hafif", true);
    if (k.arac) ekle("Ulaşım", "🚗", "Yağmurda mesafeyi artır, silecekleri kontrol et", "Islak zeminde fren mesafesi uzar", "iyi", "hafif", true);
  }
  // ---- Rüzgâr ----
  if (k.ruzgar >= 1 && etkin <= 16) ekle("Rüzgâr", "🧣", "Boyunluk / ince atkı", `Hamle ${gust} km/s: boynu kapatmak hissedilen soğuğu azaltır`, "iyi", "hafif", true);
  if (k.ruzgar >= 2 && disarida) ekle("Rüzgâr", "🕶️", "Gözlük (toz/çöp için)", "Sert rüzgârda göze toz ve parça kaçar", "olabilir", "hafif", true);
  if (k.ruzgar >= 2) ekle("Rüzgâr", "🏗️", "Ağaç/çatı/afiş altından geçme", "Sert hamlede düşen cisim riski", "iyi", "hafif", true);
  // ---- Soğuk ----
  if (etkin <= 8 || (k.ruzgar >= 1 && etkin <= 12) || k.karZorunlu) ekle("Soğuk", "🧢", "Bere / kulak örten başlık", k.karZorunlu ? "Kar/buzlanma: zorunlu aksesuar; baştan ısı kaybı yüksek" : "Baştan ısı kaybı yüksek", k.karZorunlu ? "sart" : "iyi", "hafif", true);
  if (etkin <= 5 || k.karZorunlu) ekle("Soğuk", "🧤", etkin <= -2 || k.karZorunlu ? "Su geçirmez / kalın eldiven" : "İnce eldiven", k.karZorunlu ? "Kar/buzlanma: zorunlu aksesuar; ıslak eldiven üşütür" : "Eller ve parmaklar ilk üşüyen uçlardır", etkin <= 0 || k.karZorunlu ? "sart" : "iyi", "hafif", true);
  // ---- Kar / Buzlanma (v5): zorunlu donanım ----
  if (k.karZorunlu) {
    ekle("Kar/Buz", "🥾", "Derin kauçuk dişli kar botu", "Kar/buzlanma: dişli, su geçirmez, kaymaz taban zorunlu", "sart", "agir", false);
    ekle("Kar/Buz", "🧥", "Termal içlik + yün/polar ara katman", "Nem taşıyan iç kat + ısıyı tutan ara kat; dış kabuk bunların üstüne", "sart", "orta", false);
    ekle("Kar/Buz", "☂️", "Şemsiye iptal", "Kar/buzlanmada şemsiye eli bağlar, rüzgârda işe yaramaz; kapüşonlu kabuk yeter", "sart", "hafif", true);
  }
  if (etkin <= 3 || k.buz) ekle("Soğuk", "🧦", "Yün/merino çorap", "Terletmeden sıcak tutar", "iyi", "hafif", true);
  if (etkin <= 0) ekle("Soğuk", "🔥", "Tek kullanımlık el ısıtıcı", "Uzun beklemelerde (durak, peron) çok işe yarar", "olabilir", "hafif", true);
  if (etkin <= 3) ekle("Soğuk", "☕", "Termos / sıcak içecek", "Bekleme ve yolculukta iç ısıtır", "olabilir", "orta", k.canta !== "yok");
  if (etkin <= 5 && (h.hum ?? 50) < 55 || (k.ruzgar >= 1 && etkin <= 8)) ekle("Soğuk", "💄", "Dudak koruyucu + el kremi", "Soğuk ve rüzgâr cildi kurutur/çatlatır", "olabilir", "hafif", true);
  if (etkin <= 2) ekle("Soğuk", "🔋", "Powerbank (cebinde sıcak tut)", "Soğukta telefon pili çok hızlı biter", "iyi", "orta", k.canta !== "yok");
  // ---- Sıcak & Güneş ----
  if (h.uv >= 3 && (h.cloud ?? 0) < 85 && disarida) ekle("Güneş", "🕶️", "UV korumalı gözlük", `UV indeksi ${h.uv}`, "iyi", "hafif", true);
  if (h.uv >= 3 && disarida) ekle("Güneş", "🧴", h.uv >= 6 ? "SPF 50 güneş kremi" : "SPF 30 güneş kremi", h.uv >= 6 ? "Yüksek UV: 2 saatte bir yenile" : "Açıkta kalacaksan yüz/boyun/eller", h.uv >= 6 ? "sart" : "iyi", "hafif", true);
  if ((h.uv >= 6 || etkin >= 27) && disarida) ekle("Güneş", "🧢", "Şapka / siperlik", "Baş ve yüz güneşten korunsun", "iyi", "hafif", true);
  if (h.uv >= 8 && disarida) ekle("Güneş", "☂️", "Gölge: UV şemsiyesi ya da gölgeli rota", "10:00–16:00 arası UV zirvede", "olabilir", "orta", false);
  if (etkin >= 27) ekle("Güneş", "💧", "Su matarası", "Susamadan önce iç; sıcakta saatte ≈ 0,5 L", "sart", "orta", k.canta !== "yok");
  if (k.sicakAsiri) ekle("Güneş", "🧊", "Soğutucu mendil / ince havlu", "Boyun ve alın serinletir", "olabilir", "hafif", true);
  if (etkin >= 24 && k.spor) ekle("Güneş", "🧂", "Elektrolit (tuz/mineral) takviyesi", "Uzun efor + sıcakta terle birlikte tuz kaybı olur", "olabilir", "hafif", true);
  // ---- Hava kalitesi ----
  if (k.col || (h.aqi ?? 0) >= 80) ekle("Hava", "😷", "FFP2/N95 maske", k.col ? "Çöl tozu / yüksek PM10" : `Hava kalitesi kötü (AQI ${h.aqi})`, k.col || (h.aqi ?? 0) >= 100 ? "sart" : "iyi", "hafif", true);
  if (k.col) ekle("Hava", "🪟", "Pencereleri kapat; araçta iç hava modu", "Toz iç mekâna girer", "iyi", "hafif", true);
  if (k.spor && (h.aqi ?? 0) >= 60) ekle("Hava", "🏋️", "Yoğun koşuyu iç mekâna al / tempoyu düşür", "Kirli havada derin nefes alımı zararı artırır", "iyi", "hafif", true);
  // ---- Görünürlük ----
  if (k.sis || ((h.saat ?? 12) >= 17 && (k.yagis >= 1 || k.spor))) ekle("Görünürlük", "🦺", "Yansıtıcı detay / küçük ışık", k.sis ? "Sisli havada trafikte görünür ol" : "Akşam ve yağışta sürücüler seni geç görür", "iyi", "hafif", true);
  // ---- Ulaşım ----
  if (k.arac && ((h.minRaw ?? 20) <= 2 || k.buz)) ekle("Ulaşım", "🧊", "Cam buz kazıyıcı / buz çözücü sprey", "Sabah cam ve silecek donabilir; erken çık", "iyi", "hafif", true);
  if (k.arac && k.kar) ekle("Ulaşım", "⛓️", "Kış lastiği / zincir, yedek cam suyu", "Karlı yolda şart", "sart", "agir", false);
  if (!k.arac && (k.buz || k.kar)) ekle("Ulaşım", "🚏", "Peron/durakta kaymaya dikkat", "Islak-buzlu zemin; adımlarını kısa at", "iyi", "hafif", true);
  // ---- Gün içi ----
  if (k.moduler) ekle("Gün içi", "🧳", k.cantaYok ? "Çıkaracağın katı belinde/koluna bağla" : "Çıkardığın katman için çanta", k.cantaYok ? "Çantan yok: ince katlanır bir parça seçildi" : "Gün içinde katman çıkaracaksın", "iyi", "hafif", k.canta !== "yok");
  if (k.spor) ekle("Gün içi", "💧", "Su + küçük atıştırmalık", "45 dk üstü eforda şart", "iyi", "orta", true);
  return e;
}

/** Gün içi pratik ipuçları (kombin dışında kalan, saat/veri bazlı küçük bilgiler). */
function gunlukIpuclari(k, h, etkin) {
  const t = [];
  const sl = h.saatListe || [];
  const uvZirve = sl.slice(0, 24).filter((x) => x.uv >= 6).map((x) => x.saat);
  if (uvZirve.length) t.push(`☀️ UV ${Math.min(...uvZirve)}:00–${Math.max(...uvZirve) + 1}:00 arası yüksek; bu saatlerde gölgeyi seç.`);
  const yagisSaat = sl.slice(0, 24).filter((x) => x.yagisOlasi >= 50 || x.yagis >= 0.3);
  if (yagisSaat.length) {
    const bas = yagisSaat[0].saat, son = yagisSaat[yagisSaat.length - 1].saat;
    t.push(`🌧️ Yağış penceresi: ${String(bas).padStart(2, "0")}:00 – ${String(son + 1).padStart(2, "0")}:00. Mümkünse yolculuğu bu saatlerin dışına al.`);
  }
  if (k.moduler) t.push(`🧅 Gün içi sıcaklık farkı ${h.delta}°C: sabah giydiğini öğle çıkaracaksın.`);
  if ((h.hum ?? 0) >= 80 && etkin >= 22) t.push("💦 Nem yüksek: ter buharlaşmaz, nefes alan kumaş ve bol kesim seç.");
  if ((h.hum ?? 100) <= 30 && etkin <= 10) t.push("🧴 Hava çok kuru: cilt/dudak koruyucu ve bol su.");
  if (h.basincEgilim === "düşüyor" && k.yagis === 0) t.push("📉 Basınç düşüyor: akşama doğru hava bozabilir, yedek kat al.");
  if (h.yesterdayDiff != null && h.yesterdayDiff <= -4) t.push(`📆 Dünden ${Math.abs(h.yesterdayDiff)}°C soğuk: dünkü kıyafet yetmeyebilir.`);
  if (h.yesterdayDiff != null && h.yesterdayDiff >= 4) t.push(`📆 Dünden ${h.yesterdayDiff}°C ılık: bir kat az giyebilirsin.`);
  if (k.ofis && etkin <= 12) t.push("🏢 Ofiste kabuğu çıkarınca terlememek için iç katı nefes alan seçtik.");
  return t;
}

function renkStratejisi(k, h, etkin) {
  if (k.col) return "Çöl tozu: açık renk giyme (toz ve çamurlu yağmur lekesi çok belli olur); orta/koyu ton ve kapalı yaka seç.";
  if (k.sis || (k.yagis >= 1 && etkin < 20) || k.ruzgar >= 2) return "Yağış/sis/fırtınada trafikte görünür olmak için en az bir canlı veya yansıtıcı renkli dış parça seç.";
  if (k.sicak || h.uv >= 6) return "Yüksek UV/sıcak: güneşi yansıtan açık tonlar (beyaz, bej, açık gri); bol ve nefes alan kesimler.";
  if (etkin < 8 && h.uv >= 1 && (h.cloud ?? 100) < 60) return "Soğuk ve açık hava: güneşten ısı toplayan koyu tonlar (lacivert, antrasit, siyah) işe yarar.";
  if (etkin < 14 && (h.cloud ?? 100) >= 80) return "Kapalı gri hava: canlı bir aksesuar (atkı, bere) moral ve görünürlük için iyi gider.";
  return "Hava dengeli: renk tercihi serbest; nötr tonlar (bej, lacivert, gri) her kombinle uyumludur.";
}

function kumasOnerisi(k, etkin, kombin) {
  const tercih = [], kacin = [];
  if (k.sicak) { tercih.push("Keten, ince pamuk, teknik hızlı kuruyan kumaşlar"); kacin.push("Koyu ve kalın sentetik, kalın denim"); }
  else if (etkin <= 8) { tercih.push("Merino yün, polar, rüzgâr geçirmez kabuk"); kacin.push("Düz pamuk iç kat (ter tutar, üşütür)"); }
  else { tercih.push("Pamuk/modal karışımı, ince yün"); }
  if (k.yagis >= 1) { tercih.push("Su itici/membranlı dış kat"); kacin.push("Süet, bez, ham pamuk dış kat"); }
  if (k.ruzgar >= 1) tercih.push("Sık dokulu rüzgâr geçirmez kumaş");
  if (k.ofis) kacin.push("Kalın tek parça yün kazak (ofiste bunaltır)");
  if (k.buz || k.kar) kacin.push("Düz/deri taban");
  return { tercih, kacin };
}

/* ------------------------------ ana fonksiyon ------------------------------ */
/**
 * @param {object} h  veri.js › ozetle() çıktısı
 * @param {{tolerans:number, senaryo:string, stil?:string, tohumKaydir?:number}} t
 * @param {{kurallar?:Object}} ek  taktik.js › kurallariKisita() çıktısı
 */
export function degerlendir(h, t, ek = {}) {
  const senaryo = SENARYOLAR[t.senaryo] ? t.senaryo : "toplu";
  const hh = { ...h };
  const hedef = hedefClo(hh, t.tolerans, senaryo);
  hh.__etkin = hedef.etkin;
  const k = kisitlariCikar(hh, { ...t, senaryo }, ek);
  const tohum = tohumHesapla(h, t);
  const stilSecimi = STILLER[t.stil] ? t.stil : "auto";
  const sirasi = [...STIL_SIRASI.slice(tohum % 5), ...STIL_SIRASI.slice(0, tohum % 5)];
  const stilBonus = stilSecimi === "auto" ? 7 : 14;

  // Parça cezaları: sıcaklık aralığı dışı → soft ceza; özel koşul sağlanmıyorsa → elenir
  const ceza = new Map();
  const cezaHesapla = (x) => {
    if (k.karZorunlu && zorunluParca(x.slot, x)) return 0;          // v5: zorunlu kış parçaları sıcaklık aralığıyla elenmez
    if (OZEL[x.id] && !OZEL[x.id](k, etkin0)) return 999;
    const [lo, hi] = ARALIK[x.id] || [-99, 99];
    const dis = etkin0 < lo ? lo - etkin0 : etkin0 > hi ? etkin0 - hi : 0;
    return Math.min(300, dis * 9);
  };
  const etkin0 = hedef.etkin;
  const liste = (slot) => {
    const hepsi = SLOT_LISTE(slot);
    hepsi.forEach((x) => ceza.set(x.id, cezaHesapla(x)));
    let ok = hepsi.filter((x) => ceza.get(x.id) < 60);
    if (ok.length < 3) ok = [...hepsi].filter((x) => ceza.get(x.id) < 900).sort((x, y) => ceza.get(x.id) - ceza.get(y.id)).slice(0, 4);
    if (k.karZorunlu) for (const x of hepsi) if (zorunluParca(slot, x) && !ok.includes(x)) ok.push(x);   // v5: zorunlu parça listeden düşmesin
    return ok;
  };
  const B = liste("b"), M = k.karZorunlu ? liste("m") : [null, ...liste("m")], O = k.karZorunlu ? liste("o") : [null, ...liste("o")], P = liste("p"), A = liste("a");   // v5: kar/buzlanmada ara kat ve dış kabuk "yok" seçeneği kalkar
  const tt = tetikleyicileriBul({ h, k, hedef, fz: ek?.fizik || null, tol: Number(t.tolerans) || 0, senaryoAd: SENARYOLAR[senaryo].ad });
  const hedefAyak = hedef.clo;
  const kombinler = [];
  const stilKumeleri = stilSecimi === "auto" ? [[sirasi[0]], [sirasi[1]], [sirasi[2]]] : [[stilSecimi], [stilSecimi, sirasi[0]], [sirasi[1]]];

  // Her stil kümesi için en iyi kombini bul; sonra aynı kombinler elenir (çeşitlilik)
  const aday = [];
  for (const kume of stilKumeleri) {
    let en = null;
    for (const b of B) for (const m of M) for (const o of O) for (const p of P) {
      const s = kombinPuani(k, b, m, o, p, hedef.clo, stilBonus, kume, tohum, ceza);
      if (!en || s.puan > en.puan) en = { b, m, o, p, ...s, kume };
    }
    aday.push(en);
  }
  // tam sıralı liste (benzersiz kombin farkı için ikinci tur): ilk kümenin en iyi 3 farklı kombini
  const farkli = (x, y) => [x.b, x.m, x.o, x.p].filter((v, i) => v?.id !== [y.b, y.m, y.o, y.p][i]?.id).length;
  const secilen = [];
  for (const c of aday) if (!secilen.some((s) => farkli(s, c) < 2)) secilen.push(c);
  if (secilen.length < 3) {
    // aynı puan bölgesinden ek çeşitleme: tüm kombinleri puanla, farklı olanları ekle
    const hepsi = [];
    const kume0 = stilKumeleri[0];
    for (const b of B) for (const m of M) for (const o of O) for (const p of P) hepsi.push({ b, m, o, p, ...kombinPuani(k, b, m, o, p, hedef.clo, stilBonus, kume0, tohum + 1, ceza), kume: kume0 });
    hepsi.sort((x, y) => y.puan - x.puan);
    for (const c of hepsi) { if (secilen.length >= 3) break; if (!secilen.some((s) => farkli(s, c) < 2)) secilen.push(c); }
  }

  // Ayakkabıları puanla; her kombine farklı (iyi) ayakkabı
  const ayakSirali = A.map((a) => ({ a, puan: ayakkabiPuani(k, a, hedefAyak, stilSecimi === "auto" ? [sirasi[0]] : [stilSecimi], tohum, stilBonus, ceza) })).sort((x, y) => y.puan - x.puan);
  const enIyiAyak = ayakSirali[0].puan;
  const iyiAyaklar = ayakSirali.filter((x) => x.puan >= enIyiAyak - 12).map((x) => x.a);
  secilen.forEach((c, i) => { c.a = iyiAyaklar[i % iyiAyaklar.length]; });

  const kombinNesne = (c, i) => {
    const toplam = toplamClo([c.b, c.m, c.o, c.p, c.a]);
    return {
      ad: i === 0 ? "Ana kombin" : `Alternatif ${i}`,
      stil: baskinStil([c.b, c.m, c.o, c.p, c.a], c.kume),
      parcalar: { b: parca(c.b), m: parca(c.m), o: parca(c.o), p: parca(c.p), a: parca(c.a) },
      toplam, fark: r2(toplam - hedef.clo), puan: Math.round(c.puan),
      _ham: c,
    };
  };
  const kombinlerSon = secilen.slice(0, 3).map(kombinNesne);
  const ana = kombinlerSon[0];
  const kod = (x) => (x ? x.id : null);
  const { b, m, o, p, a } = ana._ham;
  const etkin = hedef.etkin;

  /* ---- zaman planı ---- */
  const zamanPlani = (h.segmentler || []).map((s) => {
    const sh = hedefClo({ ...hh, apparent: s.app, raw: s.raw ?? s.app, precip: s.precip ?? 0, hum: s.hum ?? hh.hum }, t.tolerans, senaryo);
    const fark = r2(ana.toplam - sh.clo);
    let eylem = "Bu kombin uygun", tur = "ok", cikar = null;
    if (fark >= 0.22) {
      const aday2 = [m && var_(m, "p") ? m : null, o && (var_(o, "h") || var_(o, "p") || o.clo <= 0.35) ? o : null, o, m].filter(Boolean);
      cikar = aday2.find((x) => x.clo * KATSAYI >= fark * 0.5) || aday2[0] || null;
      eylem = cikar ? `${cikar.ad} çıkar → çantaya` : "Hafifle (kolları sıva, ceketi aç)"; tur = "cikar";
    } else if (fark <= -0.22) { eylem = o ? `Dış katı (${o.ad}) tam kapat; bere/boyunluk ekle` : "Çantandaki ek katı giy"; tur = "ekle"; }
    return { ad: s.ad, saat: s.saat, hissedilen: s.app, yagis: s.rain ?? 0, ruzgar: s.wind ?? 0, hedef: sh.clo, fark, eylem, tur };
  });

  /* ---- metinler ---- */
  let ayakkabi;
  if (k.karZorunlu && a) ayakkabi = `Kar/buzlanma: ${a.ad}. Derin kauçuk dişli, su geçirmez ve kaymaz taban zorunlu; düz tabanlı ayakkabı ve şemsiye yok.`;
  else if (k.buz && a) ayakkabi = `Buzlanma riski: ${a.ad} (kaymaz taban). Düz tabanlı sneaker ve deri taban yasak.`;
  else if (k.kar) ayakkabi = `Kar/tipi: ${a.ad}. Su geçirmez ve kaymaz tabanlı olmalı.`;
  else if (k.surpriz) ayakkabi = `Ani sağanak riski: ${a.ad}. Su geçirmez olsun; süet ve bez ayakkabı olmaz.`;
  else if (k.yagis >= 2) ayakkabi = `Kuvvetli yağış: ${a.ad}. Süet ve bez ayakkabıdan uzak dur.`;
  else if (k.yagis === 1) ayakkabi = `Zemin ıslak olabilir: ${a.ad}. Süet/bez ayakkabı bugün olmasın.`;
  else if (k.zararsiz) ayakkabi = `Hafif çisenti zararsız: ${a.ad} yeter, ağır bot gerekmiyor. Su birikintilerinden uzak dur.`;
  else if (k.sicak) ayakkabi = `Sıcak: ${a.ad}. Çorabı ince ve nefes alır seç.`;
  else ayakkabi = `Zemin kuru görünüyor: ${a.ad} uygun.`;

  const kacin = [];
  if (k.yagis >= 1) kacin.push("Süet / bez ayakkabı");
  if (k.semsiyeYasak) kacin.push("Şemsiye (açmak tehlikeli ve işlevsiz)");
  if (k.zararsiz) kacin.push("Ağır bot ve şemsiye (çisenti zararsız)");
  if (k.col) kacin.push("Açık renk kıyafet");
  if (k.buz || k.kar) kacin.push("Düz / deri tabanlı ayakkabı");
  if (k.ofis) kacin.push("Kalın tek parça yün kazak");
  if (k.sicak) kacin.push("Koyu ve kalın katmanlar");

  const neden = [
    `Hedef ${hedef.clo.toFixed(2)} CLO: hissedilen ${h.apparent}°C → etkin ${etkin}°C (aktivite −${hedef.aktivite}${hedef.notlar.length ? "; " + hedef.notlar.join("; ") : ""}).`,
    `Seçilen kombin toplamı ${ana.toplam.toFixed(2)} CLO (fark ${ana.fark >= 0 ? "+" : ""}${ana.fark.toFixed(2)}); formül: 0,10 + 0,85 × Σ parça CLO.`,
  ];
  if (ek?.fizik) neden.push(ek.fizik.neden);
  if (k.yagis >= 1) neden.push(`Yağış düzeyi ${k.yagis}/3 → ${o ? (var_(o, "g") ? "su geçirmez" : "su itici") + " dış kat" : "dış kat yok; şemsiye"} ve ıslakta uygun ayakkabı.`);
  if (k.ruzgar >= 1) neden.push(`Rüzgâr/hamle (${Math.round(h.gust ?? h.wind)} km/s) → rüzgâr geçirmez dış kat.`);
  if (k.ofis) neden.push("Kabuk & çekirdek: iç kat 21–23 °C ofiste rahat kalacak şekilde sınırlandı (≤ 0,80 CLO), ısıyı kabuk sağlıyor.");
  if (k.moduler) neden.push(`Gün içi fark ${h.delta}°C → ara katman fermuarlı/çıkarılabilir seçildi.`);
  if (k.sicak) neden.push("Sıcak hava: ara kat ve dış kat devre dışı, nefes alan kumaşlar öne alındı.");
  if (k.buz) neden.push("Buzlanma riski: kaymaz taban zorunlu tutuldu.");
  if (k.karZorunlu) neden.push("Kar/buzlanma algılandı: şemsiye iptal; derin kauçuk dişli kar botu, termal içlik, yün/polar ara kat, dış kabuk ve bere + eldiven zorunlu kılındı.");

  let hukum;
  const hukumEn = (x) => x;
  if (k.karZorunlu) hukum = "Kar/buzlanma: şemsiye iptal; derin kauçuk dişli kar botu, termal içlik, yün/polar ara kat, bere ve eldiven giyin.";
  else if (k.buz) hukum = "Buzlanma riski: kalın giyin, kaymaz tabanlı ayakkabı seçin.";
  else if (k.kar) hukum = "Kar/tipi: sıcak dış kat ve su geçirmez kaymaz bot giyin.";
  else if (k.surpriz) hukum = "Atmosfer patlamaya hazır: beklenmedik ani sağanak/dolu riski! Su geçirmez bot ve kapüşonlu teknik kabuk giyin.";
  else if (k.semsiyeYasak) hukum = "Şemsiye açmak tehlikeli ve işlevsizdir, kapüşonlu teknik kabuk giyin.";
  else if (k.yagis >= 2) hukum = "Kuvvetli yağış: su geçirmez dış kat ve su geçirmez ayakkabı giyin.";
  else if (k.yagis === 1) hukum = k.cantaYok ? "Yağış ihtimali var, çantan yok: şemsiye yerine kapüşonlu yağmurluk ve su itici ayakkabı giy."
    : h.modelFarki ? "Hava modelleri yağışta ayrışıyor: riskten kaçınıp şemsiye ve su itici ayakkabı alın." : "Yağış ihtimali var: şemsiye ve su itici ayakkabı hazırlayın.";
  else if (k.zararsiz) hukum = "Hafif çisenti zararsız: şemsiyesiz ve ağır botsuz çıkabilirsin.";
  else if (k.ofis && o) hukum = "Kabuk & çekirdek: ofiste rahat bir alt kat, yürüyüşte koruyan bir dış kat giyin.";
  else if (k.moduler) hukum = `Gün içinde ${h.delta}°C fark var: çıkarılabilir bir orta katmanla çıkın.`;
  else if (k.sicakAsiri) hukum = "Aşırı sıcak: en hafif, açık renk kıyafeti seçin ve bol su için.";
  else if (k.sicak) hukum = "Sıcak/ılık: hafif ve açık renk giyinin, su içmeyi unutmayın.";
  else if (hedef.clo >= 1.6) hukum = "Soğuk: kalın giyinin, dış katmanı sıkı tutun.";
  else if (hedef.clo >= 1.0) hukum = "Serin: orta katman ve ceketle çıkın.";
  else hukum = "Dengeli bir gün: hafif katmanlarla rahat çıkabilirsiniz.";

  const ikon = k.buz ? "🧊" : k.kar ? "❄️" : k.yagis >= 2 ? "⛈️" : k.ruzgar >= 2 ? "🌪️" : k.yagis === 1 ? "☔" : k.zararsiz ? "🌦️" : k.ofis ? "🏢" : k.moduler ? "🧅" : k.sicak ? "☀️" : hedef.clo >= 1.6 ? "🧥" : "⚡";

  return {
    clo: { hedef: hedef.clo, toplam: ana.toplam, fark: ana.fark, etkinSicaklik: hedef.etkin, aktivite: hedef.aktivite },
    etkinSicaklik: hedef.etkin,
    senaryo, kisitlar: k, stilSecimi,
    kombinler: kombinlerSon.map(({ _ham, ...x }) => x),
    kombin: kombinlerSon[0].parcalar,
    kodlar: { b: kod(b), m: kod(m), o: kod(o), p: kod(p), a: kod(a) },
    ekstralar: ekstralar(k, h, etkin, ana.parcalar && { o: ana._ham.o, m: ana._ham.m }).map((e) => ({ ...e, tetik: tt.grup(e.grup) })), tetik: { liste: tt.liste, parca: tt.parca }, zamanPlani, ipuclari: gunlukIpuclari(k, h, etkin),
    ayakkabi, renk: renkStratejisi(k, h, etkin), kumas: kumasOnerisi(k, etkin, ana), kacin,
    neden, hukum, ikon, fizik: ek?.fizik || null,
    ozet: [b, m, o, p, a].filter(Boolean).map((x) => x.ad).join(" + "),
  };
}

/** Eski çağrılar için: tek bir hedef CLO sayısı */
export function hedefCloSayisi(hissedilen, tolerans, senaryo) { return hedefClo({ apparent: hissedilen }, tolerans, senaryo).clo; }

/**
 * yagis-fizigi.js — HavaStil v3 · FİZİKSEL YAĞIŞ & FIRTINA DİNAMİKLERİ MOTORU (saf JS: DOM yok, ağ yok, AI yok).
 * ---------------------------------------------------------------------------------------------------------------
 * Girdi : Open-Meteo saatlik dizisi (veri.js › saatOge): yagisOlasi (PoP), yagis (precipitation), yagmur (rain), saganak (showers),
 *         cape, hamle (wind_gusts_10m), kod (weather_code), kar.
 * Çıktı : tek "yağış fiziği" nesnesi → cekirdek.js'e KISIT olarak girer, arayüz (sade + uzman) aynı nesneyi okur.
 *
 * KARAR KURALLARI (şartname § 2) — eşikler ESIK'te tek yerde:
 *   1) Sahte alarm engelleyici : PoP ≥ %70 ama beklenen hacim E = PoP × P < 0,8 mm  → "Zararsız çisenti"; şemsiye/ağır bot önerilmez.
 *   2) Sürpriz sağanak dedektörü: PoP düşük (≤ %45) ama showers > 0 ve CAPE > 1000 J/kg → "Atmosfer patlamaya hazır" uyarısı.
 *   3) Fırtına / şemsiye kırıcı  : CAPE > 1500 J/kg veya hamle > 40 km/s → şemsiye sistemden çıkar, kapüşonlu teknik kabuk.
 *
 * YAĞIŞ SEVİYESİ (sade 4 kademe): 0 Kurak/Sakin · 1 Hafif çisenti (zararsız) · 2 Sürekli yağmur · 3 Tehlikeli/ani sağanak.
 * Ek güvenlik (kural 1'in kapsamı dışı, bilerek): zararsız saatler gün boyu birikip toplam ≥ 3 mm yapıyorsa seviye 2'ye çıkar
 * (ıslak ayakkabı/pantolon artık gerçek bir sorun). Dondurucu çise/yağmur ve kar "zararsız" sayılmaz.
 */

export const ESIK = Object.freeze({
  zararsizPop: 70, zararsizHacim: 0.8,          // kural 1
  surprizPop: 45, surprizCape: 1000,            // kural 2
  firtinaCape: 1500, firtinaHamle: 40,          // kural 3
  yagmurSaatlikMm: 1.0, saganakSaatlikMm: 4, saganakKonvektifMm: 2,
  sureklilikToplamMm: 3,
  krizEsigi: 6,
});

export const YAGIS_SEVIYELERI = [
  { id: 0, ad: "Kurak / Sakin", kisa: "Kurak", ikon: "☀️" },
  { id: 1, ad: "Hafif çisenti (zararsız)", kisa: "Çisenti", ikon: "🌦️" },
  { id: 2, ad: "Sürekli yağmur (şemsiyeli)", kisa: "Yağmur", ikon: "🌧️" },
  { id: 3, ad: "Tehlikeli / ani sağanak", kisa: "Sağanak", ikon: "⛈️" },
];

export const CAPE_BANTLARI = [
  { alt: 0, ust: 100, skor: 0, ad: "Kararlı", oneri: "Önlem gerekmez.", sinif: "d1", aciklama: "Atmosfer kararlı; yükselen hava hareketi yok denecek kadar az." },
  { alt: 100, ust: 1000, skor: 1, ad: "Zayıf kararsızlık", oneri: "Uzun süre açıkta kalacaksan hafif bir kabuk yanında olsun.", sinif: "d2", aciklama: "Gök gürültüsü ihtimali düşük; yerel, kısa süreli sağanak çıkabilir." },
  { alt: 1000, ust: 2500, skor: 2, ad: "Orta kararsızlık", oneri: "Su geçirmez kabuk ve kapüşon hazır olsun; fırtına anında ağaç altında durma.", sinif: "d3", aciklama: "Gök gürültülü sağanak ve dolu için uygun ortam; ani yağış beklenir." },
  { alt: 2500, ust: 4000, skor: 3, ad: "Güçlü kararsızlık", oneri: "Açık alan ve yüksek yerlerden uzak dur; zorunlu değilse uzun süre dışarıda kalma.", sinif: "d4", aciklama: "Şiddetli fırtına, iri dolu ve ani rüzgâr hamlesi potansiyeli." },
  { alt: 4000, ust: Infinity, skor: 4, ad: "Aşırı kararsızlık", oneri: "Dışarıdaki planları ertele; kapalı ve sağlam bir yerde kal.", sinif: "d5", aciklama: "Aşırı şiddetli konvektif fırtına potansiyeli; açıkta kalma." },
];

const sayi = (x) => (Number.isFinite(x) ? x : 0);
const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const topla = (d, f) => d.reduce((t, x) => t + f(x), 0);
const pad = (s) => String(s).padStart(2, "0");
const KAR_KODLARI = [71, 73, 75, 77, 85, 86];
const DONDURUCU_KODLAR = [56, 57, 66, 67];
const FIRTINA_KODLARI = [95, 96, 99];

/* ------------------------------ CAPE ------------------------------ */
export function capeSeviye(cape) {
  const c = Math.max(0, sayi(Number(cape)));
  const bant = CAPE_BANTLARI.find((b) => c < b.ust) || CAPE_BANTLARI[CAPE_BANTLARI.length - 1];
  return { ...bant, deger: Math.round(c) };
}
/** Skala çubuğundaki işaretçi konumu (0..1): 5 eşit bant, her bant kendi içinde doğrusal. */
export function capeOrani(cape) {
  const c = Math.max(0, sayi(Number(cape)));
  const i = CAPE_BANTLARI.findIndex((b) => c < b.ust);
  const k = i < 0 ? CAPE_BANTLARI.length - 1 : i;
  const b = CAPE_BANTLARI[k];
  const ust = Number.isFinite(b.ust) ? b.ust : 6000;
  return Math.min(1, (k + Math.min(1, (c - b.alt) / (ust - b.alt))) / CAPE_BANTLARI.length);
}

/* ------------------------------ günlük dil ------------------------------ */
export const gunParcasi = (s) => (s < 5 ? "gece" : s < 12 ? "sabah" : s < 17 ? "öğleden sonra" : s < 21 ? "akşamüstü" : "gece");
export const saatMetniTam = (s) => `${pad(s)}:00`;

/** mm = m² başına litre. Gündelik benzetme: 200 ml'lik su bardağı, 1,5 L'lik pet şişe, 10 L'lik kova. */
export function suMiktari(mm) {
  const ml = Math.max(0, mm) * 1000;
  if (ml < 60) return "birkaç damla";
  if (ml < 1000) {
    const b = Math.max(0.5, Math.round((ml / 200) * 2) / 2);
    return b === 0.5 ? "yarım su bardağı" : `${String(b).replace(".", ",")} su bardağı`;
  }
  const l = ml / 1000;
  if (l < 10) return `${String(r1(l)).replace(".", ",")} litre (≈ ${Math.max(1, Math.round(l / 1.5))} büyük pet şişe)`;
  return `${Math.round(l)} litre (≈ ${Math.max(1, Math.round(l / 10))} kova)`;
}
const ayakkabiBenzetme = (mm) => (mm < 0.5 ? "bez ayakkabı bile zor ıslanır" : mm < 2 ? "bez ayakkabı çeker, su itici taban yeter" : "bez ayakkabı kesin ıslanır");

/* ------------------------------ PoP = Güven × Kapsam ------------------------------ */
/**
 * Open-Meteo yalnızca PoP verir. NWS tanımı: PoP = Güven (C) × Kapsam (A). Burada
 *   Güven  = yağışı gören model oranı (veri.js › uyumEkle: ana tahmin + ECMWF + ICON + GFS),
 *   Kapsam = PoP ÷ Güven (bölgenin yağışı alacak kısmı; en fazla %100).
 * TUTARLILIK KURALLARI (v4):
 *   • PoP < %5 → ayrıştırma ANLAMSIZ (0 × herhangi bir şey = 0); Güven/Kapsam null döner, arayüz "·" gösterir. Eski sürümde
 *     "PoP 0 ama Güven 25" gibi çelişkili hücreler bu yüzden çıkıyordu.
 *   • Model oyu PoP'tan DÜŞÜKSE (C < P) çarpım eşitliği korunamaz: Güven PoP'a yükseltilir ve sonuç `tahmini: true` ile işaretlenir
 *     (arayüz yıldız + açıklama gösterir; kapsam o satırda kesin değil, üst sınır sayılır).
 *   • Model verisi yoksa ayrıştırma yapılmaz (modelVar: false).
 */
export function popAyristir(pop, uyum) {
  const P = Math.max(0, Math.min(100, Math.round(sayi(pop))));
  const modelVar = uyum != null && Number.isFinite(uyum);
  if (!modelVar) return { pop: P, guven: null, kapsam: null, tahmini: false, modelVar: false };
  if (P < 5) return { pop: P, guven: null, kapsam: null, tahmini: false, modelVar: true };
  let C = Math.round(uyum * 100), tahmini = false;
  if (C < P) { C = P; tahmini = true; }
  return { pop: P, guven: C, kapsam: C > 0 ? Math.min(100, Math.round((P / C) * 100)) : 0, tahmini, modelVar: true };
}
export function popYorumu({ pop, guven, kapsam }) {
  if (pop < 10) return "Yağış beklenmiyor.";
  if (guven == null) return `Yağış olasılığı %${pop}; model uyumu verisi bu saat için yok, ayrıştırılamadı.`;
  if (guven >= 75 && kapsam >= 75) return "Modeller hemfikir ve yağış geniş alanı kaplıyor: yağış neredeyse kesin.";
  if (guven >= 75) return "Modeller yağışta hemfikir ama yağış dağınık/yerel hücreler hâlinde: bazı yerlere düşer, bazılarına düşmez.";
  if (kapsam >= 75) return "Yağış olursa geniş alana yayılır ama modeller kararsız: olup olmayacağı belirsiz.";
  return "Modeller kararsız ve yağış yerel kalacak: düşük ihtimalli, dağınık yağış.";
}

/** Güven yüzdesinin halk dilindeki karşılığı (modellerin yağışta uyumu). */
export function guvenMetni(g) {
  if (g == null) return "model verisi yok";
  if (g >= 75) return "Modeller yağışta hemfikir";
  if (g >= 50) return "Modellerin çoğu yağış görüyor";
  if (g >= 25) return "Modeller kararsız";
  return "Neredeyse hiçbir model yağış görmüyor";
}
/** Kapsam yüzdesinin halk dilindeki karşılığı (yağışın bölgede ne kadar yer tutacağı). */
export function kapsamMetni(k) {
  if (k == null) return "—";
  if (k >= 85) return "Bölgenin tamamına yakınını etkileyen geniş yağış";
  if (k >= 60) return "Bölgenin büyük kısmına düşecek yağış";
  if (k >= 35) return "Bölgenin yarısını etkileyecek lokal sağanak";
  if (k >= 15) return "Dağınık, yerel yağış hücreleri";
  return "Çok dar, nokta atışı hücreler";
}
/**
 * PoP'un pratik tercümesi: "Yağış Riski: %40 → [Güven: %80 (…) × Kapsam: %50 (…)]" + tek cümlelik tavsiye.
 * @param {{pop:number,guven:number|null,kapsam:number|null,tahmini?:boolean}} a  saatAnaliz çıktısı
 */
export function popPratik(a) {
  const baslik = `Yağış Riski: %${a.pop}`;
  if (a.pop < 5) return { baslik, formul: "Güven × Kapsam ayrıştırması gerekmiyor (risk %5'in altında).", tavsiye: "Yağış beklenmiyor; yağmurluk gerekmez.", tahmini: false };
  if (a.guven == null) return { baslik, formul: "Model uyumu verisi yok; ayrıştırma yapılamadı.", tavsiye: a.pop >= 50 ? "Yağış olasılığı yüksek: yağmurluk veya şemsiye al." : "Yağış olasılığı düşük ama sıfır değil: kabuğu çantada taşı.", tahmini: false };
  const formul = `[Güven: %${a.guven}${a.tahmini ? "*" : ""} (${guvenMetni(a.guven)}) × Kapsam: %${a.kapsam}${a.tahmini ? "*" : ""} (${kapsamMetni(a.kapsam)})]`;
  let tavsiye;
  if (a.guven >= 70 && a.kapsam >= 60) tavsiye = "Yağmur kesin ve geniş alana yayılacak; yağmurluk ya da şemsiye şart, su itici ayakkabı giy.";
  else if (a.guven >= 70) tavsiye = "Yağmur kesin yağacak ancak şehrin tamamına değil, yerel hücreler halinde düşecek; yanına hafif yağmurluk al.";
  else if (a.kapsam >= 60) tavsiye = "Yağış olursa geniş alana yayılır ama modeller kararsız; kabuğu çantada taşı, gökyüzüne göre karar ver.";
  else tavsiye = "Modeller kararsız ve yağış yerel kalacak; düşük ihtimalli, dağınık yağış. Hafif bir kabuk yeterli.";
  return { baslik, formul, tavsiye, tahmini: !!a.tahmini };
}

/** Beklenen efektif yağış (E = PoP × P) için anlaşılır şiddet rozeti. */
export function efektifSiddet(E) {
  const e = Math.max(0, sayi(Number(E)));
  if (e < 0.1) return { ad: "Yağış yok", ayrinti: "Kuru geçer", sinif: "d1", seviye: 0 };
  if (e < ESIK.zararsizHacim) return { ad: "Çisenti", ayrinti: "Zar zor ıslatır", sinif: "d1", seviye: 1 };
  if (e < 3) return { ad: "Hafif yağmur", ayrinti: "Islatır", sinif: "d2", seviye: 2 };
  if (e < 8) return { ad: "Orta yağmur", ayrinti: "Şemsiyesiz ıslanırsın", sinif: "d3", seviye: 3 };
  if (e < 20) return { ad: "Kuvvetli yağmur", ayrinti: "Göllenme olabilir", sinif: "d4", seviye: 4 };
  return { ad: "Şiddetli yağış", ayrinti: "Sel ve göllenme riski", sinif: "d5", seviye: 5 };
}
export const efektifMetni = (E) => { const s = efektifSiddet(E); return `${(Math.round(sayi(E) * 10) / 10).toFixed(1)} mm (${s.ad} / ${s.ayrinti})`; };

/** CAPE'in halk dilindeki 3 kademeli özeti (ayrıntılı 5 kademeli ölçek CAPE_BANTLARI'nda). */
export function capeHalk(cape) {
  const c = Math.max(0, sayi(Number(cape)));
  if (c < 500) return { ad: "Atmosfer Kararlı", aciklama: "Gök gürültüsü ve dolu riski yok, sakin.", sinif: "d1" };
  if (c <= 1500) return { ad: "Orta Kararsızlık", aciklama: "Lokal gök gürültülü sağanak geçişi olabilir.", sinif: "d3" };
  return { ad: "Yüksek Enerji", aciklama: "Anlık fırtına, dolu ve yoğun şimşek aktivitesi olabilir.", sinif: "d5" };
}

/* ------------------------------ tek saat ------------------------------ */
/** @param {{yagisOlasi?:number,yagis?:number,yagmur?:number,saganak?:number,cape?:number,hamle?:number,kod?:number,kar?:number}} x */
export function saatAnaliz(x) {
  const mm = sayi(x.yagis), pop = sayi(x.yagisOlasi), cape = sayi(x.cape), hamle = sayi(x.hamle);
  const saganak = sayi(x.saganak), yagmur = sayi(x.yagmur), kar = sayi(x.kar), kod = Number(x.kod) || 0;
  const E = r2((pop / 100) * mm);                                   // beklenen efektif yağış: E = PoP × P
  const karli = kar > 0 || KAR_KODLARI.includes(kod);
  const donduruc = DONDURUCU_KODLAR.includes(kod);

  let tur = "yok";
  if (karli && (mm >= 0.05 || kar > 0)) tur = "kar";
  else if (mm >= 0.05) {
    if (saganak > 0 && saganak >= 0.5 * mm) tur = "konvektif";
    else if (saganak > 0) tur = "karma";
    else if (yagmur > 0) tur = mm < 0.8 ? "cise" : "genis";
    else tur = [80, 81, 82, 95, 96, 99].includes(kod) ? "konvektif" : [51, 53, 55].includes(kod) || mm < 0.8 ? "cise" : "genis";   // rain/showers yoksa WMO koduna dön
  }

  const surpriz = pop <= ESIK.surprizPop && saganak > 0 && cape > ESIK.surprizCape;                // kural 2
  const firtina = cape > ESIK.firtinaCape || hamle > ESIK.firtinaHamle;                            // kural 3
  const zararsiz = !karli && !donduruc && mm >= 0.05 && pop >= ESIK.zararsizPop && E < ESIK.zararsizHacim;   // kural 1

  let seviye;
  if (surpriz || FIRTINA_KODLARI.includes(kod) || (cape > ESIK.firtinaCape && (mm >= 0.3 || pop >= 30)) || mm >= ESIK.saganakSaatlikMm || saganak >= ESIK.saganakKonvektifMm) seviye = 3;
  else if (zararsiz) seviye = 1;
  else if (mm >= ESIK.yagmurSaatlikMm || E >= ESIK.zararsizHacim) seviye = 2;
  else if ((pop >= 30 && mm >= 0.05) || mm >= 0.2) seviye = 1;
  else seviye = 0;

  return { mm, pop, E, cape, hamle, saganak, yagmur, kar, kod, tur, seviye, surpriz, firtina, zararsiz, karli, capeSkor: capeSeviye(cape).skor, ...popAyristir(pop, x.uyum) };
}

/* ------------------------------ pencere (bugün kalan / yarın) ------------------------------ */
/**
 * @param {Array} pencere veri.js › yagisPencere (şimdiden 22:00'ye; akşam geçse yarın 07–22)
 * @param {{gun?:string, canta?:string}} o
 */
export function yagisMotoru(pencere, { gun = "bugün", canta = "el" } = {}) {
  const liste = Array.isArray(pencere) ? pencere : [];
  const saatler = liste.map((x) => ({ saat: x.saat, t: x.t, ...saatAnaliz(x) }));
  const gunEki = gun === "yarın" ? "yarın " : "";
  const bos = !saatler.length;

  const toplamMm = r2(topla(saatler, (s) => s.mm));
  const beklenenMm = r2(topla(saatler, (s) => s.E));
  const saganakToplam = r2(topla(saatler, (s) => s.saganak));
  const yagmurToplam = r2(topla(saatler, (s) => s.yagmur));
  const enYuksekPop = bos ? 0 : Math.max(...saatler.map((s) => s.pop));
  const zirveMm = bos ? 0 : Math.max(...saatler.map((s) => s.mm));
  const capeHucre = saatler.reduce((a, s) => (s.cape > (a?.cape ?? -1) ? s : a), null);
  const hamleHucre = saatler.reduce((a, s) => (s.hamle > (a?.hamle ?? -1) ? s : a), null);
  const capeMax = Math.round(capeHucre?.cape ?? 0), hamleMax = Math.round(hamleHucre?.hamle ?? 0);

  let seviye = bos ? 0 : Math.max(...saatler.map((s) => s.seviye));
  let sureklilik = false;
  if (seviye < 2 && toplamMm >= ESIK.sureklilikToplamMm) { seviye = 2; sureklilik = true; }
  const surpriz = saatler.some((s) => s.surpriz);
  const firtina = saatler.some((s) => s.firtina);
  const kural1 = saatler.some((s) => s.zararsiz);
  const zararsiz = seviye === 1;                                      // sade çubukta "Hafif çisenti (zararsız)"
  const semsiyeYasak = firtina;

  const yagisli = saatler.filter((s) => s.seviye >= 1);
  const zirve = saatler.reduce((a, s) => (!a || s.seviye * 100 + s.mm > a.seviye * 100 + a.mm ? s : a), null);
  const bas = yagisli[0]?.saat ?? null, bit = yagisli.length ? yagisli[yagisli.length - 1].saat + 1 : null;
  const karli = yagisli.length > 0 && yagisli.filter((s) => s.karli).length * 2 >= yagisli.length;

  // baskın yağış türü (mm ağırlıklı)
  const agirlik = { konvektif: 0, genis: 0, cise: 0, kar: 0 };
  for (const s of saatler) { if (s.tur === "karma") { agirlik.konvektif += s.saganak; agirlik.genis += Math.max(0, s.mm - s.saganak); } else if (agirlik[s.tur] !== undefined) agirlik[s.tur] += s.mm; }
  const agToplam = agirlik.konvektif + agirlik.genis + agirlik.cise + agirlik.kar;
  let tur = "yok";
  if (agToplam > 0) {
    const sirali = Object.entries(agirlik).sort((a, b) => b[1] - a[1]);
    const [ad, v] = sirali[0];
    tur = ad === "genis" && agirlik.konvektif >= 0.3 * agToplam ? "karma" : ad === "konvektif" && agirlik.genis >= 0.3 * agToplam ? "karma" : ad;
    if (v === 0) tur = "yok";
  }

  const parca = zirve && seviye >= 1 ? `${gunEki}${gunParcasi(zirve.saat)}` : "";
  const aralik = bas != null ? `${saatMetniTam(bas)}–${saatMetniTam(Math.min(24, bit) % 24)}` : null;
  const surprizSaat = saatler.find((s) => s.surpriz);
  const firtinaSaat = saatler.filter((s) => s.firtina).sort((a, b) => (b.hamle > ESIK.firtinaHamle) - (a.hamle > ESIK.firtinaHamle) || b.hamle - a.hamle)[0];
  const cantaYok = canta === "yok";

  let baslik, alt, ton;
  if (surpriz) {
    baslik = "Atmosfer patlamaya hazır: beklenmedik ani sağanak/dolu riski!";
    alt = `Yağış ihtimali yalnızca %${surprizSaat.pop} görünse de ${gunEki}${saatMetniTam(surprizSaat.saat)} civarında atmosferde ${Math.round(surprizSaat.cape)} J/kg enerji ve sağanak var. Su geçirmez bot ve kapüşonlu teknik kabuk giy; şemsiye açmaya vakit kalmaz.`;
    ton = "tehlike";
  } else if (seviye === 3) {
    baslik = `Kesinlikle su geçirmez bot giy; ${parca} ani sağanak patlaması var.`;
    alt = `Saatte ${r1(zirveMm)} mm'ye kadar çıkıyor; m²'ye ≈ ${suMiktari(zirveMm)} düşer. Yol ve kaldırımlarda göllenme olabilir.`;
    ton = "tehlike";
  } else if (firtina) {
    baslik = "Şemsiye açmak tehlikeli ve işlevsizdir; kapüşonlu teknik kabuk giyin.";
    const sebep = firtinaSaat.hamle > ESIK.firtinaHamle ? `${gunEki}${gunParcasi(firtinaSaat.saat)} rüzgâr hamlesi ${Math.round(firtinaSaat.hamle)} km/s'ye çıkıyor` : `Atmosfer çok kararsız (CAPE ${Math.round(firtinaSaat.cape)} J/kg)`;
    alt = `${sebep}${seviye >= 1 ? `; ayrıca ${seviye === 2 ? "sürekli yağmur" : "hafif çisenti"} var` : ""}.`;
    ton = hamleMax >= 55 || capeMax >= 2500 ? "tehlike" : "dikkat";
  } else if (seviye === 2) {
    baslik = karli ? `Sıcak, su geçirmez ve kaymaz giyin; ${parca} kar yağışı var.`
      : cantaYok ? `Kapüşonlu yağmurluk giy; ${parca} sürekli yağmur var.` : `Şemsiye al, su itici ayakkabı giy; ${parca} sürekli yağmur var.`;
    alt = sureklilik ? `Tek tek saatler hafif ama toplam ≈ ${r1(toplamMm)} mm biriktiriyor: m²'ye ${suMiktari(toplamMm)}.` : `Toplam ≈ ${r1(toplamMm)} mm: m²'ye ${suMiktari(toplamMm)} düşer.`;
    ton = "dikkat";
  } else if (seviye === 1) {
    baslik = `Şemsiyesiz çıkabilirsin; ${parca} hafif çisenti var ama zararsız.`;
    alt = `${kural1 ? `İhtimal %${enYuksekPop} görünse de toplamda` : "Toplamda"} m²'ye ≈ ${suMiktari(toplamMm)} su düşecek; ${ayakkabiBenzetme(toplamMm)}.`;
    ton = "sakin";
  } else {
    baslik = "Şemsiyesiz çıkabilirsin.";
    alt = bos ? "Yağış verisi alınamadı." : "Önümüzdeki saatlerde belirgin yağış beklenmiyor.";
    ton = "sakin";
  }

  const kurallar = [
    { id: "k1", ad: "Sahte alarm engelleyici", kosul: `İhtimal ≥ %${ESIK.zararsizPop} ve beklenen hacim E < ${ESIK.zararsizHacim} mm`, tetik: kural1, ozet: kural1 ? `Evet: ihtimal %${enYuksekPop}'e çıkıyor ama beklenen hacim küçük; çisenti zararsız sayıldı.` : "Tetiklenmedi." },
    { id: "k2", ad: "Sürpriz sağanak dedektörü", kosul: `İhtimal ≤ %${ESIK.surprizPop}, showers > 0 ve CAPE > ${ESIK.surprizCape} J/kg`, tetik: surpriz, ozet: surpriz ? `Evet: ${gunEki}${saatMetniTam(surprizSaat.saat)} civarı ihtimal %${surprizSaat.pop} ama CAPE ${Math.round(surprizSaat.cape)} J/kg.` : "Tetiklenmedi." },
    { id: "k3", ad: "Fırtına / şemsiye kırıcı", kosul: `CAPE > ${ESIK.firtinaCape} J/kg veya hamle > ${ESIK.firtinaHamle} km/s`, tetik: firtina, ozet: firtina ? `Evet: en yüksek CAPE ${capeMax} J/kg, en sert hamle ${hamleMax} km/s; şemsiye devre dışı.` : "Tetiklenmedi." },
  ];

  const neden = bos ? "Yağış fiziği: saatlik veri yok."
    : `Yağış fiziği: seviye ${seviye}/3 (${YAGIS_SEVIYELERI[seviye].kisa}) · toplam ${toplamMm} mm · beklenen efektif ${beklenenMm} mm (E = PoP × P) · CAPE ${capeMax} J/kg · hamle ${hamleMax} km/s.`;

  return {
    seviye, seviyeAd: YAGIS_SEVIYELERI[seviye].ad, kisaAd: YAGIS_SEVIYELERI[seviye].kisa, ikon: YAGIS_SEVIYELERI[seviye].ikon,
    tur, karli, zararsiz, surpriz, firtina, semsiyeYasak, sureklilik, kural1,
    toplamMm, beklenenMm, saganakToplam, yagmurToplam, enYuksekPop, zirveMm: r1(zirveMm), zirveSaat: zirve && seviye >= 1 ? zirve.saat : null, bas, bit, aralik,
    capeMax, capeSaat: capeHucre?.saat ?? null, capeSeviye: capeSeviye(capeMax), hamleMax, hamleSaat: hamleHucre?.saat ?? null,
    benzetme: seviye === 0 ? "Kuru geçecek." : `m²'ye ≈ ${suMiktari(toplamMm)} su düşecek; ${ayakkabiBenzetme(toplamMm)}.`,
    baslik, alt, ton, gun, kurallar, neden, saatler,
    kisit: { yagis: seviye === 1 ? 0 : seviye, ruzgar: firtina ? 2 : 0 },       // cekirdek.js'in beklediği kısıt (seviye 1 = zararsız → yağış kısıtı yok)
  };
}

/* ------------------------------ günlük (10 gün) için kaba sınıflama ------------------------------ */
/** @param {{yagisToplam:number,yagisOlasi:number,hamle:number}} g */
export function gunSeviyesi(g) {
  const mm = sayi(g.yagisToplam), pop = sayi(g.yagisOlasi), E = (pop / 100) * mm;
  let seviye;
  if (mm >= 20) seviye = 3;
  else if (mm >= ESIK.sureklilikToplamMm || E >= ESIK.zararsizHacim) seviye = 2;
  else if (mm >= 0.1 && pop >= 30) seviye = 1;
  else seviye = 0;
  if (pop >= ESIK.zararsizPop && E < ESIK.zararsizHacim && mm < ESIK.sureklilikToplamMm && mm >= 0.1) seviye = 1;
  return { seviye, ...YAGIS_SEVIYELERI[seviye], firtina: sayi(g.hamle) > ESIK.firtinaHamle, E: r2(E) };
}

/* ------------------------------ gün içi KRİZ ANI (yapay zekâ ve yerel özet için) ------------------------------ */
const DIS_PENCERE = { toplu: [[7, 10], [12, 14], [16, 20]], yuruyus_ofis: [[7, 10], [12, 14], [16, 20]], disari: [[8, 20]], arac: [[7, 9], [17, 19]], gezi: [[9, 19]], spor: [[17, 21]] };
const IC_SICAKLIK = { yuruyus_ofis: 22, arac: 21 };
export const KRIZ_TURLERI = ["ofis_cikis", "ruzgar_hamle", "yagis", "konvektif", "sicaklik_dususu", "sakin"];

/**
 * Plana göre insanın dışarıda olduğu saatler içinden "çelişkinin en büyük olduğu" saati bulur:
 * ofisten/araçtan çıkış sıcaklık farkı, ani soğuma, rüzgâr hamlesi, yağış başlangıcı, konvektif enerji.
 * @param {Array} pencere veri.js › yagisPencere  @param {{senaryo:string}} o
 */
export function krizAniBul(pencere, { senaryo = "toplu" } = {}) {
  const liste = Array.isArray(pencere) ? pencere : [];
  const pen = DIS_PENCERE[senaryo] || DIS_PENCERE.toplu;
  const ic = IC_SICAKLIK[senaryo] ?? null;
  const analiz = liste.map((x) => saatAnaliz(x));
  const icinde = (s) => pen.some(([a, b]) => s >= a && s <= b);
  let aday = liste.map((x, i) => ({ x, i })).filter(({ x }) => icinde(x.saat));
  if (!aday.length) aday = liste.map((x, i) => ({ x, i }));
  let en = null;
  for (const { x, i } of aday) {
    const a = analiz[i];
    const onceki = liste[Math.max(0, i - 3)];
    const kontrast = ic != null ? Math.max(0, ic - x.app) : 0;
    const dusus = onceki ? Math.max(0, onceki.app - x.app) : 0;
    const basladi = a.seviye >= 2 && (i === 0 || analiz[i - 1].seviye < 2);
    const bilesen = {
      ofis_cikis: kontrast >= 8 ? kontrast * 0.9 : 0,
      sicaklik_dususu: dusus >= 4 ? dusus * 1.2 : 0,
      ruzgar_hamle: a.hamle >= 30 ? (a.hamle - 25) * 0.6 : 0,
      yagis: a.seviye >= 2 ? 8 + 4 * (a.seviye - 2) + (basladi ? 3 : 0) : 0,
      konvektif: a.surpriz || a.cape > ESIK.surprizCape ? 10 + (a.surpriz ? 4 : 0) : 0,
    };
    const skor = Object.values(bilesen).reduce((t, v) => t + v, 0);
    const bas = Object.entries(bilesen).sort((p, q) => q[1] - p[1])[0];
    if (!en || skor > en.skor) en = { skor: r1(skor), tur: bas[1] > 0 ? bas[0] : "sakin", x, a, kontrast, dusus };
  }
  if (!en || en.skor < ESIK.krizEsigi) return { var: false, tur: "sakin", skor: en?.skor ?? 0 };
  const { x, a, kontrast, dusus } = en;
  return {
    var: true, tur: en.tur, skor: en.skor, saat: x.saat, sicaklikSonra: Math.round(x.app), sicaklikOnce: ic != null && kontrast >= 8 ? ic : Math.round(x.app + dusus),
    hamle: Math.round(a.hamle), mm: r1(a.mm), pop: Math.round(a.pop), cape: Math.round(a.cape), seviye: a.seviye, dusus: Math.round(dusus),
  };
}

/** Yapay zekâ kapalıyken (Mod A) gösterilen, deterministik ve en fazla 2 cümlelik kriz anı satırı. */
export function krizSatiri(k, parcalar = {}) {
  if (!k?.var) return "Gün içinde belirgin bir kriz anı görünmüyor: bu kombin gün boyu sabit kalabilir.";
  const S = saatMetniTam(k.saat);
  const m = parcalar.m?.ad, o = parcalar.o?.ad;
  switch (k.tur) {
    case "ofis_cikis":
      return `Saat ${S}'de ofisten çıkınca ${k.sicaklikOnce}° iç ortamdan ${k.sicaklikSonra}° dışarıya geçiyorsun${k.hamle >= 30 ? `, üstüne ${k.hamle} km/s hamle biniyor` : ""}. ${o ? "Dış kabuğu kapıdan çıkmadan giy" : "Üstüne bir kat ekle"}${m ? "; orta katmanı ofisteyken çantada tut." : "."}`;
    case "ruzgar_hamle":
      return `Saat ${S}'de hamle ${k.hamle} km/s'ye çıkıyor. Boynunu kapat, dış kabuğun fermuarını sonuna kadar çek; gevşek parça taşıma.`;
    case "yagis":
      return `Saat ${S}'de yağış ${k.seviye >= 3 ? "sağanağa dönüyor" : "başlıyor"} (saatte ${k.mm} mm). Kapüşonu hazır tut, telefonu ve cüzdanı iç cebe al.`;
    case "konvektif":
      return `Saat ${S}'de atmosfer patlamaya hazır (CAPE ${k.cape} J/kg). Açıkta kalma; su geçirmez kabuk ve bot üzerinde olsun.`;
    case "sicaklik_dususu":
      return `Saat ${S}'de hissedilen ısı 3 saatte ${k.dusus}° düşüp ${k.sicaklikSonra}°'ye iniyor. ${m ? "Çantadaki orta katmanı o saate kadar giy." : "Dış kat hazır olsun."}`;
    default:
      return "Gün içinde belirgin bir kriz anı görünmüyor.";
  }
}

/* ------------------------------ gün bazlı (Derin analiz gün seçicisi) ------------------------------ */
/** veri.js › tumSaatler → [{ tarih, saatler, fizik }]; her gün 24 saat üzerinden aynı motorla analiz edilir. */
export function gunAnalizleri(tumSaatler, { canta = "el" } = {}) {
  const gruplar = new Map();
  for (const x of tumSaatler || []) { const t = x.t.slice(0, 10); if (!gruplar.has(t)) gruplar.set(t, []); gruplar.get(t).push(x); }
  return [...gruplar].map(([tarih, saatler]) => ({ tarih, saatler, fizik: yagisMotoru(saatler, { gun: "bugün", canta }) }));
}

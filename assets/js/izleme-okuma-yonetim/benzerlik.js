/*
 * assets/js/izleme-okuma-yonetim/benzerlik.js  (v2 — yeniden yazıldı)
 *
 * İzlediklerim / Okuduklarım panosuna yeni kayıt eklerken, ZATEN var olan bir kaydı yanlışlıkla tekrar eklemeyi önleyen başlık eşleştirme.
 * Harici kütüphane YOK (vanilla).
 *
 * ESKİ SÜRÜMÜN SORUNLARI (ekran görüntülerinden):
 *   • "The Maze Runner - 2013" yazınca "Iron Man 3 - 2013", "Agents of S.H.I.E.L.D. - 2013" gibi ALAKASIZ kayıtlar geliyordu:
 *     " - " ile bölünen "2013" parçası tek başına bir "başlık varyantı" sayılıp yazılanın içinde geçtiği için "kapsar" eşleşmesi çıkıyordu.
 *   • "Spider-Man" ile "Spider-Man - 2002 (Tobey Maguire)" aynı kayıt olduğu halde, yıl/oyuncu eki yüzünden "aynı" sayılmıyor,
 *     "Spider-Man 2 / 3" gibi devam filmleri ise "aynı" kadar güçlü uyarı veriyordu.
 *
 * YENİ MANTIK — başlık ÖNCE yapısal olarak ayrıştırılır, sonra yalnızca ANLAMLI parçalar karşılaştırılır:
 *   1) ayristir(): ad çekirdeği + YIL (1900–şimdi+1; parantez içinde ya da " - 2013" gibi sonda) + DEVAM NO (sondaki 2, 3, II, III, "Part 2", "Bölüm 2")
 *      + varyantlar (parantez içi alternatif/özgün ad, " - ", " / ", " | " ile ayrılan parçalar, "Ad: Alt başlık" için yalnızca ana ad).
 *      Yıl ve numara ASLA tek başına bir eşleşme sebebi değildir; ad çekirdeğinde en az bir anlamlı harfli kelime yoksa varyant atılır.
 *   2) Çekirdek anahtarı: küçük harf (tr) + aksan katlama + noktalama/boşluk silinir ("Spider-Man" = "spider man" = "spiderman"), baştaki "the/a/an" atılır.
 *   3) Sınıflandırma (güçten zayıfa) — her biri ekranda açık Türkçe etiketle gösterilir:
 *        ayni      — çekirdek aynı, devam no uyumlu, yıl uyumlu ya da biri yok      → "Aynı kayıt" (KESİN KOPYA; onay ister)
 *        ayniYil   — çekirdek aynı ama iki yıl da var ve FARKLI                      → "Aynı ad, farklı yıl" (yeniden çekim olabilir; onay ister)
 *        yazim     — çekirdekler yazım hatası farkıyla aynı (Dice ≥ 0,86, ≥7 harf)   → "Yazımı çok benziyor" (onay ister)
 *        seri      — çekirdek aynı ama devam no farklı (Spider-Man ↔ Spider-Man 2)   → "Aynı serinin başka bölümü" (yalnızca bilgi)
 *        icerir    — yazılan kelimelerin hepsi kayıtlı başlıkta geçiyor              → "Kayıtlı başlığın içinde geçiyor" (yalnızca bilgi)
 *        kapsar    — kayıtlı başlığın kelimelerinin hepsi yazılanın içinde geçiyor   → "Kayıtlı başlık, yazdığının içinde" (yalnızca bilgi)
 *        kelime    — ≥2 ortak anlamlı kelime ve Jaccard ≥ 0,6                        → "Ortak anahtar kelimeler" (yalnızca bilgi)
 *        onek      — yazarken: son kelime yarım olabilir                             → "Başlangıcı uyuyor" (yalnızca bilgi)
 *      "Onay ister" olanlar kayıt eklerken "Yine de ekle" ikinci tıklamasını gerektirir; "yalnızca bilgi" olanlar eklemeyi engellemez.
 */
import { kucukHarfeCevirTr } from "../core/supabase-client.js";

const KATLA = { "ı": "i", "ş": "s", "ç": "c", "ğ": "g", "ö": "o", "ü": "u", "â": "a", "î": "i", "û": "u", "ê": "e", "ô": "o", "œ": "oe", "æ": "ae", "ø": "o", "ß": "ss", "đ": "d", "ł": "l" };
/** Karşılaştırmada yok sayılan kelimeler (yalnızca bağlaç/artikel; anlamlı ad kelimeleri değil). */
const DUR = new Set(["chapter", "volume", "the", "of", "and", "a", "an", "in", "on", "to", "for", "de", "la", "le", "el", "ve", "bir", "ile", "ya", "da", "bu", "o", "part", "bolum", "sezon", "season", "cilt", "vol", "film", "dizi", "movie"]);
const ROMEN = { ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
/** "Part Two", "Bölüm İki" gibi yazıyla verilen devam numaraları (yalnızca part/bölüm/chapter/cilt sözcüğünden sonra). */
const YAZI_NO = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, bir: 1, iki: 2, uc: 3, dort: 4, bes: 5, alti: 6, yedi: 7, sekiz: 8, dokuz: 9, on: 10 };
const NO_ONEK = ["part", "bolum", "chapter", "cilt", "vol", "volume", "sezon", "season"];
const YIL_ENUST = new Date().getFullYear() + 1;

/** Karşılaştırma biçimi: küçük harf (tr) + aksan katlama + noktalama → boşluk. Parantez içi KORUNUR. */
export function normallestir(metin) {
  if (!metin) return "";
  let s = kucukHarfeCevirTr(String(metin)).normalize("NFD").replace(/[̀-ͯ]/g, "");
  s = s.replace(/[ıçşğöüâîûêôœæøßđł]/g, (c) => KATLA[c] || c);
  return s.replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

const yilMi = (t) => /^(19|20)\d{2}$/.test(t) && Number(t) >= 1900 && Number(t) <= YIL_ENUST;
const harfli = (t) => /\p{L}/u.test(t);
const anlamli = (t) => t.length >= 2 && !DUR.has(t);

/** Sondaki devam numarasını ayırır: ["spider","man","2"] → { belirteclar:["spider","man"], no:2 }. 31+ sayılar (2049, 1917…) başlığın parçasıdır. */
function devamNoAyir(tokenler) {
  const t = [...tokenler];
  if (t.length < 2) return { belirteclar: t, no: null };
  let son = t[t.length - 1], no = null;
  if (/^\d{1,2}$/.test(son) && Number(son) >= 1 && Number(son) <= 30) no = Number(son);
  else if (ROMEN[son] && t.length >= 2) no = ROMEN[son];
  else if (YAZI_NO[son] && t.length >= 3 && NO_ONEK.includes(t[t.length - 2])) no = YAZI_NO[son];
  if (no == null) return { belirteclar: t, no: null };
  t.pop();
  if (DUR.has(t[t.length - 1]) && NO_ONEK.includes(t[t.length - 1])) t.pop();
  return { belirteclar: t, no };
}

/** Bir ad parçasından (yıl/parantez yok) çekirdek bilgisi: { anahtar, belirteclar:Set, no }. Çekirdekte anlamlı harfli kelime yoksa null. */
function cekirdek(parca) {
  let n = normallestir(parca).split(" ").filter(Boolean);
  while (n.length > 1 && (n[0] === "the" || n[0] === "a" || n[0] === "an")) n.shift();
  const { belirteclar, no } = devamNoAyir(n);
  const anlamlilar = belirteclar.filter((t) => harfli(t) || (belirteclar.length === 1 && /\d/.test(t)));
  if (!anlamlilar.length) return null;
  const anahtar = belirteclar.join("");
  if (anahtar.length < 2) return null;
  return { anahtar, belirteclar: new Set(belirteclar.filter(anlamli).length ? belirteclar.filter(anlamli) : belirteclar), no };
}

/**
 * Başlığı yapısal olarak ayrıştırır.
 * Dönüş: { yil, varyantlar:[{ anahtar, belirteclar, no, kaynak:"ana"|"alt" }] }
 */
export function ayristir(baslik) {
  const ham = String(baslik || "");
  let yil = null;
  const parantezler = [];
  let govde = ham.replace(/\(([^)]*)\)|\[([^\]]*)\]/g, (_, a, b) => {
    const ic = (a ?? b ?? "").trim();
    if (yilMi(ic)) { yil = Number(ic); return " "; }
    const y = ic.match(/\b(19|20)\d{2}\b/);
    if (y && yilMi(y[0])) { yil = yil ?? Number(y[0]); }
    parantezler.push(ic.replace(/\b(19|20)\d{2}\b/g, " ").replace(/\s*[-–—,;]\s*$/, "").trim());
    return " ";
  });
  // " - 2013" ya da sonda yalın yıl
  govde = govde.replace(/\s[-–—|]\s*((?:19|20)\d{2})\s*$/, (_, y) => { if (yilMi(y)) { yil = yil ?? Number(y); return " "; } return _; });
  const kelimeler = govde.trim().split(/\s+/);
  if (kelimeler.length > 1 && yilMi(kelimeler[kelimeler.length - 1])) { yil = yil ?? Number(kelimeler.pop()); govde = kelimeler.join(" "); }

  const varyantlar = [], goruldu = new Set();
  const ekle = (metin, kaynak, kisaltilmis = false) => {
    const c = cekirdek(metin); if (!c) return;
    const k = c.anahtar + "|" + (c.no ?? ""); if (goruldu.has(k)) return; goruldu.add(k);
    varyantlar.push({ ...c, kaynak, kisaltilmis });
  };
  ekle(govde, "ana");
  // " - ", " / ", " | " ile ayrılan parçalar (yıl-yalnız ya da sayı-yalnız parçalar cekirdek() tarafından atılır)
  const parcalar = govde.split(/\s[-–—|]\s|\s*\/\s*/).map((p) => p.trim()).filter(Boolean);
  if (parcalar.length > 1) parcalar.forEach((p) => ekle(p, "ana"));
  // "Ad: Alt başlık" → yalnızca ana ad, en az iki anlamlı kelime ya da 6+ harf ise (tek kısa kelimeyle yanlış eşleşme olmasın)
  const iki = govde.split(/\s*:\s+/);
  if (iki.length > 1) { const ilk = cekirdek(iki[0]); if (ilk && (ilk.belirteclar.size >= 2 || ilk.anahtar.length >= 6)) ekle(iki[0], "ana", true); }
  // parantez içi alternatif/özgün ad (oyuncu adı olabilir: yalnızca TAM eşleşmede kullanılır)
  parantezler.forEach((p) => p && ekle(p, "alt"));
  return { yil, varyantlar };
}

/** Geriye uyumluluk: eski kod bu isimle çağırıyordu — artık ayrıştırılmış varyantların okunur anahtarlarını döner. */
export function varyantlar(baslik) { return ayristir(baslik).varyantlar.map((v) => [...v.belirteclar].join(" ")); }

function bigramlar(b) { const o = []; for (let i = 0; i < b.length - 1; i++) o.push(b.slice(i, i + 2)); return o; }
/** İki başlık (ya da anahtar) arasındaki bigram Dice benzerliği (0..1). */
export function diceBenzerligi(a, b) {
  const na = normallestir(a).replace(/\s+/g, ""), nb = normallestir(b).replace(/\s+/g, "");
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ba = bigramlar(na), bb = bigramlar(nb);
  if (!ba.length || !bb.length) return 0;
  const sayac = new Map(); bb.forEach((g) => sayac.set(g, (sayac.get(g) || 0) + 1));
  let ortak = 0; ba.forEach((g) => { const k = sayac.get(g) || 0; if (k > 0) { ortak++; sayac.set(g, k - 1); } });
  return (2 * ortak) / (ba.length + bb.length);
}

const noUyumlu = (a, b) => (a ?? 1) === (b ?? 1);
const kesisim = (A, B) => { let n = 0; A.forEach((x) => { if (B.has(x)) n++; }); return n; };

/** Tek bir (yazılan varyantı, kayıt varyantı) çifti için en iyi sınıflandırma ya da null. */
function ciftKarsilastir(q, v, qYil, vYil, sonKelimeYarim) {
  if (q.anahtar === v.anahtar) {
    if (!noUyumlu(q.no, v.no)) return { tur: "seri", oran: 0.62 };
    // Biri "Ad: Alt başlık"tan kısaltılmış ana ad ise (The Hunger Games ↔ The Hunger Games: Catching Fire) bu KOPYA DEĞİL, serinin başka yapımıdır.
    if (q.kisaltilmis || v.kisaltilmis) return { tur: q.kisaltilmis && v.kisaltilmis ? "seri" : q.kisaltilmis ? "kapsar" : "icerir", oran: 0.6 };
    if (v.kaynak === "alt" && q.belirteclar.size < 2 && q.anahtar.length < 8) return null;     // kısa tek kelime parantez içi (oyuncu/yan ad) ile "aynı" sayılmaz
    if (qYil && vYil && qYil !== vYil) return { tur: "ayniYil", oran: 0.88 };
    return { tur: "ayni", oran: qYil && vYil ? 1 : 0.97 };
  }
  const qt = q.belirteclar, vt = v.belirteclar;
  const ortak = kesisim(qt, vt);
  // yazılan, kayıtlı başlığın TÜM kelimelerini içeriyor ya da tersi
  if (ortak === qt.size && vt.size > qt.size && (qt.size >= 2 || q.anahtar.length >= 6)) {
    if (!noUyumlu(q.no, v.no) && q.no != null) return null;
    return { tur: "icerir", oran: 0.6 + 0.2 * (qt.size / vt.size) };
  }
  if (ortak === vt.size && qt.size > vt.size && (vt.size >= 2 || v.anahtar.length >= 6)) return { tur: "kapsar", oran: 0.6 + 0.15 * (vt.size / qt.size) };
  if (q.anahtar.length >= 7 && v.anahtar.length >= 7 && noUyumlu(q.no, v.no)) {
    const d = diceBenzerligi(q.anahtar, v.anahtar);
    if (d >= 0.86) return { tur: "yazim", oran: Math.min(0.9, d * 0.92) };
  }
  const birlesim = qt.size + vt.size - ortak;
  if (ortak >= 2 && ortak / birlesim >= 0.6) return { tur: "kelime", oran: 0.55 + 0.2 * (ortak / birlesim) };
  if (sonKelimeYarim && q.anahtar.length >= 4 && v.anahtar.startsWith(q.anahtar)) return { tur: "onek", oran: 0.56 };
  return null;
}

/** Hangi türler "kopya olabilir" onayı ister (kayıt eklerken ikinci tıklama gerekir). */
export const ONAY_ISTER = new Set(["ayni", "ayniYil", "yazim"]);

/**
 * Tek kayıt için en iyi eşleşmeyi döner: { tur, oran, kayitYil } ya da null.
 * oran: 0..1 (sıralama için).
 */
export function baslikEslestir(yazilan, kayitBasligi) {
  if (normallestir(yazilan).length < 2) return null;
  const Q = ayristir(yazilan), R = ayristir(kayitBasligi);
  if (!Q.varyantlar.length || !R.varyantlar.length) return null;
  const sonYarim = !/[\s]$/.test(String(yazilan)) && true;        // yazarken son kelime tamamlanmamış olabilir
  let en = null;
  for (const q of Q.varyantlar) {
    for (const v of R.varyantlar) {
      const c = ciftKarsilastir(q, v, Q.yil, R.yil, sonYarim && q.kaynak === "ana");
      if (c && (!en || c.oran > en.oran)) en = c;
    }
  }
  return en ? { ...en, kayitYil: R.yil } : null;
}

/**
 * Yazılan başlığa benzeyen kayıtlar. Dönüş: [{ kayit, oran, tur, guclu, onay, kayitYil }] — oran azalan.
 *   guclu = "büyük olasılıkla aynı kayıt" (tur ayni) · onay = kayıt eklerken ikinci tıklama istenmeli mi.
 * Eski çağrılarla uyumlu imza: (baslik, kayitlar, esik, limit).
 */
export function enBenzerKayitlariBul(baslik, kayitlar, esik = 0.55, limit = 3) {
  if (!baslik || !Array.isArray(kayitlar) || !kayitlar.length) return [];
  const sonuc = [];
  for (const kayit of kayitlar) {
    const e = baslikEslestir(baslik, kayit.title);
    if (e && e.oran >= esik) sonuc.push({ kayit, oran: e.oran, tur: e.tur, guclu: e.tur === "ayni", onay: ONAY_ISTER.has(e.tur), kayitYil: e.kayitYil });
  }
  return sonuc.sort((a, b) => b.oran - a.oran || String(a.kayit.title).localeCompare(String(b.kayit.title), "tr")).slice(0, limit);
}

export const TUR_ETIKET = {
  ayni: "Aynı kayıt",
  ayniYil: "Aynı ad, farklı yıl (yeniden çekim olabilir)",
  yazim: "Yazımı çok benziyor",
  seri: "Aynı serinin başka bölümü",
  icerir: "Kayıtlı başlığın içinde geçiyor",
  kapsar: "Kayıtlı başlık, yazdığının içinde",
  kelime: "Ortak anahtar kelimeler",
  onek: "Başlangıcı uyuyor",
};
/** Kısa, kullanıcıya dönük açıklama (rozetin altındaki ipucu). */
export const TUR_ACIKLAMA = {
  ayni: "Ad, yıl ve bölüm numarası uyuşuyor: büyük olasılıkla aynı kayıt.",
  ayniYil: "Ad aynı ama yıllar farklı: aynı yapımın yeniden çekimi ya da başka bir yapım olabilir.",
  yazim: "Ad, küçük bir yazım farkıyla aynı görünüyor.",
  seri: "Aynı serinin farklı bir bölümü; kopya sayılmaz.",
  icerir: "Yazdığın ad, bu kaydın başlığının bir parçası; devam ya da alt başlık olabilir.",
  kapsar: "Bu kaydın adı, yazdığın başlığın içinde geçiyor.",
  kelime: "Ortak kelimeler var; yalnızca bilgi.",
  onek: "Yazmaya devam ettikçe daralır.",
};

/** Başlıkta yazılanla örtüşen KELİMELERİ [{metin, vurgu}] parçalarına ayırır (arayüzde <mark> için). Tire ve iki nokta ayracı korunur. */
export function vurguParcalari(baslik, yazilan) {
  const qn = normallestir(yazilan).split(" ").filter(Boolean);
  const qk = new Set(qn.filter((t) => anlamli(t) && (harfli(t) || qn.length === 1)));
  const qSon = qn[qn.length - 1] || "";
  return String(baslik || "").split(/([\s\-–—:,.'’/]+)/).filter((p) => p !== "").map((p) => {
    const n = normallestir(p);
    const vurgu = !!n && harfli(n) && (qk.has(n) || (qSon.length >= 3 && harfli(qSon) && n.startsWith(qSon) && qk.has(qSon)));
    return { metin: p, vurgu };
  });
}

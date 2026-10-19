/**
 * haber-filtre.js — Haber süzgeci (tarayıcıda, LLM'den ÖNCE, ağ isteği YOK).
 * -----------------------------------------------------------------------------------------------------------------
 * Sıra (her haber için ilk eşleşen eleme sayılır):
 *   1) TIK TUZAĞI  → başlıkta soru işareti, çoklu ünlem ya da sansasyonel kalıp (şok, flaş, "inanılmaz", "you won't believe"…)
 *   2) ZAMAN       → yalnızca BUGÜN (konumun saat dilimine göre). Dün/eski/yarın yayınlananlar elenir.
 *                    Bugün yayınlanıp metinde "yarın/tomorrow/ertesi gün" geçiyorsa kalır ve kismenGelecek = true olur.
 *   3) KONUM       → en özelden genele: sokak → mahalle → ilçe → il/şehir → bölge → ülke. Hiçbiri eşleşmezse başka yerin haberidir.
 *                    Worker'ın konuma özel çektiği yerel haberler (h.yerel) zaten bu şehir için olduğundan konum testinden geçer.
 *
 * suz(haberler, { konum, il, simdi, tz }) → { gecenler: [{...haber, kapsam, kapsamAd, kismenGelecek}], elenen: { clickbait, zaman, konum } }
 *   • il: Türkiye'deyse iller.js il nesnesi ({ ad, bolge, … }), değilse null (dünya havuzu).
 * Konum Worker'a HİÇ gitmez; bu dosya yalnızca tarayıcıdaki havuz üzerinde çalışır.
 */
import { normalize, ILLER, ilAniliyor, bolgeAniliyor, BOLGELER } from "./iller.js";

/* ------------------------------------------------ yardımcılar ------------------------------------------------ */

/** Türkçe normalize + aksan sökme (é→e, ñ→n …): Türkçe olmayan şehir/ülke adları için de eşleşsin. */
const duz = (s) => normalize(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
const kacis = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** "YYYY-MM-DD" (verilen saat diliminde). Geçersiz saat diliminde Europe/Istanbul'a düşer. */
export function gunAnahtari(tarih, tz = "Europe/Istanbul") {
  const d = tarih instanceof Date ? tarih : new Date(tarih);
  if (Number.isNaN(d.getTime())) return null;
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d); }
  catch { return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(d); }
}

/* ------------------------------------------------ 1) tık tuzağı ------------------------------------------------ */
const TIK_TUZAGI = new RegExp([
  // Türkçe (normalize edilmiş metinde)
  "(^|[^a-z0-9])(sok|sok edici|flas|bomba gibi|inanilmaz|korkunc|dehset|bunu gorunce|bunu gorenler|herkes bunu konusuyor|izlerken|gozlerinize inanamayacaksiniz)([^a-z0-9]|$)",
  "felaket kapida|felaketin esiginde|kiyamet (kopacak|gibi)|dunyanin sonu|hayatinizi degistirecek|kimse bunu soylemiyor|meger|bu detaya dikkat",
  // İngilizce
  "you won'?t believe|shocking|jaw-?dropping|mind-?blowing|unbelievable|what happens next|this is why|here'?s why|apocalyptic|doomsday|going viral|goes viral|will shock you",
].join("|"));

function tikTuzagiMi(baslik) {
  if (/[?？]/.test(baslik)) return true;                  // soru işareti = tık tuzağı (resmî uyarılar soru sormaz)
  if (/!{2,}|!\s*!/.test(baslik)) return true;            // çoklu ünlem
  return TIK_TUZAGI.test(duz(baslik));
}

/* ------------------------------------------------ 2) zaman ------------------------------------------------ */
const YARINA_SARKAR = /(^|[^a-z0-9])(yarin|yarina|yarindan|ertesi gun|gece boyunca|pazartesi gunune|tomorrow|overnight|into tomorrow|next day)([^a-z0-9]|$)/;

/* ------------------------------------------------ 3) konum ------------------------------------------------ */

/** Ad metinde geçiyor mu? Türkçe ek kuralı: ≥5 harfte 0-5 harf ek ya da apostroflu ek; kısa adlarda yalnızca apostrof/sınır. */
function adGeciyor(t, ad) {
  const a = duz(ad);
  if (!a || a.length < 3) return false;
  const k = kacis(a);
  const desen = a.length >= 5 ? `(^|[^a-z0-9])${k}([a-z]{0,5}|'[a-z]+)([^a-z0-9]|$)` : `(^|[^a-z0-9])${k}('[a-z]+|[^a-z0-9]|$)`;
  return new RegExp(desen).test(t);
}
/** Mahalle/sokak adındaki "Mahallesi / Sokak / Caddesi / Cd. / Sk." gibi son ekleri at → "Esatpaşa Mahallesi" ≈ "Esatpaşa". */
const govdeAd = (s) => duz(s).replace(/\b(mahallesi|mah|mahalle|sokagi|sokak|sk|caddesi|cadde|cd|bulvari|bulvar|blv|neighbou?rhood|district|street|st|road|rd|avenue|ave)\b\.?/g, "").replace(/\s+/g, " ").trim();

/** Ülke takma adları (ISO kodu → ek adlar); ülkenin kendi adı konum.ulkeAd/ulkeAdEn'den gelir. */
const ULKE_TAKMA = {
  US: ["united states", "usa", "u.s.", "america", "american"],
  GB: ["united kingdom", "uk", "u.k.", "britain", "british", "england", "scotland", "wales", "northern ireland"],
  DE: ["germany", "deutschland", "german"], FR: ["france", "french"], ES: ["spain", "espana", "spanish"],
  IT: ["italy", "italia", "italian"], JP: ["japan", "japanese"], CN: ["china", "chinese"], IN: ["india", "indian"],
  RU: ["russia", "russian"], BR: ["brazil", "brasil", "brazilian"], AU: ["australia", "australian"],
  CA: ["canada", "canadian"], MX: ["mexico", "mexican"], GR: ["greece", "greek"], NL: ["netherlands", "holland", "dutch"],
  TR: ["turkey", "turkiye", "turkish"],
};
const TR_ULKE_GENEL = /turkiye genelinde|turkiye geneli|turkiye'de|turkiye'nin (cogu|birçok|bircok|pek cok|genelinde)|yurt genelinde|ulke genelinde|yurdun (cogu|bircok|pek cok)|turkey|turkiye (is|will|braces)/;

/**
 * Konum eşleşmesi. @returns {{kapsam:'sokak'|'mahalle'|'ilce'|'il'|'bolge'|'ulke', kapsamAd:string}|null}
 */
function konumEslestir(h, t, konum, il) {
  // Worker'ın bu şehir için çektiği yerel haber: yer süzmesi gerekmez.
  if (h.yerel) return { kapsam: "il", kapsamAd: konum.ad || konum.adEn || "" };

  const sokak = konum.sokak ? govdeAd(konum.sokak) : "";
  const mahalle = konum.mahalle ? govdeAd(konum.mahalle) : "";

  if (il) {
    // Türkiye: özel yerler yalnızca metin BAŞKA bir ili anmıyorsa (ya da bizim ili de anıyorsa) kabul edilir ("Kadıköy" başka ilde de var).
    const ilAnildi = ilAniliyor(t, il);
    const digerIl = ILLER.some((x) => x.ad !== il.ad && ilAniliyor(t, x));
    const ozelGuvenli = ilAnildi || !digerIl;
    if (ozelGuvenli && sokak && adGeciyor(t, sokak)) return { kapsam: "sokak", kapsamAd: konum.sokak };
    if (ozelGuvenli && mahalle && adGeciyor(t, mahalle)) return { kapsam: "mahalle", kapsamAd: konum.mahalle };
    if (ozelGuvenli && konum.ilce && adGeciyor(t, konum.ilce)) return { kapsam: "ilce", kapsamAd: konum.ilce };
    if (ilAnildi) return { kapsam: "il", kapsamAd: il.ad };
    // Bölge: yalnızca başka il adı anılmıyorsa ("Marmara'da sağanak" evet; "Marmara: Bursa'da sağanak" İstanbul için hayır).
    if (!digerIl && BOLGELER[il.bolge] && bolgeAniliyor(t, il)) return { kapsam: "bolge", kapsamAd: BOLGELER[il.bolge].ad };
    if (!digerIl && TR_ULKE_GENEL.test(t)) return { kapsam: "ulke", kapsamAd: "Türkiye" };
    return null;
  }

  // Dünya: şehir / bölge (admin1) / ülke; İngilizce ve yerel adlar birlikte denenir.
  const sehirler = [konum.adEn, konum.ad].filter(Boolean);
  const ozel = (ad) => adGeciyor(t, ad);
  if (sokak && ozel(sokak)) return { kapsam: "sokak", kapsamAd: konum.sokak };
  if (mahalle && ozel(mahalle)) return { kapsam: "mahalle", kapsamAd: konum.mahalle };
  if (konum.ilce && ozel(konum.ilce)) return { kapsam: "ilce", kapsamAd: konum.ilce };
  const sehir = sehirler.find(ozel);
  if (sehir) return { kapsam: "il", kapsamAd: konum.adEn || konum.ad };
  const bolge = [konum.admin1En, konum.admin1].filter(Boolean).find(ozel);
  if (bolge) return { kapsam: "bolge", kapsamAd: konum.admin1En || konum.admin1 };
  const ulkeAdlari = [konum.ulkeAdEn, konum.ulkeAd, ...(ULKE_TAKMA[String(konum.ulke || "").toUpperCase()] || [])].filter(Boolean);
  const ulke = ulkeAdlari.find((a) => duz(a).length >= 4 ? ozel(a) : new RegExp(`(^|[^a-z0-9])${kacis(duz(a))}([^a-z0-9]|$)`).test(t));
  if (ulke) return { kapsam: "ulke", kapsamAd: konum.ulkeAdEn || konum.ulkeAd || ulke };
  return null;
}

/* ------------------------------------------------ ana işlev ------------------------------------------------ */

/**
 * @param {Array<object>} haberler  Worker havuzu: { id, kaynak, kaynakAd, tur, baslik, ozet, link, yayin, yerel?, resmi? }
 * @param {{konum:object, il:object|null, simdi?:Date, tz?:string}} g
 * @returns {{gecenler:Array<object>, elenen:{clickbait:number, zaman:number, konum:number}}}
 */
export function suz(haberler, { konum, il = null, simdi = new Date(), tz = "Europe/Istanbul" } = {}) {
  const elenen = { clickbait: 0, zaman: 0, konum: 0 };
  const gecenler = [];
  const bugun = gunAnahtari(simdi, tz);
  for (const h of Array.isArray(haberler) ? haberler : []) {
    if (!h || !h.baslik) continue;
    // 1) tık tuzağı
    if (tikTuzagiMi(h.baslik)) { elenen.clickbait++; continue; }
    // 2) yalnızca bugün (konumun saat dilimine göre)
    if (!h.yayin || gunAnahtari(h.yayin, tz) !== bugun) { elenen.zaman++; continue; }
    // 3) konum
    const t = duz(`${h.baslik} ${h.ozet || ""}`);
    const e = konum ? konumEslestir(h, t, konum, il) : null;
    if (!e) { elenen.konum++; continue; }
    gecenler.push({ ...h, kapsam: e.kapsam, kapsamAd: e.kapsamAd, kismenGelecek: YARINA_SARKAR.test(t) });
  }
  return { gecenler, elenen };
}

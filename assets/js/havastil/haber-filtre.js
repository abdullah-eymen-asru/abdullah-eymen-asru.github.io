/**
 * haber-filtre.js — "Haber doğrulama" YEREL ve DETERMİNİSTİK süzgeçleri (LLM YOK, ağ YOK). Türkçe + İngilizce.
 *   1) Tık tuzağı: soru işareti / manipülatif kalıp → çöp
 *   2) Zaman: yalnızca BUGÜNÜ ilgilendirenler (gelecek gün, geçmiş gün ve eski haberler elenir) — haberin konumunun SAAT DİLİMİNE göre
 *   3) Yer: sokak → mahalle → ilçe → il/şehir → bölge → ülke sırasıyla EN ÖZEL eşleşme bulunur (hepsi tarayıcıda; sunucuya yer gitmez)
 */
import { normalize, ilAniliyor, bolgeAniliyor, BOLGELER } from "./iller.js";

/* ------------------------------ 1) CLICKBAIT ------------------------------ */
export const CLICKBAIT_KALIPLARI = [
  /korkutan/, /felaket geliyor/, /(^|[^a-z0-9])o il(imiz|imize|imizde|e|de)?([^a-z0-9]|$)/, /tarih verildi/, /uzmanlar? uyardi/, /sakin yapmayin/,
  /kiyamet/, /dehset/, /inanamayacaksiniz/, /(^|[^a-z0-9])sok([^a-z0-9]|$)/, /herkes bunu/, /bunu gorenler/,
  /you won'?t believe/, /(^|[^a-z0-9])shocking/, /terrifying/, /doom(sday)?/, /apocalypse/, /experts? (warn|fear)/, /this is why/, /what happens next/,
];
export function clickbaitMi(baslik) {
  if (/[?？]/.test(String(baslik))) return "soru işareti";
  const t = normalize(baslik);
  return CLICKBAIT_KALIPLARI.some((d) => d.test(t)) ? "manipülatif kalıp" : null;
}

/* ------------------------------ 2) ZAMAN ------------------------------ */
const GUN_TR = ["pazar", "pazartesi", "sali", "carsamba", "persembe", "cuma", "cumartesi"];
const GUN_EN = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const AY_TR = ["ocak", "subat", "mart", "nisan", "mayis", "haziran", "temmuz", "agustos", "eylul", "ekim", "kasim", "aralik"];
const AY_EN = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
export const SIMDI_MARKERLARI = [
  /(^|[^a-z0-9])bugun/, /bu gece/, /(^|[^a-z0-9])anlik/, /su an(da)?([^a-z0-9]|$)/, /ogleden sonra/, /aksam([^a-z0-9]|$)/, /bu sabah/, /sabah saatlerinde/, /gece saatlerinde/,
  /gun boyu/, /(^|[^a-z0-9])saatlerde/, /onumuzdeki (\d+ )?saat/, /ogle saatlerinde/,
  /(^|[^a-z0-9])today/, /tonight/, /this (morning|afternoon|evening)/, /(^|[^a-z0-9])now([^a-z0-9]|$)/, /currently/, /(until|through) (this )?(evening|tonight)/, /(^|[^a-z0-9])overnight/,
];
export const TAZE_SAAT = 6;

/** Verilen saat diliminde "şimdi": { gunAdiTr, gunAdiEn, gun, ayTr, ayEn, haftaSonu } */
export function simdiBilgisi(d = new Date(), tz = "Europe/Istanbul") {
  let p;
  try { p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).formatToParts(d).map((x) => [x.type, x.value])); }
  catch { p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).formatToParts(d).map((x) => [x.type, x.value])); }
  const gunEn = p.weekday.toLowerCase(), i = GUN_EN.indexOf(gunEn), ayEn = p.month.toLowerCase();
  return { gunAdiEn: gunEn, gunAdiTr: GUN_TR[i], gun: Number(p.day), ayEn, ayTr: AY_TR[AY_EN.indexOf(ayEn)], haftaSonu: i === 0 || i === 6 };
}
export const trSimdi = (d, tz) => simdiBilgisi(d, tz);

export function zamanDegerlendir({ baslik, ozet, yayin }, simdi = new Date(), pencereSaat = 24, tz = "Europe/Istanbul") {
  const t = normalize(`${baslik} ${ozet || ""}`);
  const yas = (simdi.getTime() - new Date(yayin).getTime()) / 36e5;
  if (!Number.isFinite(yas)) return { gecerli: false, neden: "yayın zamanı yok" };
  if (yas > pencereSaat) return { gecerli: false, neden: `${pencereSaat} saatten eski` };

  const s = simdiBilgisi(simdi, tz);
  const simdiIsareti = SIMDI_MARKERLARI.some((d) => d.test(t));
  let gelecek = false, gecmis = false;

  if (/(^|[^a-z0-9])dun([^a-z0-9]|$)|gecen (hafta|gece)|yesterday|last (night|week)/.test(t)) gecmis = true;
  if (/(^|[^a-z0-9])yarin|haftaya|gelecek hafta|onumuzdeki (gun|gunler|hafta|haftalar|ay)|\d+ gun sonra|(^|[^a-z0-9])hafta ici|tomorrow|next week|coming days|later this week|over the weekend/.test(t)) gelecek = true;
  if (/hafta sonu|(^|[^a-z0-9])weekend/.test(t) && !s.haftaSonu) gelecek = true;
  GUN_TR.forEach((g, i) => {
    const desenTr = g === "pazar" ? /(^|[^a-z0-9])pazar (gunu|gunune|gunden|aksami|gecesi|sabahi|itibaren)/ : new RegExp(`(^|[^a-z0-9])${g}([^a-z0-9]|$)`);
    const desenEn = new RegExp(`(^|[^a-z0-9])${GUN_EN[i]}([^a-z0-9]|$)`);
    if ((desenTr.test(t) || desenEn.test(t)) && GUN_EN[i] !== s.gunAdiEn) gelecek = true;
  });
  for (const m of t.matchAll(new RegExp(`(\\d{1,2})\\s+(${AY_TR.join("|")}|${AY_EN.join("|")})`, "g"))) {
    if (Number(m[1]) !== s.gun || ![s.ayTr, s.ayEn].includes(m[2])) gelecek = true;
  }
  for (const m of t.matchAll(new RegExp(`(${AY_EN.join("|")})\\s+(\\d{1,2})`, "g"))) {
    if (Number(m[2]) !== s.gun || m[1] !== s.ayEn) gelecek = true;
  }
  if (gecmis && !simdiIsareti) return { gecerli: false, neden: "geçmiş güne ait" };
  if (gelecek && !simdiIsareti) return { gecerli: false, neden: "gelecek günü hedefliyor" };
  if (!simdiIsareti && yas > TAZE_SAAT) return { gecerli: false, neden: "bugüne ait açık işaret yok" };
  return { gecerli: true, simdiIsareti, kismenGelecek: gelecek };
}

/* ------------------------------ 3) YER (en özelden genele) ------------------------------ */
const KAPSAM_SIRA = ["sokak", "mahalle", "ilce", "il", "bolge", "ulke"];
const KAPSAM_AD = { sokak: "sokağını", mahalle: "mahallesini", ilce: "ilçesini", il: "ilini", bolge: "bölgesini", ulke: "ülkesini" };
export const kapsamEtiketi = (k) => KAPSAM_AD[k] || "";
const kacis = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Bir adın metinde geçip geçmediği. Türkçe ekler (İstanbul'da/İstanbulda) ve İngilizce iyelik (London's) tolere edilir. */
function adGeciyor(t, ad) {
  const n = normalize(ad).trim();
  if (n.length < 3) return false;
  const e = kacis(n);
  return new RegExp(`(^|[^a-z0-9])${e}(${n.length >= 5 ? "[a-z]{0,4}|" : ""}'[a-z]+|s)?([^a-z0-9]|$)`).test(t);
}

/**
 * @param {{baslik,ozet}} h  @param {object} konum  { ulke, ad, adEn, admin1, admin1En, ulkeAd, ilce, mahalle, sokak, il }  @param {object|null} il  TR il nesnesi
 * @returns {{kapsam:string, ad:string}|null}  en özel eşleşme
 */
export function yerEslesmesi({ baslik, ozet }, konum, il) {
  const t = normalize(`${baslik} ${ozet || ""}`);
  const seviyeler = {};
  if (konum.sokak) seviyeler.sokak = [konum.sokak];
  if (konum.mahalle) seviyeler.mahalle = [konum.mahalle];
  if (konum.ilce) seviyeler.ilce = [konum.ilce];
  if (il) {
    if (ilAniliyor(t, il)) return enOzel(seviyeler, t, { kapsam: "il", ad: il.ad });
    if (bolgeAniliyor(t, il)) return enOzel(seviyeler, t, { kapsam: "bolge", ad: BOLGELER[il.bolge].ad });
    if (/yurt genelinde|turkiye genelinde|tum yurtta|ulke genelinde|yurdun (genelinde|tamaminda)|turkiye'de|turkiye'nin|nationwide|across turkey/.test(t)) return enOzel(seviyeler, t, { kapsam: "ulke", ad: "Türkiye" });
    return enOzel(seviyeler, t, null);
  }
  const sehir = [konum.ad, konum.adEn].filter(Boolean);
  const bolge = [konum.admin1, konum.admin1En].filter((x, i, a) => x && a.indexOf(x) === i && !sehir.includes(x));
  const ulke = [konum.ulkeAd, konum.ulkeAdEn].filter(Boolean);
  if (sehir.some((a) => adGeciyor(t, a))) return enOzel(seviyeler, t, { kapsam: "il", ad: konum.adEn || konum.ad });
  if (bolge.some((a) => adGeciyor(t, a))) return enOzel(seviyeler, t, { kapsam: "bolge", ad: konum.admin1En || konum.admin1 });
  if (ulke.some((a) => adGeciyor(t, a))) return enOzel(seviyeler, t, { kapsam: "ulke", ad: konum.ulkeAdEn || konum.ulkeAd });
  return enOzel(seviyeler, t, null);
}
function enOzel(seviyeler, t, genel) {
  for (const k of ["sokak", "mahalle", "ilce"]) {
    const ad = (seviyeler[k] || []).find((a) => adGeciyor(t, a));
    if (ad) return { kapsam: k, ad };
  }
  return genel;
}

/* ------------------------------ süzgeç hattı ------------------------------ */
/**
 * @returns {{gecenler:Array, elenen:{clickbait:number,zaman:number,konum:number}}}
 */
export function suz(haberler, { konum, il, simdi = new Date(), tz = "Europe/Istanbul" }) {
  const elenen = { clickbait: 0, zaman: 0, konum: 0 };
  const gecenler = [];
  const gorulen = new Set();
  for (const h of haberler) {
    const anahtar = normalize(h.baslik).replace(/[^a-z0-9]+/g, " ").trim();
    if (gorulen.has(anahtar)) continue;
    gorulen.add(anahtar);
    if (clickbaitMi(h.baslik)) { elenen.clickbait++; continue; }
    const pencere = h.tur === "genel" ? 18 : 24;
    const z = zamanDegerlendir(h, simdi, pencere, tz);
    if (!z.gecerli) { elenen.zaman++; continue; }
    const y = yerEslesmesi(h, konum, il);
    if (!y) { elenen.konum++; continue; }
    gecenler.push({ ...h, kapsam: y.kapsam, kapsamAd: y.ad, simdiIsareti: z.simdiIsareti, kismenGelecek: !!z.kismenGelecek });
  }
  return { gecenler, elenen };
}
export { KAPSAM_SIRA };

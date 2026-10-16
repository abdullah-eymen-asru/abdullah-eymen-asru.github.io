/**
 * haber-filtre.js — "Haber Doğrulama" YEREL ve DETERMİNİSTİK filtreleri (LLM YOK, ağ YOK, saf JS).
 * Her haber sırayla 3 bariyerden geçer; elenen her haber için GEREKÇE tutulur (arayüzde "Neden elendi?" olarak sayılır):
 *   1) Clickbait bariyeri   — soru işareti ve manipülatif kalıplar → doğrudan çöp.
 *   2) Zaman ayrıştırması   — gelecek gün/tarih hedefleyenler ve eski haberler elenir; yalnızca mevcut günü ilgilendirenler kalır.
 *   3) Konum uyumu          — başlıkta/özette seçili il (ya da bölgesi) açıkça anılmalı.
 * Sıra bilinçli: en ucuz/en kesin bariyer önce.
 */
import { normalize, ilAniliyor, bolgeAniliyor } from "./iller.js";

/* ------------------------------ 1) CLICKBAIT ------------------------------ */
// Normalize edilmiş metinde aranır (ı→i, ş→s …). İlk 6 kalıp kullanıcı şartnamesindendir; sonrakiler benim eklemelerimdir.
export const CLICKBAIT_KALIPLARI = [
  /korkutan/, /felaket geliyor/, /(^|[^a-z0-9])o il(imiz|imize|imizde|e|de)?([^a-z0-9]|$)/, /tarih verildi/, /uzmanlar? uyardi/, /sakin yapmayin/,
  /kiyamet/, /dehset/, /inanamayacaksiniz/, /(^|[^a-z0-9])sok([^a-z0-9]|$)/, /herkes bunu/, /bunu gorenler/,
];
export function clickbaitMi(baslik) {
  if (/[?？]/.test(String(baslik))) return "soru işareti";
  const t = normalize(baslik);
  const k = CLICKBAIT_KALIPLARI.find((d) => d.test(t));
  return k ? "manipülatif kalıp" : null;
}

/* ------------------------------ 2) ZAMAN ------------------------------ */
const GUNLER = ["pazar", "pazartesi", "sali", "carsamba", "persembe", "cuma", "cumartesi"]; // getDay() sırası
const AYLAR = ["ocak", "subat", "mart", "nisan", "mayis", "haziran", "temmuz", "agustos", "eylul", "ekim", "kasim", "aralik"];
export const SIMDI_MARKERLARI = [
  /(^|[^a-z0-9])bugun/, /bu gece/, /(^|[^a-z0-9])anlik/, /su an(da)?([^a-z0-9]|$)/, /ogleden sonra/, /aksam (saatlerinde|saatlerine|saatlerine kadar)/, /aksam([^a-z0-9]|$)/,
  /bu sabah/, /sabah saatlerinde/, /gece saatlerinde/, /gun boyu/, /(^|[^a-z0-9])saatlerde/, /onumuzdeki (\d+ )?saat/, /ogle saatlerinde/,
];
/** Türkiye saatiyle "şimdi": { gunAdi, gun, ay, hafta_sonu } */
export function trSimdi(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", weekday: "long", day: "numeric", month: "long" })
    .formatToParts(d).map((x) => [x.type, x.value]));
  const gunAdi = normalize(p.weekday), ay = normalize(p.month);
  return { gunAdi, gun: Number(p.day), ay, haftaSonu: gunAdi === "cumartesi" || gunAdi === "pazar" };
}

/**
 * @returns {{gecerli:boolean, neden?:string, simdiIsareti:boolean, kismenGelecek:boolean}}
 * Kural özeti:
 *  - Geçmiş ("dün"), 24 saatten eski/12 saatten eski (pencere) yayınlar elenir.
 *  - Bugünden farklı gün adı / tarih / "yarın" / "haftaya" / "önümüzdeki günler" = gelecek hedefli → elenir.
 *    İstisna: aynı metinde "bugün/bu gece/anlık" gibi AÇIK bir şimdi işareti de varsa ("bugün ve yarın") tutulur, kismenGelecek=true.
 *  - Şimdi işareti yoksa: yalnızca çok taze (≤ TAZE_SAAT) yayınlar "anlık yayın" sayılır. TAZE_SAAT=0 → katı mod (işaret şart).
 */
export const TAZE_SAAT = 6;
export function zamanDegerlendir({ baslik, ozet, yayin }, simdi = new Date(), pencereSaat = 24) {
  const t = normalize(`${baslik} ${ozet || ""}`);
  const yas = (simdi.getTime() - new Date(yayin).getTime()) / 36e5;
  if (!Number.isFinite(yas)) return { gecerli: false, neden: "yayın zamanı yok" };
  if (yas > pencereSaat) return { gecerli: false, neden: `${pencereSaat} saatten eski` };

  const s = trSimdi(simdi);
  const simdiIsareti = SIMDI_MARKERLARI.some((d) => d.test(t));
  let gelecek = false, gecmis = false;

  if (/(^|[^a-z0-9])dun([^a-z0-9]|$)|gecen (hafta|gece)/.test(t)) gecmis = true;
  if (/(^|[^a-z0-9])yarin|haftaya|gelecek hafta|onumuzdeki (gun|gunler|hafta|haftalar|ay)|\d+ gun sonra|(^|[^a-z0-9])hafta ici/.test(t)) gelecek = true;
  if (/hafta sonu/.test(t) && !s.haftaSonu) gelecek = true;
  for (const g of GUNLER) {
    // "pazar" ilçe adı olabilir (Rize/Tokat) → yalnızca "pazar günü/akşamı/…" ile gün sayılır
    const desen = g === "pazar" ? /(^|[^a-z0-9])pazar (gunu|gunune|gunden|aksami|gecesi|sabahi|itibaren)/ : new RegExp(`(^|[^a-z0-9])${g}([^a-z0-9]|$)`);
    if (desen.test(t) && g !== s.gunAdi) gelecek = true;
  }
  for (const m of t.matchAll(/(\d{1,2})\s+(ocak|subat|mart|nisan|mayis|haziran|temmuz|agustos|eylul|ekim|kasim|aralik)/g)) {
    if (Number(m[1]) !== s.gun || m[2] !== s.ay) gelecek = true;
  }
  if (gecmis && !simdiIsareti) return { gecerli: false, neden: "geçmiş güne ait" };
  if (gelecek && !simdiIsareti) return { gecerli: false, neden: "gelecek günü hedefliyor" };
  if (!simdiIsareti && yas > TAZE_SAAT) return { gecerli: false, neden: "bugüne ait açık işaret yok" };
  return { gecerli: true, simdiIsareti, kismenGelecek: gelecek };
}

/* ------------------------------ 3) KONUM ------------------------------ */
/** @returns {"il"|"bolge"|null} */
export function konumUyumu({ baslik, ozet }, il) {
  const t = normalize(`${baslik} ${ozet || ""}`);
  if (ilAniliyor(t, il)) return "il";
  if (bolgeAniliyor(t, il)) return "bolge";
  return null;
}

/**
 * Üç bariyerden geçir. Kural motoruna uygun olup olmadığı (kritik mi) ayrıca taktik.js'te belirlenir.
 * @returns {{gecenler:Array, elenen:{clickbait:number,zaman:number,konum:number}, ayrinti:Array}}
 */
export function suz(haberler, { il, simdi = new Date(), pencereSaat = 24 }) {
  const elenen = { clickbait: 0, zaman: 0, konum: 0 };
  const ayrinti = [];
  const gecenler = [];
  const gorulen = new Set();
  for (const h of haberler) {
    const anahtar = normalize(h.baslik).replace(/[^a-z0-9]+/g, " ").trim();
    if (gorulen.has(anahtar)) continue; // aynı başlık tekrarı
    gorulen.add(anahtar);
    const cb = clickbaitMi(h.baslik);
    if (cb) { elenen.clickbait++; ayrinti.push({ baslik: h.baslik, bariyer: "clickbait", neden: cb }); continue; }
    const z = zamanDegerlendir(h, simdi, pencereSaat);
    if (!z.gecerli) { elenen.zaman++; ayrinti.push({ baslik: h.baslik, bariyer: "zaman", neden: z.neden }); continue; }
    const k = konumUyumu(h, il);
    if (!k) { elenen.konum++; ayrinti.push({ baslik: h.baslik, bariyer: "konum", neden: `${il.ad} / ${il.bolge} anılmıyor` }); continue; }
    gecenler.push({ ...h, konumKapsami: k, simdiIsareti: z.simdiIsareti, kismenGelecek: !!z.kismenGelecek });
  }
  return { gecenler, elenen, ayrinti };
}

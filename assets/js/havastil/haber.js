/**
 * haber.js — "Haber Doğrulama & Taktik" orkestrasyonu (sade, havuz tabanlı).
 * -----------------------------------------------------------------------------------------------------------------
 * HAVUZ MANTIĞI (kota + güncellik + gizlilik):
 *   • Worker, doğrudan RSS kaynaklarından yalnızca HAVA OLAYIYLA ilgili başlıkları toplar ve iki HAVUZ olarak sunar: "tr" (Türkiye) ve "dunya".
 *   • Havuz Worker'da 10 dk, tarayıcıda 15 dk önbelleklenir. Aynı havuzu kullanan TÜM konumlar (il, ilçe, mahalle, sokak; kayıtlı yerlerin
 *     hepsi) tek çekimle çalışır → konum değiştirmek ağ isteği DOĞURMAZ.
 *   • İl/ilçe/mahalle/sokak süzmesi tamamen TARAYICIDA yapılır; konum bilgisi Worker'a HİÇ gitmez.
 * Hiçbir LLM çağrısı yoktur (Mod B ayrıca arayuz → /stilist, yalnızca haberId ile).
 */
import { supabase } from "../core/supabase-client.js";
import { suz } from "./haber-filtre.js";
import { kurallariCikar, dogrula, seviyePuani, kisitlaraCevir, KURALLAR } from "./taktik.js";
import { normalize, ilAdindan, enYakinIl } from "./iller.js";

export const HAVASTIL_WORKER_URL = "https://havastil-worker.aeymena.workers.dev";
const TTL_MS = 15 * 60 * 1000;          // tarayıcı havuz ömrü
const ESKI_KABUL_MS = 3 * 60 * 60 * 1000; // ağ yokken en çok 3 saatlik veri
const MIN_ZORLA_MS = 2 * 60 * 1000;      // elle yenileme en sık 2 dk'da bir
const LS_ON = "hv_havuz_";

const bekleyen = new Map(); // havuz → Promise (aynı anda tek istek)

/** Yerel resmî meteoroloji terimleriyle (Worker tarafında) dinamik Google News coğrafi taraması; burada yalnızca ülke kodu + şehir adı gider. */
const YEREL_KURAL = [
  ["firtina", /sturm|orkan|unwetter|tempete|vent violent|tormenta|temporal|tempesta|burrasca|storm|gale/],
  ["saganak", /gewitter|starkregen|hagel|hochwasser|orage|pluies? (diluvienne|intense|torrentielle)|inondation|lluvia|alluvione|temporale|flood|heavy rain|thunder/],
  ["don", /frost|glatteis|verglas|(^|[^a-z])gel([^a-z]|$)|helada|ghiaccio|(^|[^a-z])ice([^a-z]|$)|freez/],
  ["kar", /schnee|neige|nieve|(^|[^a-z])neve|snow|blizzard/],
  ["sicak", /hitze|canicule|ola de calor|ondata di caldo|heat ?wave/],
  ["sis", /nebel|brouillard|niebla|nebbia|(^|[^a-z])fog/],
];
function yerelKurallar(h) {
  const t = normalize(`${h.baslik} ${h.ozet || ""}`);
  const seviye = /(^|[^a-z])(rot|rouge|roja|rosso|red)([^a-z]|$)|alerte rouge|stufe 4|warnstufe 4/.test(t) ? "kirmizi" : "uyari";
  return YEREL_KURAL.filter(([, re]) => re.test(t)).map(([id]) => { const k = KURALLAR.find((x) => x.id === id); return { id, ikon: k.ikon, etiket: k.etiket, oncelik: k.oncelik, seviye }; });
}
async function yerelHaberAl(konum, zorla) {
  const anahtar = `hv_yerel_${konum.ulke}_${String(konum.adEn || konum.ad).toLowerCase()}`;
  const k = okuLS(anahtar);
  if (k && Date.now() - k.t < (zorla ? MIN_ZORLA_MS : TTL_MS)) return k.haberler;
  try {
    const { data } = await supabase.auth.getSession();
    const jeton = data?.session?.access_token;
    if (!jeton) return k?.haberler || [];
    const u = `${HAVASTIL_WORKER_URL}/yerel-haber?ulke=${encodeURIComponent(konum.ulke)}&sehir=${encodeURIComponent(konum.adEn || konum.ad)}`;
    const kontrol = new AbortController(); const z = setTimeout(() => kontrol.abort(), 15000);
    let r; try { r = await fetch(u, { headers: { Authorization: `Bearer ${jeton}` }, signal: kontrol.signal }); } finally { clearTimeout(z); }
    if (!r.ok) return k?.haberler || [];
    const j = await r.json();
    const haberler = (Array.isArray(j.haberler) ? j.haberler : []).map((h) => ({ ...h, yerel: true }));
    try { localStorage.setItem(anahtar, JSON.stringify({ t: Date.now(), haberler })); } catch { /* depo kapalı */ }
    return haberler;
  } catch { return k?.haberler || []; }
}
const okuLS = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };

/** Konumun havuzu: Türkiye'deyse "tr", değilse "dunya". */
export const havuzAnahtari = (konum) => (konum?.ulke === "TR" || (!konum?.ulke && konum && enYakinIl(konum.lat, konum.lon)) ? "tr" : "dunya");

/** Konumdan Türkiye ili (yoksa null). Elle seçim YOK — il her zaman seçili konumdan türetilir. */
export function konumIli(konum) {
  if (!konum) return null;
  if (konum.ulke && konum.ulke !== "TR") return null;
  return ilAdindan(konum.il) || ilAdindan(konum.admin1) || ilAdindan(konum.ad) || enYakinIl(konum.lat, konum.lon);
}

async function havuzAl(anahtar, zorla) {
  const k = okuLS(LS_ON + anahtar);
  const yas = k ? Date.now() - k.t : Infinity;
  if (k && yas < (zorla ? MIN_ZORLA_MS : TTL_MS)) return { ok: true, havuz: k.veri, t: k.t, eski: false };
  if (bekleyen.has(anahtar)) return bekleyen.get(anahtar);
  const p = (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const jeton = data?.session?.access_token;
      if (!jeton) return { ok: false, durum: "oturum_yok" };
      const kontrol = new AbortController();
      const z = setTimeout(() => kontrol.abort(), 20000);
      let r;
      try { r = await fetch(`${HAVASTIL_WORKER_URL}/haberler?havuz=${anahtar}`, { headers: { Authorization: `Bearer ${jeton}` }, signal: kontrol.signal }); } finally { clearTimeout(z); }
      if (r.status === 503) return { ok: false, durum: "worker_kapali" };
      if (r.status === 401 || r.status === 403) return { ok: false, durum: "yetkisiz" };
      if (r.status === 429) return k && Date.now() - k.t < ESKI_KABUL_MS ? { ok: true, havuz: k.veri, t: k.t, eski: true } : { ok: false, durum: "hiz_siniri" };
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const veri = await r.json();
      if (!Array.isArray(veri.haberler)) throw new Error("bozuk");
      const t = Date.now();
      try { localStorage.setItem(LS_ON + anahtar, JSON.stringify({ t, veri })); } catch { /* depo kapalı */ }
      return { ok: true, havuz: veri, t, eski: false };
    } catch {
      return k && Date.now() - k.t < ESKI_KABUL_MS ? { ok: true, havuz: k.veri, t: k.t, eski: true } : { ok: false, durum: "ulasilamadi" };
    }
  })().finally(() => bekleyen.delete(anahtar));
  bekleyen.set(anahtar, p);
  return p;
}

/** Metinde resmî kurum atfı var mı? (MGM, AFAD… AA/TRT üzerinden geldiyse "resmî kaynaklı" sayılır.) */
const KURUMLAR = [
  [/meteoroloji|(^|[^a-z0-9])mgm([^a-z0-9]|$)|met office|national weather service|(^|[^a-z0-9])noaa|bureau of meteorology|environment canada|meteo-?france|(^|[^a-z0-9])dwd|aemet|(^|[^a-z0-9])jma/, "Meteoroloji"],
  [/(^|[^a-z0-9])afad|civil protection|emergency (management|services)|disaster/, "AFAD / afet kurumu"],
  [/valilig|governor/, "Valilik"],
  [/akom|ibb|buyuksehir belediye|belediyesi/, "Belediye"],
  [/karayollari|highway/, "Karayolları"],
];
export function kurumBul(h) {
  if (h.resmi) return h.kaynakAd;                       // Worker (yerel haber) resmî kurum izin listesinden geçirdi
  const t = normalize(`${h.baslik} ${h.ozet || ""}`);
  const k = KURUMLAR.find(([re]) => re.test(t));
  return k ? k[1] : null;
}

const KAPSAM_ONCELIK = { sokak: 0, mahalle: 1, ilce: 2, il: 3, bolge: 4, ulke: 5 };

/**
 * @param {{konum:object, hava?:object, simdi?:Date, zorla?:boolean}} g
 * @returns {Promise<{durum:'ok'|'temiz'|string, uyarilar:Array, uygulananlar:Array, kisitlar:object, guncelleme:number, eski:boolean, havuz:string, teshis:object}>}
 */
export async function haberTaktigi({ konum, hava, simdi = new Date(), zorla = false }) {
  const il = konumIli(konum);
  const anahtar = il ? "tr" : "dunya";
  const a = await havuzAl(anahtar, zorla);
  if (!a.ok) return { durum: a.durum, uyarilar: [], uygulananlar: [], kisitlar: { kurallar: {} }, havuz: anahtar };

  const tz = hava?.tz || "Europe/Istanbul";
  let haberler = a.havuz.haberler;
  if (!il && konum?.ulke) haberler = [...(await yerelHaberAl(konum, zorla)), ...haberler];   // Türkiye dışı: ülke kodu + şehir adıyla dinamik coğrafi tarama
  const { gecenler, elenen } = suz(haberler, { konum, il, simdi, tz });
  const adaylar = [];
  for (const h of gecenler) {
    const kurallar = h.yerel ? [...kurallariCikar(h), ...yerelKurallar(h)].filter((k, i, arr) => arr.findIndex((x) => x.id === k.id) === i) : kurallariCikar(h);
    if (!kurallar.length) continue;
    adaylar.push({ ...h, kurallar, kurum: kurumBul(h) });
  }
  // Çoklu kaynak: aynı kural ≥2 farklı kaynakta geçiyorsa teyit güçlenir
  const kaynakSayac = {};
  for (const x of adaylar) for (const k of x.kurallar) (kaynakSayac[k.id] ||= new Set()).add(x.kaynakAd);

  for (const x of adaylar) {
    x.guvenilirlik = x.kurum ? "resmi" : x.tur === "ajans" ? "ajans" : "genel";
    x.dogrulamalar = x.kurallar.map((k) => ({ id: k.id, ...dogrula(k, hava) }));
    const uyusan = x.dogrulamalar.some((d) => d.durum === "uyusuyor");
    const celisen = x.dogrulamalar.every((d) => d.durum === "celisiyor");
    x.veriDurumu = uyusan ? "uyusuyor" : celisen ? "celisiyor" : "belirsiz";
    x.kaynakSayisi = Math.max(...x.kurallar.map((k) => kaynakSayac[k.id].size));
    // Güven politikası: resmî kurum → uygula (veri farklıysa not düş); ajans → veriyle çelişmiyorsa; genel haber → veriyle uyuşmalı ya da ≥2 kaynak
    x.uygulandi = x.guvenilirlik === "resmi" ? true
      : x.guvenilirlik === "ajans" ? !celisen
      : (uyusan || x.kaynakSayisi >= 2) && !celisen;
    x.kisa = x.kurallar.map((k) => k.etiket).join(" · ");
  }
  adaylar.sort((p, q) => Number(q.uygulandi) - Number(p.uygulandi) || seviyePuani(q.kurallar) - seviyePuani(p.kurallar) || KAPSAM_ONCELIK[p.kapsam] - KAPSAM_ONCELIK[q.kapsam] || new Date(q.yayin) - new Date(p.yayin));
  const uyarilar = adaylar.slice(0, 5);
  const uygulananlar = uyarilar.filter((x) => x.uygulandi);
  return {
    durum: uyarilar.length ? "ok" : "temiz", uyarilar, uygulananlar, kisitlar: kisitlaraCevir(uygulananlar),
    guncelleme: a.t, eski: a.eski, havuz: anahtar,
    teshis: { kaynaklar: a.havuz.kaynaklar || [], havuzBoyutu: a.havuz.haberler.length, elenen, yer: il ? `${il.ad} (${il.bolge})` : `${konum.adEn || konum.ad}, ${konum.ulkeAdEn || konum.ulkeAd || ""}` },
  };
}

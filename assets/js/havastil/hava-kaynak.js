/*
 * hava-kaynak.js — HavaStil · YEREL / RESMÎ İSTASYON KATMANI + YEDEK ZİNCİRİ
 * -----------------------------------------------------------------------------------------------------------------
 * MİMARİ KARARI: Tahmin motoru (CLO, yağış fiziği, 16 günlük saatlik plan) Open-Meteo biçimine dayanır ve DEĞİŞMEZ. Bu dosya onun ÜSTÜNE
 * "önce yerel ve resmî ölçüm" katmanı ekler; katman hiçbir zaman ana akışı bozmaz (her kaynak ayrı zaman aşımı + hata yakalama; sonuç yoksa
 * ekranda Open-Meteo/CAMS model değeri kalır ve "Model tahmini" etiketi gösterilir).
 *
 *   HAVA KALİTESİ   1) OpenAQ resmî istasyon toplayıcısı (dünya geneli; ülkelerin resmî ağlarını birleştirir) — en yakın taze istasyon
 *                   2) Open-Meteo / Copernicus CAMS modeli (anahtarsız, her yerde; veri.js ana akışta zaten çeker)
 *   GÖZLEM (ŞİMDİ)  1) MGM (yalnızca Türkiye; yönetici açarsa) → 2) METAR: en yakın resmî havalimanı istasyonu (dünya geneli, anahtarsız)
 *                   Gözlem, ölçülen değeri gösterir ve modelle karşılaştırır; kombin/yağış motorunun girdisini DEĞİŞTİRMEZ.
 *
 * ANAHTAR SEÇİMİ (OpenAQ)  kullanıcı kendi anahtarını girdiyse yalnızca O kullanıcı için kendi anahtarı (tarayıcıdan doğrudan);
 *                   girmediyse ve yönetici site anahtarını Worker'a eklediyse Worker vekili; hiçbiri yoksa istasyon atlanır, model kalır.
 *   Kendi anahtar → şifreli kasa (ai-kasa.js, sağlayıcı 'openaq'). Site anahtarı → Worker secret OPENAQ_API_KEY (tarayıcıya hiç gelmez).
 * YÖNETİCİ AYARI  Supabase tek satır `hava_kaynak_ayar` (migration 0146): kaynak sırası, açık/kapalı, yarıçap, tazelik. Tablo yoksa varsayılanlarla sessizce çalışır.
 * MİSAFİR/VİTRİN  Oturum yoksa Worker ve anahtar yoktur → katman çalışmaz (yalnızca model).
 */
import { supabase } from "../core/supabase-client.js";
import { HAVASTIL_WORKER_URL } from "./haber.js";
import { omJson } from "./openmeteo.js";
import { KIRLETICILER, KIRLETICI, mikrogramaCevir, mesafeKm, genelDurum, eaqiIndeks } from "./kirletici.js";

const kasaModulu = () => import("./ai-kasa.js");
const OPENAQ = "https://api.openaq.org";
const TERCIH_ANAHTARI = "hv_hk_tercih_v1";
const ZAMAN_ASIMI_MS = 7000;
const MGM_MAKS_KM = 60, METAR_MAKS_KM = 80;

export const SAGLAYICI_ADI = { openaq: "Hava kalitesi istasyonları (OpenAQ)", model: "Tahmin modeli (Open-Meteo · Copernicus CAMS)", mgm: "Meteoroloji Genel Müdürlüğü (MGM)", metar: "Havalimanı resmî hava raporu (METAR)" };

/* ------------------------------ ayar (yönetici) ------------------------------ */
export const HK_VARSAYILAN = Object.freeze({
  gozlem_sira: ["mgm", "metar"], gozlem_acik: { mgm: false, metar: true }, kalite_istasyon_acik: true,
  openaq_site_anahtari_tanimli: false, kendi_anahtar_izni: true, yaricap_km: 25, tazelik_dk: 180, aciklama: null, dogrulama_acik: true, duzeltme_acik: true, duzeltme_saat: 3, migrasyonYok: true,
});
let ayarOnbellek = null, ayarZaman = 0, ayarSoz = null;
export function hkOnbellekSifirla() { ayarOnbellek = null; ayarZaman = 0; kendiDurum = null; }
export async function hkAyar(zorla = false) {
  if (!zorla && ayarOnbellek && Date.now() - ayarZaman < 5 * 60 * 1000) return ayarOnbellek;
  if (ayarSoz) return ayarSoz;
  ayarSoz = (async () => {
    try {
      const { data, error } = await supabase.rpc("hava_kaynak_ayar_oku");
      if (error || !data) throw new Error(error?.message || "ayar yok");
      ayarOnbellek = { ...HK_VARSAYILAN, ...data, gozlem_acik: { ...HK_VARSAYILAN.gozlem_acik, ...(data.gozlem_acik || {}) }, migrasyonYok: false };
    } catch { ayarOnbellek = { ...HK_VARSAYILAN }; }
    ayarZaman = Date.now(); return ayarOnbellek;
  })().finally(() => { ayarSoz = null; });
  return ayarSoz;
}
export async function hkAyarKaydet(a) {
  const { error } = await supabase.rpc("hava_kaynak_ayar_kaydet", { p_ayar: {
    gozlem_sira: a.gozlem_sira, gozlem_acik: a.gozlem_acik, kalite_istasyon_acik: !!a.kalite_istasyon_acik, openaq_site_anahtari_tanimli: !!a.openaq_site_anahtari_tanimli,
    kendi_anahtar_izni: a.kendi_anahtar_izni !== false, yaricap_km: a.yaricap_km, tazelik_dk: a.tazelik_dk, aciklama: a.aciklama || null,
    dogrulama_acik: a.dogrulama_acik !== false, duzeltme_acik: a.duzeltme_acik !== false, duzeltme_saat: a.duzeltme_saat || 3 } });
  if (error) throw new Error(/does not exist|schema cache|42883/i.test(error.message || "") ? "Hava kaynağı ayar tablosu kurulu değil (Supabase: 0146_hava_kaynaklari.sql)." : error.message);
  hkOnbellekSifirla();
}

/* ------------------------------ kullanıcı tercihi + kendi OpenAQ anahtarı ------------------------------ */
export function hkTercihOku() { try { const t = JSON.parse(localStorage.getItem(TERCIH_ANAHTARI) || "null"); return { istasyon: t?.istasyon !== false }; } catch { return { istasyon: true }; } }
export function hkTercihYaz(t) { try { localStorage.setItem(TERCIH_ANAHTARI, JSON.stringify({ istasyon: t.istasyon !== false })); } catch { /* yok say */ } ayarOnbellek = null; }

const oturum = async () => { try { return (await supabase.auth.getSession())?.data?.session || null; } catch { return null; } };
let kendiDurum = null;      // { var, anahtar, kilitli }
export async function kendiOpenaqDurumu(yenile = false) {
  if (kendiDurum && !yenile) return kendiDurum;
  try {
    if (!(await oturum())) return (kendiDurum = { var: false, anahtar: null, kilitli: false });
    const K = await kasaModulu();
    if (!(await K.saglayiciKayitliMi("openaq"))) return (kendiDurum = { var: false, anahtar: null, kilitli: false });
    if (!K.kasaAcikMi()) { try { await K.otomatikAc(); } catch { /* kilitli kalır */ } }
    const a = K.kasaAcikMi() ? K.anahtarAl("openaq") : null;
    return (kendiDurum = { var: true, anahtar: a || null, kilitli: !a });
  } catch { return (kendiDurum = { var: false, anahtar: null, kilitli: false }); }
}
export async function kendiOpenaqKaydet(anahtar) {
  const t = String(anahtar || "").trim();
  if (!/^[A-Za-z0-9_\-]{16,128}$/.test(t)) throw new Error("Anahtar biçimi geçersiz (en az 16 harf/rakam; boşluk olmamalı).");
  const K = await kasaModulu();
  if (!K.kasaAcikMi()) { const ok = await K.otomatikAc().catch(() => false); if (!ok) throw new Error("Anahtar kasası açılamadı. HavaStil › Ayarlar › Yapay zekâ bölümünden kasayı aç, sonra tekrar dene."); }
  await K.anahtarKaydet("openaq", t, null); hkOnbellekSifirla();
}
export async function kendiOpenaqSil() { await (await kasaModulu()).anahtarSil("openaq"); hkOnbellekSifirla(); }


/* ------------------------------ SİTE anahtarı: arayüzden girilir, YALNIZCA Worker'a gider, şifreli saklanır (migration 0147) ------------------------------ */
async function anahtarWorker(govde) {
  const s = await oturum(); if (!s?.access_token) throw new Error("Oturum yok; yeniden giriş yap.");
  let r;
  try { r = await fetch(`${HAVASTIL_WORKER_URL}/hava/anahtar`, { method: "POST", headers: { Authorization: `Bearer ${s.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify(govde), credentials: "omit", referrerPolicy: "no-referrer" }); }
  catch { throw new Error("Worker'a ulaşılamadı; internet bağlantını ve Worker'ın yayında olduğunu kontrol et."); }
  let j = null; try { j = await r.json(); } catch { /* boş */ }
  if (!r.ok) throw new Error(j?.error || `İşlem başarısız (HTTP ${r.status}).`);
  return j || {};
}
/** Yönetici: site OpenAQ anahtarı kayıtlı mı? { var, son4, guncelleme } — anahtarın kendisi ASLA dönmez. */
export async function siteAnahtarDurumu() {
  try {
    const { data, error } = await supabase.rpc("hava_site_anahtar_durum");
    if (error) throw error;
    const k = (Array.isArray(data) ? data : []).find((x) => x.saglayici === "openaq");
    return k ? { var: true, son4: k.son4 || "", guncelleme: k.guncelleme } : { var: false };
  } catch (h) { return { var: false, hata: /does not exist|schema cache|42883|PGRST202/i.test(String(h?.message || h)) ? "Supabase'de 0147_hava_site_anahtari_ve_dogrulama.sql henüz çalıştırılmamış." : String(h?.message || h) }; }
}
export async function siteAnahtarKaydet(anahtar) {
  const t = String(anahtar || "").trim();
  if (!/^[A-Za-z0-9_\-]{16,128}$/.test(t)) throw new Error("Anahtar biçimi geçersiz: 16–128 harf/rakam olmalı, boşluk içermemeli.");
  const j = await anahtarWorker({ saglayici: "openaq", anahtar: t }); hkOnbellekSifirla(); return j;
}
export async function siteAnahtarSil() { const j = await anahtarWorker({ saglayici: "openaq", sil: true }); hkOnbellekSifirla(); return j; }

/** Kimin anahtarı kullanılacak: kendi (yalnızca bu kullanıcı) > site (Worker) > yok. */
async function openaqKimlik(ayar) {
  if (ayar.kendi_anahtar_izni !== false) { const k = await kendiOpenaqDurumu(); if (k.anahtar) return { tur: "kendi", anahtar: k.anahtar }; }
  if (ayar.openaq_site_anahtari_tanimli) return { tur: "site" };
  return null;
}

/* ------------------------------ ağ yardımcıları ------------------------------ */
const sureli = (soz, ms, ad) => Promise.race([soz, new Promise((_, r) => setTimeout(() => r(new Error(`${ad}: zaman aşımı`)), ms))]);
async function ilet(url, { baslik = {}, sinyal = null } = {}) {
  const k = new AbortController(), z = setTimeout(() => k.abort(), ZAMAN_ASIMI_MS);
  if (sinyal) { if (sinyal.aborted) k.abort(); else sinyal.addEventListener("abort", () => k.abort(), { once: true }); }
  try {
    const r = await fetch(url, { signal: k.signal, headers: { Accept: "application/json", ...baslik }, credentials: "omit", referrerPolicy: "no-referrer" });
    if (r.status === 401 || r.status === 403) { const e = new Error(r.status === 401 ? "anahtar/oturum reddedildi (401)" : "erişim reddedildi (403)"); e.durum = r.status; throw e; }
    if (r.status === 429) { const e = new Error("istek sınırı (429)"); e.durum = 429; throw e; }
    if (r.status === 501) { const e = new Error("site anahtarı Worker'da tanımlı değil (501)"); e.durum = 501; throw e; }
    if (!r.ok) { const e = new Error(`HTTP ${r.status}`); e.durum = r.status; throw e; }
    return await r.json();
  } finally { clearTimeout(z); }
}
async function workerGet(yol, params, sinyal) {
  const s = await oturum();
  if (!s?.access_token) throw new Error("oturum yok");
  return ilet(`${HAVASTIL_WORKER_URL}${yol}?${new URLSearchParams(params)}`, { baslik: { Authorization: `Bearer ${s.access_token}` }, sinyal });
}
async function openaqGet(yol, sorgu, kimlik, sinyal) {
  const q = new URLSearchParams(sorgu).toString();
  if (kimlik.tur === "kendi") return ilet(`${OPENAQ}${yol}?${q}`, { baslik: { "X-API-Key": kimlik.anahtar }, sinyal });
  return workerGet("/hava/openaq", { u: `${OPENAQ}${yol}?${q}` }, sinyal);
}

/* ------------------------------ OpenAQ: en yakın taze resmî istasyonlar ------------------------------ */
export async function openaqIstasyonlari(lat, lon, kimlik, { yaricapKm = 25, tazelikDk = 180, sinyal = null } = {}) {
  const L = await openaqGet("/v3/locations", { coordinates: `${lat},${lon}`, radius: Math.min(25000, Math.round(yaricapKm * 1000)), limit: 12 }, kimlik, sinyal);
  const simdi = Date.now(), taze = (iso) => iso && simdi - Date.parse(iso) <= tazelikDk * 60000 && Date.parse(iso) - simdi < 3600000;
  const adaylar = (L.results || []).filter((x) => taze(x.datetimeLast?.utc))
    .map((x) => ({ x, km: mesafeKm(lat, lon, x.coordinates?.latitude, x.coordinates?.longitude) })).filter((a) => Number.isFinite(a.km))
    .sort((a, b) => a.km - b.km).slice(0, 3);
  const sonuc = await Promise.all(adaylar.map(async ({ x, km }) => {
    try {
      const j = await openaqGet(`/v3/locations/${x.id}/latest`, { limit: 50 }, kimlik, sinyal);
      return istasyonOzetle(x, km, j.results || [], tazelikDk);
    } catch (h) { if (h.durum === 401 || h.durum === 403 || h.durum === 429) throw h; return null; }
  }));
  return sonuc.filter((s) => s && Object.keys(s.degerler).length);
}
/** Saf: bir OpenAQ konumu + latest sonuçları → {ad, mesafeKm, zaman, kurum, degerler:{pm25…}} (µg/m³). */
export function istasyonOzetle(konumKaydi, km, latest, tazelikDk = 180) {
  const sensor = new Map((konumKaydi.sensors || []).map((s) => [s.id, s.parameter || {}]));
  const degerler = {}; let zaman = null;
  for (const o of latest) {
    const p = sensor.get(o.sensorsId); if (!p) continue;
    const id = String(p.name || "").toLowerCase().replace(".", ""), kimlikAdi = id === "pm2.5" ? "pm25" : id;
    if (!KIRLETICI[kimlikAdi] || kimlikAdi === "dust") continue;
    const t = o.datetime?.utc; if (!t || Date.now() - Date.parse(t) > tazelikDk * 60000) continue;
    const v = mikrogramaCevir(kimlikAdi, Number(o.value), p.units);
    if (!Number.isFinite(v) || v < 0) continue;
    degerler[kimlikAdi] = Math.round(v * 10) / 10;
    if (!zaman || Date.parse(t) > Date.parse(zaman)) zaman = t;
  }
  return { saglayici: "openaq", ad: konumKaydi.name || `İstasyon ${konumKaydi.id}`, resmiUrl: konumKaydi.id != null ? `https://explore.openaq.org/locations/${encodeURIComponent(konumKaydi.id)}` : null, mesafeKm: Math.round(km * 10) / 10, zaman, kurum: konumKaydi.provider?.name || konumKaydi.owner?.name || null, degerler };
}


/* ------------------------------ havalimanı adları ------------------------------ */
/** ICAO kodu → Türkçe resmî ad (Türkiye). Bilinmeyenler hamAdlandir() ile temizlenir. */
export const HAVALIMANI_AD = {
  LTFM: "İstanbul Havalimanı", LTFJ: "İstanbul Sabiha Gökçen Havalimanı", LTBA: "İstanbul Atatürk Havalimanı", LTBU: "Tekirdağ Çorlu Havalimanı",
  LTAC: "Ankara Esenboğa Havalimanı", LTAD: "Ankara Etimesgut Havalimanı", LTAI: "Antalya Havalimanı", LTFG: "Antalya Gazipaşa-Alanya Havalimanı",
  LTFE: "Muğla Milas-Bodrum Havalimanı", LTBS: "Muğla Dalaman Havalimanı", LTBJ: "İzmir Adnan Menderes Havalimanı", LTBL: "İzmir Çiğli Havalimanı",
  LTAF: "Adana Şakirpaşa Havalimanı", LTDA: "Hatay Havalimanı", LTAJ: "Gaziantep Oğuzeli Havalimanı", LTAN: "Konya Havalimanı", LTAU: "Kayseri Erkilet Havalimanı",
  LTAZ: "Nevşehir Kapadokya Havalimanı", LTAR: "Sivas Nuri Demirağ Havalimanı", LTAT: "Malatya Erhaç Havalimanı", LTCC: "Diyarbakır Havalimanı",
  LTCE: "Erzurum Havalimanı", LTCG: "Trabzon Havalimanı", LTCF: "Kars Harakani Havalimanı", LTCI: "Van Ferit Melen Havalimanı", LTCJ: "Batman Havalimanı",
  LTCR: "Mardin Havalimanı", LTCK: "Muş Havalimanı", LTCL: "Siirt Havalimanı", LTCM: "Sinop Havalimanı", LTCN: "Kahramanmaraş Havalimanı", LTCO: "Ağrı Ahmed-i Hani Havalimanı",
  LTCP: "Adıyaman Havalimanı", LTCS: "Şanlıurfa GAP Havalimanı", LTCD: "Erzincan Havalimanı", LTFC: "Isparta Süleyman Demirel Havalimanı", LTFD: "Balıkesir Edremit Körfez Havalimanı",
  LTBH: "Çanakkale Havalimanı", LTBD: "Aydın Çıldır Havalimanı", LTBR: "Bursa Yenişehir Havalimanı", LTBI: "Eskişehir Anadolu Havalimanı", LTBF: "Balıkesir Merkez Havalimanı",
  LTBG: "Bandırma Havalimanı", LTBO: "Uşak Havalimanı", LTBZ: "Kütahya Zafer Havalimanı", LTAS: "Zonguldak Çaycuma Havalimanı", LTAL: "Kastamonu Havalimanı",
  LTAP: "Amasya Merzifon Havalimanı", LTFH: "Samsun Çarşamba Havalimanı", LTFK: "Çanakkale Gökçeada Havalimanı", LTFO: "Rize-Artvin Havalimanı", LTAH: "Afyonkarahisar Havalimanı",
};
/** Ham METAR adını ("Istanbul Sabiha Gokcen Intl, TR") okunur hâle getirir: ülke eki atılır, Intl/Arpt Türkçeleşir. */
export function hamAdlandir(ham) {
  let a = String(ham || "").split(",")[0].replace(/\b(Intl|International)\b/gi, "Uluslararası").replace(/\b(Arpt|Airport|Apt)\b/gi, "Havalimanı").replace(/\bAFB\b/gi, "Hava Üssü").replace(/\s+/g, " ").trim();
  if (a && !/havalimanı|hava üssü/i.test(a)) a += " Havalimanı";
  return a.slice(0, 70);
}
export const havalimaniAdi = (icao, ham) => HAVALIMANI_AD[String(icao || "").toUpperCase()] || hamAdlandir(ham) || String(icao || "Havalimanı");

/* ------------------------------ METAR (havalimanı resmî rasatı) ------------------------------ */
const sayiMi = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);
const nemHesapla = (t, td) => (t == null || td == null ? null : Math.max(1, Math.min(100, Math.round(100 * Math.exp((17.625 * td) / (243.04 + td)) / Math.exp((17.625 * t) / (243.04 + t))))));
/** Saf: aviationweather.gov METAR JSON dizisi → en yakın taze istasyon gözlemi (birimler: °C, km/s, hPa, m). */
export function metarOzetle(liste, lat, lon, { maksKm = METAR_MAKS_KM, tazelikDk = 180 } = {}) {
  const simdi = Date.now();
  const adaylar = (Array.isArray(liste) ? liste : []).map((m) => ({ m, km: mesafeKm(lat, lon, Number(m.lat), Number(m.lon)), t: Number(m.obsTime) * 1000 }))
    .filter((a) => Number.isFinite(a.km) && a.km <= maksKm && sayiMi(a.m.temp) != null && Number.isFinite(a.t) && simdi - a.t <= tazelikDk * 60000)
    .sort((a, b) => a.km - b.km || b.t - a.t);
  const en = adaylar[0]; if (!en) return null;
  const m = en.m, sicaklik = sayiMi(m.temp), cig = sayiMi(m.dewp);
  const kt = (x) => (sayiMi(x) == null ? null : Math.round(x * 1.852));
  let basinc = sayiMi(m.slp) ?? sayiMi(m.altim); if (basinc != null && basinc < 50) basinc = basinc * 33.8639;      // inHg → hPa
  let gorus = null; if (m.visib != null) { const v = parseFloat(String(m.visib).replace("+", "")); if (Number.isFinite(v)) gorus = Math.round(v * 1609.34); }
  return { saglayici: "metar", ad: havalimaniAdi(m.icaoId, m.name), kod: m.icaoId || null, resmiUrl: m.icaoId ? `https://aviationweather.gov/data/metar/?ids=${encodeURIComponent(m.icaoId)}&hours=3` : null, mesafeKm: Math.round(en.km * 10) / 10, zaman: new Date(en.t).toISOString(),
    sicaklik, cig, nem: nemHesapla(sicaklik, cig), ruzgar: kt(m.wspd), yon: sayiMi(m.wdir), hamle: kt(m.wgst), basinc: basinc == null ? null : Math.round(basinc * 10) / 10, gorus };
}
async function metarCek(lat, lon, tazelikDk, sinyal) {
  const bbox = `${(lat - 0.9).toFixed(3)},${(lon - 1.3).toFixed(3)},${(lat + 0.9).toFixed(3)},${(lon + 1.3).toFixed(3)}`;
  const j = await workerGet("/hava/metar", { bbox }, sinyal);
  const o = metarOzetle(j, lat, lon, { tazelikDk });
  if (!o) throw new Error(`${METAR_MAKS_KM} km içinde taze havalimanı rasatı yok`);
  return o;
}

/* ------------------------------ MGM (yalnızca Türkiye; resmî ama belgelenmemiş uç nokta) ------------------------------ */
const mgmSayi = (x) => (typeof x === "number" && Number.isFinite(x) && x > -9000 ? x : null);
const mgmKonum = (m) => ({ lat: Number(m?.enlem ?? m?.lat ?? m?.latitude), lon: Number(m?.boylam ?? m?.lon ?? m?.longitude) });
const mgmAd = (m) => [m?.ilce, m?.il].filter((x, i, a) => x && a.indexOf(x) === i).join(", ") || "MGM istasyonu";
/** MGM'nin KENDİ sitesindeki ilgili il/ilçe sayfası: aynı canlı gözlemi orada görüp kıyaslayabilmen için (yeni sekmede açılır). */
export function mgmResmiUrl(m) {
  const il = String(m?.il || "").trim(), ilce = String(m?.ilce || "").trim();
  if (!il) return "https://www.mgm.gov.tr/tahmin/il-ve-ilceler.aspx";
  return `https://www.mgm.gov.tr/tahmin/il-ve-ilceler.aspx?il=${encodeURIComponent(il)}${ilce && ilce.toLocaleLowerCase("tr") !== il.toLocaleLowerCase("tr") ? `&ilce=${encodeURIComponent(ilce)}` : ""}`;
}
/** Gözlem/istasyon kaydı → resmî kaynağa doğrulama bağlantısı { url, yazi, kurum } ya da null. */
export function resmiBaglanti(g) {
  if (!g || !g.saglayici) return null;
  if (g.saglayici === "mgm") return { url: g.resmiUrl || mgmResmiUrl({ il: g.il, ilce: g.ilce }), yazi: "MGM'nin resmî sitesinde doğrula", kurum: "Meteoroloji Genel Müdürlüğü (mgm.gov.tr)" };
  if (g.saglayici === "metar") return g.kod ? { url: g.resmiUrl || `https://aviationweather.gov/data/metar/?ids=${encodeURIComponent(g.kod)}&hours=3`, yazi: "Resmî havalimanı raporunu aç", kurum: "ABD Ulusal Hava Servisi · Aviation Weather Center (aviationweather.gov)" } : null;
  if (g.saglayici === "openaq") return g.resmiUrl ? { url: g.resmiUrl, yazi: "İstasyonu OpenAQ'da aç", kurum: "OpenAQ (openaq.org)" } : null;
  return null;
}

/** Saf: MGM merkez kaydı + son durum satırı → gözlem. -9999 = ölçüm yok. */
export function mgmOzetle(merkez, satir, lat, lon) {
  if (!satir) return null;
  const k = mgmKonum(merkez), km = mesafeKm(lat, lon, k.lat, k.lon);
  const zaman = satir.veriZamani ? new Date(satir.veriZamani).toISOString() : null;
  if (!zaman || mgmSayi(satir.sicaklik) == null) return null;
  const basinc = mgmSayi(satir.denizeIndirgenmisBasinc) ?? mgmSayi(satir.aktuelBasinc);
  return { saglayici: "mgm", ad: mgmAd(merkez), il: merkez?.il || null, ilce: merkez?.ilce || null, resmiUrl: mgmResmiUrl(merkez), mesafeKm: Number.isFinite(km) ? Math.round(km * 10) / 10 : null, zaman, istNo: satir.istNo ?? merkez?.sondurumIstNo ?? null,
    sicaklik: mgmSayi(satir.sicaklik), hissedilen: mgmSayi(satir.hissedilenSicaklik), nem: mgmSayi(satir.nem), cig: null, ruzgar: mgmSayi(satir.ruzgarHiz) == null ? null : Math.round(satir.ruzgarHiz),
    yon: mgmSayi(satir.ruzgarYon), hamle: null, basinc, gorus: mgmSayi(satir.gorus), yagis: mgmSayi(satir.yagis00Now) };
}
const dizi = (x) => (Array.isArray(x) ? x : x && typeof x === "object" ? [x] : []);
/**
 * Saf: konuma EN YAKIN MGM merkezlerini seçer. Önce ad eşleşmesi (ilçe adı), ama yalnızca merkezin KENDİ koordinatı konuma ≤ 15 km ise güvenilir sayılır;
 * aksi halde ilin tüm merkezleri arasından koordinata göre en yakın üç tanesi. (Eski sürüm ilçe bulunamayınca il merkezini — İstanbul için Bakırköy —
 * alıyordu: Ataşehir'deki kullanıcıya 22 km uzaktaki istasyon gösteriliyordu.)
 */
export function mgmMerkezSec(adAdaylari, hepsi, lat, lon, adKayitlari = []) {
  const uzak = (m) => { const k = mgmKonum(m); return mesafeKm(lat, lon, k.lat, k.lon); };
  const gecerli = (m) => m && Number.isFinite(uzak(m));
  const adli = adKayitlari.filter(gecerli).filter((m) => uzak(m) <= 15).sort((a, b) => uzak(a) - uzak(b));
  const tum = dizi(hepsi).filter(gecerli).sort((a, b) => uzak(a) - uzak(b));
  const sonuc = [], gor = new Set();
  for (const m of [...adli, ...tum]) { const k = `${m.merkezId ?? ""}|${m.sondurumIstNo ?? ""}|${m.ilce ?? ""}`; if (gor.has(k)) continue; gor.add(k); sonuc.push(m); if (sonuc.length >= 3) break; }
  void adAdaylari;
  return sonuc;
}
async function mgmCek(konum, tazelikDk, sinyal) {
  const il = konum.il || konum.admin1 || "";
  if (!il) throw new Error("il adı yok");
  const adlar = [...new Set([konum.ilce, konum.admin2, konum.ad].map((x) => String(x || "").trim()).filter((x) => x && x !== il))].slice(0, 2);
  const [tum, ...adli] = await Promise.all([
    workerGet("/hava/mgm", { yol: "ililcesi", il }, sinyal).catch(() => null),
    ...adlar.map((ad) => workerGet("/hava/mgm", { yol: "merkezler", il, ilce: ad }, sinyal).then(dizi).catch(() => [])),
  ]);
  const adayMerkezler = mgmMerkezSec(adlar, tum, konum.lat, konum.lon, adli.flat());
  if (!adayMerkezler.length) throw new Error("MGM merkez kaydı bulunamadı");
  let enIyi = null, sonHata = null;
  for (const merkez of adayMerkezler) {                                    // en yakından başla; ölçümü taze ve geçerli ilk merkez kazanır
    const no = merkez.sondurumIstNo ?? merkez.merkezId;
    if (no == null) continue;
    try {
      const durum = await workerGet("/hava/mgm", { yol: "sondurumlar", ...(merkez.sondurumIstNo != null ? { istno: String(no) } : { merkezid: String(no) }) }, sinyal);
      const o = mgmOzetle(merkez, dizi(durum)[0], konum.lat, konum.lon);
      if (!o) { sonHata = new Error("MGM son durum verisi boş"); continue; }
      if (o.mesafeKm != null && o.mesafeKm > MGM_MAKS_KM) { sonHata = new Error(`MGM istasyonu ${o.mesafeKm} km uzakta`); continue; }
      if (Date.now() - Date.parse(o.zaman) > tazelikDk * 60000) { sonHata = new Error("MGM verisi eski"); continue; }
      enIyi = o; break;
    } catch (h) { sonHata = h; }
  }
  if (!enIyi) throw sonHata || new Error("MGM verisi alınamadı");
  return enIyi;
}

/* ------------------------------ birleştirme (saf) ------------------------------ */
const MODEL_ALAN = { pm25: "pm25", pm10: "pm10", o3: "ozon", no2: "no2", so2: "so2", co: "co", dust: "dust" };
/**
 * Model (CAMS) hava kalitesi + en yakın taze istasyonlar → tek nesne. Her kirletici için istasyon değeri VARSA o kullanılır (kaynak: "istasyon"),
 * yoksa model (kaynak: "model"). genelIdx: istasyon varsa en kötü kirleticinin EAQI bandı; yalnızca model ise Open-Meteo Avrupa AQI bandı.
 */
export function kaliteBirlestir(kalite, istasyonlar = []) {
  const degerler = {}, kaynaklar = {};
  for (const k of KIRLETICILER) {
    const ist = istasyonlar.find((s) => Number.isFinite(s.degerler?.[k.id]));
    if (ist) { degerler[k.id] = ist.degerler[k.id]; kaynaklar[k.id] = { tur: "istasyon", ad: ist.ad, mesafeKm: ist.mesafeKm, zaman: ist.zaman, alinma: ist.alinma || null, saglayici: ist.saglayici, kurum: ist.kurum || null, resmiUrl: ist.resmiUrl || null }; continue; }
    const m = kalite?.[MODEL_ALAN[k.id]];
    if (Number.isFinite(m)) { degerler[k.id] = m; kaynaklar[k.id] = { tur: "model" }; }
  }
  if (!Object.keys(degerler).length) return kalite || null;
  const istasyonVar = Object.values(kaynaklar).some((x) => x.tur === "istasyon");
  const g = istasyonVar || !Number.isFinite(kalite?.aqi) ? genelDurum(degerler) : null;
  const idx = g ? g.idx : eaqiIndeks(kalite.aqi);
  return { ...(kalite || {}), degerler, kaynaklar, genelIdx: idx, baskin: g?.baskin ?? genelDurum(degerler)?.baskin ?? null, genelKaynak: istasyonVar ? "istasyon" : "model",
    istasyonlar: istasyonlar.map((s) => ({ ad: s.ad, mesafeKm: s.mesafeKm, zaman: s.zaman, alinma: s.alinma || null, kurum: s.kurum || null, saglayici: s.saglayici, resmiUrl: s.resmiUrl || null })) };
}

/* ------------------------------ ANA GİRİŞ ------------------------------ */
/**
 * Konum için resmî istasyon verilerini toplar. Asla fırlatmaz. Dönen: { istasyonlar, gozlem, teshis } ya da (oturum yok / kapalı) null.
 * teshis: [{ kaynak, ok, ms, not }] — Ayarlar › Teşhis ve yönetici testi için.
 */
export async function istasyonKatmani(konum, { sinyal = null, sadece = null } = {}) {
  try {
    if (!hkTercihOku().istasyon || !(await oturum())) return null;
    const ayar = await hkAyar(), teshis = [];
    // teshis.not: hata ya da (başarıda) sonucun ne olduğu ("2 istasyon", "ölçüm alındı"); alinma: bu kaynağın çekildiği an (ms).
    const olc = async (kaynak, is) => {
      const t0 = performance.now();
      try {
        const v = await sureli(is(), ZAMAN_ASIMI_MS + 1500, SAGLAYICI_ADI[kaynak]);
        const not = Array.isArray(v) ? (v.length ? `${v.length} istasyon` : "yakında taze ölçüm yapan istasyon yok") : v ? "ölçüm alındı" : "";
        teshis.push({ kaynak, ok: true, ms: Math.round(performance.now() - t0), not, alinma: Date.now() }); return v;
      } catch (h) { teshis.push({ kaynak, ok: false, ms: Math.round(performance.now() - t0), not: String(h?.message || h), alinma: Date.now() }); return null; }
    };
    const aq = async () => {
      if (sadece === "gozlem") return undefined;                                    // yalnızca gözlem yenileniyor: istasyonlara dokunma
      if (!ayar.kalite_istasyon_acik) { teshis.push({ kaynak: "openaq", ok: false, ms: 0, not: "yönetici bu kaynağı kapattı", alinma: null, kapali: true }); return []; }
      const kimlik = await openaqKimlik(ayar);
      if (!kimlik) { teshis.push({ kaynak: "openaq", ok: false, ms: 0, not: "anahtar yok (kendi ya da site anahtarı gerekir)", alinma: null, anahtarYok: true }); return []; }
      const l = (await olc("openaq", () => openaqIstasyonlari(konum.lat, konum.lon, kimlik, { yaricapKm: ayar.yaricap_km, tazelikDk: ayar.tazelik_dk, sinyal }))) || [];
      const t = Date.now(); for (const x of l) x.alinma = t;
      return l;
    };
    const gz = async () => {
      if (sadece === "aq") return undefined;
      let denendi = false;
      for (const id of ayar.gozlem_sira || []) {
        if (!ayar.gozlem_acik?.[id]) { teshis.push({ kaynak: id, ok: false, ms: 0, not: "yönetici bu kaynağı kapattı", alinma: null, kapali: true }); continue; }
        if (id === "mgm" && String(konum.ulke || "").toUpperCase() !== "TR") { teshis.push({ kaynak: id, ok: false, ms: 0, not: "yalnızca Türkiye konumlarında", alinma: null, atlandi: true }); continue; }
        denendi = true;
        const o = await olc(id, () => (id === "mgm" ? mgmCek(konum, ayar.tazelik_dk, sinyal) : metarCek(konum.lat, konum.lon, ayar.tazelik_dk, sinyal)));
        if (o) { o.alinma = Date.now(); return o; }
      }
      void denendi; return null;
    };
    const [istasyonlar, gozlem] = await Promise.all([aq(), gz()]);
    return { istasyonlar, gozlem, teshis, ayar, alinma: Date.now() };
  } catch { return null; }
}

/* ------------------------------ yönetici/kullanıcı testi (ayar kapalı olsa bile her kaynağı dener) ------------------------------ */
/** ids: yalnızca bu kaynak kimlikleri sınanır (örn. ["mgm"]) → "tek sınama = en az Worker isteği". Verilmezse hepsi. */
export async function kaynakTesti(konum, ids = null) {
  const ayar = await hkAyar(true), satirlar = [];
  const dene = async (id, ad, is) => {
    if (ids && !ids.includes(id)) return;
    const t0 = performance.now();
    try { const ayrinti = await sureli(is(), ZAMAN_ASIMI_MS + 1500, ad); satirlar.push({ id, ad, durum: "ok", ms: Math.round(performance.now() - t0), ayrinti }); }
    catch (h) { satirlar.push({ id, ad, durum: h.atla ? "atlandi" : "hata", ms: Math.round(performance.now() - t0), ayrinti: String(h?.message || h) }); }
  };
  const atla = (m) => { const e = new Error(m); e.atla = true; throw e; };
  const gozMetni = (o) => `${o.ad}${o.mesafeKm != null ? ` · ${o.mesafeKm} km` : ""} · sıcaklık ${o.sicaklik}°, nem ${o.nem != null ? `%${o.nem}` : "—"}, rüzgâr ${o.ruzgar ?? "—"} km/s, basınç ${o.basinc ?? "—"} hPa · ${new Date(o.zaman).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })} (resmî sayfayla karşılaştır)`;
  await Promise.all([
    dene("model", SAGLAYICI_ADI.model, async () => {
      const j = await omJson(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${konum.lat}&longitude=${konum.lon}&timezone=auto&current=european_aqi,pm2_5`);
      if (!j?.current) throw new Error("yanıt boş"); return `Avrupa AQI ${j.current.european_aqi ?? "—"} · sorunsuz`;
    }),
    dene("openaq", SAGLAYICI_ADI.openaq, async () => {
      const kimlik = await openaqKimlik(ayar); if (!kimlik) atla("Anahtar yok: kendi anahtarını gir ya da yönetici site anahtarını Worker'a eklesin.");
      const l = await openaqIstasyonlari(konum.lat, konum.lon, kimlik, { yaricapKm: ayar.yaricap_km, tazelikDk: 24 * 60 });
      if (!l.length) throw new Error(`${ayar.yaricap_km} km içinde son 24 saatte ölçüm yapan istasyon yok (bu bölgede model kullanılır)`);
      return `${kimlik.tur === "kendi" ? "kendi anahtar" : "site anahtarı"} · ${l[0].ad} (${l[0].mesafeKm} km) · ${Object.keys(l[0].degerler).length} kirletici`;
    }),
    dene("metar", SAGLAYICI_ADI.metar, async () => { if (!(await oturum())) atla("Oturum gerekli."); return gozMetni(await metarCek(konum.lat, konum.lon, 24 * 60)); }),
    dene("mgm", SAGLAYICI_ADI.mgm, async () => { if (String(konum.ulke || "").toUpperCase() !== "TR") atla("Yalnızca Türkiye konumlarında denenir; konumu Türkiye'den seç."); return gozMetni(await mgmCek(konum, 24 * 60)); }),
  ]);
  const sira = ["mgm", "metar", "openaq", "model"];
  return satirlar.sort((a, b) => sira.indexOf(a.id) - sira.indexOf(b.id));
}

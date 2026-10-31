/*
 * openmeteo.js — HavaStil · OPEN-METEO ERİŞİM KATMANI (kota + API anahtarı kaynağı)
 * -----------------------------------------------------------------------------------------------------------------
 * HavaStil'in TÜM Open-Meteo istekleri (radar ızgarası, ana tahmin, arşiv, hava kalitesi…) buradan geçer (veri.js › jsonAl bunu çağırır).
 *
 * KAYNAK SEÇİMİ (istek başına)
 *   'kendi'      kullanıcı kendi Open-Meteo anahtarını girdiyse (şifreli kasa) ve tercihi "kendi anahtarım" ise → customer-* alan adı, anahtar URL'de.
 *                Site kotasına SAYILMAZ (yalnızca bilgi için kaydedilir). Site sahibi ve yöneticiler de aynı yolla KENDİ anahtarlarını kullanabilir.
 *   'site'       yönetici planı "ticari" yapıp Worker'a OPEN_METEO_API_KEY eklediyse → istek Worker vekilinden geçer (anahtar tarayıcıya hiç gelmez).
 *   'varsayilan' ücretsiz Open-Meteo, tarayıcıdan doğrudan (kullanıcının KENDİ IP'si; Open-Meteo ücretsiz kotası IP başınadır).
 *
 * KOTA: her istek "ağırlık" kadar çağrı sayılır (konum × ceil(değişken/10) × ceil(gün/14) — Open-Meteo'nun kendi sayma kuralı). Oturum açıksa
 *   openmeteo_kota_al() RPC'si ağırlığı AYIRIR (kişi başına + IP başına/site sınırı) ve izin yoksa istek hiç yapılmaz. Misafir/demo: yalnızca yerel sayaç.
 *   Migration 0121 henüz çalışmadıysa sistem sessizce kotasız (eski davranış) devam eder; istek asla bu yüzden bozulmaz.
 */
import { supabase } from "../core/supabase-client.js";
import { HAVASTIL_WORKER_URL } from "./haber.js";
// Kasa (şifreleme + notlar/kasa.js) YALNIZCA kullanıcı kendi anahtarını kullanırken/yönetirken yüklenir (misafir/demo açılışı ağırlaşmasın).
const kasaModulu = () => import("./ai-kasa.js");

const OM_HOST = /^(api|archive-api|air-quality-api|climate-api)\.open-meteo\.com$/;
const MUSTERI_HOST = { "api.open-meteo.com": "customer-api.open-meteo.com", "archive-api.open-meteo.com": "customer-archive-api.open-meteo.com", "air-quality-api.open-meteo.com": "customer-air-quality-api.open-meteo.com", "climate-api.open-meteo.com": "customer-climate-api.open-meteo.com" };
const TERCIH_ANAHTARI = "hv_om_tercih_v1", MISAFIR_ANAHTARI = "hv_om_misafir_v1", IP_ANAHTARI = "hv_om_ip_v1";
const VARSAYILAN_AYAR = Object.freeze({
  plan: "ucretsiz", ucretsiz_limit: { dakika: 600, saat: 5000, gun: 10000, ay: 300000 }, ticari_limit: { dakika: null, saat: null, gun: null, ay: 1000000 },
  kullanici_limit: { dakika: 200, saat: 1500, gun: 4000, ay: 60000 }, kendi_anahtar_izni: true, site_anahtari_tanimli: false, aktif_kaynak: "varsayilan", migrasyonYok: true,
});
export const PENCERE_ADI = { dakika: "dakika", saat: "saat", gun: "gün", ay: "ay" };

export const omOmMi = (url) => { try { return OM_HOST.test(new URL(url).hostname); } catch { return false; } };

/** Open-Meteo'nun çağrı sayma kuralına uygun ağırlık (Worker'daki omAgirlik ile aynı). */
export function omAgirlik(url) {
  const u = new URL(url), p = u.searchParams, say = (a) => (p.get(a) || "").split(",").filter(Boolean).length;
  const konum = Math.max(1, say("latitude")), degisken = say("hourly") + say("daily") + say("current") + say("minutely_15");
  let gun = 7;
  if (p.get("start_date") && p.get("end_date")) gun = Math.max(1, Math.round((Date.parse(p.get("end_date")) - Date.parse(p.get("start_date"))) / 86400000) + 1);
  else gun = (Number(p.get("forecast_days")) || 7) + (Number(p.get("past_days")) || 0);
  return Math.max(1, konum * Math.max(1, Math.ceil(degisken / 10)) * Math.max(1, Math.ceil(gun / 14)));
}

/* ------------------------------ tercih (yerel) ------------------------------ */
export function omTercihOku() { try { const t = JSON.parse(localStorage.getItem(TERCIH_ANAHTARI) || "null"); return { kaynak: t?.kaynak === "kendi" ? "kendi" : "otomatik" }; } catch { return { kaynak: "otomatik" }; } }
export function omTercihYaz(kaynak) { try { localStorage.setItem(TERCIH_ANAHTARI, JSON.stringify({ kaynak: kaynak === "kendi" ? "kendi" : "otomatik" })); } catch { /* yok say */ } omOnbellekSifirla(); }

/* ------------------------------ ayar (5 dk önbellek) ------------------------------ */
let ayarOnbellek = null, ayarZaman = 0, ayarSoz = null;
export function omOnbellekSifirla() { ayarOnbellek = null; ayarZaman = 0; kendiDurum = null; }
export async function omAyar(zorla = false) {
  if (!zorla && ayarOnbellek && Date.now() - ayarZaman < 5 * 60 * 1000) return ayarOnbellek;
  if (ayarSoz) return ayarSoz;
  ayarSoz = (async () => {
    try {
      const { data, error } = await supabase.rpc("openmeteo_ayar_oku");
      if (error || !data) throw new Error(error?.message || "ayar yok");
      ayarOnbellek = { ...data, migrasyonYok: false };
    } catch { ayarOnbellek = { ...VARSAYILAN_AYAR }; }
    ayarZaman = Date.now(); return ayarOnbellek;
  })().finally(() => { ayarSoz = null; });
  return ayarSoz;
}

/* ------------------------------ IP özeti (Worker; ham IP yok) ------------------------------ */
let ipSoz = null;
export function ipOzeti() {
  try { const s = sessionStorage.getItem(IP_ANAHTARI); if (s) return Promise.resolve(s); } catch { /* yok say */ }
  if (ipSoz) return ipSoz;
  ipSoz = (async () => {
    try {
      const k = new AbortController(), z = setTimeout(() => k.abort(), 3500);
      const r = await fetch(`${HAVASTIL_WORKER_URL}/istemci`, { signal: k.signal, credentials: "omit", referrerPolicy: "no-referrer" }); clearTimeout(z);
      const j = r.ok ? await r.json() : null; const h = /^[0-9a-f]{8,64}$/.test(j?.ip_hash || "") ? j.ip_hash : "bilinmiyor";
      if (h !== "bilinmiyor") { try { sessionStorage.setItem(IP_ANAHTARI, h); } catch { /* yok say */ } }
      return h;
    } catch { return "bilinmiyor"; }
  })().finally(() => { ipSoz = null; });
  return ipSoz;
}

/* ------------------------------ kullanıcının kendi anahtarı ------------------------------ */
let kendiDurum = null;      // { var: boolean, anahtar: string|null, kilitli: boolean }
export async function kendiAnahtarDurumu(yenile = false) {
  if (kendiDurum && !yenile) return kendiDurum;
  try {
    if (!(await oturumVarMi())) return (kendiDurum = { var: false, anahtar: null, kilitli: false });
    const K = await kasaModulu();
    if (!(await K.openmeteoKayitliMi())) return (kendiDurum = { var: false, anahtar: null, kilitli: false });
    if (!K.kasaAcikMi()) { try { await K.otomatikAc(); } catch { /* kilitli kalır */ } }
    const a = K.kasaAcikMi() ? K.anahtarAl("openmeteo") : null;
    return (kendiDurum = { var: true, anahtar: a || null, kilitli: !a });
  } catch { return (kendiDurum = { var: false, anahtar: null, kilitli: false }); }
}
export async function kendiAnahtariKaydet(anahtar) {
  const t = String(anahtar || "").trim();
  if (!/^[A-Za-z0-9_\-.]{8,200}$/.test(t)) throw new Error("Anahtar biçimi geçersiz (harf, rakam, - _ . ve en az 8 karakter).");
  const K = await kasaModulu();
  if (!K.kasaAcikMi()) { const ok = await K.otomatikAc().catch(() => false); if (!ok) throw new Error("Anahtar kasası açılamadı. HavaStil › Ayarlar › Yapay zekâ bölümünden kasayı aç, sonra tekrar dene."); }
  await K.anahtarKaydet("openmeteo", t, null); kendiDurum = null; omOnbellekSifirla();
}
export async function kendiAnahtariSil() { await (await kasaModulu()).anahtarSil("openmeteo"); kendiDurum = null; omOnbellekSifirla(); }

/* ------------------------------ kaynak seçimi ------------------------------ */
export async function omKaynakSec() {
  const ayar = await omAyar();
  const tercih = omTercihOku().kaynak;
  if (tercih === "kendi" && ayar.kendi_anahtar_izni !== false) {
    const d = await kendiAnahtarDurumu();
    if (d.anahtar) return { kaynak: "kendi", anahtar: d.anahtar, ayar };
  }
  return { kaynak: ayar.aktif_kaynak === "site" ? "site" : "varsayilan", ayar };
}

/* ------------------------------ misafir (yerel) sayaç ------------------------------ */
const bugun = () => new Date().toISOString().slice(0, 10);
function misafirSay(ag, sinir) {
  let o; try { o = JSON.parse(localStorage.getItem(MISAFIR_ANAHTARI) || "null"); } catch { o = null; }
  if (!o || o.g !== bugun()) o = { g: bugun(), n: 0 };
  if (o.n + ag > sinir) return { izin: false, neden: `Misafir olarak günlük ${sinir} Open-Meteo çağrısı sınırına ulaştın. Giriş yaparak daha yüksek kota kullanabilirsin.` };
  o.n += ag; try { localStorage.setItem(MISAFIR_ANAHTARI, JSON.stringify(o)); } catch { /* yok say */ }
  return { izin: true, kalan: { gun: sinir - o.n } };
}

export class OmKotaHatasi extends Error { constructor(m, d = {}) { super(m); this.name = "OmKotaHatasi"; this.kota = true; Object.assign(this, d); } }

let sonKota = null;       // son başarılı ayırmanın {kalan} bilgisi (arayüz için)
export const omSonKota = () => sonKota;

async function oturumVarMi() { try { const { data } = await supabase.auth.getSession(); return data?.session || null; } catch { return null; } }

/** Kotayı ayırır; izin yoksa OmKotaHatasi fırlatır. Dönen: { kaynak, ag, ip, oturum } */
async function kotaAyir(url, secenek) {
  const sec = await omKaynakSec();
  const ag = Math.max(1, Math.round(secenek.agirlik ?? omAgirlik(url)));
  const oturum = await oturumVarMi();
  const kaynak = secenek.kaynak || sec.kaynak;
  if (!oturum) {
    const s = misafirSay(ag, Math.min(sec.ayar.kullanici_limit?.gun ?? 1000, 1000));
    if (!s.izin) throw new OmKotaHatasi(s.neden, { pencere: "gun" });
    sonKota = { kaynak: "varsayilan", kalan: s.kalan, ag };
    return { kaynak: "varsayilan", ag, ip: "bilinmiyor", oturum: null, ayar: sec.ayar, anahtar: null };
  }
  if (sec.ayar.migrasyonYok) return { kaynak, ag, ip: "bilinmiyor", oturum, ayar: sec.ayar, anahtar: sec.anahtar || null, kotasiz: true };
  const ip = kaynak === "site" ? "bilinmiyor" : await ipOzeti();      // site kaynağında IP özetini Worker kendisi üretir (istemciye güvenmez)
  if (kaynak !== "site") {
    const { data, error } = await supabase.rpc("openmeteo_kota_al", { p_agirlik: ag, p_kaynak: kaynak, p_ip_hash: ip });
    if (error) { if (/does not exist|schema cache|42883/i.test(error.message || "")) return { kaynak, ag, ip, oturum, ayar: sec.ayar, anahtar: sec.anahtar || null, kotasiz: true }; throw new OmKotaHatasi(`Kota doğrulanamadı: ${error.message}`); }
    if (!data?.izin) throw new OmKotaHatasi(data?.neden || "Open-Meteo kotası doldu.", { pencere: data?.pencere, sinir: data?.sinir });
    sonKota = { kaynak, kalan: data.kalan, ag };
  } else sonKota = { kaynak, kalan: null, ag };
  return { kaynak, ag, ip, oturum, ayar: sec.ayar, anahtar: sec.anahtar || null };
}
async function kotaIade(k) { if (!k || k.kotasiz || !k.oturum || k.kaynak === "site") return; try { await supabase.rpc("openmeteo_kota_iade", { p_agirlik: k.ag, p_kaynak: k.kaynak, p_ip_hash: k.ip }); } catch { /* yok say */ } }

/** Maliyet ön izlemesi (kota HARCAMAZ): { agirlik, kaynak, kalanGun, sinirGun, yeter } */
export async function omOnizle(url) {
  const ag = omAgirlik(url), sec = await omKaynakSec();
  let kalanGun = null, sinirGun = null;
  try {
    if (sec.kaynak !== "kendi" && !sec.ayar.migrasyonYok && await oturumVarMi()) {
      const o = await omKullanimOzeti();
      const kisi = o.kullanici_limit?.gun, kul = o.ben?.gun ?? 0;
      const plan = sec.kaynak === "site" ? { l: o.site_limit?.gun, u: o.site?.gun ?? 0 } : { l: o.ip_limit?.gun, u: o.ip?.gun ?? 0 };
      const adaylar = [];
      if (kisi != null) adaylar.push(kisi - kul);
      if (plan.l != null) adaylar.push(plan.l - plan.u);
      if (adaylar.length) { kalanGun = Math.max(0, Math.min(...adaylar)); sinirGun = kisi ?? plan.l; }
    }
  } catch { /* önizleme en iyi çabadır */ }
  return { agirlik: ag, kaynak: sec.kaynak, kalanGun, sinirGun, yeter: kalanGun == null || ag <= kalanGun };
}

/** ANA GİRİŞ: Open-Meteo URL'sini kota + anahtar kuralları ile getirir ve JSON döndürür. */
export async function omJson(url, { sinyal = null, zamanAsimiMs = 12000, agirlik = null, kaynak = null } = {}) {
  const hedef = new URL(url);
  if (!OM_HOST.test(hedef.hostname)) throw new Error("Open-Meteo dışı adres.");
  const k = await kotaAyir(url, { agirlik, kaynak });
  const kontrol = new AbortController();
  const z = setTimeout(() => kontrol.abort(), zamanAsimiMs);
  if (sinyal) { if (sinyal.aborted) kontrol.abort(); else sinyal.addEventListener("abort", () => kontrol.abort(), { once: true }); }
  try {
    let r;
    if (k.kaynak === "site") {
      const { data } = await supabase.auth.getSession();
      r = await fetch(`${HAVASTIL_WORKER_URL}/openmeteo?u=${encodeURIComponent(url)}`, { signal: kontrol.signal, headers: { Authorization: `Bearer ${data?.session?.access_token || ""}`, Accept: "application/json" }, credentials: "omit", referrerPolicy: "no-referrer" });
      if (r.status === 429) { const j = await r.json().catch(() => ({})); throw new OmKotaHatasi(j.error || "Open-Meteo site kotası doldu.", { pencere: j.pencere, sinir: j.sinir }); }
      if (r.status === 501) { const j = await r.json().catch(() => ({})); throw new Error(j.error || "Site Open-Meteo anahtarı Worker'da tanımlı değil."); }
    } else if (k.kaynak === "kendi") {
      const m = new URL(url); m.hostname = MUSTERI_HOST[m.hostname] || m.hostname; m.searchParams.set("apikey", k.anahtar);
      r = await fetch(m.toString(), { signal: kontrol.signal, headers: { Accept: "application/json" }, credentials: "omit", referrerPolicy: "no-referrer" });
      if (r.status === 401 || r.status === 403) throw new Error("Open-Meteo API anahtarın geçersiz ya da planın bu uç noktayı kapsamıyor (HavaStil › Ayarlar › Open-Meteo).");
    } else {
      r = await fetch(url, { signal: kontrol.signal, headers: { Accept: "application/json" }, credentials: "omit", referrerPolicy: "no-referrer" });
    }
    if (r.status === 429) throw new OmKotaHatasi(k.kaynak === "varsayilan" ? "Open-Meteo bu IP adresi için istek sınırı bildirdi (429). Bir süre sonra dene, daha az ayrıntı seç ya da Ayarlar'dan kendi API anahtarını gir." : "Open-Meteo 429 döndürdü (plan kotası).", { sinir: "open-meteo" });
    if (!r.ok) { let t = ""; try { t = (await r.json())?.reason || ""; } catch { /* yok say */ } throw new Error(`HTTP ${r.status}${t ? ` — ${t}` : ""}`); }
    return await r.json();
  } catch (h) {
    if (!(h instanceof OmKotaHatasi) && (h.name === "TypeError" || h.name === "AbortError")) await kotaIade(k);     // ağ hatası: ayrılan kotayı geri ver
    throw h;
  } finally { clearTimeout(z); }
}

/* ------------------------------ özet / yönetim (arayüz için) ------------------------------ */
export async function omKullanimOzeti() {
  const { data, error } = await supabase.rpc("openmeteo_kullanim_ozeti", { p_ip_hash: await ipOzeti() });
  if (error) throw new Error(error.message);
  return data;
}
export async function omYonetimKaydet(ayar) {
  const { error } = await supabase.rpc("openmeteo_ayar_kaydet", { p_plan: ayar.plan, p_ucretsiz: ayar.ucretsiz_limit, p_ticari: ayar.ticari_limit, p_kullanici: ayar.kullanici_limit, p_kendi_izin: ayar.kendi_anahtar_izni, p_site_anahtari: ayar.site_anahtari_tanimli, p_aciklama: ayar.aciklama || null });
  if (error) throw new Error(error.message); omOnbellekSifirla();
}
export async function omKullanimTumu(ara = null, limit = 20, offset = 0) {
  const { data, error } = await supabase.rpc("openmeteo_kullanim_tumu", { p_ara: ara || null, p_limit: limit, p_offset: offset });
  if (error) throw new Error(error.message); return data || [];
}
export async function omKullaniciLimitiKaydet(uid, limitler) {
  const { error } = await supabase.rpc("openmeteo_kullanici_limit_kaydet", { p_user: uid, p_limitler: limitler });
  if (error) throw new Error(error.message);
}
export async function workerSaglik() {
  try { const k = new AbortController(), z = setTimeout(() => k.abort(), 5000); const r = await fetch(`${HAVASTIL_WORKER_URL}/saglik`, { signal: k.signal, credentials: "omit" }); clearTimeout(z); return r.ok ? await r.json() : null; } catch { return null; }
}

/**
 * ai-kasa.js — HavaStil v8 · YAPAY ZEKÂ ANAHTAR KASASI.
 * Kullanıcı kendi API anahtarını (Gemini/OpenAI/Claude/OpenRouter) girer. Güvenlik modeli:
 *   • Anahtar TARAYICIDA, kullanıcının "kasa parolası"ndan türetilen AES-GCM-256 anahtarıyla şifrelenir (PBKDF2-SHA256, 600.000 tur, rastgele tuz;
 *     şifreli metin kullanıcı kimliğine ve sağlayıcıya AAD ile bağlanır → satırlar başka hesaba/sağlayıcıya taşınamaz).
 *   • Sunucuya (Supabase `havastil_ai_kasasi`, RLS: yalnızca sahibi) YALNIZCA şifreli metin gider. Kasa parolası ve düz anahtar sunucuya, Worker'a,
 *     günlüklere ve sistem yedeğine ASLA girmez; Site Sahibi dâhil kimse anahtarı okuyamaz. (Tablo yedek tablo listesinde de yok.)
 *   • Çözülmüş anahtarlar yalnızca bu sekmenin BELLEĞİNDEDİR (localStorage/sessionStorage'a yazılmaz); sekme kapanınca ya da 20 dk kullanılmayınca kasa kilitlenir.
 *   • Parola unutulursa kurtarma yoktur (bilerek: kurtarma = arka kapı): "Kasayı sıfırla" ile anahtarlar silinir ve yeniden girilir.
 * Cihazlar arası: aynı hesap + aynı kasa parolası = şifreli satırlar her cihazda açılır.
 *
 * v2 (HESAP KASASI — varsayılan): AYRI "kasa parolası" YOKTUR. Anahtarlar, hesabın ANA parolasına bağlı Not Kasası anahtarıyla (DEK,
 *   notlar/kasa.js) AES-GCM ile sarılır. Giriş yapıldığında Not Kasası zaten sessizce açılır → HavaStil kasası da kullanıcıya hiçbir şey
 *   sorulmadan açılır; "Kasayı kilitle" sonrası tek tıkla (parolasız) yeniden açılır. Ana parola değişse bile zarf otomatik yenilendiği için
 *   anahtarlar kaybolmaz. Not Kasası kurulu olmayan hesaplarda (ör. yeni Google hesabı) eski bağımsız kasa parolası yolu yedek olarak kalır.
 *   Satır biçimi: v1 = {kdf,tuz,iv,ct} (kasa parolası) · v2 = {v:2,mod:"dek",iv,ct}. İkisi bir arada yaşayabilir; v1 satırlar açılınca v2'ye taşınır.
 */
import { supabase } from "../core/supabase-client.js";
import * as NotKasa from "../notlar/kasa.js";

const TUR = 600000, PAROLA_MIN = 8, BOS_KILIT_MS = 20 * 60 * 1000;
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (u8) => { let s = ""; for (const b of u8) s += String.fromCharCode(b); return btoa(s); };
const b64coz = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const rastgele = (n) => crypto.getRandomValues(new Uint8Array(n));

let kasa = null;              // { key: CryptoKey, tuz: Uint8Array, anahtarlar: Map<string,string>, uid: string }
let kilitZamani = 0;
const dinleyiciler = new Set();
export const kasaDegisti = (fn) => { dinleyiciler.add(fn); return () => dinleyiciler.delete(fn); };
const duyur = () => dinleyiciler.forEach((f) => { try { f(); } catch { /* yok say */ } });

export const kasaAcikMi = () => !!kasa;
export function kilitle() { kasa = null; clearTimeout(kilitZamani); duyur(); }
function kilidiYenile() { clearTimeout(kilitZamani); kilitZamani = setTimeout(kilitle, BOS_KILIT_MS); }

async function anahtarTuret(parola, tuz) {
  const ham = await crypto.subtle.importKey("raw", enc.encode(parola), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt: tuz, iterations: TUR, hash: "SHA-256" }, ham, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function sifrele(key, tuz, metin, aad) {
  const iv = rastgele(12);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(aad) }, key, enc.encode(metin));
  return { v: 1, kdf: "PBKDF2-SHA256", it: TUR, tuz: b64(tuz), iv: b64(iv), ct: b64(new Uint8Array(ct)) };
}
async function coz(key, kayit, aad) {
  return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64coz(kayit.iv), additionalData: enc.encode(aad) }, key, b64coz(kayit.ct)));
}
const aadOlustur = (uid, sag) => `havastil-ai:${uid}:${sag}`;
async function kullaniciKimligi() {
  const { data } = await supabase.auth.getUser();
  if (!data?.user?.id) throw new Error("Oturum bulunamadı; yeniden giriş yap.");
  return data.user.id;
}
const tabloHatasi = (e) => (/does not exist|42P01|schema cache/i.test(e?.message || "") ? "Kasa tablosu yok: Supabase'de 0113_site_duyurulari_ve_havastil_ai_kasasi.sql çalıştırılmalı." : e?.message || "Kasa hatası.");

/** Kayıtlı (şifreli) sağlayıcılar: { gemini: {model}, ... } — anahtarlar ÇÖZÜLMEZ, parola gerekmez. */
export async function kayitliSaglayicilar() {
  const { data, error } = await supabase.from("havastil_ai_kasasi").select("saglayici, model");
  if (error) throw new Error(tabloHatasi(error));
  // 'openmeteo' (kullanıcının kendi hava verisi anahtarı, 0121) yapay zekâ sağlayıcısı DEĞİLDİR; AI arayüzlerini bozmasın diye burada süzülür.
  return Object.fromEntries((data || []).filter((r) => r.saglayici !== "openmeteo").map((r) => [r.saglayici, { model: r.model || null }]));
}
/** Kullanıcının Open-Meteo anahtarı kasada kayıtlı mı? (anahtar çözülmez) */
export async function openmeteoKayitliMi() {
  const { data, error } = await supabase.from("havastil_ai_kasasi").select("saglayici").eq("saglayici", "openmeteo").limit(1);
  if (error) throw new Error(tabloHatasi(error));
  return !!(data && data.length);
}

const dekEtiketi = (sag) => `havastil-ai:${sag}`;
const sifreliV2 = (r) => r?.sifreli?.v === 2 && r.sifreli.mod === "dek";

/** Hesap kasası (Not Kasası DEK'i) kullanılabilir mi? Açık değilse girişteki sessiz açmayı dener; parola SORMAZ. */
export async function hesapKasasiHazirMi() {
  try {
    if (NotKasa.kasaAcikMi()) return true;
    const { data } = await supabase.auth.getSession();
    return data?.session ? await NotKasa.kasaSessizAc(data.session) : false;
  } catch { return false; }
}

/**
 * Parolasız açma (hesap kasası). true → kasa açıldı. Eski (v1, kasa parolalı) satır varsa false döner: kullanıcı bir kez eski parolayı girer.
 * Kayıt hiç yoksa boş kasa açılır (ilk anahtar için parola gerekmez).
 */
export async function otomatikAc() {
  if (kasa) return true;
  if (!(await hesapKasasiHazirMi())) return false;
  const uid = await kullaniciKimligi();
  const { data, error } = await supabase.from("havastil_ai_kasasi").select("saglayici, sifreli");
  if (error) throw new Error(tabloHatasi(error));
  if ((data || []).some((r) => !sifreliV2(r))) return false;                    // eski parolalı satır → önce taşınmalı
  const anahtarlar = new Map();
  try {
    for (const r of data || []) anahtarlar.set(r.saglayici, dec.decode(await NotKasa.dekIleAc(r.sifreli.ct, r.sifreli.iv, dekEtiketi(r.saglayici))));
  } catch { return false; }                                                       // başka DEK ile şifrelenmiş (kasa sıfırlanmış) → elle sıfırla
  kasa = { mod: "dek", anahtarlar, uid }; kilidiYenile(); duyur();
  return true;
}
/** Kasa durumu: kayıt sayısı, eski parolalı kayıt var mı, hesap kasası kullanılabilir mi. */
export async function kasaDurumu() {
  const { data, error } = await supabase.from("havastil_ai_kasasi").select("saglayici, sifreli");
  if (error) throw new Error(tabloHatasi(error));
  const satirlar = data || [];
  return { kayitSayisi: satirlar.length, eskiVar: satirlar.some((r) => !sifreliV2(r)), hesapKasasi: await hesapKasasiHazirMi() };
}

/** Var olan (eski, kasa parolalı v1) kasayı aç. Hesap kasası hazırsa açılınca anahtarlar v2'ye taşınır. Yanlış parola → "Kasa parolası yanlış". */
export async function kasaAc(parola) {
  const uid = await kullaniciKimligi();
  const { data, error } = await supabase.from("havastil_ai_kasasi").select("saglayici, sifreli");
  if (error) throw new Error(tabloHatasi(error));
  const eski = (data || []).filter((r) => !sifreliV2(r));
  if (!eski.length) throw new Error("Kasada kayıtlı anahtar yok.");
  const tuz = b64coz(eski[0].sifreli.tuz);
  const key = await anahtarTuret(parola, tuz);
  const anahtarlar = new Map();
  try { for (const r of eski) anahtarlar.set(r.saglayici, await coz(key, r.sifreli, aadOlustur(uid, r.saglayici))); }
  catch { throw new Error("Kasa parolası yanlış (ya da kayıt bozuk)."); }
  kasa = { key, tuz, anahtarlar, uid, mod: "parola" }; kilidiYenile(); duyur();
  if (await hesapKasasiHazirMi()) { try { await hesapKasasinaTasi(); } catch { /* taşınamadıysa eski kasa çalışmaya devam eder */ } }
}
/** Bellekteki (çözülmüş) anahtarları hesap kasasına yeniden şifreleyip v2 olarak yazar; ayrı kasa parolası artık gerekmez. */
async function hesapKasasinaTasi() {
  const anahtarlar = new Map(kasa.anahtarlar), uid = kasa.uid;
  const { data: m } = await supabase.from("havastil_ai_kasasi").select("saglayici, model");
  const modeller = Object.fromEntries((m || []).map((r) => [r.saglayici, r.model]));
  for (const [sag, a] of anahtarlar) await v2Yaz(uid, sag, a, modeller[sag] || null);
  kasa = { mod: "dek", anahtarlar, uid }; kilidiYenile(); duyur();
}
async function v2Yaz(uid, saglayici, anahtar, model) {
  const { sarili, iv } = await NotKasa.dekIleSar(enc.encode(anahtar), dekEtiketi(saglayici));
  const { error } = await supabase.from("havastil_ai_kasasi").upsert({ user_id: uid, saglayici, sifreli: { v: 2, mod: "dek", iv, ct: sarili }, model: model || null, guncelleme: new Date().toISOString() }, { onConflict: "user_id,saglayici" });
  if (error) throw new Error(tabloHatasi(error));
}
/** İlk anahtar için yeni kasa kur (parola en az 8 karakter). Zaten kayıt varsa kasaAc kullanılmalıdır. */
export async function kasaKur(parola) {
  if (typeof parola !== "string" || parola.length < PAROLA_MIN) throw new Error(`Kasa parolası en az ${PAROLA_MIN} karakter olmalı.`);
  const uid = await kullaniciKimligi();
  const tuz = rastgele(16);
  kasa = { key: await anahtarTuret(parola, tuz), tuz, anahtarlar: new Map(), uid, mod: "parola" }; kilidiYenile(); duyur();
}
export async function anahtarKaydet(saglayici, anahtar, model) {
  if (!kasa) throw new Error("Kasa kilitli.");
  anahtar = String(anahtar || "").trim();
  if (anahtar.length < 8 || /\s/.test(anahtar)) throw new Error("Anahtar geçersiz görünüyor (boşluk içermemeli).");
  if (kasa.mod === "dek") await v2Yaz(kasa.uid, saglayici, anahtar, model);
  else {
    const sifreli = await sifrele(kasa.key, kasa.tuz, anahtar, aadOlustur(kasa.uid, saglayici));
    const { error } = await supabase.from("havastil_ai_kasasi").upsert({ user_id: kasa.uid, saglayici, sifreli, model: model || null, guncelleme: new Date().toISOString() }, { onConflict: "user_id,saglayici" });
    if (error) throw new Error(tabloHatasi(error));
  }
  kasa.anahtarlar.set(saglayici, anahtar); kilidiYenile(); duyur();
}
export async function modelKaydet(saglayici, model) {
  const { error } = await supabase.from("havastil_ai_kasasi").update({ model: model || null, guncelleme: new Date().toISOString() }).eq("saglayici", saglayici);
  if (error) throw new Error(tabloHatasi(error));
}
export async function anahtarSil(saglayici) {
  const { error } = await supabase.from("havastil_ai_kasasi").delete().eq("saglayici", saglayici);
  if (error) throw new Error(tabloHatasi(error));
  kasa?.anahtarlar.delete(saglayici); duyur();
}
/** Parola unutuldu / başka cihazda değişti: TÜM şifreli anahtarlar silinir, kasa kapanır. */
export async function kasayiSifirla() {
  const { error } = await supabase.from("havastil_ai_kasasi").delete().neq("saglayici", "");
  if (error) throw new Error(tabloHatasi(error));
  kilitle();
}
/** Çözülmüş anahtar (yalnızca bellekte). Kasa kilitliyse null. */
export function anahtarAl(saglayici) { if (!kasa) return null; kilidiYenile(); return kasa.anahtarlar.get(saglayici) || null; }
export const aciksaglayicilar = () => (kasa ? [...kasa.anahtarlar.keys()] : []);
export const PAROLA_MIN_UZUNLUK = PAROLA_MIN;

/* seçili sağlayıcı/model (anahtar DEĞİL; yalnızca tercih → localStorage) */
const SECIM = "hv_ai_secim";
export function secimOku() { try { const s = JSON.parse(localStorage.getItem(SECIM) || "null"); return s && typeof s.saglayici === "string" ? s : null; } catch { return null; } }
export function secimYaz(saglayici, model) { try { localStorage.setItem(SECIM, JSON.stringify({ saglayici, model })); } catch { /* yok say */ } }

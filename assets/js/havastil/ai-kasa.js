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
 */
import { supabase } from "../core/supabase-client.js";

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
  return Object.fromEntries((data || []).map((r) => [r.saglayici, { model: r.model || null }]));
}

/** Var olan kasayı aç. Yanlış parola → "Kasa parolası yanlış". */
export async function kasaAc(parola) {
  const uid = await kullaniciKimligi();
  const { data, error } = await supabase.from("havastil_ai_kasasi").select("saglayici, sifreli");
  if (error) throw new Error(tabloHatasi(error));
  if (!data?.length) throw new Error("Kasada kayıtlı anahtar yok.");
  const tuz = b64coz(data[0].sifreli.tuz);
  const key = await anahtarTuret(parola, tuz);
  const anahtarlar = new Map();
  try { for (const r of data) anahtarlar.set(r.saglayici, await coz(key, r.sifreli, aadOlustur(uid, r.saglayici))); }
  catch { throw new Error("Kasa parolası yanlış (ya da kayıt bozuk)."); }
  kasa = { key, tuz, anahtarlar, uid }; kilidiYenile(); duyur();
}
/** İlk anahtar için yeni kasa kur (parola en az 8 karakter). Zaten kayıt varsa kasaAc kullanılmalıdır. */
export async function kasaKur(parola) {
  if (typeof parola !== "string" || parola.length < PAROLA_MIN) throw new Error(`Kasa parolası en az ${PAROLA_MIN} karakter olmalı.`);
  const uid = await kullaniciKimligi();
  const tuz = rastgele(16);
  kasa = { key: await anahtarTuret(parola, tuz), tuz, anahtarlar: new Map(), uid }; kilidiYenile(); duyur();
}
export async function anahtarKaydet(saglayici, anahtar, model) {
  if (!kasa) throw new Error("Kasa kilitli.");
  anahtar = String(anahtar || "").trim();
  if (anahtar.length < 8 || /\s/.test(anahtar)) throw new Error("Anahtar geçersiz görünüyor (boşluk içermemeli).");
  const sifreli = await sifrele(kasa.key, kasa.tuz, anahtar, aadOlustur(kasa.uid, saglayici));
  const { error } = await supabase.from("havastil_ai_kasasi").upsert({ user_id: kasa.uid, saglayici, sifreli, model: model || null, guncelleme: new Date().toISOString() }, { onConflict: "user_id,saglayici" });
  if (error) throw new Error(tabloHatasi(error));
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

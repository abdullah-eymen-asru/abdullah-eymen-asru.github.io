/*
 * assets/js/kurtarma-kiti/kit.js — EVRENSEL YEDEK KURTARMA KODU (Recovery Kit) çekirdeği.   [2026-10, migration 0096]
 *
 * TEK KOD, İKİ KASA: "XXXX-XXXX-XXXX-XXXX" (16 karakter Crockford base32 = 80 bit rastgelelik) Notlar DEK'ini (not/ek şifre çözme) ve
 * mesajlaşma RSA özel anahtarını (sohbet anahtarı zarflarını açar) TEK blobda sarar:
 *
 *   kod ──PBKDF2-SHA256(600k, kullanıcıya özel rastgele tuz)──► KEK ──AES-GCM──► kit_sarili = { v, uid, dek, rsa }
 *
 * - Kod sunucuya GİTMEZ ve hiçbir yerde saklanmaz (kullanıcıya BİR KEZ gösterilir). Sunucu yalnızca sarılı blobu + tuzu görür.
 * - Blob e2ee_kullanici_anahtarlari satırındadır → sistem/üye yedeğiyle BİRLİKTE taşınır; AAD kullanıcı kimliğini İÇERMEZ
 *   (kimlik değişse de — farklı hesap, yeni Supabase projesi — açılabilsin). Eski kimlik blobun İÇİNDE durur ve yeniden zarflamada
 *   notların/eklerin AAD'sini kurmak için kullanılır.
 * - 80 bit + 600.000 tur PBKDF2: çevrimdışı kaba kuvvet pratikte imkânsızdır (≈2^80 deneme × yavaş türetme). Parolayla kıyaslanamaz biçimde güçlü,
 *   elle yazılabilecek kadar kısa. KODU KAYBEDEN + parolasını da unutan kişi için kurtarma YOKTUR (sıfır-bilgi).
 * - Yeni kod üretmek eski kodu GEÇERSİZ kılar (aynı satırın üzerine yazılır).
 */
import { supabase } from "../core/supabase-client.js";
import * as Kasa from "../notlar/kasa.js";
import * as E from "../r2-arsiv/e2ee.js";

export const KIT_KDF_TUR = 600000;
export const KIT_SURUM = 1;
const KIT_AAD = new TextEncoder().encode("aea-kit|v1");
const enc = new TextEncoder();
const dec = new TextDecoder();

export class KitHatasi extends Error {
  constructor(kod, mesaj) { super(mesaj); this.name = "KitHatasi"; this.kod = kod; }
}

/* ---------------- Crockford base32 (I, L, O, U yok → elle yazarken karışmaz) ---------------- */
const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function b32Kodla(u8) {
  let bit = 0, deger = 0, cikti = "";
  for (const b of u8) { deger = (deger << 8) | b; bit += 8; while (bit >= 5) { cikti += B32[(deger >>> (bit - 5)) & 31]; bit -= 5; } }
  if (bit > 0) cikti += B32[(deger << (5 - bit)) & 31];
  return cikti;
}
function b32Coz(metin) {
  let bit = 0, deger = 0; const o = [];
  for (const ch of metin) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new KitHatasi("KOD_BICIM", "Kodda geçersiz karakter var.");
    deger = (deger << 5) | i; bit += 5;
    if (bit >= 8) { o.push((deger >>> (bit - 8)) & 255); bit -= 8; }
  }
  return new Uint8Array(o);
}

/** 10 rastgele bayt → "XXXX-XXXX-XXXX-XXXX". */
export function kodUret() {
  const ham = crypto.getRandomValues(new Uint8Array(10));
  const m = b32Kodla(ham).match(/.{1,4}/g).join("-");
  ham.fill(0);
  return m;
}

/** Kullanıcının yazdığı metni normalleştirir (küçük harf, boşluk, tire, I/L→1, O→0) ve 16 karakter olduğunu doğrular → 10 bayt. */
export function kodAyristir(metin) {
  const t = String(metin || "").toUpperCase().replace(/[\s-]+/g, "").replace(/[IL]/g, "1").replace(/O/g, "0");
  if (t.length !== 16) throw new KitHatasi("KOD_BICIM", "Kod 16 karakter olmalı (XXXX-XXXX-XXXX-XXXX).");
  return b32Coz(t);
}
/** Girdi kutusu için biçimlendirme: yazdıkça 4'lü gruplara tire koyar. */
export function kodBicimle(metin) {
  const t = String(metin || "").toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/[IL]/g, "1").replace(/O/g, "0").slice(0, 16);
  return (t.match(/.{1,4}/g) || []).join("-");
}

async function kekTuret(kodBayt, tuz, tur) {
  const malzeme = await crypto.subtle.importKey("raw", kodBayt, "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: tuz, iterations: tur }, malzeme, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

/**
 * Notlar kasası AÇIK olmalı (DEK gerekir). Yeni kod üretir, blobu sarar, sunucuya yazar, KODU döndürür (başka hiçbir yerde saklanmaz).
 * Mesajlaşma anahtarı yoksa o kısım null kalır (Notlar yine kurtarılır); Notlar kasası yoksa yalnızca mesaj kısmı sarılır.
 */
export async function kitOlustur() {
  let dek = null, rsa = null;
  try {
    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user?.id;
    if (!uid) throw new KitHatasi("OTURUM", "Oturum bulunamadı.");
    if (Kasa.kasaAcikMi()) dek = await Kasa.kitIcinDekHamAl();
    try { rsa = await E.ozelAnahtarPkcs8(); } catch { rsa = null; }
    if (!dek && !rsa) throw new KitHatasi("KILITLI", "Kod üretmek için Notlar kasanın ya da mesaj anahtarının açık olması gerekir. Önce giriş parolanla Notlar'ı aç.");
    const kod = kodUret();
    const kodBayt = kodAyristir(kod);
    const tuz = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const kek = await kekTuret(kodBayt, tuz, KIT_KDF_TUR);
    kodBayt.fill(0);
    const yuk = enc.encode(JSON.stringify({ v: KIT_SURUM, uid, dek: dek ? E.b64Kodla(dek) : null, rsa: rsa ? E.b64Kodla(rsa) : null, olusturma: new Date().toISOString() }));
    const sarili = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: KIT_AAD }, kek, yuk);
    yuk.fill(0);
    const { error } = await supabase.rpc("e2ee_kit_kaydet", { p_sarili: E.b64Kodla(sarili), p_iv: E.b64Kodla(iv), p_tuz: E.b64Kodla(tuz), p_tur: KIT_KDF_TUR });
    if (error) throw new KitHatasi("SUNUCU", /does not exist|PGRST202|42883|schema cache/i.test(error.message || "") ? "0096 numaralı migration henüz çalıştırılmamış." : error.message);
    return { kod, notlar: !!dek, mesajlar: !!rsa };
  } finally { dek?.fill(0); rsa?.fill(0); }
}

/**
 * Bir kit satırını ({ kit_sarili, kit_iv, kit_tuz, kit_kdf_tur, kullanici_id? }) kodla açar.
 * Dönüş: { uid, dek: Uint8Array|null, rsa: Uint8Array|null }. Kod yanlışsa KitHatasi("KOD_YANLIS"). Çağıran baytları işi bitince sıfırlamalıdır.
 */
export async function kitSatiriniAc(satir, kodMetni) {
  const kodBayt = kodAyristir(kodMetni);
  try {
    const kek = await kekTuret(kodBayt, E.b64Coz(satir.kit_tuz), satir.kit_kdf_tur || KIT_KDF_TUR);
    let yuk;
    try { yuk = await crypto.subtle.decrypt({ name: "AES-GCM", iv: E.b64Coz(satir.kit_iv), additionalData: KIT_AAD }, kek, E.b64Coz(satir.kit_sarili)); }
    catch { throw new KitHatasi("KOD_YANLIS", "Kod yanlış (ya da bu kod bu yedeğe ait değil)."); }
    const nesne = JSON.parse(dec.decode(yuk));
    if (nesne?.v !== KIT_SURUM || !nesne.uid) throw new KitHatasi("SURUM", "Bu kodun biçimi desteklenmiyor (daha yeni bir sürümle üretilmiş olabilir).");
    return { uid: nesne.uid, dek: nesne.dek ? E.b64Coz(nesne.dek) : null, rsa: nesne.rsa ? E.b64Coz(nesne.rsa) : null };
  } finally { kodBayt.fill(0); }
}

/** Kendi hesabımın kit durumu: { kit_var, kit_at }. */
export async function kitDurumu() {
  const d = await E.anahtarDurumu();
  return { kitVar: !!d.kit_var, kitAt: d.kit_at || null, dekVar: !!d.dek_var };
}

/**
 * AYNI HESAPTA KİLİT AÇMA (kilit paneli): kendi satırımdaki kit'i kodla açar.
 *  - mesaj anahtarı (RSA) bu oturuma alınır ve DEK/Worker sarmalları onarılır;
 *  - `parola` verilirse ve Notlar kasası kilitliyse (parola unutuldu/değişti) kasa zarfı o parolayla YENİDEN kurulur.
 * Dönüş: { mesajlar: bool, notlar: bool, onarildi: bool }
 */
export async function kitIleAc(kodMetni, { parola = null, cihazdaHatirla = false } = {}) {
  const { data: o } = await supabase.auth.getSession();
  const session = o.session;
  if (!session) throw new KitHatasi("OTURUM", "Oturum bulunamadı.");
  const { data: satir, error } = await supabase.from("e2ee_kullanici_anahtarlari")
    .select("kullanici_id, kit_sarili, kit_iv, kit_tuz, kit_kdf_tur").eq("kullanici_id", session.user.id).maybeSingle();
  if (error) throw new KitHatasi("SUNUCU", "Anahtar kaydı okunamadı.");
  if (!satir?.kit_sarili) throw new KitHatasi("KIT_YOK", "Bu hesapta Yedek Kurtarma Kodu üretilmemiş.");
  const k = await kitSatiriniAc(satir, kodMetni);
  let mesajlar = false, notlar = false, onarildi = false;
  try {
    if (k.rsa) { const r = await E.ozelAnahtariIceAktar(k.rsa, { cihazdaHatirla }); mesajlar = true; onarildi = !!r.onarildi; }
    if (k.dek && parola && !Kasa.kasaAcikMi()) {
      await Kasa.kitIleKasaAc(session, k.dek, parola);
      notlar = true;
      await E.anahtariGirisaBagla();
    } else if (k.dek && Kasa.kasaAcikMi()) notlar = true;
  } finally { k.dek?.fill(0); k.rsa?.fill(0); }
  return { mesajlar, notlar, onarildi };
}

/**
 * NOTLAR SEKMESİ — "Kasa parolamı unuttum": kendi satırımdaki kit'i kodla açar, Notlar DEK'ini çözer ve dek_parola zarfını `parola` için
 * YENİDEN kurar (bağımsız kasada yeni Kasa Parolası, değilse güncel giriş parolası). Notlar yeniden şifrelenmez (DEK aynıdır).
 * Kodda mesaj anahtarı da varsa mesajlaşma anahtarı da aynı anda onarılır (sessiz, başarısız olsa bile kasa açılışını bozmaz).
 * Dönüş: Kasa.kitIleKasaAc sonucu ({ durum: "acik" }).
 */
export async function notlarKasasiniKitIleAc(kodMetni, parola) {
  const { data: o } = await supabase.auth.getSession();
  const session = o.session;
  if (!session) throw new KitHatasi("OTURUM", "Oturum bulunamadı.");
  const { data: satir, error } = await supabase.from("e2ee_kullanici_anahtarlari")
    .select("kullanici_id, kit_sarili, kit_iv, kit_tuz, kit_kdf_tur").eq("kullanici_id", session.user.id).maybeSingle();
  if (error) throw new KitHatasi("SUNUCU", "Anahtar kaydı okunamadı.");
  if (!satir?.kit_sarili) throw new KitHatasi("KIT_YOK", "Bu hesapta Yedek Kurtarma Kodu üretilmemiş. (Eski kurtarma anahtarın varsa onu kullan.)");
  const k = await kitSatiriniAc(satir, kodMetni);
  try {
    if (k.uid !== session.user.id) throw new KitHatasi("BASKA_HESAP", "Bu kod başka bir hesaba ait. Başka hesabın yedeği için Sistem Yedeği › İçe aktar ekranını kullan.");
    if (!k.dek) throw new KitHatasi("DEK_YOK", "Bu kod Notlar anahtarını içermiyor (Notlar kasası kilitliyken üretilmiş). Notlar kasası için eski kurtarma anahtarını kullan.");
    const sonuc = await Kasa.kitIleKasaAc(session, k.dek, parola);
    if (k.rsa) { try { await E.ozelAnahtariIceAktar(k.rsa); } catch { /* mesaj anahtarı onarılamadıysa kasa yine açıktır */ } }
    return sonuc;
  } finally { k.dek?.fill(0); k.rsa?.fill(0); }
}

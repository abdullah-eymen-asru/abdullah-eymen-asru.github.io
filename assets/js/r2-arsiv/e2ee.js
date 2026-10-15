/*
 * assets/js/r2-arsiv/e2ee.js
 *
 * Özel dosya paylaşımı için istemci tarafı şifreleme (SubtleCrypto, bağımlılıksız).
 *
 * MİMARİ ("kurtarma kodu yok" + "şifre sıfırlansa da dosyalar açılır"):
 *   - Her kullanıcının tarayıcıda üretilen bir RSA-OAEP-2048 anahtar çifti vardır.
 *   - Özel anahtar, Worker'ın kullanıcıya özel türettiği kasa anahtarıyla
 *     (AES-GCM-256, AAD = kullanıcı id'si) SARILIP Supabase'e yazılır.
 *     Kasa anahtarı Supabase'te/R2'de HİÇ durmaz; yalnızca Worker secret'ından
 *     (E2EE_KASA_SECRET) türetilir ve sadece o kullanıcının geçerli JWT'sine verilir.
 *   - Şifre sıfırlansa bile kullanıcı id'si ve Worker secret'ı aynı kaldığı için
 *     aynı kasa anahtarı yeniden türer -> özel anahtar açılır -> eski dosyalar açılır.
 *   - Dosya: rastgele AES-GCM-256 anahtarı ile şifrelenir (AAD = r2_arsiv kayıt id'si,
 *     yani şifreli blob başka bir kayda taşınamaz); dosya anahtarı her alıcının
 *     açık anahtarıyla RSA-OAEP zarflanır (+ gönderenin kendisi için).
 *
 * GÜVEN MODELİ (dürüst özet): R2 ve Supabase TEK BAŞINA ele geçirilirse içerik
 * okunamaz. Ancak kasa anahtarını türetebilen Worker/secret sahibi (site sahibi) ya da
 * e-posta sıfırlamasıyla hesabı ele geçiren biri teknik olarak çözebilir — bu,
 * "kurtarma kodu yok" şartının kaçınılmaz bedelidir (escrow). Saf E2EE değildir.
 */
import { supabase } from "../core/supabase-client.js";

/*
 * 2026-10 KURTARMA PAROLASI KATMANI (migration 0095) — "Özel anahtar açılamadı" hatasının KALICI çözümü.
 * KÖK NEDEN: özel anahtar YALNIZCA Worker'ın türettiği kasa anahtarıyla sarılıydı (tek kilit). Worker sırrı (E2EE_KASA_SECRET)
 * değişince/yanlış ortamda deploy edilince/farklı projeye taşınınca aynı kullanıcı için FARKLI kasa anahtarı türüyor ve
 * AES-GCM çözümü sessizce başarısız oluyordu; satır bir kez yazılıp UPDATE yolu olmadığı için de onarılamıyordu.
 * ÇÖZÜM: özel anahtar ikinci bir kilitle — kullanıcının KURTARMA PAROLASINDAN (PBKDF2-SHA256, 600k tur) türetilen AES-GCM anahtarıyla —
 * sarılıp sarılı olarak saklanır. Parola ve türetilen anahtar sunucuya HİÇ gitmez. Worker sarmalı bozulursa parola girilir, anahtar
 * açılır ve Worker sarmalı otomatik yeniden yazılır (e2ee_kasa_sarmalini_yenile). Başka cihaz/gizli sekmede de aynı parola yeter.
 * Anahtarlar yalnızca bellekte; "Bu cihazda hatırla" işaretlenirse YALNIZCA çıkarılamaz (non-extractable) CryptoKey nesnesi IndexedDB'ye konur.
 */
export const KURTARMA_KDF_TUR = 600000;
export const KURTARMA_PAROLA_MIN = 10;

export class E2EEKilitHatasi extends Error {
  constructor(mesaj, durum = {}) { super(mesaj); this.name = "E2EEKilitHatasi"; this.kod = "OZEL_ANAHTAR_ACILAMADI"; this.durum = durum; }
}

export const ARSIV_WORKER_URL = "https://r2-arsiv-worker.aeymena.workers.dev"; // wrangler deploy sonrası adresi doğrula
export const E2EE_MAX_BAYT = 100 * 1024 * 1024; // bellekte şifrelendiği için 100 MB tavan

const enc = new TextEncoder();
const RSA = { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" };

function b64(buf) {
  const u8 = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}
const b64coz = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function jwt() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("Oturum bulunamadı.");
  return data.session;
}

let anahtarOnbellek = null; // { uid, kasa, ozel, acik }

async function kasaAnahtariniAl(session) {
  const r = await fetch(`${ARSIV_WORKER_URL}/kasa-anahtari`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
    cache: "no-store",
  });
  if (!r.ok) throw new Error("Kasa anahtarı alınamadı.");
  const { anahtar } = await r.json();
  return crypto.subtle.importKey("raw", b64coz(anahtar), "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** Oturum açmış kullanıcının anahtarlarını hazırlar (yoksa oluşturur). Sessiz, kullanıcıdan hiçbir şey istemez. */
export async function anahtarlariHazirla() {
  const session = await jwt();
  const uid = session.user.id;
  if (anahtarOnbellek?.uid === uid) return anahtarOnbellek;

  const kasa = await kasaAnahtariniAl(session);
  const aad = enc.encode(uid);

  const oku = () => supabase.from("e2ee_kullanici_anahtarlari")
    .select("acik_anahtar, sarili_ozel_anahtar, iv").eq("kullanici_id", uid).maybeSingle();

  let { data: satir, error } = await oku();
  if (error) throw new Error("Anahtar kaydı okunamadı.");

  if (!satir) {
    const cift = await crypto.subtle.generateKey(RSA, true, ["encrypt", "decrypt"]);
    const acik = await crypto.subtle.exportKey("spki", cift.publicKey);
    const ozel = await crypto.subtle.exportKey("pkcs8", cift.privateKey);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const sarili = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad }, kasa, ozel);
    const { error: eklemeHatasi } = await supabase.from("e2ee_kullanici_anahtarlari").insert({
      kullanici_id: uid, acik_anahtar: b64(acik), sarili_ozel_anahtar: b64(sarili), iv: b64(iv),
    });
    // Başka bir sekme aynı anda yazmış olabilir (PK çakışması) -> kazananı oku.
    ({ data: satir, error } = await oku());
    if (error || !satir) throw new Error(eklemeHatasi ? "Anahtar kaydı yazılamadı." : "Anahtar kaydı okunamadı.");
  }

  let ozelAnahtar;
  try {
    const duz = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64coz(satir.iv), additionalData: aad }, kasa, b64coz(satir.sarili_ozel_anahtar));
    ozelAnahtar = await crypto.subtle.importKey("pkcs8", duz, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["decrypt"]);
  } catch {
    // Worker kasa anahtarı sarmalı açamadı. Önce bu cihazda hatırlanan anahtar, sonra kurtarma parolası yolu.
    const yerel = await cihazAnahtariniOku(uid);
    if (yerel) { anahtarOnbellek = { uid, ozel: yerel, acik: satir.acik_anahtar }; return anahtarOnbellek; }
    throw new E2EEKilitHatasi("Özel anahtar açılamadı (kasa anahtarı değişmiş olabilir).", { kurtarmaVar: !!satir.kurtarma_sarili_ozel_anahtar });
  }
  anahtarOnbellek = { uid, ozel: ozelAnahtar, acik: satir.acik_anahtar };
  return anahtarOnbellek;
}

/* ------------------------- KURTARMA PAROLASI ------------------------- */

const ozelImport = (pkcs8) => crypto.subtle.importKey("pkcs8", pkcs8, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["decrypt"]);

/** PBKDF2-SHA256(parola, tuz, tur) → AES-GCM-256 (yalnızca şifrele/çöz). Mesaj yedeği de aynı türetmeyi kullanır. */
export async function parolaAnahtariTuret(parola, tuzU8, tur = KURTARMA_KDF_TUR, kullanim = ["encrypt", "decrypt"]) {
  const malzeme = await crypto.subtle.importKey("raw", enc.encode(String(parola).normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: tuzU8, iterations: tur }, malzeme, { name: "AES-GCM", length: 256 }, false, kullanim);
}
export const b64Kodla = b64;
export const b64Coz = b64coz;
export const rastgele = (n) => crypto.getRandomValues(new Uint8Array(n));

/** Anahtar kaydının durumu (ağ: 1 RPC). { var, kurtarma_var, kurtarma_at } */
export async function anahtarDurumu() {
  const { data, error } = await supabase.rpc("e2ee_durum");
  if (error) throw new Error(/does not exist|PGRST202|42883|schema cache/i.test(error.message || "") ? "0095 numaralı migration henüz çalıştırılmamış." : error.message);
  return data || { var: false, kurtarma_var: false };
}

/** Worker kasa anahtarıyla sarılı özel anahtarı (PKCS8) YEREL olarak açar; çağıran işini bitirince referansı bırakmalıdır. */
async function pkcs8Al(session) {
  const uid = session.user.id;
  const kasa = await kasaAnahtariniAl(session);
  const { data: s } = await supabase.from("e2ee_kullanici_anahtarlari").select("sarili_ozel_anahtar, iv").eq("kullanici_id", uid).maybeSingle();
  if (!s) throw new Error("Anahtar kaydı bulunamadı.");
  try { return await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64coz(s.iv), additionalData: enc.encode(uid) }, kasa, b64coz(s.sarili_ozel_anahtar)); }
  catch { throw new E2EEKilitHatasi("Özel anahtar açılamadı (kasa anahtarı değişmiş olabilir)."); }
}

/** Anahtar şu an açılabiliyorken kurtarma parolasını belirler/değiştirir. Sunucuya yalnızca SARILI blob gider. */
export async function kurtarmaParolasiBelirle(parola) {
  if (typeof parola !== "string" || parola.length < KURTARMA_PAROLA_MIN) throw new Error(`Kurtarma parolası en az ${KURTARMA_PAROLA_MIN} karakter olmalı.`);
  const session = await jwt();
  await anahtarlariHazirla(); // kayıt yoksa oluşturur; açılamıyorsa E2EEKilitHatasi fırlatır
  const pkcs8 = await pkcs8Al(session);
  const tuz = rastgele(16); const iv = rastgele(12);
  const k = await parolaAnahtariTuret(parola, tuz);
  const sarili = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(session.user.id) }, k, pkcs8);
  const { error } = await supabase.rpc("e2ee_kurtarma_kaydet", { p_sarili: b64(sarili), p_iv: b64(iv), p_tuz: b64(tuz), p_tur: KURTARMA_KDF_TUR });
  if (error) throw new Error(error.message);
}

/** Kurtarma parolasıyla özel anahtarı AÇAR (başka cihaz / gizli sekme / Worker sırrı değişmiş durum) ve Worker sarmalını onarır. */
export async function kurtarmaParolasiylaAc(parola, { cihazdaHatirla = false } = {}) {
  const session = await jwt();
  const uid = session.user.id;
  const { data: s, error } = await supabase.from("e2ee_kullanici_anahtarlari")
    .select("acik_anahtar, kurtarma_sarili_ozel_anahtar, kurtarma_iv, kurtarma_tuz, kurtarma_kdf_tur").eq("kullanici_id", uid).maybeSingle();
  if (error) throw new Error("Anahtar kaydı okunamadı.");
  if (!s?.kurtarma_sarili_ozel_anahtar) throw new Error("Bu hesapta kurtarma parolası tanımlı değil.");
  let pkcs8;
  try {
    const k = await parolaAnahtariTuret(parola, b64coz(s.kurtarma_tuz), s.kurtarma_kdf_tur || KURTARMA_KDF_TUR);
    pkcs8 = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64coz(s.kurtarma_iv), additionalData: enc.encode(uid) }, k, b64coz(s.kurtarma_sarili_ozel_anahtar));
  } catch { throw new Error("Hatalı kurtarma parolası."); }
  const ozel = await ozelImport(pkcs8);
  anahtarOnbellek = { uid, ozel, acik: s.acik_anahtar };
  if (cihazdaHatirla) await cihazAnahtariniKaydet(uid, ozel);
  // KENDİNİ ONARMA: Worker kasa anahtarıyla yeniden sar (başarısız olursa oturum yine de açık kalır).
  let onarildi = false;
  try {
    const kasa = await kasaAnahtariniAl(session);
    const iv = rastgele(12);
    const yeni = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(uid) }, kasa, pkcs8);
    const { error: e2 } = await supabase.rpc("e2ee_kasa_sarmalini_yenile", { p_sarili: b64(yeni), p_iv: b64(iv) });
    onarildi = !e2;
  } catch { /* kasa anahtarı alınamadı: sorun değil, parola yolu çalışmaya devam eder */ }
  return { onarildi };
}

/** SON ÇARE (kurtarma parolası yok): yeni anahtar çifti. Eski sohbet anahtar zarfları silinir; karşı taraf geçmişi yeniden paylaşır. */
export async function anahtariSifirla() {
  const session = await jwt();
  const uid = session.user.id;
  const kasa = await kasaAnahtariniAl(session);
  const cift = await crypto.subtle.generateKey(RSA, true, ["encrypt", "decrypt"]);
  const acik = await crypto.subtle.exportKey("spki", cift.publicKey);
  const ozel = await crypto.subtle.exportKey("pkcs8", cift.privateKey);
  const iv = rastgele(12);
  const sarili = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(uid) }, kasa, ozel);
  const { data, error } = await supabase.rpc("e2ee_anahtari_sifirla", { p_acik: b64(acik), p_sarili: b64(sarili), p_iv: b64(iv) });
  if (error) throw new Error(error.message);
  anahtarOnbellek = { uid, ozel: await ozelImport(ozel), acik: b64(acik) };
  await cihazAnahtariniSil(uid);
  return data;
}

/* ---- "Bu cihazda hatırla": yalnızca ÇIKARILAMAZ CryptoKey, IndexedDB (düz metin anahtar baytı ASLA yazılmaz) ---- */
const IDB_AD = "aea_e2ee"; const IDB_DEPO = "anahtarlar";
const idbAc = () => new Promise((coz, red) => {
  if (!("indexedDB" in window)) return red(new Error("IndexedDB yok"));
  const r = indexedDB.open(IDB_AD, 1);
  r.onupgradeneeded = () => r.result.createObjectStore(IDB_DEPO);
  r.onsuccess = () => coz(r.result); r.onerror = () => red(r.error);
});
const idbIs = async (mod, fn) => { const db = await idbAc(); try { return await new Promise((coz, red) => { const t = db.transaction(IDB_DEPO, mod); const s = fn(t.objectStore(IDB_DEPO)); t.oncomplete = () => coz(s?.result); t.onerror = () => red(t.error); }); } finally { db.close(); } };
async function cihazAnahtariniKaydet(uid, ozel) { try { await idbIs("readwrite", (s) => s.put(ozel, uid)); } catch { /* depo kapalı: hatırlama olmaz */ } }
async function cihazAnahtariniOku(uid) { try { return (await idbIs("readonly", (s) => s.get(uid))) || null; } catch { return null; } }
async function cihazAnahtariniSil(uid) { try { await idbIs("readwrite", (s) => s.delete(uid)); } catch { /* yok say */ } }
export const cihazAnahtariniUnut = async () => { const u = (await supabase.auth.getUser()).data?.user?.id; if (u) await cihazAnahtariniSil(u); };
export const cihazdaHatirlaniyorMu = async () => { const u = (await supabase.auth.getUser()).data?.user?.id; return !!(u && (await cihazAnahtariniOku(u))); };

/**
 * Panel AÇILIŞINDA çağrılır (dashboard.js): anahtar çifti yoksa oluşturur. KOTA: kaydı ÖNCE Supabase'ten kontrol eder; varsa
 * kasa anahtarı için Worker'a HİÇ gidilmez (eskiden her panel açılışı 1 Worker isteğiydi). Kasa anahtarı yalnızca gerçekten
 * gerektiğinde (dosya şifreleme/çözme → anahtarlariHazirla) Worker'dan alınır.
 */
export async function anahtarKaydiniSessizHazirla() {
  const session = await jwt();
  if (anahtarOnbellek?.uid === session.user.id) return true;
  const { data, error } = await supabase.from("e2ee_kullanici_anahtarlari")
    .select("kullanici_id").eq("kullanici_id", session.user.id).maybeSingle();
  if (!error && data) return true; // kayıt var: Worker'a gerek yok
  await anahtarlariHazirla();      // kayıt yok (ilk giriş) ya da okunamadı: tam hazırlık
  return true;
}

export function anahtarOnbellegiTemizle() { anahtarOnbellek = null; }

// Çıkış yapılınca bellekteki (çözülmüş) özel anahtar referansını bırak.
supabase.auth.onAuthStateChange((olay) => { if (olay === "SIGNED_OUT") { anahtarOnbellegiTemizle(); idbIs("readwrite", (s) => s.clear()).catch(() => {}); } });

/** Alıcı kullanıcıların açık anahtarlarını getirir; anahtarı olmayanları ayrıca döndürür. */
export async function aliciAnahtarlariniGetir(idler) {
  const { data, error } = await supabase.rpc("e2ee_acik_anahtarlar_getir", { p_ids: idler });
  if (error) throw new Error("Alıcı anahtarları alınamadı.");
  const harita = new Map(data.map((s) => [s.kullanici_id, s.acik_anahtar]));
  return { harita, eksik: idler.filter((id) => !harita.has(id)) };
}

/** Şifreli boyut = düz boyut + 12 (IV) + 16 (GCM etiketi). Worker'a bildirilen boyut budur. */
export const sifreliBoyut = (duzBoyut) => duzBoyut + 28;

/** Dosyayı rastgele AES-GCM anahtarıyla şifreler. Çıktı: Blob([iv | şifreli+etiket]) ve ham dosya anahtarı. */
export async function dosyaSifrele(dosya, kayitId) {
  const anahtar = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sifreli = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: enc.encode(kayitId) }, anahtar, await dosya.arrayBuffer());
  const hamAnahtar = await crypto.subtle.exportKey("raw", anahtar);
  return { blob: new Blob([iv, sifreli], { type: "application/octet-stream" }), hamAnahtar };
}

/** Ham dosya anahtarını bir alıcının açık anahtarıyla zarflar -> base64. */
export async function anahtariZarfla(hamAnahtar, acikAnahtarB64) {
  const acik = await crypto.subtle.importKey("spki", b64coz(acikAnahtarB64), { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
  return b64(await crypto.subtle.encrypt({ name: "RSA-OAEP" }, acik, hamAnahtar));
}

/** Şifreli bayt dizisini (iv | şifreli) kendi zarfımızla çözer -> ArrayBuffer. */
export async function dosyaCoz(sifreliBuf, zarfB64, kayitId) {
  const { ozel } = await anahtarlariHazirla();
  let ham;
  try { ham = await crypto.subtle.decrypt({ name: "RSA-OAEP" }, ozel, b64coz(zarfB64)); }
  catch { throw new Error("Dosya anahtarı açılamadı."); }
  const anahtar = await crypto.subtle.importKey("raw", ham, "AES-GCM", false, ["decrypt"]);
  const u8 = new Uint8Array(sifreliBuf);
  if (u8.length < 29) throw new Error("Şifreli dosya bozuk.");
  try {
    return await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: u8.subarray(0, 12), additionalData: enc.encode(kayitId) }, anahtar, u8.subarray(12));
  } catch {
    throw new Error("Dosya doğrulanamadı: bozulmuş ya da değiştirilmiş olabilir.");
  }
}

/**
 * Var olan bir dosyayı sonradan başkasıyla paylaşmak için: kendi zarfımızı açıp ham dosya
 * anahtarını yeni alıcının açık anahtarıyla yeniden zarflar (dosyanın kendisine dokunulmaz).
 */
export async function anahtariYenidenZarfla(kendiZarfB64, aliciAcikAnahtarB64) {
  const { ozel } = await anahtarlariHazirla();
  let ham;
  try { ham = await crypto.subtle.decrypt({ name: "RSA-OAEP" }, ozel, b64coz(kendiZarfB64)); }
  catch { throw new Error("Dosya anahtarı açılamadı."); }
  return anahtariZarfla(ham, aliciAcikAnahtarB64);
}

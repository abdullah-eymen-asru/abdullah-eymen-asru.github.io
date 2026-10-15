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
import * as Kasa from "../notlar/kasa.js";

/*
 * 2026-10 (migration 0096) — MESAJLAŞMA ANAHTARI GİRİŞ OTURUMUNA BAĞLANDI; ayrı "Kurtarma Parolası" kutusu KALDIRILDI.
 * ÖZEL ANAHTARIN ÜÇ (+1) KİLİDİ, açılış sırasıyla:
 *   1) DEK sarmalı  : Notlar kasasının DEK'i (giriş parolası → PBKDF2 → KEK → DEK; Google'da bağımsız Kasa Parolası) özel anahtarı sarar.
 *                     Kasa girişte sessizce açıldığı için mesajlar da AYNI ANDA açılır; Worker'a istek bile atılmaz.
 *   2) Worker sarmalı: Worker'ın kullanıcıya özel türettiği kasa anahtarı (eski/yedek yol). Kasa kilitliyken — özellikle Google hesaplarında,
 *                     giriş parolası olmadığından — mesajların kilitlenmemesini sağlar.
 *   3) Cihaz anahtarı: "bu cihazda hatırla" ile IndexedDB'de duran ÇIKARILAMAZ CryptoKey (eski kurtarma parolasıyla açıldıysa).
 *   +) Yedek Kurtarma Kodu (Kit): Notlar DEK'i + RSA özel anahtarı TEK blobda, kod-türevli anahtarla sarılı (kurtarma-kiti/kit.js).
 * ESKİ kurtarma parolası (0095) yalnızca onu daha önce belirlemiş hesapların verisi yetim kalmasın diye AÇMA yönünde korunur; yeni
 * parola belirlenemez.
 * NEDEN "OAuth BİLETİNDEN TÜRETİLEN ANAHTAR" YOK? Supabase/Google oturum belirteçleri (JWT, provider token) saatlik döner ve sunucu
 * tarafından görülebilir; onlardan türeyen anahtar ya her saat değişir ya da sunucunun da türetebildiği bir anahtardır (E2EE olmaz).
 * Bu yüzden Google hesapları Notlar'daki ÇÖZÜMÜN AYNISINI kullanır: bağımsız Kasa Parolası (parola_tur='kasa') + cihazda KEK önbelleği.
 */
export const KDF_TUR_VARSAYILAN = 600000;
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

let anahtarOnbellek = null; // { uid, ozel, acik }

async function kasaAnahtariniAl(session) {
  const r = await fetch(`${ARSIV_WORKER_URL}/kasa-anahtari`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
    cache: "no-store",
  });
  if (!r.ok) throw new Error("Kasa anahtarı alınamadı.");
  const { anahtar } = await r.json();
  return crypto.subtle.importKey("raw", b64coz(anahtar), "AES-GCM", false, ["encrypt", "decrypt"]);
}

const SATIR_KOLONLARI = "acik_anahtar, sarili_ozel_anahtar, iv, kurtarma_sarili_ozel_anahtar, dek_sarili_ozel_anahtar, dek_iv";
const DEK_ETIKET = "e2ee-ozel-anahtar";
const ozelImport = (pkcs8) => crypto.subtle.importKey("pkcs8", pkcs8, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["decrypt"]);

/** DEK sarmalından PKCS8 baytlarını açar (Notlar kasası AÇIKSA ve sarmal varsa); olmazsa null. */
async function pkcs8DekIle(satir) {
  if (!satir?.dek_sarili_ozel_anahtar || !Kasa.kasaAcikMi()) return null;
  try { return await Kasa.dekIleAc(satir.dek_sarili_ozel_anahtar, satir.dek_iv, DEK_ETIKET); } catch { return null; }
}
/** Worker kasa anahtarıyla sarılı PKCS8'i açar; Worker'a ulaşılamazsa { hata: "ag" }, sarmal açılamazsa null. */
async function pkcs8WorkerIle(session, satir) {
  let kasa;
  try { kasa = await kasaAnahtariniAl(session); } catch { return { hata: "ag" }; }
  try { return await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64coz(satir.iv), additionalData: enc.encode(session.user.id) }, kasa, b64coz(satir.sarili_ozel_anahtar)); }
  catch { return null; }
}

/** Notlar kasası açıkken özel anahtarı (varsa) DEK'e de sarar → bundan sonra mesajlar giriş oturumuyla açılır. Hata fırlatmaz. */
async function dekSarmaliniYaz(pkcs8) {
  try {
    if (!Kasa.kasaAcikMi()) return false;
    const { sarili, iv } = await Kasa.dekIleSar(pkcs8, DEK_ETIKET);
    const { error } = await supabase.rpc("e2ee_dek_sarmali_kaydet", { p_sarili: sarili, p_iv: iv });
    return !error;
  } catch { return false; }
}

/** Oturum açmış kullanıcının anahtarlarını hazırlar (yoksa oluşturur). Sessiz, kullanıcıdan hiçbir şey istemez. */
export async function anahtarlariHazirla() {
  const session = await jwt();
  const uid = session.user.id;
  if (anahtarOnbellek?.uid === uid) return anahtarOnbellek;

  const oku = () => supabase.from("e2ee_kullanici_anahtarlari").select(SATIR_KOLONLARI).eq("kullanici_id", uid).maybeSingle();
  let { data: satir, error } = await oku();
  if (error && /dek_sarili|dek_iv|kurtarma_sarili|42703/.test(`${error.code} ${error.message}`)) {
    // 0096 henüz çalıştırılmamış: eski kolonlarla devam et (Worker yolu).
    ({ data: satir, error } = await supabase.from("e2ee_kullanici_anahtarlari").select("acik_anahtar, sarili_ozel_anahtar, iv").eq("kullanici_id", uid).maybeSingle());
  }
  if (error) throw new Error("Anahtar kaydı okunamadı.");

  // İLK KURULUM: anahtar çifti yok → üret. sarili_ozel_anahtar zorunlu kolon olduğundan Worker sarmalı yazılır; kasa açıksa DEK sarmalı da eklenir.
  if (!satir) {
    // Worker erişilemiyorsa anahtar üretimi DÜŞMESİN (yoksa kullanıcının açık anahtarı hiç oluşmaz → kimse ona zarf yazamaz):
    // atılan rastgele anahtarla sar (yer tutucu); asıl kilit hemen ardından yazılan DEK sarmalıdır.
    let kasa;
    try { kasa = await kasaAnahtariniAl(session); }
    catch { kasa = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt"]); }
    const cift = await crypto.subtle.generateKey(RSA, true, ["encrypt", "decrypt"]);
    const acik = await crypto.subtle.exportKey("spki", cift.publicKey);
    const ozel = await crypto.subtle.exportKey("pkcs8", cift.privateKey);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const sarili = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(uid) }, kasa, ozel);
    const { error: eklemeHatasi } = await supabase.from("e2ee_kullanici_anahtarlari").insert({
      kullanici_id: uid, acik_anahtar: b64(acik), sarili_ozel_anahtar: b64(sarili), iv: b64(iv),
    });
    ({ data: satir, error } = await oku()); // başka sekme aynı anda yazmış olabilir (PK çakışması) → kazananı oku
    if (error || !satir) throw new Error(eklemeHatasi ? "Anahtar kaydı yazılamadı." : "Anahtar kaydı okunamadı.");
    if (!eklemeHatasi) await dekSarmaliniYaz(ozel);
  }

  // 1) DEK sarmalı (giriş oturumuna bağlı yol — Worker'a istek yok)
  let pkcs8 = await pkcs8DekIle(satir);
  let workerAgHatasi = false;
  // 2) Worker kasa sarmalı (yedek yol)
  if (!pkcs8) {
    const w = await pkcs8WorkerIle(session, satir);
    if (w?.hata === "ag") workerAgHatasi = true;
    else if (w) {
      pkcs8 = w;
      // Sessiz geçiş: kasa açıksa ve DEK sarmalı henüz yoksa şimdi ekle (bir kez).
      if (!satir.dek_sarili_ozel_anahtar) dekSarmaliniYaz(pkcs8);
    }
  }
  if (pkcs8) {
    anahtarOnbellek = { uid, ozel: await ozelImport(pkcs8), acik: satir.acik_anahtar };
    return anahtarOnbellek;
  }
  // 3) Bu cihazda hatırlanan anahtar
  const yerel = await cihazAnahtariniOku(uid);
  if (yerel) { anahtarOnbellek = { uid, ozel: yerel, acik: satir.acik_anahtar }; return anahtarOnbellek; }

  const durum = { kurtarmaVar: !!satir.kurtarma_sarili_ozel_anahtar, notlarKilitli: !Kasa.kasaAcikMi(), dekSarmalVar: !!satir.dek_sarili_ozel_anahtar };
  // Worker'a hiç ulaşılamadı ve çözümü başka yol da yok: bu bir kilit değil, ağ sorunudur.
  if (workerAgHatasi && !durum.dekSarmalVar) throw new Error("Kasa anahtarı alınamadı.");
  console.info("[e2ee] özel anahtar açılamadı:", { ...durum, workerAgHatasi, kasaAcik: Kasa.kasaAcikMi() }); // teşhis (gizli veri yok)
  throw kilitHatasi(durum);
}
function kilitHatasi(durum) {
  return new E2EEKilitHatasi(
    durum.dekSarmalVar && durum.notlarKilitli
      ? "Mesajların anahtarı Notlar kasana bağlı; kasan bu cihazda kilitli."
      : "Özel anahtar açılamadı (kasa anahtarı değişmiş olabilir).", durum);
}

/**
 * Notlar kasası AÇILDIKTAN sonra çağrılır (girişte sessiz açma, Notlar kilidi, Kit ile kurtarma): özel anahtar henüz DEK'e sarılı
 * değilse sarar. Kasa kilitliyse ya da anahtar açılamıyorsa sessizce false döner.
 */
export async function anahtariGirisaBagla() {
  try {
    if (!Kasa.kasaAcikMi()) return false;
    const session = await jwt();
    const { data: satir } = await supabase.from("e2ee_kullanici_anahtarlari").select(SATIR_KOLONLARI).eq("kullanici_id", session.user.id).maybeSingle();
    if (!satir || satir.dek_sarili_ozel_anahtar) return !!satir;
    const pkcs8 = await ozelAnahtarPkcs8().catch(() => null);
    return pkcs8 ? await dekSarmaliniYaz(pkcs8) : false;
  } catch { return false; }
}

/** Panel açılışında (dashboard.js): Notlar kasasını sessizce aç ve mesajlaşma anahtarını bağla. Hiçbir şey sormaz, hata fırlatmaz. */
export async function girisOturumunaBagla() {
  try {
    const session = await jwt();
    if (await Kasa.kasaSessizAc(session)) await anahtariGirisaBagla();
  } catch { /* kasa/ağ hazır değil: mesajlar Worker yoluyla açılmaya devam eder */ }
}

/** Özel anahtarın PKCS8 baytları (Kit oluşturma / yeniden zarflama için). Çağıran işini bitince .fill(0) yapmalıdır. */
export async function ozelAnahtarPkcs8() {
  const session = await jwt();
  const { data: satir } = await supabase.from("e2ee_kullanici_anahtarlari").select(SATIR_KOLONLARI).eq("kullanici_id", session.user.id).maybeSingle();
  if (!satir) throw new Error("Anahtar kaydı bulunamadı.");
  const d = await pkcs8DekIle(satir);
  if (d) return new Uint8Array(d);
  const w = await pkcs8WorkerIle(session, satir);
  if (w && !w.hata) return new Uint8Array(w);
  throw new E2EEKilitHatasi("Özel anahtar açılamadı.", { kurtarmaVar: !!satir.kurtarma_sarili_ozel_anahtar, notlarKilitli: !Kasa.kasaAcikMi(), dekSarmalVar: !!satir.dek_sarili_ozel_anahtar });
}

/**
 * Kit/yeniden zarflama sonrası: çözülmüş PKCS8'i bu oturumun anahtarı yapar ve (kasa açıksa) DEK'e, (Worker erişilebiliyorsa)
 * Worker kasa anahtarına yeniden sarar → bozuk sarmallar kendini onarır.
 */
export async function ozelAnahtariIceAktar(pkcs8, { cihazdaHatirla = false } = {}) {
  const session = await jwt();
  const uid = session.user.id;
  const ozel = await ozelImport(pkcs8);
  const { data: s } = await supabase.from("e2ee_kullanici_anahtarlari").select("acik_anahtar").eq("kullanici_id", uid).maybeSingle();
  anahtarOnbellek = { uid, ozel, acik: s?.acik_anahtar };
  if (cihazdaHatirla) await cihazAnahtariniKaydet(uid, ozel);
  const dekYazildi = await dekSarmaliniYaz(pkcs8);
  let workerOnarildi = false;
  try {
    const kasa = await kasaAnahtariniAl(session);
    const iv = rastgele(12);
    const yeni = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(uid) }, kasa, pkcs8);
    const { error } = await supabase.rpc("e2ee_kasa_sarmalini_yenile", { p_sarili: b64(yeni), p_iv: b64(iv) });
    workerOnarildi = !error;
  } catch { /* Worker yoksa sorun değil */ }
  return { onarildi: dekYazildi || workerOnarildi };
}

/* ------------------------- KURTARMA PAROLASI ------------------------- */

/** PBKDF2-SHA256(parola, tuz, tur) → AES-GCM-256 (yalnızca şifrele/çöz). Mesaj yedeği de aynı türetmeyi kullanır. */
export async function parolaAnahtariTuret(parola, tuzU8, tur = KURTARMA_KDF_TUR, kullanim = ["encrypt", "decrypt"]) {
  const malzeme = await crypto.subtle.importKey("raw", enc.encode(String(parola).normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: tuzU8, iterations: tur }, malzeme, { name: "AES-GCM", length: 256 }, false, kullanim);
}
export const b64Kodla = b64;
export const b64Coz = b64coz;
export const rastgele = (n) => crypto.getRandomValues(new Uint8Array(n));

/** Anahtar kaydının durumu (ağ: 1 RPC). { var, kurtarma_var (ESKİ parola), dek_var, kit_var, kit_at } */
export async function anahtarDurumu() {
  const { data, error } = await supabase.rpc("e2ee_durum");
  if (error) throw new Error(/does not exist|PGRST202|42883|schema cache/i.test(error.message || "") ? "0096 numaralı migration henüz çalıştırılmamış." : error.message);
  return data || { var: false, kurtarma_var: false, kit_var: false };
}

/**
 * ESKİ kurtarma parolasıyla (0095) özel anahtarı AÇAR. YENİ parola belirlenemez; bu yol yalnızca daha önce parola koymuş hesaplar içindir.
 * Açılan anahtar DEK'e/Worker'a yeniden sarılır (kendini onarma).
 */
export async function kurtarmaParolasiylaAc(parola, { cihazdaHatirla = false } = {}) {
  const session = await jwt();
  const uid = session.user.id;
  const { data: s, error } = await supabase.from("e2ee_kullanici_anahtarlari")
    .select("acik_anahtar, kurtarma_sarili_ozel_anahtar, kurtarma_iv, kurtarma_tuz, kurtarma_kdf_tur").eq("kullanici_id", uid).maybeSingle();
  if (error) throw new Error("Anahtar kaydı okunamadı.");
  if (!s?.kurtarma_sarili_ozel_anahtar) throw new Error("Bu hesapta eski kurtarma parolası tanımlı değil.");
  let pkcs8;
  try {
    const k = await parolaAnahtariTuret(parola, b64coz(s.kurtarma_tuz), s.kurtarma_kdf_tur || KURTARMA_KDF_TUR);
    pkcs8 = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64coz(s.kurtarma_iv), additionalData: enc.encode(uid) }, k, b64coz(s.kurtarma_sarili_ozel_anahtar));
  } catch { throw new Error("Hatalı kurtarma parolası."); }
  return ozelAnahtariIceAktar(new Uint8Array(pkcs8), { cihazdaHatirla });
}

/** SON ÇARE (kurtarma parolası yok): yeni anahtar çifti. Eski sohbet anahtar zarfları silinir; karşı taraf geçmişi yeniden paylaşır. */
export async function anahtariSifirla() {
  const session = await jwt();
  const uid = session.user.id;
  // Worker erişilemiyorsa sıfırlama DÜŞMESİN: atılan rastgele anahtarla sar (yer tutucu; asıl kilit DEK sarmalıdır).
  let kasa;
  try { kasa = await kasaAnahtariniAl(session); }
  catch { kasa = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt"]); }
  const cift = await crypto.subtle.generateKey(RSA, true, ["encrypt", "decrypt"]);
  const acik = await crypto.subtle.exportKey("spki", cift.publicKey);
  const ozel = await crypto.subtle.exportKey("pkcs8", cift.privateKey);
  const iv = rastgele(12);
  const sarili = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(uid) }, kasa, ozel);
  const { data, error } = await supabase.rpc("e2ee_anahtari_sifirla", { p_acik: b64(acik), p_sarili: b64(sarili), p_iv: b64(iv) });
  if (error) throw new Error(error.message);
  anahtarOnbellek = { uid, ozel: await ozelImport(ozel), acik: b64(acik) };
  await cihazAnahtariniSil(uid);
  await dekSarmaliniYaz(new Uint8Array(ozel)); // kasa açıksa yeni anahtar da giriş oturumuna bağlansın
  return data;
}

/**
 * OTOMATİK ONARIM (2026-10): Kullanıcı kasasını kendi parolasıyla açtı (kimliğini kanıtladı) ama mesaj özel anahtarı hiçbir sarmalla
 * (DEK / Worker / cihaz) açılamıyor. Bu, çoğunlukla ESKİ bir kurulumdan kalan bozuk sarmal demektir ve kurtarılacak bir şey yoksa
 * kullanıcıyı "Yedek Kurtarma Kodu" sormakla yormanın anlamı yok.
 *   GÜVENLİ KOŞUL: bu kullanıcıya zarflanmış HİÇ sohbet anahtarı (konusma_zarflari) ve HİÇ özel dosya anahtarı (ozel_icerik_anahtarlar)
 *   yoksa eski anahtarla çözülecek hiçbir veri yoktur → yeni RSA çifti üretilir, DEK'e (ve erişilebiliyorsa Worker'a) sarılır.
 *   Zarf varsa ASLA otomatik sıfırlanmaz (veri kaybı olurdu) → { onarildi: false, neden: "zarf-var" }; arayüz kurtarma koduna yönlendirir.
 * Dönüş: { onarildi: boolean, neden?: string }. Hata fırlatmaz.
 */
export async function anahtariOtomatikOnar() {
  try {
    if (!Kasa.kasaAcikMi()) return { onarildi: false, neden: "kasa-kilitli" };
    const session = await jwt();
    const uid = session.user.id;
    const say = async (tablo, kolon) => {
      const { count, error } = await supabase.from(tablo).select(kolon, { count: "exact", head: true }).eq(kolon, uid);
      if (error) throw error;
      return count || 0;
    };
    const zarf = await say("konusma_zarflari", "user_id");
    let dosya = 0;
    try { dosya = await say("ozel_icerik_anahtarlar", "alici_id"); } catch { /* tablo yoksa sorun değil */ }
    if (zarf > 0 || dosya > 0) return { onarildi: false, neden: "zarf-var" };

    const cift = await crypto.subtle.generateKey(RSA, true, ["encrypt", "decrypt"]);
    const acik = await crypto.subtle.exportKey("spki", cift.publicKey);
    const ozel = await crypto.subtle.exportKey("pkcs8", cift.privateKey);
    // sarili_ozel_anahtar kolonu NOT NULL: Worker erişilebiliyorsa onunla sar (yedek yol çalışsın); erişilemiyorsa atılan rastgele
    // anahtarla sar (hiç açılmayacak bir yer tutucu; asıl kilit DEK sarmalıdır ve hemen aşağıda yazılır).
    let sarmaAnahtari;
    try { sarmaAnahtari = await kasaAnahtariniAl(session); }
    catch { sarmaAnahtari = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt"]); }
    const iv = rastgele(12);
    const sarili = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(uid) }, sarmaAnahtari, ozel);
    const { error } = await supabase.rpc("e2ee_anahtari_sifirla", { p_acik: b64(acik), p_sarili: b64(sarili), p_iv: b64(iv) });
    if (error) return { onarildi: false, neden: error.message || "sunucu" };

    anahtarOnbellek = { uid, ozel: await ozelImport(ozel), acik: b64(acik) };
    await cihazAnahtariniSil(uid);
    const dekYazildi = await dekSarmaliniYaz(new Uint8Array(ozel));
    return { onarildi: dekYazildi, neden: dekYazildi ? undefined : "dek-yazilamadi" };
  } catch (er) { return { onarildi: false, neden: er?.message || "hata" }; }
}

/**
 * Yüklü özel anahtar, sunucudaki açık anahtarımla GERÇEKTEN eşleşiyor mu? (rastgele 32 bayt: açık anahtarla şifrele → özelle çöz)
 * Bir sohbet zarfı açılamadığında "zarf bayat mı (başka/eski açık anahtarla şifrelenmiş), yoksa yanlış anahtar mı yüklü?" ayrımı içindir.
 */
export async function anahtarCiftiTutarliMi() {
  try {
    const { ozel, acik } = await anahtarlariHazirla();
    if (!acik) return false;
    const pub = await crypto.subtle.importKey("spki", b64coz(acik), { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
    const m = rastgele(32);
    const c = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, pub, m);
    const d = new Uint8Array(await crypto.subtle.decrypt({ name: "RSA-OAEP" }, ozel, c));
    return d.length === 32 && d.every((v, i) => v === m[i]);
  } catch { return false; }
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

// Notlar kasası (giriş parolası / Kasa Parolası / Kit) HERHANGİ bir yoldan açıldığında mesaj anahtarını aynı DEK'e bağla (bir kez, sessiz).
if (typeof window !== "undefined") window.addEventListener("aea:kasa-acildi", () => { anahtariGirisaBagla(); });

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

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
    throw new Error("Özel anahtar açılamadı (kasa anahtarı değişmiş olabilir).");
  }
  anahtarOnbellek = { uid, ozel: ozelAnahtar, acik: satir.acik_anahtar };
  return anahtarOnbellek;
}

export function anahtarOnbellegiTemizle() { anahtarOnbellek = null; }

// Çıkış yapılınca bellekteki (çözülmüş) özel anahtar referansını bırak.
supabase.auth.onAuthStateChange((olay) => { if (olay === "SIGNED_OUT") anahtarOnbellegiTemizle(); });

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

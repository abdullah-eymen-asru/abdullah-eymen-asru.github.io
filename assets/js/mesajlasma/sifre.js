/*
 * assets/js/mesajlasma/sifre.js — mesajlaşma uçtan uca şifreleme (SubtleCrypto, bağımlılıksız).
 * MİMARİ: sohbet başına rastgele AES-GCM-256 anahtarı. Anahtar, sohbete erişebilen herkesin RSA-OAEP açık anahtarıyla
 * zarflanır (konusma_zarflari). Kişisel RSA anahtar çifti mevcut e2ee.js altyapısıdır (özel anahtar kasa anahtarıyla sarılı).
 * Mesaj gövdesi: base64(iv[12] | AES-GCM(şifreli+etiket)), AAD = sohbet kimliği (mesaj başka sohbete taşınamaz).
 * Konu: AAD = "konu".
 * BELLEK: çözülmüş sohbet anahtarları yalnızca bu modülün Map'inde durur; çıkışta ve sayfadan ayrılırken temizlenir.
 * GÜVEN MODELİ (dürüst): e2ee.js ile aynı — kasa anahtarını türeten Worker sırrı sahibi teknik olarak çözebilir.
 */
import { supabase } from "../core/supabase-client.js";
import { anahtarlariHazirla, aliciAnahtarlariniGetir, anahtariZarfla, anahtarCiftiTutarliMi } from "../r2-arsiv/e2ee.js";

const enc = new TextEncoder();
const dec = new TextDecoder();
const ANAHTARLAR = new Map(); // sohbetId -> CryptoKey
const ZARFLAR = new Map();    // sohbetId -> base64 zarf (benim)
const TAMAMLANAN = new Set(); // eksik zarf tamamlama denenen sohbetler (oturum başına bir kez)
const BOZUK = new Set();      // bayat zarfı temizlenmeye çalışılan sohbetler (oturum başına bir kez)

const b64 = (buf) => {
  const u8 = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
};
const b64coz = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function anahtarlariBirak() { ANAHTARLAR.clear(); ZARFLAR.clear(); TAMAMLANAN.clear(); BOZUK.clear(); }
supabase.auth.onAuthStateChange((o) => { if (o === "SIGNED_OUT") anahtarlariBirak(); });
window.addEventListener("pagehide", anahtarlariBirak);

/** Benim zarflarım: TEK sorgu (RLS: yalnızca kendi satırlarım). */
export async function zarflarimiYukle() {
  const { data, error } = await supabase.from("konusma_zarflari").select("conversation_id, zarf");
  if (error) throw error;
  ZARFLAR.clear();
  for (const z of data || []) ZARFLAR.set(z.conversation_id, z.zarf);
}
export const zarfimVarMi = (id) => ZARFLAR.has(id);

/** Özel anahtarın AÇILABİLİR olduğunu doğrular; açılamıyorsa E2EEKilitHatasi fırlatır (arayüz kurtarma panelini gösterir). */
export async function anahtarHazirMi() { await anahtarlariHazirla(); return true; }

export async function sohbetAnahtari(id) {
  if (ANAHTARLAR.has(id)) return ANAHTARLAR.get(id);
  const zarf = ZARFLAR.get(id);
  if (!zarf) return null;
  const { ozel } = await anahtarlariHazirla(); // açılamazsa E2EEKilitHatasi yukarı fırlar (sessiz null DEĞİL)
  let ham;
  try { ham = await crypto.subtle.decrypt({ name: "RSA-OAEP" }, ozel, b64coz(zarf)); } catch { await bayatZarfiTemizle(id); return null; }
  const k = await crypto.subtle.importKey("raw", ham, "AES-GCM", true, ["encrypt", "decrypt"]);
  ANAHTARLAR.set(id, k);
  return k;
}

/**
 * KENDİNİ ONARMA: zarfım VAR ama özel anahtarımla açılmıyorsa zarf BAYAT'tır (anahtarım sonradan yenilendi; zarf eski açık anahtarla
 * şifrelenmişti). Zarf satırı "var" göründüğü için karşı taraf onu hiç yeniden paylaşmıyordu → sonsuza kadar "anahtar yok".
 * Çözüm: anahtar çiftimin tutarlı olduğu doğrulanırsa (yanlış anahtar yüklü değilse) bayat zarfı sil → sohbet "eksik zarf" olur ve
 * anahtarı bilen taraf sohbeti açınca yeni açık anahtarıma göre otomatik yeniden paylaşır. Oturumda sohbet başına bir kez; hata yutulur.
 */
async function bayatZarfiTemizle(id) {
  if (BOZUK.has(id)) return; BOZUK.add(id);
  try {
    if (!(await anahtarCiftiTutarliMi())) return; // yanlış/başka anahtar yüklü olabilir: zarfa DOKUNMA
    const { data, error } = await supabase.rpc("mesaj_bayat_zarfi_temizle", { p_id: id });
    if (!error && data) { ZARFLAR.delete(id); TAMAMLANAN.delete(id); }
  } catch { /* migration 0098 yoksa ya da ağ yoksa sessiz */ }
}

export const yeniSohbetAnahtari = () => crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
export function anahtariKaydet(id, key, zarfB64) { ANAHTARLAR.set(id, key); if (zarfB64) ZARFLAR.set(id, zarfB64); }

/** idler için zarf üretir (açık anahtarı olmayanlar `eksik`te döner; onlara sonradan tamamlanır). */
export async function zarflariHazirla(key, idler) {
  const { harita, eksik } = await aliciAnahtarlariniGetir(idler);
  const ham = await crypto.subtle.exportKey("raw", key);
  const zarflar = [];
  for (const [uid, acik] of harita) zarflar.push({ user_id: uid, zarf: await anahtariZarfla(ham, acik) });
  return { zarflar, eksik };
}

export async function sifrele(key, metin, aad) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(aad) }, key, enc.encode(metin));
  const hepsi = new Uint8Array(12 + ct.byteLength);
  hepsi.set(iv, 0); hepsi.set(new Uint8Array(ct), 12);
  return b64(hepsi);
}

/** Çözülemezse null döner (asla fırlatmaz: tek bozuk mesaj listeyi düşürmesin). */
export async function coz(key, b64s, aad) {
  if (!key) return null;
  try {
    const u8 = b64coz(b64s);
    const duz = await crypto.subtle.decrypt({ name: "AES-GCM", iv: u8.subarray(0, 12), additionalData: enc.encode(aad) }, key, u8.subarray(12));
    return dec.decode(duz);
  } catch { return null; }
}

/** Anahtarı bilen kişi, sonradan yetkili olan / anahtarı geç oluşan kişilerin zarfını tamamlar (oturumda sohbet başına 1 kez). */
export async function eksikZarflariTamamla(id) {
  if (TAMAMLANAN.has(id)) return;
  TAMAMLANAN.add(id);
  try {
    const key = await sohbetAnahtari(id);
    if (!key) return;
    const { data: eksik, error } = await supabase.rpc("mesaj_eksik_zarflar", { p_id: id });
    if (error || !eksik?.length) return;
    const { zarflar } = await zarflariHazirla(key, eksik);
    if (zarflar.length) await supabase.rpc("mesaj_zarf_ekle", { p_id: id, p_zarflar: zarflar });
  } catch { /* best-effort */ }
}

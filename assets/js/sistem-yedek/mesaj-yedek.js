/*
 * assets/js/sistem-yedek/mesaj-yedek.js — PAROLALI MESAJ YEDEĞİ (evrensel içe aktarma).   [2026-10, migration 0095]
 * DIŞA AKTARMA: kullanıcının erişebildiği şifreli sohbetler tarayıcıda çözülür; her sohbetin düz içeriği, kullanıcının 16 haneli YEDEK KURTARMA KODUNDAN
 *   (Notlar + Mesajlar için TEK kod; PBKDF2-SHA256 600k + AES-GCM-256) türetilen anahtarla YENİDEN şifrelenip tek JSON dosyasına yazılır
 *   (mesajlar/mesajlarim.parolali.json). AYRI "yedekleme parolası" YOKTUR; kod hesabın kayıtlı kit'ine karşı doğrulanır. (Eski sürümün parolalı
 *   dosyaları hâlâ açılır.) Dosya sistem anahtarlarından BAĞIMSIZDIR → başka e-posta/hesap, sıfırlanmış veritabanı veya farklı altyapıya taşınabilir.
 * İÇE AKTARMA: parola girilir → çözülür → her sohbet için YENİ sohbet anahtarı üretilir, hedef hesabın AÇIK anahtarıyla YENİDEN ZARFLANIR
 *   (konusma_zarflari) ve mesajlar bu anahtarla yeniden şifrelenip mesaj_yedek_ice_aktar RPC'siyle yazılır (arşiv sohbeti; yinelenmez).
 * Parola yedek dosyasında YOK; unutulursa kimse çözemez (sıfır-bilgi).
 */
import { supabase } from "../core/supabase-client.js";
import { parolaAnahtariTuret, b64Kodla, b64Coz, rastgele, KURTARMA_KDF_TUR } from "../r2-arsiv/e2ee.js";
import * as V from "../mesajlasma/veri.js";
import * as S from "../mesajlasma/sifre.js";
import { kodAyristir, kodBicimle, kitSatiriniAc } from "../kurtarma-kiti/kit.js";

export const MESAJ_YEDEK_YOLU = "mesajlar/mesajlarim.parolali.json";
export const YEDEK_PAROLA_MIN = 10;
const enc = new TextEncoder(); const dec = new TextDecoder();
const SURUM = 1;
/** Yeni biçim: dosya, kullanıcının 16 haneli Yedek Kurtarma Koduyla (XXXX-XXXX-XXXX-XXXX) şifrelenir; ayrı "yedekleme parolası" YOKTUR. */
export const KOD_TURU = "kurtarma-kodu";

/** Kodu hesabın kayıtlı kit'ine karşı DOĞRULAR (yanlış kodla yedek alıp sonradan açamama kazasını önler). Başarıda kanonik kodu döner. */
export async function mesajKodunuDogrula(kodMetni) {
  kodAyristir(kodMetni);                                   // biçim: 16 karakter, geçerli alfabe
  const { data: o } = await supabase.auth.getUser();
  const { data: satir, error } = await supabase.from("e2ee_kullanici_anahtarlari")
    .select("kullanici_id, kit_sarili, kit_iv, kit_tuz, kit_kdf_tur").eq("kullanici_id", o.user.id).maybeSingle();
  if (error) throw new Error("Anahtar kaydı okunamadı.");
  if (!satir?.kit_sarili) throw new Error("Bu hesapta henüz Yedek Kurtarma Kodu üretilmemiş. Önce Notlar ya da Mesajlar kilit panelinden kod üret.");
  const k = await kitSatiriniAc(satir, kodMetni);          // yanlışsa KitHatasi("Kod yanlış…")
  k.dek?.fill(0); k.rsa?.fill(0);
  return kodBicimle(kodMetni);
}

async function sifreleJson(k, nesne, aad) {
  const iv = rastgele(12);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(aad) }, k, enc.encode(JSON.stringify(nesne)));
  const b = new Uint8Array(12 + ct.byteLength); b.set(iv, 0); b.set(new Uint8Array(ct), 12); return b64Kodla(b);
}
async function cozJson(k, b64s, aad) {
  const u = b64Coz(b64s);
  return JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: u.subarray(0, 12), additionalData: enc.encode(aad) }, k, u.subarray(12))));
}

/** Parolalı yedek JSON metnini üretir. ilerleme(m) isteğe bağlı. */
export async function mesajYedegiOlustur(parola, ilerleme = () => {}, { kodlu = false } = {}) {
  if (kodlu) kodAyristir(parola);
  else if (typeof parola !== "string" || parola.length < YEDEK_PAROLA_MIN) throw new Error(`Yedekleme güvenlik parolası en az ${YEDEK_PAROLA_MIN} karakter olmalı.`);
  const sohbetler = await V.sohbetleriYukle();
  const tuz = rastgele(16);
  const k = await parolaAnahtariTuret(parola, tuz, KURTARMA_KDF_TUR);
  const kimlik = (await supabase.auth.getUser()).data.user.id;
  const cikti = [];
  let n = 0;
  for (const c of sohbetler) {
    ilerleme(`Sohbet ${++n}/${sohbetler.length} hazırlanıyor…`);
    const msjlar = await V.mesajlariYukle(c);
    const duz = { konu: c.konu_gosterim, grup: !!c.grup, olusturma: c.created_at, mesajlar: msjlar.filter((m) => m.metin != null).map((m) => ({ g: m.sender_id, gad: m.gonderen?.ad || null, t: m.created_at, m: m.metin })) };
    cikti.push({ id: c.id, veri: await sifreleJson(k, duz, `sohbet:${c.id}`) });
  }
  return JSON.stringify({ tur: "aea-mesaj-yedegi", surum: SURUM, ...(kodlu ? { kod_turu: KOD_TURU } : {}), kdf: { ad: "PBKDF2-SHA256", tur: KURTARMA_KDF_TUR, tuz: b64Kodla(tuz) }, kaynak_kullanici: kimlik, olusturma: new Date().toISOString(), sohbetler: cikti });
}

export const mesajYedegiKodluMu = (nesne) => nesne?.kod_turu === KOD_TURU;
export function mesajYedegiMi(nesne) { return nesne && nesne.tur === "aea-mesaj-yedegi" && Array.isArray(nesne.sohbetler); }

/** Yedeği çözer, hedef hesabın anahtarına yeniden zarflayıp yazar. Dönüş: { sohbet, mesaj, atlanan } */
export async function mesajYedeginiIceAktar(nesne, parola, ilerleme = () => {}) {
  if (!mesajYedegiMi(nesne)) throw new Error("Bu dosya bir mesaj yedeği değil.");
  if (mesajYedegiKodluMu(nesne)) { kodAyristir(parola); parola = kodBicimle(parola); }   // kanonik "XXXX-XXXX-XXXX-XXXX"
  let k;
  try { k = await parolaAnahtariTuret(parola, b64Coz(nesne.kdf.tuz), nesne.kdf.tur || KURTARMA_KDF_TUR); } catch { throw new Error("Yedek dosyası bozuk."); }
  const sonuc = { sohbet: 0, mesaj: 0, atlanan: 0 };
  let n = 0;
  for (const s of nesne.sohbetler) {
    ilerleme(`Sohbet ${++n}/${nesne.sohbetler.length} içe aktarılıyor…`);
    let duz;
    try { duz = await cozJson(k, s.veri, `sohbet:${s.id}`); } catch { throw new Error(mesajYedegiKodluMu(nesne) ? "Kod bu yedeği açmıyor (yanlış kod ya da dosya değiştirilmiş)." : "Hatalı yedekleme parolası (ya da dosya değiştirilmiş)."); }
    const r = await arsivSohbetiYaz({ kaynakId: s.id, konu: duz.konu, mesajlar: duz.mesajlar });
    if (!r.yeni) { sonuc.atlanan += 1; continue; }
    sonuc.sohbet += 1; sonuc.mesaj += r.mesaj;
  }
  return sonuc;
}

/**
 * ORTAK YENİDEN ZARFLAMA YAZICISI (parolalı mesaj yedeği + Kurtarma Kiti içe aktarması kullanır):
 * YENİ sohbet anahtarı üretir → HEDEF (şu an giriş yapmış) hesabın AÇIK anahtarıyla zarflar (konusma_zarflari) → konu ve mesajları bu
 * anahtarla (AAD = yeni sohbet kimliği) yeniden şifreleyip arşiv sohbeti olarak yazar. Aynı kaynak ikinci kez yinelenmez.
 * mesajlar: [{ g: gönderen uuid, t: ISO zaman, m: düz metin }]. Dönüş: { yeni, id, mesaj }.
 */
export async function arsivSohbetiYaz({ kaynakId, konu, mesajlar }) {
  const anahtar = await S.yeniSohbetAnahtari();
  const benim = (await supabase.auth.getUser()).data.user.id;
  const { zarflar } = await S.zarflariHazirla(anahtar, [benim]);
  if (!zarflar.length) throw new Error("Şifreleme anahtarın hazır değil; sayfayı yenileyip tekrar dene.");
  // AAD yeni sohbet kimliğine bağlı → önce boş arşiv sohbeti (RPC kaynağa göre yinelemeyi önler), sonra mesajlar yeni kimlikle şifrelenip eklenir.
  const konuSifreli = await S.sifrele(anahtar, konu || "Arşiv", "konu");
  const ilk = await supabase.rpc("mesaj_yedek_ice_aktar", { p_kaynak: kaynakId, p_konu_sifreli: konuSifreli, p_zarflar: zarflar, p_mesajlar: [] });
  if (ilk.error) throw new Error(ilk.error.message);
  if (!ilk.data?.yeni) return { yeni: false, id: ilk.data?.id, mesaj: 0 };
  const yeniId = ilk.data.id;
  S.anahtariKaydet(yeniId, anahtar, zarflar[0].zarf);
  const govdeler = [];
  for (const m of (mesajlar || []).slice(0, 3000)) govdeler.push({ gonderen: m.g, created_at: m.t, body: await S.sifrele(anahtar, m.m, yeniId) });
  const iki = await supabase.rpc("mesaj_yedek_mesaj_ekle", { p_id: yeniId, p_mesajlar: govdeler });
  if (iki.error) throw new Error(iki.error.message);
  return { yeni: true, id: yeniId, mesaj: govdeler.length };
}

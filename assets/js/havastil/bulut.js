/**
 * bulut.js — HavaStil isteğe bağlı bulut senkronu (migration 0099 + 0100 + 0101: havastil_konumlari / havastil_tercihleri).
 * BULUT ÖNCELİKLİ (v7, migration 0104): kullanıcı eşitlemeyi onayladıysa (ya da bulutta zaten kaydı varsa) konumlar hesabında tutulur; kapalıyken yalnızca cihazda durur. Eşitleme AÇIKKEN kaydettiği konumların adı (etiketi), yer adı, simgesi ve
 * koordinatı (v4: YUVARLANMADAN, numeric(9,6); migration 0101) RLS ile yalnızca kendi satırı olarak Supabase'e yazılır; kapatınca isteğe bağlı silinir.
 * Anlık GPS konumu ve arama metinleri ASLA kaydedilmez — yalnızca kullanıcının "⭐ Kaydet" dediği konumlar.
 * DB sütunu `ad` = kullanıcıya görünen isim (etiket, yoksa yer adı; kullanıcı başına benzersiz); `yer_adi` = coğrafi yer adı (yalnızca etiket farklıysa dolar).
 * Not: 0101 çalıştırılmadıysa yeni sütunlar yoktur; bu durumda yazma/okuma eski sütunlarla (geriye uyumlu) yapılır.
 */
import { supabase } from "../core/supabase-client.js";

const duz = (x) => Math.round(Number(x) * 1e6) / 1e6;
export const konumAnahtari = (k) => `${String(k.etiket || k.ad).trim().toLowerCase()}|${duz(k.lat)}|${duz(k.lon)}`;
const SUTUNLAR = "id, ad, yer_adi, enlem, boylam, ikon, ulke, admin1, ilce, mahalle, sokak";
const ESKI_SUTUNLAR = "id, ad, enlem, boylam, ikon, ulke, admin1, ilce";
const SIRALI_SUTUNLAR = `${SUTUNLAR}, sira`;       // migration 0104; yoksa sırasıyla SUTUNLAR → ESKI_SUTUNLAR'a düşülür
const sutunYok = (e) => /column|schema cache|42703|PGRST204|PGRST200/i.test(`${e?.code || ""} ${e?.message || ""}`);

const satirdanKonum = (r) => {
  const yer = r.yer_adi || r.ad;
  return { bid: r.id, ...(Number.isFinite(r.sira) ? { sira: r.sira } : {}), ad: yer, ...(r.yer_adi && r.yer_adi !== r.ad ? { etiket: r.ad } : {}), lat: Number(r.enlem), lon: Number(r.boylam), ikon: r.ikon || "diger", ...(r.ulke ? { ulke: r.ulke } : {}), ...(r.admin1 ? { admin1: r.admin1, il: r.ulke === "TR" ? r.admin1 : undefined } : {}), ...(r.ilce ? { ilce: r.ilce } : {}), ...(r.mahalle ? { mahalle: r.mahalle } : {}), ...(r.sokak ? { sokak: r.sokak } : {}) };
};
const konumdanSatir = (k, uid) => ({
  ...(uid ? { user_id: uid } : {}),
  ad: String(k.etiket || k.ad).trim().slice(0, 40), yer_adi: k.etiket ? String(k.ad).trim().slice(0, 60) : null,
  enlem: duz(k.lat), boylam: duz(k.lon), ikon: k.ikon || "diger",
  ulke: (k.ulke || "").slice(0, 2) || null, admin1: (k.admin1 || "").slice(0, 60) || null, ilce: (k.ilce || "").slice(0, 60) || null, mahalle: (k.mahalle || "").slice(0, 60) || null, sokak: (k.sokak || "").slice(0, 60) || null,
});
const eskiSatir = ({ yer_adi, mahalle, sokak, ...r }) => r;

export async function bulutKonumlariCek() {
  let error, data;
  for (const [sutun, sirali] of [[SIRALI_SUTUNLAR, true], [SUTUNLAR, false], [ESKI_SUTUNLAR, false]]) {
    let q = supabase.from("havastil_konumlari").select(sutun);
    if (sirali) q = q.order("sira", { ascending: true });
    ({ data, error } = await q.order("created_at", { ascending: true }));
    if (!error || !sutunYok(error)) break;
  }
  if (error) throw error;
  return (data || []).map(satirdanKonum);
}

/** Bulutta kayıt var mı? (Yeni cihazda önceki rızanın kanıtı: başka cihazdan ⭐ ile kaydedilmiş konum/tercih.) */
export async function bulutVarMi() {
  const a = await supabase.from("havastil_konumlari").select("id", { count: "exact", head: true });
  if (a.error) throw a.error;
  if ((a.count || 0) > 0) return true;
  const b = await supabase.from("havastil_tercihleri").select("user_id", { count: "exact", head: true });
  if (b.error) throw b.error;
  return (b.count || 0) > 0;
}

/** "İlk sıraya al" vb.: listedeki sıraya göre sira alanını yazar (yalnızca bid'i olanlar; migration 0104 yoksa sessizce atlanır). */
export async function bulutSiraYaz(liste) {
  const sirali = liste.filter((k) => k.bid);
  for (let i = 0; i < sirali.length; i++) {
    const { error } = await supabase.from("havastil_konumlari").update({ sira: i }).eq("id", sirali[i].bid);
    if (error) { if (sutunYok(error)) return; throw error; }
  }
}

export async function bulutKonumEkle(k) {
  const { data: o } = await supabase.auth.getSession();
  const uid = o?.session?.user?.id;
  if (!uid) throw new Error("Oturum yok.");
  const yaz = (satir) => supabase.from("havastil_konumlari").upsert(satir, { onConflict: "user_id,ad" }).select("id").single();
  let { data, error } = await yaz(konumdanSatir(k, uid));
  if (error && sutunYok(error)) ({ data, error } = await yaz(eskiSatir(konumdanSatir(k, uid))));
  if (error) throw error;
  return data.id;
}

/** Düzenleme: etiket / simge / koordinat güncellemesi → UPDATE (satır kimliği `bid` ile; RLS yalnızca sahibine izin verir). */
export async function bulutKonumGuncelle(bid, k) {
  const gun = (satir) => supabase.from("havastil_konumlari").update(satir).eq("id", bid).select("id").single();
  let { data, error } = await gun(konumdanSatir(k));
  if (error && sutunYok(error)) ({ data, error } = await gun(eskiSatir(konumdanSatir(k))));
  if (error) throw error;
  return data.id;
}

export async function bulutKonumSil(bid) {
  const { error } = await supabase.from("havastil_konumlari").delete().eq("id", bid);
  if (error) throw error;
}

export async function bulutTumunuSil() {
  const { data: o } = await supabase.auth.getSession();
  const uid = o?.session?.user?.id;
  if (!uid) return;
  await supabase.from("havastil_konumlari").delete().eq("user_id", uid);
  await supabase.from("havastil_tercihleri").delete().eq("user_id", uid);
}

export async function bulutTercihOku() {
  const { data, error } = await supabase.from("havastil_tercihleri").select("tolerans, senaryo, stil, canta").maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function bulutTercihYaz({ tolerans, senaryo, stil, canta }) {
  const { data: o } = await supabase.auth.getSession();
  const uid = o?.session?.user?.id;
  if (!uid) return;
  const { error } = await supabase.from("havastil_tercihleri").upsert({ user_id: uid, tolerans, senaryo, stil: stil || "auto", canta: canta || "el", updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) throw error;
}

/**
 * BULUT ÖNCELİKLİ eşitleme (oturum açıkken sayfa yüklenince / sekmeye dönünce):
 *  • Bulut = doğruluk kaynağı: sıra ve içerik bulutakini izler.
 *  • Yerelde `bid`i olup bulutta artık OLMAYAN kayıt başka cihazdan silinmiştir → yerelden de düşer.
 *  • `bid`i olmayan yerel kayıt (henüz yüklenmemiş / çevrimdışı eklenmiş) buluta yüklenir (aynı anahtar bulutta varsa bulut kopyası kullanılır). En çok 20.
 * @returns {{liste:object[], yuklenen:number, silinen:number}}
 */
export async function bulutEsitle(yerel) {
  const bulut = await bulutKonumlariCek();
  const bulutBid = new Set(bulut.map((k) => k.bid));
  const var_ = new Set(bulut.map(konumAnahtari));
  const silinen = yerel.filter((k) => k.bid && !bulutBid.has(k.bid)).length;
  const sonuc = [...bulut];
  let yuklenen = 0;
  for (const k of yerel) {
    if (k.bid || var_.has(konumAnahtari(k))) continue;
    if (sonuc.length >= 20) break;
    try { sonuc.push({ ...k, bid: await bulutKonumEkle(k) }); var_.add(konumAnahtari(k)); yuklenen++; } catch { /* ad çakışması vb.: atla */ }
  }
  return { liste: sonuc, yuklenen, silinen };
}

/** Eski ad (geriye uyum): ilk açılışta yerel + bulut birleşimi. */
export async function birlestir(yerel) { return (await bulutEsitle(yerel)).liste; }

/** Bulut hata kodu → kullanıcıya anlaşılır Türkçe metin. */
export function bulutHataMetni(h) {
  const m = `${h?.code || ""} ${h?.message || ""}`;
  if (/42501|row-level security|permission denied/i.test(m)) return "⚠️ Hesabında HavaStil bulut kaydı yetkisi yok (RLS). Konum bu cihazda tutuldu.";
  if (/42P01|does not exist|schema cache|PGRST205/i.test(m)) return "⚠️ Gerekli migration (0099–0104) çalıştırılmamış. Konum bu cihazda tutuldu.";
  if (/En fazla 20/i.test(m)) return "⚠️ En fazla 20 konum kaydedebilirsin.";
  if (/23505|duplicate key/i.test(m)) return "⚠️ Aynı isimde başka bir konumun var; ismi değiştir.";
  if (/Oturum yok|JWT|401/i.test(m)) return "⚠️ Oturum süresi dolmuş olabilir; yeniden giriş yap. Konum bu cihazda tutuldu.";
  if (/fetch|network|Failed|Load failed/i.test(m)) return "⚠️ Bağlantı yok: konum bu cihazda tutuldu, bağlanınca hesabınla eşitlenecek.";
  return `⚠️ Hesapla eşitlenemedi (${h?.message || h}). Konum bu cihazda tutuldu.`;
}

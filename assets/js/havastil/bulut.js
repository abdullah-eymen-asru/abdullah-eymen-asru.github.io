/**
 * bulut.js — HavaStil isteğe bağlı bulut senkronu (migration 0099 + 0100: havastil_konumlari / havastil_tercihleri).
 * VARSAYILAN KAPALI: konumlar yalnızca cihazda durur. Kullanıcı "Hesabımda sakla"yı AÇARSA kaydettiği konumların adı, simgesi, yer adları ve
 * ~110 m'ye yuvarlanmış koordinatı RLS ile yalnızca kendi satırı olarak Supabase'e yazılır; kapatınca isteğe bağlı silinir.
 * Anlık GPS konumu ve arama metinleri ASLA kaydedilmez — yalnızca kullanıcının "⭐ Kaydet" dediği konumlar.
 */
import { supabase } from "../core/supabase-client.js";

const y3 = (x) => Math.round(Number(x) * 1000) / 1000;
export const konumAnahtari = (k) => `${String(k.ad).trim().toLowerCase()}|${y3(k.lat).toFixed(3)}|${y3(k.lon).toFixed(3)}`;
const SUTUNLAR = "id, ad, enlem, boylam, ikon, ulke, admin1, ilce";

const satirdanKonum = (r) => ({ bid: r.id, ad: r.ad, lat: Number(r.enlem), lon: Number(r.boylam), ikon: r.ikon || "diger", ...(r.ulke ? { ulke: r.ulke } : {}), ...(r.admin1 ? { admin1: r.admin1, il: r.ulke === "TR" ? r.admin1 : undefined } : {}), ...(r.ilce ? { ilce: r.ilce } : {}) });

export async function bulutKonumlariCek() {
  const { data, error } = await supabase.from("havastil_konumlari").select(SUTUNLAR).order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []).map(satirdanKonum);
}

export async function bulutKonumEkle(k) {
  const { data: o } = await supabase.auth.getSession();
  const uid = o?.session?.user?.id;
  if (!uid) throw new Error("Oturum yok.");
  const { data, error } = await supabase.from("havastil_konumlari")
    .upsert({ user_id: uid, ad: String(k.ad).trim().slice(0, 40), enlem: y3(k.lat), boylam: y3(k.lon), ikon: k.ikon || "diger", ulke: (k.ulke || "").slice(0, 2) || null, admin1: (k.admin1 || "").slice(0, 60) || null, ilce: (k.ilce || "").slice(0, 60) || null }, { onConflict: "user_id,ad" })
    .select("id").single();
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

/** Yerel + bulut birleşimi (anahtar: ad+yuvarlanmış koordinat). Yalnızca eksik yerel kayıtlar buluta yazılır. */
export async function birlestir(yerel) {
  const bulut = await bulutKonumlariCek();
  const var_ = new Set(bulut.map(konumAnahtari));
  const sonuc = [...bulut];
  for (const k of yerel) {
    if (var_.has(konumAnahtari(k))) continue;
    if (sonuc.length >= 20) break;
    try { sonuc.push({ ...k, bid: await bulutKonumEkle(k) }); var_.add(konumAnahtari(k)); } catch { /* ad çakışması vb.: atla */ }
  }
  return sonuc;
}

/**
 * assets/js/havastil/bulut.js — HavaStil isteğe bağlı bulut senkronu (migration 0099: havastil_konumlari / havastil_tercihleri).
 * VARSAYILAN KAPALI: konumlar yalnızca cihazda (localStorage) durur. Kullanıcı "Hesabımda sakla"yı AÇARSA kayıtlı konum adları ve
 * ~110 m'ye yuvarlanmış koordinatlar RLS ile yalnızca kendi satırı olarak Supabase'e yazılır; kapatınca isteğe bağlı silinir.
 * Anlık GPS konumu ve arama metinleri ASLA kaydedilmez — yalnızca kullanıcının "⭐ Kaydet" dediği konumlar.
 */
import { supabase } from "../core/supabase-client.js";

const yuvarla3 = (x) => Math.round(Number(x) * 1000) / 1000;
export const konumAnahtari = (k) => `${String(k.ad).trim().toLowerCase()}|${yuvarla3(k.lat).toFixed(3)}|${yuvarla3(k.lon).toFixed(3)}`;

export async function bulutKonumlariCek() {
  const { data, error } = await supabase.from("havastil_konumlari").select("id, ad, enlem, boylam").order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []).map((r) => ({ bid: r.id, ad: r.ad, lat: Number(r.enlem), lon: Number(r.boylam) }));
}

export async function bulutKonumEkle(k) {
  const { data: o } = await supabase.auth.getSession();
  const uid = o?.session?.user?.id;
  if (!uid) throw new Error("Oturum yok.");
  const { data, error } = await supabase.from("havastil_konumlari")
    .upsert({ user_id: uid, ad: String(k.ad).trim().slice(0, 40), enlem: yuvarla3(k.lat), boylam: yuvarla3(k.lon) }, { onConflict: "user_id,ad" })
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
  const { data, error } = await supabase.from("havastil_tercihleri").select("tolerans, senaryo").maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function bulutTercihYaz({ tolerans, senaryo }) {
  const { data: o } = await supabase.auth.getSession();
  const uid = o?.session?.user?.id;
  if (!uid) return;
  const { error } = await supabase.from("havastil_tercihleri").upsert({ user_id: uid, tolerans, senaryo, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
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

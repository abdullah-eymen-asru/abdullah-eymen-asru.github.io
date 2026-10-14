/*
 * assets/js/mesajlasma/veri.js — mesajlaşma veri katmanı (Supabase + şifreleme).
 * Şifreli (sifreli=true) gövde/konu BURADA çözülür; üst katman düz metinle çalışır.
 */
import { supabase } from "../core/supabase-client.js";
import { isDemoMode } from "../demo/demo-durum.js";
import * as S from "./sifre.js";

export const E2EE_AKTIF = !isDemoMode; // demo hesapta mock/paylaşımlı veri: eski (düz) yol
const ROL = { owner: "Site Sahibi", admin: "Yönetici", manager: "İçerik Sorumlusu", editor: "İçerik Editörü", special_user: "Özel Üye", user: "Üye", demo: "Demo Üye" };
export const rolEtiketi = (r) => ROL[r] || "Üye";

// ---- kişi bilgileri (5 dk önbellek) -------------------------------------------------------------
const KISI = new Map();
export async function kisiBilgileri(idler) {
  const out = {}; const eksik = []; const t = Date.now();
  for (const id of new Set((idler || []).filter(Boolean))) {
    const k = KISI.get(id);
    if (k && t - k.t < 300000) out[id] = k; else eksik.push(id);
  }
  if (!eksik.length) return out;
  const yaz = (p) => { const v = { ad: p.full_name || p.email || "—", rol: p.role, t }; KISI.set(p.id, v); out[p.id] = v; };
  const { data, error } = await supabase.rpc("mesaj_kisi_bilgileri", { p_ids: eksik });
  if (!error && Array.isArray(data)) data.forEach(yaz);
  else {
    const { data: eski } = await supabase.from("profiles").select("id, full_name, email, role").in("id", eksik);
    (eski || []).forEach(yaz);
  }
  return out;
}

// ---- sohbet listesi -----------------------------------------------------------------------------
/** Gelen kutusu: sohbetler + konu çözümü + son mesaj önizlemesi + durum (pin/okunmamış). Sorgu sayısı sabit (≈5). */
export async function sohbetleriYukle() {
  if (E2EE_AKTIF) await S.zarflarimiYukle().catch(() => {});
  const { data: konv, error } = await supabase.from("conversations")
    .select("id, user_id, hedef_admin_id, konu, konu_sifreli, e2ee, son_mesaj_at, created_at")
    .order("son_mesaj_at", { ascending: false }).limit(300);
  if (error) throw error;
  const liste = konv || [];
  const ids = liste.map((c) => c.id);
  const durum = new Map(); const okunmamis = new Map(); const son = new Map();
  if (ids.length) {
    if (E2EE_AKTIF) {
      const [d, o] = await Promise.all([
        supabase.from("konusma_durumlari").select("conversation_id, sabit, sabit_at"),
        supabase.rpc("okunmamis_mesaj_ozeti"),
      ]);
      (d.data || []).forEach((x) => durum.set(x.conversation_id, x));
      (o.data || []).forEach((x) => okunmamis.set(x.conversation_id, x.adet));
    }
    const { data: ms } = await supabase.from("messages").select("conversation_id, body, sifreli, created_at, sender_id")
      .in("conversation_id", ids).order("created_at", { ascending: false }).limit(Math.min(ids.length * 3, 400));
    for (const m of ms || []) if (!son.has(m.conversation_id)) son.set(m.conversation_id, m);
  }
  const kisiler = await kisiBilgileri(liste.flatMap((c) => [c.user_id, c.hedef_admin_id]));
  const sonuc = [];
  for (const c of liste) {
    const d = durum.get(c.id);
    const konu = await konuCoz(c);
    const sm = son.get(c.id);
    let onizleme = "";
    if (sm) {
      onizleme = sm.sifreli ? ((await S.coz(await S.sohbetAnahtari(c.id), sm.body, c.id)) ?? "🔒 Şifre çözülemedi") : sm.body;
    }
    sonuc.push({ ...c, konu_gosterim: konu, onizleme, sabit: !!d?.sabit, sabit_at: d?.sabit_at || null, okunmamis: okunmamis.get(c.id) || 0, son: sm?.created_at || c.son_mesaj_at, uye: kisiler[c.user_id], hedef: kisiler[c.hedef_admin_id] });
  }
  return sonuc;
}

export async function konuCoz(c) {
  if (!c.e2ee) return c.konu;
  const k = await S.sohbetAnahtari(c.id);
  return (await S.coz(k, c.konu_sifreli, "konu")) ?? "🔒 Şifreli sohbet (anahtar yok)";
}

export function siralaSohbetler(liste) {
  return [...liste].sort((a, b) => (b.sabit - a.sabit) || (new Date(b.son) - new Date(a.son)));
}

// ---- çöp kutusu ---------------------------------------------------------------------------------
export async function copKutusu() {
  const { data, error } = await supabase.rpc("cop_kutusu_listele");
  if (error) throw error;
  const kisiler = await kisiBilgileri((data || []).flatMap((c) => [c.user_id, c.hedef_admin_id]));
  const out = [];
  for (const c of data || []) out.push({ ...c, konu_gosterim: await konuCoz(c), uye: kisiler[c.user_id], hedef: kisiler[c.hedef_admin_id] });
  return out;
}
export const copeAt = (id) => supabase.rpc("konusmayi_kendimden_gizle", { p_conversation_id: id });
export const geriAl = (id) => supabase.rpc("konusmayi_geri_al", { p_id: id });
export const kaliciSil = async (id) => { const r = await supabase.rpc("konusmayi_kalici_sil", { p_id: id }); if (r.error) throw r.error; if (E2EE_AKTIF) await S.zarflarimiYukle().catch(() => {}); return r.data; };
export const copuBosalt = async () => { const r = await supabase.rpc("cop_kutusunu_bosalt"); if (r.error) throw r.error; return r.data; };
export const sabitle = (id, v) => supabase.rpc("konusmayi_sabitle", { p_id: id, p_sabit: v });
export const okunduIsaretle = (id) => (E2EE_AKTIF ? supabase.rpc("konusmayi_okundu_isaretle", { p_id: id }) : Promise.resolve());

// ---- mesajlar -----------------------------------------------------------------------------------
export async function mesajlariYukle(sohbet) {
  const { data, error } = await supabase.from("messages").select("id, sender_id, body, sifreli, created_at")
    .eq("conversation_id", sohbet.id).order("created_at", { ascending: true }).limit(500);
  if (error) throw error;
  const key = await S.sohbetAnahtari(sohbet.id);
  const kisiler = await kisiBilgileri((data || []).map((m) => m.sender_id));
  const out = [];
  for (const m of data || []) out.push(await mesajiCoz(m, sohbet.id, key, kisiler));
  return out;
}
export async function mesajiCoz(m, sohbetId, key, kisiler) {
  const k = key === undefined ? await S.sohbetAnahtari(sohbetId) : key;
  const metin = m.sifreli ? await S.coz(k, m.body, sohbetId) : m.body;
  const kisi = (kisiler || (await kisiBilgileri([m.sender_id])))[m.sender_id];
  return { id: m.id, sender_id: m.sender_id, created_at: m.created_at, sifreli: m.sifreli, metin, cozulemedi: metin == null, gonderen: kisi };
}

/** Mesaj gönder. Şifreli sohbetse şifreler; eski (düz) sohbetse önce şifreli sürüme yükseltir. */
export async function mesajGonder(sohbet, metin) {
  if (E2EE_AKTIF) {
    if (!sohbet.e2ee) await sohbetiYukselt(sohbet);
    let key = await S.sohbetAnahtari(sohbet.id);
    if (!key) throw new Error("Bu sohbetin şifre anahtarı sende yok; sohbetin diğer tarafı sohbeti açtığında otomatik paylaşılır.");
    const body = await S.sifrele(key, metin, sohbet.id);
    const { data, error } = await supabase.from("messages").insert({ conversation_id: sohbet.id, sender_id: (await supabase.auth.getUser()).data.user.id, body, sifreli: true }).select("id").single();
    if (error) throw error;
    S.eksikZarflariTamamla(sohbet.id);
    return data;
  }
  const { data, error } = await supabase.from("messages").insert({ conversation_id: sohbet.id, sender_id: (await supabase.auth.getUser()).data.user.id, body: metin }).select("id").single();
  if (error) throw error;
  return data;
}

async function sohbetiYukselt(sohbet) {
  const key = await S.yeniSohbetAnahtari();
  const { data: idler, error: e1 } = await supabase.rpc("mesaj_zarf_aday_idleri", { p_uye: sohbet.user_id, p_hedef_admin: sohbet.hedef_admin_id });
  if (e1) throw e1;
  const { zarflar } = await S.zarflariHazirla(key, idler);
  const benim = (await supabase.auth.getUser()).data.user.id;
  if (!zarflar.some((z) => z.user_id === benim)) throw new Error("Şifreleme anahtarın hazır değil; sayfayı yenileyip tekrar dene.");
  const konuSifreli = await S.sifrele(key, sohbet.konu, "konu");
  const { data: yapildi, error } = await supabase.rpc("konusmayi_sifrele", { p_id: sohbet.id, p_konu_sifreli: konuSifreli, p_zarflar: zarflar });
  if (error) throw error;
  if (yapildi) { const benimZarf = zarflar.find((z) => z.user_id === benim).zarf; S.anahtariKaydet(sohbet.id, key, benimZarf); }
  else await S.zarflarimiYukle(); // başka katılımcı aynı anda yükseltti: onun anahtarını al
  sohbet.e2ee = true; sohbet.konu_sifreli = konuSifreli;
}

/** Yeni sohbet. hedefKullanici: yönetici başkasıyla açıyorsa onun kimliği; hedefAdmin: üyenin seçtiği yönetici (ya da null). */
export async function sohbetBaslat({ konu, hedefKullanici = null, hedefAdmin = null }) {
  if (!E2EE_AKTIF) {
    const { data, error } = await supabase.rpc("baslat_konusma", { p_konu: konu, p_hedef_kullanici_id: hedefKullanici, p_hedef_admin_id: hedefAdmin });
    if (error) throw error; return data;
  }
  const { data: idler, error: e1 } = await supabase.rpc("mesaj_zarf_aday_idleri", { p_uye: hedefKullanici, p_hedef_admin: hedefAdmin });
  if (e1) throw e1;
  const key = await S.yeniSohbetAnahtari();
  const { zarflar } = await S.zarflariHazirla(key, idler);
  const benim = (await supabase.auth.getUser()).data.user.id;
  const konuSifreli = await S.sifrele(key, konu, "konu");
  const { data, error } = await supabase.rpc("baslat_konusma_sifreli", { p_konu_sifreli: konuSifreli, p_zarflar: zarflar, p_hedef_kullanici_id: hedefKullanici, p_hedef_admin_id: hedefAdmin });
  if (error) throw error;
  const benimZarf = zarflar.find((z) => z.user_id === benim)?.zarf;
  S.anahtariKaydet(data, key, benimZarf);
  return data;
}

export async function mesajiSil(id, herkesten) {
  const { error } = herkesten
    ? await supabase.rpc("mesaji_herkesten_sil", { p_message_id: id })
    : await supabase.rpc("mesaji_kendimden_gizle", { p_message_id: id });
  if (error) throw error;
}

// ---- içerik araması (YALNIZCA arama yazılınca, bellekte; tarayıcıdan çıkmaz) ----------------------------
let INDEKS = null; let INDEKS_T = 0;
export async function aramaIndeksi(sohbetler) {
  if (INDEKS && Date.now() - INDEKS_T < 120000) return INDEKS;
  const ids = sohbetler.map((c) => c.id);
  const harita = new Map();
  if (ids.length) {
    const { data } = await supabase.from("messages").select("conversation_id, body, sifreli").in("conversation_id", ids)
      .order("created_at", { ascending: false }).limit(1500);
    for (const m of data || []) {
      const t = m.sifreli ? await S.coz(await S.sohbetAnahtari(m.conversation_id), m.body, m.conversation_id) : m.body;
      if (t) harita.set(m.conversation_id, (harita.get(m.conversation_id) || "") + "\n" + t.toLocaleLowerCase("tr"));
    }
  }
  INDEKS = harita; INDEKS_T = Date.now();
  return INDEKS;
}
export function aramaIndeksiniTemizle() { INDEKS = null; }

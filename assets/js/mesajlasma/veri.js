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
  if (E2EE_AKTIF) {
    await S.anahtarHazirMi();                    // kilitliyse E2EEKilitHatasi → arayüz kurtarma panelini açar
    await S.zarflarimiYukle().catch(() => {});
  }
  const { data: konv, error } = await supabase.from("conversations")
    .select("id, user_id, hedef_admin_id, konu, konu_sifreli, e2ee, grup, son_mesaj_at, created_at")
    .order("son_mesaj_at", { ascending: false }).limit(300);
  if (error) throw error;
  const liste = konv || [];
  const ids = liste.map((c) => c.id);
  const durum = new Map(); const okunmamis = new Map(); const son = new Map();
  if (ids.length) {
    if (E2EE_AKTIF) {
      const [d, o] = await Promise.all([
        supabase.from("konusma_durumlari").select("conversation_id, sabit, sabit_at, sessiz"),
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
    sonuc.push({ ...c, konu_gosterim: konu, onizleme, sessiz: !!d?.sessiz, sabit: !!d?.sabit, sabit_at: d?.sabit_at || null, okunmamis: okunmamis.get(c.id) || 0, son: sm?.created_at || c.son_mesaj_at, uye: kisiler[c.user_id], hedef: kisiler[c.hedef_admin_id] });
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
// 0096 (yanit_id) çalıştırılmadıysa sütun yok: bir kez algılanır, sohbet yüklemesi bozulmaz.
let YANIT_DESTEGI = true;
export async function mesajlariYukle(sohbet) {
  const oku = (kolon) => supabase.from("messages").select(kolon).eq("conversation_id", sohbet.id).order("created_at", { ascending: true }).limit(500);
  let { data, error } = await oku(YANIT_DESTEGI ? "id, sender_id, body, sifreli, created_at, yanit_id" : "id, sender_id, body, sifreli, created_at");
  if (error && YANIT_DESTEGI && /yanit_id|42703/.test(`${error.code} ${error.message}`)) { YANIT_DESTEGI = false; ({ data, error } = await oku("id, sender_id, body, sifreli, created_at")); }
  if (error) throw error;
  const key = await S.sohbetAnahtari(sohbet.id);
  const kisiler = await kisiBilgileri((data || []).map((m) => m.sender_id));
  const yildizlar = await yildizKumesi(sohbet.id);
  const out = [];
  for (const m of data || []) { const c = await mesajiCoz(m, sohbet.id, key, kisiler); c.yildizli = yildizlar.has(m.id); out.push(c); }
  return out;
}
export async function mesajiCoz(m, sohbetId, key, kisiler) {
  const k = key === undefined ? await S.sohbetAnahtari(sohbetId) : key;
  const metin = m.sifreli ? await S.coz(k, m.body, sohbetId) : m.body;
  const kisi = (kisiler || (await kisiBilgileri([m.sender_id])))[m.sender_id];
  return { id: m.id, sender_id: m.sender_id, created_at: m.created_at, sifreli: m.sifreli, metin, cozulemedi: metin == null, gonderen: kisi, yanit_id: m.yanit_id || null };
}

/* ---------- WhatsApp tarzı: sabit mesaj + yıldız (migration 0096; tablolar yoksa sessizce devre dışı) ---------- */
async function yildizKumesi(sohbetId) {
  try {
    const { data, error } = await supabase.from("mesaj_yildizlari").select("message_id").eq("conversation_id", sohbetId);
    return error ? new Set() : new Set((data || []).map((r) => r.message_id));
  } catch { return new Set(); }
}
export async function mesajiYildizla(id, yildiz) { const r = await supabase.rpc("mesaji_yildizla", { p_message_id: id, p_yildiz: yildiz }); if (r.error) throw r.error; }
/** Yukarı sabitle: sohbet başına tek mesaj; yenisi eskisinin yerine geçer. */
export async function mesajiSabitle(id) { const r = await supabase.rpc("mesaji_sabitle", { p_message_id: id }); if (r.error) throw r.error; }
export async function mesajSabitiniKaldir(sohbetId) { const r = await supabase.rpc("mesaj_sabitini_kaldir", { p_conversation_id: sohbetId }); if (r.error) throw r.error; }
/** Sohbetin sabit mesajının kimliği (yoksa/tablo yoksa null). */
export async function sabitMesajKimligi(sohbetId) { try { const r = await supabase.rpc("sohbet_sabit_mesaj", { p_id: sohbetId }); return r.error ? null : r.data || null; } catch { return null; } }
/** Tek mesajı çözerek getirir (500'lük listede olmayan sabit mesaj için). */
export async function tekMesaj(sohbet, id) {
  const { data } = await supabase.from("messages").select("id, sender_id, body, sifreli, created_at").eq("id", id).eq("conversation_id", sohbet.id).maybeSingle();
  return data ? mesajiCoz(data, sohbet.id) : null;
}
/** Yıldızlı mesajlar (tüm sohbetler): [{ ...çözülmüş mesaj, sohbetId }]; yeniden eskiye. */
export async function yildizliMesajlar(sohbetler) {
  const { data, error } = await supabase.from("mesaj_yildizlari").select("message_id, conversation_id, created_at").order("created_at", { ascending: false }).limit(300);
  if (error || !data?.length) return [];
  const haritasi = new Map(sohbetler.map((c) => [c.id, c]));
  const { data: ms } = await supabase.from("messages").select("id, conversation_id, sender_id, body, sifreli, created_at").in("id", data.map((r) => r.message_id));
  const kisiler = await kisiBilgileri((ms || []).map((m) => m.sender_id));
  const out = [];
  for (const r of data) {
    const m = (ms || []).find((x) => x.id === r.message_id); const c = haritasi.get(r.conversation_id);
    if (!m || !c) continue;
    const cz = await mesajiCoz(m, c.id, undefined, kisiler);
    out.push({ ...cz, sohbetId: c.id, yildizli: true });
  }
  return out;
}

/** Mesaj gönder. Şifreli sohbetse şifreler; eski (düz) sohbetse önce şifreli sürüme yükseltir. */
export async function mesajGonder(sohbet, metin, yanitId = null) {
  if (E2EE_AKTIF) {
    if (!sohbet.e2ee) await sohbetiYukselt(sohbet);
    let key = await S.sohbetAnahtari(sohbet.id);
    if (!key) throw new Error("Bu sohbetin şifre anahtarı sende yok; sohbetin diğer tarafı sohbeti açtığında otomatik paylaşılır.");
    const body = await S.sifrele(key, metin, sohbet.id);
    const satir = { conversation_id: sohbet.id, sender_id: (await supabase.auth.getUser()).data.user.id, body, sifreli: true };
    if (yanitId && YANIT_DESTEGI) satir.yanit_id = yanitId; // yalnızca hedef mesajın kimliği (düz); alıntı metni istemcide çözülür
    let { data, error } = await supabase.from("messages").insert(satir).select("id").single();
    if (error && satir.yanit_id && /yanit_id|42703/.test(`${error.code} ${error.message}`)) { YANIT_DESTEGI = false; delete satir.yanit_id; ({ data, error } = await supabase.from("messages").insert(satir).select("id").single()); }
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
  // Sunucu (mesaji_herkesten_sil + RLS) zaten yalnızca göndericiye izin verir; istemci de aynı kuralı uygular.
  if (herkesten) { const benim = (await supabase.auth.getUser()).data?.user?.id; const { data: m } = await supabase.from("messages").select("sender_id").eq("id", id).maybeSingle(); if (m && m.sender_id !== benim) throw new Error("Karşı tarafın mesajını herkesten silemezsin."); }
  const { error } = herkesten
    ? await supabase.rpc("mesaji_herkesten_sil", { p_message_id: id })
    : await supabase.rpc("mesaji_kendimden_gizle", { p_message_id: id });
  if (error) throw error;
}

// ---- okundu / sessize alma / yönetim listesi / gruplar -----------------------------------------------
/** Karşı tarafın en son okuma zamanı (kimlik açıklamadan). null = henüz okunmadı. */
export async function karsiOkundu(id) {
  if (!E2EE_AKTIF) return null;
  const { data, error } = await supabase.rpc("sohbet_karsi_okundu", { p_id: id });
  return error ? null : data;
}
export const sessize = (id, v) => supabase.rpc("konusmayi_sessize_al", { p_id: id, p_sessiz: v });

/** Üyenin yazabileceği yönetici/site sahibi listesi ("Yönetim ile İletişim"). E-posta dönmez. */
export async function yonetimListesi() {
  const { data, error } = await supabase.rpc("mesaj_hedef_listesi_getir");
  if (error) throw error;
  return data || [];
}

export async function grupBaslat({ ad, uyeIdler }) {
  const { data: idler, error: e1 } = await supabase.rpc("grup_zarf_aday_idleri", { p_uyeler: uyeIdler });
  if (e1) throw e1;
  const key = await S.yeniSohbetAnahtari();
  const { zarflar } = await S.zarflariHazirla(key, idler);
  const benim = (await supabase.auth.getUser()).data.user.id;
  const adSifreli = await S.sifrele(key, ad, "konu");
  const { data, error } = await supabase.rpc("baslat_grup_sohbeti", { p_konu_sifreli: adSifreli, p_uyeler: uyeIdler, p_zarflar: zarflar });
  if (error) throw error;
  S.anahtariKaydet(data, key, zarflar.find((z) => z.user_id === benim)?.zarf);
  return data;
}
export async function grupUyeleri(id) {
  const { data, error } = await supabase.rpc("grup_uyeleri", { p_id: id });
  if (error) throw error;
  return data || [];
}
export const grupUyeEkle = async (id, uye) => { const r = await supabase.rpc("grup_uye_ekle", { p_id: id, p_uye: uye }); if (r.error) throw r.error; };
export const grupUyeCikar = async (id, uye) => { const r = await supabase.rpc("grup_uye_cikar", { p_id: id, p_uye: uye }); if (r.error) throw r.error; };

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

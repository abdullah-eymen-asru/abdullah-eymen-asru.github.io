/*
 * assets/js/mesajlasma/okunmamis.js — canlı okunmamış mesaj sayacı (tek paylaşılan durum).
 * İstek ekonomisi: 1 RPC; Realtime artık canli.js'teki TEK kanaldan gelir; olay gelince 800 ms debounce; sekme gizliyken yoklama YOK;
 * yedek yoklama 2 dk'da bir (yalnızca sekme görünürken). visibilitychange dinleyicisi bir kez eklenir (eskiden her başlatmada birikiyordu).
 */
import { supabase } from "../core/supabase-client.js";
import { isDemoMode } from "../demo/demo-durum.js";
import { canliBaslat, canliDinle } from "./canli.js";
import { bildirimDurumu, mesajBildirimiGoster, acikSohbet } from "./bildirim.js";
import { kisiBilgileri } from "./veri.js";

/** Gelen mesaj için (açıksa) bildirim: sessiz sohbet ve ekranda açık sohbet hariç. Metin YOK (E2EE). Hangi sekmede olursan ol çalışır. */
async function bildirimle(m) {
  if (bildirimDurumu() !== "acik") return;
  if (!document.hidden && acikSohbet() === m.conversation_id) return;
  try {
    const { data } = await supabase.from("konusma_durumlari").select("sessiz").eq("conversation_id", m.conversation_id).maybeSingle();
    if (data?.sessiz) return;
    const k = (await kisiBilgileri([m.sender_id]))[m.sender_id];
    await mesajBildirimiGoster({ gonderen: k?.ad, sohbetId: m.conversation_id });
  } catch { /* bildirim best-effort */ }
}

let TOPLAM = 0; let ZAMAN = null; let YOKLAMA = null; let BASLADI = false; let CIKIS = null; let GORUNURLUK = false;
const DINLEYICILER = new Set();
export const okunmamisSayisi = () => TOPLAM;
export function okunmamisDinle(fn) { DINLEYICILER.add(fn); fn(TOPLAM); return () => DINLEYICILER.delete(fn); }
const yay = () => DINLEYICILER.forEach((f) => { try { f(TOPLAM); } catch { /* dinleyici hatası sayaçı durdurmasın */ } });

export async function okunmamisYenile() {
  if (isDemoMode) return;
  const { data, error } = await supabase.rpc("okunmamis_mesaj_ozeti");
  if (error) return; // migration 0093 henüz çalışmadıysa sessiz
  const t = (data || []).reduce((a, x) => a + (x.adet || 0), 0);
  if (t !== TOPLAM) { TOPLAM = t; yay(); }
}
const ertele = () => { clearTimeout(ZAMAN); ZAMAN = setTimeout(okunmamisYenile, 800); };

export async function okunmamisBaslat() {
  if (isDemoMode || BASLADI) return;
  BASLADI = true;
  await okunmamisYenile();
  await canliBaslat();
  CIKIS = canliDinle((o) => { if (o.tur === "mesaj-sil" || (o.tur === "mesaj-ekle" && !o.ben)) ertele(); if (o.tur === "mesaj-ekle" && !o.ben) bildirimle(o.yeni); });
  YOKLAMA = setInterval(() => { if (!document.hidden) okunmamisYenile(); }, 120000);
  if (!GORUNURLUK) { GORUNURLUK = true; document.addEventListener("visibilitychange", () => { if (BASLADI && !document.hidden) okunmamisYenile(); }); }
  supabase.auth.onAuthStateChange((o) => { if (o === "SIGNED_OUT") okunmamisDurdur(); });
}
export function okunmamisDurdur() {
  clearTimeout(ZAMAN); clearInterval(YOKLAMA); CIKIS?.(); CIKIS = null;
  BASLADI = false; TOPLAM = 0; yay();
}

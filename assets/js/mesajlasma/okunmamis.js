/*
 * assets/js/mesajlasma/okunmamis.js — canlı okunmamış mesaj sayacı (tek paylaşılan durum).
 * İstek ekonomisi: 1 RPC + 1 realtime kanalı; olay gelince 800 ms debounce; sekme gizliyken yoklama YOK;
 * yedek yoklama 2 dk'da bir (yalnızca sekme görünürken).
 */
import { supabase } from "../core/supabase-client.js";
import { isDemoMode } from "../demo/demo-durum.js";

let TOPLAM = 0; let KANAL = null; let ZAMAN = null; let YOKLAMA = null; let UID = null;
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
  if (isDemoMode || KANAL) return;
  const { data } = await supabase.auth.getUser();
  UID = data?.user?.id; if (!UID) return;
  await okunmamisYenile();
  KANAL = supabase.channel(`msj-rozet-${UID}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (p) => { if (p.new?.sender_id !== UID) ertele(); })
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "messages" }, ertele)
    .subscribe();
  YOKLAMA = setInterval(() => { if (!document.hidden) okunmamisYenile(); }, 120000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) okunmamisYenile(); });
  supabase.auth.onAuthStateChange((o) => { if (o === "SIGNED_OUT") okunmamisDurdur(); });
}
export function okunmamisDurdur() {
  clearTimeout(ZAMAN); clearInterval(YOKLAMA);
  if (KANAL) supabase.removeChannel(KANAL);
  KANAL = null; TOPLAM = 0; yay();
}

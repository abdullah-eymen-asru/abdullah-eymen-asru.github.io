/*
 * assets/js/mesajlasma/canli.js — mesajlaşma için TEK Realtime kanalı (uygulama genelinde bir tane).
 * Eskiden okunmamis.js (rozet) ve arayuz.js (sohbet) AYRI kanal açıyordu; sohbet sekmesi her açılışta yeni kanal ekliyor, eskisi
 * kapanmıyordu. Artık tek kanal burada yaşar; arayüz yalnızca dinleyici ekler/çıkarır (sekme değişince çıkarır → sızıntı yok).
 * Olay: { tur: "mesaj-ekle" | "mesaj-sil" | "sohbet", yeni?, eski? }
 */
import { supabase } from "../core/supabase-client.js";
import { tekKanal } from "../core/realtime.js";
import { isDemoMode } from "../demo/demo-durum.js";

let KANAL = null; let UID = null; let KURULUYOR = null;
const DINLEYICILER = new Set();
const yay = (o) => DINLEYICILER.forEach((f) => { try { f(o); } catch { /* bir dinleyicinin hatası diğerlerini durdurmasın */ } });

export function canliDinle(fn) { DINLEYICILER.add(fn); return () => DINLEYICILER.delete(fn); }
export const canliKuruMu = () => !!KANAL;

export async function canliBaslat() {
  if (isDemoMode || KANAL) return;
  if (KURULUYOR) return KURULUYOR;
  KURULUYOR = (async () => {
    const { data } = await supabase.auth.getUser();
    UID = data?.user?.id; if (!UID) return;
    KANAL = tekKanal(`msj-${UID}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (p) => yay({ tur: "mesaj-ekle", yeni: p.new, ben: p.new?.sender_id === UID }))
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "messages" }, (p) => yay({ tur: "mesaj-sil", eski: p.old }))
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => yay({ tur: "sohbet" }))
      .subscribe();
  })().finally(() => { KURULUYOR = null; });
  return KURULUYOR;
}

export function canliDurdur() {
  if (KANAL) { try { supabase.removeChannel(KANAL); } catch { /* yok say */ } }
  KANAL = null; UID = null;
}
supabase.auth.onAuthStateChange((o) => { if (o === "SIGNED_OUT") canliDurdur(); });

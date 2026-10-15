/*
 * assets/js/core/realtime.js — Supabase Realtime TEKİL KANAL (singleton) yardımcısı.
 * SORUN: SPA'da sekme geçişlerinde aynı adlı kanal yeniden kurulunca eski WebSocket aboneliği açık kalıyor; çift abonelik,
 *        çift bildirim ve kota sızıntısı oluyordu. ÇÖZÜM: kanal kurmadan önce aynı konulu (topic) eski kanallar removeChannel ile KAPATILIR.
 */
import { supabase } from "./supabase-client.js";

/** Aynı adlı kanal varsa önce tamamen kapatır, sonra yenisini döndürür (henüz subscribe edilmemiş). */
export function tekKanal(ad, secenek) {
  try {
    for (const k of supabase.getChannels?.() || []) {
      if (k.topic === `realtime:${ad}`) supabase.removeChannel(k);
    }
  } catch { /* yok say: yeni kanal yine kurulur */ }
  return supabase.channel(ad, secenek);
}

/** Verilen önekle başlayan TÜM kanalları kapatır (çıkış / sayfadan ayrılma). */
export function kanallariKapat(onek = "") {
  try { for (const k of supabase.getChannels?.() || []) if (k.topic.startsWith(`realtime:${onek}`)) supabase.removeChannel(k); } catch { /* yok say */ }
}

supabase.auth.onAuthStateChange((o) => { if (o === "SIGNED_OUT") kanallariKapat(); });
window.addEventListener("pagehide", () => kanallariKapat());

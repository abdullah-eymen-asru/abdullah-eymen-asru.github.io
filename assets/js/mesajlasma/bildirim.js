/*
 * assets/js/mesajlasma/bildirim.js — İSTEK ODAKLI sohbet bildirimleri (tarayıcı / PWA / uygulama içi).
 *  • İzin ASLA kendiliğinden istenmez: yalnızca Mesajlaşma sayfasındaki "🔔 Bildirimleri Aç" anahtarına basılınca.
 *  • Aynı yerden kapatılır. Sohbet bazında sessize alma arayuz.js'tedir (konusma_durumlari.sessiz).
 *  • GİZLİLİK: sohbetler uçtan uca şifreli olduğundan bildirimde mesaj metni/konu YOKTUR; yalnızca "X sana mesaj gönderdi".
 *  • Sekme görünür ve sohbet açıksa bildirim gösterilmez (zaten ekranda). Tıklayınca ilgili sohbet açılır (sw-bildirim.js).
 *  • Uygulama kapalıyken gerçek Web Push için VAPID açık anahtarı <meta name="vapid-public-key"> ile verilirse abonelik push_abonelikleri'ne yazılır;
 *    gönderici sunucu (Worker + VAPID gizli anahtarı) ayrıca kurulmalıdır. Aksi hâlde bildirimler sayfa/PWA açıkken (arka plan sekmesi dahil) çalışır.
 */
import { supabase } from "../core/supabase-client.js";

const ANAHTAR = "aea_msj_bildirim";
let KAYIT = null; let ACIK_SOHBET = null;
/** Şu an ekranda açık sohbet (arayuz.js ayarlar): sekme görünürken o sohbet için bildirim gösterilmez. */
export const acikSohbetAyarla = (id) => { ACIK_SOHBET = id; };
export const acikSohbet = () => ACIK_SOHBET;

const destekVarMi = () => "Notification" in window;
const depoOku = () => { try { return localStorage.getItem(ANAHTAR) === "1"; } catch { return false; } };
const depoYaz = (v) => { try { v ? localStorage.setItem(ANAHTAR, "1") : localStorage.removeItem(ANAHTAR); } catch { /* depo kapalı */ } };

/** "desteklenmiyor" | "reddedildi" (tarayıcıdan engelli) | "acik" | "kapali" */
export function bildirimDurumu() {
  if (!destekVarMi()) return "desteklenmiyor";
  if (Notification.permission === "denied") return "reddedildi";
  return Notification.permission === "granted" && depoOku() ? "acik" : "kapali";
}

async function swKaydet() {
  if (KAYIT) return KAYIT;
  if (!("serviceWorker" in navigator)) return null;
  try { KAYIT = await navigator.serviceWorker.register("/sw-bildirim.js", { scope: "/" }); } catch { KAYIT = null; }
  return KAYIT;
}

async function pushAboneOl(kayit) {
  const anahtar = document.querySelector('meta[name="vapid-public-key"]')?.content;
  if (!anahtar || !kayit?.pushManager) return;
  try {
    const u8 = Uint8Array.from(atob(anahtar.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    const abone = (await kayit.pushManager.getSubscription()) || (await kayit.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: u8 }));
    const j = abone.toJSON();
    await supabase.from("push_abonelikleri").upsert({ endpoint: j.endpoint, p256dh: j.keys?.p256dh, auth: j.keys?.auth }, { onConflict: "user_id,endpoint" });
  } catch { /* push zorunlu değil */ }
}
async function pushAbonelikSil() {
  try {
    const kayit = await swKaydet(); const abone = await kayit?.pushManager?.getSubscription();
    if (abone) { await supabase.from("push_abonelikleri").delete().eq("endpoint", abone.endpoint); await abone.unsubscribe(); }
  } catch { /* yok say */ }
}

/** Anahtarı AÇAR: izin ister (kullanıcı hareketiyle çağrılmalı). Sonuç yeni durum. */
export async function bildirimAc() {
  if (!destekVarMi()) return "desteklenmiyor";
  let izin = Notification.permission;
  if (izin === "default") izin = await Notification.requestPermission();
  if (izin !== "granted") return bildirimDurumu();
  depoYaz(true);
  const kayit = await swKaydet();
  await pushAboneOl(kayit);
  return "acik";
}
export async function bildirimKapat() { depoYaz(false); await pushAbonelikSil(); return bildirimDurumu(); }

/** Yeni mesaj bildirimi. Çağıran: sohbet açık+görünürse ve sohbet sessizse ÇAĞIRMAZ. */
export async function mesajBildirimiGoster({ gonderen, sohbetId }) {
  if (bildirimDurumu() !== "acik") return false;
  const baslik = "Yeni mesaj";
  const govde = `${gonderen || "Biri"} sana şifreli bir mesaj gönderdi.`;
  const kayit = await swKaydet();
  try {
    if (kayit?.showNotification) await kayit.showNotification(baslik, { body: govde, tag: `sohbet-${sohbetId}`, renotify: true, data: { sohbet: sohbetId } });
    else { const n = new Notification(baslik, { body: govde, tag: `sohbet-${sohbetId}` }); n.onclick = () => { window.focus(); window.dispatchEvent(new CustomEvent("msj:sohbet-ac", { detail: { sohbet: sohbetId } })); n.close(); }; }
    return true;
  } catch { return false; }
}

/** Service Worker'dan gelen "sohbeti aç" mesajını sayfa olayına çevirir. */
export function bildirimTiklamasiniDinle(fn) {
  const sw = (e) => { if (e.data?.tip === "sohbet-ac") fn(e.data.sohbet); };
  const pg = (e) => fn(e.detail?.sohbet);
  navigator.serviceWorker?.addEventListener("message", sw);
  window.addEventListener("msj:sohbet-ac", pg);
  return () => { navigator.serviceWorker?.removeEventListener("message", sw); window.removeEventListener("msj:sohbet-ac", pg); };
}

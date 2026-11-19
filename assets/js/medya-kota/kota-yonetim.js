/*
 * assets/js/medya-kota/kota-yonetim.js — Yetki Ayarları › "Medya Kotaları" (Site Sahibi + yetkili Yönetici)
 * Transkript ve Medya İndirici günlük kotalarını TEK yerden açıp kapatır / limitlerini değiştirir.
 * Güvenlik: asıl kapı SQL'dedir (owner_medya_kota_ayarla → medya_kota_yonetim_yetkili()); bu dosya yalnızca arayüzdür.
 */
import { supabase } from "../core/supabase-client.js";
import { el } from "../donusturucu/ortak.js";
import { ARACLAR, ownerAyar } from "./medya-kota.js";

const kok = document.getElementById("ya-medyakota-kok");
async function kur() {
  if (!kok) return;
  const { data: sahip } = await supabase.rpc("medya_kota_yonetim_yetkili");
  if (sahip !== true) { kok.replaceChildren(el("p", { class: "md-soluk", text: "Bu bölüm yalnızca Site Sahibi ve yetkilendirilmiş Yönetici içindir." })); return; }
  kok.classList.add("mk-yonetim");
  kok.replaceChildren(
    el("p", { class: "md-soluk", text: "Her araç için: günlük kotayı aç/kapat, kişi başı ve tüm site limitlerini ayarla. Transkript sistem anahtarı Groq'un ücretsiz katmanındadır (günde ~28.800 sn ses, tüm üyeler ortak); bu yüzden “Tüm site” limitini bunun altında tut. Araçların kendisini kimlerin görebileceği Özellikler sekmesindedir."}),
    ...Object.entries(ARACLAR).map(([arac, t]) => el("section", { class: "md-kart" }, el("h3", { text: `🎧 ${t.ad}` }), ownerAyar(arac, t, () => {}, true))));
}
kur().catch((h) => { console.error("kota-yonetim.js:", h); kok?.replaceChildren(el("p", { class: "auth-message error", text: `Yüklenemedi: ${h?.message || h}` })); });

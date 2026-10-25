/*
 * assets/js/metadata-temizleyici/metadata-temizleyici.js — Araçlar › Metadata Temizleyici sekmesinin GİRİŞ dosyası.
 * (dashboard.js MODULES.metadata bunu dinamik import eder.)
 * ESKİ HATA: bu dosya yanlışlıkla motor.js'in birebir kopyasıydı; kartı hiç kurmadığı için sekme sonsuza dek "Yükleniyor..." gösteriyordu.
 * Görev: 1) Dönüştürücü ile aynı yetki kapısı (donusturucu_yetkisi_var_mi)  2) #mt-kok içine arayuz.js kartını kurmak.
 * Motor (motor.js) ve arayüz (arayuz.js) ayrı dosyalardır; bu dosyada iş mantığı YOKTUR.
 * %100 istemci: dosya hiçbir yere yüklenmez.
 */
import { supabase } from "../core/supabase-client.js";
import { el, hataMetni } from "../donusturucu/ortak.js";
import { metadataKartiYap } from "./arayuz.js";

const kok = document.getElementById("mt-kok");

async function kur() {
  if (!kok) return;
  const { data: yetkili, error } = await supabase.rpc("donusturucu_yetkisi_var_mi");
  if (error) { kok.replaceChildren(el("p", { class: "auth-message error", text: hataMetni(error) })); return; }
  if (yetkili !== true) {
    kok.replaceChildren(el("div", { class: "dn-kart", role: "alert" },
      el("h2", { text: "🚫 Erişim yok" }),
      el("p", { class: "dn-muted", text: "Bu araca erişim yetkin bulunmuyor. Gerekirse site sahibinden talep et." })));
    return;
  }
  kok.classList.add("dn-kok");
  kok.replaceChildren(metadataKartiYap());
}

kur().catch((h) => {
  console.error("metadata-temizleyici.js:", h);
  if (kok) kok.replaceChildren(el("p", { class: "auth-message error", text: `Araç yüklenemedi: ${h?.message || h}` }));
});

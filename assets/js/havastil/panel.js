/**
 * assets/js/havastil/panel.js — Yönetim panelindeki "HavaStil" sekmesinin girişi (Araçlar › 🌦️ HavaStil).
 * GUARD: arayüzü kurmadan ÖNCE havastil_yetkisi_var_mi() RPC'si sorulur (menü gizleme + hash yönlendirme dashboard.js'te;
 * bu ikinci, derinlemesine savunma katmanıdır). Gerçek sınır: RLS + havastil-worker (ikisi de aynı fonksiyonu sorar).
 */
import { supabase } from "../core/supabase-client.js";
import { havastilKur } from "./arayuz.js";
import { demoModuAktifMi } from "../demo/demo-durum.js";

const kok = document.getElementById("hv-kok");
const hazirla = async () => {
  if (!kok) return;
  // VİTRİN (demo/misafir): RPC sorulmaz (demo rolü zaten yetkisizdir); İstanbul vitrini, kayıt ve Mod B kapalı.
  if (demoModuAktifMi()) { await havastilKur(kok, { vitrin: true }); return; }
  let yetkili = false;
  try { const { data, error } = await supabase.rpc("havastil_yetkisi_var_mi"); yetkili = !error && data === true; } catch { yetkili = false; }
  if (!yetkili) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "HavaStil bu hesap için açık değil. Site Sahibi, Yetki Ayarları › Özellikler tablosundan rolün için açabilir.";
    kok.replaceChildren(p);
    return;
  }
  const ac = document.createElement("a");
  ac.className = "hv-btn hv-btn-ince hv-uygulama-baglanti";
  ac.href = "/panel/havastil/";
  ac.textContent = "📱 Uygulama olarak aç (telefona kurulabilir)";
  await havastilKur(kok);
  kok.prepend(ac);
};
hazirla().catch((h) => {
  console.warn("HavaStil yüklenemedi:", h);
  if (kok) { const p = document.createElement("p"); p.className = "muted"; p.textContent = "HavaStil yüklenemedi. Sayfayı yenile."; kok.replaceChildren(p); }
});

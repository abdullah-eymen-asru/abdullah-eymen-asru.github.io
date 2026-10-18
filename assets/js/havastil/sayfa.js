/**
 * assets/js/havastil/sayfa.js — Bağımsız HavaStil sayfası (/panel/havastil/) · PWA girişi.
 * Akış: oturum + 2FA kontrolü (requireAuth) → havastil_yetkisi_var_mi() → arayüz. Yetkisizse hiçbir şey çizilmez.
 * Servis çalışanı YALNIZCA bu yol için (/panel/havastil/sw.js, kapsam /panel/havastil/) kaydedilir; panelin geri kalanı etkilenmez.
 */
import { requireAuth } from "../auth/auth-guard.js";
import { supabase } from "../core/supabase-client.js";
import { havastilKur } from "./arayuz.js";
import { demoModuAktifMi } from "../demo/demo-durum.js";

function ekle(rel, oz) { const l = document.createElement("link"); l.rel = rel; for (const [k, v] of Object.entries(oz)) l.setAttribute(k, v); document.head.appendChild(l); }
function meta(ad, icerik) { const m = document.createElement("meta"); m.name = ad; m.content = icerik; document.head.appendChild(m); }

const kok = document.getElementById("hv-kok");
const yukleniyor = document.getElementById("hv-yukleniyor");

async function basla() {
  // PWA üst bilgileri (CSP: meta/link JS ile eklenir, satır içi betik yok)
  ekle("manifest", { href: "/panel/havastil/manifest.webmanifest" });
  ekle("apple-touch-icon", { href: "/panel/havastil/ikon-180.png" });
  meta("apple-mobile-web-app-capable", "yes");
  meta("mobile-web-app-capable", "yes");
  meta("apple-mobile-web-app-title", "HavaStil");

  await requireAuth({ role: null });
  if (demoModuAktifMi()) { if (yukleniyor) yukleniyor.hidden = true; await havastilKur(kok, { bagimsiz: true, vitrin: true }); return; }   // vitrin: yetki RPC'si ve servis çalışanı yok
  let yetkili = false;
  try { const { data, error } = await supabase.rpc("havastil_yetkisi_var_mi"); yetkili = !error && data === true; } catch { yetkili = false; }
  if (yukleniyor) yukleniyor.hidden = true;
  if (!yetkili) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "HavaStil bu hesap için açık değil. Erişim için Site Sahibi ile iletişime geç.";
    kok.replaceChildren(p);
    return;
  }
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/panel/havastil/sw.js", { scope: "/panel/havastil/" }).catch(() => { /* PWA olmadan da çalışır */ });
  await havastilKur(kok, { bagimsiz: true });
}
basla().catch((h) => { console.warn("HavaStil:", h); if (yukleniyor) yukleniyor.textContent = "Yüklenemedi. Sayfayı yenile."; });

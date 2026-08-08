/*
 * assets/js/supabase-client.js
 *
 * Tüm auth/panel/admin sayfalarının import ettiği TEK Supabase istemcisi.
 * SUPABASE_URL ve SUPABASE_ANON_KEY tamamen PUBLIC değerlerdir — bunları
 * gizlemene gerek yok, Supabase'in tasarımı zaten bu ikisinin tarayıcıda
 * açıkta olmasına göre kuruludur. Gerçek güvenlik veritabanındaki RLS
 * politikalarından gelir (bkz. 0001_schema_rbac_rls.sql). service_role
 * anahtarını ise HİÇBİR ZAMAN buraya yazma.
 */

// ---- BURAYI DOLDUR (Supabase Dashboard > Project Settings > API) ----
const SUPABASE_URL = "https://eahvcirspmvntffzphye.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVhaHZjaXJzcG12bnRmZnpwaHllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxOTgxODMsImV4cCI6MjEwMTc3NDE4M30._f-GKSsffxFo66w3g0NJfmOWEhlsjU4Y6mlcTlcPJ2E"; // "anon public" anahtarı
// -----------------------------------------------------------------------

// Supabase JS SDK'yı CDN'den ESM olarak yüklüyoruz (build sistemi gerekmez,
// GitHub Pages / Cloudflare Pages gibi saf statik hosting ile tam uyumlu).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true, // OAuth / e-posta linki dönüşünde token'ı otomatik yakalar
  },
});

/** Basit HTML escape — kullanıcıdan/DB'den gelen metni innerHTML'e basmadan önce kullan. */
export function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Küçük bir toast/uyarı yardımcı fonksiyonu — auth.css ile stillenir. */
export function showMessage(el, text, type = "error") {
  if (!el) return;
  el.textContent = text;
  el.className = `auth-message auth-message--${type}`;
  el.hidden = false;
}

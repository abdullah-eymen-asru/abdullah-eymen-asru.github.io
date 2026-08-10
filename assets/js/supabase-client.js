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

/**
 * Standart "SPAM klasörünü kontrol et" uyarısı. Mail gönderilen HER ekranda
 * (kayıt, şifremi unuttum, hesap onayla, panelde e-posta değiştirme) aynı
 * metin/mantıkla kullanılır ki kullanıcı her yerde aynı şeyi görsün.
 * showMessage() ile karışmasın diye AYRI bir kutuda (auth-spam-notice)
 * gösterilir — başarı/hata mesajı her değiştiğinde bu uyarının kaybolmaması
 * için showMessage()'dan bağımsız çalışır.
 */
export function showSpamNotice(el) {
  if (!el) return;
  el.textContent =
    "Mail birkaç dakika içinde gelmezse SPAM (Gereksiz/Junk) klasörünü de kontrol et.";
  el.hidden = false;
}

export function hideSpamNotice(el) {
  if (!el) return;
  el.hidden = true;
}

/**
 * Supabase'in verifyOtp() / OTP doğrulama akışlarından dönen İngilizce hata
 * mesajlarını kullanıcı dostu Türkçeye çevirir. hesap/sifre-guncelle.html
 * (kod ile şifre sıfırlama) ve hesap/hesap-onayla.html (kod ile hesap
 * onaylama) tarafından ortak kullanılır.
 */
export function turkceOtpHatasi(message) {
  if (!message) return "Bilinmeyen bir hata oluştu.";
  if (message.includes("expired") || message.includes("invalid") || message.includes("Token")) {
    return "Kod hatalı veya süresi dolmuş. Yeni bir link/kod iste.";
  }
  if (message.includes("Auth session missing")) {
    return "Oturum bulunamadı, tekrar dene.";
  }
  return message;
}

/**
 * Bugünün Gizlilik Politikası / KVKK metni sürüm etiketi. Metni
 * (kurumsal/gizlilik-politikasi.md) gerçekten değiştirdiğinde bu değeri de
 * güncelle — o andan itibaren yeni kayıt olanlar bu sürüme onay verir ve
 * eski üyeler panelde "güncellenmiş metni onaylaman gerekiyor" uyarısı
 * görür (bkz. panel.js).
 */
export const KVKK_METIN_SURUMU = "2026-08";

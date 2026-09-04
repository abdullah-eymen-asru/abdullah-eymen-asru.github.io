/*
 * assets/js/auth/nav-auth-hint.js
 *
 * "HESABIM ▾" TİTREMESİ (FOUC / Layout Shift) DÜZELTMESİ — parça 1/3.
 * (bkz. assets/js/auth/nav-auth-init.js ve nav-auth.js için 2/3 ve 3/3)
 *
 * SORUN: #auth-nav gerçek oturum durumunu ancak nav-auth.js (Supabase'e
 * sorup) yükledikten SONRA öğreniyor — o ana kadar statik yedek olarak
 * hep "Giriş Yap" görünüyordu. Zaten GİRİŞ YAPMIŞ bir ziyaretçi için bu,
 * sayfa her açıldığında kısa bir an "Giriş Yap" gösterip hemen ardından
 * "Hesabım ▾"ya DÖNÜŞMESİ (genişliği farklı olduğu için yan taraftaki
 * tema düğmesini de iterek bir Layout Shift yaratması) demekti — "titreme"
 * diye tarif edilen budur.
 *
 * ÇÖZÜM: tıpkı sitenin tema (dark/light) flaş'ını önleyen tekniğiyle
 * AYNI desen (bkz. _layouts/default.html <head>'indeki ilk tema script'i):
 * bir önceki ziyarette nav-auth.js'in öğrendiği "muhtemelen giriş
 * yapılmış" ipucunu localStorage'da tutuyoruz ve <html> elemanına DAHA
 * SAYFA ÇİZİLMEDEN (bu script defer/async OLMADAN, <head>'in başında,
 * senkron çalışır) bir "data-auth-hint" niteliği ekliyoruz. CSS
 * (style.css .auth-nav-fallback-*) bu niteliğe göre İLK BOYADA DOĞRUDAN
 * "Hesabım ▾" GÖRÜNÜMLÜ (ama henüz tıklanamaz) bir yedek gösterir —
 * gerçek/etkileşimli menü nav-auth.js çalışınca üzerine yazılır.
 *
 * ÖNEMLİ — bu SADECE bir "İPUCU" (hint), GERÇEK YETKİLENDİRME DEĞİL:
 * localStorage üçüncü bir tarafça değiştirilse bile bu, sadece görsel
 * yedeğin hangi metni göstereceğini etkiler; menüdeki linkler ve
 * asıl oturum durumu HER ZAMAN nav-auth.js'in Supabase'e sorduğu GERÇEK
 * sonuca göre belirlenir (bkz. RLS + auth-guard.js). Yanlış ipucu en
 * kötü ihtimalle görsel olarak yanlış (ama tıklanamaz, işlevsiz) bir
 * yedek metin gösterir; bir sonraki gerçek kontrolde düzelir.
 */
(function () {
  try {
    if (localStorage.getItem("aea_auth_hint") === "in") {
      document.documentElement.setAttribute("data-auth-hint", "in");
    }
  } catch (_err) {
    // WEBVIEW UYUMLULUĞU: localStorage kapalıysa (bkz. supabase-client.js
    // başındaki benzer not) ipucu uygulanamaz — varsayılan (Giriş Yap)
    // yedek gösterilir, sorun değil, sadece bir sonraki gerçek kontrole
    // kadar (nav-auth.js) hiç görsel iyileştirme olmaz.
  }
})();

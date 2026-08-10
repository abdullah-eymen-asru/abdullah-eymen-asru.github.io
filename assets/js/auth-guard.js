/*
 * assets/js/auth-guard.js
 *
 * "Protected route" mantığı. Statik bir sitede sunucu tarafı yönlendirme
 * olmadığı için koruma CLIENT-SIDE yapılır: sayfa önce gizlenir/yükleniyor
 * gösterilir, oturum + rol kontrolünden geçerse içerik gösterilir, geçmezse
 * giriş sayfasına yönlendirilir. GERÇEK güvenlik burada değil, veritabanı
 * RLS politikalarındadır (bkz. migration) — bu script sadece KULLANICI
 * DENEYİMİ için "yetkisiz sayfayı gösterme" katmanıdır.
 *
 * Kullanım (panel/panel.md / panel/admin.md içinde):
 *   <body class="auth-guarding">   <!-- CSS ile içerik varsayılan gizli -->
 *     <div id="app" hidden> ... asıl sayfa içeriği ... </div>
 *     <script type="module">
 *       import { requireAuth } from '/assets/js/auth-guard.js';
 *       const { session, profile } = await requireAuth({ role: 'admin' });
 *       document.getElementById('app').hidden = false;
 *     </script>
 */
import { supabase } from "./supabase-client.js";

/**
 * @param {Object} opts
 * @param {'user'|'special_user'|'admin'|null} opts.role
 *   null/undefined  -> sadece giriş yapmış olmak yeterli
 *   'special_user'  -> special_user VEYA admin erişebilir
 *   'admin'         -> sadece admin erişebilir
 * @param {string} opts.redirectTo - yetkisizse gidilecek sayfa
 */
export async function requireAuth({ role = null, redirectTo = "/hesap/giris.html" } = {}) {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirectWithReturnUrl(redirectTo);
    // Yönlendirme sırasında geri kalan kod çalışmaya devam etmesin diye
    // sonsuz bir promise döndürüp fonksiyonun asla "resolve" olmamasını
    // sağlıyoruz — sayfa zaten terk ediliyor.
    return new Promise(() => {});
  }

  // NOT: "avatar_url" ve "bio" kolonları artık hiçbir arayüzde
  // kullanılmıyor (profil fotoğrafı yükleme ve kişisel bio düzenleme
  // özellikleri kaldırıldı) — o yüzden burada da seçilmiyor, gereksiz veri
  // çekilmiyor.
  //
  // BUG FİX (KVKK onayı "her zaman onaylanmamış" görünüyordu): bu sorgu
  // kvkk_onay_verildi / kvkk_onay_versiyonu / kvkk_onay_tarihi kolonlarını
  // SEÇMİYORDU. panel.js -> wireKvkk(profile) bu alanları okuyup onay
  // durumunu çiziyor; alanlar seçilmediği için profile.kvkk_onay_verildi
  // HER ZAMAN undefined (yani "falsy") geliyordu, dolayısıyla kullanıcı
  // az önce onay verse bile (onay panel.js içinde ayrıca DB'den taze
  // profille güncelleniyordu, ama panel her açıldığında/yenilendiğinde
  // requireAuth() BAŞTAN çağrıldığı için o taze veri kayboluyor ve
  // "Henüz KVKK onayı vermemişsin" tekrar görünüyordu). Şimdi bu
  // kolonları da seçiyoruz.
  const { data: profile, error } = await supabase
    .from("profiles")
    .select(
      "id, email, full_name, role, kvkk_onay_verildi, kvkk_onay_versiyonu, kvkk_onay_tarihi"
    )
    .eq("id", session.user.id)
    .single();

  if (error || !profile) {
    console.error("Profil okunamadı:", error);
    redirectWithReturnUrl(redirectTo);
    return new Promise(() => {});
  }

  const roleOk =
    role === null ||
    profile.role === role ||
    profile.role === "admin" || // admin her zaman geçer
    (role === "special_user" && profile.role === "special_user");

  if (!roleOk) {
    // Giriş yapmış ama yetkisi yok -> panel sayfasına yolla, giriş sayfasına değil
    window.location.replace("/panel/panel.html?hata=yetkisiz");
    return new Promise(() => {});
  }

  return { session, profile };
}

function redirectWithReturnUrl(target) {
  const url = new URL(target, window.location.origin);
  url.searchParams.set("donus", window.location.pathname);
  window.location.replace(url.toString());
}

/** Oturum durumu değiştikçe (başka sekmede çıkış yapıldıysa vb.) tepki ver. */
export function onAuthStateChange(callback) {
  return supabase.auth.onAuthStateChange((event, session) => callback(event, session));
}

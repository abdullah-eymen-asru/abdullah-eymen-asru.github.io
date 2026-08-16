/*
 * assets/js/auth/auth-guard.js
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
 *       import { requireAuth } from '/assets/js/auth/auth-guard.js';
 *       const { session, profile } = await requireAuth({ role: 'admin' });
 *       document.getElementById('app').hidden = false;
 *     </script>
 */
import { supabase } from "../core/supabase-client.js";

/**
 * @param {Object} opts
 * @param {'user'|'special_user'|'editor'|'manager'|'admin'|Array<string>|null} opts.role
 *   null/undefined  -> sadece giriş yapmış olmak yeterli
 *   'special_user'  -> special_user VEYA admin erişebilir
 *   'editor'        -> editor VEYA admin erişebilir
 *   'manager'       -> manager (panelde "İçerik Sorumlusu") VEYA admin erişebilir
 *   'admin'         -> sadece admin erişebilir
 *   ['editor','manager'] -> DİZİ de verilebilir: editor, manager VEYA admin
 *                           erişebilir (bkz. panel/github-yonetim.md — hem
 *                           editor hem manager aynı yazma yetkisini
 *                           paylaştığı için bu sayfaya ikisi de girebilmeli).
 *                           "admin her zaman geçer" kuralı dizi verilse de
 *                           geçerlidir.
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

  // GÜVENLİK DÜZELTMESİ (savunma derinliği — 2FA bypass): Asıl 2FA
  // zorunluluğu giris.html'deki giriş akışında uygulanır (bkz.
  // assets/js/auth/auth-pages.js -> mfaGerekirseDogrulaVeYonlendir). Ama bu
  // korumalı sayfa (panel/admin) YİNE DE burada AYRICA kontrol ediyor:
  // kullanıcının doğrulanmış bir TOTP faktörü olduğu halde mevcut oturum
  // hâlâ AAL1'deyse (ör. eski/başka bir sekmede kalmış bir oturum, ya da
  // giriş akışı ileride başka bir yoldan bypass edilmeye çalışılırsa)
  // panel içeriği YİNE DE gösterilmez, kullanıcı giriş sayfasına
  // (donus=bu sayfa ile) geri gönderilir; orada 2FA kodu tekrar istenir.
  const { data: aal, error: aalErr } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!aalErr && aal.nextLevel === "aal2" && aal.currentLevel !== aal.nextLevel) {
    redirectWithReturnUrl(redirectTo);
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
      "id, email, first_name, last_name, full_name, role, kvkk_onay_verildi, kvkk_onay_versiyonu, kvkk_onay_tarihi"
    )
    .eq("id", session.user.id)
    .single();

  if (error || !profile) {
    console.error("Profil okunamadı:", error);
    redirectWithReturnUrl(redirectTo);
    return new Promise(() => {});
  }

  // BUG FİX: bu kontrol öncesinde SADECE role==='special_user' özel olarak
  // ele alınıyordu (zaten yukarıdaki profile.role === role satırı bunu
  // gereksiz kılıyordu) — role==='editor' için HİÇBİR dal yoktu. Sonuç:
  // github-yonetim.js'in istediği requireAuth({role:'editor'}) çağrısında
  // editor rolündeki bir kullanıcı için roleOk hiçbir zaman true olmuyor,
  // "admin her zaman geçer" satırı sadece admin'i kurtarıyordu — yani editor
  // rolündeki kullanıcılar GitHub İçerik Yönetimi paneline hiç giremiyordu
  // (bkz. panel/github-yonetim.md, dosya başındaki yorum bunun ZATEN böyle
  // çalışması gerektiğini varsayıyordu ama kod bunu sağlamıyordu). Şimdi
  // role==='editor' isteği hem 'editor' hem 'admin' profiline izin veriyor;
  // role==='special_user' isteği de aynı şekilde hem kendisine hem admin'e.
  // BUG FİX / GENİŞLETME: role artık bir DİZİ de olabilir (ör.
  // requireAuth({role:['editor','manager']})) — panel/github-yonetim.md
  // hem editor hem manager (İçerik Sorumlusu) rolündeki kullanıcılara açık
  // olduğu için tek bir string ile "ya editor ya manager" ifade edilemiyordu.
  const izinliRoller = Array.isArray(role) ? role : role === null ? [] : [role];
  const roleOk =
    role === null ||
    izinliRoller.includes(profile.role) ||
    profile.role === "admin"; // admin her zaman geçer

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

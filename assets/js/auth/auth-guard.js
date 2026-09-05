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
 * @param {'user'|'special_user'|'editor'|'manager'|'admin'|'owner'|Array<string>|null} opts.role
 *   null/undefined  -> sadece giriş yapmış olmak yeterli
 *   'special_user'  -> special_user VEYA admin/owner erişebilir
 *   'editor'        -> editor VEYA admin/owner erişebilir
 *   'manager'       -> manager (panelde "İçerik Sorumlusu") VEYA admin/owner erişebilir
 *   'admin'         -> admin VEYA owner erişebilir (owner, admin'in tüm yetkilerini
 *                      kapsar — bkz. migration 0021, "Site Sahibi" rolü)
 *   'owner'         -> SADECE owner erişebilir — TEK İSTİSNA: "admin her
 *                      zaman geçer" kuralı burada uygulanmaz, admin bu rolü
 *                      İSTEYEN bir sayfaya giremez (bkz. panel/izleme-okuma-
 *                      yonetim.md — "sadece owner, admin dahi giremez").
 *                      owner, admin'in ÜST kümesi olduğu için diğer TÜM
 *                      rollerde admin'i otomatik geçiriyoruz; ama tersi
 *                      (admin'in owner'a özel bir sayfaya girmesi) asla
 *                      doğru değil, bu yüzden sadece bu tek durumda o kural
 *                      devre dışı bırakılıyor.
 *   ['editor','manager'] -> DİZİ de verilebilir: editor, manager VEYA admin
 *                           erişebilir (bkz. panel/github-yonetim.md — hem
 *                           editor hem manager aynı yazma yetkisini
 *                           paylaştığı için bu sayfaya ikisi de girebilmeli).
 *                           "admin her zaman geçer" kuralı dizi verilse de
 *                           geçerlidir — ['owner'] TEK ELEMANLI dizi olarak
 *                           verilse bile yukarıdaki 'owner' istisnası aynen
 *                           uygulanır (bkz. aşağıdaki requestingOwnerOnly).
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
  // YURT DIŞI RIZASI (migration 0042): aydınlatma onayından (kvkk_onay_*)
  // KASITLI olarak AYRI kolonlar — yurtdisi_onay_verildi/tarihi/versiyonu.
  // panel.js -> wireKvkk(profile) artık ikisini de ayrı ayrı kontrol edip
  // sürüm/rıza güncel değilse yeniden onay istiyor; burada seçilmezse yine
  // aynı "her zaman eski görünüyor" hatası bu sefer yurt dışı rızası için
  // tekrarlanır.
  // is_suspended: migration 0021 (Admin Güvenliği / "Site Sahibi" akışı) —
  // bir admin başka bir admin tarafından askıya alınmışsa bu true olur.
  // Veritabanı tarafı zaten is_admin() içinde bunu kapatıyor (RLS/RPC
  // seviyesinde GERÇEK güvenlik orada), ama burada da kontrol ediyoruz ki
  // askıdaki bir admin panel sayfasını en azından GÖRMESİN (aşağıya bak).
  const { data: profile, error } = await supabase
    .from("profiles")
    .select(
      "id, email, first_name, last_name, full_name, role, is_suspended, kvkk_onay_verildi, kvkk_onay_versiyonu, kvkk_onay_tarihi, yurtdisi_onay_verildi, yurtdisi_onay_versiyonu, yurtdisi_onay_tarihi"
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

  // BUG FİX (owner-only sayfalara admin de girebiliyordu): aşağıdaki
  // "admin her zaman geçer" kuralı, role:'owner' isteyen sayfalarda da
  // (izinliRoller = ['owner']) koşulsuz uygulanıyordu — yani
  // requireAuth({role:'owner'}) SADECE owner'a değil, fiilen admin'e de
  // izin veriyordu. Oysa panel/izleme-okuma-yonetim.md gibi sayfalar (bkz.
  // o dosyanın ve izleme-okuma-yonetim.js'in başındaki notlar) BİLEREK
  // "sadece owner, admin dahi giremez" varsayımıyla yazılmış. owner,
  // admin'in ÜST kümesi olduğu için (admin'e açık her yere owner de
  // girebilir) bu yönde bir istisnaya hiç gerek yok — sorun SADECE ters
  // yönde (admin'in owner'a özel bir sayfaya sızması). Bu yüzden "admin her
  // zaman geçer" kuralını, İSTENEN rol(ler) TAM OLARAK ['owner'] ise devre
  // dışı bırakıyoruz; diğer tüm rol isteklerinde (admin, editor, manager,
  // special_user, ['editor','manager'] vb.) davranış DEĞİŞMEDİ.
  const requestingOwnerOnly = izinliRoller.length === 1 && izinliRoller[0] === "owner";

  const roleOk =
    role === null ||
    izinliRoller.includes(profile.role) ||
    (!requestingOwnerOnly && profile.role === "admin") || // admin her zaman geçer — owner-only hariç
    profile.role === "owner"; // owner (Site Sahibi) her durumda geçer — admin'in üst kümesi

  // ASKIDAKİ ADMİN: rol hâlâ 'admin' olsa bile (kalıcı düşürme henüz
  // sonuçlanmamış olabilir), migration 0021'deki is_admin() SQL tarafında
  // bu kişiyi zaten tüm admin RPC/RLS'lerinden dışlıyor. Burada da erken
  // kesip kafa karıştırıcı "her şey normal görünüyor ama hiçbir buton
  // çalışmıyor" deneyimini önlüyoruz — owner ASLA askıya alınamayacağı
  // için (bkz. migration) bu kontrol owner'ı etkilemez.
  const askidaAdminEngeli = profile.role === "admin" && profile.is_suspended === true && role !== null;

  if (!roleOk || askidaAdminEngeli) {
    // Giriş yapmış ama yetkisi yok -> panel sayfasına yolla, giriş sayfasına değil
    window.location.replace("/panel/panel.html?hata=yetkisiz");
    return new Promise(() => {});
  }

  return { session, profile };
}

/**
 * requireAuth()'un sarmalayıcısı — page-init script'lerindeki (panel.js,
 * admin.js, github-yonetim.js, izleme-okuma-yonetim.js, mesajlar.js,
 * admin-guvenlik.js, uye-ayarlari.js) tekrar eden kalıbı tek yerde toplar.
 *
 * BUG: requireAuth() içindeki supabase.auth.getSession() / mfa kontrolü /
 * profiles sorgusu bir AĞ HATASI (WebView'de CORS/DNS/timeout, Supabase'e
 * geçici ulaşılamaması vb.) yüzünden REJECT olursa, bunu çağıran sayfa
 * script'i (await requireAuth(...) satırından sonrası) hiç çalışmıyordu —
 * yani #loading'i gizleyip #app'i gösteren satır hiçbir zaman
 * çalıştırılmıyor ve sayfa SONSUZA DEK "Yükleniyor..." ekranında kilitli
 * kalıyordu. (ozel-icerik.js bunu kendi try/catch'iyle zaten
 * yakalıyordu; bu sarmalayıcı aynı düzeltmeyi TÜM sayfalara tek yerden
 * uyguluyor.)
 *
 * requireAuth() zaten yetkisizlik/oturumsuzluk durumunda kendi içinde
 * redirect edip sonsuz bir promise döndürüyor (bkz. yukarısı) — o akış
 * burada DEĞİŞMİYOR. Bu sarmalayıcı SADECE gerçek bir istisna (network,
 * beklenmeyen hata) fırlatıldığında devreye girip kullanıcıya "yeniden
 * dene" seçeneği sunuyor.
 */
export async function requireAuthOrShowError(opts) {
  try {
    return await requireAuth(opts);
  } catch (err) {
    console.error("requireAuth() başarısız (ağ hatası olabilir):", err);
    const loading = document.getElementById("loading");
    if (loading) {
      loading.hidden = false;
      loading.innerHTML =
        "Sayfa yüklenemedi. Bağlantını kontrol edip " +
        '<a href="javascript:location.reload()">yeniden dene</a>.';
    }
    // requireAuth() kendi hata dallarındaki davranışla tutarlı olsun diye
    // (redirect sonrası "sonsuza kadar bekleyen" promise) burada da
    // çağıran init() fonksiyonunun devam ETMEMESİ için sonsuz bir promise
    // döndürüyoruz — session/profile burada zaten yok, devam etmeye
    // çalışmak sadece konsolu ek TypeError'larla kirletirdi.
    return new Promise(() => {});
  }
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

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
import { supabase, guncelOnaySurumleri } from "../core/supabase-client.js";

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

  // SÖZLEŞME VERSİYON TAKİBİ + ESKİ KULLANICILAR İÇİN RIZA YENİLEME MODALI
  // ---------------------------------------------------------------------
  // Kullanıcının en son onayladığı Aydınlatma Metni sürümü (kvkk_onay_versiyonu)
  // güncel sürümle (site_ayarlari.guncel_kvkk_surumu) eşleşmiyorsa, aşağıdaki (ve rol
  // kontrolünden ÖNCE çalışan) modal ekranı kilitler. Rol kontrolünden önce
  // çalıştırılması bilinçlidir: yetkisi olmayan bir sayfaya giren birine
  // "önce rıza ver, sonra zaten yetkisiz olduğunu öğren" demek yerine, rıza
  // güncel olsun/olmasın herkes önce bu adımdan geçer, öyle ya da böyle
  // await ediliyor olması sayfanın geri kalanının (rol kontrolü dahil)
  // MODAL KAPANMADAN çalışmamasını garantiler.
  //
  // HUKUKİ AYRIM (bkz. migration 0042 ve kayit.md'deki notlar): bu modal
  // SADECE Aydınlatma Metni'ni okuduğuna dair beyanı (kvkk_onay_*) yeniler.
  // Yurt dışına aktarım açık rızası (yurtdisi_onay_*) BİLEREK bu modala
  // dahil edilmedi — o AYRI bir açık rızadır ve paket rıza oluşturmamak
  // için panel içindeki kendi checkbox'ıyla (bkz. panel.js -> wireKvkk)
  // ayrı olarak yönetilmeye devam eder. Bu modalın "Onayla" butonu yurt
  // dışı rızasına HİÇ dokunmaz.
  // Güncel sürüm site_ayarlari'ndan gelir (migration 0064). Okunamazsa (null)
  // kullanıcı kilitlenmez; bağlayıcı olan damga zaten DB'de (kvkk_onayini_ver).
  // AÇIK RIZA ENTEGRASYONU (migration 0070): Aydınlatma Metni (kvkk_onay_*) ve yurt dışı açık rıza metni
  // (yurtdisi_onay_*) artık AYRI sürüm etiketleri taşır ama TEK modal akışından geçer:
  //   - Aydınlatma sürümü eskiyse  -> ekranı kilitleyen "okudum" onayı (eskisi gibi),
  //   - Açık rıza sürümü eskiyse   -> YALNIZCA daha önce rıza vermiş üyeye, kutu İŞARETSİZ gelir
  //     (paket rıza yasağı: işaretlemek serbest, rıza üyelik şartı DEĞİL; işaretlemezse rıza geri çekilir).
  // Sürümler okunamazsa (null) kimse kilitlenmez; bağlayıcı damgayı DB yazar (kvkk_onayini_ver + tetikleyici).
  await onayModaliniGerekirseGoster(profile);
  onayYenidenDenetimiKur(profile);

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
    // PANEL BİRLEŞTİRİLDİ: yetkisiz kullanıcı artık birleşik panelin
    // "Panelim" sekmesine düşüyor (eski /panel/panel.html sadece bir
    // yönlendirme sayfası — oraya atmak gereksiz bir ikinci hop olurdu).
    window.location.replace("/panel/dashboard.html?hata=yetkisiz#me-panel");
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

/** Hangi onaylar eski? (sürüm okunamadıysa ilgili onay "güncel" sayılır → kimse yanlışlıkla kilitlenmez) */
function onayDurumu(profile, surumler) {
  return {
    aydinlatmaEski: !!surumler.kvkk && profile.kvkk_onay_versiyonu !== surumler.kvkk,
    rizaEski: !!surumler.riza && profile.yurtdisi_onay_verildi === true && profile.yurtdisi_onay_versiyonu !== surumler.riza,
  };
}

let _onayModaliAcik = false;

async function onayModaliniGerekirseGoster(profile) {
  if (_onayModaliAcik) return;
  const surumler = await guncelOnaySurumleri();
  const durum = onayDurumu(profile, surumler);
  if (!durum.aydinlatmaEski && !durum.rizaEski) return;
  _onayModaliAcik = true;
  try {
    await onayYenilemeModaliniGosterVeBekle(profile, surumler, durum);
  } finally {
    _onayModaliAcik = false;
  }
}

/**
 * Uzun süre açık kalan sekmede de sürüm yükseltmesi yakalansın: sekme tekrar görünür olunca (en çok 5 dakikada bir)
 * sürümler ve profilin onay kolonları DB'den tazelenir; eski onay varsa modal yeniden düşer.
 */
let _yenidenDenetimKuruldu = false;
function onayYenidenDenetimiKur(profile) {
  if (_yenidenDenetimKuruldu) return;
  _yenidenDenetimKuruldu = true;
  let son = Date.now();
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState !== "visible" || _onayModaliAcik || Date.now() - son < 5 * 60 * 1000) return;
    son = Date.now();
    try {
      await guncelOnaySurumleri({ yenile: true });
      const { data } = await supabase
        .from("profiles")
        .select("kvkk_onay_verildi, kvkk_onay_versiyonu, kvkk_onay_tarihi, yurtdisi_onay_verildi, yurtdisi_onay_versiyonu, yurtdisi_onay_tarihi")
        .eq("id", profile.id)
        .single();
      if (data) Object.assign(profile, data);
      await onayModaliniGerekirseGoster(profile);
    } catch (hata) {
      console.error("Onay sürümü yeniden denetlenemedi:", hata);
    }
  });
}

/**
 * Ekranı kilitleyen "Onay Yenileme" modalı (Aydınlatma Metni + açık rıza). DOM tamamen JS ile eklenir
 * (CSP: inline script/style/onclick YOK — tüm stil assets/css/kvkk-modal.css, etkileşim addEventListener).
 *
 * Döndürdüğü promise, kullanıcı devam edip onay veritabanına yazılana kadar RESOLVE OLMAZ. "Çıkış Yap" seçilirse
 * signOut() + ana sayfaya yönlendirme yapılır ve promise KASITLI olarak resolve edilmez (sayfa terk ediliyor).
 *
 * Tek RPC çağrısı iki beyanı birlikte ama BAĞIMSIZ yazar (kvkk_onayini_ver):
 *   p_versiyon       dolu  -> yalnızca aydınlatma eskiyse (DB kendi güncel sürümünü yazar)
 *   p_yurtdisi_onay  true/false -> yalnızca açık rıza eskiyse (kutu işaretli = yenile, işaretsiz = geri çek)
 */
function onayYenilemeModaliniGosterVeBekle(profile, surumler, durum) {
  return new Promise((resolve) => {
    if (!document.getElementById("kvkk-modal-css")) {
      const link = document.createElement("link");
      link.id = "kvkk-modal-css";
      link.rel = "stylesheet";
      link.href = "/assets/css/kvkk-modal.css";
      document.head.append(link);
    }
    const { aydinlatmaEski, rizaEski } = durum;
    const iki = aydinlatmaEski && rizaEski;

    const backdrop = document.createElement("div");
    backdrop.className = "kvkk-modal-backdrop";
    backdrop.setAttribute("role", "dialog");
    backdrop.setAttribute("aria-modal", "true");
    backdrop.setAttribute("aria-labelledby", "kvkk-modal-baslik");

    const modal = document.createElement("div");
    modal.className = "kvkk-modal";

    const baslik = document.createElement("h2");
    baslik.id = "kvkk-modal-baslik";
    baslik.textContent = iki ? "Gizlilik Metinlerimiz Güncellendi" : aydinlatmaEski ? "Aydınlatma Metnimiz Güncellendi" : "Açık Rıza Metnimiz Güncellendi";
    modal.append(baslik);

    const link = document.createElement("a");
    link.href = "/kurumsal/kvkk-aydinlatma-metni.html";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Aydınlatma Metni";
    const rizaLink = document.createElement("a");
    rizaLink.href = "/kurumsal/acik-riza-metni.html";
    rizaLink.target = "_blank";
    rizaLink.rel = "noopener noreferrer";
    rizaLink.textContent = "Açık Rıza Metni";

    if (aydinlatmaEski) {
      const metin = document.createElement("p");
      metin.append("KVKK Aydınlatma Metnimiz güncellendi. İncelemek için ", link.cloneNode(true), "'ni okuyabilirsin.");
      const altYazi = document.createElement("p");
      altYazi.className = "kvkk-modal-altyazi";
      altYazi.textContent = "Devam etmek için güncel metni okuduğunu onaylaman gerekiyor. Onaylamak istemiyorsan hesabından çıkış yapabilirsin.";
      modal.append(metin, altYazi);
    }

    let rizaKutusu = null;
    if (rizaEski) {
      const bolum = document.createElement("div");
      bolum.className = "kvkk-modal-riza";
      const ust = document.createElement("p");
      ust.append("Yurt dışına aktarım ", document.createElement("strong"), " metni güncellendi. Daha önce verdiğin açık rıza güncel metni kapsamadığı için yeniden soruyoruz. Detaylar: ", rizaLink.cloneNode(true), ".");
      ust.querySelector("strong").textContent = "açık rıza";
      rizaKutusu = document.createElement("input");
      rizaKutusu.type = "checkbox";
      rizaKutusu.id = "kvkk-modal-riza-kutu";
      rizaKutusu.checked = false; // asla önceden işaretli gelmez
      const etiket = document.createElement("label");
      etiket.className = "kvkk-modal-riza-satir";
      etiket.htmlFor = "kvkk-modal-riza-kutu";
      const aciklama = document.createElement("span");
      aciklama.textContent = "Kişisel verilerimin üyelik işlemlerinin yürütülmesi amacıyla yurt dışında (Almanya/Frankfurt) bulunan güvenli Supabase sunucularına aktarılmasına açık rıza veriyorum.";
      etiket.append(rizaKutusu, aciklama);
      const not = document.createElement("p");
      not.className = "kvkk-modal-altyazi";
      not.textContent = "Bu rıza üyeliğin için şart değildir. Kutuyu işaretlemeden devam edersen rızan geri çekilmiş olur; istediğin zaman Panelim sayfasından yeniden verebilirsin.";
      bolum.append(ust, etiket, not);
      modal.append(bolum);
    }

    const hataKutusu = document.createElement("p");
    hataKutusu.className = "kvkk-modal-hata";
    hataKutusu.hidden = true;

    const aksiyonlar = document.createElement("div");
    aksiyonlar.className = "kvkk-modal-aksiyonlar";
    const reddetBtn = document.createElement("button");
    reddetBtn.type = "button";
    reddetBtn.className = "kvkk-modal-btn kvkk-modal-btn--ikincil";
    reddetBtn.textContent = aydinlatmaEski ? "Reddet / Çıkış Yap" : "Çıkış Yap";
    const onaylaBtn = document.createElement("button");
    onaylaBtn.type = "button";
    onaylaBtn.className = "kvkk-modal-btn kvkk-modal-btn--birincil";
    const dugmeMetni = iki ? "Okudum, Devam Et" : aydinlatmaEski ? "Okudum, Onaylıyorum" : "Kaydet ve Devam Et";
    onaylaBtn.textContent = dugmeMetni;
    aksiyonlar.append(reddetBtn, onaylaBtn);

    modal.append(hataKutusu, aksiyonlar);
    backdrop.append(modal);
    document.body.append(backdrop);

    const oncekiOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const temizleVeKapat = () => {
      backdrop.remove();
      document.body.style.overflow = oncekiOverflow;
    };

    // REDDET / ÇIKIŞ: veri YAZILMAZ; bir sonraki girişte modal yine gösterilir.
    reddetBtn.addEventListener("click", async () => {
      reddetBtn.disabled = true;
      onaylaBtn.disabled = true;
      try {
        await supabase.auth.signOut();
      } catch (err) {
        console.error("Onay reddedilirken çıkış yapılamadı:", err);
      }
      window.location.href = "/";
    });

    onaylaBtn.addEventListener("click", async () => {
      hataKutusu.hidden = true;
      onaylaBtn.disabled = true;
      reddetBtn.disabled = true;
      onaylaBtn.textContent = "Kaydediliyor...";

      const rizaVerildi = rizaEski ? !!rizaKutusu.checked : null;
      const { error } = await supabase.rpc("kvkk_onayini_ver", {
        p_versiyon: aydinlatmaEski ? surumler.kvkk : null, // dolu = damgala (DB kendi sürümünü yazar); null = dokunma
        p_yurtdisi_onay: rizaEski ? rizaVerildi : null,
        p_yurtdisi_versiyon: rizaEski && rizaVerildi ? surumler.riza : null, // bilgi amaçlı; DB tetikleyicisi yazar
      });

      if (error) {
        console.error("Onay yenileme kaydedilemedi:", error);
        hataKutusu.textContent = "Onayın kaydedilemedi, lütfen tekrar dene: " + error.message;
        hataKutusu.hidden = false;
        onaylaBtn.disabled = false;
        reddetBtn.disabled = false;
        onaylaBtn.textContent = dugmeMetni;
        return;
      }

      // Bellekteki profili senkron güncelle (çağıran sayfa ekstra DB turu yapmadan doğru durumu görsün)
      const simdi = new Date().toISOString();
      if (aydinlatmaEski) {
        profile.kvkk_onay_versiyonu = surumler.kvkk;
        profile.kvkk_onay_verildi = true;
        profile.kvkk_onay_tarihi = simdi;
      }
      if (rizaEski) {
        profile.yurtdisi_onay_verildi = rizaVerildi;
        profile.yurtdisi_onay_versiyonu = rizaVerildi ? surumler.riza : null;
        profile.yurtdisi_onay_tarihi = rizaVerildi ? simdi : null;
      }
      temizleVeKapat();
      resolve();
    });
  });
}

/** Oturum durumu değiştikçe (başka sekmede çıkış yapıldıysa vb.) tepki ver. */
export function onAuthStateChange(callback) {
  return supabase.auth.onAuthStateChange((event, session) => callback(event, session));
}

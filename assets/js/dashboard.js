/*
 * assets/js/dashboard.js
 *
 * panel/dashboard.html için tek giriş noktası. Eskiden 6 ayrı sayfada
 * (admin.md, uye-ayarlari.md, admin-guvenlik.md, github-yonetim.md,
 * izleme-okuma-yonetim.md, mesajlar.md) bağımsız bağımsız çalışan 6 ayrı
 * script (admin.js, uye-ayarlari.js, admin-guvenlik.js,
 * github-yonetim/github-yonetim.js, izleme-okuma-yonetim/izleme-okuma-yonetim.js,
 * mesajlar.js) BU DOSYADAN TEK SATIR BİLE DEĞİŞMEDEN çağrılıyor.
 *
 * ÇÖZÜLEN 2 MİMARİ SORUN (bkz. panel/DASHBOARD-ENTEGRASYON.md):
 *
 *  1) YÖNLENDİRME ÇAKIŞMASI: auth-guard.js -> requireAuth() rol uymazsa
 *     window.location.replace(...) ile SAYFAYI TERK EDİYOR. 6 script'i
 *     aynı sayfada <script> ile statik yüklesek, ör. bir "editor" giriş
 *     yaptığında admin.js'in requireAuthOrShowError({role:['admin','manager']})
 *     çağrısı hemen sayfayı başka yere fırlatırdı. ÇÖZÜM: bu dosya ÖNCE
 *     TEK bir requireAuth({role:null}) ile oturumu/rolü öğrenir, sidebar'ı
 *     role göre çizer, her modülün asıl script'ini SADECE kullanıcı o
 *     sekmeye ilk kez tıkladığında dynamic import() ile yükler. Yetkisi
 *     olmayan bir modülün script'i O KULLANICI İÇİN HİÇ ÇALIŞTIRILMAZ.
 *
 *  2) ID ÇAKIŞMASI: panel/admin.md ve panel/github-yonetim.md içinde
 *     BİREBİR AYNI id'ler var: "icerik-ekle", "icerikler", "icerik-form"
 *     (iki ayrı, ilgisiz form/liste — biri özel/gizli içerik, diğeri
 *     GitHub'a yayınlanan yazılar/projeler). İkisi de aynı anda DOM'da
 *     olsaydı document.getElementById() hep İLKİNİ bulur, diğer script
 *     yanlış elemanlara bağlanırdı. ÇÖZÜM: bu iki çift <template> içinde
 *     tutulur (bkz. dashboard.html sonu) ve swapSlot() ile HER ZAMAN
 *     sadece biri gerçek DOM'a taşınır (clone DEĞİL, taşıma — aynı düğüm,
 *     event listener'lar korunur).
 *
 * KESİN KURAL: bu dosya admin.js/panel.js/uye-ayarlari.js/admin-guvenlik.js/
 * github-yonetim.js/izleme-okuma-yonetim.js/mesajlar.js içindeki TEK BİR
 * SATIRA bile dokunmaz. Hepsi olduğu gibi, değiştirilmeden import edilir.
 */

import { requireAuthOrShowError } from "./auth/auth-guard.js";
import { supabase } from "./core/supabase-client.js";
import { ayrilmayaIzinVarMi } from "./core/gezinme-kilidi.js";
import { hubCiz, sonKullanilanKaydet } from "./hub/hub.js";
// DEMO / VİTRİN MODU (migration 0083): rol 'demo' + sahte veri katmanı. Görünürlük TEK yerden gelir: demoSekmeAcikMi()
// (izinli sekme listesi + Site Sahibi'nin canlı yapılandırması). Ayrıntı: assets/js/demo/*.
import { isDemoMode, configHazir, demoSekmeAcikMi, demoHubKartiAcikMi } from "./demo/demo-durum.js";
import { hizliKur } from "./dashboard-hizli.js";

/* ------------------------------------------------------------------ */
/* 1) Modül tanımları                                                  */
/* ------------------------------------------------------------------ */

// role: null (herkes) | "admin" | "owner" | ["editor","manager"] vb.
// auth-guard.js'teki requireAuth() ile BİREBİR AYNI kural burada da
// UI/gezinme amaçlı tekrarlanıyor (gerçek güvenlik yine RLS + her
// modülün kendi requireAuthOrShowError çağrısında).
const MODULES = {
  // Ana Ekran (Hub): yerleşik görünüm, ayrı script yok (bkz. hub/hub.js). Görünürlük: giriş yapmış herkes.
  hub: { yerlesik: true, role: null },
  gy: { src: "./github-yonetim/github-yonetim.js", role: ["editor", "manager"] },
  admin: { src: "./admin.js", role: ["admin", "manager"] },
  uye: { src: "./uye-ayarlari.js", role: "admin" },
  guvenlik: { src: "./admin-guvenlik.js", role: "admin" },
  // İzleme ve Okuma Yönetimi (migration 0108): görünürlük role DEĞİL, Yetki Ayarları › "izleme_okuma_yonetimi" anahtarına bağlı (VARSAYILAN KAPALI; owner her zaman).
  izleme: { src: "./izleme-okuma-yonetim/izleme-okuma-yonetim.js", role: null },
  // Site Duyuruları (migration 0113): görünürlük role DEĞİL, Yetki Ayarları › "duyuru_yonetimi" anahtarına bağlı (VARSAYILAN KAPALI; owner her zaman).
  duyuru: { src: "./duyuru/duyuru-yonetim.js", role: null },
  mesajlar: { src: "./mesajlar.js", role: null },
  // Notlarım (uçtan uca şifreli not sistemi) — yayıncılık akışındaki
  // roller (editor/manager; admin ve owner otomatik geçer). SQL: not_modulu_yetkili().
  notlar: { src: "./notlar/notlar.js", role: ["editor", "manager"] },
  // R2 Dosya Yöneticisi: sekme görünürlüğü role DEĞİL, r2_arsiv_yetkilerim() izinlerine bağlı
  // (bkz. NAV'daki izin:"arsiv" ve gorunurMu()). Gerçek yetki: RLS + r2_arsiv_worker.
  arsiv: { src: "./r2-arsiv/r2-arsiv.js", role: null },
  arsivIzin: { src: "./r2-arsiv/izin-paneli.js", role: "admin" },            // yalnızca Yetki Ayarları erişimi olan yönetici yükler (GIRIS_YETKILI_YONETIM); gerçek sınır SQL (0108)
  // Akademik Kütüphane: sekme görünürlüğü Yetki Ayarları matrisindeki "akademik_kutuphane" özelliğine bağlı
  // (NAV'daki ozellik alanı + izinleriYukle). role:null -> tüm roller; gerçek yetki: RLS (0072) + worker.
  // İki sekme aynı modülü paylaşır (assets/js/akademik/kutuphane.js); modül #ak-kok / #ak-owner-kok'u kurar.
  kutuphane: { src: "./akademik/kutuphane.js", role: null },
  // Yetki Ayarları > "Alan Adı & Sayfa Erişim Kalkanı" (gatekeeper; migration 0061).
  // Gerçek yetki: site_ayarlari UPDATE politikası + owner RPC'leri is_owner() ister.
  kalkan: { src: "./gatekeeper/kalkan-paneli.js", role: "admin" },             // yönetici: yalnızca "kilitli siteyi görme izni" listesi (0109); site geneli ayarlar owner'da
  // "KVKK Sürümü" (site_ayarlari.guncel_kvkk_surumu; migration 0064/0065). Owner her zaman,
  // admin yalnızca owner anahtarı açıksa görür (NAV'daki izin:"kvkk"). Gerçek yetki:
  // kvkk_surum_yetkisi_var_mi() -> kvkk_surumunu_degistir() / kvkk_onay_ozeti().
  kvkkSurum: { src: "./kvkk/kvkk-surum-paneli.js", role: "admin" },
  // "Panelim" (eski /panel/panel.html) — giriş yapmış HERKESE açık:
  // sıradan üye de, owner da aynı sekmeyi görür.
  panelim: { src: "./panel.js", role: null },
  // Üye verisi dışa aktarma izinleri (migration 0069) — SADECE Site Sahibi: hangi yönetici hangi üyelerin verisini indirebilir.
  uyeAktarimYetki: { src: "./uye-disa-aktar/yetki-paneli.js", role: "admin" },  // yönetici: güvenli devir kuralıyla (0110)
  // Sistem Yedekleme & Depolama Yönetimi (migration 0074). Sekme görünürlüğü role DEĞİL, can_export_system
  // anahtarına bağlı (NAV'daki izin:"sistemyedek" + izinleriYukle). Gerçek yetki: RPC'ler + sistem-yedek-worker.
  sistemYedek: { src: "./sistem-yedek/sistem-yedek.js", role: null },
  // Evrensel Dosya Dönüştürücü & Belge Düzenleyici (migration 0077). %100 istemci tarafı; sekme görünürlüğü role DEĞİL,
  // can_use_converter anahtarına bağlı (NAV'daki izin:"donusturucu" + izinleriYukle). Modül kendi içinde RPC ile tekrar doğrular (Guard).
  donusturucu: { src: "./donusturucu/donusturucu.js", role: null },
  // Belge Tarayıcı & Çoklu Birleştirici (assets/js/belge-tarayici/): %100 istemci, sıfır sunucu isteği. Yetki Dönüştürücü ile AYNI
  // (can_use_converter → NAV'daki izin:"donusturucu"); modül kendi içinde donusturucu_yetkisi_var_mi() ile tekrar doğrular (Guard).
  belgeTarayici: { src: "./belge-tarayici/belge-tarayici.js", role: null },
  // Evrensel Metadata Temizleyici (assets/js/metadata-temizleyici/): Araçlar altında kendi sekmesi; yetki Dönüştürücü ile AYNI (can_use_converter).
  metadata: { src: "./metadata-temizleyici/metadata-temizleyici.js", role: null },
  // HavaStil (migration 0099): hava durumuna göre katman/giyim danışmanı. Görünürlük role DEĞİL, Yetki Ayarları › Özellikler'deki
  // "havastil" anahtarına bağlı (VARSAYILAN KAPALI; owner her zaman). NAV'daki izin:"havastil" + izinleriYukle. Modül kendi içinde RPC ile tekrar doğrular.
  havastil: { src: "./havastil/panel.js", role: null },
  // Silinen hesapların artık verisi (migration 0078). Görünürlük: owner her zaman; admin yalnızca owner anahtarı açıksa
  // (NAV'daki izin:"silmeonayi"). Gerçek yetki RPC'lerde; kalıcı silme yalnızca owner (Edge Function).
  silmeOnayi: { src: "./silme-onayi/silme-onayi.js", role: null },
  // Demo Yetki & Görünürlük Paneli: owner her zaman; admin salt-okunur görür, yazma yetkisini DB (demo_config_kaydet) verir.
  demoYetki: { src: "./demo/demo-yetki-paneli.js", role: "admin" },
  // Demo "Sistem / Metrikler" sekmesi: statik vitrin grafikleri (yalnızca demo modunda görünür; bkz. gorunurMu -> demoOnly).
  demoMetrik: { src: "./demo/demo-metrik.js", role: null },
};

// Sidebar hiyerarşisi. Her leaf: { id, label, view (gösterilecek
// #view-* elemanının sonu), module (MODULES anahtarı) }
const NAV = [
  {
    // Herkese açık grup — sıradan bir üye panele girdiğinde SADECE bunu
    // (ve Sohbet/Mesajlar'ı) görür.
    group: "Hesabım",
    icon: "🙍",
    items: [
      // defaultAcilis:false -> yetkisi olan bir yönetici panele girdiğinde
      // varsayılan olarak "Panelim" DEĞİL, ilk yetkili iş sekmesi açılır;
      // başka hiçbir sekmeye yetkisi olmayan üye içinse zaten tek seçenek
      // budur (bkz. firstAvailableView).
      // Ana Ekran: rol/yetkiye göre erişilebilen TÜM modüller tek ekranda (kartlar + arama). Varsayılan açılış.
      { id: "me-hub", icon: "🧭", label: "Ana Ekran", module: "hub", role: null },
      // Her üye kendi verisini yedekler/geri yükler (KVKK taşınabilirlik); Site Sahibi aynı ekranda tam sistem araçlarını da görür.
      { id: "sys-yedek", icon: "📦", label: "Yedekleme & Verilerim", module: "sistemYedek", role: null, izin: "sistemyedek", defaultAcilis: false },
      { id: "me-panel", icon: "🙍", label: "Panelim", module: "panelim", role: null, defaultAcilis: false },
    ],
  },
  {
    group: "İçerik Yönetimi",
    icon: "📝",
    items: [
      { id: "content-all", icon: "📚", label: "Tüm Yazılar & Projeler", module: "gy" },
      { id: "content-new", icon: "➕", label: "Yeni İçerik Ekle", module: "gy" },
      // defaultAcilis:false -> owner bir üyeye modülü açtığında o üyenin giriş sonrası varsayılan sekmesi
      // (adreste # yokken) değişmesin; notlar kendiliğinden açılmasın. Editor/manager/admin için
      // varsayılan açılış zaten daha önceki "içerik" sekmeleridir, onlar değişmez.
      { id: "content-notlar", icon: "🗒️", label: "Notlarım", module: "notlar", defaultAcilis: false },
      // role override: admin modülü (MODULES.admin) editor'e AÇILMAZ (sys-hesabim gibi sekmeler admin/manager
      // kalsın); bu iki sekme ise Yetki Ayarları'nda editor için de açılıp kapanır (migration 0066).
      // ozellik: owner kapattıysa (admin/manager/editor fark etmez) sekme hiç çizilmez; gerçek sınır RLS + worker.
      { id: "content-private", icon: "🔒", label: "Özel / Gizli Makaleler", module: "admin", role: ["admin", "manager", "editor"], ozellik: "ozel_icerik_yonetimi" },
      { id: "content-folders", icon: "📁", label: "Klasör Yönetimi", module: "gy" },
    ],
  },
  {
    group: "Medya & Takip",
    icon: "📁",
    items: [
      { id: "media-r2", icon: "🗂️", label: "R2 Dosya Paylaşımı", module: "admin", role: ["admin", "manager", "editor"], ozellik: "dosya_paylasimi_yonetimi" },
      { id: "media-arsiv", icon: "🗄️", label: "Dosya Yöneticisi", module: "arsiv", role: null, izin: "arsiv", defaultAcilis: false },
      { id: "media-izleme", icon: "🎬", label: "İzleme ve Okuma Yönetimi", module: "izleme", role: null, izin: "izleme" },
      { id: "media-cv", icon: "📄", label: "Özgeçmiş (CV) & Profil Görseli", module: "gy" },
    ],
  },
  {
    group: "Akademik Kütüphane",
    icon: "📚",
    items: [
      { id: "lib-kutuphane", icon: "📖", label: "Kütüphanem", module: "kutuphane", role: null, ozellik: "akademik_kutuphane", defaultAcilis: false },
      // Site sahibi merkezi denetimi: tüm üyelerin kaynakları, PDF'leri ve notları (salt okuma) + okuyucu motoru sürümü.
      { id: "lib-tum", icon: "🛡️", label: "Tüm Kullanıcıların Kaynakları", module: "kutuphane", role: "owner", defaultAcilis: false },
    ],
  },
  {
    group: "Kullanıcı & İletişim",
    icon: "👥",
    items: [
      { id: "users-uye", icon: "👤", label: "Üye Ayarları", module: "uye" },
      { id: "users-mesajlar", icon: "💬", label: "Sohbet / Mesajlar", module: "mesajlar" },
    ],
  },
  {
    group: "Araçlar",
    icon: "🧰",
    items: [
      // role:null + izin:"donusturucu": owner her zaman görür; diğer roller yalnızca can_use_converter açıksa.
      // Menüde görünmeyen rol, #tool-donusturucu adresine gitse bile hash Guard'ına (gorunurMu) takılır.
      { id: "tool-donusturucu", icon: "🔄", label: "Dönüştürücü & Editör", module: "donusturucu", role: null, izin: "donusturucu", defaultAcilis: false },
      { id: "tool-belge-tarayici", icon: "📑", label: "Belge Tarayıcı & Birleştirici", module: "belgeTarayici", role: null, izin: "donusturucu", defaultAcilis: false },
      { id: "tool-metadata", icon: "🧼", label: "Metadata Temizleyici", module: "metadata", role: null, izin: "donusturucu", defaultAcilis: false },
      // role:null + izin:"havastil": owner her zaman görür; diğer roller yalnızca Yetki Ayarları'nda HavaStil açıldıysa.
      { id: "tool-havastil", icon: "🌦️", label: "HavaStil (Giyim Danışmanı)", module: "havastil", role: null, izin: "havastil", defaultAcilis: false },
    ],
  },
  {
    group: "Sistem & Güvenlik",
    icon: "⚙️",
    items: [
      { id: "sys-guvenlik", icon: "🛡️", label: "Admin Güvenliği", module: "guvenlik" },
      // MADDE 4: "Yetki Ayarları" eskiden "GitHub / Worker Bağlantı Durumu"
      // görünümünün ALTINDA, ikinci bir blok olarak duruyordu — aslında
      // bambaşka bir konu olduğu için artık KENDİ sekmesi. Script'i (gy)
      // aynı, ama görünürlüğü owner'a sabitlenmiş durumda: github-yonetim.js
      // -> wireYetkiAyarlari() zaten owner değilse bölümü DOM'dan siliyor,
      // burada da sidebar linkini hiç çizmiyoruz (item.role override'ı).
      { id: "sys-yetki", icon: "🔐", label: "Yetki Ayarları", module: "gy", role: "admin", izin: "yetkiayarlari", defaultAcilis: false },
      { id: "sys-duyuru", icon: "📢", label: "Site Duyuruları", module: "duyuru", role: null, izin: "duyuru", defaultAcilis: false },
      // role:"admin" + izin:"kvkk": owner her zaman görür; admin sadece owner "adminler KVKK
      // sürümünü değiştirebilsin" anahtarını açtıysa (bkz. gorunurMu / izinleriYukle).
      { id: "sys-kvkk", icon: "📜", label: "Hukuki Metinler", module: "kvkkSurum", role: "admin", izin: "kvkk" },
      // "Üye Verisi İndirme" ve "Demo Yetki & Görünürlük" artık Yetki Ayarları'nın alt sekmeleridir (tek çatı; eski #sys-uye-aktarim / #sys-demo adresleri yönlendirilir).
      // role:null + izin:"sistemyedek": owner her zaman görür; diğer roller yalnızca owner can_export_system'i açtıysa.
      { id: "sys-silme-onayi", icon: "🧹", label: "Silinen Hesap Verileri", module: "silmeOnayi", role: null, izin: "silmeonayi", defaultAcilis: false },
      // Demo Yetki & Görünürlük Paneli: owner her zaman; admin (rol:"admin" kapısı) salt-okunur görür, yazma DB'de.
      // Demo modunda görünen statik "Sistem / Metrikler" sayfası (gerçek R2/Supabase metriği DEĞİL).
      { id: "sys-metrik", icon: "📊", label: "Sistem / Metrikler", module: "demoMetrik", role: null, demoOnly: true, defaultAcilis: false },
      { id: "sys-github", icon: "🔑", label: "GitHub / Worker Bağlantısı", module: "gy" },
      { id: "sys-hakkimda", icon: "🙋", label: "Hakkımda & Sosyal Linkler", module: "gy" },
      { id: "sys-hesabim", icon: "⚠️", label: "Hesabım (Tehlikeli Bölge)", module: "admin" },
    ],
  },
];

// Bir sekmenin gerektirdiği rol: varsa sekmenin KENDİ "role" alanı
// (ör. Yetki Ayarları -> owner), yoksa modülün rolü.
function itemRole(item) {
  return item.role !== undefined ? item.role : MODULES[item.module].role;
}

/* ------------------------------------------------------------------ */
/* 2) Rol kontrolü — auth-guard.js -> requireAuth() ile AYNI mantık    */
/* ------------------------------------------------------------------ */

function roleAllowed(required, profile) {
  if (required === null || required === undefined) return true;
  const list = Array.isArray(required) ? required : [required];
  const ownerOnly = list.length === 1 && list[0] === "owner";
  const roleOk =
    list.includes(profile.role) ||
    (!ownerOnly && profile.role === "admin") ||
    profile.role === "owner";
  const suspendedBlock = profile.role === "admin" && profile.is_suspended === true;
  return roleOk && !suspendedBlock;
}

// Rol kuralı + (varsa) dinamik izin kuralı. izin:"arsiv" -> r2_arsiv_yetkilerim()
// sonucundan en az biri true (ya da kendisine şifreli dosya paylaşılmış) olmalı.
function gorunurMu(item, profile) {
  // DEMO: yalnızca izinli demo sekmeleri ve yalnızca yapılandırmada açıksa; rol/izin RPC'leri hiç sorulmaz.
  if (isDemoMode) return demoSekmeAcikMi(item.id);
  if (item.demoOnly) return false; // demo'ya özel sekme, gerçek hesaplarda yok
  if (!roleAllowed(itemRole(item), profile)) return false;
  // Owner'ın Yetki Ayarları'ndan kapattığı özellik: sekme hiç görünmesin (owner etkilenmez).
  if (item.ozellik && profile.role !== "owner" && profile.izinler?.ozellikler?.[item.ozellik] === false) {
    return false;
  }
  if (item.izin === "sistemyedek") {
    return true; // artık herkes: kendi verisini yedekleme / geri yükleme (migration 0084). Tam sistem araçları arayüzde ve RPC'de ayrıca kapılı. (Demo modunda yukarıdaki demoSekmeAcikMi erken döner.)
  }
  if (item.izin === "yetkiayarlari") {
    return profile.role === "owner" || (profile.role === "admin" && !!profile.izinler?.yetkiAyarlari);
  }
  if (item.izin === "izleme") {
    return profile.role === "owner" || (profile.role === "admin" && !!profile.izinler?.izleme);
  }
  if (item.izin === "duyuru") {
    return profile.role === "owner" || (profile.role === "admin" && !!profile.izinler?.duyuru);
  }
  if (item.izin === "silmeonayi") {
    return profile.role === "owner" || (profile.role === "admin" && !!profile.izinler?.silmeOnayi);
  }
  if (item.izin === "donusturucu") {
    return profile.role === "owner" || !!profile.izinler?.donusturucu;
  }
  if (item.izin === "kvkk") {
    return profile.role === "owner" || !!profile.izinler?.kvkk;
  }
  if (item.izin === "havastil") {
    return profile.role === "owner" || !!profile.izinler?.havastil;
  }
  if (item.izin === "arsiv") {
    const y = profile.izinler?.arsiv;
    return !!(y && (y.oku || y.yukle || y.sil || y.paylasilan_var));
  }
  return true;
}

async function izinleriYukle(rol) {
  // Yetki Ayarları'nda rol bazında kapatılabilen özellikler (ozellik_erisimi_var_mi; hata/ağ sorununda
  // güvenli varsayılan "açık" — asıl sınır RLS ve worker'da).
  const ozellikSor = (anahtar) =>
    supabase
      .rpc("ozellik_erisimi_var_mi", { p_ozellik: anahtar, p_rol: rol })
      .then((r) => (r.error ? true : r.data !== false))
      .catch(() => true);
  const [arsiv, kvkk, ozelIcerik, dosyaPaylasimi, akademikKutuphane, sistemYedek, donusturucu, silmeOnayi, yetkiAyarlari, havastil, izleme, duyuru] = await Promise.all([
    supabase.rpc("r2_arsiv_yetkilerim").then((r) => (r.error ? undefined : r.data)).catch(() => undefined),
    supabase.rpc("hukuki_metin_yetkisi_var_mi").then((r) => (r.error ? false : !!r.data)).catch(() => false),
    ozellikSor("ozel_icerik_yonetimi"),
    ozellikSor("dosya_paylasimi_yonetimi"),
    ozellikSor("akademik_kutuphane"),
    // can_export_system: varsayılan KAPALI → hata/ağ sorununda da false (kvkk ile aynı güvenli yön).
    supabase.rpc("sistem_export_yetkisi_var_mi").then((r) => (r.error ? false : !!r.data)).catch(() => false),
    // can_use_converter: varsayılan KAPALI → hata/ağ sorununda da false (güvenli yön).
    supabase.rpc("donusturucu_yetkisi_var_mi").then((r) => (r.error ? false : !!r.data)).catch(() => false),
    // hesap_silme_onayi: varsayılan KAPALI → hata/ağ sorununda false.
    supabase.rpc("hesap_silme_inceleme_yetkisi_var_mi").then((r) => (r.error ? false : !!r.data)).catch(() => false),
    // adminler Yetki Ayarları'na erişebilsin (migration 0079): varsayılan KAPALI.
    supabase.rpc("yetki_ayarlari_yonetim_yetkisi_var_mi").then((r) => (r.error ? false : !!r.data)).catch(() => false),
    // havastil (migration 0099): varsayılan KAPALI → hata/ağ sorununda ya da migration yoksa false (güvenli yön).
    supabase.rpc("havastil_yetkisi_var_mi").then((r) => (r.error ? false : !!r.data)).catch(() => false),
    // izleme_okuma_yonetimi (migration 0108): varsayılan KAPALI → hata/migration yoksa false.
    supabase.rpc("izleme_okuma_yonetimi_yetkili").then((r) => (r.error ? false : !!r.data)).catch(() => false),
    // duyuru_yonetimi (migration 0113): varsayılan KAPALI → hata/migration yoksa false.
    supabase.rpc("duyuru_yonetim_yetkili").then((r) => (r.error ? false : !!r.data)).catch(() => false),
  ]);
  return {
    arsiv,
    kvkk,
    sistemYedek,
    donusturucu,
    silmeOnayi,
    yetkiAyarlari,
    havastil,
    izleme,
    duyuru,
    ozellikler: { ozel_icerik_yonetimi: ozelIcerik, dosya_paylasimi_yonetimi: dosyaPaylasimi, akademik_kutuphane: akademikKutuphane },
  };
}

/* ------------------------------------------------------------------ */
/* 3) Swap-slot mekanizması (id çakışan 2 çift için)                   */
/* ------------------------------------------------------------------ */

// Her "kaynak" (template) sadece BİR KEZ, ilk ihtiyaç duyulduğunda asıl
// DOM'a taşınır (template.content.firstElementChild -> appendChild,
// clone DEĞİL). Sonraki her taşımada AYNI düğüm hareket eder, böylece
// github-yonetim.js / admin.js'in daha önce bu düğümlere taktığı
// event listener'lar kaybolmaz.
const swapCache = new Map(); // templateId -> canlı DOM düğümü

function nodeFor(templateId) {
  if (!swapCache.has(templateId)) {
    const tpl = document.getElementById(templateId);
    const node = tpl.content.firstElementChild;
    swapCache.set(templateId, node);
  }
  return swapCache.get(templateId);
}

function swapSlot(slotId, templateId) {
  const slot = document.getElementById(slotId);
  const node = nodeFor(templateId);
  if (node.parentElement !== slot) {
    slot.replaceChildren(node);
  }
}

// Bir slotu boşaltır (içindeki düğümü DOM'dan söker) ama düğümü SİLMEZ —
// swapCache'te canlı referans olarak kalmaya devam eder, event listener'ları
// korunur ve swapSlot() ile daha sonra başka/aynı bir slota tekrar
// taşınabilir. detachSlot sadece "şu an bu slotta bir şey varsa çıkar"
// yapar; slot zaten boşsa no-op'tur.
function detachSlot(slotId) {
  const slot = document.getElementById(slotId);
  if (slot && slot.firstElementChild) slot.replaceChildren();
}

// content-all / content-new: gy varyantı slot-icerikler / slot-icerik-ekle'de
// content-private: admin varyantı slot-icerikler-private / slot-icerik-ekle-private'ta
//
// BUG FİX 1 (kaybolan "Yazar" alanı / çalışmayan "Yeni İçerik Ekle" formu):
// gy ("github-yonetim.js") modülü SADECE İLK yüklendiğinde çalışan tek bir
// init() içinde hem "icerik-ekle" (content-new) HEM "icerikler"
// (content-all) bölümlerindeki elemanlara bağlanıyor (wireYazarAlani,
// wireIcerikForm, wireEditorToolbar, wireIcerikListe, wireAkademikToggle,
// wireIcerikTuruToggle, wireYayindaCanliOnizleme, wireAdminAdinaTalep vb. —
// bkz. github-yonetim.js -> init()). ensureModuleLoaded() bu init()'i bir
// DAHA ASLA tekrar çalıştırmıyor. Eskiden bu fonksiyon SADECE o an
// gösterilecek viewId'nin şablonunu gerçek DOM'a taşıyordu — yani kullanıcı
// ilk "Tüm Yazılar & Projeler"e (content-all) girdiğinde gy modülü
// yüklenip init() çalışırken "Yeni İçerik Ekle" (content-new) şablonu
// HENÜZ DOM'da değildi; wireYazarAlani/wireIcerikForm gibi fonksiyonlar
// document.getElementById() ile o elemanları bulamayıp sessizce hiçbir şey
// yapmadan çıkıyordu (bu fonksiyonların başındaki "if (!el) return"
// korumaları yüzünden hata bile fırlatmıyordu). Kullanıcı SONRA "Yeni
// İçerik Ekle"ye geçtiğinde şablon DOM'a taşınıyordu ama artık ona
// bağlanacak hiçbir olay dinleyicisi yoktu — yazar arama kutusu hiç
// görünmüyor, kaydet butonları hiçbir şey yapmıyordu.
//
// ÇÖZÜM: gy modülüne ait HER İKİ şablon da (icerikler + icerik-ekle),
// hangi gy sekmesi önce açılırsa açılsın, HER ZAMAN BİRLİKTE gerçek DOM'a
// taşınır. Böylece gy modülünün TEK SEFERLİK init()'i çalıştığı anda ikisi
// de DOM'da hazır olur ve tüm wireX() fonksiyonları elemanları sorunsuz
// bulur.
//
// BUG FİX 1b (admin.js için AYNI hastalık): admin.js -> init() de SADECE
// İLK yüklendiğinde çalışan tek bir adımlar dizisiyle "içerik listesi"
// (loadContents -> #icerik-liste), "içerik atama arama"
// (wireIcerikAtamaArama -> #icerik-atama-arama) ve "içerik formu"
// (wireContentForm -> #icerik-form) elemanlarına bağlanıyor — ama admin
// modülü content-private DIŞINDA media-r2 ve sys-hesabim sekmelerinden de
// yüklenebiliyor. Kullanıcı "Özel / Gizli Makaleler"den ÖNCE "R2 Dosya
// Paylaşımı"nı ya da "Hesabım"ı ziyaret ederse, admin.js'in init()'i o
// anda çalışır ama admin'in private şablonu HENÜZ DOM'da değildir — gy
// tarafındakiyle BİREBİR AYNI sessiz başarısızlık.
//
// BUG FİX 2 (id çakışması riski): "icerikler"/"icerik-ekle"/"icerik-form"
// id'leri gy VE admin (content-private) varyantlarında BİREBİR AYNI. Her
// iki modül de kendi varyantını (BUG FİX 1/1b sayesinde artık) HANGİ
// kendi sekmesinden girilirse girilsin DOM'a taşıdığından, owner/admin bir
// gy sekmesini VE bir admin sekmesini aynı oturumda ziyaret ederse iki
// farklı "icerik-form" düğümü AYNI ANDA gerçek DOM'da bulunur —
// document.getElementById("icerik-form") gibi çağrılar o zaman (belge
// sırasında önce gelen) YANLIŞ düğümü bulur ve diğer modülün formu
// sessizce bozulur. ÇÖZÜM: gy varyantı ile admin (private) varyantı
// KARŞILIKLI DIŞLAMALI — hangisine geçiliyorsa ÖNCE diğeri kendi
// slot'undan söktürülür (detachSlot, düğüm silinmez/listener'lar
// kaybolmaz), SONRA istenen varyant kendi slot'una taşınır. Böylece
// "icerikler"/"icerik-ekle" id'li düğümlerden HER ZAMAN sadece biri (gy
// VEYA admin) gerçek DOM'dadır — hangi modülün sekmesindeysek o modülün
// varyantı.
function ensureContentSlots(viewId, moduleKey) {
  if (moduleKey === "admin") {
    detachSlot("slot-icerikler");
    detachSlot("slot-icerik-ekle");
    swapSlot("slot-icerik-ekle-private", "tpl-admin-icerik-ekle");
    swapSlot("slot-icerikler-private", "tpl-admin-icerikler");
  } else if (moduleKey === "gy") {
    detachSlot("slot-icerik-ekle-private");
    detachSlot("slot-icerikler-private");
    swapSlot("slot-icerikler", "tpl-gy-icerikler");
    swapSlot("slot-icerik-ekle", "tpl-gy-icerik-ekle");
  } else if (moduleKey === "notlar") {
    // Not sistemi id çakışması yaratmaz ("nt-" önekli); tek yönlü taşıma yeterli.
    swapSlot("slot-notlar", "tmpl-notlar");
  }
}

/* ------------------------------------------------------------------ */
/* 4) Modül script'lerini tembel (lazy) yükleme                        */
/* ------------------------------------------------------------------ */

const loadedModules = new Set();

async function ensureModuleLoaded(key, viewId) {
  if (!MODULES[key]?.src) return; // yerleşik görünüm (hub): yüklenecek script yok
  if (loadedModules.has(key)) return;
  loadedModules.add(key);
  try {
    await import(MODULES[key].src);
  } catch (err) {
    loadedModules.delete(key);
    console.error(`dashboard.js: "${key}" modülü yüklenemedi:`, err);
    // Sessizce "Yükleniyor..." ekranında kalma: nedeni ve yeniden deneme düğmesini görünür yap.
    const hedef = (viewId && document.getElementById(viewId)) || document.querySelector("#dash-main, main");
    if (hedef && !hedef.querySelector(".dash-modul-hata")) {
      const kutu = document.createElement("div"); kutu.className = "auth-message error dash-modul-hata"; kutu.setAttribute("role", "alert");
      const metin = document.createElement("p"); metin.textContent = `Bu bölüm yüklenemedi: ${err?.message || err}`;
      const dugme = document.createElement("button"); dugme.type = "button"; dugme.className = "btn"; dugme.textContent = "Yeniden dene";
      dugme.addEventListener("click", () => window.location.reload());
      kutu.append(metin, dugme); hedef.prepend(kutu);
    }
  }
}

/* ------------------------------------------------------------------ */
/* 5) Sidebar çizimi + görünüm değiştirme                              */
/* ------------------------------------------------------------------ */

let activeViewId = null;
let GIRIS_PROFIL_ROLU = null;
/** Site Sahibi ya da Yetki Ayarları erişimi AÇIK yönetici: tüm Yetki Ayarları sekmeleri bunlar için yüklenir (gerçek sınır SQL'dedir). */
let GIRIS_YETKILI_YONETIM = false;

function buildSidebar(profile) {
  const nav = document.getElementById("dash-nav");
  nav.replaceChildren();

  for (const group of NAV) {
    const visibleItems = group.items.filter((it) =>
      gorunurMu(it, profile)
    );
    if (visibleItems.length === 0) continue;

    // ANA SEKME (accordion başlığı). Eskiden burası tıklanamayan düz bir
    // yazıydı ve altındaki TÜM linkler her zaman açıktı — sol menüde aynı
    // anda 13 satır yazı durduğu için kalabalık görünüyor, odağı
    // dağıtıyordu. Artık 4 ana sekme var; sadece içinde bulunduğun grup
    // açık kalıyor (aşağıdaki gruplariAc/accordion mantığı).
    const baslik = document.createElement("button");
    baslik.type = "button";
    baslik.className = "dash-nav-group";
    baslik.setAttribute("aria-expanded", "false");

    const etiket = document.createElement("span");
    etiket.className = "dash-nav-group-label";
    etiket.textContent = `${group.icon} ${group.group}`;

    const ok = document.createElement("span");
    ok.className = "dash-nav-group-ok";
    ok.textContent = "›";
    ok.setAttribute("aria-hidden", "true");

    baslik.append(etiket, ok);

    const kutu = document.createElement("div");
    kutu.className = "dash-nav-group-items";
    kutu.hidden = true;
    const kutuId = `dash-nav-grup-${NAV.indexOf(group)}`;
    kutu.id = kutuId;
    baslik.setAttribute("aria-controls", kutuId);

    baslik.addEventListener("click", () => {
      const acik = baslik.getAttribute("aria-expanded") === "true";
      // Akordeon: bir grup açılınca diğerleri kapanır (menü hiçbir zaman
      // uzun bir liste haline gelmez). Aynı gruba tekrar basmak kapatır.
      kapatTumGruplar();
      if (!acik) acGrup(baslik);
    });

    nav.append(baslik, kutu);

    for (const item of visibleItems) {
      const a = document.createElement("a");
      a.href = `#${item.id}`;
      a.dataset.viewId = item.id;
      a.dataset.module = item.module;

      const ikon = document.createElement("span");
      ikon.className = "dash-nav-ikon";
      ikon.textContent = item.icon || "•";
      ikon.setAttribute("aria-hidden", "true");

      const yazi = document.createElement("span");
      yazi.textContent = item.label;

      a.append(ikon, yazi);
      a.addEventListener("click", (e) => {
        e.preventDefault();
        showView(item.id, item.module);
        closeMobileSidebar();
      });
      kutu.appendChild(a);
    }
  }
}

function acGrup(baslik) {
  baslik.setAttribute("aria-expanded", "true");
  const kutu = document.getElementById(baslik.getAttribute("aria-controls"));
  if (kutu) kutu.hidden = false;
}

function kapatTumGruplar() {
  document.querySelectorAll(".dash-nav-group").forEach((b) => {
    b.setAttribute("aria-expanded", "false");
    const kutu = document.getElementById(b.getAttribute("aria-controls"));
    if (kutu) kutu.hidden = true;
  });
}

// Aktif sekmeyi içeren grubu aç, diğerlerini kapat; ayrıca kapalı grubun
// başlığında da aktiflik belli olsun diye işaretle.
function aktifGrubuAc(viewId) {
  const link = document.querySelector(`#dash-nav a[data-view-id="${viewId}"]`);
  const kutu = link?.closest(".dash-nav-group-items");
  document.querySelectorAll(".dash-nav-group").forEach((b) => {
    const icerir = b.getAttribute("aria-controls") === kutu?.id;
    b.dataset.aktifIcerir = icerir ? "true" : "false";
  });
  if (!kutu) return;
  kapatTumGruplar();
  const baslik = kutu.previousElementSibling;
  if (baslik) acGrup(baslik);
}

let gecisSuruyor = false;
let hubNesnesi = null;
let hubVerisi = null; // { gruplar, profil }

/** Yeni derleme varsa hedef sekmeyle sayfayı yeniler (true döner → çağıran geçişi bırakır). Kaydedilmemiş iş sorusu bundan ÖNCE sorulmuştur. */
async function yeniSurumVarsaYenile(hedefViewId) {
  try {
    if (typeof window.aeaSurumKontrol !== "function") return false;
    const yeni = (await window.aeaSurumKontrol(false)) || (window.aeaYeniSurumVarMi && window.aeaYeniSurumVarMi());
    if (!yeni) return false;
    const not = document.createElement("div");
    not.className = "aea-guncelleme-notu"; not.setAttribute("role", "status");
    not.textContent = "Yeni sürüm bulundu, sayfa güncelleniyor…";
    document.body.append(not);
    history.replaceState(null, "", `#${hedefViewId}`);
    setTimeout(() => window.location.reload(), 350);
    return true;
  } catch { return false; }
}

async function showView(viewId, moduleKey) {
  if (viewId === "sys-uye-aktarim" || viewId === "sys-demo") { // eski adresler → birleşik Yetki Ayarları
    try { sessionStorage.setItem(YA_ALTSEKME_ANAHTARI, viewId === "sys-demo" ? "ya-pane-demo" : "ya-pane-uye"); } catch { /* depo kapalı */ }
    return showView("sys-yetki", "gy");
  }
  const target = document.getElementById(`view-${viewId}`);
  if (!target) return;

  // AYRILMA KALKANI: açık/kaydedilmemiş belge tutan modül (ör. Dönüştürücü) sekmeden çıkarken sorar.
  // Modal açıkken gelen ikinci geçiş isteği (çift tıklama, geri tuşu) yok sayılır; vazgeçilirse adres çubuğu eski sekmeye döner.
  if (activeViewId && activeViewId !== viewId) {
    if (gecisSuruyor) { history.replaceState(null, "", `#${activeViewId}`); return; }
    gecisSuruyor = true;
    let izin = true;
    try { izin = await ayrilmayaIzinVarMi(activeViewId, viewId); } finally { gecisSuruyor = false; }
    if (!izin) { history.replaceState(null, "", `#${activeViewId}`); return; }
    // YENİ SÜRÜM KONTROLÜ (assets/js/core/surum-kontrol.js): her sekme geçişinde (en çok 30 sn'de bir, ucuz no-store istek) sunucudaki
    // derleme kimliğine bakılır; yeni deploy varsa sayfa HEDEF SEKMEYLE yenilenir — elle yenilemeye gerek kalmaz. Oturum korunur (çıkış yok).
    if (await yeniSurumVarsaYenile(viewId)) return;
  }

  ensureContentSlots(viewId, moduleKey);

  document.querySelectorAll(".dash-view").forEach((v) => (v.hidden = true));
  document.querySelectorAll("#dash-nav a").forEach((a) => a.classList.remove("active"));

  target.hidden = false;
  document
    .querySelector(`#dash-nav a[data-view-id="${viewId}"]`)
    ?.classList.add("active");

  aktifGrubuAc(viewId);

  // Aktif sekme, kendi içinde kaydırılan kenar çubuğunda görünür kalsın. scrollIntoView KULLANILMAZ: sayfayı da kaydırıp
  // "sidebar/sayfa takıldı" hissi yaratırdı; yalnızca kenar çubuğunun kendi scrollTop'u ayarlanır.
  requestAnimationFrame(() => {
    const kenar = document.getElementById("dash-sidebar");
    const link = document.querySelector(`#dash-nav a[data-view-id="${viewId}"]`);
    if (!kenar || !link || kenar.scrollHeight <= kenar.clientHeight) return;
    const k = kenar.getBoundingClientRect(), l = link.getBoundingClientRect();
    if (l.top < k.top + 8) kenar.scrollTop -= k.top + 8 - l.top;
    else if (l.bottom > k.bottom - 8) kenar.scrollTop += l.bottom - (k.bottom - 8);
  });

  // Mobil üst şeritte "şu an hangi sekmedeyim" yazsın — dar ekranda
  // sidebar kapalı olduğu için tek ipucu bu.
  const basligiAl =
    NAV.flatMap((g) => g.items).find((it) => it.id === viewId)?.label || "";
  const topbarBaslik = document.getElementById("dash-topbar-baslik");
  if (topbarBaslik) topbarBaslik.textContent = basligiAl;

  activeViewId = viewId;
  history.replaceState(null, "", `#${viewId}`);
  if (viewId !== "me-hub") sonKullanilanKaydet(viewId);
  if (viewId === "me-hub") hubuCiz();

  await ensureModuleLoaded(moduleKey, viewId);
  // Yetki Ayarları: owner için "R2 Erişim İzni" bölümü (ayrı modül; gy modülüne dokunmaz)
  // Bu iki modül yalnızca Site Sahibi'nin sekmelerini doldurur (yetkili admin yalnızca Özellikler'i görür).
  // Yetki Ayarları alt sekmeleri: Site Sahibi VE Yetki Ayarları erişimi açık yönetici için HEPSİ yüklenir. Biri hata verse diğerleri etkilenmez.
  if (viewId === "sys-yetki" && GIRIS_YETKILI_YONETIM) {
    for (const m of ["arsivIzin", "kalkan", "demoYetki", "uyeAktarimYetki"]) {
      try { await ensureModuleLoaded(m); } catch (err) { console.warn(`Yetki Ayarları paneli yüklenemedi (${m}):`, err); }
    }
  }
}

function hubuCiz() {
  const kok = document.getElementById("hub-kok");
  if (!kok || !hubVerisi) return;
  hubNesnesi?.yokEt?.();
  hubNesnesi = hubCiz(kok, hubVerisi.gruplar, (id) => {
    const item = NAV.flatMap((g) => g.items).find((it) => it.id === id);
    if (item) showView(item.id, item.module);
  }, { ad: hubVerisi.ad });
}

function firstAvailableView(profile) {
  const uygun = NAV.flatMap((g) => g.items).filter((it) =>
    gorunurMu(it, profile)
  );
  // Önce "varsayılan açılışa uygun" (iş) sekmeleri; hiçbiri yoksa (ör.
  // sıradan üye) elde kalan ilk sekme — yani "Panelim".
  return uygun.find((it) => it.defaultAcilis !== false) || uygun[0] || null;
}

/* ------------------------------------------------------------------ */
/* 6) Mobil hamburger                                                  */
/* ------------------------------------------------------------------ */

/*
 * MOBİL SIDEBAR AÇ/KAPA — üç şey birden yönetiliyor:
 *
 *  1) ARKA PLAN KAYDIRMA KİLİDİ: panel açıkken arkadaki sayfa parmakla
 *     kaydırılabiliyordu; kullanıcı paneli kapattığında okuduğu yerden
 *     bambaşka bir noktada buluyordu kendini. Sadece "overflow: hidden"
 *     iOS Safari'de GÜVENİLİR DEĞİL (elastic/rubber-band kaydırma), o
 *     yüzden body'yi position:fixed yapıp kaydırma konumunu saklıyoruz —
 *     bu, assets/js/core/mobil-nav.js'teki site menüsüyle AYNI desen.
 *  2) ODAK (klavye/ekran okuyucu): panel açılınca odak panele girer,
 *     kapanınca düğmeye geri döner — odak asla görünmeyen bir elemanda
 *     kalmaz.
 *  3) inert/aria: düğmenin aria-expanded değeri her iki yolda da
 *     (düğme, overlay, Escape, bir sekmeye tıklama) senkron kalır.
 */
let kilitlenmedenOncekiKaydirma = 0;

function govdeKilidiAc() {
  const body = document.body;
  if (body.classList.contains("dash-nav-acik")) return;
  kilitlenmedenOncekiKaydirma = window.scrollY || window.pageYOffset || 0;
  body.style.top = `-${kilitlenmedenOncekiKaydirma}px`;
  body.classList.add("dash-nav-acik");
}

function govdeKilidiKapat() {
  const body = document.body;
  if (!body.classList.contains("dash-nav-acik")) return;
  body.classList.remove("dash-nav-acik");
  body.style.top = "";
  window.scrollTo(0, kilitlenmedenOncekiKaydirma);
}

function openMobileSidebar() {
  const sidebar = document.getElementById("dash-sidebar");
  const overlay = document.getElementById("dash-overlay");
  const toggle = document.getElementById("dash-nav-toggle");
  if (!sidebar) return;
  // Notlarım'ın kendi klasör menüsü açıksa kapansın: iki çekmece üst üste binmesin.
  window.dispatchEvent(new CustomEvent("dash:sidebar-acildi"));
  sidebar.classList.add("open");
  if (overlay) overlay.hidden = false;
  toggle?.setAttribute("aria-expanded", "true");
  govdeKilidiAc();
  // Odağı panele al: önce aktif sekme, yoksa ilk odaklanabilir eleman.
  const ilk =
    sidebar.querySelector("#dash-nav a.active") ||
    sidebar.querySelector("#dash-nav a, .dash-nav-group");
  ilk?.focus?.();
}

function closeMobileSidebar() {
  const sidebar = document.getElementById("dash-sidebar");
  const acikti = sidebar?.classList.contains("open");
  sidebar?.classList.remove("open");
  document.getElementById("dash-overlay")?.setAttribute("hidden", "");
  document.getElementById("dash-nav-toggle")?.setAttribute("aria-expanded", "false");
  govdeKilidiKapat();
  if (acikti) document.getElementById("dash-nav-toggle")?.focus?.();
}

/*
 * BUG FİX (ReferenceError: olcuHeaderYuksekligi tanımsızdı): bu fonksiyon
 * önceki bir düzenlemede yanlışlıkla silinmişti — sadece ÇAĞRILDIĞI yerler
 * (wireMobileNav içinde ve matchMedia/ResizeObserver dinleyicilerinde)
 * kalmış, TANIMI kaybolmuştu. Sonuç: wireMobileNav() ilk çağrıldığı anda
 * "Can't find variable: olcuHeaderYuksekligi" hatasıyla PATLIYOR, bu da
 * init()'i (üstündeki await zincirinden dolayı) yarıda kesiyor — #loading
 * asla gizlenmiyor, #app asla gösterilmiyor, sayfa SONSUZA DEK
 * "Yükleniyor..." ekranında kalıyor. Header'ın gerçek yüksekliğini ölçüp
 * --dash-header-h CSS değişkenine yazan fonksiyon burada, olduğu gibi
 * geri eklendi.
 */
function olcuHeaderYuksekligi() {
  const header = document.querySelector(".site-header");
  const shell = document.querySelector(".dash-shell");
  if (!header || !shell) return;
  shell.style.setProperty("--dash-header-h", `${Math.round(header.getBoundingClientRect().height)}px`);
}

function wireMobileNav() {
  const toggle = document.getElementById("dash-nav-toggle");
  const sidebar = document.getElementById("dash-sidebar");
  const overlay = document.getElementById("dash-overlay");
  if (!toggle || !sidebar || !overlay) return;

  toggle.addEventListener("click", () => {
    if (sidebar.classList.contains("open")) closeMobileSidebar();
    else openMobileSidebar();
  });
  overlay.addEventListener("click", closeMobileSidebar);
  // Notlarım menüsü açılırken site menüsü kapanır (karşılıklı dışlama).
  window.addEventListener("nt:nav-acildi", () => { if (sidebar.classList.contains("open")) closeMobileSidebar(); });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && sidebar.classList.contains("open")) closeMobileSidebar();
  });

  // Ekran masaüstü genişliğine çıkarsa (telefonu yatay çevirmek, pencereyi
  // büyütmek, tablette klavyeyi kapatmak) sidebar zaten kalıcı olarak
  // görünür hale gelir — açık kalan "mobil" durumu ve ONUNLA BİRLİKTE
  // GÖVDE KİLİDİ burada temizlenmezse sayfa masaüstünde kaydırılamaz
  // halde takılı kalırdı.
  const mq = window.matchMedia("(min-width: 981px)");
  const mqDinleyici = (e) => {
    if (e.matches) closeMobileSidebar();
    olcuHeaderYuksekligi();
  };
  // addEventListener("change") Safari 14+; eski Safari için addListener.
  if (typeof mq.addEventListener === "function") mq.addEventListener("change", mqDinleyici);
  else if (typeof mq.addListener === "function") mq.addListener(mqDinleyici);

  olcuHeaderYuksekligi();

  // Header yüksekliği yazı tipi yüklenmesi/tema değişimi/döndürme ile
  // değişebiliyor. ResizeObserver varsa onu kullanıyoruz (resize
  // olayının yakalayamadığı durumları da görür), yoksa resize'a düşüyoruz.
  const header = document.querySelector(".site-header");
  if (header && "ResizeObserver" in window) {
    new ResizeObserver(olcuHeaderYuksekligi).observe(header);
  } else {
    window.addEventListener("resize", olcuHeaderYuksekligi);
  }
  window.addEventListener("orientationchange", olcuHeaderYuksekligi);
}

/* ------------------------------------------------------------------ */
/* 7) Başlangıç                                                        */
/* ------------------------------------------------------------------ */

/*
 * PANEL İÇİ LİNKLER: dashboard'a taşınan eski sayfalarda birbirlerine
 * verilen linkler (ör. "← Panelim sayfasına git", "Üye Ayarları")
 * ESKİ, BAĞIMSIZ sayfalara (/panel/panel.html, /panel/uye-ayarlari.html)
 * gidiyordu — yani kullanıcı dashboard'dan tamamen çıkıyordu. Artık bu
 * linkler data-dash-git="<sekme-id>" taşıyor ve burada yakalanıp sayfa
 * yenilemeden ilgili sekmeye geçiliyor. Delege dinleyici kullanılıyor,
 * çünkü bu linklerin bir kısmı modüller tarafından SONRADAN üretiliyor.
 */
function wireDashIciLinkler() {
  document.addEventListener("click", (e) => {
    const link = e.target.closest("[data-dash-git]");
    if (!link) return;
    const hedefId = link.dataset.dashGit;
    const item = NAV.flatMap((g) => g.items).find((it) => it.id === hedefId);
    if (!item) return; // tanınmayan hedef: tarayıcı normal davransın
    e.preventDefault();
    showView(item.id, item.module);
    closeMobileSidebar();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

/*
 * YETKİ AYARLARI ALT SEKMELERİ ("sayfa içinde sayfa").
 * Yetki Ayarları tek uzun bir sayfaydı; her konu artık kendi sekmesinde ve aynı anda
 * yalnızca biri görünür. Paneller DOM'dan SÖKÜLMEZ (yalnızca hidden), böylece
 * github-yonetim.js / izin-paneli.js / kalkan-paneli.js / yetki-paneli.js'in id'lerle
 * bağlandığı düğümler ve event listener'lar olduğu gibi kalır.
 * Seçili sekme oturum boyunca hatırlanır (sessionStorage; kapalıysa sorun değil).
 * Klavye: ← → / Home / End (WAI-ARIA tabs deseni). Inline style/JS yok (CSP).
 */
const YA_ALTSEKME_ANAHTARI = "aea_yetki_altsekme";

function wireYetkiAltSekmeler() {
  const serit = document.getElementById("ya-altsekmeler");
  if (!serit) return;
  if (!GIRIS_YETKILI_YONETIM) { document.getElementById("ya-pane-uye")?.remove(); } // üye verisi indirme izinleri: Site Sahibi + yetkili Yönetici
  // Owner değilse github-yonetim.js ilgili paneli DOM'dan silebilir; paneli olmayan sekmeyi at.
  const sekmeler = [...serit.querySelectorAll("[data-ya-pane]")].filter((s) => {
    if (document.getElementById(s.dataset.yaPane)) return true;
    s.remove();
    return false;
  });
  if (sekmeler.length === 0) return;

  const azHareket = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  function sec(hedef, { odak = false } = {}) {
    for (const s of sekmeler) {
      const aktif = s === hedef;
      s.setAttribute("aria-selected", String(aktif));
      s.tabIndex = aktif ? 0 : -1;
      const panel = document.getElementById(s.dataset.yaPane);
      if (panel) panel.hidden = !aktif;
    }
    // Şeridi yatay kaydırıp aktif sekmeyi ortala (sayfayı DİKEY kaydırmaz).
    const sol = hedef.offsetLeft - (serit.clientWidth - hedef.offsetWidth) / 2;
    serit.scrollTo({ left: Math.max(0, sol), behavior: azHareket ? "auto" : "smooth" });
    if (odak) hedef.focus();
    try {
      sessionStorage.setItem(YA_ALTSEKME_ANAHTARI, hedef.dataset.yaPane);
    } catch {
      /* depo kapalı: hatırlanmaz, önemli değil */
    }
  }

  serit.addEventListener("click", (e) => {
    const s = e.target.closest("[data-ya-pane]");
    if (s && sekmeler.includes(s)) sec(s);
  });

  serit.addEventListener("keydown", (e) => {
    const i = sekmeler.indexOf(document.activeElement);
    if (i === -1) return;
    let j = null;
    if (e.key === "ArrowRight") j = (i + 1) % sekmeler.length;
    else if (e.key === "ArrowLeft") j = (i - 1 + sekmeler.length) % sekmeler.length;
    else if (e.key === "Home") j = 0;
    else if (e.key === "End") j = sekmeler.length - 1;
    if (j === null) return;
    e.preventDefault();
    sec(sekmeler[j], { odak: true });
  });

  let kayitli = null;
  try {
    kayitli = sessionStorage.getItem(YA_ALTSEKME_ANAHTARI);
  } catch {
    /* yok say */
  }
  sec(sekmeler.find((s) => s.dataset.yaPane === kayitli) || sekmeler[0]);
}

const ROL_ADLARI_TR = { owner: "Site Sahibi", admin: "Yönetici", manager: "İçerik Sorumlusu", editor: "İçerik Editörü", special_user: "Özel Üye", user: "Üye", demo: "Demo Üye" };

async function init() {
  // Tek, paylaşılan temel oturum/rol kontrolü — role:null, yani sadece
  // giriş yapmış olmak yeterli. Modül-özel rol kısıtları SADECE sidebar
  // görünürlüğünü ve hangi script'in yükleneceğini belirler; her
  // modülün kendi requireAuthOrShowError({role:...}) çağrısı YİNE de
  // (savunma derinliği olarak) çalışmaya devam eder.
  document.body.classList.add("dash-sayfa"); // üst şerit düzeni (dashboard.css)
  // ziyaretciDemo: "Herkese açık demo girişi" AÇIKSA oturumsuz ziyaretçi giriş sayfasına atılmaz, vitrine alınır (auth-guard.js); KAPALIYSA giriş istenir.
  const { profile } = await requireAuthOrShowError({ role: null, ziyaretciDemo: true });
  // İSİM/ROL ARTIK ERKEN YAZILIR (BUG FİX): eskiden demo yapılandırması (en geç ~6 sn) beklendikten SONRA yazıldığı için
  // kenar çubuğundaki isim geç geliyordu.
  document.getElementById("dash-ad-soyad").textContent =
    profile.full_name || [profile.first_name, profile.last_name].filter(Boolean).join(" ") || profile.email || "";
  document.getElementById("dash-rol").textContent = isDemoMode ? "Demo / Vitrin Modu" : `Rol: ${ROL_ADLARI_TR[profile.role] || profile.role}`;
  hizliKur(); // Hemen Çıkış Yap + canlı okunmamış rozeti (assets/js/dashboard-hizli.js)
  // Demo: görünürlük yapılandırması hazır olmadan menü çizilmez (en geç ~6 sn; başarısızsa varsayılan/önbellek).
  if (isDemoMode) await configHazir();


  GIRIS_PROFIL_ROLU = profile.role;
  profile.izinler = await izinleriYukle(profile.role);
  GIRIS_YETKILI_YONETIM = profile.role === "owner" || (profile.role === "admin" && !!profile.izinler?.yetkiAyarlari);

  // Notlarım: erişimi owner belirler (migration 0059/0060, Yetki Ayarları).
  // Karar TEK yerden gelir: veritabanındaki not_modulu_yetkili(). Menüyü kuran mevcut kurala
  // (gorunurMu -> roleAllowed(itemRole)) dokunmuyoruz; sadece modülün rolünü duruma göre ayarlıyoruz:
  //   - rol kuralı "evet" ama owner kapatmış  -> role:"owner" (owner dışında herkesi, admin dahil, eler)
  //   - rol kuralı "hayır" (user/special_user) ama owner o üyeye açmış -> role:null (giriş yapmış herkes;
  //     kapı yine veritabanındaki RLS ve worker'dadır, başkası yetkisiz zaten veri göremez)
  // Sorgu başarısız olursa (migration yok/ağ) eski davranış korunur; asıl engel RLS ve worker'dadır.
  if (profile.role !== "owner") {
    const rolKurali = roleAllowed(MODULES.notlar.role, profile);
    try {
      const { data, error } = await supabase.rpc("not_modulu_yetkili");
      if (!error && rolKurali && data === false) {
        MODULES.notlar.role = "owner";
        // Kapalı kullanıcının cihazında şifre çözme anahtarı kalmasın.
        import("./notlar/kasa.js")
          .then((k) => k.tumAnahtarlariTemizle())
          .catch(() => {});
      } else if (!error && !rolKurali && data === true) {
        MODULES.notlar.role = null;
      }
    } catch (_err) {
      /* eski davranış */
    }
  }

  // E2EE anahtar çiftini HERKES için sessizce hazırla: bir kullanıcı, panele en az bir kez
  // girdiyse başkaları ona şifreli dosya gönderebilir (alıcının açık anahtarı gerekir).
  // Worker kapalıysa/yoksa sessizce atlanır; paneli asla bozmaz.
  // (Demo'da atlanır: Worker'a hiç istek gitmesin.)
  // 2026-10: önce anahtar kaydı, sonra GİRİŞE BAĞLAMA — Notlar kasası (giriş parolası / Google'da cihazdaki KEK) sessizce açılır, mesajlaşma
  // anahtarı aynı DEK'e bağlanır. Kullanıcıya hiçbir şey sorulmaz; kasa yoksa yeni kasa KURULMAZ (kurulum Notlar'da, kurtarma metniyle).
  // Site duyuruları: üyeye kalıcı ama rahatsız etmeyen şerit (kapatınca okundu kaydı). Hata/migration yoksa sessizce hiçbir şey gösterilmez.
  import("./duyuru/duyuru-panel.js").then((m) => m.duyuruSeridiKur()).catch(() => {});
  if (!isDemoMode) import("./r2-arsiv/e2ee.js").then(async (m) => { await m.anahtarKaydiniSessizHazirla(); await m.girisOturumunaBagla(); }).catch(() => {}); // kayıt varsa Worker'a istek ATILMAZ (kota)

  buildSidebar(profile);
  // Hub: sidebar ile AYNI görünürlük kuralı (gorunurMu); Ana Ekran kartı kendisi için çizilmez.
  hubVerisi = {
    ad: profile.first_name || profile.full_name || "",
    gruplar: NAV.map((g) => ({ group: g.group, icon: g.icon, items: g.items.filter((it) => it.id !== "me-hub" && gorunurMu(it, profile) && (!isDemoMode || demoHubKartiAcikMi(it.id))).map((it) => ({ id: it.id, icon: it.icon, label: it.label })) })).filter((g) => g.items.length),
  };
  wireMobileNav();
  wireDashIciLinkler();
  wireYetkiAltSekmeler();

  // Not Kasası kancaları (parola değişince zarf yenileme + çıkışta anahtar temizliği):
  // Notlar sekmesi hiç açılmasa bile Şifre Değiştir / çıkış anında çalışmaları gerektiği
  // için burada, rol uygunsa ve AYRI bir import ile (hata olsa panel açılışı etkilenmez).
  if (roleAllowed(MODULES.notlar.role, profile)) {
    import("./notlar/kasa-kancalari.js")
      .then((m) => m.dashboardKancalariniKur())
      .catch((err) => console.warn("Not Kasası kancaları kurulamadı:", err));
  }

  // Sayfa YENİDEN YÜKLENMEDEN hash değişirse (ör. header'daki "Hesabım ▾"
  // menüsünden, zaten dashboard'dayken "Panelim"e tıklamak —
  // /panel/dashboard.html#me-panel aynı sayfa olduğu için tarayıcı sadece
  // hash'i değiştirir, init() TEKRAR ÇALIŞMAZ) doğru sekmeye geç.
  window.addEventListener("hashchange", () => {
    const id = window.location.hash.replace("#", "");
    const item = NAV.flatMap((g) => g.items).find((it) => it.id === id);
    if (item && id !== activeViewId && gorunurMu(item, profile)) {
      showView(item.id, item.module);
    }
  });

  document.getElementById("loading")?.setAttribute("hidden", "");
  document.getElementById("app").hidden = false;

  const requestedId = window.location.hash.replace("#", "");
  const requested = requestedId
    ? NAV.flatMap((g) => g.items).find((it) => it.id === requestedId)
    : null;
  const target =
    requested && gorunurMu(requested, profile)
      ? requested
      : firstAvailableView(profile);

  if (isDemoMode) {
    // Vitrin bandı, alt özellik gizleme (PDF araç çubuğu, ZIP inceleme, filtre çipleri) ve "Demodan çık".
    import("./demo/demo-gorunum.js").then((m) => m.demoGorunumuKur()).catch((h) => console.warn("Demo görünümü kurulamadı:", h));
  }
  if (target) {
    await showView(target.id, target.module);
  } else if (isDemoMode) {
    document.getElementById("dash-main").innerHTML =
      '<p class="muted">Bu demoda şu an görüntülenecek bir bölüm açık değil. Site sahibi vitrin ayarlarını güncellemiş olabilir.</p>';
  } else {
    document.getElementById("dash-main").innerHTML =
      '<p class="muted">Bu panelde görüntüleyebileceğin bir bölüm bulunamadı.</p>';
  }
}

init();

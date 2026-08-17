/*
 * assets/js/github-yonetim/github-yonetim.js — /panel/github-yonetim.html
 *
 * Jekyll/GitHub Pages için, 3. parti bir servise (Netlify vb.) ihtiyaç
 * duymadan çalışan tek sayfalık bir "mini CMS". GitHub REST API'sine
 * (repos/{owner}/{repo}/contents/{path}) istek atarak _posts/ ve
 * _projects/ klasörlerine commit atar, assets/profil.jpg dosyasını yönetir
 * — ama GitHub'a ARTIK DOĞRUDAN DEĞİL, bir Cloudflare Worker ÜZERİNDEN
 * (bkz. aşağıdaki "GÜVENLİK MİMARİSİ" notu).
 *
 * ÖNEMLİ — "YAYINDA DEĞİL" İÇERİK ARTIK GIT'E HİÇ COMMIT EDİLMİYOR:
 * Eskiden "Yayında" kapatılınca içerik yine GitHub'a, front-matter'da
 * `yayinda: false` + tahmin edilemez bir `permalink` ile commit ediliyordu
 * (dosya reponun İÇİNDE, herkese açık git geçmişinde duruyordu — sadece
 * adresi paylaşılmadığı için "gizli" sayılıyordu). Artık öyle DEĞİL:
 * "Yayında" kapalıyken içerik SADECE Supabase'teki `taslak_icerikler`
 * tablosunda duruyor (bkz. supabase/migrations/0013_...sql), GitHub'a hiç
 * dokunulmuyor. Ön izleme linki (`/onizleme/?tur=...&kod=...`) o tabloyu,
 * sadece tur+kod tam eşleşen TEK satırı döndüren bir RPC üzerinden okuyor.
 * "Yayınla" denince içerik Supabase'den GitHub'a commit edilip
 * Supabase'teki satır silinir; "Yayından Kaldır" denince tam tersi olur —
 * GitHub'daki dosya okunup Supabase'e yazılır ve GitHub'daki dosya silinir.
 * Yani bir içerik, HER ZAMAN ya GitHub'da (yayında) ya da Supabase'de
 * (gizli) durur — iki yerde birden asla durmaz.
 *
 * ÖNEMLİ — BU SAYFA SİTENİN SUPABASE TABANLI "ADMİN PANELİ"NDEN (panel/admin.md /
 * admin.js) TAMAMEN BAĞIMSIZDIR — ama artık taslak içerikler için AYNI
 * Supabase projesini (aynı `supabase` istemcisini) kullanıyor. O panel
 * Supabase'teki kullanıcı/rol/özel içerik sistemini yönetir; bu sayfa ise
 * GitHub Pages'in kendi statik Jekyll içeriğini (blog yazıları, akademik
 * projeler, profil fotoğrafı) yönetir. Erişim kontrolü: bu sayfaya
 * requireAuth({ role: ['editor','manager'] }) ile giriliyor (bkz.
 * auth-guard.js) — bu, editor, manager (panelde "İçerik Sorumlusu") HEM DE
 * admin olan kullanıcıların girebilmesi anlamına gelir (auth-guard.js'te
 * "admin her zaman geçer" kuralı zaten var). role='user'/'special_user'
 * olanlar hâlâ giremez. Taslak tablosunun RLS politikası da bunu veritabanı
 * seviyesinde ayrıca zorunlu kılıyor — ama editor VE manager sadece KENDİ
 * taslaklarını ekleyip/düzenleyip/silebilir, admin hepsini yönetebilir
 * (bkz. migration 0014, is_editor_or_admin() migration 0016'da 'manager'ı
 * da kapsayacak şekilde genişletildi). Kullanıcı/rol yönetimi
 * (panel/admin.md) HÂLÂ SADECE admin'e özel — admin.js kendi requireAuth
 * çağrısında role:['admin','manager'] ister ama manager girince
 * "Kullanıcılar & Roller" sekmesini görmez (bkz. admin.js).
 *
 * ÖNEMLİ — "ADMİN ADINA YAYINLA" ONAY SÜRECİ (manager VE editor rolüne
 * özel — editor için de manager ile BİREBİR aynı şekilde çalışır):
 *   manager (İçerik Sorumlusu) veya editor, bir içeriği Admin'in adıyla
 *   yayınlamak isterse "Admin adına yayınla (onay gerekir)" kutusunu
 *   işaretler (bkz. wireAdminAdinaTalep). Bu durumda:
 *     - "Yayında" anahtarı ve "GitHub'a gizli commit et (eski yöntem)"
 *       seçeneği bu panelde DEVRE DIŞI bırakılır — içerik SADECE gizli bir
 *       Supabase taslağı olarak kaydedilebilir (icerikSupabaseeYaz).
 *     - Veritabanı tetikleyicisi (migration 0016 §6), admin onaylamadan bu
 *       içeriğin GERÇEKTEN yayında bir duruma geçmesini zaten engeller —
 *       yani bu panel kısıtlaması bir güvenlik sınırı değil, kullanıcıyı
 *       veritabanının zaten reddedeceği bir işlemi denemekten önceden
 *       caydıran bir KOLAYLIK katmanıdır. Bu tetikleyici zaten hem
 *       manager hem editor için (admin olmayan herkes için) aynı şekilde
 *       işliyordu, bu commit'te DEĞİŞMEDİ.
 *     - ÖNEMLİ (migration 0026 ile DARALTILDI): "Mevcut İçerikler"
 *       listesindeki "✅ Onayla" / "❌ Reddet" butonları artık HERHANGİ bir
 *       admin'e değil, SADECE içeriğin adına yazıldığı o admin'in kendisine
 *       (yazar_id === giriş yapan kişi) YA DA Site Sahibi'ne (owner)
 *       gösterilir/çalışır — başka bir admin bu taslağı görebilir ama
 *       onaylayamaz/reddedemez (bkz. icerikKartiCiz + admin_taslak_onayla
 *       RPC'si + veritabanı tetikleyicisi, taslak_admin_onay_koru).
 *       Onaylanınca içerik normal "Yayınla" butonuyla (hedef admin, owner
 *       veya isteği yapan manager/editor tarafından) GitHub'a/Supabase'e
 *       yayınlanabilir.
 *     - ESKİDEN BURADA "DÜRÜSTLÜK PAYI" diye bir not vardı: editor/manager'a
 *       bu repo için yazma izinli bir GitHub PAT verirsen, panelin DIŞINDA
 *       da GitHub API'sine doğrudan commit atabilir, dolayısıyla panelin
 *       kendisi GERÇEK bir güvenlik sınırı değil sadece bir kolaylık
 *       katmanıydı. Bu ARTIK DOĞRU DEĞİL — bkz. hemen aşağıdaki "GÜVENLİK
 *       MİMARİSİ" notu: editor/manager'ın tarayıcısı PAT'a HİÇ erişemiyor,
 *       tüm GitHub yazma işlemleri sunucu tarafında (Worker'da) hem kimlik
 *       hem rol hem de YOL bazında zorunlu kılınıyor.
 *
 * GÜVENLİK MİMARİSİ — GitHub Personal Access Token (PAT) ARTIK TARAYICIYA HİÇ GİRMİYOR:
 *   Eskiden bu modül, kullanıcının panelde yapıştırdığı bir PAT'ı tarayıcı
 *   BELLEĞİNDE tutup GitHub API'sine doğrudan istek atıyordu (localStorage'a
 *   yazılmıyordu ama sekme açıkken bellekte duruyordu — bir XSS açığında ya
 *   da kötü niyetli bir tarayıcı uzantısında risk taşıyordu). Artık PAT
 *   SADECE `cloudflare worker/github_icerik_worker/worker.js`'in Cloudflare
 *   secret'ı olarak duruyor; bu dosyanın hiçbir satırında PAT YOK ve hiçbir
 *   zaman olmayacak. Bu modül GitHub'a değil, o Worker'a istek atıyor —
 *   kimlik kanıtı olarak kullanıcının zaten sahip olduğu Supabase oturum
 *   token'ını (`supabase.auth.getSession()`) gönderiyor (bkz. ghRequest).
 *   Worker bu token'ı doğrulayıp Supabase'teki ROLÜ okuyor ve HEM kimlik HEM
 *   rol HEM DE hangi DOSYA YOLUNA (path) yazılmak istendiğini kontrol ediyor
 *   (_posts//_projects/ → editor/manager/admin, assets//_config.yml →
 *   sadece admin, başka her şey → reddedilir) — detaylar için Worker
 *   dosyasının başındaki mimari notuna bak. Sonuç: panel artık gerçek bir
 *   yetki sınırı, PAT hiçbir zaman tarayıcı belleğine bile girmiyor.
 *
 *   Worker'ın URL'i aşağıda GITHUB_PROXY_WORKER_URL sabitinde — Worker'ı
 *   deploy ettikten sonra bu değeri kendi Worker adresinle değiştirmen
 *   gerekir (bkz. Worker dosyasının başındaki ortam değişkeni listesi).
 */
import { requireAuth } from "../auth/auth-guard.js";
import { escapeHtml, showMessage, supabase, kucukHarfeCevirTr, kullaniciAramayaUyuyorMu } from "../core/supabase-client.js";

// ---- BURAYI DOLDUR: Worker deploy edildikten sonra aldığın URL ----
// ör. "https://github-icerik-worker.KULLANICI-ADIN.workers.dev"
// veya kendi domainine bağladıysan (Custom Domain) o adres.
const GITHUB_PROXY_WORKER_URL = "https://github-icerik-yonetim.aeymena.workers.dev";
// ---------------------------------------------------------------------
// Profil fotoğrafının GERÇEK yolu artık sabit kodlanmıyor: her zaman
// _config.yml içindeki `profile_image` alanından okunur. Böylece dosya
// assets/profil.jpg, assets/profile.webp ya da başka bir isimle kayıtlı
// olsa da panel onu bulup gösterebilir/değiştirebilir/silebilir — çünkü
// sitenin favicon/profil resmi olarak GERÇEKTEN kullandığı dosya zaten
// bu alanla belirleniyor (bkz. _layouts/default.html). Bkz. aşağıdaki
// profilYapilandirmasiniOku().
const CONFIG_YOLU = "_config.yml";
let PROFIL_YOLU = null;

// Artık bir TOKEN değil, sadece "Worker'a bağlanıp rol/erişim testi
// başarıyla geçti mi?" bilgisini tutan bir bayrak — bkz. dosya başındaki
// GÜVENLİK MİMARİSİ notu ve wireBaglantiDogrula.
let GH_BAGLI = false;

// TEK İSTEKLİ PANEL ÖNBELLEĞİ — bkz. panelVerisiniYukle. Worker'ın
// /panel-init uç noktasından dönen TÜM sayfa verisini (repo bilgisi,
// _posts//_projects klasörleri+dosyaları — ARTIK HAFİF, İÇERİKSİZ, bkz.
// worker.js panelBaslangicVerisiGetir başı —, profil fotoğrafı/config)
// tek seferde tutar. GitHub'a ayrı ayrı istek atmak yerine klasör/içerik/
// profil-foto listeleme fonksiyonları bu önbellekten okur.
let PANEL_VERI = null;

// SAYFALAR ARASI (sessionStorage) ÖNBELLEK — bkz. panelVerisiniOnbellekOku/
// panelVerisiniOnbellegeYaz. PANEL_VERI'nin (yukarıdaki) YALNIZCA sekme
// hayatı boyunca RAM'de tutulmasının aksine, bu önbellek panel kapatılıp
// TEKRAR AÇILDIĞINDA (ör. panele başka bir sayfadan dönüldüğünde) da
// hayatta kalır — böylece panel her açılışta Worker'a (ve onun üzerinden
// GitHub'a) YENİDEN istek atmaz. SADECE şu durumlarda temizlenip taze veri
// çekilir: (1) kullanıcı "Listeyi Yükle / Yenile" butonuna basarsa, (2) bir
// yazma işlemi (içerik kaydet/sil/taşı, klasör oluştur/sil, profil fotoğrafı
// değiştir vb.) TAMAMLANDIĞINDA (bkz. panelListeleriniTazele) — normal
// panel açılışlarında/DOM yeniden kurulduğunda GEREKSİZ Worker isteği
// atılmaz. Dal (branch) değişebileceği için anahtara dahil edilir.
const PANEL_ONBELLEK_ANAHTAR_ONEKI = "gy_panel_init_v1:";
// NOT (kullanıcı/rol izolasyonu): config/profilFoto SADECE admin için
// dolu gelir (bkz. worker.js panelBaslangicVerisiGetir GÜVENLİK notu) —
// aynı sekmede (sessionStorage sekme bazlıdır) farklı rollerde biri
// çıkış yapıp başka biri giriş yaparsa önbelleğin YANLIŞ kullanıcıya ait
// veriyle karışmaması için anahtara giriş yapan kullanıcının id'si de
// dahil edilir.
function panelOnbellekAnahtari(branch) {
  return `${PANEL_ONBELLEK_ANAHTAR_ONEKI}${GIRIS_YAPAN_PROFIL?.id || "__anon__"}:${branch || "__default__"}`;
}
function panelVerisiniOnbellekOku(branch) {
  try {
    const ham = sessionStorage.getItem(panelOnbellekAnahtari(branch));
    return ham ? JSON.parse(ham) : null;
  } catch (_err) {
    return null;
  }
}
function panelVerisiniOnbellegeYaz(branch, veri) {
  try {
    sessionStorage.setItem(panelOnbellekAnahtari(branch), JSON.stringify(veri));
  } catch (_err) {
    // sessionStorage dolu/kapalı olabilir (gizli sekme vb.) — sessizce
    // geçilir, panel yine de RAM önbelleğiyle (PANEL_VERI) çalışmaya devam eder.
  }
}
function panelOnbellekleriniTemizle() {
  try {
    Object.keys(sessionStorage)
      .filter((k) => k.startsWith(PANEL_ONBELLEK_ANAHTAR_ONEKI))
      .forEach((k) => sessionStorage.removeItem(k));
  } catch (_err) {
    /* yoksay */
  }
}

// TEK DOSYA İÇERİK ÖNBELLEĞİ — bkz. icerikIcerigiZenginlestir. Bir
// dosyanın `sha`'sı içeriğiyle BİREBİR eşleniktir (içerik değişirse sha da
// değişir) — bu yüzden içerik sha'ya göre anahtarlanıp süresiz (sekme
// ömrü boyunca) güvenle önbelleklenebilir; ayrıca invalide etmeye HİÇ
// gerek yok (bir dosya düzenlenip kaydedildiğinde yeni sha ile YENİ bir
// anahtara yazılır, eskisi kendiliğinden kullanılmaz kalır).
function icerikOnbellekAnahtari(sha) {
  return `gy_ic_v1:${sha}`;
}
function icerikIcerigiOnbellektenOku(sha) {
  if (!sha) return null;
  try {
    const ham = sessionStorage.getItem(icerikOnbellekAnahtari(sha));
    return ham ? JSON.parse(ham) : null;
  } catch (_err) {
    return null;
  }
}
function icerikIcerigiOnbellegeYaz(sha, data, body) {
  if (!sha) return;
  try {
    sessionStorage.setItem(icerikOnbellekAnahtari(sha), JSON.stringify({ data, body }));
  } catch (_err) {
    /* sessionStorage dolu/kapalı olabilir — sessizce geçilir. */
  }
}

// GitHub'da düzenlenen bir dosya varsa DUZENLENEN_YOL/DUZENLENEN_SHA dolu,
// Supabase'te düzenlenen bir taslak varsa DUZENLENEN_TASLAK_ID dolu olur —
// bir içerik ikisinde BİRDEN asla olamaz (bkz. dosya başındaki not).
let DUZENLENEN_YOL = null;
let DUZENLENEN_SHA = null;
let DUZENLENEN_TASLAK_ID = null;
// Düzenlenen içeriğin daha önce üretilmiş gizli ön izleme kodu (varsa).
// Formda "Yayında değil" seçiliyken tekrar kaydedilirse bu kod KORUNUR,
// böylece link değişmez. Yeni içerikte veya kod hiç üretilmemişse null.
let DUZENLENEN_GIZLI_KOD = null;
// Düzenlenen içeriğin GERÇEK oluşturanı (varsa) — bkz. icerikKendisineMiAit /
// dosyaIcerigiOlustur'daki olusturan_id. Bunu korumazsak, örn. bir admin
// editörün "admin adına" gönderdiği bir içeriği düzenleyip kaydettiğinde
// sahiplik sessizce admin'e geçerdi (editör kendi içeriği üzerindeki
// düzenleme/silme hakkını kaybederdi). Yeni içerikte null — bu durumda
// icerikKaydet, formu gönderen kişiyi (GIRIS_YAPAN_PROFIL) oluşturan sayar.
let DUZENLENEN_OLUSTURAN_ID = null;

let PROFIL_SHA = null;

// Girişi yapan kullanıcının profili (id, full_name, email, role). Yazar
// alanının otomatik doldurulması/açılır listesi bu bilgiye göre kurulur
// (bkz. wireYazarAlani).
let GIRIS_YAPAN_PROFIL = null;

// "Admin adına yayınla" kutusu işaretliyken hedef admin'in {id, ad} bilgisi
// (bkz. wireAdminAdinaTalep / yazarBilgisiniAl). null ise talep aktif değil.
let ADMIN_ADINA_HEDEF = null;

async function init() {
  const { profile } = await requireAuth({ role: ["editor", "manager"] });
  GIRIS_YAPAN_PROFIL = profile;
  document.getElementById("loading")?.setAttribute("hidden", "");
  document.getElementById("app").hidden = false;

  // Diğer panellerdeki (panel.js, admin.js) aynı düzeltme: her adım
  // birbirinden bağımsız kuruluyor, biri hata verirse geri kalanı
  // etkilenmiyor.
  const adimlar = [
    ["ayarları yükle", () => ghAyarlariniYukle()],
    ["bölüm navigasyonu", () => wireSectionNav()],
    ["içerik türü", () => wireIcerikTuruToggle()],
    ["yazar alanı", () => wireYazarAlani()],
    ["admin adına yayın isteği", () => wireAdminAdinaTalep()],
    ["editör araç çubuğu", () => wireEditorToolbar()],
    ["bağlantı doğrulama", () => wireBaglantiDogrula()],
    ["içerik formu", () => wireIcerikForm()],
    ["canlı önizleme", () => wireYayindaCanliOnizleme()],
    ["içerik listesi", () => wireIcerikListe()],
    ["klasör yönetimi", () => wireKlasorYonetimi()],
    ["profil fotoğrafı", () => wireProfilFoto()],
  ];
  for (const [ad, fn] of adimlar) {
    try {
      await fn();
    } catch (err) {
      console.error(`github-yonetim.js: "${ad}" bölümü başlatılamadı:`, err);
    }
  }

  const tarihEl = document.getElementById("ic-date");
  if (tarihEl) tarihEl.value = new Date().toISOString().slice(0, 10);
  submitButonMetniGuncelle();
}

/* ---------------------------------------------------------------------- */
/* BÖLÜM (SECTION) BAZLI GEZİNME — admin.js ile aynı desen                */
/* ---------------------------------------------------------------------- */
function wireSectionNav() {
  const nav = document.getElementById("gy-nav");
  if (!nav) return;

  nav.querySelectorAll("a[data-section]").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const id = link.dataset.section;
      const hedef = document.getElementById(id);
      if (!hedef) return;
      hedef.scrollIntoView({ behavior: "smooth", block: "start" });
      nav.querySelectorAll("a").forEach((a) => a.classList.remove("active"));
      link.classList.add("active");
      history.replaceState(null, "", `#${id}`);
    });
  });

  if (window.location.hash) {
    const link = nav.querySelector(`a[data-section="${window.location.hash.slice(1)}"]`);
    link?.click();
  }
}

/* ---------------------------------------------------------------------- */
/* GITHUB BAĞLANTI AYARLARI                                               */
/* Owner/repo/PAT artık Worker'da (env değişkeni/secret) sabit — burada    */
/* SADECE branch (gizli olmayan, opsiyonel) kalıyor.                       */
/* ---------------------------------------------------------------------- */
function ghAyarlariniYukle() {
  document.getElementById("gh-branch").value = localStorage.getItem("gy_branch") || "";
}

function ghAyarlari() {
  return { branch: document.getElementById("gh-branch").value.trim() };
}

function wireBaglantiDogrula() {
  document.getElementById("gh-baglan-btn").addEventListener("click", () => ghBaglantisiniTestEt(true));
  // Sayfa açılır açılmaz sessizce bir kez dene — kullanıcı artık hiçbir şey
  // yapıştırmak zorunda değil (bkz. dosya başındaki GÜVENLİK MİMARİSİ notu),
  // Supabase oturumu zaten var. Başarısız olursa (Worker henüz deploy
  // edilmemiş, ağ sorunu vb.) sessizce geçilir — kullanıcı "Bağlantıyı
  // Doğrula" butonuyla hatayı görüp elle tekrar deneyebilir.
  ghBaglantisiniTestEt(false);
}

async function ghBaglantisiniTestEt(hataGoster) {
  const msgEl = document.getElementById("gh-baglanti-message");
  const branch = document.getElementById("gh-branch").value.trim();
  localStorage.setItem("gy_branch", branch);

  const btn = document.getElementById("gh-baglan-btn");
  btn.disabled = true;
  btn.textContent = "Kontrol ediliyor...";
  try {
    // ÖNCE sessionStorage önbelleğine bak (bkz. panelVerisiniYukleVeyaOnbellektenAl)
    // — varsa Worker'a/GitHub'a HİÇ istek atılmaz. Yoksa TEK istekle çekilir:
    // repo bilgisi + _posts//_projects klasörleri/dosyaları (hafif liste) +
    // config + profil fotoğrafı hepsi burada gelir (bkz. panelVerisiniYukle
    // ve worker.js'teki panelBaslangicVerisiGetir). Aşağıdaki dört
    // "...Yukle/Guncelle" çağrısı artık PANEL_VERI önbelleğinden okuyor,
    // GitHub'a AYRICA istek atmıyor.
    const { veri, onbellektenGeldi } = await panelVerisiniYukleVeyaOnbellektenAl();
    if (!veri.repo) throw new Error("Repo bilgisi alınamadı.");
    const yazmaYetkisi = veri.repo.permissions?.push;
    GH_BAGLI = true;
    showMessage(
      msgEl,
      `Bağlantı doğrulandı — "${veri.repo.full_name}" (varsayılan branch: ${veri.repo.default_branch}) — ` +
        (onbellektenGeldi ? "listeler önbellekten yüklendi (Worker'a istek atılmadı)." : "tüm listeler tek istekle yüklendi.") +
        (yazmaYetkisi ? "" : " — UYARI: Worker'ın token'ı ile yazma izni yok gibi görünüyor."),
      yazmaYetkisi ? "success" : "error"
    );
    profilFotoDurumYukle();
    await icerikFormuKlasorSecimGuncelle();
    klasorListesiYukle();
    icerikListesiYukle();
  } catch (err) {
    GH_BAGLI = false;
    PANEL_VERI = null;
    if (hataGoster) {
      showMessage(msgEl, `Bağlantı doğrulanamadı: ${err.message}`, "error");
    }
  } finally {
    btn.disabled = false;
    btn.textContent = "Bağlantıyı Doğrula";
  }
}

/* ---------------------------------------------------------------------- */
/* GITHUB İÇERİK PROXY'Sİ (Cloudflare Worker) YARDIMCILARI                 */
/* ---------------------------------------------------------------------- */
function encodePath(yol) {
  return yol.split("/").map(encodeURIComponent).join("/");
}

async function ghRequest(path, options = {}) {
  // Owner/repo/PAT artık burada değil, Worker'da (env değişkeni/secret) —
  // bkz. dosya başındaki GÜVENLİK MİMARİSİ notu. Kimlik kanıtı olarak
  // GitHub'a değil, Worker'a Supabase oturum token'ını gönderiyoruz; Worker
  // bunu doğrulayıp rol+yol kontrolünden geçirdikten SONRA kendi PAT'ıyla
  // GitHub'a yönlendiriyor.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Oturum bulunamadı, tekrar giriş yapmayı dene.");

  return fetch(`${GITHUB_PROXY_WORKER_URL}${path}`, {
    ...options,
    // ÖNEMLİ — "cache: no-store" OLMADAN tarayıcı, önceki yanıtı (aynı
    // URL'ye tekrar istek atıldığında) kendi HTTP önbelleğinden
    // döndürebiliyordu. Bu panel bir "canlı" içerik yönetim aracı
    // olduğundan bu YIKICI bir sorundu: örn. bir klasör oluşturduktan hemen
    // sonra listeyi tazelemek eski (klasörün henüz olmadığı) veriyi
    // gösteriyordu; bir yazı sildikten sonra listeyi tazelemek dosyayı hâlâ
    // orada gösterip tek tek okurken "okunamadı" hatası veriyordu; bir
    // klasörün gerçekten boş olup olmadığı (silme butonunun aktif olup
    // olmayacağı) da eski veriyle hesaplanabiliyordu. "no-store" ile HER
    // istek doğrudan ağa gider, hiçbir ara katmanda önbelleklenmez.
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      ...(options.headers || {}),
    },
  });
}

/**
 * Worker'ın /panel-init uç noktasını çağırıp TÜM panel verisini (repo,
 * _posts//_projects klasörleri+dosyaları — hafif, İÇERİKSİZ liste, bkz.
 * worker.js panelBaslangicVerisiGetir başı —, config, profil fotoğrafı) TEK
 * bir istekte çeker; PANEL_VERI (RAM) önbelleğine YAZAR ve sessionStorage'a
 * da yazarak panel kapatılıp tekrar açıldığında da bu isteğin
 * TEKRARLANMAMASINI sağlar (bkz. panelVerisiniYukleVeyaOnbellektenAl). Her
 * zaman GERÇEK bir ağ isteği atar — "Yenile" ve yazma-sonrası tazeleme
 * akışları BUNU çağırır.
 */
async function panelVerisiniYukle() {
  const { branch } = ghAyarlari();
  const q = branch ? `?ref=${encodeURIComponent(branch)}` : "";
  const res = await ghRequest(`/panel-init${q}`);
  if (!res.ok) throw new Error(await ghHataMesaji(res));
  PANEL_VERI = await res.json();
  if (PANEL_VERI?.agacKesildi) {
    // bkz. worker.js panelBaslangicVerisiGetir — GitHub git/trees yanıtı
    // `truncated:true` döndürdüyse (repo ağacı GitHub'ın tek istekteki
    // sınırından büyükse) liste eksik olabilir. Bu depo ölçeğinde
    // beklenmez ama sessizce yanlış bir "tam liste" izlenimi vermemek için
    // konsola not düşülür.
    console.warn("github-yonetim.js: GitHub git/trees yanıtı kesildi (truncated) — liste eksik olabilir.");
  }
  panelVerisiniOnbellegeYaz(branch, PANEL_VERI);
  return PANEL_VERI;
}

/**
 * Panel açılışında (ghBaglantisiniTestEt → silent test) çağrılır: ÖNCE
 * sessionStorage'daki panel-init önbelleğine bakar — varsa Worker'a HİÇ
 * istek atmadan onu kullanır (panel her açılışta/DOM yeniden kurulduğunda
 * GEREKSİZ istek atılmasını önlemek için). Önbellek yoksa (ilk açılış,
 * "Yenile"den sonra ya da bir yazma işleminden sonra temizlenmişse) normal
 * ağ isteğine (panelVerisiniYukle) düşer.
 */
async function panelVerisiniYukleVeyaOnbellektenAl() {
  const { branch } = ghAyarlari();
  const onbellek = panelVerisiniOnbellekOku(branch);
  if (onbellek) {
    PANEL_VERI = onbellek;
    return { veri: onbellek, onbellektenGeldi: true };
  }
  const veri = await panelVerisiniYukle();
  return { veri, onbellektenGeldi: false };
}

/**
 * Bir yazma işleminden (klasör oluştur/sil/yeniden adlandır, içerik
 * kaydet/sil/yayınla, profil fotoğrafı değiştir) SONRA çağrılır: PANEL_VERI
 * önbelleğini TEK bir istekle tazeler VE sessionStorage'daki panel-init
 * önbelleğini bu taze veriyle GÜNCELLER (bkz. panelVerisiniYukle) — "sadece
 * Yenile butonunda veya yazma sonrasında tazele" kuralının yazma tarafı bu.
 * Başarısız olursa (ör. geçici ağ sorunu) sessizce eski (bir önceki)
 * önbellekle devam edilir — kullanıcının az önce tamamladığı işlemin
 * "başarılı" mesajını bir liste tazeleme hatası bastırmasın diye.
 */
async function panelListeleriniTazele() {
  if (!GH_BAGLI) return;
  // BUG FİX (liste anlık güncellenmiyor / silinen içerik listede kalıyor):
  // GitHub'ın Contents API'si bir commit/silme işleminden HEMEN sonra
  // istendiğinde bazen hâlâ ESKİ (işlem öncesi) içeriği döndürüyor — bu,
  // GitHub'ın kendi tarafındaki KISA SÜRELİ "eventual consistency"
  // gecikmesi, bizim "cache: no-store" / cf.cacheTtl:0 önlemlerimizle
  // ÇÖZÜLEMEZ (onlar sadece tarayıcı/Cloudflare önbelleğini devre dışı
  // bırakıyor, GitHub'ın kendi arka ucunu değil). Sonuç: örn. icerikSil()
  // önce öğeyi yerel TUM_ICERIKLER'den iyimser (optimistic) olarak
  // kaldırıyor, AMA hemen ardından çağrılan icerikListesiYukle() taze
  // sanılan (aslında hâlâ eski) PANEL_VERI'den TUM_ICERIKLER'i BAŞTAN
  // kurunca silinen öğe listede "geri geliyor" gibi görünüyordu. Aynı
  // şekilde yeni kaydedilen/yayınlanan bir içerik de bir sonraki
  // yenilemede henüz görünmeyebiliyordu. Burada GitHub'a yayılma zamanı
  // tanımak için okumadan önce kısa bir bekleme ekliyoruz.
  await new Promise((resolve) => setTimeout(resolve, 900));
  try {
    await panelVerisiniYukle();
  } catch (err) {
    console.error("Panel verisi tazelenemedi (bir sonraki yenilemede tekrar denenecek):", err);
  }
}

async function ghHataMesaji(res) {
  try {
    const j = await res.json();
    return `${res.status} ${j.message || res.statusText}`;
  } catch {
    return `${res.status} ${res.statusText}`;
  }
}

/** Dosya VEYA klasör içeriği okur. 404 ise null döner (var olmadığı anlamına gelir). */
async function ghGetContents(path) {
  const { branch } = ghAyarlari();
  const q = branch ? `?ref=${encodeURIComponent(branch)}` : "";
  const res = await ghRequest(`/contents/${encodePath(path)}${q}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await ghHataMesaji(res));
  return res.json();
}

async function ghPutFile(path, icerikBase64, mesaj, sha = null) {
  const { branch } = ghAyarlari();
  const govde = { message: mesaj, content: icerikBase64 };
  if (sha) govde.sha = sha;
  if (branch) govde.branch = branch;
  const res = await ghRequest(`/contents/${encodePath(path)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(govde),
  });
  if (!res.ok) throw new Error(await ghHataMesaji(res));
  return res.json();
}

async function ghDeleteFile(path, sha, mesaj) {
  const { branch } = ghAyarlari();
  const govde = { message: mesaj, sha };
  if (branch) govde.branch = branch;
  const res = await ghRequest(`/contents/${encodePath(path)}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(govde),
  });
  if (!res.ok) throw new Error(await ghHataMesaji(res));
  return res.json();
}

/* Base64 <-> UTF-8 metin dönüşümü (GitHub API içeriği hep base64 bekler/döner). */
function b64Encode(str) {
  return btoa(
    encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) => String.fromCharCode(parseInt(p1, 16)))
  );
}
function b64Decode(str) {
  return decodeURIComponent(
    atob(str)
      .split("")
      .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
      .join("")
  );
}

/* ---------------------------------------------------------------------- */
/* İÇERİK TÜRÜ SEÇİMİ (Blog / Proje) — FORM ALANLARININ DİNAMİK DEĞİŞİMİ   */
/* ---------------------------------------------------------------------- */
function icerikTuru() {
  return document.querySelector('input[name="icerik-turu"]:checked')?.value || "blog";
}

function wireIcerikTuruToggle() {
  document.querySelectorAll('input[name="icerik-turu"]').forEach((r) => {
    r.addEventListener("change", guncelleIcerikTuru);
  });
  guncelleIcerikTuru();
}

function duzenlemeModuMu() {
  return !!(DUZENLENEN_YOL || DUZENLENEN_TASLAK_ID);
}

async function guncelleIcerikTuru() {
  const proje = icerikTuru() === "proje";
  document.getElementById("ic-proje-alanlar").hidden = !proje;
  document.getElementById("ic-yil-oneki-wrap").hidden = !proje;
  await guncelleKlasorEtiketleri(proje);
  document.getElementById("ic-form-baslik").textContent = duzenlemeModuMu()
    ? proje
      ? "Akademik Projeyi Düzenle"
      : "Blog Yazısını Düzenle"
    : proje
    ? "Yeni Akademik Proje Ekle"
    : "Yeni Blog Yazısı Ekle";
}

/**
 * Kaydet butonunun metnini o an düzenlenen/kaydedilecek içeriğin durumuna
 * göre günceller: mevcut bir kaydı düzenliyorsak her zaman "Güncelle" (hem
 * GitHub'daki bir dosya hem Supabase'teki bir taslak için — hangisine
 * kaydedileceği "Yayında" anahtarına göre otomatik belirlenir), yeni içerik
 * ekleniyorsa "Yayında" anahtarına göre "GitHub'a Yayınla" ya da "Taslağı
 * Kaydet (Gizli)".
 */
function submitButonMetniGuncelle() {
  const btn = document.getElementById("ic-submit-btn");
  const btnB = document.getElementById("ic-submit-b-btn");
  const btnC = document.getElementById("ic-submit-c-btn");
  const yardimEl = document.getElementById("ic-yayin-secenek-yardim");
  if (!btn) return;
  const yayinda = document.getElementById("ic-yayinda")?.checked;

  // "Seçenek B/C" (ikisi de GitHub'a değil ya da GitHub'la BİRLİKTE
  // Supabase'e yazan alternatif yayın yolları) SADECE "Yayında" açıkken
  // anlamlıdır — kapalıyken zaten mevcut "Nerede saklansın?"
  // (Supabase/GitHub) seçimi gizli taslak için bu ayrımı yapıyor.
  if (btnB) btnB.hidden = !yayinda;
  if (btnC) btnC.hidden = !yayinda;
  if (yardimEl) yardimEl.hidden = !yayinda;

  if (duzenlemeModuMu()) {
    btn.textContent = yayinda ? "🅰️ Güncelle ve Doğrudan Yayınla" : "Güncelle";
    if (btnB) btnB.textContent = "🅱️ Güncelle (Supabase Yedekli)";
    if (btnC) btnC.textContent = "🅲️ Güncelle (Sadece Supabase)";
    return;
  }
  if (yayinda) {
    btn.textContent = "🅰️ Doğrudan GitHub'a Aktar ve Yayınla";
    if (btnB) btnB.textContent = "🅱️ Supabase'e Kaydet ve GitHub ile Yayınla";
    if (btnC) btnC.textContent = "🅲️ Sadece Supabase'te Yayınla (GitHub'a Commit Atma)";
  } else if (gizliHedefDegeriniAl() === "github") {
    btn.textContent = "GitHub'a Gizli Commit Et";
  } else {
    btn.textContent = "Taslağı Kaydet (Gizli)";
  }
}

/* ---------------------------------------------------------------------- */
/* YAZAR ALANI — SADECE owner (Site Sahibi) serbest arama ile başka biri   */
/* adına yazabilir; admin/manager/editor SADECE kendi adına yazabilir      */
/* (salt okunur alan). BUG FİX (bkz. "site sahibi adına onaysız yayın"     */
/* raporu): eskiden admin de owner ile AYNI şekilde herkesi (owner dahil)  */
/* onaysız "yazar" seçebiliyordu — bkz. wireYazarAlani içindeki not.       */
/* Bir admin başka bir admin/owner adına yazmak isterse artık (manager/    */
/* editor'da olduğu gibi) "Admin/Site Sahibi adına yayınla (onay gerekir)" */
/* kutusunu kullanmalı (bkz. wireAdminAdinaTalep).                         */
/* ---------------------------------------------------------------------- */
const YAZAR_ROL_ETIKETI = { admin: "Yönetici", owner: "Site Sahibi", editor: "Editör", manager: "İçerik Sorumlusu" };

// admin/owner için yazar adayları (bir kez çekilir, her tuş vuruşunda
// client-side filtrelenir — bkz. mesajlar.js/chat.js'teki AYNI desen).
let YAZAR_ADAYLARI = null;
// wireYazarAlani() form iptal edilince (bkz. duzenlemeyiIptalEt) TEKRAR
// çağrılıyor — input/click olay dinleyicilerini SADECE ilk çağrıda bağlıyoruz,
// yoksa her iptalde bir kopya daha eklenip aynı arama sonucu birden fazla kez
// çizilir / kapatma tıklaması birden fazla kez tetiklenirdi.
let YAZAR_OLAYLARI_BAGLANDI = false;

/** Formdaki gizli id alanına + görünen arama kutusuna, seçilen kişiyi yazar. */
function yazarSecimiUygula(id, ad) {
  const idAlani = document.getElementById("ic-yazar-secili-id");
  const arama = document.getElementById("ic-yazar-arama");
  if (idAlani) idAlani.value = id || "";
  if (arama) arama.value = ad || "";
}

function yazarSonuclariniCiz(sonucEl, adaylar, q) {
  const eslesenler = adaylar.filter((u) => kullaniciAramayaUyuyorMu(u, q)).slice(0, 8);
  if (eslesenler.length === 0) {
    sonucEl.innerHTML = `<p class="chat-bos" style="padding:8px 10px;">Eşleşen kullanıcı yok.</p>`;
    sonucEl.hidden = false;
    return;
  }
  sonucEl.innerHTML = eslesenler
    .map((u) => {
      const ad = u.full_name || u.email;
      return `
      <button type="button" class="msg-uye-sonuc-item" data-id="${u.id}" data-ad="${escapeHtml(ad)}">
        <span class="msg-uye-sonuc-isim">${escapeHtml(u.full_name || "—")} (${YAZAR_ROL_ETIKETI[u.role] || u.role})</span>
        <span class="muted">${escapeHtml(u.email)}</span>
      </button>`;
    })
    .join("");
  sonucEl.hidden = false;
  sonucEl.querySelectorAll(".msg-uye-sonuc-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      yazarSecimiUygula(btn.dataset.id, btn.dataset.ad);
      sonucEl.hidden = true;
      sonucEl.innerHTML = "";
    });
  });
}

async function wireYazarAlani() {
  const kutuWrap = document.getElementById("ic-yazar-arama-kutusu");
  const arama = document.getElementById("ic-yazar-arama");
  const sonucEl = document.getElementById("ic-yazar-arama-sonuc");
  const girdi = document.getElementById("ic-yazar-adi");
  if (!kutuWrap || !arama || !sonucEl || !girdi || !GIRIS_YAPAN_PROFIL) return;

  const kendiAdi = GIRIS_YAPAN_PROFIL.full_name || GIRIS_YAPAN_PROFIL.email || "";

  // BUG FİX (bkz. "site sahibi adına onaysız yayın" raporu): bu arama
  // kutusu SEÇİLEN kişiyi doğrudan `yazar_id` olarak forma yazıyor ve
  // normal "Yayınla" (Seçenek A/B) butonları hiçbir onay süreci olmadan
  // GitHub'a commit atıyor. Eskiden 'admin' de 'owner' ile AYNI şekilde bu
  // kutuyu kullanıp Site Sahibi DAHİL herkesi onaysız "yazar" seçebiliyordu
  // — bu ciddi bir yetki atlatma açığıydı (bkz. Worker'daki § 4.2 ve
  // icerikKaydet'teki yeni kontrol, GERÇEK sunucu taraflı sınır zaten
  // orada). Artık SADECE owner (Site Sahibi) bu serbest aramayı kullanabilir
  // — admin de tıpkı editor gibi SADECE kendi adına yazabilir; başka bir
  // admin/owner adına yazmak isterse (manager/editor'daki ile AYNI) "Admin/
  // Site Sahibi adına yayınla (onay gerekir)" akışını kullanmalıdır (bkz.
  // wireAdminAdinaTalep — artık admin'e de açık, aşağıda).
  if (GIRIS_YAPAN_PROFIL.role !== "owner") {
    // editor/manager/admin: kendi adı dışında bir şey seçemez, alan salt okunur.
    kutuWrap.hidden = true;
    girdi.hidden = false;
    girdi.value = kendiAdi;
    girdi.readOnly = true;
    return;
  }

  // Sadece owner: içerik yönetebilen herkes (admin + owner + editor + manager)
  // arasından isim/e-posta ile arayıp yazar seçebilir — önceden bir <select>
  // listesiydi, yönetici/site sahibi/editör sayısı arttıkça sayfayı
  // şişirmemek için arama kutusuna çevrildi (bkz. panel/github-yonetim.md).
  girdi.hidden = true;
  kutuWrap.hidden = false;

  // Varsayılan: giriş yapan admin'in kendisi.
  yazarSecimiUygula(GIRIS_YAPAN_PROFIL.id, kendiAdi);

  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, email, role")
      .in("role", ["admin", "owner", "editor", "manager"])
      .order("full_name", { ascending: true });
    if (error) throw error;
    YAZAR_ADAYLARI = data || [];
  } catch (err) {
    console.error("Yazar listesi yüklenemedi:", err);
    YAZAR_ADAYLARI = GIRIS_YAPAN_PROFIL.id ? [{ id: GIRIS_YAPAN_PROFIL.id, full_name: kendiAdi, email: GIRIS_YAPAN_PROFIL.email, role: GIRIS_YAPAN_PROFIL.role }] : [];
  }

  if (!YAZAR_OLAYLARI_BAGLANDI) {
    YAZAR_OLAYLARI_BAGLANDI = true;
    arama.addEventListener("input", () => {
      const q = kucukHarfeCevirTr(arama.value.trim());
      // Arama kutusu elle temizlenirse seçili yazar da temizlenir — böylece
      // kaydedince, ekranda görünmeyen ESKİ bir seçim sessizce gönderilmez.
      const idAlani = document.getElementById("ic-yazar-secili-id");
      if (idAlani) idAlani.value = "";
      if (!q) {
        sonucEl.hidden = true;
        sonucEl.innerHTML = "";
        return;
      }
      yazarSonuclariniCiz(sonucEl, YAZAR_ADAYLARI || [], q);
    });
    document.addEventListener("click", (e) => {
      if (!sonucEl.hidden && !sonucEl.contains(e.target) && e.target !== arama) {
        sonucEl.hidden = true;
      }
    });
  }
}

/**
 * "Admin/Site Sahibi adına yayınla (onay gerekir)" özelliği — role='manager'
 * (panelde "İçerik Sorumlusu") VE role='editor' için aynı şekilde açık.
 * admin/owner bu kutuyu hiç görmez: zaten kendi adına doğrudan yazma
 * yetkileri var, onaya ihtiyaçları yok. Kutu işaretlenince:
 *   - Yazar, GİRİŞ YAPAN KİŞİ DEĞİL, seçilen admin/owner olarak kaydedilir
 *     (bkz. yazarBilgisiniAl) ve satıra hedefin rolüne göre
 *     admin_adina_talep=true YA DA sahip_adina_talep=true eklenir (bkz.
 *     icerikKaydet → icerikSupabaseeYaz/icerikSadeceSupabaseeYayinla/
 *     icerikSupabaseVeGithubaYaz).
 *   - "Yayında" anahtarı kapatılıp kilitlenir ve "GitHub'a gizli commit et
 *     (eski yöntem)" seçeneği devre dışı bırakılır — içerik SADECE gizli
 *     bir Supabase taslağı olarak kaydedilebilir; onaylanmadan GERÇEKTEN
 *     yayına alınamaz (veritabanı tetikleyicisi de bunu ayrıca zorunlu
 *     kılar, bkz. migration 0016 §6 ve migration 0023 § A.4 — bu, o
 *     kuralın istemci tarafındaki bir kolaylık yansımasıdır, güvenlik
 *     sınırı DEĞİLDİR).
 *   - Site Sahibi (owner) hedef seçilirse onay süreci FARKLIDIR: ya owner
 *     tek başına onaylar (sahip_taslak_onayla) ya da adminlerin MUTLAK
 *     ÇOĞUNLUĞU onay oyu verir (admin_sahip_talebi_oy_kullan) — bkz.
 *     migration 0023 § A.
 */
async function wireAdminAdinaTalep() {
  const sarmalayici = document.getElementById("ic-admin-adina-wrap");
  if (!sarmalayici || !GIRIS_YAPAN_PROFIL) return;

  // BUG FİX (bkz. "site sahibi adına onaysız yayın" raporu): bu kutu
  // eskiden SADECE manager/editor'e gösteriliyordu — "admin, owner (Site
  // Sahibi) adına yazmak isterse onay akışına hiç girmeden doğrudan
  // GitHub'a yazabiliyordu" açığının bir parçası buydu (bkz. wireYazarAlani
  // ve icerikKaydet'teki ilgili düzeltmeler). Artık 'admin' de bu kutuyu
  // görebilir — ama admin_listesi_getir() RPC'si (aşağıda) hem admin hem
  // owner'ı döndürdüğü için admin'in hedef listesinde KENDİSİ de görünür;
  // bu zararsızdır (kendi adına "onay" istemek anlamsız olur ama veritabanı
  // tetikleyicisi zaten caller_is_admin=true olduğunda admin'in kendi
  // talebini otomatik onaylı sayar, bkz. migration 0016 § 6) — asıl önemli
  // olan admin'in artık owner ya da BAŞKA bir admin'i seçtiğinde bu akışa
  // girmeye ZORLANMASI (bkz. wireYazarAlani'nin admin'i salt-okunur yapması).
  // owner bu kutuyu hiç görmez: zaten kendi adına doğrudan yazma yetkisi
  // var, onaya ihtiyacı yok.
  if (GIRIS_YAPAN_PROFIL.role !== "manager" && GIRIS_YAPAN_PROFIL.role !== "editor" && GIRIS_YAPAN_PROFIL.role !== "admin") {
    sarmalayici.hidden = true;
    return;
  }

  const kutu = document.getElementById("ic-admin-adina-kutu");
  const hedefSecim = document.getElementById("ic-admin-adina-hedef");
  const yayindaAnahtari = document.getElementById("ic-yayinda");
  const gizliHedefGithubRadio = document.querySelector('input[name="gizli-hedef"][value="github"]');
  if (!kutu || !hedefSecim) return;

  sarmalayici.hidden = false;

  try {
    // ÖNEMLİ: doğrudan `.from("profiles")...eq("role","admin")` KULLANMA —
    // profiles tablosunun RLS'i (migration 0016 § 3) role='editor' için
    // sadece KENDİ satırını görmesine izin verir, is_manager_or_admin()
    // 'editor'ü kapsamaz. Bu yüzden editor için o sorgu HER ZAMAN boş
    // dönerdi (RLS sessizce filtreler, hata fırlatmaz) — dropdown boş
    // kalır, "Admin adına yayınla" işaretlenince ADMIN_ADINA_HEDEF.ad ""
    // olur ve kayıt "Yazar bilgisi belirlenemedi" hatasıyla reddedilirdi.
    // admin_listesi_getir() (migration 0020, 0023'te owner'ı da kapsayacak
    // şekilde genişletildi) editor/manager/admin/owner'ın hepsine açık dar
    // kapsamlı bir RPC — RLS'i by-pass edip admin VE owner profillerinin
    // id/full_name/email/role'ünü döner.
    const { data, error } = await supabase.rpc("admin_listesi_getir");
    if (error) throw error;
    // BUG FİX: admin_listesi_getir() çağıranın KENDİSİNİ de döndürebilir
    // (rolü admin/owner ise) — bir kişinin kendi adına "onay bekleyen talep"
    // açması anlamsız (zaten kendi içeriğini doğrudan yazabilir), bu yüzden
    // hedef listesinden çağıranın kendi id'sini çıkarıyoruz. Bu SADECE
    // arayüz kolaylığıdır; veritabanı tetikleyicisi (migration 0016 § 6)
    // caller_is_admin/caller_is_owner true olduğunda talebi zaten otomatik
    // onaylı sayar, güvenlik sınırı bu filtrelemeye bağlı DEĞİLDİR.
    const hedefler = (data || []).filter((p) => p.id !== GIRIS_YAPAN_PROFIL.id);
    const ROL_ETIKETI_KISA = { admin: "Yönetici", owner: "Site Sahibi" };
    const secenekler = hedefler
      .map(
        (p) =>
          `<option value="${p.id}" data-ad="${escapeHtml(p.full_name || p.email)}" data-rol="${p.role}">${escapeHtml(p.full_name || p.email)} (${ROL_ETIKETI_KISA[p.role] || p.role})</option>`
      )
      .join("");
    // 2+ hedef varken bir PLACEHOLDER ekliyoruz — böylece kutuyu
    // işaretleyen kişi, dropdown'ın alfabetik ilk hedefi SESSİZCE
    // seçmesine güvenmek yerine hedefi BİLİNÇLİ olarak seçmek zorunda
    // kalır (bkz. icerikKaydet'teki "hedef seçilmedi" kontrolü — bu
    // placeholder'ın value'su boş olduğundan o kontrol devreye girer).
    hedefSecim.innerHTML = hedefler.length > 1 ? `<option value="">— Yönetici/Site Sahibi seç —</option>${secenekler}` : secenekler;
    // Tek hedef varsa seçim kutusunu gizle, checkbox etiketinde "X adına"
    // metnini otomatik göster (birden çok hedefte etiket sabit kalır,
    // seçim dropdown'dan yapılır).
    hedefSecim.hidden = hedefler.length <= 1;
    const etiket = document.getElementById("ic-admin-adina-etiket");
    if (etiket) {
      etiket.textContent =
        hedefler.length === 1
          ? `${hedefler[0].full_name || hedefler[0].email} adına yayınla (onay gerekir)`
          : "Yönetici/Site Sahibi adına yayınla (onay gerekir)";
    }
    // Hiç hedef bulunamadıysa (RPC hatasız ama boş döndüyse) kutuyu
    // işaretlenebilir bırakmanın anlamı yok — işaretlense bile ADMIN_ADINA_HEDEF.ad
    // hep boş kalıp "Yazar bilgisi belirlenemedi" hatasına düşerdi. Kutuyu
    // devre dışı bırakıp NEDENİNİ görünür bir ipucuyla açıklıyoruz.
    kutu.disabled = hedefler.length === 0;
    kutu.title = hedefler.length === 0 ? "Şu an sistemde admin/owner rolüne sahip bir kullanıcı bulunamadı." : "";
  } catch (err) {
    console.error("Admin/Site Sahibi listesi yüklenemedi (adına yayınla):", err);
    hedefSecim.innerHTML = "";
    kutu.disabled = true;
    kutu.title = "Liste yüklenemedi, sayfayı yenileyip tekrar dene.";
  }

  const uygula = () => {
    const aktif = kutu.checked;
    hedefSecim.style.display = aktif && !hedefSecim.hidden ? "" : "none";
    ADMIN_ADINA_HEDEF = aktif
      ? {
          id: hedefSecim.value || null,
          ad: hedefSecim.selectedOptions?.[0]?.dataset.ad || "",
          // 'admin' ya da 'owner' — icerikKaydet'te hangi talep alanının
          // (admin_adina_talep / sahip_adina_talep) yazılacağını belirler.
          rol: hedefSecim.selectedOptions?.[0]?.dataset.rol || "admin",
        }
      : null;

    // "Yayında" anahtarını kapat + kilitle: admin onaylamadan bu içerik
    // gerçekten yayına alınamaz, o yüzden formda hiç seçenek olarak
    // sunulmuyor.
    if (yayindaAnahtari) {
      if (aktif) yayindaAnahtari.checked = false;
      yayindaAnahtari.disabled = aktif;
      yayindaAnahtari.dispatchEvent(new Event("change"));
    }
    // "GitHub'a gizli commit et (eski yöntem)" seçeneği bu panelin DIŞINDA,
    // Supabase'i hiç görmeden doğrudan GitHub'a commit atar — admin onay
    // sürecini tamamen atlar, o yüzden "admin adına" talebi aktifken
    // devre dışı bırakılıp "Supabase'te taslak" seçeneğine zorlanıyor.
    if (gizliHedefGithubRadio) {
      gizliHedefGithubRadio.disabled = aktif;
      if (aktif && gizliHedefGithubRadio.checked) {
        const supabaseRadio = document.querySelector('input[name="gizli-hedef"][value="supabase"]');
        if (supabaseRadio) supabaseRadio.checked = true;
      }
    }
  };

  kutu.addEventListener("change", uygula);
  hedefSecim.addEventListener("change", uygula);
  uygula();
}

/** Formda o an seçili/girilmiş yazar bilgisini { id, ad } olarak döner. */
function yazarBilgisiniAl() {
  if (ADMIN_ADINA_HEDEF) return ADMIN_ADINA_HEDEF;
  const kutuWrap = document.getElementById("ic-yazar-arama-kutusu");
  const idAlani = document.getElementById("ic-yazar-secili-id");
  const arama = document.getElementById("ic-yazar-arama");
  const girdi = document.getElementById("ic-yazar-adi");
  if (kutuWrap && !kutuWrap.hidden) {
    return { id: idAlani?.value || null, ad: arama?.value || "" };
  }
  return { id: GIRIS_YAPAN_PROFIL?.id || null, ad: girdi?.value || "" };
}

/**
 * Bir içeriği (git dosyası ya da Supabase taslağı) tekil olarak tanımlayan
 * bir anahtar üretir (çakışma kontrolünde ve "bu, şu an düzenlenen kayıt
 * mı?" karşılaştırmalarında kullanılır).
 */
function itemAnahtari(item) {
  return item.kaynak === "supabase" ? `db:${item.taslakId}` : `git:${item.path}`;
}

function suAnDuzenlenenAnahtar() {
  if (DUZENLENEN_TASLAK_ID) return `db:${DUZENLENEN_TASLAK_ID}`;
  if (DUZENLENEN_YOL) return `git:${DUZENLENEN_YOL}`;
  return null;
}

/**
 * "Klasör" alanı hem blog hem proje formunda görünür (her iki koleksiyon
 * da alt klasörlenebilir — bkz. dosyaYoluHesapla), ama etiket/açıklama
 * metni ve dropdown'daki koleksiyon kökü (_posts/ ya da _projects/) türe
 * göre değişir. İçerik türü değiştiğinde dropdown'ı da o türün gerçek
 * klasörleriyle yeniden doldururuz (icerikFormuKlasorSecimGuncelle zaten
 * icerikTuru()'nu kendi okuyor). ASYNC: çağıran taraf (guncelleIcerikTuru
 * ve icerikDuzenlemeyeYukle) bu bitmeden devam ETMEMELİ, aksi halde
 * ardından yapılan "düzenlenen dosyanın klasörünü seçili göster" işlemi
 * bu fonksiyonun geç gelen dropdown sıfırlamasıyla ezilebilir.
 */
async function guncelleKlasorEtiketleri(proje) {
  const kokKlasor = proje ? "_projects" : "_posts";
  const ornekAltKlasor = proje ? "konferanslar" : "seyahat";
  const etiket = document.querySelector('label[for="ic-klasor-secim"]');
  if (etiket) {
    etiket.innerHTML = `Klasör (${proje ? "projenin" : "blog yazısının"} <code>${kokKlasor}/</code> altında hangi alt klasöre kaydedileceği)`;
  }
  const otomatikOption = document.querySelector('#ic-klasor-secim option[value="__auto__"]');
  if (otomatikOption) {
    otomatikOption.textContent = `Otomatik — tarihe göre yıl klasörü (örn. ${kokKlasor}/2026/)`;
  }
  const yardim = document.getElementById("ic-klasor-yardim");
  if (yardim) {
    yardim.innerHTML = `
      "Otomatik" seçiliyken dosya, yukarıdaki tarihin yılına göre
      (<code>${kokKlasor}/&lt;yıl&gt;/</code>) kaydedilir — hiçbir şey
      yapmana gerek yok. Farklı bir klasör seçersen (örn. konuya göre
      <code>${kokKlasor}/${ornekAltKlasor}/</code> ya da farklı bir yıl)
      dosya SEÇTİĞİN klasöre gider; hangi klasörde durduğu içeriğin
      linkini (permalink'ini) ETKİLEMEZ. Yeni klasörleri "📁 Klasörler"
      sekmesinden de yönetebilirsin (oluşturma, yeniden adlandırma,
      silme).
    `;
  }
  await icerikFormuKlasorSecimGuncelle();
}

/* ---------------------------------------------------------------------- */
/* İÇERİK FORMUNDAKİ "KLASÖR" SEÇİCİSİ (blog: _posts/, proje: _projects/) */
/* ---------------------------------------------------------------------- */

/** Aktif içerik türüne göre kök koleksiyon klasörünü döner. */
function kokKlasorAdi(tur) {
  return tur === "proje" ? "_projects" : "_posts";
}

/** Şu an formda seçili olan klasör değerini döner: "__auto__" ya da bir klasör adı. */
function klasorSecimDegeriniAl() {
  const secim = document.getElementById("ic-klasor-secim");
  if (!secim) return "__auto__";
  if (secim.value === "__yeni__") {
    const yeniAd = document.getElementById("ic-klasor-yeni-ad").value.trim();
    return klasorAdiTemizle(yeniAd) || "__auto__";
  }
  return secim.value;
}

/** Klasör adını dosya-sistemi-güvenli hale getirir (slug'a benzer ama Türkçe karakterleri de çevirir). */
function klasorAdiTemizle(ad) {
  return slugOlustur(ad).replace(/[^a-z0-9-]/g, "");
}

/**
 * Aktif içerik türünün (blog/proje) kök koleksiyonundaki mevcut
 * klasörleri GitHub'dan çeker ve "ic-klasor-secim" dropdown'ını doldurur.
 * "Otomatik" ve "Yeni klasör oluştur…" seçenekleri her zaman sabit kalır,
 * aradaki kısım GitHub'daki gerçek klasörlerle güncellenir. Bağlantı
 * henüz doğrulanmamışsa ya da istek başarısız olursa sessizce hiçbir şey
 * yapmaz (form yine de "Otomatik" ile normal çalışmaya devam eder).
 */
async function icerikFormuKlasorSecimGuncelle() {
  const secim = document.getElementById("ic-klasor-secim");
  if (!secim || !GH_BAGLI) return;
  const kokKlasor = kokKlasorAdi(icerikTuru());
  const oncekiDeger = secim.value;
  try {
    const klasorler = await koleksiyonKlasorleriniListele(kokKlasor);
    const ozelSecenekler = Array.from(secim.querySelectorAll('option[value="__auto__"], option[value="__yeni__"]'));
    secim.innerHTML = "";
    ozelSecenekler.forEach((o) => secim.appendChild(o));
    klasorler
      .sort((a, b) => b.localeCompare(a)) // yeni yıllar/klasörler üstte
      .forEach((ad) => {
        const opt = document.createElement("option");
        opt.value = ad;
        opt.textContent = `${kokKlasor}/${ad}/`;
        secim.insertBefore(opt, secim.querySelector('option[value="__yeni__"]'));
      });
    if ([...secim.options].some((o) => o.value === oncekiDeger)) {
      secim.value = oncekiDeger;
    } else {
      secim.value = "__auto__";
    }
  } catch (err) {
    console.error("Klasör listesi güncellenemedi:", err);
  }
}

function wireKlasorSecici() {
  const secim = document.getElementById("ic-klasor-secim");
  const yeniAdInput = document.getElementById("ic-klasor-yeni-ad");
  if (!secim || !yeniAdInput) return;
  secim.addEventListener("change", () => {
    yeniAdInput.hidden = secim.value !== "__yeni__";
    if (secim.value === "__yeni__") yeniAdInput.focus();
  });
}

/**
 * Bir yazı/proje düzenlemeye açıldığında, dosyanın gerçek yolundan
 * (item.path, örn. "_posts/2026/2026-08-14-x.md" ya da
 * "_projects/2026/x.md") hangi klasörde durduğunu çıkarır ve
 * "ic-klasor-secim" dropdown'ını buna göre ayarlar:
 *   - Klasör adı tarihin yılıyla birebir aynıysa ("otomatik" davranışın
 *     üreteceği isim) -> "Otomatik" seçili bırakılır, kullanıcı hiçbir
 *     şey değiştirmezse kaydettiğinde dosya aynı yerde kalır.
 *   - Farklı bir klasördeyse (özel isim ya da farklı yıl) -> o klasör
 *     dropdown'da yoksa geçici olarak eklenir ve seçili yapılır, böylece
 *     kaydettiğinde dosya YANLIŞLIKLA başka bir klasöre taşınmaz.
 *   - Dosya kök klasörde duruyorsa (alt klasörleme öncesinden kalma,
 *     örn. eski düz "_posts/2026-...md") -> "Otomatik" seçili bırakılır;
 *     kaydettiğinde dosya normal şekilde ilgili yıl klasörüne taşınır.
 */
function icerikDuzenlemeKlasorSecimineYansit(path, tarih, tur) {
  const secim = document.getElementById("ic-klasor-secim");
  const yeniAdInput = document.getElementById("ic-klasor-yeni-ad");
  if (!secim) return;

  const kokKlasor = kokKlasorAdi(tur);
  const parcalar = path.split("/"); // [kokKlasor, "<klasor>", "dosya.md"]
  const mevcutKlasor = parcalar.length === 3 && parcalar[0] === kokKlasor ? parcalar[1] : null;
  const otomatikOlacakKlasor = (tarih || "").slice(0, 4);

  yeniAdInput.hidden = true;
  yeniAdInput.value = "";

  if (!mevcutKlasor || mevcutKlasor === otomatikOlacakKlasor) {
    secim.value = "__auto__";
    return;
  }

  const zatenListede = [...secim.options].some((o) => o.value === mevcutKlasor);
  if (!zatenListede) {
    const opt = document.createElement("option");
    opt.value = mevcutKlasor;
    opt.textContent = `${kokKlasor}/${mevcutKlasor}/`;
    secim.insertBefore(opt, secim.querySelector('option[value="__yeni__"]'));
  }
  secim.value = mevcutKlasor;
}

/* ---------------------------------------------------------------------- */
/* KLASÖR YÖNETİMİ (_posts/ ve _projects/ altındaki alt klasörler) BÖLÜMÜ */
/* ---------------------------------------------------------------------- */

/** Verilen kök koleksiyon klasörünün ("_posts" ya da "_projects") altındaki
 * alt klasörlerin adlarını döner — artık GitHub'a AYRICA istek atmadan,
 * PANEL_VERI önbelleğinden (bkz. panelVerisiniYukle) okur. */
function koleksiyonKlasorleriniListele(kokKlasor) {
  const veri = PANEL_VERI?.koleksiyonlar?.[kokKlasor];
  if (!veri) return [];
  return veri.klasorler.map((k) => k.name);
}

/** "Klasörler" sekmesinde şu an hangi koleksiyonun (blog/proje) gösterildiğini tutar. */
let KLASOR_SEKME_TUR = "blog";

function wireKlasorYonetimi() {
  const yenileBtn = document.getElementById("kl-liste-yenile-btn");
  const olusturBtn = document.getElementById("kl-olustur-btn");
  const yeniAdInput = document.getElementById("kl-yeni-ad");
  if (!yenileBtn || !olusturBtn || !yeniAdInput) return;

  document.querySelectorAll(".gy-klasor-tur-sekme").forEach((btn) => {
    btn.addEventListener("click", () => {
      KLASOR_SEKME_TUR = btn.dataset.klasorTur;
      document.querySelectorAll(".gy-klasor-tur-sekme").forEach((b) => {
        b.classList.toggle("active", b === btn);
        b.setAttribute("aria-selected", b === btn ? "true" : "false");
      });
      document.getElementById("kl-baslik-koleksiyon").textContent = kokKlasorAdi(KLASOR_SEKME_TUR);
      klasorListesiYukle();
    });
  });

  // "Yenile" tıklanınca GERÇEKTEN tazelenir: PANEL_VERI önbelleği TEK bir
  // istekle yenilenir (bkz. panelListeleriniTazele), sonra liste o güncel
  // önbellekten çizilir — eskisi gibi klasör başına ayrı istek YOK.
  yenileBtn.addEventListener("click", async () => {
    await panelListeleriniTazele();
    klasorListesiYukle();
  });
  olusturBtn.addEventListener("click", () => klasorOlustur());
  yeniAdInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      klasorOlustur();
    }
  });

  wireKlasorSecici();
  // "Klasörler" sekmesine her tıklandığında (bağlantı doğrulanmışsa) listeyi tazele.
  document.querySelector('#gy-nav a[data-section="klasorler"]')?.addEventListener("click", async () => {
    if (!GH_BAGLI) return;
    await panelListeleriniTazele();
    klasorListesiYukle();
  });
}

/**
 * GitHub'da "gerçek" boş klasör kavramı yoktur — bir klasör sadece
 * içinde en az bir dosya varsa var olur. Bu yüzden yeni klasör oluşturma,
 * o klasörün altına görünmez, sitede hiçbir şekilde kullanılmayan küçük
 * bir .gitkeep dosyası yazarak yapılır. Jekyll nokta ile başlayan
 * dosyaları derlemeye dahil etmez, yani bu dosya sitede ASLA görünmez
 * veya listelenmez.
 */
const GITKEEP_ICERIK = "Bu dosya, GitHub'da boş klasörlerin var olabilmesi için buradadır. Silme.\n";

/**
 * .gitkeep dosyasının içeriğini, klasörü (yeniden) oluşturan kişinin
 * kimliğini de taşıyacak şekilde üretir — TEK amacı, editor rolünün
 * SADECE KENDİ oluşturduğu boş klasörleri silebilmesini sağlamaktır (bkz.
 * klasorKartiCiz / klasorSil ve Worker'daki karşılığı). Bu bilgi olmadan
 * (ör. bu değişiklikten ÖNCE oluşturulmuş eski .gitkeep dosyalarında)
 * sahip bilinmiyor sayılır ve editor için silme varsayılan olarak
 * KAPALI kalır (bkz. gitkeepSahibiId).
 */
function gitkeepIcerigiOlustur(sahipId) {
  const satirlar = [GITKEEP_ICERIK.trimEnd()];
  if (sahipId) satirlar.push(`olusturan_id: ${sahipId}`);
  return satirlar.join("\n") + "\n";
}

/** Bir .gitkeep dosyasının düz metin içeriğinden "olusturan_id" değerini okur (yoksa null). */
function gitkeepSahibiId(icerikMetni) {
  const m = (icerikMetni || "").match(/^olusturan_id:\s*(.+)$/m);
  return m ? m[1].trim() : null;
}

async function klasorOlustur() {
  const msgEl = document.getElementById("kl-message");
  const input = document.getElementById("kl-yeni-ad");
  const btn = document.getElementById("kl-olustur-btn");
  msgEl.hidden = true;
  const kokKlasor = kokKlasorAdi(KLASOR_SEKME_TUR);

  const ad = klasorAdiTemizle(input.value.trim());
  if (!ad) {
    showMessage(msgEl, "Geçerli bir klasör adı gir (harf, rakam, tire).", "error");
    return;
  }

  btn.disabled = true;
  btn.textContent = "Oluşturuluyor...";
  try {
    const mevcut = await ghGetContents(`${kokKlasor}/${ad}/.gitkeep`).catch(() => null);
    if (mevcut) {
      showMessage(msgEl, `"${kokKlasor}/${ad}/" klasörü zaten var.`, "error");
      return;
    }
    await ghPutFile(
      `${kokKlasor}/${ad}/.gitkeep`,
      b64Encode(gitkeepIcerigiOlustur(GIRIS_YAPAN_PROFIL?.id)),
      `Klasör oluşturuldu: ${kokKlasor}/${ad}/`
    );
    input.value = "";
    showMessage(msgEl, `"${kokKlasor}/${ad}/" klasörü oluşturuldu.`, "success");
    await panelListeleriniTazele();
    klasorListesiYukle();
    await icerikFormuKlasorSecimGuncelle();
  } catch (err) {
    showMessage(msgEl, `Hata: ${err.message}`, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "➕ Klasör Oluştur";
  }
}

/**
 * "Klasörler" listesini çizer — artık GitHub'a AYRICA istek atmadan,
 * PANEL_VERI önbelleğinden okur (dosya sayısı ve boş klasörlerin .gitkeep
 * sahip id'si Worker'ın /panel-init uç noktasında zaten hesaplanmış
 * geliyor, bkz. panelVerisiniYukle). Güncel veri istenen her durumda
 * (yenile butonu, sekme/klasör-türü değişimi, nav tıklaması) ÖNCE
 * panelListeleriniTazele() ile önbellek tazelenip SONRA bu fonksiyon
 * çağrılır.
 */
function klasorListesiYukle() {
  const el = document.getElementById("kl-liste");
  if (!el) return;
  const kokKlasor = kokKlasorAdi(KLASOR_SEKME_TUR);
  if (!GH_BAGLI || !PANEL_VERI) {
    el.innerHTML = '<p class="muted">Önce "GitHub Bağlantısı" sekmesinden bağlantını doğrula.</p>';
    return;
  }

  const klasorler = PANEL_VERI.koleksiyonlar?.[kokKlasor]?.klasorler || [];
  if (klasorler.length === 0) {
    el.innerHTML = '<p class="muted">Henüz hiç alt klasör yok.</p>';
    return;
  }

  const detaylar = klasorler
    .map((k) => ({ ad: k.name, path: k.path, dosyaSayisi: k.dosyaSayisi, kokKlasor, sahipId: k.sahipId ?? null }))
    .sort((a, b) => b.ad.localeCompare(a.ad));

  el.innerHTML = "";
  detaylar.forEach((k) => el.appendChild(klasorKartiCiz(k)));
}

function klasorKartiCiz(k) {
  const kart = document.createElement("div");
  kart.className = "gy-klasor-kart";
  const dolu = k.dosyaSayisi > 0;
  // editor rolü SADECE kendi oluşturduğu boş klasörleri silebilir; içerik
  // sorumlusunun (manager) ya da admin'in oluşturduğu (ya da sahibi
  // bilinmeyen, bu değişiklikten ÖNCE oluşturulmuş) boş klasörleri silemez.
  // Gerçek sınır Worker'dadır (bkz. cloudflare worker/
  // github_icerik_yonetim_worker/worker.js), burası sadece butonu önceden
  // gizleyen bir kolaylık katmanı. manager/admin bu kısıttan etkilenmez.
  const editorBaskasininKlasoruMu = GIRIS_YAPAN_PROFIL?.role === "editor" && k.sahipId !== GIRIS_YAPAN_PROFIL?.id;
  const silDevreDisi = dolu || editorBaskasininKlasoruMu;
  const silBaslik = dolu
    ? "Önce içindeki dosyaları başka bir klasöre taşı ya da sil"
    : editorBaskasininKlasoruMu
    ? "Bu klasörü sadece oluşturan kişi (içerik sorumlusu/admin) silebilir"
    : "";
  kart.innerHTML = `
    <div class="gy-klasor-kart-bilgi">
      <div class="gy-klasor-kart-baslik">📁 ${escapeHtml(k.kokKlasor)}/${escapeHtml(k.ad)}/</div>
      <div class="gy-klasor-kart-meta">${k.dosyaSayisi} ${k.kokKlasor === "_projects" ? "proje" : "yazı"}</div>
    </div>
    <div class="gy-klasor-kart-aksiyonlar">
      <button type="button" class="gy-klasor-yenidenadlandir-btn">Yeniden Adlandır</button>
      <button type="button" class="gy-klasor-sil-btn" ${silDevreDisi ? "disabled" : ""} title="${silBaslik}">Sil</button>
    </div>
  `;
  kart.querySelector(".gy-klasor-yenidenadlandir-btn").addEventListener("click", () => klasorYenidenAdlandir(k));
  const silBtn = kart.querySelector(".gy-klasor-sil-btn");
  if (!silDevreDisi) {
    silBtn.addEventListener("click", () => klasorSil(k));
  }
  return kart;
}

/**
 * Bir klasörü yeniden adlandırır: içindeki HER dosyayı (yazılar/projeler +
 * .gitkeep) yeni klasör adının altına aynı dosya adıyla yeniden yazar,
 * sonra eskilerini siler. GitHub Contents API'de "taşıma"/"rename"
 * doğrudan yoktur, bu yüzden dosya bazında kopyala+sil yapılır. İşlem
 * sırasında bir hata olursa (örn. yarı yolda ağ kopması) klasörde hem
 * eski hem yeni dosyalar kalmış olabilir — bu durumda hata mesajı
 * kullanıcıyı listeyi yenileyip elle kontrol etmeye yönlendirir.
 */
async function klasorYenidenAdlandir(k) {
  const msgEl = document.getElementById("kl-message");
  msgEl.hidden = true;
  const yeniAdHam = window.prompt(`"${k.kokKlasor}/${k.ad}/" klasörünü nasıl adlandırmak istersin?`, k.ad);
  if (yeniAdHam === null) return;
  const yeniAd = klasorAdiTemizle(yeniAdHam.trim());
  if (!yeniAd) {
    showMessage(msgEl, "Geçerli bir klasör adı gir.", "error");
    return;
  }
  if (yeniAd === k.ad) return;

  const hedefVarMi = await ghGetContents(`${k.kokKlasor}/${yeniAd}`).catch(() => null);
  if (hedefVarMi) {
    showMessage(msgEl, `"${k.kokKlasor}/${yeniAd}/" adında bir klasör zaten var.`, "error");
    return;
  }

  if (
    !confirm(`"${k.kokKlasor}/${k.ad}/" içindeki tüm dosyalar "${k.kokKlasor}/${yeniAd}/" klasörüne taşınacak. Onaylıyor musun?`)
  ) {
    return;
  }

  try {
    const icerik = await ghGetContents(k.path);
    for (const dosya of icerik) {
      if (dosya.type !== "file") continue;
      const detay = await ghGetContents(dosya.path);
      await ghPutFile(
        `${k.kokKlasor}/${yeniAd}/${dosya.name}`,
        detay.content.replace(/\n/g, ""),
        `Klasör yeniden adlandırıldı: ${k.ad} -> ${yeniAd} (${dosya.name})`
      );
      await ghDeleteFile(
        dosya.path,
        dosya.sha,
        `Klasör yeniden adlandırıldı: ${k.ad} -> ${yeniAd} (${dosya.name} temizlendi)`
      );
    }
    showMessage(msgEl, `"${k.kokKlasor}/${k.ad}/" → "${k.kokKlasor}/${yeniAd}/" olarak yeniden adlandırıldı.`, "success");
    await panelListeleriniTazele();
    klasorListesiYukle();
    await icerikFormuKlasorSecimGuncelle();
    icerikListesiYukle();
  } catch (err) {
    showMessage(
      msgEl,
      `Hata: ${err.message} — işlem yarıda kalmış olabilir, listeyi yenileyip ${k.kokKlasor}/${k.ad}/ ve ${k.kokKlasor}/${yeniAd}/ klasörlerini GitHub'dan kontrol et.`,
      "error"
    );
  }
}

/** Sadece .gitkeep içeren (yani gerçekte BOŞ olan) bir klasörü siler. Doluysa VEYA
 * (editor rolü için) başkasının oluşturduğu bir klasörse buton zaten devre dışı
 * bırakılmıştır ama yine de burada da kontrol edilir (asıl sınır Worker'dadır). */
async function klasorSil(k) {
  const msgEl = document.getElementById("kl-message");
  msgEl.hidden = true;
  if (GIRIS_YAPAN_PROFIL?.role === "editor" && k.sahipId !== GIRIS_YAPAN_PROFIL?.id) {
    showMessage(msgEl, "Bu klasörü sadece oluşturan kişi silebilir.", "error");
    return;
  }
  if (!confirm(`"${k.kokKlasor}/${k.ad}/" klasörü silinsin mi? Bu işlem geri alınamaz.`)) return;
  try {
    const icerik = await ghGetContents(k.path);
    const dosyalar = (icerik || []).filter((f) => f.type === "file");
    const gercekDosyalar = dosyalar.filter((f) => f.name !== ".gitkeep");
    if (gercekDosyalar.length > 0) {
      showMessage(msgEl, "Bu klasörde hâlâ içerik var, önce onları taşı ya da sil.", "error");
      return;
    }
    for (const dosya of dosyalar) {
      await ghDeleteFile(dosya.path, dosya.sha, `Klasör silindi: ${k.kokKlasor}/${k.ad}/ (${dosya.name})`);
    }
    showMessage(msgEl, `"${k.kokKlasor}/${k.ad}/" klasörü silindi.`, "success");
    await panelListeleriniTazele();
    klasorListesiYukle();
    await icerikFormuKlasorSecimGuncelle();
  } catch (err) {
    showMessage(msgEl, `Hata: ${err.message}`, "error");
  }
}

/* ---------------------------------------------------------------------- */
/* HAFİF MARKDOWN EDİTÖR ARAÇ ÇUBUĞU                                      */
/* ---------------------------------------------------------------------- */
function wireEditorToolbar() {
  document.querySelectorAll(".gy-editor-toolbar button[data-md]").forEach((btn) => {
    btn.addEventListener("click", () => markdownUygula(btn.dataset.md));
  });
}

/**
 * Seçili metni (varsa) bir "sarmalayıcı" (wrapper) ile sarar — örn. **metin**.
 * Seçim yoksa yer tutucu metinle birlikte wrapper eklenir ve o yer tutucu
 * seçili bırakılır ki kullanıcı hemen üzerine yazabilsin.
 */
function satirIciUygula(ta, start, end, secili, onEk, sonEk, yerTutucu) {
  const govde = secili || yerTutucu;
  const yeni = `${onEk}${govde}${sonEk}`;
  ta.setRangeText(yeni, start, end, "select");
  if (!secili) {
    // Yer tutucu metni seçili bırak (onEk uzunluğu kadar içeriden başlar).
    ta.setSelectionRange(start + onEk.length, start + onEk.length + yerTutucu.length);
  }
}

/** Seçili metnin HER SATIRINI bir önekle başlatır (liste, alıntı, başlık gibi bloklar için). */
function satirBasinaUygula(ta, start, end, secili, onEkUretici, yerTutucu) {
  const govde = secili || yerTutucu;
  const satirlar = govde.split("\n");
  const yeni = satirlar.map((s, i) => `${onEkUretici(i)}${s}`).join("\n");
  ta.setRangeText(yeni, start, end, "end");
}

/** İmlecin bulunduğu satırın başında mı sonunda mı olduğuna bakmadan, blok öncesi/sonrası için gereken boş satırları ekler. */
function blokIcinBosSatirGerekliMi(ta, start) {
  if (start === 0) return { once: "", sonra: "\n" };
  const oncekiKarakter = ta.value[start - 1];
  return { once: oncekiKarakter === "\n" ? "" : "\n", sonra: "\n" };
}

function markdownUygula(tur) {
  const ta = document.getElementById("ic-body");
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const secili = ta.value.slice(start, end);

  switch (tur) {
    /* --- satır içi biçimlendirme --- */
    case "bold":
      satirIciUygula(ta, start, end, secili, "**", "**", "kalın metin");
      ta.focus();
      return;
    case "italic":
      satirIciUygula(ta, start, end, secili, "*", "*", "italik metin");
      ta.focus();
      return;
    case "strikethrough":
      satirIciUygula(ta, start, end, secili, "~~", "~~", "üstü çizili metin");
      ta.focus();
      return;
    case "inline-code":
      satirIciUygula(ta, start, end, secili, "`", "`", "kod");
      ta.focus();
      return;

    /* --- başlıklar (satır başına ##/###/#### eklenir) --- */
    case "h2":
    case "h3":
    case "h4": {
      const { once, sonra } = blokIcinBosSatirGerekliMi(ta, start);
      const onek = tur === "h2" ? "## " : tur === "h3" ? "### " : "#### ";
      const yeni = `${once}${onek}${secili || "Başlık"}${sonra}`;
      ta.setRangeText(yeni, start, end, "end");
      ta.focus();
      return;
    }

    /* --- liste türleri (satır başına eklenir) --- */
    case "list":
      satirBasinaUygula(ta, start, end, secili, () => "- ", "liste maddesi");
      ta.focus();
      return;
    case "ordered-list":
      satirBasinaUygula(ta, start, end, secili, (i) => `${i + 1}. `, "liste maddesi");
      ta.focus();
      return;
    case "task-list":
      satirBasinaUygula(ta, start, end, secili, () => "- [ ] ", "yapılacak");
      ta.focus();
      return;

    /* --- alıntı --- */
    case "quote":
      satirBasinaUygula(ta, start, end, secili, () => "> ", "alıntı metni");
      ta.focus();
      return;

    /* --- kod bloğu (dil isteğe bağlı sorulur) --- */
    case "code-block": {
      const dil = window.prompt(
        "Kod bloğunun dili (opsiyonel, boş bırakabilirsin — örn. js, python, bash):",
        ""
      );
      if (dil === null) return; // vazgeçildi
      const { once, sonra } = blokIcinBosSatirGerekliMi(ta, start);
      const govde = secili || "kod buraya";
      const yeni = `${once}\`\`\`${dil.trim()}\n${govde}\n\`\`\`${sonra}`;
      ta.setRangeText(yeni, start, end, "end");
      ta.focus();
      return;
    }

    /* --- yatay çizgi --- */
    case "hr": {
      const { once, sonra } = blokIcinBosSatirGerekliMi(ta, start);
      const yeni = `${once}---${sonra}`;
      ta.setRangeText(yeni, start, end, "end");
      ta.focus();
      return;
    }

    /* --- bağlantı --- */
    case "link": {
      const url = window.prompt("Bağlantı URL'si:", "https://");
      if (!url) return;
      satirIciUygula(ta, start, end, secili, "[", `](${url})`, "bağlantı metni");
      ta.focus();
      return;
    }

    /* --- görsel (SADECE dış URL — GitHub'a dosya yüklemez) --- */
    case "image": {
      const url = window.prompt("Görselin URL'si (dış bağlantı, örn. https://... .jpg/.png):", "https://");
      if (!url) return;
      const altMetin = window.prompt(
        "Görsel için kısa açıklama (alt metin — erişilebilirlik ve SEO için önerilir):",
        secili || ""
      );
      const { once, sonra } = blokIcinBosSatirGerekliMi(ta, start);
      const yeni = `${once}![${(altMetin || "").trim()}](${url.trim()})${sonra}`;
      ta.setRangeText(yeni, start, end, "end");
      ta.focus();
      return;
    }

    /* --- tablo şablonu (2 sütun, 2 satırlık iskelet — kullanıcı doldurur) --- */
    case "table": {
      const { once, sonra } = blokIcinBosSatirGerekliMi(ta, start);
      const yeni =
        `${once}| Başlık 1 | Başlık 2 |\n` + `| --- | --- |\n` + `| Hücre 1 | Hücre 2 |\n` + `| Hücre 3 | Hücre 4 |${sonra}`;
      ta.setRangeText(yeni, start, end, "end");
      ta.focus();
      return;
    }

    default:
      return;
  }
}

/* ---------------------------------------------------------------------- */
/* SLUG / RASTGELE ÖN İZLEME KODU ÜRETİMİ                                 */
/* ---------------------------------------------------------------------- */
function rastgeleKod(uzunluk = 8) {
  const alfabe = "abcdefghijklmnopqrstuvwxyz0123456789";
  const rastgeleBaytlar = new Uint8Array(uzunluk);
  crypto.getRandomValues(rastgeleBaytlar);
  return Array.from(rastgeleBaytlar, (b) => alfabe[b % alfabe.length]).join("");
}

const TR_HARF_ESLESTIRME = {
  ç: "c", Ç: "c", ğ: "g", Ğ: "g", ı: "i", İ: "i",
  ö: "o", Ö: "o", ş: "s", Ş: "s", ü: "u", Ü: "u",
};

function slugOlustur(metin) {
  return metin
    .split("")
    .map((ch) => TR_HARF_ESLESTIRME[ch] ?? ch)
    .join("")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/* ---------------------------------------------------------------------- */
/* FRONT MATTER OLUŞTURMA / OKUMA                                         */
/* ---------------------------------------------------------------------- */
function fmSatiri(anahtar, deger, ciplak = false) {
  if (deger === undefined || deger === null || deger === "") return null;
  if (ciplak) return `${anahtar}: ${deger}`;
  return `${anahtar}: "${String(deger).replace(/"/g, '\\"')}"`;
}

/**
 * Front matter + gövdeden tam Markdown dosya içeriğini üretir. GitHub'a
 * yazılacak HER içerik için kullanılır — hem normal yayınlama (yayinda:
 * true) hem de eski "GitHub'a gizli commit et" yöntemi (yayinda: false +
 * tahmin edilemez permalink, bkz. rehber/01-site-rehberi.md § 9) için.
 *
 * yayinda=true iken: `sitemap: true`, `permalink` hiç yazılmaz (Jekyll
 * dosya adından üretir), gizliKod sadece görünmez `onizleme_kod` alanı
 * olarak saklanır (TEK amacı: içerik sonradan "Yayından Kaldır" ile
 * Supabase'e taşınırsa AYNI ön izleme linkinin geri dönebilmesi).
 *
 * yayinda=false iken (GitHub'a gizli commit): `sitemap: false` YAZILIR
 * (aksi halde sayfa sitemap.xml'de "keşfedilebilir" kalır) ve gizliKod
 * `permalink: /blog/on-izleme-<kod>/` (ya da proje için `/projects/...`)
 * olarak yazılır — gizliliğin TEK dayanağı bu adresin tahmin edilemez
 * kalmasıdır.
 */
function dosyaIcerigiOlustur(tur, alan, gizliKod, govde, yayinda = true) {
  const satirlar = ["---"];
  satirlar.push(fmSatiri("title", alan.title));
  satirlar.push(fmSatiri("author", alan.author));
  // yazar_id: GitHub'a commit edilen dosyalarda da GÜVENİLİR bir sahiplik
  // kimliği tutmak için eklendi (bkz. icerikKendisineMiAit / Worker'daki
  // ownership kontrolü) — "author" sadece görüntülenen bir isim metnidir,
  // taklit edilebilir; yazar_id ise panelin kendi doldurduğu gerçek
  // Supabase kullanıcı id'sidir.
  satirlar.push(fmSatiri("yazar_id", alan.yazarId));
  // olusturan_id: içeriği GERÇEKTEN oluşturan kişinin id'si — yazar_id'den
  // FARKLI bir alan. "Admin adına yayınla" akışında yazar_id hedef admin'i
  // taşır (görünen yazar odur) ama içeriği gerçekte oluşturan editor/manager
  // hâlâ kendi id'siyle sahiplik/düzenleme hakkını korumalı (bkz.
  // icerikKendisineMiAit ve Worker'daki editorSahibiMi — klasörlerdeki
  // .gitkeep "olusturan_id" alanıyla AYNI mantık, bkz. gitkeepIcerigiOlustur).
  // Admin-adına DEĞİLSE (normal durum) bu, yazar_id ile aynı kişidir.
  satirlar.push(fmSatiri("olusturan_id", alan.olusturanId));

  if (tur === "proje") {
    satirlar.push(fmSatiri("venue", alan.venue));
    satirlar.push(fmSatiri("status", alan.status));
    satirlar.push(fmSatiri("summary", alan.summary));
    satirlar.push(fmSatiri("link", alan.link));
    satirlar.push(fmSatiri("link_label", alan.link_label));
  }

  satirlar.push(fmSatiri("yayinda", yayinda, true));
  if (yayinda) {
    satirlar.push(fmSatiri("sitemap", true, true));
    if (gizliKod) {
      satirlar.push(fmSatiri("onizleme_kod", gizliKod));
    }
  } else {
    satirlar.push(fmSatiri("sitemap", false, true));
    if (gizliKod) {
      const onek = tur === "proje" ? "/projects" : "/blog";
      satirlar.push(fmSatiri("permalink", `${onek}/on-izleme-${gizliKod}/`));
    }
  }

  satirlar.push("---");
  const frontMatter = satirlar.filter(Boolean).join("\n");
  return `${frontMatter}\n\n${govde.trim()}\n`;
}

/**
 * Bir içeriğin gizli ön izleme kodunu bulur: önce (eski/legacy dosyalarda
 * hâlâ olabilecek) `permalink` alanından, yoksa `onizleme_kod` alanından
 * (Supabase'teki taslak satırlarında bu alan HER ZAMAN dolu) okur. İkisi de
 * yoksa null döner.
 */
function icerikGizliKoduBul(data) {
  return permalinktenGizliKoduCikar(data?.permalink) || data?.onizleme_kod || null;
}

/** Bir permalink değerinden ("/blog/on-izleme-abc123/" gibi) gizli kodu çıkarır, yoksa null döner. */
function permalinktenGizliKoduCikar(permalink) {
  if (!permalink) return null;
  const m = String(permalink).match(/on-izleme-([a-z0-9]+)\/?$/);
  return m ? m[1] : null;
}

/** Basit front-matter okuyucu — bu panelin ürettiği sınırlı alan setiyle çalışacak şekilde tasarlandı. */
function frontMatterOku(ham) {
  const eslesme = ham.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!eslesme) return { data: {}, body: ham };

  const data = {};
  eslesme[1].split(/\r?\n/).forEach((satir) => {
    const m = satir.match(/^([a-zA-Z_]+):\s?(.*)$/);
    if (!m) return;
    const anahtar = m[1];
    let deger = m[2].trim();
    if (!deger.startsWith('"')) {
      const yorumIndex = deger.indexOf("#");
      if (yorumIndex !== -1) deger = deger.slice(0, yorumIndex).trim();
    }
    if (deger.startsWith('"') && deger.endsWith('"') && deger.length >= 2) {
      deger = deger.slice(1, -1).replace(/\\"/g, '"');
    }
    if (deger === "true") data[anahtar] = true;
    else if (deger === "false") data[anahtar] = false;
    else data[anahtar] = deger;
  });

  return { data, body: (eslesme[2] || "").replace(/^\n+/, "") };
}

/**
 * Hem blog yazıları (_posts/) hem akademik projeler (_projects/) alt
 * klasörlenebilir. Her iki koleksiyon için de dosya YOLU tamamen
 * serbesttir — permalink blog'da dosya ADINDAKİ (YYYY-AY-GUN-slug.md)
 * tarih ve slug'dan, projelerde ise `_config.yml`'deki `permalink:
 * /projects/:name/` şemasına göre YİNE dosya ADINDAN üretilir. Yani her
 * iki türde de dosyanın hangi alt klasörde durduğu URL'i ETKİLEMEZ, bu
 * yüzden klasör organizasyonu mevcut linkleri/permalink şemasını
 * bozmadan sadece depo içindeki dosya düzenini ilgilendirir.
 *
 * klasor: kullanıcının "Klasör" seçicisinden seçtiği değer.
 *   - "__auto__" (ya da boş/undefined): eskisi gibi tarihin YILINA göre
 *     otomatik hesaplanır (_posts/<yıl>/... ya da _projects/<yıl>/...).
 *     Bu VARSAYILAN davranıştır, kullanıcı hiçbir şey seçmese de aynen
 *     çalışmaya devam eder — iki koleksiyon da birbiriyle simetriktir.
 *   - başka herhangi bir değer (örn. "2027", "seyahat", "konferanslar"):
 *     dosya doğrudan <koleksiyon>/<klasor>/... altına yazılır — yıldan
 *     bağımsız, tamamen serbest bir klasör adı olabilir.
 *
 * yilOneki: SADECE proje türünde, dosya ADINA (klasöre değil) yıl öneki
 * eklenip eklenmeyeceğini belirler (örn. _projects/2026/2026-proje.md).
 * Bu, klasörlemeden bağımsız, isteğe bağlı ayrı bir tercih — ikisi
 * birlikte de kullanılabilir.
 */
/* ---------------------------------------------------------------------- */
/* .GITKEEP YAŞAM DÖNGÜSÜ — bir klasöre gerçek içerik girince .gitkeep     */
/* temizlenir, klasörün SON gerçek dosyası da silinince .gitkeep geri     */
/* eklenir (aksi halde GitHub'da "boş klasör" diye bir şey olmadığından   */
/* klasör depodan tamamen kaybolur ve "📁 Klasörler" listesinde de artık  */
/* görünmez olurdu). Her iki fonksiyon da KOZMETİK bir iyileştirmedir;    */
/* başarısız olurlarsa (ör. .gitkeep zaten yok/var) sessizce yutulur,     */
/* çağıran asıl işlemi (içerik kaydetme/silme) ASLA başarısız kılmazlar.  */
/* ---------------------------------------------------------------------- */

/** Bir dosya yolundan onu içeren klasörün yolunu döner (ör. "_posts/2026/x.md" -> "_posts/2026"). */
function ustKlasorYolu(dosyaYolu) {
  const parcalar = dosyaYolu.split("/");
  parcalar.pop();
  return parcalar.join("/");
}

/** Verilen klasörde artık gerçek içerik olduğu için, oradaki .gitkeep dosyasını (varsa) siler. */
async function klasordekiGitkeepiTemizle(klasorYolu) {
  try {
    const gitkeep = await ghGetContents(`${klasorYolu}/.gitkeep`);
    if (gitkeep) {
      await ghDeleteFile(`${klasorYolu}/.gitkeep`, gitkeep.sha, `.gitkeep temizlendi: ${klasorYolu}/`);
    }
  } catch (err) {
    console.error(`.gitkeep temizlenemedi (${klasorYolu}):`, err);
  }
}

/** Bir dosya silindikten sonra klasörde başka hiç gerçek dosya kalmadıysa, klasörü korumak için .gitkeep geri ekler.
 * Bu, klasörü fiilen (yeniden) boş hâle getiren kişinin "olusturan_id" olarak
 * kaydedilmesi anlamına gelir — bkz. gitkeepIcerigiOlustur/klasorKartiCiz. */
async function klasorBosaldiysaGitkeepEkle(klasorYolu) {
  try {
    const icerik = await ghGetContents(klasorYolu);
    const gercekVarMi = Array.isArray(icerik) && icerik.some((f) => f.type === "file" && f.name !== ".gitkeep");
    if (!gercekVarMi) {
      const zatenVarMi = Array.isArray(icerik) && icerik.some((f) => f.name === ".gitkeep");
      if (!zatenVarMi) {
        await ghPutFile(
          `${klasorYolu}/.gitkeep`,
          b64Encode(gitkeepIcerigiOlustur(GIRIS_YAPAN_PROFIL?.id)),
          `Klasör boşaldı, .gitkeep geri eklendi: ${klasorYolu}/`
        );
      }
    }
  } catch (err) {
    console.error(`.gitkeep geri eklenemedi (${klasorYolu}):`, err);
  }
}

function dosyaYoluHesapla(tur, tarih, slug, yilOneki, klasor) {
  const yil = tarih.slice(0, 4);
  const kokKlasor = tur === "blog" ? "_posts" : "_projects";
  const altKlasor = klasor && klasor !== "__auto__" ? klasor : yil;

  if (tur === "blog") {
    return `${kokKlasor}/${altKlasor}/${tarih}-${slug}.md`;
  }
  const dosyaAdi = `${yilOneki ? yil + "-" : ""}${slug}.md`;
  return `${kokKlasor}/${altKlasor}/${dosyaAdi}`;
}

/**
 * Ön izleme linki kutusunu doldurup gösterir. Hem yeni kaydetme sonrası,
 * hem mevcut bir "yayında değil" içeriği düzenlemeye açarken, hem de
 * "Yayında" kapatıldığı anda (kaydetmeden ÖNCE) kullanılır — yani link
 * tek seferlik/salt-okunur değildir: kullanıcı kodu elle değiştirebilir
 * veya zar butonuyla yenileyebilir, her değişiklik input alanına yansır
 * ve bir sonraki kayıtta o kod kalıcı hale gelir.
 *
 * Link formatı: /onizleme/?tur=<blog|proje>&kod=<kod> — bu adres
 * assets/js/github-yonetim/onizleme.js tarafından okunup Supabase'teki
 * `taslak_onizleme_getir` RPC'sine sorulur (bkz. migration 0013).
 */
/** Formda o an seçili olan "yayında değilken nerede saklansın" hedefini döner: "supabase" | "github". */
function gizliHedefDegeriniAl() {
  return document.querySelector('input[name="gizli-hedef"]:checked')?.value || "supabase";
}

/**
 * Ön izleme linkinin öneki, seçilen hedefe göre TAMAMEN farklıdır:
 *  - "supabase": /onizleme/?tur=...&kod=... — assets/js/github-yonetim/onizleme.js
 *    tarafından okunup Supabase'teki `taslak_onizleme_getir` RPC'sine
 *    sorulan, GitHub'a hiç dokunmayan bir ara sayfa.
 *  - "github": doğrudan gerçek Jekyll sayfasının adresi (/blog/on-izleme-
 *    <kod>/ ya da /projects/on-izleme-<kod>/) — içerik gerçekten bu
 *    adreste GitHub'a commit edilmiş durumda duruyor (bkz.
 *    dosyaIcerigiOlustur ve rehber/01-site-rehberi.md § 9).
 */
function onizlemeOnekiHesapla(tur, kaynak) {
  if (kaynak === "github") {
    const kokYol = tur === "proje" ? "/projects" : "/blog";
    return `${location.origin}${kokYol}/on-izleme-`;
  }
  return `${location.origin}/onizleme/?tur=${tur}&kod=`;
}

function onizlemeKutusunuGoster(tur, gizliKod, kaynak = "supabase") {
  document.getElementById("ic-onizleme-onek").textContent = onizlemeOnekiHesapla(tur, kaynak);
  document.getElementById("ic-onizleme-kod").value = gizliKod;
  document.getElementById("ic-onizleme-kutusu").hidden = false;
  onizlemeLinkGuncelle();
}

function onizlemeKutusunuGizle() {
  document.getElementById("ic-onizleme-kutusu").hidden = true;
}

/** Kod girdisinden geçerli bir slug üretir (boşsa/temizse rastgele kod üretir), salt-okunur link kutusunu tazeler. */
function onizlemeLinkGuncelle() {
  const kodEl = document.getElementById("ic-onizleme-kod");
  const linkEl = document.getElementById("ic-onizleme-link");
  const onek = document.getElementById("ic-onizleme-onek").textContent;

  const temizKod = slugOlustur(kodEl.value);
  const gecerli = temizKod.length >= 3;
  kodEl.classList.toggle("gy-kod-gecersiz", kodEl.value.trim() !== "" && !gecerli);

  linkEl.value = gecerli ? `${onek}${temizKod}` : "Geçerli bir kod gir (en az 3 karakter, harf/rakam/tire)";
}

/** Formda o an geçerli olan (kaydedilecek) ön izleme kodunu döner; boş/geçersizse null. */
function onizlemedenGecerliKoduAl() {
  const kodEl = document.getElementById("ic-onizleme-kod");
  if (!kodEl || document.getElementById("ic-onizleme-kutusu").hidden) return null;
  const temizKod = slugOlustur(kodEl.value);
  return temizKod.length >= 3 ? temizKod : null;
}

/**
 * "Yayında" anahtarına canlı olarak bağlanır: kapatıldığı anda — daha önce
 * kaydedilmiş bir kod olsun ya da olmasın — hemen bir ön izleme linki
 * gösterilir (kod yoksa yeni bir tane üretilir), böylece "yayında değil"e
 * çevrilen bir içerik daha kaydedilmeden bile linkini görüp paylaşabilir.
 * Tekrar açılırsa kutu gizlenir.
 */
function wireYayindaCanliOnizleme() {
  document.getElementById("ic-yayinda").addEventListener("change", (e) => {
    document.getElementById("ic-gizli-hedef-wrap").hidden = e.target.checked;
    if (e.target.checked) {
      onizlemeKutusunuGizle();
    } else {
      onizlemeKutusunuGoster(icerikTuru(), DUZENLENEN_GIZLI_KOD || rastgeleKod(8), gizliHedefDegeriniAl());
    }
    submitButonMetniGuncelle();
  });

  // "Nerede saklansın?" (Supabase / GitHub) seçimi değiştiğinde, hâlâ
  // "Yayında" kapalıyken canlı ön izleme kutusunun linkini de günceller
  // (öneki tamamen değişiyor — bkz. onizlemeOnekiHesapla).
  document.querySelectorAll('input[name="gizli-hedef"]').forEach((r) => {
    r.addEventListener("change", () => {
      if (!document.getElementById("ic-yayinda").checked) {
        const kodEl = document.getElementById("ic-onizleme-kod");
        onizlemeKutusunuGoster(icerikTuru(), kodEl.value || DUZENLENEN_GIZLI_KOD || rastgeleKod(8), gizliHedefDegeriniAl());
      }
      submitButonMetniGuncelle();
    });
  });

  document.getElementById("ic-onizleme-kod").addEventListener("input", onizlemeLinkGuncelle);
  document.getElementById("ic-onizleme-yenile-btn").addEventListener("click", () => {
    document.getElementById("ic-onizleme-kod").value = rastgeleKod(8);
    onizlemeLinkGuncelle();
  });

  const kopyalaBtn = document.getElementById("ic-onizleme-kopyala-btn");
  kopyalaBtn.addEventListener("click", async () => {
    const input = document.getElementById("ic-onizleme-link");
    if (!input.value || input.value.startsWith("Geçerli bir kod")) return;
    try {
      await navigator.clipboard.writeText(input.value);
      kopyalaBtn.textContent = "Kopyalandı ✓";
    } catch {
      input.select();
      document.execCommand("copy");
      kopyalaBtn.textContent = "Kopyalandı ✓";
    }
    setTimeout(() => (kopyalaBtn.textContent = "Kopyala"), 1600);
  });
}

/* ---------------------------------------------------------------------- */
/* İÇERİK EKLE / DÜZENLE FORMU                                            */
/* ---------------------------------------------------------------------- */
function wireIcerikForm() {
  document.getElementById("icerik-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    await icerikKaydet("a");
  });
  const btnB = document.getElementById("ic-submit-b-btn");
  if (btnB) {
    btnB.addEventListener("click", async () => {
      await icerikKaydet("b");
    });
  }
  const btnC = document.getElementById("ic-submit-c-btn");
  if (btnC) {
    btnC.addEventListener("click", async () => {
      await icerikKaydet("c");
    });
  }
  document.getElementById("ic-iptal-btn").addEventListener("click", duzenlemeyiIptalEt);
}

function duzenlemeyiKapat() {
  DUZENLENEN_YOL = null;
  DUZENLENEN_SHA = null;
  DUZENLENEN_TASLAK_ID = null;
  DUZENLENEN_GIZLI_KOD = null;
  DUZENLENEN_OLUSTURAN_ID = null;
  document.getElementById("ic-iptal-btn").hidden = true;
  guncelleIcerikTuru();
  submitButonMetniGuncelle();
}

function duzenlemeyiIptalEt() {
  duzenlemeyiKapat();
  document.getElementById("icerik-form").reset();
  document.getElementById("ic-date").value = new Date().toISOString().slice(0, 10);
  document.getElementById("ic-gizli-hedef-wrap").hidden = true;
  onizlemeKutusunuGizle();
  guncelleIcerikTuru();
  submitButonMetniGuncelle();
  // form.reset() az önce editor'ün salt-okunur yazar alanını (readonly
  // input'un JS ile atanmış değerini, native reset bunu bilmediği için)
  // boşaltmış olabilir — kendi adıyla yeniden doldur.
  wireYazarAlani();
  // "Admin adına yayınla" kutusu da form.reset() ile işaretsiz hâle
  // döndü ama ADMIN_ADINA_HEDEF değişkeni ve "Yayında"/"gizli-hedef"
  // kilitleri hâlâ eski durumda kalabilir — change olayını tetikleyip
  // uygula()'yı yeniden çalıştırıyoruz.
  document.getElementById("ic-admin-adina-kutu")?.dispatchEvent(new Event("change"));
}

const SECENEK_BUTON_ID = {
  a: "ic-submit-btn",
  b: "ic-submit-b-btn",
  c: "ic-submit-c-btn",
};

async function icerikKaydet(secenek = "a") {
  const msgEl = document.getElementById("ic-message");
  const submitBtn = document.getElementById(SECENEK_BUTON_ID[secenek] || SECENEK_BUTON_ID.a);
  msgEl.hidden = true;

  const tur = icerikTuru();
  const title = document.getElementById("ic-title").value.trim();
  const date = document.getElementById("ic-date").value;

  if (!title || !date) {
    showMessage(msgEl, "Başlık ve tarih zorunludur.", "error");
    return;
  }

  const yazar = yazarBilgisiniAl();
  if (!yazar.ad) {
    showMessage(msgEl, "Yazar bilgisi belirlenemedi (profil adı boş) — lütfen bir yazar seç/yaz.", "error");
    return;
  }
  if (ADMIN_ADINA_HEDEF && !ADMIN_ADINA_HEDEF.id) {
    showMessage(msgEl, '"Admin/Site Sahibi adına yayınla" işaretli ama hedef seçilmedi.', "error");
    return;
  }

  // BUG FİX (bkz. "site sahibi adına onaysız yayın" raporu): bir admin
  // (owner DEĞİL), "Yazar" arama kutusundan KENDİSİ DIŞINDA birini —
  // özellikle Site Sahibi'ni (owner) ya da başka bir admin'i — seçip
  // ADMIN_ADINA_HEDEF/onay kutusunu HİÇ işaretlemeden normal "Yayınla"
  // butonlarından (Seçenek A/B, ikisi de GitHub'a commit atar) birine
  // basarsa, içerik onay sürecine hiç girmeden doğrudan GERÇEKTEN yayına
  // alınabiliyordu (asıl güvenlik sınırı olan Worker artık bunu ayrıca
  // reddediyor, bkz. github_icerik_yonetim_worker/worker.js § 4.2 — ama
  // burada da erken, anlaşılır bir istemci tarafı uyarısı veriyoruz, kötü
  // niyetli olmayan bir adminin "neden reddedildi" diye şaşırmaması için).
  // Not: manager/editor için bu senaryo zaten mümkün değil — "Yazar" alanı
  // onlar için salt okunur (bkz. wireYazarAlani), sadece admin/owner
  // başkasını seçebilir; owner'a bu kısıt hiç uygulanmaz (o zaten en üst
  // yetkilidir, kendi adına ya da herkes adına doğrudan yayınlayabilir).
  if (
    GIRIS_YAPAN_PROFIL?.role === "admin" &&
    !ADMIN_ADINA_HEDEF &&
    yazar.id &&
    yazar.id !== GIRIS_YAPAN_PROFIL.id &&
    (secenek === "a" || secenek === "b") &&
    document.getElementById("ic-yayinda")?.checked
  ) {
    const hedefProfil = (YAZAR_ADAYLARI || []).find((u) => u.id === yazar.id);
    const hedefRolMu = hedefProfil?.role === "owner" || hedefProfil?.role === "admin";
    if (hedefRolMu || !hedefProfil) {
      showMessage(
        msgEl,
        `"${yazar.ad}" adına doğrudan yayınlayamazsın — bu, onay gerektiren bir işlemdir. Lütfen "Admin/Site Sahibi adına yayınla (onay gerekir)" kutusunu işaretleyip o akışı kullan.`,
        "error"
      );
      return;
    }
  }

  const slugGirdi = document.getElementById("ic-slug").value.trim();
  const slug = slugOlustur(slugGirdi || title);
  if (!slug) {
    showMessage(msgEl, "Geçerli bir dosya adı/slug üretilemedi, başlığı kontrol et.", "error");
    return;
  }

  const yayinda = document.getElementById("ic-yayinda").checked;
  const yilOneki = tur === "proje" && document.getElementById("ic-yil-oneki").checked;
  const klasor = klasorSecimDegeriniAl();

  const alan = {
    title,
    date,
    author: yazar.ad,
    yazarId: yazar.id,
    // Formu GÖNDEREN kişi her zaman GİRİŞ_YAPAN_PROFIL'dir — "admin adına
    // yayınla" işaretliyken bile (o zaman yazar.id hedef admin'i taşır,
    // olusturanId ise gerçek gönderen kalır). Bkz. dosyaIcerigiOlustur.
    olusturanId: GIRIS_YAPAN_PROFIL?.id || null,
    adminAdinaTalep: !!ADMIN_ADINA_HEDEF,
    // ADMIN_ADINA_HEDEF.rol 'admin' ya da 'owner' olabilir (bkz.
    // wireAdminAdinaTalep) — hangi talep alanının (admin_adina_talep /
    // sahip_adina_talep) işaretleneceğine bu belirliyor.
    hedefRol: ADMIN_ADINA_HEDEF?.rol || null,
  };
  if (tur === "proje") {
    alan.venue = document.getElementById("ic-venue").value.trim();
    alan.status = document.getElementById("ic-status").value;
    alan.summary = document.getElementById("ic-summary").value.trim();
    alan.link = document.getElementById("ic-link").value.trim();
    alan.link_label = document.getElementById("ic-link-label").value.trim();
  }

  const govde = document.getElementById("ic-body").value;
  // Kod her zaman (yayında olsa bile) korunur — bkz. dosyaIcerigiOlustur'un
  // başındaki açıklama. "Yayında değil" iken kullanıcı ön izleme kutusundaki
  // kodu elle değiştirmiş olabilir (onizlemedenGecerliKoduAl bunu okur).
  const gizliKod = !yayinda
    ? onizlemedenGecerliKoduAl() || DUZENLENEN_GIZLI_KOD || rastgeleKod(8)
    : DUZENLENEN_GIZLI_KOD || null;

  if (gizliKod && onizlemeKoduCakisiyorMu(tur, gizliKod, suAnDuzenlenenAnahtar())) {
    showMessage(
      msgEl,
      `Bu ön izleme kodu ("${gizliKod}") aynı türde başka bir içerik tarafından zaten kullanılıyor. Lütfen "🎲 Yenile" ile yeni bir kod üret ya da elle farklı bir kod yaz.`,
      "error"
    );
    return;
  }

  const dosyaYolu = dosyaYoluHesapla(tur, date, slug, yilOneki, klasor);

  const digerBtnler = Object.entries(SECENEK_BUTON_ID)
    .filter(([s]) => s !== secenek)
    .map(([, id]) => document.getElementById(id))
    .filter(Boolean);
  submitBtn.disabled = true;
  digerBtnler.forEach((b) => (b.disabled = true));
  const oncekiMetin = submitBtn.textContent;
  submitBtn.textContent = "Gönderiliyor...";
  try {
    if (yayinda && secenek === "b") {
      // Seçenek B: içerik hem Supabase'te (yedek/arama kaydı) kalıcı
      // olarak tutulur hem de GitHub'a commit edilir.
      await icerikSupabaseVeGithubaYaz(tur, alan, gizliKod, govde, slug, dosyaYolu, msgEl);
    } else if (yayinda && secenek === "c") {
      // Seçenek C: içerik GitHub'a HİÇ commit edilmez, sadece Supabase'te
      // (gerçekten yayında bir yazı olarak) tutulur.
      await icerikSadeceSupabaseeYayinla(tur, alan, gizliKod, govde, slug, dosyaYolu, msgEl);
    } else if (yayinda) {
      // Seçenek A (varsayılan/mevcut davranış): Supabase'e hiç dokunmadan
      // doğrudan GitHub'a commit edilir.
      await icerikGitHubaYaz(tur, alan, gizliKod, govde, dosyaYolu, msgEl);
    } else if (gizliHedefDegeriniAl() === "github") {
      await icerikGitHubaGizliYaz(tur, alan, gizliKod, govde, dosyaYolu, msgEl);
    } else {
      await icerikSupabaseeYaz(tur, alan, gizliKod, govde, slug, dosyaYolu, msgEl);
    }
    await panelListeleriniTazele();
    await icerikListesiYukle();
  } catch (err) {
    showMessage(msgEl, `Hata: ${err.message}`, "error");
    submitBtn.textContent = oncekiMetin;
  } finally {
    submitBtn.disabled = false;
    digerBtnler.forEach((b) => (b.disabled = false));
    submitButonMetniGuncelle();
  }
}

/** "Yayında" AÇIK olarak kaydetme: dosyayı GitHub'a commit eder, önceden bir Supabase taslağı düzenleniyorduysa o satırı siler. */
async function icerikGitHubaYaz(tur, alan, gizliKod, govde, dosyaYolu, msgEl) {
  const dosyaIcerigi = dosyaIcerigiOlustur(tur, alan, gizliKod, govde);
  const icerikB64 = b64Encode(dosyaIcerigi);
  const commitMesaji = DUZENLENEN_YOL ? `İçerik güncellendi: ${dosyaYolu}` : `Yeni içerik eklendi: ${dosyaYolu}`;

  if (DUZENLENEN_YOL && DUZENLENEN_YOL === dosyaYolu) {
    // Dosya yolu değişmedi -> doğrudan güncelle.
    await ghPutFile(dosyaYolu, icerikB64, commitMesaji, DUZENLENEN_SHA);
  } else {
    // Yeni dosya, taslaktan ilk kez yayınlanıyor, ya da düzenleme sırasında
    // dosya adı/tarih değiştiği için yol değişti -> önce hedef yolda dosya
    // var mı diye bak (sha gerekiyorsa al), sonra yaz.
    const mevcutHedef = await ghGetContents(dosyaYolu).catch(() => null);
    await ghPutFile(dosyaYolu, icerikB64, commitMesaji, mevcutHedef?.sha || null);

    // Düzenleme sırasında GİT dosyasının yolu değiştiyse eski dosyayı sil (yeniden adlandırma).
    if (DUZENLENEN_YOL && DUZENLENEN_YOL !== dosyaYolu && DUZENLENEN_SHA) {
      await ghDeleteFile(DUZENLENEN_YOL, DUZENLENEN_SHA, `Yeniden adlandırıldı: ${DUZENLENEN_YOL} -> ${dosyaYolu}`);
      // Eski klasör bu taşımayla boşaldıysa (yeniden adlandırma öncesi
      // klasörü değiştiyse), o klasörü korumak için .gitkeep geri eklenir.
      await klasorBosaldiysaGitkeepEkle(ustKlasorYolu(DUZENLENEN_YOL));
    }
  }

  // Hedef klasörde artık bu gerçek içerik var, orada duran .gitkeep varsa temizlenir.
  await klasordekiGitkeepiTemizle(ustKlasorYolu(dosyaYolu));

  // Supabase'teki bir taslak yayınlanıyorsa, artık GitHub'da yaşadığı için taslak satırı silinir.
  if (DUZENLENEN_TASLAK_ID) {
    const { error } = await supabase.from("taslak_icerikler").delete().eq("id", DUZENLENEN_TASLAK_ID);
    if (error) console.error("Taslak satırı silinemedi (dosya GitHub'a başarıyla yazıldı):", error);
  }

  DUZENLENEN_GIZLI_KOD = gizliKod;
  DUZENLENEN_TASLAK_ID = null;
  onizlemeKutusunuGizle();

  showMessage(msgEl, "İşlem başarıyla GitHub'a iletildi, 1-2 dakika içinde sitede güncellenecektir.", "success");
  // Not: duzenlemeyiKapat() burada ÇAĞRILMIYOR — form "düzenleme modunda"
  // kalır ki içerik hemen tekrar düzenlenebilsin.
  DUZENLENEN_YOL = dosyaYolu;
  DUZENLENEN_SHA = (await ghGetContents(dosyaYolu))?.sha || DUZENLENEN_SHA;
  document.getElementById("ic-iptal-btn").hidden = false;
  guncelleIcerikTuru();
}

/**
 * "Yayında" KAPALI + hedef "GitHub'a commit et" olarak seçiliyken kullanılan
 * ESKİ yöntem (bkz. rehber/01-site-rehberi.md § 9): içerik yine GitHub'a
 * commit edilir ama `yayinda: false` + tahmin edilemez bir `permalink` ile —
 * yani dosya reponun git geçmişinde durur, sadece adresi paylaşılmadığı
 * sürece gizli sayılır. Supabase'e HİÇ dokunmaz; daha önce Supabase'te bir
 * taslak düzenleniyorduysa (DUZENLENEN_TASLAK_ID doluysa) artık içerik
 * GitHub'da yaşadığı için o taslak satırı silinir (icerikGitHubaYaz ile
 * aynı davranış — bir içerik iki yerde birden asla durmaz).
 */
async function icerikGitHubaGizliYaz(tur, alan, gizliKod, govde, dosyaYolu, msgEl) {
  const dosyaIcerigi = dosyaIcerigiOlustur(tur, alan, gizliKod, govde, false);
  const icerikB64 = b64Encode(dosyaIcerigi);
  const commitMesaji = DUZENLENEN_YOL
    ? `Gizli içerik güncellendi (yayinda: false): ${dosyaYolu}`
    : `Yeni gizli içerik eklendi (GitHub, yayinda: false): ${dosyaYolu}`;

  if (DUZENLENEN_YOL && DUZENLENEN_YOL === dosyaYolu) {
    await ghPutFile(dosyaYolu, icerikB64, commitMesaji, DUZENLENEN_SHA);
  } else {
    const mevcutHedef = await ghGetContents(dosyaYolu).catch(() => null);
    await ghPutFile(dosyaYolu, icerikB64, commitMesaji, mevcutHedef?.sha || null);

    if (DUZENLENEN_YOL && DUZENLENEN_YOL !== dosyaYolu && DUZENLENEN_SHA) {
      await ghDeleteFile(DUZENLENEN_YOL, DUZENLENEN_SHA, `Yeniden adlandırıldı: ${DUZENLENEN_YOL} -> ${dosyaYolu}`);
      await klasorBosaldiysaGitkeepEkle(ustKlasorYolu(DUZENLENEN_YOL));
    }
  }

  // Hedef klasörde artık bu gerçek içerik var, orada duran .gitkeep varsa temizlenir.
  await klasordekiGitkeepiTemizle(ustKlasorYolu(dosyaYolu));

  // Supabase'teki bir taslak buradan GitHub'a taşınıyorsa, artık GitHub'da yaşadığı için taslak satırı silinir.
  if (DUZENLENEN_TASLAK_ID) {
    const { error } = await supabase.from("taslak_icerikler").delete().eq("id", DUZENLENEN_TASLAK_ID);
    if (error) console.error("Taslak satırı silinemedi (dosya GitHub'a başarıyla yazıldı):", error);
  }

  DUZENLENEN_GIZLI_KOD = gizliKod;
  DUZENLENEN_TASLAK_ID = null;
  DUZENLENEN_YOL = dosyaYolu;
  DUZENLENEN_SHA = (await ghGetContents(dosyaYolu))?.sha || DUZENLENEN_SHA;
  document.getElementById("ic-iptal-btn").hidden = false;
  onizlemeKutusunuGoster(tur, gizliKod, "github");

  showMessage(
    msgEl,
    "İçerik GitHub'a \"yayinda: false\" olarak commit edildi (eski yöntem) — 1-2 dakika içinde sitede sadece aşağıdaki gizli linkle erişilebilir olacak.",
    "success"
  );
  guncelleIcerikTuru();
}

/** "Yayında" KAPALI olarak kaydetme: içerik GitHub'a hiç dokunmadan Supabase'e yazılır. */
async function icerikSupabaseeYaz(tur, alan, gizliKod, govde, slug, dosyaYolu, msgEl) {
  const satir = {
    tur,
    baslik: alan.title,
    tarih: alan.date,
    slug,
    dosya_yolu: dosyaYolu,
    venue: alan.venue || null,
    durum: alan.status || null,
    ozet: alan.summary || null,
    link: alan.link || null,
    link_etiket: alan.link_label || null,
    govde,
    onizleme_kod: gizliKod,
    yayin_durumu: "taslak",
    yazar_id: alan.yazarId || null,
    yazar_adi: alan.author || null,
    // "Admin/Site Sahibi adına yayınla" onay süreci (bkz. migration 0016 ve
    // 0023 / wireAdminAdinaTalep) — sunucu tarafındaki tetikleyici
    // admin_onay_durumu / sahip_onay_durumu'nu buna göre otomatik ayarlar.
    // hedefRol 'owner' ise sahip_adina_talep, aksi halde (varsayılan
    // 'admin') admin_adina_talep işaretlenir — ikisi birden asla true olmaz.
    admin_adina_talep: alan.adminAdinaTalep === true && alan.hedefRol !== "owner",
    sahip_adina_talep: alan.adminAdinaTalep === true && alan.hedefRol === "owner",
  };

  let taslakSonuc;
  if (DUZENLENEN_TASLAK_ID) {
    const { data, error } = await supabase
      .from("taslak_icerikler")
      .update(satir)
      .eq("id", DUZENLENEN_TASLAK_ID)
      .select()
      .single();
    if (error) throw new Error(error.message);
    taslakSonuc = data;
  } else {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("taslak_icerikler")
      .insert({ ...satir, created_by: user?.id || null })
      .select()
      .single();
    if (error) throw new Error(error.message);
    taslakSonuc = data;
  }

  // Düzenlenen içerik daha önce GitHub'da yayındaysa (ya da eski sistemden
  // kalma gizli bir git dosyasıysa), içerik artık güvenle Supabase'te
  // olduğuna göre GitHub'daki dosya silinir.
  let gitSilmeHatasi = null;
  if (DUZENLENEN_YOL) {
    try {
      await ghDeleteFile(DUZENLENEN_YOL, DUZENLENEN_SHA, `Supabase'e taşındı (yayından kaldırıldı): ${DUZENLENEN_YOL}`);
      await klasorBosaldiysaGitkeepEkle(ustKlasorYolu(DUZENLENEN_YOL));
    } catch (e) {
      gitSilmeHatasi = e;
      console.error("Eski GitHub dosyası silinemedi:", e);
    }
  }

  DUZENLENEN_GIZLI_KOD = gizliKod;
  DUZENLENEN_TASLAK_ID = taslakSonuc.id;
  DUZENLENEN_YOL = null;
  DUZENLENEN_SHA = null;
  onizlemeKutusunuGoster(tur, gizliKod);

  if (gitSilmeHatasi) {
    showMessage(
      msgEl,
      `Taslak Supabase'e kaydedildi ama eski GitHub dosyası silinemedi: ${gitSilmeHatasi.message}. "Mevcut İçerikler" listesinden elle silmen gerekebilir.`,
      "error"
    );
  } else {
    showMessage(
      msgEl,
      "Taslak Supabase'e kaydedildi — GitHub'a hiç commit edilmedi, sadece aşağıdaki gizli linki bilenler görebilir.",
      "success"
    );
  }

  document.getElementById("ic-iptal-btn").hidden = false;
  guncelleIcerikTuru();
}

/**
 * "Yayında" AÇIK + Seçenek C ("Sadece Supabase'te Yayınla"): içerik GitHub'a
 * HİÇ commit edilmez, sadece Supabase `taslak_icerikler` tablosuna
 * `yayin_durumu: 'sadece_supabase'` olarak yazılır. `icerikSupabaseeYaz`'dan
 * (yayın DURUMU 'taslak') farkı: o fonksiyon GİZLİ bir taslak üretir (sadece
 * gizli kod bilen /onizleme/ linkinden görülür, blog/proje listesinde
 * görünmez); bu fonksiyon ise GERÇEKTEN yayındaki bir yazı üretir —
 * icerik/blog.md ve icerik/akademik-projeler.md sayfaları bu durumdaki
 * satırları public.sadece_supabase_yayinlari_listele() RPC'siyle çekip
 * GitHub'daki yazılarla birlikte listeler (bkz. migration 0015 ve o
 * sayfalardaki <script> blokları), detay sayfası ise
 * icerik/supabase-yazi.md + sadece_supabase_yazi_getir() RPC'sidir.
 */
async function icerikSadeceSupabaseeYayinla(tur, alan, gizliKod, govde, slug, dosyaYolu, msgEl) {
  const satir = {
    tur,
    baslik: alan.title,
    tarih: alan.date,
    slug,
    dosya_yolu: dosyaYolu,
    venue: alan.venue || null,
    durum: alan.status || null,
    ozet: alan.summary || null,
    link: alan.link || null,
    link_etiket: alan.link_label || null,
    govde,
    // onizleme_kod alanı NOT NULL olduğu için (bkz. migration 0013) burada
    // da dolduruyoruz; bu kayıt zaten GERÇEKTEN yayında olduğundan bu kod
    // gizli bir işlev taşımaz, sadece kolon zorunluluğunu karşılar.
    onizleme_kod: gizliKod || rastgeleKod(8),
    yayin_durumu: "sadece_supabase",
    yazar_id: alan.yazarId || null,
    yazar_adi: alan.author || null,
    // "Admin/Site Sahibi adına yayınla" onay süreci (bkz. migration 0016 ve
    // 0023 / wireAdminAdinaTalep) — sunucu tarafındaki tetikleyici
    // admin_onay_durumu / sahip_onay_durumu'nu buna göre otomatik ayarlar.
    // hedefRol 'owner' ise sahip_adina_talep, aksi halde (varsayılan
    // 'admin') admin_adina_talep işaretlenir — ikisi birden asla true olmaz.
    admin_adina_talep: alan.adminAdinaTalep === true && alan.hedefRol !== "owner",
    sahip_adina_talep: alan.adminAdinaTalep === true && alan.hedefRol === "owner",
  };

  let taslakSonuc;
  if (DUZENLENEN_TASLAK_ID) {
    const { data, error } = await supabase
      .from("taslak_icerikler")
      .update(satir)
      .eq("id", DUZENLENEN_TASLAK_ID)
      .select()
      .single();
    if (error) throw new Error(error.message);
    taslakSonuc = data;
  } else {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("taslak_icerikler")
      .insert({ ...satir, created_by: user?.id || null })
      .select()
      .single();
    if (error) throw new Error(error.message);
    taslakSonuc = data;
  }

  // Düzenlenen içerik daha önce GitHub'da yayındaysa, artık tek doğru kopya
  // Supabase'te olduğuna göre GitHub'daki dosya silinir (aksi hâlde aynı
  // içerik iki farklı adreste, senkronsuz iki kopya olarak yaşardı).
  let gitSilmeHatasi = null;
  if (DUZENLENEN_YOL) {
    try {
      await ghDeleteFile(DUZENLENEN_YOL, DUZENLENEN_SHA, `Sadece Supabase'te yayına taşındı: ${DUZENLENEN_YOL}`);
      await klasorBosaldiysaGitkeepEkle(ustKlasorYolu(DUZENLENEN_YOL));
    } catch (e) {
      gitSilmeHatasi = e;
      console.error("Eski GitHub dosyası silinemedi:", e);
    }
  }

  DUZENLENEN_GIZLI_KOD = null;
  DUZENLENEN_TASLAK_ID = taslakSonuc.id;
  DUZENLENEN_YOL = null;
  DUZENLENEN_SHA = null;
  onizlemeKutusunuGizle();

  if (gitSilmeHatasi) {
    showMessage(
      msgEl,
      `İçerik Supabase'te yayınlandı ama eski GitHub dosyası silinemedi: ${gitSilmeHatasi.message}. "Mevcut İçerikler" listesinden elle silmen gerekebilir.`,
      "error"
    );
  } else {
    showMessage(
      msgEl,
      "İçerik yayınlandı — GitHub'a hiç commit edilmedi, sadece Supabase'te duruyor ve blog/proje listesinde görünür.",
      "success"
    );
  }

  document.getElementById("ic-iptal-btn").hidden = false;
  guncelleIcerikTuru();
}

/**
 * "Yayında" AÇIK + Seçenek B ("Supabase'e Kaydet ve GitHub ile Yayınla"):
 * içerik önce Supabase `taslak_icerikler` tablosuna `yayin_durumu:
 * 'supabase_ve_github'` olarak kaydedilir/güncellenir, ARDINDAN aynı içerik
 * GitHub'a da commit edilir. icerikGitHubaYaz'ın aksine bu satır GitHub'a
 * yazma başarılı olsa bile Supabase'den SİLİNMEZ — bilerek iki yerde birden
 * (kalıcı bir yedek/arama kaydı olarak) tutulur; icerikListesiYukle bu
 * durumu tespit edip aynı içerik için tek bir kart gösterir (bkz. "🗄️
 * Supabase yedeği" rozeti).
 */
async function icerikSupabaseVeGithubaYaz(tur, alan, gizliKod, govde, slug, dosyaYolu, msgEl) {
  const satir = {
    tur,
    baslik: alan.title,
    tarih: alan.date,
    slug,
    dosya_yolu: dosyaYolu,
    venue: alan.venue || null,
    durum: alan.status || null,
    ozet: alan.summary || null,
    link: alan.link || null,
    link_etiket: alan.link_label || null,
    govde,
    onizleme_kod: gizliKod,
    yayin_durumu: "supabase_ve_github",
    yazar_id: alan.yazarId || null,
    yazar_adi: alan.author || null,
    // "Admin/Site Sahibi adına yayınla" onay süreci (bkz. migration 0016 ve
    // 0023 / wireAdminAdinaTalep) — sunucu tarafındaki tetikleyici
    // admin_onay_durumu / sahip_onay_durumu'nu buna göre otomatik ayarlar.
    // hedefRol 'owner' ise sahip_adina_talep, aksi halde (varsayılan
    // 'admin') admin_adina_talep işaretlenir — ikisi birden asla true olmaz.
    admin_adina_talep: alan.adminAdinaTalep === true && alan.hedefRol !== "owner",
    sahip_adina_talep: alan.adminAdinaTalep === true && alan.hedefRol === "owner",
  };

  let taslakSonuc;
  if (DUZENLENEN_TASLAK_ID) {
    const { data, error } = await supabase
      .from("taslak_icerikler")
      .update(satir)
      .eq("id", DUZENLENEN_TASLAK_ID)
      .select()
      .single();
    if (error) throw new Error(error.message);
    taslakSonuc = data;
  } else {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("taslak_icerikler")
      .insert({ ...satir, created_by: user?.id || null })
      .select()
      .single();
    if (error) throw new Error(error.message);
    taslakSonuc = data;
  }

  // Supabase kaydı başarılı — şimdi aynı içerik GitHub'a commit edilir.
  // Burada bir hata olursa Supabase satırı ZATEN kaydedilmiş durumda kalır
  // (kaybolmaz) — kullanıcı "Mevcut İçerikler" listesinden tekrar
  // "Yayınla" deneyebilir, bkz. taslagiYayinla.
  const dosyaIcerigi = dosyaIcerigiOlustur(tur, alan, gizliKod, govde);
  const icerikB64 = b64Encode(dosyaIcerigi);
  const commitMesaji = DUZENLENEN_YOL
    ? `İçerik güncellendi (Supabase yedekli): ${dosyaYolu}`
    : `Yeni içerik eklendi (Supabase yedekli): ${dosyaYolu}`;

  try {
    if (DUZENLENEN_YOL && DUZENLENEN_YOL === dosyaYolu) {
      await ghPutFile(dosyaYolu, icerikB64, commitMesaji, DUZENLENEN_SHA);
    } else {
      const mevcutHedef = await ghGetContents(dosyaYolu).catch(() => null);
      await ghPutFile(dosyaYolu, icerikB64, commitMesaji, mevcutHedef?.sha || null);
      if (DUZENLENEN_YOL && DUZENLENEN_YOL !== dosyaYolu && DUZENLENEN_SHA) {
        await ghDeleteFile(DUZENLENEN_YOL, DUZENLENEN_SHA, `Yeniden adlandırıldı: ${DUZENLENEN_YOL} -> ${dosyaYolu}`);
        await klasorBosaldiysaGitkeepEkle(ustKlasorYolu(DUZENLENEN_YOL));
      }
    }
    await klasordekiGitkeepiTemizle(ustKlasorYolu(dosyaYolu));
  } catch (err) {
    DUZENLENEN_TASLAK_ID = taslakSonuc.id;
    DUZENLENEN_YOL = null;
    DUZENLENEN_SHA = null;
    DUZENLENEN_GIZLI_KOD = gizliKod;
    document.getElementById("ic-iptal-btn").hidden = false;
    showMessage(
      msgEl,
      `Taslak Supabase'e kaydedildi ama GitHub'a yazılamadı: ${err.message}. "Mevcut İçerikler" listesinden tekrar "Yayınla" deneyebilirsin.`,
      "error"
    );
    return;
  }

  DUZENLENEN_GIZLI_KOD = gizliKod;
  // Supabase satırı BİLEREK korunuyor — taslakId hâlâ geçerli, "Sil"
  // artık hem GitHub dosyasını hem bu satırı birlikte silecek (bkz.
  // icerikSil).
  DUZENLENEN_TASLAK_ID = taslakSonuc.id;
  DUZENLENEN_YOL = dosyaYolu;
  DUZENLENEN_SHA = (await ghGetContents(dosyaYolu))?.sha || DUZENLENEN_SHA;
  document.getElementById("ic-iptal-btn").hidden = false;

  showMessage(
    msgEl,
    "İçerik hem Supabase'e (yedek/arama kaydı olarak) kaydedildi hem de GitHub'a commit edildi — 1-2 dakika içinde sitede yayında olacak.",
    "success"
  );
  guncelleIcerikTuru();
}

/* ---------------------------------------------------------------------- */
/* MEVCUT İÇERİKLER LİSTESİ — YÜKLEME, ARAMA, FİLTRELEME                  */
/* ---------------------------------------------------------------------- */
// Son yüklenen tüm içerikler (blog + proje) burada önbelleğe alınır;
// arama/filtre değiştikçe GitHub'a tekrar istek atmadan anında yeniden
// çizilir. Ayrıca kayıt sırasında permalink/kod çakışması kontrolü için
// de kullanılır (bkz. onizlemeKoduCakisiyorMu).
let TUM_ICERIKLER = [];
let LISTE_ARAMA = "";
let LISTE_FILTRE_TUR = "tum"; // 'tum' | 'blog' | 'proje'
let LISTE_FILTRE_DURUM = "tum"; // 'tum' | 'yayinda' | 'gizli'
// CLIENT-SIDE SAYFALAMA — bkz. listeyiYenidenCiz/icerikListesiCiz. Worker
// artık TÜM içeriklerin front-matter'ını değil sadece hafif bir envanteri
// (path/ad/sha) döndürdüğü için (bkz. worker.js panelBaslangicVerisiGetir),
// kart olarak GERÇEKTEN görünen (dolayısıyla front-matter'ı çekilecek)
// öğe sayısını sınırlamak da önemli — bu yüzden liste sayfa başı
// LISTE_SAYFA_BASI kadar öğe gösterir. Arama/filtre/tür sekmesi
// değiştiğinde 1. sayfaya dönülür (bkz. ilgili event handler'lar).
const LISTE_SAYFA_BASI = 12;
let LISTE_SAYFA_BLOG = 1;
let LISTE_SAYFA_PROJE = 1;

function wireIcerikListe() {
  // "Yenile": sessionStorage önbelleğini TEK istekle tazeleyip listeyi
  // ondan çizer — bkz. panelListeleriniTazele (artık sessionStorage'ı da
  // günceller).
  document.getElementById("ic-liste-yenile-btn").addEventListener("click", async () => {
    await panelListeleriniTazele();
    icerikListesiYukle();
  });

  const aramaEl = document.getElementById("ic-liste-arama");
  const temizleBtn = document.getElementById("ic-liste-arama-temizle");
  aramaEl.addEventListener("input", () => {
    LISTE_ARAMA = aramaEl.value.trim().toLocaleLowerCase("tr");
    temizleBtn.hidden = aramaEl.value === "";
    LISTE_SAYFA_BLOG = 1;
    LISTE_SAYFA_PROJE = 1;
    listeyiYenidenCiz();
  });
  temizleBtn.addEventListener("click", () => {
    aramaEl.value = "";
    LISTE_ARAMA = "";
    temizleBtn.hidden = true;
    LISTE_SAYFA_BLOG = 1;
    LISTE_SAYFA_PROJE = 1;
    listeyiYenidenCiz();
    aramaEl.focus();
  });

  document.querySelectorAll(".gy-tur-sekme").forEach((btn) => {
    btn.addEventListener("click", () => {
      LISTE_FILTRE_TUR = btn.dataset.filtreTur;
      document.querySelectorAll(".gy-tur-sekme").forEach((b) => {
        b.classList.toggle("active", b === btn);
        b.setAttribute("aria-selected", String(b === btn));
      });
      LISTE_SAYFA_BLOG = 1;
      LISTE_SAYFA_PROJE = 1;
      listeyiYenidenCiz();
    });
  });

  document.querySelectorAll(".gy-durum-sekme").forEach((btn) => {
    btn.addEventListener("click", () => {
      LISTE_FILTRE_DURUM = btn.dataset.filtreDurum;
      document.querySelectorAll(".gy-durum-sekme").forEach((b) => {
        b.classList.toggle("active", b === btn);
        b.setAttribute("aria-selected", String(b === btn));
      });
      LISTE_SAYFA_BLOG = 1;
      LISTE_SAYFA_PROJE = 1;
      listeyiYenidenCiz();
    });
  });
}

/**
 * Hem _posts/ hem _projects/ artık alt klasörlenebilir durumda (örn.
 * _posts/2026/... ya da _projects/seyahat/...), ama GitHub Contents API
 * bir klasörü SADECE tek seviye listeler — alt klasörlerin içini görmek
 * için her birine ayrıca istek atmak gerekir. Bu fonksiyon önce verilen
 * kök koleksiyonun (kokKlasor: "_posts" ya da "_projects") doğrudan
 * içeriğini okur; içinde tür=dir olan (yıl ya da özel adlı) girdiler
 * varsa onların içine de ayrıca bakar. Eski, alt klasörleme ÖNCESİ
 * taşınmamış (örn. "_posts/YIL-AY-GUN-slug.md") dosyalar da (varsa) hâlâ
 * listede görünmeye devam eder, geriye dönük uyumluluk için ayrıca bir
 * taşıma/migrasyon ZORUNLU DEĞİLDİR.
 */
/** ESKİ (canlı) sürüm artık kullanılmıyor — bkz. icerikListesiYukle'nin
 * PANEL_VERI önbelleğinden okuyan sürümü ve icerikOzetleriniCikar. Bu
 * fonksiyon, önbellek herhangi bir sebeple boşsa (ör. panel-init hiç
 * başarılı olmadıysa) elle çağrılabilecek bir yedek olarak bırakıldı. */
async function koleksiyonDosyalariniListele(kokKlasor) {
  const kokIcerik = await ghGetContents(kokKlasor).catch(() => []);
  if (!Array.isArray(kokIcerik)) return [];

  const kokDosyalar = kokIcerik.filter((f) => f.type === "file" && f.name.endsWith(".md"));
  const altKlasorler = kokIcerik.filter((f) => f.type === "dir");

  const altKlasorSonuclari = await Promise.all(
    altKlasorler.map((klasor) => ghGetContents(klasor.path).catch(() => []))
  );
  const altKlasorDosyalari = altKlasorSonuclari
    .flat()
    .filter((f) => f && f.type === "file" && f.name.endsWith(".md"));

  return [...kokDosyalar, ...altKlasorDosyalari];
}

/** Bir Supabase `taslak_icerikler` satırını, listeleme/kart çizimi için git dosyalarıyla AYNI şekle (item) çevirir. */
function taslakToItem(row) {
  return {
    path: null,
    sha: null,
    tur: row.tur,
    taslakId: row.id,
    kaynak: "supabase",
    data: {
      title: row.baslik,
      date: row.tarih,
      venue: row.venue,
      status: row.durum,
      summary: row.ozet,
      link: row.link,
      link_label: row.link_etiket,
      // BUG FİX: bu alan önceden HER ZAMAN false idi — yani
      // yayin_durumu='sadece_supabase' olan, GERÇEKTEN yayındaki (blog/proje
      // listesinde görünen) bir yazı bile panelin kendi listesinde "Gizli"
      // filtresine düşüyor ve "🔒 Gizli" rozetiyle gösteriliyordu. Sadece
      // 'taslak' durumu (onizleme_kod'a bağlı, blog/proje listesinde hiç
      // görünmeyen gerçek gizli taslak) yayinda:false sayılmalı.
      yayinda: row.yayin_durumu === "sadece_supabase",
      onizleme_kod: row.onizleme_kod,
      slug: row.slug,
      dosya_yolu: row.dosya_yolu,
      yazar_adi: row.yazar_adi,
      yazar_id: row.yazar_id,
      // Gerçek oluşturan — bkz. icerikKendisineMiAit. "Admin adına yayınla"
      // akışında yazar_id hedef admin'i taşıdığından, bu SATIR gerçekten
      // oluşturan (created_by, migration 0013) olmadan editor kendi
      // gönderdiği talebi kendi listesinde göremez/düzenleyemez hâle gelirdi.
      olusturan_id: row.created_by,
      yayin_durumu: row.yayin_durumu,
      // "Admin adına yayınla" onay süreci (bkz. migration 0016) — manager
      // (İçerik Sorumlusu) rolündeki bir kullanıcı bu talebi işaretlediyse
      // dolar; icerikKartiCiz bu alanlara göre onay rozeti/butonu gösterir.
      admin_adina_talep: row.admin_adina_talep,
      admin_onay_durumu: row.admin_onay_durumu,
    },
    body: row.govde || "",
  };
}

async function icerikListesiYukle() {
  const el = document.getElementById("ic-liste");
  if (!GH_BAGLI || !PANEL_VERI) {
    el.innerHTML = '<p class="muted">Önce "GitHub Bağlantısı" sekmesinden bağlantını doğrula.</p>';
    return;
  }

  el.innerHTML = '<p class="muted">Yükleniyor...</p>';
  try {
    // Artık GitHub'a AYRICA istek atmıyor — dosya ENVANTERİ (path/ad/sha,
    // İÇERİKSİZ) zaten PANEL_VERI önbelleğinde (bkz. panelVerisiniYukle ve
    // worker.js'teki panelBaslangicVerisiGetir — Git Trees API notu). Her
    // öğe önce "hafif" (dosya adından türetilmiş başlık) olarak listelenir;
    // GERÇEK front-matter'ı SADECE o öğe ekranda görünür bir sayfaya
    // düştüğünde (bkz. icerikListesiCiz → icerikIcerigiZenginlestir) ya da
    // "Düzenle"ye basıldığında tek tek, sha'ya göre önbellekli şekilde
    // çekilir.
    const postDetaylari = icerikOzetleriniCikar(PANEL_VERI.koleksiyonlar?._posts?.dosyalar || [], "blog");
    const projeDetaylari = icerikOzetleriniCikar(PANEL_VERI.koleksiyonlar?._projects?.dosyalar || [], "proje");
    postDetaylari.forEach((x) => (x.kaynak = "github"));
    projeDetaylari.forEach((x) => (x.kaynak = "github"));

    // Supabase'teki taslakları da getir — tek bir satırın değil ama TÜM
    // sorgunun başarısız olması ihtimaline karşı (ağ hatası, RLS vb.) bu
    // adım GitHub listesini düşürmüyor, sadece taslaklar boş gösteriliyor
    // ve konsola hata yazılıyor.
    let taslaklar = [];
    try {
      const { data, error } = await supabase.from("taslak_icerikler").select("*");
      if (error) throw error;
      taslaklar = data || [];
    } catch (e) {
      console.error("Taslaklar (Supabase) yüklenemedi:", e);
    }
    // "Seçenek B" ile yayınlanan içerikler (yayin_durumu='supabase_ve_github')
    // hem bu Supabase listesinde HEM GitHub dosya listesinde bulunur — aynı
    // içerik için İKİ ayrı kart göstermemek için, dosya_yolu eşleşen bir
    // GitHub öğesi bulunursa Supabase satırı ayrı bir kart olarak
    // eklenmez; bunun yerine GitHub öğesine "supabaseYedek" bilgisi
    // iğnelenir (bkz. icerikKartiCiz'deki "🗄️ Supabase yedeği" rozeti ve
    // icerikSil'deki ikili silme).
    const githubYolHaritasi = new Map();
    [...postDetaylari, ...projeDetaylari].forEach((it) => githubYolHaritasi.set(it.path, it));

    const supaBagimsizTaslaklar = [];
    taslaklar.forEach((row) => {
      if (row.yayin_durumu === "supabase_ve_github") {
        const eslesenGithubOgesi = githubYolHaritasi.get(row.dosya_yolu);
        if (eslesenGithubOgesi) {
          eslesenGithubOgesi.supabaseYedek = true;
          eslesenGithubOgesi.taslakId = row.id;
          eslesenGithubOgesi.data.yazar_adi = eslesenGithubOgesi.data.yazar_adi || row.yazar_adi;
          return;
        }
        // Eşleşen bir GitHub dosyası yoksa (ör. dosya elle silinmiş) yine
        // de kaybolmasın diye normal bir Supabase kartı olarak gösterilir.
      }
      supaBagimsizTaslaklar.push(taslakToItem(row));
    });

    const supaBlog = supaBagimsizTaslaklar.filter((t) => t.tur === "blog");
    const supaProje = supaBagimsizTaslaklar.filter((t) => t.tur === "proje");

    const blogTumu = [...postDetaylari, ...supaBlog].sort((a, b) => (b.data.date || "").localeCompare(a.data.date || ""));
    const projeTumu = [...projeDetaylari, ...supaProje].sort((a, b) => (b.data.date || "").localeCompare(a.data.date || ""));

    TUM_ICERIKLER = [...blogTumu, ...projeTumu];
    // Liste TAMAMEN yeniden kurulduğunda (yeni yükleme/"Yenile"/bir yazma
    // işlemi sonrası) sayfa numaraları da sıfırlanır — aksi halde bir
    // öğe silindikten sonra artık var olmayan bir sayfada kalınabilirdi.
    LISTE_SAYFA_BLOG = 1;
    LISTE_SAYFA_PROJE = 1;
    listeyiYenidenCiz();
  } catch (err) {
    el.innerHTML = `<p class="muted">Liste yüklenemedi: ${escapeHtml(err.message)}</p>`;
  }
}

/**
 * PANEL_VERI önbelleğindeki HAFİF dosya girdilerini (path, name, sha —
 * İÇERİK YOK, bkz. worker.js panelBaslangicVerisiGetir "Git Trees API'ye
 * geçiş" notu) listeleme öğelerine çevirir. Ağa HİÇ istek atmaz — bir
 * dosyanın front-matter'ı daha önce (bu sha ile) çekilip sessionStorage'a
 * yazılmışsa oradan zengin olarak, yoksa SADECE dosya adından türetilmiş
 * bir başlıkla ("hafif", bkz. dosyaAdindanHafifBaslikUret) döner. Hafif
 * öğelerin GERÇEK içeriği, o öğe ekranda görünür bir sayfaya düştüğünde
 * (icerikListesiCiz) ya da "Düzenle"ye basıldığında (icerikDuzenlemeyeYukle)
 * icerikIcerigiZenginlestir ile tek tek çekilir.
 */
function icerikOzetleriniCikar(dosyalar, tur) {
  return dosyalar.map((dosya) => {
    const onbellek = icerikIcerigiOnbellektenOku(dosya.sha);
    if (onbellek) {
      const data = { ...onbellek.data };
      // Kart çiziminde ve sahiplik kontrolünde (icerikKendisineMiAit)
      // kullanılan "Yazan:" alanı Supabase taslaklarında yazar_adi, GitHub
      // dosyalarında ise front-matter'daki author alanı olarak tutuluyor —
      // ikisini burada TEK bir alana (yazar_adi) eşitliyoruz.
      if (!data.yazar_adi && data.author) data.yazar_adi = data.author;
      return { path: dosya.path, sha: dosya.sha, tur, data, body: onbellek.body, hafif: false };
    }
    return {
      path: dosya.path,
      sha: dosya.sha,
      tur,
      data: dosyaAdindanHafifBaslikUret(dosya, tur),
      body: "",
      hafif: true,
    };
  });
}

/**
 * Ağa hiç gitmeden, SADECE dosya adından/yolundan bir başlık + (bulunabiliyorsa)
 * bir tarih türetir — hafif liste görünümü içindir (bkz. dosya başındaki not:
 * içerik artık panel-init ile gelmiyor). Blog yazıları her zaman
 * `YYYY-MM-DD-slug.md` biçiminde adlandırıldığı için (bkz.
 * dosyaYoluHesapla) tarih güvenilir biçimde çıkarılabilir; projelerde tarih
 * öneki opsiyonel olduğundan (yilOneki) sadece varsa kullanılır, yoksa
 * klasörün yıl adı (varsa) ya da null döner. Gerçek front-matter'daki
 * `title` alanından FARKLI olabilir — içerik çekildiğinde
 * (icerikIcerigiZenginlestir) gerçek başlıkla/tarihle DEĞİŞTİRİLİR.
 */
function dosyaAdindanHafifBaslikUret(dosya, tur) {
  let ad = dosya.name.replace(/\.md$/i, "");
  let tarih = null;
  const tamTarihEslesme = ad.match(/^(\d{4}-\d{2}-\d{2})-(.+)$/);
  const yilOnekiEslesme = !tamTarihEslesme && ad.match(/^(\d{4})-(.+)$/);
  if (tamTarihEslesme) {
    tarih = tamTarihEslesme[1];
    ad = tamTarihEslesme[2];
  } else if (yilOnekiEslesme) {
    tarih = `${yilOnekiEslesme[1]}-01-01`;
    ad = yilOnekiEslesme[2];
  } else if (dosya.yil) {
    tarih = `${dosya.yil}-01-01`;
  }
  const baslikMetni = ad.replace(/[-_]+/g, " ").trim();
  const baslik = baslikMetni
    ? baslikMetni.charAt(0).toLocaleUpperCase("tr") + baslikMetni.slice(1)
    : dosya.name;
  return { title: baslik, date: tarih };
}

/**
 * Ekranda GÖRÜNÜR bir sayfaya düşen tek bir GitHub öğesinin GERÇEK
 * front-matter'ını tek bir `/contents/<path>` isteğiyle çeker (bkz.
 * ghGetContents), sha'ya göre sessionStorage'a önbellekler (bkz.
 * icerikIcerigiOnbellegeYaz — bu sha bir daha ASLA ağdan tekrar
 * çekilmeyecektir, çünkü içerik değişirse sha da değişir) ve item'ı
 * YERİNDE (aynı referans, kart yeniden çizildiğinde otomatik yansır)
 * günceller. Zaten zenginleştirilmişse (`hafif:false`) ya da GitHub
 * kaynaklı değilse (Supabase taslağı, içeriği zaten satırda geliyor)
 * hiçbir şey yapmaz. Ağ hatası/silinmiş dosya durumunda "okunamadı"
 * rozetiyle işaretler — tek bir bozuk öğe listeyi düşürmez.
 */
async function icerikIcerigiZenginlestir(item) {
  if (!item.hafif || item.kaynak !== "github") return false;
  try {
    const dosya = await ghGetContents(item.path);
    if (!dosya || typeof dosya.content !== "string") throw new Error("İçerik okunamadı.");
    const ham = b64Decode(dosya.content.replace(/\n/g, ""));
    const { data, body } = frontMatterOku(ham);
    if (!data.yazar_adi && data.author) data.yazar_adi = data.author;
    item.data = data;
    item.body = body;
    item.sha = dosya.sha || item.sha;
    item.hafif = false;
    icerikIcerigiOnbellegeYaz(item.sha, data, body);
    return true;
  } catch (err) {
    item.data = { title: `${item.path.split("/").pop()} (okunamadı: ${err.message})` };
    item.body = "";
    item.hafif = false;
    item.okunamadi = true;
    return false;
  }
}

/**
 * Bu öğe giriş yapan kullanıcıya mı ait? Önce (varsa) olusturan_id
 * karşılaştırılır — içeriği GERÇEKTEN oluşturan kişinin id'sidir (Supabase
 * taslaklarında created_by, GitHub'a commit edilen dosyalarda front-matter'a
 * eklenen olusturan_id, bkz. taslakToItem / dosyaIcerigiOlustur). Bu, "admin
 * adına yayınla" akışında yazar_id'den (görünen yazar, hedef admin) BİLEREK
 * farklı tutulur. olusturan_id hiç yoksa yazar_id'ye düşülür (bu alan
 * eklenmeden ÖNCE, admin-adına özelliğinden ÖNCE yazılmış eski içerikler için
 * olusturan_id == yazar_id zaten geçerliydi). yazar_id de yoksa (çok daha
 * eski, hiçbir kimlik alanı taşımayan içerikler) isim eşleşmesine düşülür —
 * TEK amacı editörün KENDİ eski içeriğini erişilemez hâle getirmemektir, bir
 * GÜVENLİK sınırı olarak kullanılmaz (gerçek sunucu taraflı sınır
 * Worker'dadır, bkz. cloudflare worker/github_icerik_yonetim_worker/worker.js).
 */
function icerikKendisineMiAit(item) {
  if (!GIRIS_YAPAN_PROFIL) return false;
  // ÖNCELİK: olusturan_id — içeriği GERÇEKTEN oluşturan kişi. "Admin adına
  // yayınla" akışında yazar_id (görünen yazar) hedef admin'i taşır, GERÇEK
  // oluşturan (editor/manager) DEĞİL — o yüzden editor kendi gönderdiği
  // "admin adına" içeriği (Supabase'te onay beklerken VE GitHub'a
  // yayınlandıktan sonra) hem listesinde görebilmeli hem düzenleyebilmeli/
  // silebilmeli, tıpkı "📁 Klasörler" sekmesinde .gitkeep'in olusturan_id'siyle
  // kendi oluşturduğu klasörleri yönetebilmesi gibi (bkz. klasorKartiCiz).
  if (item.data.olusturan_id) return item.data.olusturan_id === GIRIS_YAPAN_PROFIL.id;
  if (item.data.yazar_id) return item.data.yazar_id === GIRIS_YAPAN_PROFIL.id;
  const kendiAdi = (GIRIS_YAPAN_PROFIL.full_name || GIRIS_YAPAN_PROFIL.email || "").trim().toLocaleLowerCase("tr");
  const itemYazar = (item.data.yazar_adi || item.data.author || "").trim().toLocaleLowerCase("tr");
  return !!kendiAdi && kendiAdi === itemYazar;
}

/**
 * SADECE role='editor' için: üst rollere (manager/admin) ait GİZLİ (yayında
 * olmayan) bir içerik mi? Editör böyle bir içeriği listede hiç görmemeli.
 * Yayındaki (herkese açık) içerikler bu kısıtın dışındadır — onlar zaten
 * sitede herkese görünür, editör sadece onları DÜZENLEYEMEZ/SİLEMEZ (bkz.
 * icerikKartiCiz'deki ayrı kontrol). manager/admin bu fonksiyondan hiç
 * etkilenmez (her zaman false döner).
 *
 * Supabase kaynaklı taslaklar için bu zaten veritabanı seviyesinde de
 * (RLS, bkz. migration 0018) uygulanıyor — sorgu hiç dönmüyor. Buradaki
 * kontrol asıl olarak GitHub'a eskiden "yayinda: false" ile commit edilmiş,
 * artık üretilmeyen ama depoda kalmış olabilecek dosyalar İÇİNDİR (RLS
 * bunları kapsayamaz, git geçmişi Supabase dışıdır).
 */
function icerikEditoreKapaliMi(item) {
  if (GIRIS_YAPAN_PROFIL?.role !== "editor") return false;
  const yayinda = item.data.yayinda !== false;
  if (yayinda) return false;
  return !icerikKendisineMiAit(item);
}

/** Bir içerik öğesinin arama kutusu, tür sekmesi ve durum sekmesiyle eşleşip eşleşmediğini kontrol eder. */
function icerikFiltreyeUyuyorMu(item) {
  if (icerikEditoreKapaliMi(item)) return false;
  if (LISTE_FILTRE_TUR !== "tum" && item.tur !== LISTE_FILTRE_TUR) return false;

  const yayinda = item.data.yayinda !== false;
  if (LISTE_FILTRE_DURUM === "yayinda" && !yayinda) return false;
  if (LISTE_FILTRE_DURUM === "gizli" && yayinda) return false;

  if (LISTE_ARAMA) {
    // Başlık, dosya yolu, özet, venue, YAZAR ADI ve İÇERİK GÖVDESİ (metin
    // ici tam arama) — item.body her zaman zaten yüklenmiş durumda
    // (GitHub öğeleri için icerikOzetiGetir, Supabase taslakları için
    // taslakToItem tarafından doldurulur), bu yüzden ekstra bir istek
    // atmadan anında aranabilir.
    const aranan = [
      item.data.title,
      item.path || item.data.dosya_yolu,
      item.data.summary,
      item.data.venue,
      item.data.yazar_adi,
      item.body,
    ]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase("tr");
    if (!aranan.includes(LISTE_ARAMA)) return false;
  }

  return true;
}

/** Arama kutusuyla eşleşen kısmı vurgular. Vurgulama ham metin üzerinde bulunur, HTML'e yazılacak parçalar ayrı ayrı escape edilir. */
function metniVurgula(metin) {
  const ham = metin || "";
  if (!LISTE_ARAMA) return escapeHtml(ham);

  const idx = ham.toLocaleLowerCase("tr").indexOf(LISTE_ARAMA);
  if (idx === -1) return escapeHtml(ham);

  const once = ham.slice(0, idx);
  const eslesen = ham.slice(idx, idx + LISTE_ARAMA.length);
  const sonra = ham.slice(idx + LISTE_ARAMA.length);
  return `${escapeHtml(once)}<span class="gy-vurgu">${escapeHtml(eslesen)}</span>${escapeHtml(sonra)}`;
}

/** Kaydedilecek gizli kodun, aynı türde BAŞKA bir içerikte (GitHub'da ya da Supabase'de) zaten kullanılıp kullanılmadığını kontrol eder. */
function onizlemeKoduCakisiyorMu(tur, gizliKod, haricAnahtar) {
  return TUM_ICERIKLER.some(
    (item) =>
      item.tur === tur &&
      itemAnahtari(item) !== haricAnahtar &&
      icerikGizliKoduBul(item.data) === gizliKod
  );
}

function listeyiYenidenCiz() {
  const el = document.getElementById("ic-liste");
  const sonucYokEl = document.getElementById("ic-liste-sonuc-yok");

  if (TUM_ICERIKLER.length === 0) {
    el.innerHTML = '<p class="muted">Henüz yüklenmedi.</p>';
    sonucYokEl.hidden = true;
    return;
  }

  const filtrelenmis = TUM_ICERIKLER.filter(icerikFiltreyeUyuyorMu);
  const postlar = filtrelenmis.filter((i) => i.tur === "blog");
  const projeler = filtrelenmis.filter((i) => i.tur === "proje");

  el.innerHTML = "";
  sonucYokEl.hidden = filtrelenmis.length !== 0;

  if (LISTE_FILTRE_TUR !== "proje") el.appendChild(icerikListesiCiz("Blog Yazıları", postlar, "blog"));
  if (LISTE_FILTRE_TUR !== "blog") el.appendChild(icerikListesiCiz("Akademik Projeler", projeler, "proje"));
}

function icerikListesiCiz(baslik, liste, tur) {
  const wrap = document.createElement("div");
  if (liste.length === 0) return wrap; // filtre bu türde sonuç bırakmadıysa başlığı bile gösterme.

  const h = document.createElement("div");
  h.className = "gy-liste-baslik";
  h.innerHTML = `${escapeHtml(baslik)} <span class="gy-liste-baslik-sayac">${liste.length}</span>`;
  wrap.appendChild(h);

  // CLIENT-SIDE SAYFALAMA (sayfa başı LISTE_SAYFA_BASI öğe) — bkz. dosya
  // başındaki not: Worker artık her öğenin front-matter'ını değil sadece
  // hafif bir envanteri döndürüyor, bu yüzden EKRANDA GERÇEKTEN görünen
  // (dolayısıyla içeriği tek tek çekilecek) öğe sayısını sınırlamak da
  // Worker/GitHub isteklerini azaltmanın bir parçası.
  const sayfaNo = tur === "blog" ? LISTE_SAYFA_BLOG : LISTE_SAYFA_PROJE;
  const toplamSayfa = Math.max(1, Math.ceil(liste.length / LISTE_SAYFA_BASI));
  const guvenliSayfaNo = Math.min(Math.max(1, sayfaNo), toplamSayfa);
  if (guvenliSayfaNo !== sayfaNo) {
    if (tur === "blog") LISTE_SAYFA_BLOG = guvenliSayfaNo;
    else LISTE_SAYFA_PROJE = guvenliSayfaNo;
  }
  const baslangicIndeksi = (guvenliSayfaNo - 1) * LISTE_SAYFA_BASI;
  const sayfaOgeleri = liste.slice(baslangicIndeksi, baslangicIndeksi + LISTE_SAYFA_BASI);

  sayfaOgeleri.forEach((item) => wrap.appendChild(icerikKartiCiz(item, tur)));

  if (toplamSayfa > 1) {
    wrap.appendChild(sayfalamaCubuguCiz(tur, guvenliSayfaNo, toplamSayfa));
  }

  // Sadece BU SAYFADA görünen, henüz içeriği çekilmemiş ("hafif") GitHub
  // öğelerini PARALEL olarak zenginleştir (bkz. icerikIcerigiZenginlestir)
  // — sayfa dışındaki diğer onlarca/yüzlerce öğe için HİÇBİR istek
  // atılmaz. Tamamlandığında, kullanıcı bu arada başka bir sayfaya/filtreye
  // geçmediyse listeyi (dolayısıyla bu görünümü, artık zengin veriyle)
  // yeniden çizer.
  const zenginlestirilecekler = sayfaOgeleri.filter((it) => it.hafif && it.kaynak === "github");
  if (zenginlestirilecekler.length > 0) {
    Promise.all(zenginlestirilecekler.map((it) => icerikIcerigiZenginlestir(it))).then(() => {
      const halaAyniSayfaMi = (tur === "blog" ? LISTE_SAYFA_BLOG : LISTE_SAYFA_PROJE) === guvenliSayfaNo;
      if (halaAyniSayfaMi) listeyiYenidenCiz();
    });
  }

  return wrap;
}

/** "Önceki / Sayfa X / Y / Sonraki" sayfalama çubuğu — bkz. icerikListesiCiz. */
function sayfalamaCubuguCiz(tur, sayfaNo, toplamSayfa) {
  const cubuk = document.createElement("div");
  cubuk.className = "gy-sayfalama";

  const git = (yeniSayfa) => {
    if (tur === "blog") LISTE_SAYFA_BLOG = yeniSayfa;
    else LISTE_SAYFA_PROJE = yeniSayfa;
    listeyiYenidenCiz();
    document.getElementById("ic-liste")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const oncekiBtn = document.createElement("button");
  oncekiBtn.type = "button";
  oncekiBtn.className = "gy-sayfalama-btn";
  oncekiBtn.textContent = "‹ Önceki";
  oncekiBtn.disabled = sayfaNo <= 1;
  oncekiBtn.addEventListener("click", () => git(Math.max(1, sayfaNo - 1)));

  const gosterge = document.createElement("span");
  gosterge.className = "gy-sayfalama-gosterge";
  gosterge.textContent = `Sayfa ${sayfaNo} / ${toplamSayfa}`;

  const sonrakiBtn = document.createElement("button");
  sonrakiBtn.type = "button";
  sonrakiBtn.className = "gy-sayfalama-btn";
  sonrakiBtn.textContent = "Sonraki ›";
  sonrakiBtn.disabled = sayfaNo >= toplamSayfa;
  sonrakiBtn.addEventListener("click", () => git(Math.min(toplamSayfa, sayfaNo + 1)));

  cubuk.appendChild(oncekiBtn);
  cubuk.appendChild(gosterge);
  cubuk.appendChild(sonrakiBtn);
  return cubuk;
}

function icerikKartiCiz(item, tur) {
  const kart = document.createElement("div");
  kart.className = "gy-icerik-kart";

  if (item.okunamadi) {
    // Dosya içeriği okunamadı (silinmiş/ağ hatası) — sadece dosya yolunu
    // ve ("editor" rolü kendisine ait olmayan bir dosya için hariç) "Sil"
    // seçeneğini gösteriyoruz; "Düzenle" anlamsız olur çünkü form
    // doldurulacak içerik/başlık verisi yok. Yazar bilgisi okunamadığı
    // için (front-matter parse edilemedi) editor için varsayılan "kendisine
    // ait değil" sayılır — bkz. icerikKendisineMiAit.
    const editorKisitliMi = GIRIS_YAPAN_PROFIL?.role === "editor" && !icerikKendisineMiAit(item);
    kart.innerHTML = `
      <div class="gy-icerik-kart-bilgi">
        <div class="gy-icerik-kart-baslik">${metniVurgula(item.data.title)}<span class="gy-rozet gy-rozet--gizli">Hata</span></div>
        <div class="gy-icerik-kart-meta">${metniVurgula(item.path)}</div>
      </div>
      <div class="gy-icerik-kart-aksiyonlar">
        ${editorKisitliMi ? "" : '<button type="button" class="gy-sil-btn">Sil</button>'}
      </div>
    `;
    kart.querySelector(".gy-sil-btn")?.addEventListener("click", () => icerikSil(item));
    return kart;
  }

  const yayinda = item.data.yayinda !== false; // alan hiç yoksa yayında sayılır
  const sadeceSupabaseYayinda = item.kaynak === "supabase" && item.data.yayin_durumu === "sadece_supabase";
  // "hafif" öğe: içeriği henüz çekilmedi, başlık SADECE dosya adından
  // türetildi (bkz. dosyaAdindanHafifBaslikUret) — gerçek başlık/durum bir
  // an içinde (icerikIcerigiZenginlestir tamamlanınca) yerini alacak.
  const hafifRozet = item.hafif
    ? '<span class="gy-rozet" title="Gerçek başlık/durum yükleniyor…">⏳ Önizleme</span>'
    : "";
  const rozet = item.hafif
    ? ""
    : yayinda
    ? '<span class="gy-rozet gy-rozet--yayinda">Yayında</span>'
    : '<span class="gy-rozet gy-rozet--gizli">Gizli</span>';
  const kaynakRozet =
    item.kaynak === "supabase"
      ? sadeceSupabaseYayinda
        ? `<span class="gy-rozet gy-rozet--yayinda" title="Bu içerik GERÇEKTEN yayında (blog/proje listesinde görünür) ama GitHub'a hiç commit edilmedi, kalıcı olarak sadece Supabase'te duruyor.">🅲️ Sadece Supabase</span>`
        : `<span class="gy-rozet gy-rozet--gizli" title="Bu içerik GitHub'a hiç commit edilmedi, sadece Supabase'te (gizli taslak olarak) duruyor.">Supabase</span>`
      : !yayinda
      ? `<span class="gy-rozet gy-rozet--gizli" title="Bu içerik &quot;yayinda: false&quot; olarak GitHub'a commit edilmiş durumda (eski yöntem) — reponun git geçmişinde duruyor, sadece linki paylaşılmadığı sürece gizli.">GitHub (gizli commit)</span>`
      : "";
  const supabaseYedekRozet = item.supabaseYedek
    ? `<span class="gy-rozet gy-rozet--gizli" title="Bu içeriğin GitHub'daki hâlinin yanında Supabase'te de bir yedek/arama kaydı var (Seçenek B ile yayınlandı).">🗄️ Supabase yedeği</span>`
    : "";
  // "Admin adına yayınla" onay rozeti (bkz. migration 0016/0026 ve
  // wireAdminAdinaTalep). Onay/red yetkisi SADECE adına yazılan admin'in
  // kendisinde ya da owner'da olduğu için (migration 0026) tooltip metni de
  // bunu netleştiriyor.
  const ONAY_ROZET = {
    beklemede: '<span class="gy-rozet gy-rozet--gizli" title="Bu içerik Admin adına yayınlanmak üzere hazırlandı; sadece o adına yazılan admin ya da Site Sahibi onaylayabilir.">⏳ Admin onayı bekliyor</span>',
    onaylandi: '<span class="gy-rozet gy-rozet--yayinda" title="Adına yazıldığı admin (ya da Site Sahibi) bu içeriği kendi adına yayınlanması için onayladı.">✅ Admin onayladı</span>',
    reddedildi: '<span class="gy-rozet gy-rozet--gizli" title="Adına yazıldığı admin (ya da Site Sahibi) bu içeriğin kendi adına yayınlanma talebini reddetti.">❌ Admin reddetti</span>',
  };
  const onayRozet = item.data.admin_adina_talep ? ONAY_ROZET[item.data.admin_onay_durumu] || "" : "";
  // "Site Sahibi adına yayınla" onay rozeti (bkz. migration 0023 § A).
  const SAHIP_ONAY_ROZET = {
    beklemede: '<span class="gy-rozet gy-rozet--gizli" id="' + `gy-sahip-oy-${item.taslakId}` + '" title="Bu içerik Site Sahibi adına yayınlanmak üzere hazırlandı; Site Sahibi onayı YA DA adminlerin mutlak çoğunluğunun onay oyu bekleniyor.">⏳ Site Sahibi onayı bekliyor</span>',
    onaylandi: '<span class="gy-rozet gy-rozet--yayinda" title="Site Sahibi (ya da adminlerin mutlak çoğunluğu) bu içeriği kendi adına yayınlanması için onayladı.">✅ Site Sahibi onayladı</span>',
    reddedildi: '<span class="gy-rozet gy-rozet--gizli" title="Site Sahibi (ya da adminlerin mutlak çoğunluğu) bu içeriğin kendi adına yayınlanma talebini reddetti.">❌ Site Sahibi reddetti</span>',
  };
  const sahipOnayRozet = item.data.sahip_adina_talep ? SAHIP_ONAY_ROZET[item.data.sahip_onay_durumu] || "" : "";
  const ozet = item.data.summary
    ? `<div class="gy-icerik-kart-ozet">${metniVurgula(item.data.summary)}</div>`
    : "";
  const yazarSatiri = item.data.yazar_adi
    ? `<span class="gy-icerik-kart-yazar"> · Yazan: ${metniVurgula(item.data.yazar_adi)}</span>`
    : "";

  // Sadece Supabase'te GERÇEKTEN yayındaki bir yazının linki gizli bir kod
  // DEĞİLDİR — herkese açık slug'ıyla /icerik/supabase-yazi.html sayfasında
  // görünür (bkz. icerik/supabase-yazi.md). Diğer tüm durumlarda (gizli
  // taslak, ya da eski yöntemle "yayinda:false" commit edilmiş GitHub
  // dosyası) link, tahmin edilemez bir kod gerektiren /onizleme/ sayfasıdır.
  let onizlemeLink;
  if (sadeceSupabaseYayinda && item.data.slug) {
    onizlemeLink = `${location.origin}/icerik/supabase-yazi.html?tur=${tur}&slug=${encodeURIComponent(item.data.slug)}`;
  } else {
    const gizliKod = icerikGizliKoduBul(item.data);
    onizlemeLink = gizliKod ? `${location.origin}/onizleme/?tur=${tur}&kod=${encodeURIComponent(gizliKod)}` : null;
  }

  // Hızlı yayın-durumu aksiyonu:
  //  - Supabase'teki GİZLİ bir taslaksa: "Yayınla" (GitHub'a commit eder, taslak satırı silinir).
  //  - Supabase'te SADECE Supabase'te (zaten) yayındaysa: "GitHub'a da Aktar" (içerik yayında
  //    kalır, ekstra olarak GitHub'a da commit edilir — "Seçenek B" durumuna geçer).
  //  - GitHub'da yayındaysa: "Yayından Kaldır" (Supabase'e taşır, GitHub dosyası silinir).
  //  - GitHub'da ama "gizli" (eski sistemden kalma, bkz. dosya başındaki not): "Supabase'e Taşı"
  //    (aynı işlemi yapar — GitHub'daki dosya artık bu yeni sistemde bulunmaması gereken bir
  //    yerde durduğu için Supabase'e taşınır).
  let durumBtn;
  // "Admin adına" talebin hedefi bu kişi mi (yazar_id === giriş yapan) YA DA
  // Site Sahibi (owner) mi? — migration 0026 ile onay/red yetkisi HERHANGİ
  // bir admin'den, SADECE hedef admin + owner'a daraltıldı. Bu değişken hem
  // yayınlama kilidinde hem Onayla/Reddet butonlarının gösteriminde
  // kullanılıyor.
  const hedefAdminVeyaOwnerMi =
    GIRIS_YAPAN_PROFIL?.role === "owner" ||
    (GIRIS_YAPAN_PROFIL?.role === "admin" && !!item.data.yazar_id && GIRIS_YAPAN_PROFIL?.id === item.data.yazar_id);
  // Admin onayı bekleyen/reddedilmiş bir "admin adına" talebi, hedef admin
  // ya da owner OLMAYAN biri gerçekten yayına alamaz — düğme devre dışı
  // bırakılıp sebebi title'da gösteriliyor (bkz. migration 0026'daki DB
  // tetikleyicisi zaten aynı kuralı zorunlu kılıyor, bu sadece kullanıcıyı
  // önceden bilgilendiren bir kolaylık katmanı).
  const onayEksikDegilMi =
    item.data.admin_adina_talep &&
    item.data.admin_onay_durumu !== "onaylandi" &&
    !hedefAdminVeyaOwnerMi;
  const kilitliOznitelik = onayEksikDegilMi
    ? `disabled title="Bu içerik, adına yazıldığı admin ${item.data.admin_onay_durumu === "reddedildi" ? "reddettiği için" : "onayı (ya da Site Sahibi onayı) bekleniyor olduğu için"} henüz yayınlanamaz."`
    : "";
  if (item.kaynak === "supabase" && sadeceSupabaseYayinda) {
    durumBtn = `<button type="button" class="gy-durum-degistir-btn gy-durum-degistir-btn--yayinla" data-hedef="yayinla" ${kilitliOznitelik}>GitHub'a da Aktar</button>`;
  } else if (item.kaynak === "supabase") {
    durumBtn = `<button type="button" class="gy-durum-degistir-btn gy-durum-degistir-btn--yayinla" data-hedef="yayinla" ${kilitliOznitelik}>Yayınla</button>`;
  } else if (yayinda) {
    durumBtn = '<button type="button" class="gy-durum-degistir-btn" data-hedef="gizle">Yayından Kaldır</button>';
  } else {
    durumBtn = '<button type="button" class="gy-durum-degistir-btn gy-durum-degistir-btn--yayinla" data-hedef="tasi">Supabase\'e Taşı</button>';
  }
  // SADECE bu içeriğin adına yazıldığı hedef admin ya da owner, "admin
  // adına" onay bekleyen bir talebi burada doğrudan onaylayabilir/
  // reddedebilir (migration 0026) — başka bir admin bu butonları GÖRMEZ.
  const onayBtns =
    hedefAdminVeyaOwnerMi &&
    item.data.admin_adina_talep &&
    item.data.admin_onay_durumu === "beklemede"
      ? `<button type="button" class="gy-onay-btn" data-onay="1">✅ Onayla</button>
         <button type="button" class="gy-onay-btn gy-onay-btn--red" data-onay="0">❌ Reddet</button>`
      : "";
  // "Site Sahibi adına" onay bekleyen bir talep için İKİ FARKLI aksiyon
  // seti var (bkz. migration 0023 § A):
  //   - owner ise: tek başına Onayla/Reddet (sahip_taslak_onayla RPC'si).
  //   - sıradan admin ise (owner DEĞİL): Onay Ver/Red Ver OYU (adminlerin
  //     MUTLAK ÇOĞUNLUĞU sağlanınca sunucu otomatik sonuçlandırır, bkz.
  //     admin_sahip_talebi_oy_kullan RPC'si) — tek bir adminin oyu tek
  //     başına yeterli DEĞİLDİR, bu yüzden buton metni kasıtlı olarak
  //     "Onayla" değil "Onay Ver" diyor.
  const sahipOnayBtns =
    item.data.sahip_adina_talep && item.data.sahip_onay_durumu === "beklemede"
      ? GIRIS_YAPAN_PROFIL?.role === "owner"
        ? `<button type="button" class="gy-onay-btn gy-sahip-onay-btn" data-onay="1">✅ Onayla (Site Sahibi)</button>
           <button type="button" class="gy-onay-btn gy-onay-btn--red gy-sahip-onay-btn" data-onay="0">❌ Reddet (Site Sahibi)</button>`
        : GIRIS_YAPAN_PROFIL?.role === "admin"
          ? `<button type="button" class="gy-onay-btn gy-sahip-oy-btn" data-oy="onay">👍 Onay Ver</button>
             <button type="button" class="gy-onay-btn gy-onay-btn--red gy-sahip-oy-btn" data-oy="red">👎 Red Ver</button>`
          : ""
      : "";
  const linkBtn = onizlemeLink
    ? `<button type="button" class="gy-link-kopyala-mini-btn" title="${escapeHtml(onizlemeLink)}">🔗 Linki Kopyala</button>`
    : "";

  const yolGoster = item.kaynak === "supabase" ? item.data.dosya_yolu || "(henüz GitHub'a commit edilmedi)" : item.path;

  // İçerik editörü (role='editor') kendisine ait OLMAYAN bir içeriği (ör.
  // içerik sorumlusunun ya da admin'in yayındaki bir yazısını) DÜZENLEYEMEZ
  // / SİLEMEZ / yayın durumunu DEĞİŞTİREMEZ — sadece görebilir (yayındaysa).
  // Gerçek sınır Supabase RLS'i (migration 0014/0018) ve Worker'dadır (bkz.
  // cloudflare worker/github_icerik_yonetim_worker/worker.js); bu sadece
  // butonları önceden gizleyerek kullanıcıyı zaten reddedilecek bir isteği
  // denemekten caydıran bir kolaylık katmanıdır.
  const editorKisitliMi = GIRIS_YAPAN_PROFIL?.role === "editor" && !icerikKendisineMiAit(item);
  const duzenleSilBtnleri = editorKisitliMi
    ? ""
    : `<button type="button" class="gy-duzenle-btn">Düzenle</button>
       <button type="button" class="gy-sil-btn">Sil</button>`;

  kart.innerHTML = `
    <div class="gy-icerik-kart-bilgi">
      <div class="gy-icerik-kart-baslik">${metniVurgula(item.data.title || yolGoster)}${hafifRozet}${rozet}${kaynakRozet}${supabaseYedekRozet}${onayRozet}${sahipOnayRozet}</div>
      <div class="gy-icerik-kart-meta">${escapeHtml(item.data.date || "")} · ${metniVurgula(yolGoster)}${yazarSatiri}</div>
      ${ozet}
    </div>
    <div class="gy-icerik-kart-aksiyonlar">
      ${onayBtns}
      ${sahipOnayBtns}
      ${editorKisitliMi ? "" : durumBtn}
      ${linkBtn}
      ${duzenleSilBtnleri}
    </div>
  `;
  kart.querySelector(".gy-duzenle-btn")?.addEventListener("click", () => icerikDuzenlemeyeYukle(item, tur));
  kart.querySelector(".gy-sil-btn")?.addEventListener("click", () => icerikSil(item));
  kart.querySelector(".gy-durum-degistir-btn")?.addEventListener("click", (e) => {
    if (e.currentTarget.disabled) return;
    if (item.kaynak === "supabase") {
      taslagiYayinla(item, tur, e.currentTarget);
    } else {
      gitDenTaslagaTasi(item, tur, e.currentTarget);
    }
  });
  kart.querySelectorAll(".gy-onay-btn:not(.gy-sahip-onay-btn):not(.gy-sahip-oy-btn)").forEach((btn) => {
    btn.addEventListener("click", (e) => adminTaslakOnayla(item, tur, e.currentTarget.dataset.onay === "1", e.currentTarget));
  });
  kart.querySelectorAll(".gy-sahip-onay-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => sahipTaslakOnayla(item, tur, e.currentTarget.dataset.onay === "1", e.currentTarget));
  });
  kart.querySelectorAll(".gy-sahip-oy-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => sahipTalebineOyVer(item, tur, e.currentTarget.dataset.oy, e.currentTarget));
  });
  // "Site Sahibi onayı bekliyor" rozetindeki metni, mevcut oy durumunu
  // (X/Y admin onayladı) göstermek için zenginleştir — sadece admin/owner
  // görebilir (sahip_onay_durumu_getir RPC'si zaten is_admin() zorunlu
  // kılıyor, bkz. migration 0023 § A.6), bu yüzden diğer roller için
  // sessizce atlanıyor.
  if (
    item.data.sahip_adina_talep &&
    item.data.sahip_onay_durumu === "beklemede" &&
    (GIRIS_YAPAN_PROFIL?.role === "admin" || GIRIS_YAPAN_PROFIL?.role === "owner") &&
    item.taslakId
  ) {
    supabase
      .rpc("sahip_onay_durumu_getir", { p_taslak_id: item.taslakId })
      .then(({ data, error }) => {
        if (error || !data?.[0]) return;
        const { onay_sayisi, red_sayisi, gerekli_oy_sayisi } = data[0];
        const rozetEl = kart.querySelector(`#gy-sahip-oy-${item.taslakId}`);
        if (rozetEl) {
          rozetEl.textContent = `⏳ Site Sahibi onayı bekliyor (${onay_sayisi} onay / ${red_sayisi} red — gerekli: ${gerekli_oy_sayisi})`;
        }
      })
      .catch(() => {});
  }
  const linkKopyalaBtn = kart.querySelector(".gy-link-kopyala-mini-btn");
  if (linkKopyalaBtn) {
    linkKopyalaBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(onizlemeLink);
        linkKopyalaBtn.textContent = "Kopyalandı ✓";
      } catch {
        window.prompt("Linki elle kopyala:", onizlemeLink);
      }
      setTimeout(() => (linkKopyalaBtn.textContent = "🔗 Linki Kopyala"), 1600);
    });
  }
  return kart;
}

/**
 * Supabase'teki bir taslağı GitHub'a yayınlar: front-matter'ı taslağın
 * alanlarından yeniden üretir (onizleme_kod korunur), hedef yola (taslak
 * kaydedilirken seçilen klasör dahil, item.data.dosya_yolu) commit atar,
 * başarılı olursa taslak satırını Supabase'den siler.
 */
/**
 * SADECE bu içeriğin adına yazıldığı hedef admin'in kendisi ya da Site
 * Sahibi (owner), "admin adına" onay bekleyen bir taslağı burada
 * onaylar/reddeder (bkz. admin_taslak_onayla RPC'si, migration 0026 —
 * eskiden HERHANGİ bir admin onaylayabiliyordu, bu artık kapatıldı; RPC ve
 * veritabanı tetikleyicisi de aynı kısıtlamayı zorunlu kılıyor, buradaki
 * kontrol sadece önceden caydıran bir kolaylık katmanı). Onaylandıktan
 * sonra içerik normal "Yayınla" butonuyla (hedef admin, owner veya isteği
 * yapan manager/editor tarafından) gerçekten yayına alınabilir hâle gelir.
 */
async function adminTaslakOnayla(item, tur, onay, btn) {
  const yetkiliMi =
    GIRIS_YAPAN_PROFIL?.role === "owner" ||
    (GIRIS_YAPAN_PROFIL?.role === "admin" && !!item.data.yazar_id && GIRIS_YAPAN_PROFIL?.id === item.data.yazar_id);
  if (!yetkiliMi || !item.taslakId) return;
  btn.disabled = true;
  const oncekiMetin = btn.textContent;
  btn.textContent = "İşleniyor…";
  try {
    const { error } = await supabase.rpc("admin_taslak_onayla", {
      p_taslak_id: item.taslakId,
      p_onay: onay,
    });
    if (error) throw error;
    await icerikListesiYukle();
  } catch (err) {
    console.error("Onay/red işlemi başarısız:", err);
    alert(`İşlem başarısız: ${err.message}`);
    btn.disabled = false;
    btn.textContent = oncekiMetin;
  }
}

/**
 * Site Sahibi (owner), "site sahibi adına" onay bekleyen bir taslağı TEK
 * BAŞINA onaylar/reddeder (bkz. sahip_taslak_onayla RPC'si, migration
 * 0023 § A.5). Adminlerin çoğunluk oylamasından BAĞIMSIZ bir yol — owner
 * her zaman tek başına sonuçlandırabilir.
 */
async function sahipTaslakOnayla(item, tur, onay, btn) {
  if (GIRIS_YAPAN_PROFIL?.role !== "owner" || !item.taslakId) return;
  btn.disabled = true;
  const oncekiMetin = btn.textContent;
  btn.textContent = "İşleniyor…";
  try {
    const { error } = await supabase.rpc("sahip_taslak_onayla", {
      p_taslak_id: item.taslakId,
      p_onay: onay,
    });
    if (error) throw error;
    await icerikListesiYukle();
  } catch (err) {
    console.error("Site Sahibi onay/red işlemi başarısız:", err);
    alert(`İşlem başarısız: ${err.message}`);
    btn.disabled = false;
    btn.textContent = oncekiMetin;
  }
}

/**
 * Sıradan bir admin (owner DEĞİL), "site sahibi adına" onay bekleyen bir
 * taslağa OY VERİR — tek bir adminin oyu YETERLİ DEĞİLDİR, sunucu
 * tarafındaki admin_sahip_talebi_oy_kullan RPC'si (migration 0023 § A.6)
 * adminlerin MUTLAK ÇOĞUNLUĞUNA (toplam admin sayısının floor(n/2)+1'i)
 * ulaşılınca durumu otomatik 'onaylandi'/'reddedildi' yapar; ulaşılmadıysa
 * sadece oy kaydedilir ve liste "beklemede" görünmeye devam eder.
 */
async function sahipTalebineOyVer(item, tur, oy, btn) {
  if (GIRIS_YAPAN_PROFIL?.role !== "admin" || !item.taslakId) return;
  btn.disabled = true;
  const oncekiMetin = btn.textContent;
  btn.textContent = "İşleniyor…";
  try {
    const { error } = await supabase.rpc("admin_sahip_talebi_oy_kullan", {
      p_taslak_id: item.taslakId,
      p_oy: oy,
    });
    if (error) throw error;
    await icerikListesiYukle();
  } catch (err) {
    console.error("Oy kaydedilemedi:", err);
    alert(`İşlem başarısız: ${err.message}`);
    btn.disabled = false;
    btn.textContent = oncekiMetin;
  }
}

async function taslagiYayinla(item, tur, btn) {
  // "sadece_supabase" (zaten GERÇEKTEN yayında) bir satır için bu buton
  // "GitHub'a da Aktar" anlamına gelir — içerik Supabase'te yayında kalmaya
  // devam eder, sadece EK olarak GitHub'a da commit edilir (bkz.
  // icerikKartiCiz'deki buton metni). Diğer tüm Supabase kaynaklı öğeler
  // (gerçek gizli taslaklar) için bu buton klasik "Yayınla" anlamına gelir:
  // GitHub'a commit edilir VE Supabase satırı silinir (içerik artık sadece
  // GitHub'da yaşar).
  const sadeceSupabaseYayinda = item.data.yayin_durumu === "sadece_supabase";
  const soruMetni = sadeceSupabaseYayinda
    ? `"${item.data.title || item.data.dosya_yolu}" içeriği Supabase'te yayında kalmaya devam ederken EK olarak GitHub'a da commit edilsin mi?`
    : `"${item.data.title || item.data.dosya_yolu}" GitHub'a yayınlansın mı?`;
  if (!confirm(soruMetni)) return;

  btn.disabled = true;
  const oncekiMetin = btn.textContent;
  btn.textContent = "İşleniyor...";
  try {
    // BUG FİX (yazar bilgisi kayboluyordu): bu alan önceden sadece
    // {title, date} taşıyordu — yani Supabase taslağı GitHub'a yayınlanınca
    // front-matter'daki author/yazar_id/olusturan_id HİÇ yazılmıyordu.
    // Sonuç: (1) yayınlanan yazıda "Yazan: X" hiç görünmüyordu, (2) editörün
    // "admin adına" gönderdiği içerik, yayınlandıktan SONRA sahiplik
    // bilgisini tamamen kaybediyor, editör artık onu ne düzenleyebiliyor ne
    // silebiliyordu (bkz. icerikKendisineMiAit / Worker'daki editorSahibiMi).
    const alan = {
      title: item.data.title,
      date: item.data.date,
      author: item.data.yazar_adi || null,
      yazarId: item.data.yazar_id || null,
      olusturanId: item.data.olusturan_id || item.data.yazar_id || null,
    };
    if (tur === "proje") {
      alan.venue = item.data.venue;
      alan.status = item.data.status;
      alan.summary = item.data.summary;
      alan.link = item.data.link;
      alan.link_label = item.data.link_label;
    }
    const gizliKod = icerikGizliKoduBul(item.data); // korunur — bkz. dosyaIcerigiOlustur notu
    const dosyaIcerigi = dosyaIcerigiOlustur(tur, alan, gizliKod, item.body || "");
    const dosyaYolu = item.data.dosya_yolu;

    const mevcutHedef = await ghGetContents(dosyaYolu).catch(() => null);
    await ghPutFile(dosyaYolu, b64Encode(dosyaIcerigi), `Yayınlandı: ${dosyaYolu}`, mevcutHedef?.sha || null);
    // Hedef klasörde artık bu gerçek içerik var, orada duran .gitkeep varsa temizlenir.
    await klasordekiGitkeepiTemizle(ustKlasorYolu(dosyaYolu));

    if (sadeceSupabaseYayinda) {
      // Satırı SİLMEK yerine 'supabase_ve_github' durumuna geçiriyoruz —
      // içerik artık hem GitHub'da hem Supabase'te (yedek/arama kaydı) var.
      const { error } = await supabase
        .from("taslak_icerikler")
        .update({ yayin_durumu: "supabase_ve_github" })
        .eq("id", item.taslakId);
      if (error) console.error("Taslak satırı 'supabase_ve_github' durumuna güncellenemedi:", error);
    } else {
      const { error } = await supabase.from("taslak_icerikler").delete().eq("id", item.taslakId);
      if (error) console.error("Taslak satırı silinemedi (dosya GitHub'a başarıyla yayınlandı):", error);
    }

    await panelListeleriniTazele();
    await icerikListesiYukle();
  } catch (err) {
    alert(`İşlem başarısız: ${err.message}`);
    btn.disabled = false;
    btn.textContent = oncekiMetin;
  }
}

/**
 * GitHub'daki bir dosyayı Supabase'e taşır: front-matter + gövdeyi okuyup
 * `taslak_icerikler`e yazar (aynı tur+onizleme_kod varsa üzerine yazar),
 * başarılı olursa GitHub'daki dosyayı siler. Hem "yayından kaldır" (o an
 * yayında olan bir içerik için) hem de "Supabase'e taşı" (eski sistemden
 * kalma, GitHub'da hâlâ gizli duran bir dosya için) aynı işlemdir.
 */
async function gitDenTaslagaTasi(item, tur, btn) {
  const eylemAdi = item.data.yayinda === false ? "Supabase'e taşınsın" : "yayından kaldırılıp Supabase'e taşınsın";
  if (!confirm(`"${item.data.title || item.path}" ${eylemAdi} mı?`)) return;

  const gizliKod = icerikGizliKoduBul(item.data) || rastgeleKod(8);
  if (onizlemeKoduCakisiyorMu(tur, gizliKod, itemAnahtari(item))) {
    alert(
      `Bu içeriğin daha önce kullandığı ön izleme kodu ("${gizliKod}") başka bir içerikte de kullanılıyor gibi görünüyor. Formu açıp "Düzenle" ile yeni bir kod üretmen gerekiyor.`
    );
    return;
  }

  btn.disabled = true;
  const oncekiMetin = btn.textContent;
  btn.textContent = "İşleniyor...";
  try {
    const dosyaAdi = item.path.split("/").pop().replace(/\.md$/, "");
    const slug = tur === "blog" ? dosyaAdi.replace(/^\d{4}-\d{2}-\d{2}-/, "") : dosyaAdi.replace(/^\d{4}-/, "");

    const {
      data: { user },
    } = await supabase.auth.getUser();
    const satir = {
      tur,
      baslik: item.data.title || dosyaAdi,
      tarih: item.data.date || new Date().toISOString().slice(0, 10),
      slug,
      dosya_yolu: item.path,
      venue: item.data.venue || null,
      durum: item.data.status || null,
      ozet: item.data.summary || null,
      link: item.data.link || null,
      link_etiket: item.data.link_label || null,
      govde: item.body || "",
      onizleme_kod: gizliKod,
      created_by: user?.id || null,
    };
    const { error: upsertHata } = await supabase
      .from("taslak_icerikler")
      .upsert(satir, { onConflict: "tur,onizleme_kod" });
    if (upsertHata) throw new Error(upsertHata.message);

    await ghDeleteFile(item.path, item.sha, `Supabase'e taşındı (yayından kaldırıldı): ${item.path}`);
    await klasorBosaldiysaGitkeepEkle(ustKlasorYolu(item.path));
    await panelListeleriniTazele();
    await icerikListesiYukle();
  } catch (err) {
    alert(`İşlem başarısız: ${err.message}`);
    btn.disabled = false;
    btn.textContent = oncekiMetin;
  }
}

async function icerikSil(item) {
  if (!confirm(`"${item.data.title || item.path || item.data.dosya_yolu}" silinsin mi? Bu işlem geri alınamaz.`)) return;
  try {
    if (item.kaynak === "supabase") {
      const { error } = await supabase.from("taslak_icerikler").delete().eq("id", item.taslakId);
      if (error) throw new Error(error.message);
    } else {
      await ghDeleteFile(item.path, item.sha, `İçerik silindi: ${item.path}`);
      // Klasör bu silinen dosyayla birlikte tamamen boşaldıysa, GitHub'da
      // "boş klasör" diye bir kavram olmadığından klasörün depodan
      // tamamen kaybolmaması için oraya .gitkeep geri eklenir (bkz. dosya
      // başındaki .gitkeep yaşam döngüsü notu).
      await klasorBosaldiysaGitkeepEkle(ustKlasorYolu(item.path));

      // "Seçenek B" ile yayınlanmış bir içerikse (bkz. supabaseYedek),
      // GitHub dosyasıyla birlikte Supabase'teki yedek/arama kaydı da
      // silinir — aksi halde GitHub'da artık var olmayan bir içeriğin
      // Supabase satırı öksüz kalır ve bir sonraki yüklemede yanlışlıkla
      // bağımsız bir taslak olarak tekrar listelenir.
      if (item.supabaseYedek && item.taslakId) {
        const { error } = await supabase.from("taslak_icerikler").delete().eq("id", item.taslakId);
        if (error) console.error("Supabase yedek satırı silinemedi (GitHub dosyası başarıyla silindi):", error);
      }
    }
    // Silinen öğeyi listeden HEMEN kaldır — "okunamadı" rozetiyle listede
    // hayalet olarak kalmasını önler (bkz. ghRequest'teki cache notu: bu
    // yerel kaldırma, olası bir gecikme/tutarlılık sorununa karşı ek bir
    // güvence, tek başına yeterli olan asıl düzeltme değil).
    TUM_ICERIKLER = TUM_ICERIKLER.filter((i) => itemAnahtari(i) !== itemAnahtari(item));
    listeyiYenidenCiz();
    await panelListeleriniTazele();
    await icerikListesiYukle();
    // EK GÜVENCE: panelListeleriniTazele'deki bekleme yeterli olmadıysa
    // (ör. GitHub o an olağandışı yavaşsa) ve icerikListesiYukle silinen
    // öğeyi hâlâ eski (silme öncesi) veriden geri getirdiyse, burada onu
    // TEKRAR eleyip yeniden çiziyoruz — silinen bir öğe hiçbir koşulda
    // listede "geri gelmiş" görünmemeli.
    const anahtar = itemAnahtari(item);
    if (TUM_ICERIKLER.some((i) => itemAnahtari(i) === anahtar)) {
      TUM_ICERIKLER = TUM_ICERIKLER.filter((i) => itemAnahtari(i) !== anahtar);
      listeyiYenidenCiz();
    }
  } catch (err) {
    alert(`Silinemedi: ${err.message}`);
  }
}

async function icerikDuzenlemeyeYukle(item, tur) {
  // GitHub kaynaklı ve içeriği henüz çekilmemiş ("hafif") bir öğeyse —
  // panel-init artık front-matter TAŞIMADIĞI için (bkz. worker.js Git
  // Trees API notu) — düzenleme formunu doldurmadan ÖNCE TEK bir
  // `/contents/<path>` isteğiyle gerçek içeriği çek (sha'ya göre
  // sessionStorage'a önbellenir, bkz. icerikIcerigiZenginlestir). Zaten
  // (bu sayfada görünüp) önceden zenginleştirilmişse ya da önbellekten
  // gelmişse burası ağa hiç gitmez.
  if (item.kaynak === "github" && item.hafif) {
    const dm = document.getElementById("gh-baglanti-message");
    const basarili = await icerikIcerigiZenginlestir(item);
    if (!basarili) {
      showMessage(dm, `"${item.path}" içeriği okunamadı, düzenlenemiyor.`, "error");
      return;
    }
  }

  if (item.kaynak === "supabase") {
    DUZENLENEN_YOL = null;
    DUZENLENEN_SHA = null;
    DUZENLENEN_TASLAK_ID = item.taslakId;
  } else {
    DUZENLENEN_YOL = item.path;
    DUZENLENEN_SHA = item.sha;
    // "Seçenek B" ile yayınlanmış bir GitHub öğesiyse (supabaseYedek),
    // Supabase'teki yedek satırın id'si de hatırlanır — böylece tekrar
    // "🅱️" ile kaydedilirse YENİ bir satır açmak yerine AYNI satır
    // güncellenir (bkz. icerikSupabaseVeGithubaYaz).
    DUZENLENEN_TASLAK_ID = item.supabaseYedek ? item.taslakId : null;
  }
  DUZENLENEN_OLUSTURAN_ID = item.data.olusturan_id || item.data.yazar_id || null;

  // Yazar alanını içeriğin kayıtlı yazarına göre doldur (admin arama
  // kutusundaysa, kayıtlı yazar_id hâlâ geçerli bir adaysa onu id+ad ile
  // doldurur; editor için zaten salt okunur ve her zaman kendi adını
  // gösterir, bkz. wireYazarAlani).
  const yazarKutuWrap = document.getElementById("ic-yazar-arama-kutusu");
  if (yazarKutuWrap && !yazarKutuWrap.hidden && item.data.yazar_adi) {
    const adayId = item.data.yazar_id && (YAZAR_ADAYLARI || []).some((u) => u.id === item.data.yazar_id) ? item.data.yazar_id : null;
    yazarSecimiUygula(adayId, item.data.yazar_adi);
  }

  // "Admin adına yayınla" durumunu geri yükle (sadece manager rolünde
  // görünen kutu — bkz. wireAdminAdinaTalep).
  const adminAdinaKutu = document.getElementById("ic-admin-adina-kutu");
  if (adminAdinaKutu && !document.getElementById("ic-admin-adina-wrap")?.hidden) {
    adminAdinaKutu.checked = item.data.admin_adina_talep === true;
    if (item.data.admin_adina_talep && item.data.yazar_id) {
      const hedefSecim = document.getElementById("ic-admin-adina-hedef");
      if (hedefSecim) hedefSecim.value = item.data.yazar_id;
    }
    adminAdinaKutu.dispatchEvent(new Event("change"));
  }

  document.querySelector(`input[name="icerik-turu"][value="${tur}"]`).checked = true;
  await guncelleIcerikTuru();

  document.getElementById("ic-title").value = item.data.title || "";
  document.getElementById("ic-date").value = item.data.date || "";

  // Supabase taslaklarında slug doğrudan saklanır (bkz. taslakToItem);
  // GitHub dosyalarında dosya adından geri çıkarılır.
  const yolKaynagi = item.kaynak === "supabase" ? item.data.dosya_yolu || "" : item.path;
  const dosyaAdi = yolKaynagi.split("/").pop().replace(/\.md$/, "");
  document.getElementById("ic-slug").value =
    item.kaynak === "supabase"
      ? item.data.slug || ""
      : tur === "blog"
      ? dosyaAdi.replace(/^\d{4}-\d{2}-\d{2}-/, "")
      : dosyaAdi.replace(/^\d{4}-/, "");
  document.getElementById("ic-yil-oneki").checked = tur === "proje" && /^\d{4}-/.test(dosyaAdi);

  // NOT: guncelleIcerikTuru()'nun (dolayısıyla dropdown'ı GitHub'daki
  // gerçek klasörlerle dolduran icerikFormuKlasorSecimGuncelle'nin)
  // yukarıda "await" ile BİTMİŞ olması burada zorunlu — aksi halde bu
  // satırın eklediği/seçtiği klasör, geç gelen dropdown sıfırlamasıyla
  // ezilebilirdi. Supabase taslaklarında da aynı mantık, dosyanın
  // GitHub'a yayınlandığında gideceği yol (dosya_yolu) üzerinden çalışır.
  if (yolKaynagi) {
    icerikDuzenlemeKlasorSecimineYansit(yolKaynagi, item.data.date, tur);
  }

  if (tur === "proje") {
    document.getElementById("ic-venue").value = item.data.venue || "";
    document.getElementById("ic-status").value = item.data.status || "Yayınlandı";
    document.getElementById("ic-summary").value = item.data.summary || "";
    document.getElementById("ic-link").value = item.data.link || "";
    document.getElementById("ic-link-label").value = item.data.link_label || "";
  }

  document.getElementById("ic-body").value = item.body || "";
  const yayinda = item.data.yayinda !== false;
  document.getElementById("ic-yayinda").checked = yayinda;
  document.getElementById("ic-gizli-hedef-wrap").hidden = yayinda;

  // İçeriğin daha önce üretilmiş bir gizli ön izleme kodu varsa hatırla ve
  // göster. Permalink/onizleme_kod herhangi bir sebeple eksikse (elle
  // düzenlenmiş dosya vb.) yeni bir kod üretip gösteriyoruz. Hedef seçimi
  // (Supabase/GitHub) içeriğin şu an nerede durduğuna göre otomatik
  // ayarlanır: bir Supabase taslağı düzenleniyorsa "supabase", GitHub'da
  // "yayinda: false" olarak duran bir dosya düzenleniyorsa "github".
  DUZENLENEN_GIZLI_KOD = icerikGizliKoduBul(item.data);
  if (!yayinda) {
    const hedef = item.kaynak === "supabase" ? "supabase" : "github";
    const hedefInput = document.querySelector(`input[name="gizli-hedef"][value="${hedef}"]`);
    if (hedefInput) hedefInput.checked = true;
    onizlemeKutusunuGoster(tur, DUZENLENEN_GIZLI_KOD || rastgeleKod(8), hedef);
  } else {
    onizlemeKutusunuGizle();
  }

  document.getElementById("ic-iptal-btn").hidden = false;
  submitButonMetniGuncelle();
  document.getElementById("icerik-ekle").scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------------------------------------------------------------------- */
/* PROFİL FOTOĞRAFI YÖNETİMİ (yolu _config.yml → profile_image'tan okunur) */
/*                                                                        */
/* SADECE role='admin' — editor VE manager (İçerik Sorumlusu) sitenin     */
/* profil fotoğrafını DEĞİŞTİREMEZ/SİLEMEZ. Bu bölüm/nav linki onlar için  */
/* DOM'dan tamamen kaldırılır (aşağıya bkz.); profilFotoYukle/profilFotoSil */
/* içindeki ayrı rol kontrolleri ikinci bir savunma katmanıdır — ASIL      */
/* güvenlik sınırı artık GERÇEKTEN de burada: assets/ altına yazma isteği  */
/* editor/manager'ın Supabase oturum token'ıyla Worker'a ulaşsa bile,      */
/* Worker rolü tekrar kontrol edip SADECE admin için izin veriyor (bkz.    */
/* cloudflare worker/github_icerik_worker/worker.js — "YOL (PATH)          */
/* KISITLARI"). Eskiden burada, editor/manager'a verilen bir GitHub PAT'ın */
/* bu paneli atlayıp assets/'e doğrudan yazabileceğine dair bir uyarı      */
/* vardı — artık geçerli değil, çünkü PAT hiçbir zaman onların tarayıcısına*/
/* girmiyor (bkz. dosya başındaki GÜVENLİK MİMARİSİ notu).                */
/* ---------------------------------------------------------------------- */
function wireProfilFoto() {
  const navLink = document.querySelector('#gy-nav a[data-section="profil-foto"]');
  const bolum = document.getElementById("profil-foto");

  if (GIRIS_YAPAN_PROFIL?.role !== "admin" && GIRIS_YAPAN_PROFIL?.role !== "owner") {
    navLink?.remove();
    bolum?.remove();
    return;
  }

  document.getElementById("pf-yukle-btn").addEventListener("click", profilFotoYukle);
  document.getElementById("pf-sil-btn").addEventListener("click", profilFotoSil);
}

/* _config.yml içeriğini okuyup `profile_image:` satırının değerini
 * (baştaki "/" temizlenmiş, repo-göreli hâliyle) çıkarır. Satır yoksa ya
 * da değeri boşsa yol=null döner. */
async function profilYapilandirmasiniOku() {
  const dosya = await ghGetContents(CONFIG_YOLU);
  if (!dosya) throw new Error("_config.yml bulunamadı.");
  const icerik = b64Decode(dosya.content.replace(/\n/g, ""));
  const eslesme = icerik.match(PROFIL_IMAGE_SATIR_REGEX);
  let yol = null;
  if (eslesme) {
    let deger = (eslesme[1] || "").trim().replace(/^["']|["']$/g, "").trim();
    if (deger) yol = deger.replace(/^\/+/, "");
  }
  return { yol, icerik, sha: dosya.sha };
}

/* profile_image satırını yakalar; 1. grup değeri, 2. grup varsa satır
 * sonu yorumunu ("  # ..." kısmı) tutar, böylece güncellerken yorum
 * korunur. */
const PROFIL_IMAGE_SATIR_REGEX = /^profile_image:[ \t]*("[^"]*"|'[^']*'|[^#\r\n]*?)?[ \t]*(#.*)?$/m;

function configIcindeProfilYoluYaz(icerik, yeniDegerYaml) {
  const eslesme = icerik.match(PROFIL_IMAGE_SATIR_REGEX);
  const yorum = eslesme && eslesme[2] ? `   ${eslesme[2]}` : "";
  const yeniSatir = `profile_image: ${yeniDegerYaml}${yorum}`;
  if (eslesme) return icerik.replace(PROFIL_IMAGE_SATIR_REGEX, yeniSatir);
  return `${yeniSatir}\n${icerik}`;
}

async function configProfilYoluGuncelle(yeniYol) {
  const { icerik, sha } = await profilYapilandirmasiniOku();
  const guncel = configIcindeProfilYoluYaz(icerik, `"/${yeniYol}"`);
  await ghPutFile(CONFIG_YOLU, b64Encode(guncel), `_config.yml: profile_image → /${yeniYol}`, sha);
}

async function configProfilYoluTemizle() {
  const { icerik, sha, yol } = await profilYapilandirmasiniOku();
  if (!yol) return; // zaten boş
  const guncel = configIcindeProfilYoluYaz(icerik, `""`);
  await ghPutFile(CONFIG_YOLU, b64Encode(guncel), "_config.yml: profile_image temizlendi", sha);
}

/* Dosya adını GitHub'a güvenli şekilde yazılabilecek, Türkçe karakterden
 * arındırılmış bir ada çevirir (ör. "Yeni Fotoğrafım Ş.PNG" -> "yeni-fotografim-s.png"). */
function profilDosyaAdiTemizle(ad) {
  const TR_HARF = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", İ: "i", Ç: "c", Ğ: "g", Ö: "o", Ş: "s", Ü: "u" };
  const sonNokta = ad.lastIndexOf(".");
  let isim = sonNokta > 0 ? ad.slice(0, sonNokta) : ad;
  let uzanti = sonNokta > 0 ? ad.slice(sonNokta + 1).toLowerCase().replace(/[^a-z0-9]/g, "") : "";
  isim = isim
    .split("")
    .map((c) => TR_HARF[c] || c)
    .join("")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  if (!isim) isim = "profile";
  return uzanti ? `${isim}.${uzanti}` : isim;
}

function profilMimeTuruTahminEt(yol) {
  const uzanti = (yol.split(".").pop() || "").toLowerCase();
  const tablo = { jpg: "jpeg", jpeg: "jpeg", png: "png", webp: "webp", gif: "gif", svg: "svg+xml", avif: "avif", bmp: "bmp" };
  return `image/${tablo[uzanti] || "jpeg"}`;
}

/**
 * Profil fotoğrafı durumunu gösterir — artık GitHub'a AYRICA istek atmadan,
 * PANEL_VERI önbelleğinden (config + profilFoto, bkz. panelVerisiniYukle)
 * okur. Worker zaten SADECE admin için bu alanları dolduruyor (bkz.
 * worker.js panelBaslangicVerisiGetir'deki güvenlik notu), o yüzden
 * editor/manager'da PANEL_VERI.config/profilFoto her zaman null gelir.
 */
function profilFotoDurumYukle() {
  // editor/manager için bölüm DOM'dan tamamen kaldırılmış olabilir
  // (bkz. wireProfilFoto) — bu fonksiyon yine de wireBaglantiDogrula
  // tarafından role'e bakılmaksızın çağrılıyor, o yüzden burada da
  // ayrıca koruyoruz.
  const el = document.getElementById("pf-mevcut");
  if (!el || (GIRIS_YAPAN_PROFIL?.role !== "admin" && GIRIS_YAPAN_PROFIL?.role !== "owner")) return;
  if (!PANEL_VERI) {
    el.innerHTML = '<p class="muted">Önce "GitHub Bağlantısı" sekmesinden bağlantını doğrula.</p>';
    return;
  }
  const configIcerik =
    typeof PANEL_VERI.config?.content === "string" ? b64Decode(PANEL_VERI.config.content.replace(/\n/g, "")) : "";
  const eslesme = configIcerik.match(PROFIL_IMAGE_SATIR_REGEX);
  let yol = null;
  if (eslesme) {
    const deger = (eslesme[1] || "").trim().replace(/^["']|["']$/g, "").trim();
    if (deger) yol = deger.replace(/^\/+/, "");
  }
  PROFIL_YOLU = yol;
  if (!PROFIL_YOLU) {
    PROFIL_SHA = null;
    el.innerHTML = '<p class="muted">Şu anda bir profil fotoğrafı yok (yapılandırmada tanımlı değil).</p>';
    return;
  }
  const dosya = PANEL_VERI.profilFoto && PANEL_VERI.profilFoto.path === PROFIL_YOLU ? PANEL_VERI.profilFoto : null;
  if (!dosya || !dosya.sha) {
    PROFIL_SHA = null;
    el.innerHTML = `<p class="muted">Şu anda bir profil fotoğrafı yok (yapılandırmadaki <code>${escapeHtml(
      PROFIL_YOLU
    )}</code> dosyası repoda bulunamadı).</p>`;
    return;
  }
  PROFIL_SHA = dosya.sha;
  const src =
    dosya.download_url ||
    `data:${profilMimeTuruTahminEt(PROFIL_YOLU)};base64,${(dosya.content || "").replace(/\n/g, "")}`;
  el.innerHTML = `<img src="${src}" alt="Mevcut profil fotoğrafı"><span class="muted">Mevcut dosya: <code>${escapeHtml(
    PROFIL_YOLU
  )}</code> (sha: ${escapeHtml(dosya.sha.slice(0, 8))}...)</span>`;
}

function dosyayiBase64eCevir(dosya) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = () => reject(new Error("Dosya okunamadı"));
    reader.readAsDataURL(dosya);
  });
}

async function profilFotoYukle() {
  const msgEl = document.getElementById("pf-message");
  if (GIRIS_YAPAN_PROFIL?.role !== "admin" && GIRIS_YAPAN_PROFIL?.role !== "owner") {
    showMessage(msgEl, "Bu işlem için yetkin yok — profil fotoğrafını sadece admin değiştirebilir.", "error");
    return;
  }
  const dosyaInput = document.getElementById("pf-dosya");
  const dosya = dosyaInput.files[0];

  if (!dosya) {
    showMessage(msgEl, "Önce bir görsel seç.", "error");
    return;
  }
  if (!GH_BAGLI) {
    showMessage(msgEl, 'Önce "GitHub Bağlantısı" sekmesinden bağlantını doğrula.', "error");
    return;
  }

  const btn = document.getElementById("pf-yukle-btn");
  btn.disabled = true;
  btn.textContent = "Yükleniyor...";
  try {
    const { yol: eskiYol } = await profilYapilandirmasiniOku();
    const yeniYol = "assets/" + profilDosyaAdiTemizle(dosya.name);
    const base64 = await dosyayiBase64eCevir(dosya);

    if (eskiYol && eskiYol === yeniYol) {
      // Aynı yol/isim: dosyanın güncel sha'sını al ve üzerine yaz.
      const mevcut = await ghGetContents(yeniYol);
      await ghPutFile(yeniYol, base64, "Profil fotoğrafı güncellendi", mevcut ? mevcut.sha : null);
    } else {
      // Farklı isim/uzantı: yeni dosyayı ekle, eskisini (varsa) sil,
      // ardından _config.yml → profile_image'ı yeni yola güncelle —
      // böylece yeni yüklenen dosyanın ismi eskisinden farklı olabilir.
      await ghPutFile(yeniYol, base64, `Profil fotoğrafı eklendi (${yeniYol})`, null);
      if (eskiYol) {
        try {
          const eskiDosya = await ghGetContents(eskiYol);
          if (eskiDosya) {
            await ghDeleteFile(eskiYol, eskiDosya.sha, `Eski profil fotoğrafı kaldırıldı (${eskiYol})`);
          }
        } catch (e) {
          // Eski dosya silinemedi (ör. zaten yoktu); kritik değil, devam et.
        }
      }
      await configProfilYoluGuncelle(yeniYol);
    }

    showMessage(msgEl, "İşlem başarıyla GitHub'a iletildi, 1-2 dakika içinde sitede güncellenecektir.", "success");
    dosyaInput.value = "";
    await panelListeleriniTazele();
    profilFotoDurumYukle();
  } catch (err) {
    showMessage(msgEl, `Yüklenemedi: ${err.message}`, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Yükle / Değiştir";
  }
}

async function profilFotoSil() {
  const msgEl = document.getElementById("pf-message");
  if (GIRIS_YAPAN_PROFIL?.role !== "admin" && GIRIS_YAPAN_PROFIL?.role !== "owner") {
    showMessage(msgEl, "Bu işlem için yetkin yok — profil fotoğrafını sadece admin silebilir.", "error");
    return;
  }

  if (!GH_BAGLI) {
    showMessage(msgEl, 'Önce "GitHub Bağlantısı" sekmesinden bağlantını doğrula.', "error");
    return;
  }
  if (!PROFIL_YOLU || !PROFIL_SHA) {
    showMessage(msgEl, "Silinecek bir profil fotoğrafı yok.", "error");
    return;
  }
  if (!confirm(`"${PROFIL_YOLU}" dosyasını silmek istediğine emin misin?`)) return;

  const btn = document.getElementById("pf-sil-btn");
  btn.disabled = true;
  try {
    await ghDeleteFile(PROFIL_YOLU, PROFIL_SHA, `Profil fotoğrafı silindi (${PROFIL_YOLU})`);
    try {
      await configProfilYoluTemizle();
    } catch (e) {
      // _config.yml temizlenemedi; dosya yine de silindi, kritik değil.
    }
    showMessage(msgEl, "İşlem başarıyla GitHub'a iletildi, 1-2 dakika içinde sitede güncellenecektir.", "success");
    await panelListeleriniTazele();
    profilFotoDurumYukle();
  } catch (err) {
    showMessage(msgEl, `Silinemedi: ${err.message}`, "error");
  } finally {
    btn.disabled = false;
  }
}

init();

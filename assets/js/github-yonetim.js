/*
 * assets/js/github-yonetim.js — /panel/github-yonetim.html
 *
 * Jekyll/GitHub Pages için, 3. parti bir servise (Netlify vb.) ihtiyaç
 * duymadan çalışan tek sayfalık bir "mini CMS". Doğrudan GitHub REST
 * API'sine (repos/{owner}/{repo}/contents/{path}) istek atarak _posts/ ve
 * _projects/ klasörlerine commit atar, assets/profil.jpg dosyasını yönetir.
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
 * requireAuth({ role: 'editor' }) ile giriliyor (bkz. auth-guard.js) — bu,
 * hem role='editor' HEM role='admin' olan kullanıcıların girebilmesi
 * anlamına gelir (auth-guard.js'te "admin her zaman geçer" kuralı zaten
 * var, ayrıca bir değişiklik gerekmedi). role='user'/'special_user' olanlar
 * hâlâ giremez. Taslak tablosunun RLS politikası da bunu veritabanı
 * seviyesinde ayrıca zorunlu kılıyor — ama editor sadece KENDİ taslaklarını
 * ekleyip/düzenleyip/silebilir, admin hepsini yönetebilir (bkz. migration
 * 0014). Kullanıcı/rol yönetimi (panel/admin.md) HÂLÂ SADECE admin'e özel —
 * admin.js kendi requireAuth çağrısında role:'admin' istiyor, editor oraya
 * giremez (auth-guard.js otomatik olarak panel/panel.html'e yönlendirir).
 *
 * GÜVENLİK NOTU — GitHub Personal Access Token (PAT):
 *   Token SADECE bu modülün belleğinde (PAT_BELLEK değişkeni) tutulur.
 *   localStorage/sessionStorage'a KASITLI OLARAK yazılmıyor — sayfa
 *   yenilendiğinde veya sekme kapatıldığında token kaybolur, bir dahaki
 *   girişte yeniden yapıştırman gerekir. Bu, kullanışlılıktan ziyade
 *   güvenliği önceliklendiren bilinçli bir tercih: tarayıcı depolaması
 *   (özellikle localStorage) bir XSS açığında kalıcı olarak sızdırılabilir,
 *   bellekteki bir değişken ise sayfa hayatta olduğu sürece de risklidir
 *   ama en azından hiçbir yerde KALICI olarak durmaz. Buna karşın GitHub
 *   kullanıcı adı ve repo adı gizli bilgi olmadığından, kolaylık için
 *   localStorage'da hatırlanır (bkz. ghAyarlariniYukle).
 *
 *   Fine-grained bir PAT oluşturup SADECE bu repo için "Contents: Read and
 *   write" iznini vermen hem yeterli hem de tüm hesaba erişen "classic"
 *   bir token kullanmaktan çok daha güvenli.
 */
import { requireAuth } from "./auth-guard.js";
import { escapeHtml, showMessage, supabase } from "./supabase-client.js";

const GITHUB_API = "https://api.github.com";
// Profil fotoğrafının GERÇEK yolu artık sabit kodlanmıyor: her zaman
// _config.yml içindeki `profile_image` alanından okunur. Böylece dosya
// assets/profil.jpg, assets/profile.webp ya da başka bir isimle kayıtlı
// olsa da panel onu bulup gösterebilir/değiştirebilir/silebilir — çünkü
// sitenin favicon/profil resmi olarak GERÇEKTEN kullandığı dosya zaten
// bu alanla belirleniyor (bkz. _layouts/default.html). Bkz. aşağıdaki
// profilYapilandirmasiniOku().
const CONFIG_YOLU = "_config.yml";
let PROFIL_YOLU = null;

// Token SADECE bellekte — bkz. dosya başındaki güvenlik notu.
let PAT_BELLEK = "";

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

let PROFIL_SHA = null;

// Girişi yapan kullanıcının profili (id, full_name, email, role). Yazar
// alanının otomatik doldurulması/açılır listesi bu bilgiye göre kurulur
// (bkz. wireYazarAlani).
let GIRIS_YAPAN_PROFIL = null;

async function init() {
  const { profile } = await requireAuth({ role: "editor" });
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
/* ---------------------------------------------------------------------- */
function ghAyarlariniYukle() {
  const app = document.getElementById("app");
  document.getElementById("gh-owner").value =
    localStorage.getItem("gy_owner") || app.dataset.defaultOwner || "";
  document.getElementById("gh-repo").value =
    localStorage.getItem("gy_repo") || app.dataset.defaultRepo || "";
  document.getElementById("gh-branch").value = localStorage.getItem("gy_branch") || "";
}

function ghAyarlari() {
  return {
    owner: document.getElementById("gh-owner").value.trim(),
    repo: document.getElementById("gh-repo").value.trim(),
    branch: document.getElementById("gh-branch").value.trim(),
  };
}

/*
 * Token yapıştırılırken (özellikle GitHub'ın kendi token sayfasından,
 * bir not/PDF'ten ya da bir mesajlaşma uygulamasından kopyalanırken) araya
 * görünmez satır sonu, sekme veya "non-breaking space" gibi boşluk
 * karakterleri karışabiliyor; bazı arayüzler uzun token'ı ekranda iki
 * satıra sararak gösteriyor ve kopyalarken o satır sonu da kopyalanıyor.
 * GitHub token'ları hiçbir zaman boşluk İÇERMEDİĞİNDEN, sadece baştaki/
 * sondaki değil, ARADAKİ tüm boşluk karakterlerini de güvenle
 * kırpabiliyoruz. Ayrıca bir kod bloğundan/JSON'dan kopyalarken sıkça
 * birlikte gelen tırnak/backtick işaretlerini de temizliyoruz. Bu satırlar
 * eklenmeden önce, ortasında gizli bir satır sonu olan bir token GitHub'a
 * OLDUĞU GİBİ gönderiliyordu — bazen tarayıcı bunu geçersiz bir header
 * değeri olarak reddedip belirsiz bir "TypeError" fırlatıyordu, bazen de
 * (satır sonu sessizce yutulup iki parça birleşince) sunucuya YANLIŞ ama
 * biçimsel olarak geçerli bir token gidiyor ve GitHub bunu "401 Bad
 * credentials" ile reddediyordu — kullanıcı token'ın doğru olduğundan emin
 * olsa bile.
 */
function patTemizle(ham) {
  return (ham || "").replace(/\s+/g, "").replace(/^[`'"]+|[`'"]+$/g, "");
}

function wireBaglantiDogrula() {
  document.getElementById("gh-baglan-btn").addEventListener("click", async () => {
    const msgEl = document.getElementById("gh-baglanti-message");
    const { owner, repo, branch } = ghAyarlari();
    const patHam = document.getElementById("gh-pat").value;
    const pat = patTemizle(patHam);

    if (!owner || !repo || !pat) {
      showMessage(msgEl, "Kullanıcı adı, repo adı ve token gerekli.", "error");
      return;
    }
    // Temizleme bir şey değiştirdiyse (yani orijinalde gizli boşluk/tırnak
    // varmış), giriş alanını da güncelleyelim ki kullanıcı neyin
    // gönderildiğini görebilsin ve tekrar denediğinde aynı sorunu yaşamasın.
    if (pat !== patHam) document.getElementById("gh-pat").value = pat;

    PAT_BELLEK = pat;
    localStorage.setItem("gy_owner", owner);
    localStorage.setItem("gy_repo", repo);
    localStorage.setItem("gy_branch", branch);

    const btn = document.getElementById("gh-baglan-btn");
    btn.disabled = true;
    btn.textContent = "Kontrol ediliyor...";
    try {
      const res = await ghRequest("");
      if (!res.ok) {
        const temelMesaj = await ghHataMesaji(res);
        if (res.status === 401) {
          throw new Error(
            `${temelMesaj} — GitHub token'ı reddetti. Kontrol et: (1) token süresi dolmuş ya da elle/GitHub tarafından ` +
              `iptal edilmiş olabilir, yeni bir tane oluşturmayı dene; (2) fine-grained token oluşturuken "Resource owner" ` +
              `olarak "${escapeHtml(owner)}" seçilip erişime "${escapeHtml(repo)}" reposu eklenmiş mi; (3) hesap bir ` +
              `organizasyona bağlıysa, organizasyon fine-grained token'lara onay vermiş mi (Settings → Personal access ` +
              `tokens). Kopyalarken araya karışmış boşluk/satır sonu artık otomatik temizleniyor, yine de token'ı GitHub'da ` +
              `tekrar kopyalayıp deneyebilirsin.`
          );
        }
        throw new Error(temelMesaj);
      }
      const repoData = await res.json();
      const yazmaYetkisi = repoData.permissions?.push;
      showMessage(
        msgEl,
        `Bağlantı doğrulandı — "${repoData.full_name}" (varsayılan branch: ${repoData.default_branch})` +
          (yazmaYetkisi ? "" : " — UYARI: bu token ile yazma izniniz yok gibi görünüyor."),
        yazmaYetkisi ? "success" : "error"
      );
      await profilFotoDurumYukle();
      await icerikFormuKlasorSecimGuncelle();
    } catch (err) {
      PAT_BELLEK = "";
      showMessage(msgEl, `Bağlantı doğrulanamadı: ${err.message}`, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Bağlantıyı Doğrula";
    }
  });
}

/* ---------------------------------------------------------------------- */
/* GITHUB REST API YARDIMCILARI                                           */
/* ---------------------------------------------------------------------- */
function encodePath(yol) {
  return yol.split("/").map(encodeURIComponent).join("/");
}

async function ghRequest(path, options = {}) {
  if (!PAT_BELLEK) throw new Error("Önce GitHub bağlantısını doğrula (PAT gerekli).");
  const { owner, repo } = ghAyarlari();
  if (!owner || !repo) throw new Error("GitHub kullanıcı adı ve repo adı gerekli.");
  return fetch(`${GITHUB_API}/repos/${owner}/${repo}${path}`, {
    ...options,
    // ÖNEMLİ — "cache: no-store" OLMADAN tarayıcı, GitHub'ın Contents API
    // yanıtlarını (aynı URL'ye tekrar istek atıldığında) kendi HTTP
    // önbelleğinden döndürebiliyordu. Bu panel bir "canlı" içerik yönetim
    // aracı olduğundan bu YIKICI bir sorundu: örn. bir klasör oluşturduktan
    // hemen sonra listeyi tazelemek eski (klasörün henüz olmadığı) veriyi
    // gösteriyordu; bir yazı sildikten sonra listeyi tazelemek dosyayı hâlâ
    // orada gösterip tek tek okurken "okunamadı" hatası veriyordu (çünkü
    // klasör listesi önbellekten geliyordu ama tekil dosya isteği gerçek
    // GitHub'a gidip 404 dönüyordu); bir klasörün gerçekten boş olup
    // olmadığı (silme butonunun aktif olup olmayacağı) da eski veriyle
    // hesaplanabiliyordu. "no-store" ile HER istek doğrudan ağa gider,
    // hiçbir ara katmanda önbelleklenmez.
    cache: "no-store",
    headers: {
      Authorization: `token ${PAT_BELLEK}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {}),
    },
  });
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
  const yardimEl = document.getElementById("ic-yayin-secenek-yardim");
  if (!btn) return;
  const yayinda = document.getElementById("ic-yayinda")?.checked;

  // "Seçenek B" (Supabase'e Kaydet ve GitHub ile Yayınla) butonu SADECE
  // "Yayında" açıkken anlamlıdır — kapalıyken zaten mevcut "Nerede
  // saklansın?" (Supabase/GitHub) seçimi bu ayrımı yapıyor.
  if (btnB) btnB.hidden = !yayinda;
  if (yardimEl) yardimEl.hidden = !yayinda;

  if (duzenlemeModuMu()) {
    btn.textContent = yayinda ? "🅰️ Güncelle ve Doğrudan Yayınla" : "Güncelle";
    if (btnB) btnB.textContent = "🅱️ Güncelle (Supabase Yedekli)";
    return;
  }
  if (yayinda) {
    btn.textContent = "🅰️ Doğrudan GitHub'a Aktar ve Yayınla";
    if (btnB) btnB.textContent = "🅱️ Supabase'e Kaydet ve GitHub ile Yayınla";
  } else if (gizliHedefDegeriniAl() === "github") {
    btn.textContent = "GitHub'a Gizli Commit Et";
  } else {
    btn.textContent = "Taslağı Kaydet (Gizli)";
  }
}

/* ---------------------------------------------------------------------- */
/* YAZAR ALANI — admin başka bir editör/admin adına yazabilir, editor      */
/* sadece kendi adına yazabilir (salt okunur alan)                        */
/* ---------------------------------------------------------------------- */
async function wireYazarAlani() {
  const secim = document.getElementById("ic-yazar-secim");
  const girdi = document.getElementById("ic-yazar-adi");
  if (!secim || !girdi || !GIRIS_YAPAN_PROFIL) return;

  const kendiAdi = GIRIS_YAPAN_PROFIL.full_name || GIRIS_YAPAN_PROFIL.email || "";

  if (GIRIS_YAPAN_PROFIL.role !== "admin") {
    // editor: kendi adı dışında bir şey seçemez, alan salt okunur.
    secim.hidden = true;
    girdi.hidden = false;
    girdi.value = kendiAdi;
    girdi.readOnly = true;
    return;
  }

  // admin: içerik yönetebilen herkes (admin + editor) arasından yazar seçebilir.
  girdi.hidden = true;
  secim.hidden = false;
  secim.innerHTML = '<option value="">Yükleniyor…</option>';
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, email, role")
      .in("role", ["admin", "editor"])
      .order("full_name", { ascending: true });
    if (error) throw error;

    secim.innerHTML = (data || [])
      .map((p) => {
        const ad = p.full_name || p.email;
        return `<option value="${p.id}" data-ad="${escapeHtml(ad)}">${escapeHtml(ad)} (${p.role === "admin" ? "Yönetici" : "Editör"})</option>`;
      })
      .join("");

    // Varsayılan: giriş yapan admin'in kendisi.
    if (GIRIS_YAPAN_PROFIL.id) secim.value = GIRIS_YAPAN_PROFIL.id;
    if (!secim.value && secim.options.length > 0) secim.selectedIndex = 0;
  } catch (err) {
    console.error("Yazar listesi yüklenemedi:", err);
    secim.innerHTML = `<option value="${GIRIS_YAPAN_PROFIL.id || ""}">${escapeHtml(kendiAdi)}</option>`;
  }
}

/** Formda o an seçili/girilmiş yazar bilgisini { id, ad } olarak döner. */
function yazarBilgisiniAl() {
  const secim = document.getElementById("ic-yazar-secim");
  const girdi = document.getElementById("ic-yazar-adi");
  if (secim && !secim.hidden) {
    const secili = secim.selectedOptions?.[0];
    return { id: secim.value || null, ad: secili?.dataset.ad || secili?.textContent || "" };
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
  if (!secim || !PAT_BELLEK) return;
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

/** Verilen kök koleksiyon klasörünün ("_posts" ya da "_projects") altındaki alt klasörlerin adlarını döner. */
async function koleksiyonKlasorleriniListele(kokKlasor) {
  const kokIcerik = await ghGetContents(kokKlasor).catch(() => []);
  if (!Array.isArray(kokIcerik)) return [];
  return kokIcerik.filter((f) => f.type === "dir").map((f) => f.name);
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

  yenileBtn.addEventListener("click", () => klasorListesiYukle());
  olusturBtn.addEventListener("click", () => klasorOlustur());
  yeniAdInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      klasorOlustur();
    }
  });

  wireKlasorSecici();
  // "Klasörler" sekmesine her tıklandığında (bağlantı doğrulanmışsa) listeyi tazele.
  document.querySelector('#gy-nav a[data-section="klasorler"]')?.addEventListener("click", () => {
    if (PAT_BELLEK) klasorListesiYukle();
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
    await ghPutFile(`${kokKlasor}/${ad}/.gitkeep`, b64Encode(GITKEEP_ICERIK), `Klasör oluşturuldu: ${kokKlasor}/${ad}/`);
    input.value = "";
    showMessage(msgEl, `"${kokKlasor}/${ad}/" klasörü oluşturuldu.`, "success");
    await klasorListesiYukle();
    await icerikFormuKlasorSecimGuncelle();
  } catch (err) {
    showMessage(msgEl, `Hata: ${err.message}`, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "➕ Klasör Oluştur";
  }
}

async function klasorListesiYukle() {
  const el = document.getElementById("kl-liste");
  if (!el) return;
  const kokKlasor = kokKlasorAdi(KLASOR_SEKME_TUR);
  if (!PAT_BELLEK) {
    el.innerHTML = '<p class="muted">Önce "GitHub Bağlantısı" sekmesinden bağlantını doğrula.</p>';
    return;
  }
  el.innerHTML = '<p class="muted">Yükleniyor...</p>';
  try {
    const kokIcerik = await ghGetContents(kokKlasor).catch(() => []);
    const altKlasorler = (kokIcerik || []).filter((f) => f.type === "dir");

    if (altKlasorler.length === 0) {
      el.innerHTML = '<p class="muted">Henüz hiç alt klasör yok.</p>';
      return;
    }

    // Her klasörün içindeki dosya sayısını (.gitkeep hariç) ayrıca çekmek
    // gerekiyor, aksi halde "silinebilir mi" bilgisini gösteremeyiz.
    const detaylar = await Promise.all(
      altKlasorler.map(async (klasor) => {
        const icerik = await ghGetContents(klasor.path).catch(() => []);
        const dosyalar = (icerik || []).filter((f) => f.type === "file" && f.name !== ".gitkeep");
        return { ad: klasor.name, path: klasor.path, dosyaSayisi: dosyalar.length, kokKlasor };
      })
    );

    detaylar.sort((a, b) => b.ad.localeCompare(a.ad));

    el.innerHTML = "";
    detaylar.forEach((k) => el.appendChild(klasorKartiCiz(k)));
  } catch (err) {
    el.innerHTML = `<p class="muted">Klasörler yüklenemedi: ${escapeHtml(err.message)}</p>`;
  }
}

function klasorKartiCiz(k) {
  const kart = document.createElement("div");
  kart.className = "gy-klasor-kart";
  const silDevreDisi = k.dosyaSayisi > 0;
  kart.innerHTML = `
    <div class="gy-klasor-kart-bilgi">
      <div class="gy-klasor-kart-baslik">📁 ${escapeHtml(k.kokKlasor)}/${escapeHtml(k.ad)}/</div>
      <div class="gy-klasor-kart-meta">${k.dosyaSayisi} ${k.kokKlasor === "_projects" ? "proje" : "yazı"}</div>
    </div>
    <div class="gy-klasor-kart-aksiyonlar">
      <button type="button" class="gy-klasor-yenidenadlandir-btn">Yeniden Adlandır</button>
      <button type="button" class="gy-klasor-sil-btn" ${silDevreDisi ? "disabled" : ""} title="${
    silDevreDisi ? "Önce içindeki dosyaları başka bir klasöre taşı ya da sil" : ""
  }">Sil</button>
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
    await klasorListesiYukle();
    await icerikFormuKlasorSecimGuncelle();
    await icerikListesiYukle();
  } catch (err) {
    showMessage(
      msgEl,
      `Hata: ${err.message} — işlem yarıda kalmış olabilir, listeyi yenileyip ${k.kokKlasor}/${k.ad}/ ve ${k.kokKlasor}/${yeniAd}/ klasörlerini GitHub'dan kontrol et.`,
      "error"
    );
  }
}

/** Sadece .gitkeep içeren (yani gerçekte BOŞ olan) bir klasörü siler. Doluysa buton zaten devre dışı bırakılmıştır ama yine de burada da kontrol edilir. */
async function klasorSil(k) {
  const msgEl = document.getElementById("kl-message");
  msgEl.hidden = true;
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
    await klasorListesiYukle();
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
  satirlar.push(fmSatiri("date", alan.date, true));

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

/** Bir dosya silindikten sonra klasörde başka hiç gerçek dosya kalmadıysa, klasörü korumak için .gitkeep geri ekler. */
async function klasorBosaldiysaGitkeepEkle(klasorYolu) {
  try {
    const icerik = await ghGetContents(klasorYolu);
    const gercekVarMi = Array.isArray(icerik) && icerik.some((f) => f.type === "file" && f.name !== ".gitkeep");
    if (!gercekVarMi) {
      const zatenVarMi = Array.isArray(icerik) && icerik.some((f) => f.name === ".gitkeep");
      if (!zatenVarMi) {
        await ghPutFile(`${klasorYolu}/.gitkeep`, b64Encode(GITKEEP_ICERIK), `Klasör boşaldı, .gitkeep geri eklendi: ${klasorYolu}/`);
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
 * assets/js/onizleme.js tarafından okunup Supabase'teki
 * `taslak_onizleme_getir` RPC'sine sorulur (bkz. migration 0013).
 */
/** Formda o an seçili olan "yayında değilken nerede saklansın" hedefini döner: "supabase" | "github". */
function gizliHedefDegeriniAl() {
  return document.querySelector('input[name="gizli-hedef"]:checked')?.value || "supabase";
}

/**
 * Ön izleme linkinin öneki, seçilen hedefe göre TAMAMEN farklıdır:
 *  - "supabase": /onizleme/?tur=...&kod=... — assets/js/onizleme.js
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
  document.getElementById("ic-iptal-btn").addEventListener("click", duzenlemeyiIptalEt);
}

function duzenlemeyiKapat() {
  DUZENLENEN_YOL = null;
  DUZENLENEN_SHA = null;
  DUZENLENEN_TASLAK_ID = null;
  DUZENLENEN_GIZLI_KOD = null;
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
}

async function icerikKaydet(secenek = "a") {
  const msgEl = document.getElementById("ic-message");
  const submitBtn = secenek === "b" ? document.getElementById("ic-submit-b-btn") : document.getElementById("ic-submit-btn");
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

  const slugGirdi = document.getElementById("ic-slug").value.trim();
  const slug = slugOlustur(slugGirdi || title);
  if (!slug) {
    showMessage(msgEl, "Geçerli bir dosya adı/slug üretilemedi, başlığı kontrol et.", "error");
    return;
  }

  const yayinda = document.getElementById("ic-yayinda").checked;
  const yilOneki = tur === "proje" && document.getElementById("ic-yil-oneki").checked;
  const klasor = klasorSecimDegeriniAl();

  const alan = { title, date, author: yazar.ad, yazarId: yazar.id };
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

  const digerBtn = secenek === "b" ? document.getElementById("ic-submit-btn") : document.getElementById("ic-submit-b-btn");
  submitBtn.disabled = true;
  if (digerBtn) digerBtn.disabled = true;
  const oncekiMetin = submitBtn.textContent;
  submitBtn.textContent = "Gönderiliyor...";
  try {
    if (yayinda && secenek === "b") {
      // Seçenek B: içerik hem Supabase'te (yedek/arama kaydı) kalıcı
      // olarak tutulur hem de GitHub'a commit edilir.
      await icerikSupabaseVeGithubaYaz(tur, alan, gizliKod, govde, slug, dosyaYolu, msgEl);
    } else if (yayinda) {
      // Seçenek A (varsayılan/mevcut davranış): Supabase'e hiç dokunmadan
      // doğrudan GitHub'a commit edilir.
      await icerikGitHubaYaz(tur, alan, gizliKod, govde, dosyaYolu, msgEl);
    } else if (gizliHedefDegeriniAl() === "github") {
      await icerikGitHubaGizliYaz(tur, alan, gizliKod, govde, dosyaYolu, msgEl);
    } else {
      await icerikSupabaseeYaz(tur, alan, gizliKod, govde, slug, dosyaYolu, msgEl);
    }
    await icerikListesiYukle();
  } catch (err) {
    showMessage(msgEl, `Hata: ${err.message}`, "error");
    submitBtn.textContent = oncekiMetin;
  } finally {
    submitBtn.disabled = false;
    if (digerBtn) digerBtn.disabled = false;
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

function wireIcerikListe() {
  document.getElementById("ic-liste-yenile-btn").addEventListener("click", icerikListesiYukle);

  const aramaEl = document.getElementById("ic-liste-arama");
  const temizleBtn = document.getElementById("ic-liste-arama-temizle");
  aramaEl.addEventListener("input", () => {
    LISTE_ARAMA = aramaEl.value.trim().toLocaleLowerCase("tr");
    temizleBtn.hidden = aramaEl.value === "";
    listeyiYenidenCiz();
  });
  temizleBtn.addEventListener("click", () => {
    aramaEl.value = "";
    LISTE_ARAMA = "";
    temizleBtn.hidden = true;
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
      yayinda: false,
      onizleme_kod: row.onizleme_kod,
      slug: row.slug,
      dosya_yolu: row.dosya_yolu,
      yazar_adi: row.yazar_adi,
      yayin_durumu: row.yayin_durumu,
    },
    body: row.govde || "",
  };
}

async function icerikListesiYukle() {
  const el = document.getElementById("ic-liste");
  if (!PAT_BELLEK) {
    el.innerHTML = '<p class="muted">Önce "GitHub Bağlantısı" sekmesinden bağlantını doğrula.</p>';
    return;
  }

  el.innerHTML = '<p class="muted">Yükleniyor...</p>';
  try {
    const [postDosyalari, projeDosyalari] = await Promise.all([
      koleksiyonDosyalariniListele("_posts"),
      koleksiyonDosyalariniListele("_projects"),
    ]);

    // Promise.allSettled: tek bir dosyanın okunması başarısız olursa
    // (silinmiş, geçici ağ hatası, vb.) diğer tüm liste elemanlarını
    // düşürmeden devam eder — sadece o öğe "okunamadı" olarak işaretlenir.
    const [postDetaylari, projeDetaylari] = await Promise.all([
      icerikOzetleriGuvenliGetir(postDosyalari, "blog"),
      icerikOzetleriGuvenliGetir(projeDosyalari, "proje"),
    ]);
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
    listeyiYenidenCiz();
  } catch (err) {
    el.innerHTML = `<p class="muted">Liste yüklenemedi: ${escapeHtml(err.message)}</p>`;
  }
}

/**
 * Bir dosya listesindeki her dosyanın front-matter özetini getirir.
 * Promise.allSettled kullanır: tek bir dosyanın okunması (silinmiş,
 * geçici ağ hatası vb. yüzünden) başarısız olsa bile diğer dosyalar
 * etkilenmez — başarısız olan öğe "okunamadı" rozetiyle listede kalır.
 */
async function icerikOzetleriGuvenliGetir(dosyalar, tur) {
  const sonuclar = await Promise.allSettled(dosyalar.map((f) => icerikOzetiGetir(f, tur)));
  return sonuclar.map((sonuc, i) => {
    if (sonuc.status === "fulfilled") return sonuc.value;
    const dosya = dosyalar[i];
    return {
      path: dosya.path,
      sha: dosya.sha,
      tur,
      data: { title: `${dosya.name} (okunamadı: ${sonuc.reason?.message || "bilinmeyen hata"})` },
      body: "",
      okunamadi: true,
    };
  });
}

async function icerikOzetiGetir(dosya, tur) {
  const detay = await ghGetContents(dosya.path);
  if (!detay || typeof detay.content !== "string") {
    // Beklenmedik durum: dosya listede vardı ama tekil GET'te içerik
    // dönmedi (silinmiş/taşınmış olabilir, ya da GitHub API'nin o an
    // "content" alanını atladığı nadir bir durum). Tüm listeyi
    // düşürmek yerine bu öğeyi "okunamadı" olarak işaretleyip devam ediyoruz.
    return {
      path: dosya.path,
      sha: dosya.sha,
      tur,
      data: { title: `${dosya.name} (okunamadı)` },
      body: "",
      okunamadi: true,
    };
  }
  const ham = b64Decode(detay.content.replace(/\n/g, ""));
  const { data, body } = frontMatterOku(ham);
  return { path: dosya.path, sha: detay.sha, tur, data, body };
}

/** Bir içerik öğesinin arama kutusu, tür sekmesi ve durum sekmesiyle eşleşip eşleşmediğini kontrol eder. */
function icerikFiltreyeUyuyorMu(item) {
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

  liste.forEach((item) => wrap.appendChild(icerikKartiCiz(item, tur)));
  return wrap;
}

function icerikKartiCiz(item, tur) {
  const kart = document.createElement("div");
  kart.className = "gy-icerik-kart";

  if (item.okunamadi) {
    // Dosya içeriği okunamadı (silinmiş/ağ hatası) — sadece dosya yolunu
    // ve "Sil" seçeneğini gösteriyoruz; "Düzenle" anlamsız olur çünkü
    // form doldurulacak içerik/başlık verisi yok.
    kart.innerHTML = `
      <div class="gy-icerik-kart-bilgi">
        <div class="gy-icerik-kart-baslik">${metniVurgula(item.data.title)}<span class="gy-rozet gy-rozet--gizli">Hata</span></div>
        <div class="gy-icerik-kart-meta">${metniVurgula(item.path)}</div>
      </div>
      <div class="gy-icerik-kart-aksiyonlar">
        <button type="button" class="gy-sil-btn">Sil</button>
      </div>
    `;
    kart.querySelector(".gy-sil-btn").addEventListener("click", () => icerikSil(item));
    return kart;
  }

  const yayinda = item.data.yayinda !== false; // alan hiç yoksa yayında sayılır
  const rozet = yayinda
    ? '<span class="gy-rozet gy-rozet--yayinda">Yayında</span>'
    : '<span class="gy-rozet gy-rozet--gizli">Gizli</span>';
  const kaynakRozet =
    item.kaynak === "supabase"
      ? `<span class="gy-rozet gy-rozet--gizli" title="Bu içerik GitHub'a hiç commit edilmedi, sadece Supabase'te duruyor.">Supabase</span>`
      : !yayinda
      ? `<span class="gy-rozet gy-rozet--gizli" title="Bu içerik &quot;yayinda: false&quot; olarak GitHub'a commit edilmiş durumda (eski yöntem) — reponun git geçmişinde duruyor, sadece linki paylaşılmadığı sürece gizli.">GitHub (gizli commit)</span>`
      : "";
  const supabaseYedekRozet = item.supabaseYedek
    ? `<span class="gy-rozet gy-rozet--gizli" title="Bu içeriğin GitHub'daki hâlinin yanında Supabase'te de bir yedek/arama kaydı var (Seçenek B ile yayınlandı).">🗄️ Supabase yedeği</span>`
    : "";
  const ozet = item.data.summary
    ? `<div class="gy-icerik-kart-ozet">${metniVurgula(item.data.summary)}</div>`
    : "";
  const yazarSatiri = item.data.yazar_adi
    ? `<span class="gy-icerik-kart-yazar"> · ✍️ ${metniVurgula(item.data.yazar_adi)}</span>`
    : "";

  // Gizliyken doğrudan gösterilecek ön izleme linki; yayındaysa da daha
  // önce üretilmiş bir kod varsa (bkz. icerikGizliKoduBul / onizleme_kod
  // alanı) "Linki Kopyala" ile hızlıca erişilebilsin diye kart üstünde
  // hazır tutulur (link'e tıklamadan/formu açmadan görünmez ama buton
  // panoya kopyalar).
  const gizliKod = icerikGizliKoduBul(item.data);
  const onizlemeLink = gizliKod ? `${location.origin}/onizleme/?tur=${tur}&kod=${encodeURIComponent(gizliKod)}` : null;

  // Hızlı yayın-durumu aksiyonu:
  //  - Supabase'teki bir taslaksa: "Yayınla" (GitHub'a commit eder, taslak satırı silinir).
  //  - GitHub'da yayındaysa: "Yayından Kaldır" (Supabase'e taşır, GitHub dosyası silinir).
  //  - GitHub'da ama "gizli" (eski sistemden kalma, bkz. dosya başındaki not): "Supabase'e Taşı"
  //    (aynı işlemi yapar — GitHub'daki dosya artık bu yeni sistemde bulunmaması gereken bir
  //    yerde durduğu için Supabase'e taşınır).
  let durumBtn;
  if (item.kaynak === "supabase") {
    durumBtn = '<button type="button" class="gy-durum-degistir-btn gy-durum-degistir-btn--yayinla" data-hedef="yayinla">Yayınla</button>';
  } else if (yayinda) {
    durumBtn = '<button type="button" class="gy-durum-degistir-btn" data-hedef="gizle">Yayından Kaldır</button>';
  } else {
    durumBtn = '<button type="button" class="gy-durum-degistir-btn gy-durum-degistir-btn--yayinla" data-hedef="tasi">Supabase\'e Taşı</button>';
  }
  const linkBtn = onizlemeLink
    ? `<button type="button" class="gy-link-kopyala-mini-btn" title="${escapeHtml(onizlemeLink)}">🔗 Linki Kopyala</button>`
    : "";

  const yolGoster = item.kaynak === "supabase" ? item.data.dosya_yolu || "(henüz GitHub'a commit edilmedi)" : item.path;

  kart.innerHTML = `
    <div class="gy-icerik-kart-bilgi">
      <div class="gy-icerik-kart-baslik">${metniVurgula(item.data.title || yolGoster)}${rozet}${kaynakRozet}${supabaseYedekRozet}</div>
      <div class="gy-icerik-kart-meta">${escapeHtml(item.data.date || "")} · ${metniVurgula(yolGoster)}${yazarSatiri}</div>
      ${ozet}
    </div>
    <div class="gy-icerik-kart-aksiyonlar">
      ${durumBtn}
      ${linkBtn}
      <button type="button" class="gy-duzenle-btn">Düzenle</button>
      <button type="button" class="gy-sil-btn">Sil</button>
    </div>
  `;
  kart.querySelector(".gy-duzenle-btn").addEventListener("click", () => icerikDuzenlemeyeYukle(item, tur));
  kart.querySelector(".gy-sil-btn").addEventListener("click", () => icerikSil(item));
  kart.querySelector(".gy-durum-degistir-btn").addEventListener("click", (e) => {
    if (item.kaynak === "supabase") {
      taslagiYayinla(item, tur, e.currentTarget);
    } else {
      gitDenTaslagaTasi(item, tur, e.currentTarget);
    }
  });
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
async function taslagiYayinla(item, tur, btn) {
  if (!confirm(`"${item.data.title || item.data.dosya_yolu}" GitHub'a yayınlansın mı?`)) return;

  btn.disabled = true;
  const oncekiMetin = btn.textContent;
  btn.textContent = "İşleniyor...";
  try {
    const alan = { title: item.data.title, date: item.data.date };
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

    const { error } = await supabase.from("taslak_icerikler").delete().eq("id", item.taslakId);
    if (error) console.error("Taslak satırı silinemedi (dosya GitHub'a başarıyla yayınlandı):", error);

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
    await icerikListesiYukle();
  } catch (err) {
    alert(`Silinemedi: ${err.message}`);
  }
}

async function icerikDuzenlemeyeYukle(item, tur) {
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

  // Yazar alanını içeriğin kayıtlı yazarına göre doldur (admin seçim
  // kutusundaysa ilgili seçeneği işaretler; editor için zaten salt okunur
  // ve her zaman kendi adını gösterir, bkz. wireYazarAlani).
  const yazarSecim = document.getElementById("ic-yazar-secim");
  if (yazarSecim && !yazarSecim.hidden && item.data.yazar_adi) {
    const eslesenSecenek = Array.from(yazarSecim.options).find((o) => o.dataset.ad === item.data.yazar_adi);
    if (eslesenSecenek) yazarSecim.value = eslesenSecenek.value;
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
/* ---------------------------------------------------------------------- */
function wireProfilFoto() {
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

async function profilFotoDurumYukle() {
  const el = document.getElementById("pf-mevcut");
  el.innerHTML = '<p class="muted">Yükleniyor...</p>';
  try {
    const { yol } = await profilYapilandirmasiniOku();
    PROFIL_YOLU = yol;
    if (!PROFIL_YOLU) {
      PROFIL_SHA = null;
      el.innerHTML = '<p class="muted">Şu anda bir profil fotoğrafı yok (yapılandırmada tanımlı değil).</p>';
      return;
    }
    const dosya = await ghGetContents(PROFIL_YOLU);
    if (!dosya) {
      PROFIL_SHA = null;
      el.innerHTML = `<p class="muted">Şu anda bir profil fotoğrafı yok (yapılandırmadaki <code>${escapeHtml(
        PROFIL_YOLU
      )}</code> dosyası repoda bulunamadı).</p>`;
      return;
    }
    PROFIL_SHA = dosya.sha;
    const src =
      dosya.download_url || `data:${profilMimeTuruTahminEt(PROFIL_YOLU)};base64,${dosya.content.replace(/\n/g, "")}`;
    el.innerHTML = `<img src="${src}" alt="Mevcut profil fotoğrafı"><span class="muted">Mevcut dosya: <code>${escapeHtml(
      PROFIL_YOLU
    )}</code> (sha: ${escapeHtml(dosya.sha.slice(0, 8))}...)</span>`;
  } catch (err) {
    el.innerHTML = `<p class="muted">Durum okunamadı: ${escapeHtml(err.message)}</p>`;
  }
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
  const dosyaInput = document.getElementById("pf-dosya");
  const dosya = dosyaInput.files[0];

  if (!dosya) {
    showMessage(msgEl, "Önce bir görsel seç.", "error");
    return;
  }
  if (!PAT_BELLEK) {
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
    await profilFotoDurumYukle();
  } catch (err) {
    showMessage(msgEl, `Yüklenemedi: ${err.message}`, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Yükle / Değiştir";
  }
}

async function profilFotoSil() {
  const msgEl = document.getElementById("pf-message");

  if (!PAT_BELLEK) {
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
    await profilFotoDurumYukle();
  } catch (err) {
    showMessage(msgEl, `Silinemedi: ${err.message}`, "error");
  } finally {
    btn.disabled = false;
  }
}

init();

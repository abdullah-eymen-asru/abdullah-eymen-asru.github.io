/*
 * assets/js/github-yonetim.js — /panel/github-yonetim.html
 *
 * Jekyll/GitHub Pages için, 3. parti bir servise (Netlify vb.) ihtiyaç
 * duymadan çalışan tek sayfalık bir "mini CMS". Doğrudan GitHub REST
 * API'sine (repos/{owner}/{repo}/contents/{path}) istek atarak _posts/ ve
 * _projects/ klasörlerine commit atar, assets/profil.jpg dosyasını yönetir.
 *
 * ÖNEMLİ — BU SAYFA SİTENİN SUPABASE TABANLI "ADMİN PANELİ"NDEN (panel/admin.md /
 * admin.js) TAMAMEN BAĞIMSIZDIR. O panel Supabase'teki kullanıcı/rol/özel
 * içerik sistemini yönetir; bu sayfa ise GitHub Pages'in kendi statik
 * Jekyll içeriğini (blog yazıları, akademik projeler, profil fotoğrafı)
 * yönetir. Aralarındaki TEK ortak nokta: bu sayfaya erişim de aynı
 * requireAuth({ role: 'admin' }) mekanizmasıyla (bkz. auth-guard.js),
 * yani sadece Supabase'te role='admin' olan kullanıcılar görebilir.
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
import { escapeHtml, showMessage } from "./supabase-client.js";

const GITHUB_API = "https://api.github.com";
const PROFIL_YOLU = "assets/profil.jpg";

// Token SADECE bellekte — bkz. dosya başındaki güvenlik notu.
let PAT_BELLEK = "";

// null: yeni içerik ekleniyor, doluysa mevcut bir dosya düzenleniyor.
let DUZENLENEN_YOL = null;
let DUZENLENEN_SHA = null;
// Düzenlenen içeriğin daha önce üretilmiş gizli ön izleme kodu (varsa).
// Formda "Yayında değil" seçiliyken tekrar kaydedilirse bu kod KORUNUR,
// böylece link değişmez. Yeni içerikte veya kod hiç üretilmemişse null.
let DUZENLENEN_GIZLI_KOD = null;

let PROFIL_SHA = null;

async function init() {
  await requireAuth({ role: "admin" });
  document.getElementById("loading")?.setAttribute("hidden", "");
  document.getElementById("app").hidden = false;

  // Diğer panellerdeki (panel.js, admin.js) aynı düzeltme: her adım
  // birbirinden bağımsız kuruluyor, biri hata verirse geri kalanı
  // etkilenmiyor.
  const adimlar = [
    ["ayarları yükle", () => ghAyarlariniYukle()],
    ["bölüm navigasyonu", () => wireSectionNav()],
    ["içerik türü", () => wireIcerikTuruToggle()],
    ["editör araç çubuğu", () => wireEditorToolbar()],
    ["bağlantı doğrulama", () => wireBaglantiDogrula()],
    ["içerik formu", () => wireIcerikForm()],
    ["canlı önizleme", () => wireYayindaCanliOnizleme()],
    ["içerik listesi", () => wireIcerikListe()],
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

function wireBaglantiDogrula() {
  document.getElementById("gh-baglan-btn").addEventListener("click", async () => {
    const msgEl = document.getElementById("gh-baglanti-message");
    const { owner, repo, branch } = ghAyarlari();
    const pat = document.getElementById("gh-pat").value.trim();

    if (!owner || !repo || !pat) {
      showMessage(msgEl, "Kullanıcı adı, repo adı ve token gerekli.", "error");
      return;
    }

    PAT_BELLEK = pat;
    localStorage.setItem("gy_owner", owner);
    localStorage.setItem("gy_repo", repo);
    localStorage.setItem("gy_branch", branch);

    const btn = document.getElementById("gh-baglan-btn");
    btn.disabled = true;
    btn.textContent = "Kontrol ediliyor...";
    try {
      const res = await ghRequest("");
      if (!res.ok) throw new Error(await ghHataMesaji(res));
      const repoData = await res.json();
      const yazmaYetkisi = repoData.permissions?.push;
      showMessage(
        msgEl,
        `Bağlantı doğrulandı — "${repoData.full_name}" (varsayılan branch: ${repoData.default_branch})` +
          (yazmaYetkisi ? "" : " — UYARI: bu token ile yazma izniniz yok gibi görünüyor."),
        yazmaYetkisi ? "success" : "error"
      );
      await profilFotoDurumYukle();
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

function guncelleIcerikTuru() {
  const proje = icerikTuru() === "proje";
  document.getElementById("ic-proje-alanlar").hidden = !proje;
  document.getElementById("ic-yil-oneki-wrap").hidden = !proje;
  document.getElementById("ic-form-baslik").textContent = DUZENLENEN_YOL
    ? proje
      ? "Akademik Projeyi Düzenle"
      : "Blog Yazısını Düzenle"
    : proje
    ? "Yeni Akademik Proje Ekle"
    : "Yeni Blog Yazısı Ekle";
}

/* ---------------------------------------------------------------------- */
/* HAFİF MARKDOWN EDİTÖR ARAÇ ÇUBUĞU                                      */
/* ---------------------------------------------------------------------- */
function wireEditorToolbar() {
  document.querySelectorAll(".gy-editor-toolbar button").forEach((btn) => {
    btn.addEventListener("click", () => markdownUygula(btn.dataset.md));
  });
}

function markdownUygula(tur) {
  const ta = document.getElementById("ic-body");
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const secili = ta.value.slice(start, end);
  let yeni;

  switch (tur) {
    case "bold":
      yeni = `**${secili || "kalın metin"}**`;
      break;
    case "italic":
      yeni = `*${secili || "italik metin"}*`;
      break;
    case "h2":
      yeni = `\n## ${secili || "Başlık"}\n`;
      break;
    case "list":
      yeni = (secili || "liste maddesi")
        .split("\n")
        .map((s) => `- ${s}`)
        .join("\n");
      break;
    case "link": {
      const url = window.prompt("Bağlantı URL'si:", "https://");
      if (!url) return;
      yeni = `[${secili || "bağlantı metni"}](${url})`;
      break;
    }
    default:
      return;
  }

  ta.focus();
  ta.setRangeText(yeni, start, end, "end");
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
 * Front matter + gövdeden tam Markdown dosya içeriğini üretir.
 * "Yayında" işaretliyse: yayinda:true, sitemap:true, permalink YOK.
 * İşaretli değilse: yayinda:false, sitemap:false + gizli ön izleme permalink'i.
 *
 * gizliKod, çağıran taraftan (icerikKaydet) gelir: içerik ilk kez "yayında
 * değil" olarak kaydediliyorsa yeni üretilir, daha önce zaten bir ön izleme
 * kodu varsa (düzenleme sırasında) AYNI kod korunur — böylece link, panelde
 * her açılışta/düzenlemede DEĞİŞMEZ ve daha önce paylaşılmış olabilecek bir
 * link kırılmaz. Kod yalnızca kullanıcı bilerek yenilerse değişir.
 *
 * ÖNEMLİ — "onizleme_kod" alanı (yeniden yayınlama / re-publish desteği):
 * Kod, sadece "yayında: false" iken var olan `permalink` alanından değil,
 * AYRICA gizli bir `onizleme_kod` alanından da yazılır — bu alan içerik
 * "Yayında" (true) olsa BİLE dosyada kalır. Böylece bir yazı önce gizli
 * paylaşılıp linki birine gönderilir, sonra yayına alınır, sonra bir
 * sebeple TEKRAR "yayında değil"e çekilirse ("yeniden yayından kaldırma")
 * daha önce paylaşılmış olan AYNI ön izleme linki geri döner — yeni/farklı
 * bir kod üretilmez. Kod yalnızca kullanıcı "🎲 Yenile" ile bilerek
 * değiştirirse ya da bu içerik için hiç kod üretilmemişse değişir.
 */
function dosyaIcerigiOlustur(tur, alan, yayinda, gizliKod, govde) {
  const satirlar = ["---"];
  satirlar.push(fmSatiri("title", alan.title));
  satirlar.push(fmSatiri("date", alan.date, true));

  if (tur === "proje") {
    satirlar.push(fmSatiri("venue", alan.venue));
    satirlar.push(fmSatiri("status", alan.status));
    satirlar.push(fmSatiri("summary", alan.summary));
    satirlar.push(fmSatiri("link", alan.link));
    satirlar.push(fmSatiri("link_label", alan.link_label));
  }

  satirlar.push(fmSatiri("yayinda", yayinda, true));
  satirlar.push(fmSatiri("sitemap", yayinda, true));

  if (!yayinda) {
    const onEk = tur === "proje" ? "/projects/" : "/blog/";
    satirlar.push(fmSatiri("permalink", `${onEk}on-izleme-${gizliKod}/`, true));
  }
  // Kod, yayın durumundan bağımsız olarak her zaman ayrıca saklanır (bkz.
  // yukarıdaki fonksiyon açıklaması). Sadece front-matter'da görünür kalır,
  // sayfa render'ında kullanılmaz — tek amacı "yeniden yayından kaldırma"
  // anında panelin eski linki hatırlayabilmesidir.
  if (gizliKod) {
    satirlar.push(fmSatiri("onizleme_kod", gizliKod));
  }

  satirlar.push("---");
  const frontMatter = satirlar.filter(Boolean).join("\n");
  return `${frontMatter}\n\n${govde.trim()}\n`;
}

/**
 * Bir içeriğin gizli ön izleme kodunu bulur: önce aktif `permalink`
 * alanından (o an "yayında değil" ise buradan gelir), yoksa kalıcı olarak
 * saklanan `onizleme_kod` alanından (içerik şu an "yayında" olsa bile daha
 * önce üretilmiş bir kodu hatırlamak için) okur. İkisi de yoksa null döner.
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
 * Blog yazıları artık _posts/YIL/ altında yıla göre alt klasörlenir
 * (örn. _posts/2026/2026-08-14-arktik.md). Jekyll'in _posts koleksiyonu
 * için dosya YOLU tamamen serbesttir — permalink her zaman dosya ADINDAKİ
 * (YYYY-AY-GUN-slug.md) tarih ve slug'dan üretilir, hangi alt klasörde
 * durduğu URL'i ETKİLEMEZ. Bu yüzden bu değişiklik mevcut linkleri/
 * permalink şemasını bozmadan sadece depo içindeki dosya organizasyonunu
 * iyileştirir. Akademik projelerde (_projects/) alt klasörleme yok; proje
 * sayısı blog yazılarına göre çok daha az ve permalink zaten :name bazlı.
 */
function dosyaYoluHesapla(tur, tarih, slug, yilOneki) {
  if (tur === "blog") {
    const yil = tarih.slice(0, 4);
    return `_posts/${yil}/${tarih}-${slug}.md`;
  }
  const yil = tarih.slice(0, 4);
  return `_projects/${yilOneki ? yil + "-" : ""}${slug}.md`;
}

/**
 * Ön izleme linki kutusunu doldurup gösterir. Hem yeni kaydetme sonrası,
 * hem mevcut bir "yayında değil" içeriği düzenlemeye açarken, hem de
 * "Yayında" kapatıldığı anda (kaydetmeden ÖNCE) kullanılır — yani link
 * tek seferlik/salt-okunur değildir: kullanıcı kodu elle değiştirebilir
 * veya zar butonuyla yenileyebilir, her değişiklik input alanına yansır
 * ve bir sonraki kayıtta o kod kalıcı hale gelir.
 */
function onizlemeKutusunuGoster(tur, gizliKod) {
  const onEk = tur === "proje" ? "/projects/" : "/blog/";
  document.getElementById("ic-onizleme-onek").textContent = `${location.origin}${onEk}on-izleme-`;
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

  linkEl.value = gecerli ? `${onek}${temizKod}/` : "Geçerli bir kod gir (en az 3 karakter, harf/rakam/tire)";
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
    if (e.target.checked) {
      onizlemeKutusunuGizle();
    } else {
      onizlemeKutusunuGoster(icerikTuru(), DUZENLENEN_GIZLI_KOD || rastgeleKod(8));
    }
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
    await icerikKaydet();
  });
  document.getElementById("ic-iptal-btn").addEventListener("click", duzenlemeyiIptalEt);
}

function duzenlemeyiKapat() {
  DUZENLENEN_YOL = null;
  DUZENLENEN_SHA = null;
  DUZENLENEN_GIZLI_KOD = null;
  document.getElementById("ic-iptal-btn").hidden = true;
  document.getElementById("ic-submit-btn").textContent = "GitHub'a Yayınla";
  guncelleIcerikTuru();
}

function duzenlemeyiIptalEt() {
  duzenlemeyiKapat();
  document.getElementById("icerik-form").reset();
  document.getElementById("ic-date").value = new Date().toISOString().slice(0, 10);
  onizlemeKutusunuGizle();
  guncelleIcerikTuru();
}

async function icerikKaydet() {
  const msgEl = document.getElementById("ic-message");
  const submitBtn = document.getElementById("ic-submit-btn");
  msgEl.hidden = true;

  const tur = icerikTuru();
  const title = document.getElementById("ic-title").value.trim();
  const date = document.getElementById("ic-date").value;

  if (!title || !date) {
    showMessage(msgEl, "Başlık ve tarih zorunludur.", "error");
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

  const alan = { title, date };
  if (tur === "proje") {
    alan.venue = document.getElementById("ic-venue").value.trim();
    alan.status = document.getElementById("ic-status").value;
    alan.summary = document.getElementById("ic-summary").value.trim();
    alan.link = document.getElementById("ic-link").value.trim();
    alan.link_label = document.getElementById("ic-link-label").value.trim();
  }

  const govde = document.getElementById("ic-body").value;
  // "Yayında değil" ise: kullanıcı ön izleme kutusundaki kodu elle
  // değiştirmiş olabilir (onizlemedenGecerliKoduAl bunu okur); geçerli bir
  // şey girilmemişse daha önce üretilmiş kod korunur, o da yoksa yeni bir
  // kod üretilir. Bu sayede kod hem düzenlenebilir hem de kaydetmeden
  // önce (Yayında kapatılır kapatılmaz) zaten görüntülenebilir durumda.
  const gizliKod = !yayinda
    ? onizlemedenGecerliKoduAl() || DUZENLENEN_GIZLI_KOD || rastgeleKod(8)
    : null;

  if (gizliKod && onizlemeKoduCakisiyorMu(tur, gizliKod, DUZENLENEN_YOL)) {
    showMessage(
      msgEl,
      `Bu ön izleme kodu ("${gizliKod}") aynı türde başka bir içerik tarafından zaten kullanılıyor. Lütfen "🎲 Yenile" ile yeni bir kod üret ya da elle farklı bir kod yaz.`,
      "error"
    );
    return;
  }

  const dosyaIcerigi = dosyaIcerigiOlustur(tur, alan, yayinda, gizliKod, govde);
  const yeniYol = dosyaYoluHesapla(tur, date, slug, yilOneki);

  submitBtn.disabled = true;
  submitBtn.textContent = "Gönderiliyor...";
  try {
    const icerikB64 = b64Encode(dosyaIcerigi);
    const commitMesaji = DUZENLENEN_YOL ? `İçerik güncellendi: ${yeniYol}` : `Yeni içerik eklendi: ${yeniYol}`;

    if (DUZENLENEN_YOL && DUZENLENEN_YOL === yeniYol) {
      // Dosya yolu değişmedi -> doğrudan güncelle.
      await ghPutFile(yeniYol, icerikB64, commitMesaji, DUZENLENEN_SHA);
    } else {
      // Yeni dosya, ya da düzenleme sırasında dosya adı/tarih değiştiği
      // için yol değişti -> önce hedef yolda dosya var mı diye bak (sha
      // gerekiyorsa al), sonra yaz.
      const mevcutHedef = await ghGetContents(yeniYol).catch(() => null);
      await ghPutFile(yeniYol, icerikB64, commitMesaji, mevcutHedef?.sha || null);

      // Düzenleme sırasında yol değiştiyse eski dosyayı sil (yeniden adlandırma).
      if (DUZENLENEN_YOL && DUZENLENEN_YOL !== yeniYol && DUZENLENEN_SHA) {
        await ghDeleteFile(
          DUZENLENEN_YOL,
          DUZENLENEN_SHA,
          `Yeniden adlandırıldı: ${DUZENLENEN_YOL} -> ${yeniYol}`
        );
      }
    }

    DUZENLENEN_GIZLI_KOD = gizliKod;
    if (!yayinda) {
      onizlemeKutusunuGoster(tur, gizliKod);
    } else {
      onizlemeKutusunuGizle();
    }

    showMessage(msgEl, "İşlem başarıyla GitHub'a iletildi, 1-2 dakika içinde sitede güncellenecektir.", "success");
    // Not: duzenlemeyiKapat() burada ÇAĞRILMIYOR — kapatılırsa ön izleme
    // kutusu ve DUZENLENEN_GIZLI_KOD sıfırlanır, kullanıcı linki kaybeder.
    // Form "düzenleme modunda" kalır ki içerik hemen yayına alınabilsin ya
    // da link tekrar görüntülenebilsin. Kart listesindeki "Düzenle" veya
    // "Yeni İçerik Ekle"ye geçiş formu zaten normal şekilde sıfırlayacaktır.
    DUZENLENEN_YOL = yeniYol;
    DUZENLENEN_SHA = (await ghGetContents(yeniYol))?.sha || DUZENLENEN_SHA;
    document.getElementById("ic-iptal-btn").hidden = false;
    document.getElementById("ic-submit-btn").textContent = "Güncelle";
    guncelleIcerikTuru();
    await icerikListesiYukle();
  } catch (err) {
    showMessage(msgEl, `Hata: ${err.message}`, "error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "GitHub'a Yayınla";
  }
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
 * _posts/ artık yıla göre alt klasörlenmiş durumda (_posts/2026/...), ama
 * GitHub Contents API bir klasörü SADECE tek seviye listeler — alt
 * klasörlerin içini görmek için her birine ayrıca istek atmak gerekir. Bu
 * fonksiyon önce _posts/'un doğrudan içeriğini okur; içinde tür=dir olan
 * (yıl adlı) girdiler varsa onların içine de ayrıca bakar. Eski, alt
 * klasörleme ÖNCESİ taşınmamış "_posts/YIL-AY-GUN-slug.md" dosyaları da
 * (varsa) hâlâ listede görünmeye devam eder, geriye dönük uyumluluk için
 * ayrıca bir taşıma/migrasyon ZORUNLU DEĞİLDİR.
 */
async function postDosyalariniListele() {
  const kokIcerik = await ghGetContents("_posts").catch(() => []);
  if (!Array.isArray(kokIcerik)) return [];

  const kokDosyalar = kokIcerik.filter((f) => f.type === "file" && f.name.endsWith(".md"));
  const yilKlasorleri = kokIcerik.filter((f) => f.type === "dir");

  const altKlasorSonuclari = await Promise.all(
    yilKlasorleri.map((klasor) => ghGetContents(klasor.path).catch(() => []))
  );
  const altKlasorDosyalari = altKlasorSonuclari
    .flat()
    .filter((f) => f && f.type === "file" && f.name.endsWith(".md"));

  return [...kokDosyalar, ...altKlasorDosyalari];
}

async function icerikListesiYukle() {
  const el = document.getElementById("ic-liste");
  if (!PAT_BELLEK) {
    el.innerHTML = '<p class="muted">Önce "GitHub Bağlantısı" sekmesinden bağlantını doğrula.</p>';
    return;
  }

  el.innerHTML = '<p class="muted">Yükleniyor...</p>';
  try {
    const [postDosyalari, projeler] = await Promise.all([
      postDosyalariniListele(),
      ghGetContents("_projects").catch(() => []),
    ]);

    const projeDosyalari = (projeler || []).filter((f) => f.type === "file" && f.name.endsWith(".md"));

    // Promise.allSettled: tek bir dosyanın okunması başarısız olursa
    // (silinmiş, geçici ağ hatası, vb.) diğer tüm liste elemanlarını
    // düşürmeden devam eder — sadece o öğe "okunamadı" olarak işaretlenir.
    const [postDetaylari, projeDetaylari] = await Promise.all([
      icerikOzetleriGuvenliGetir(postDosyalari, "blog"),
      icerikOzetleriGuvenliGetir(projeDosyalari, "proje"),
    ]);

    postDetaylari.sort((a, b) => (b.data.date || "").localeCompare(a.data.date || ""));
    projeDetaylari.sort((a, b) => (b.data.date || "").localeCompare(a.data.date || ""));

    TUM_ICERIKLER = [...postDetaylari, ...projeDetaylari];
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
    const aranan = [item.data.title, item.path, item.data.summary, item.data.venue]
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

/** Kaydedilecek gizli kodun, aynı türde BAŞKA bir içerikte zaten kullanılıp kullanılmadığını kontrol eder. */
function onizlemeKoduCakisiyorMu(tur, gizliKod, haricTutulacakYol) {
  return TUM_ICERIKLER.some(
    (item) =>
      item.tur === tur &&
      item.path !== haricTutulacakYol &&
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
  const ozet = item.data.summary
    ? `<div class="gy-icerik-kart-ozet">${metniVurgula(item.data.summary)}</div>`
    : "";

  // Gizliyken doğrudan gösterilecek ön izleme linki; yayındaysa da daha
  // önce üretilmiş bir kod varsa (bkz. icerikGizliKoduBul / onizleme_kod
  // alanı) "Linki Kopyala" ile hızlıca erişilebilsin diye kart üstünde
  // hazır tutulur (link'e tıklamadan/formu açmadan görünmez ama buton
  // panoya kopyalar).
  const gizliKod = icerikGizliKoduBul(item.data);
  const onEk = tur === "proje" ? "/projects/" : "/blog/";
  const onizlemeLink = gizliKod ? `${location.origin}${onEk}on-izleme-${gizliKod}/` : null;

  // Hızlı yayın-durumu aksiyonu: gizliyse tek tıkla "Yeniden Yayınla",
  // yayındaysa tek tıkla "Yayından Kaldır". İkisi de icerikYayinDurumunuDegistir
  // üzerinden AYNI kaydetme akışını (icerikKaydet'in çekirdeği) kullanır,
  // formu açıp elle toggle'a basmaya gerek bırakmaz. Kod her koşulda
  // korunur (bkz. dosyaIcerigiOlustur'daki onizleme_kod notu).
  const durumBtn = yayinda
    ? '<button type="button" class="gy-durum-degistir-btn" data-hedef="gizle">Yayından Kaldır</button>'
    : '<button type="button" class="gy-durum-degistir-btn gy-durum-degistir-btn--yayinla" data-hedef="yayinla">Yeniden Yayınla</button>';
  const linkBtn = onizlemeLink
    ? `<button type="button" class="gy-link-kopyala-mini-btn" title="${escapeHtml(onizlemeLink)}">🔗 Linki Kopyala</button>`
    : "";

  kart.innerHTML = `
    <div class="gy-icerik-kart-bilgi">
      <div class="gy-icerik-kart-baslik">${metniVurgula(item.data.title || item.path)}${rozet}</div>
      <div class="gy-icerik-kart-meta">${escapeHtml(item.data.date || "")} · ${metniVurgula(item.path)}</div>
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
    icerikYayinDurumunuDegistir(item, tur, e.currentTarget);
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
 * Kart üstündeki "Yeniden Yayınla" / "Yayından Kaldır" hızlı aksiyonu.
 * Formu açıp toggle'ı çevirip tekrar kaydetmeye gerek kalmadan, mevcut
 * front-matter'ı olduğu gibi koruyarak SADECE yayinda/sitemap/permalink
 * (ve onizleme_kod) alanlarını günceller ve doğrudan commit atar.
 *
 * "Yeniden Yayınla" durumunda: ÖNEMLİ — içerik gizliyken saklanan kod
 * (icerikGizliKoduBul) yayına alındıktan SONRA da onizleme_kod alanında
 * kalmaya devam eder (bkz. dosyaIcerigiOlustur), böylece bu içerik daha
 * sonra tekrar "Yayından Kaldır" ile gizlenirse AYNI link geri döner.
 */
async function icerikYayinDurumunuDegistir(item, tur, btn) {
  const yeniYayinda = item.data.yayinda === false; // şu an gizliyse -> yayına al, değilse -> gizle
  const eylemAdi = yeniYayinda ? "yayına alınsın" : "yayından kaldırılsın";
  if (!confirm(`"${item.data.title || item.path}" ${eylemAdi} mı?`)) return;

  const gizliKod = !yeniYayinda ? icerikGizliKoduBul(item.data) || rastgeleKod(8) : icerikGizliKoduBul(item.data);

  if (!yeniYayinda && onizlemeKoduCakisiyorMu(tur, gizliKod, item.path)) {
    alert(
      `Bu içeriğin daha önce kullandığı ön izleme kodu ("${gizliKod}") başka bir içerikte de kullanılıyor gibi görünüyor. Formu açıp "Düzenle" ile yeni bir kod üretmen gerekiyor.`
    );
    return;
  }

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
    const dosyaIcerigi = dosyaIcerigiOlustur(tur, alan, yeniYayinda, gizliKod, item.body || "");
    const mesaj = yeniYayinda ? `Yeniden yayınlandı: ${item.path}` : `Yayından kaldırıldı: ${item.path}`;
    await ghPutFile(item.path, b64Encode(dosyaIcerigi), mesaj, item.sha);
    await icerikListesiYukle();
  } catch (err) {
    alert(`İşlem başarısız: ${err.message}`);
    btn.disabled = false;
    btn.textContent = oncekiMetin;
  }
}

async function icerikSil(item) {
  if (!confirm(`"${item.data.title || item.path}" silinsin mi? Bu işlem geri alınamaz.`)) return;
  try {
    await ghDeleteFile(item.path, item.sha, `İçerik silindi: ${item.path}`);
    await icerikListesiYukle();
  } catch (err) {
    alert(`Silinemedi: ${err.message}`);
  }
}

function icerikDuzenlemeyeYukle(item, tur) {
  DUZENLENEN_YOL = item.path;
  DUZENLENEN_SHA = item.sha;

  document.querySelector(`input[name="icerik-turu"][value="${tur}"]`).checked = true;
  guncelleIcerikTuru();

  document.getElementById("ic-title").value = item.data.title || "";
  document.getElementById("ic-date").value = item.data.date || "";

  const dosyaAdi = item.path.split("/").pop().replace(/\.md$/, "");
  document.getElementById("ic-slug").value =
    tur === "blog" ? dosyaAdi.replace(/^\d{4}-\d{2}-\d{2}-/, "") : dosyaAdi.replace(/^\d{4}-/, "");
  document.getElementById("ic-yil-oneki").checked = tur === "proje" && /^\d{4}-/.test(dosyaAdi);

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

  // İçeriğin daha önce üretilmiş bir gizli ön izleme kodu varsa (permalink
  // alanından çıkar) hatırla ve göster — "yayında değil" içerikler artık
  // düzenlemeye her açıldığında linkini yeniden görebilir, kod da kaydetme
  // sırasında DEĞİŞMEDEN korunur. Permalink herhangi bir sebeple eksikse
  // (elle düzenlenmiş dosya vb.) yeni bir kod üretip gösteriyoruz.
  DUZENLENEN_GIZLI_KOD = icerikGizliKoduBul(item.data);
  if (!yayinda) {
    onizlemeKutusunuGoster(tur, DUZENLENEN_GIZLI_KOD || rastgeleKod(8));
  } else {
    onizlemeKutusunuGizle();
  }

  document.getElementById("ic-iptal-btn").hidden = false;
  document.getElementById("ic-submit-btn").textContent = "Güncelle";
  document.getElementById("icerik-ekle").scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------------------------------------------------------------------- */
/* PROFİL FOTOĞRAFI YÖNETİMİ (assets/profil.jpg)                          */
/* ---------------------------------------------------------------------- */
function wireProfilFoto() {
  document.getElementById("pf-yukle-btn").addEventListener("click", profilFotoYukle);
  document.getElementById("pf-sil-btn").addEventListener("click", profilFotoSil);
}

async function profilFotoDurumYukle() {
  const el = document.getElementById("pf-mevcut");
  el.innerHTML = '<p class="muted">Yükleniyor...</p>';
  try {
    const dosya = await ghGetContents(PROFIL_YOLU);
    if (!dosya) {
      PROFIL_SHA = null;
      el.innerHTML = '<p class="muted">Şu anda bir profil fotoğrafı yok.</p>';
      return;
    }
    PROFIL_SHA = dosya.sha;
    const src = dosya.download_url || `data:image/jpeg;base64,${dosya.content.replace(/\n/g, "")}`;
    el.innerHTML = `<img src="${src}" alt="Mevcut profil fotoğrafı"><span class="muted">Mevcut fotoğraf (sha: ${escapeHtml(
      dosya.sha.slice(0, 8)
    )}...)</span>`;
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
    const base64 = await dosyayiBase64eCevir(dosya);
    await ghPutFile(
      PROFIL_YOLU,
      base64,
      PROFIL_SHA ? "Profil fotoğrafı güncellendi" : "Profil fotoğrafı eklendi",
      PROFIL_SHA
    );
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
  if (!PROFIL_SHA) {
    showMessage(msgEl, "Silinecek bir profil fotoğrafı yok.", "error");
    return;
  }
  if (!confirm("Profil fotoğrafını silmek istediğine emin misin?")) return;

  const btn = document.getElementById("pf-sil-btn");
  btn.disabled = true;
  try {
    await ghDeleteFile(PROFIL_YOLU, PROFIL_SHA, "Profil fotoğrafı silindi");
    showMessage(msgEl, "İşlem başarıyla GitHub'a iletildi, 1-2 dakika içinde sitede güncellenecektir.", "success");
    await profilFotoDurumYukle();
  } catch (err) {
    showMessage(msgEl, `Silinemedi: ${err.message}`, "error");
  } finally {
    btn.disabled = false;
  }
}

init();

[⬅️ README'ye dön](../README.md)

[📖 Site Rehberi](./01-site-rehberi.md) · [🔐 Supabase Sistemi](./02-supabase-sistemi.md) · **🍴 Fork Kurulumu**

---

# 🍴 Bu Projeyi Fork Edenler İçin Kurulum Rehberi

Bu site tamamen bana (Abdullah Eymen Asru) özel kişisel bilgiler, hesaplar ve
API anahtarları içeriyor. Fork'ladıysan **canlıya almadan önce** aşağıdaki
adımları sırayla uygulaman gerekiyor.

### 1. Zorunlu Değişiklikler — `_config.yml`

Bu dosyadaki `# ---- BURAYI DOLDUR ----` ile başlayan blok içindeki
**her satırı kendine göre değiştir**:

| Alan | Ne yapmalısın |
|---|---|
| `title`, `description` | Kendi adın/site açıklaman |
| `url` | Kendi Cloudflare Pages adresin (örn. `https://kullaniciadin.pages.dev`) |
| `github_username` | Kendi GitHub kullanıcı adın |
| `kutuphane_repo` | Kendi izleme/okuma verisini tutacağın repo (bu özelliği kullanmayacaksan bkz. "Bölüm 4 — Silme") |
| `izleme_projects_url` / `okuma_projects_url` | Kendi GitHub Projects panolarının linki |
| `substack_url` / `substack_feed` | Kendi Substack adresin (kullanmıyorsan bkz. "Bölüm 4") |
| `google_analytics_id` | Kendi Google Analytics Measurement ID'in (G-XXXXXXX) |
| `profile_image` | `assets/` klasörüne kendi fotoğrafını yükleyip yolunu yaz |
| `cloudflare_worker_url` | Kendi Cloudflare Worker adresin (kullanmıyorsan bkz. "Bölüm 4") |
| `mirror_site_url` | Kendi GitHub Pages yedek adresin (`kullaniciadin.github.io`) |
| `giscus:` bloğu | [giscus.app](https://giscus.app) adresine git, KENDİ repo'nu bağlayıp `repo`, `repo_id`, `category`, `category_id` değerlerini oradan kopyala |
| `social:` altındaki tüm linkler | Kendi sosyal medya/akademik profil linklerin — kullanmadığın satırları sil |

### 2. Zorunlu Değişiklikler — `assets/data/schema.json` ve `llms.txt`

Bu ikisi kod değil, **saf kişisel veri** — bana (Abdullah Eymen Asru) ait
isim, sosyal medya/akademik profil linkleri ve site açıklaması. Fork'ladıysan
canlıya almadan önce ikisini de kendine göre yeniden yazman gerekiyor,
yoksa kendi sitende benim bilgilerim görünmeye devam eder. Dosyaların ne
işe yaradığının teknik detayı için bkz. [📖 Site Rehberi](./01-site-rehberi.md)
sekmesindeki "11. `assets/data/schema.json` ve `llms.txt`" bölümü.

| Dosya | Ne yapmalısın |
|---|---|
| `assets/data/schema.json` | `name` alanına kendi adını, `url` alanına kendi site adresini (Bölüm 5'teki senaryoya göre `pages.dev` veya `github.io`) yaz. `sameAs` dizisindeki linkleri komple sil, yerine kendi sosyal medya/akademik/GitHub profillerini ekle — sahip olmadığın bir platform için satır bırakma. |
| `llms.txt` | Başlıktaki adı, biyografi paragrafını ve "Ana Sayfalar ve Bağlantılar" / "İsteğe Bağlı Ek Kaynaklar" altındaki tüm linkleri kendi domainine ve kendi sayfalarına göre güncelle. "4. Kullanmak İstemediğin Özellikleri Silme" bölümüne göre kaldırdığın bir sayfa varsa (örn. akademik projeler, izlediklerim/okuduklarım), buradaki karşılık gelen linki de sil. |

### 3. Zorunlu Değişiklikler — `_config_cloudflare.yml`

Buradaki `google_analytics_id`'yi de kendi Analytics ID'in ile değiştir
(veya `_config.yml`'dekiyle aynısını kullanacaksan bu dosyayı tamamen silebilirsin).

### 4. Kullanmak İstemediğin Özellikleri Silme

Aşağıdaki her blok bağımsızdır — sadece istemediğini sil, geri kalanına dokunma.

**Yorum sistemini (giscus) kaldırmak istersen:**
- `_includes/comments.html` dosyasını sil
- `_layouts/post.html` içinde `{% include comments.html %}` satırını bul ve sil
- `_config.yml` içindeki `giscus:` bloğunu sil

**İletişim formunu kaldırmak istersen:**
- `kurumsal/iletisim.md` dosyasını sil
- `_layouts/default.html` içindeki menüde iletişim linkine giden satırı bul ve sil

**İzlediklerim/Okuduklarım (Cloudflare Worker) özelliğini kaldırmak istersen:**
- `icerik/izlediklerim.md` ve `icerik/okuduklarim.md` dosyalarını sil
- `_config.yml` içinden `kutuphane_repo`, `izleme_projects_url`, `okuma_projects_url`, `cloudflare_worker_url` satırlarını sil
- `_layouts/default.html` içindeki menüden bu sayfalara giden linkleri sil

**Akademik projeler / Substack blog bağlantısını kaldırmak istersen:**
- `icerik/akademik-projeler.md` dosyasını sil (ya da içeriğini kendi projelerinle doldur)
- `substack_url` / `substack_feed` satırlarını `_config.yml`'den sil
- `_layouts/default.html` menüsündeki ilgili linki sil

**Zamanlanmış/gizli yazı otomasyonunu (GitHub Actions) kaldırmak istersen:**
- `.github/workflows/zamanlanmis-yayin.yml` dosyasını sil
- GitHub repo ayarlarından eklediysen `CLOUDFLARE_DEPLOY_HOOK_URL` secret'ını da silebilirsin
- Not: Bunu silersen, gelecek tarihli/gizli yazılar sadece SEN elle bir push yaptığında görünür hale gelir, otomatik gelmez

**Android uygulama bağlantısını (App Links) kullanmıyorsan:**
- `.well-known/assetlinks.json` dosyasını sil
- `_config.yml` içindeki `include: - .well-known` satırını silebilirsin

**Supabase kullanıcı sistemini (kayıt/giriş/panel/admin) kaldırmak istersen:**
- `hesap/giris.md`, `hesap/kayit.md`, `hesap/sifremi-unuttum.md`, `hesap/sifre-guncelle.md`,
  `hesap/hesap-onayla.md`, `panel/panel.md`, `panel/admin.md`, `panel/ozel-icerik.md` dosyalarını sil
- `assets/js/supabase-client.js`, `auth-guard.js`, `auth-pages.js`,
  `panel.js`, `admin.js`, `ozel-icerik.js`, `nav-auth.js` ve
  `assets/css/auth.css` dosyalarını sil
- `supabase/` klasörünü (migrations + functions) tamamen sil
- `_layouts/default.html` içindeki `#auth-nav` bloğunu ve onu başlatan
  `<script type="module">...initAuthNav()...</script>` satırını sil
- `assets/style.css` içindeki `.auth-nav*` sınıflarını sil
- Supabase Dashboard'dan projeyi de silmek istersen **Project Settings →
  General → Delete Project** üzerinden yapabilirsin (bu, koddan bağımsız,
  ayrı bir adım)

### 5. Cloudflare Pages mi, GitHub Pages mi? (Birincil Adres / Barındırma Seçimi)

Bu site aynı anda **iki adreste** barınabilir: Cloudflare Pages
(`pages.dev`) ve GitHub Pages (`github.io`). Repoyu fork'ladığında hangisini
nasıl kullanacağına göre iki farklı senaryo var — hangisi sana uyuyorsa
onu uygula, ikisi birbirinden bağımsızdır.

#### Senaryo A — İkisini de kullanmaya devam edip sadece birincil adresi değiştirmek istiyorum

Örneğin Google'ın indekslediği/canonical adresin `pages.dev` yerine
`github.io` olsun istiyorsun, ama Cloudflare Pages'i yedek olarak
kullanmaya devam edeceksin. Sadece **3 satır** değişiyor, kod tarafında
başka hiçbir şeye dokunman gerekmiyor (sitemap.xml, feed.xml,
canonical/og:url etiketleri hepsi aşağıdaki `url:` değerini otomatik takip
eder):

| Dosya | Satır | Şimdi | Değişecek |
|---|---|---|---|
| `_config.yml` | `url:` | `https://kullaniciadin.pages.dev` | `https://kullaniciadin.github.io` |
| `_config.yml` | `mirror_site_url:` | `https://kullaniciadin.github.io` | `https://kullaniciadin.pages.dev` |
| `robots.txt` | `Sitemap:` satırı | `.../pages.dev/sitemap.xml` | `.../github.io/sitemap.xml` |

Kod dışında (repo'da olmayan) ayrıca yapman gerekenler:
- Supabase Dashboard → Authentication → URL Configuration'da "Site URL"i
  yeni birincil adresle güncelle (Redirect URLs listesinde her iki adres
  de zaten varsa dokunmana gerek yok).
- Google Search Console'a yeni adresi ayrıca doğrulat, yeni sitemap'i
  gönder.
- GitHub repo ayarlarında **Settings → Pages**'in açık olduğunu teyit et.

İki Cloudflare Worker ve iki Supabase Edge Function'ı (`delete-account`,
`admin-change-email`) zaten her iki adresi de izin listesinde tuttuğu
için, hangisini birincil yaparsan yap ikisi de çalışmaya devam eder —
onlara dokunmuyorsun.

#### Senaryo B — Cloudflare Pages'i tamamen bırakıp SADECE GitHub Pages kullanacağım

- `_config_cloudflare.yml` dosyasını sil
- `_headers` dosyasını sil (bu dosya sadece Cloudflare Pages'te işe yarar,
  GitHub Pages'te zaten görmezden gelinir ama gereksizse silebilirsin)
- `.github/workflows/zamanlanmis-yayin.yml` dosyasını sil (Cloudflare'e özel deploy hook'u tetikliyor)
- `_config.yml` içindeki `mirror_site_url` satırını sil, `url` alanına
  GitHub Pages adresini yaz
- `robots.txt` içindeki `Sitemap:` satırını GitHub Pages adresine güncelle
  (Senaryo A'daki tabloyla aynı satır)
- Cloudflare Worker'lardaki (`r2_storage_worker`, `izleme_okuma_worker`,
  `github_icerik_worker`)
  ve Edge Function'lardaki (`delete-account`, `admin-change-email`)
  `pages.dev` referanslarını silmen ZORUNLU değil (kullanılmayan bir
  adresin izin listesinde durması zarar vermez), ama istersen temizlik
  için kaldırabilirsin.

### 6. Secret / Gizli Anahtarlar — Nerede, Nasıl Tanımlanır

Bu projede kod içine **asla düz yazılmaması gereken** tek secret,
Cloudflare Pages'i otomatik build tetikleyen deploy hook URL'idir.
(Google Analytics ID ve giscus ayarları secret değildir, herkese açık
görünebilir bilgilerdir, bu yüzden `_config.yml` içinde düz yazılıdır.)

| Secret adı | Nerede kullanılır | Nasıl oluşturulur | Nereye eklenir |
|---|---|---|---|
| `CLOUDFLARE_DEPLOY_HOOK_URL` | `.github/workflows/zamanlanmis-yayin.yml` | Cloudflare Pages projeni aç → **Settings → Builds & deployments → Deploy Hooks** → yeni bir hook oluştur, verdiği URL'i kopyala | GitHub repo'nda **Settings → Secrets and variables → Actions → New repository secret** → isim: `CLOUDFLARE_DEPLOY_HOOK_URL`, değer: kopyaladığın URL |

Bu projede kullanılan diğer üçüncü parti servisler (Google Analytics,
giscus, Google Forms) API anahtarı değil, herkese açık/genel amaçlı ID'ler
kullanır; bunları `_config.yml` veya ilgili `.md` dosyasına doğrudan
yazman güvenlidir, GitHub Secrets'a eklemene gerek yoktur.

### 7. Yayına Alma Sırası (Özet)

1. Yukarıdaki `_config.yml` ve `_config_cloudflare.yml` alanlarını doldur
2. `assets/data/schema.json` ve `llms.txt`'i kendi bilgilerinle yeniden yaz (Bölüm 2)
3. İstemediğin özellikleri "Bölüm 4"e göre sil
4. Cloudflare Pages'te yeni bir proje oluştur, bu repo'yu bağla
   - Build command: `bundle exec jekyll build --config _config.yml,_config_cloudflare.yml`
   - Build output directory: `_site`
5. Zamanlanmış yayın özelliğini kullanacaksan `CLOUDFLARE_DEPLOY_HOOK_URL` secret'ını ekle (Bölüm 6)
6. GitHub Pages'i de yedek olarak kullanacaksan repo **Settings → Pages** üzerinden aktif et

---

[⬅️ README'ye dön](../README.md)

[📖 Site Rehberi](./01-site-rehberi.md) · [🔐 Supabase Sistemi](./02-supabase-sistemi.md) · **🍴 Fork Kurulumu**

---


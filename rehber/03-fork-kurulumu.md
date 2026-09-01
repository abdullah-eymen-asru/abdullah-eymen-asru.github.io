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
| `substack_url` | Kendi Substack adresin (kullanmıyorsan bkz. "Bölüm 4") |
| `substack_feed` | **Sadece bilgi amaçlı** — asıl RSS adresi `cloudflare worker/substack_feed_proxy_worker/worker.js` içindeki `FEED_URL` sabitinde; onu da kendi feed'inle güncellemen gerekiyor (bkz. "Bölüm 6b") |
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
- `assets/js/core/supabase-client.js`, `assets/js/auth/auth-guard.js`,
  `assets/js/auth/auth-pages.js`, `assets/js/auth/nav-auth.js`,
  `assets/js/panel.js`, `assets/js/admin.js`, `assets/js/ozel-icerik.js` ve
  `assets/css/auth.css` dosyalarını sil
- `supabase/` klasörünü (migrations + functions) tamamen sil
- `_layouts/default.html` içindeki `#auth-nav` bloğunu ve onu başlatan
  `<script type="module">...initAuthNav()...</script>` satırını sil
- `assets/style.css` içindeki `.auth-nav*` sınıflarını sil
- Supabase Dashboard'dan projeyi de silmek istersen **Project Settings →
  General → Delete Project** üzerinden yapabilirsin (bu, koddan bağımsız,
  ayrı bir adım)
- Bunu silersen `panel/github-yonetim.html` de (aşağıya bkz.) çalışmaz
  hale gelir — Supabase oturumuna/rolüne bağımlı. O özelliği de
  istemiyorsan aşağıdaki bloğu da uygula.

**GitHub İçerik Yönetimi'ni (`panel/github-yonetim.html` mini CMS'i + onun
Cloudflare Worker'ı) kaldırmak istersen:**
- `panel/github-yonetim.md`, `onizleme/index.md`, `icerik/supabase-yazi.md`
  dosyalarını sil
- `assets/js/github-yonetim/` klasörünü (3 dosya: `github-yonetim.js`,
  `onizleme.js`, `supabase-yazi.js`) tamamen sil
- `assets/css/github-yonetim.css` dosyasını sil
- `cloudflare worker/github_icerik_yonetim_worker/` klasörünü sil (ve
  Cloudflare Dashboard'da o Worker'ı deploy ettiysen orada da sil)
- `_layouts/default.html` içindeki "Hesabım" menüsünde (admin/editor/
  manager'a görünen) GitHub İçerik Yönetimi linkini sil — bkz.
  `assets/js/auth/nav-auth.js`
- **Migration'lar konusunda dikkatli ol:** `taslak_icerikler` tablosu ve
  editor/manager yayın onayı akışı `supabase/migrations/0013` ile `0018`
  ve `0020` arasındaki dosyalara YAYILMIŞ durumda, ve bu dosyalar
  birbirine (ör. 0016, 0014'ün eklediği bir kolona) bağımlı. Migration'ları
  HENÜZ hiç çalıştırmadıysan bu dosyaları (0013, 0014, 0015, 0016, 0018,
  0020) atlayabilirsin; ama zaten çalıştırdıysan (canlı bir Supabase
  projen varsa) tek tek geri almaya ÇALIŞMA — bozulma riski yüksek. Bu
  durumda en basit yol: özelliği koddan kaldır (yukarıdaki dosyaları sil)
  ama veritabanı tablolarına/fonksiyonlarına DOKUNMA; kullanılmayan bir
  tablo zarar vermez.

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
  `github_icerik_yonetim_worker`, `substack_feed_proxy_worker`)
  ve Edge Function'lardaki (`delete-account`, `admin-change-email`)
  `pages.dev` referanslarını silmen ZORUNLU değil (kullanılmayan bir
  adresin izin listesinde durması zarar vermez), ama istersen temizlik
  için kaldırabilirsin.

### 6. GitHub İçerik Yönetimi Worker'ını Kurma (`panel/github-yonetim.html`)

`panel/github-yonetim.html`, admin/editor/manager rolündeki kullanıcıların
blog yazısı/akademik proje ekleyip GitHub'a commit ederek (ya da sadece
Supabase'te) yayınlayabildiği bir mini CMS. Bu özelliği kullanacaksan
(silmek istiyorsan yerine "Bölüm 4"teki ilgili bloğa bak), aşağıdaki
Cloudflare Worker'ı **senin kendi Worker'ın olarak** deploy etmen
gerekiyor — benim Worker'ım sadece benim GitHub token'ımla çalışır, seninki
çalışmaz.

**Neden bir Worker gerekiyor?** GitHub'a yazma izni olan bir Personal
Access Token (PAT), hiçbir zaman tarayıcıya/panele girmiyor — sadece bu
Worker'ın sunucu-taraflı bir secret'ı olarak duruyor. Panel, GitHub'a değil
bu Worker'a, kimlik kanıtı olarak Supabase oturum token'ını göndererek
istek atıyor; Worker o token'ı doğrulayıp rolünü (`editor`/`manager`/
`admin`) kontrol ettikten SONRA kendi PAT'ıyla GitHub'a yazıyor. Tam
mimari gerekçe için `cloudflare worker/github_icerik_yonetim_worker/worker.js`
dosyasının başındaki yorumu oku — burada sadece KURULUM adımları var.

| Adım | Ne yapmalısın |
|---|---|
| 1. Worker'ı oluştur | [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages → Create → Create Worker** → bir isim ver (ör. `github-icerik-yonetim`) → Deploy (şimdilik varsayılan kodla) |
| 2. Kodu yapıştır | Worker sayfası → **Edit code** (Quick Edit) → varsayılan kodu sil, `cloudflare worker/github_icerik_yonetim_worker/worker.js` dosyasının TAMAMINI yapıştır → **Deploy** |
| 3. Fine-grained GitHub PAT oluştur | [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new) → **Resource owner**: kendi kullanıcı adın → **Repository access**: "Only select repositories" → sadece kendi fork'unu seç → **Repository permissions → Contents**: "Read and write" → oluştur, token'ı (bir kez gösterilir) kopyala |
| 4. Secret'ları gir | Worker → **Settings → Variables and Secrets → Add** (aşağıdaki tablo) |
| 5. Worker URL'ini al ve panele yaz | Worker sayfasının üstündeki adresi (`https://<isim>.<hesabın>.workers.dev`) kopyala → `assets/js/github-yonetim/github-yonetim.js` içindeki `GITHUB_PROXY_WORKER_URL` sabitini bu adresle değiştir → commit'le |
| 6. Test et | `/panel/github-yonetim.html`'e admin/editor/manager hesabıyla gir — "GitHub Bağlantısı" sekmesi otomatik doğrulanmayı dener; yeşil "Bağlantı doğrulandı" mesajı görürsen tamam |

**Girmen gereken 5 değişken** (Worker → Settings → Variables and Secrets):

| Değişken | Değer | Tip |
|---|---|---|
| `GITHUB_OWNER` | Kendi GitHub kullanıcı adın | Text |
| `GITHUB_REPO` | Fork'unun repo adı (ör. `kullaniciadin.github.io`) | Text |
| `GITHUB_PAT` | 3. adımda oluşturduğun fine-grained token | **Secret** |
| `SUPABASE_URL` | `assets/js/core/supabase-client.js` içindeki `SUPABASE_URL` ile AYNI değer (gizli değil) | Text |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard → **Project Settings → API** → "service_role" satırındaki anahtar | **Secret** |

**⚠️ `SUPABASE_SERVICE_ROLE_KEY` özellikle önemli:** bu anahtar Supabase'teki
Row Level Security'yi (RLS) TAMAMEN bypass eder — Worker'ın kimlik/rol
kontrolü yapabilmesi için gerekli, ama ASLA `.js` dosyasına, ASLA bir
commit'e, ASLA `_config.yml`'e yazma. Sadece Worker'ın "Secret" (Encrypt)
alanına gir — Cloudflare bir kez kaydettikten sonra onu bile tekrar
göstermez.

**Bu özelliği istemiyorsan** yukarıdaki adımları hiç uygulama — panel
sadece "Bağlantı doğrulanamadı" hatası gösterir, sitenin geri kalanı
etkilenmez. Kalıcı olarak kaldırmak istersen "Bölüm 4 → GitHub İçerik
Yönetimi'ni kaldırmak istersen" bloğuna bak (dosyaları/klasörü siler).

### 6b. Substack Feed Proxy Worker'ını Kurma (`icerik/blog.html`)

Blog sayfasındaki "Substack Yazıları" sütunu, Substack'in RSS feed'ini
CORS izni vermediği için tarayıcıdan doğrudan çekemiyor — bu yüzden feed'i
senin adına çekip CORS başlığı ekleyen küçük bir Worker'a ihtiyaç var
(neden gerektiğine dair ayrıntı için `cloudflare worker/substack_feed_proxy_worker/worker.js`
dosyasının başındaki açıklamaya bak). Secret gerekmez, herkese açık bir
feed olduğu için kimlik doğrulama da yok.

| Adım | Ne yapmalısın |
|---|---|
| 1. Worker'ı oluştur | [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages → Create → Create Worker** → bir isim ver (ör. `substack-feed-proxy`) → Deploy (şimdilik varsayılan kodla) |
| 2. Kodu yapıştır | Worker sayfası → **Edit code** (Quick Edit) → varsayılan kodu sil, `cloudflare worker/substack_feed_proxy_worker/worker.js` dosyasının TAMAMINI yapıştır — ama önce dosyanın başındaki `FEED_URL` sabitini KENDİ Substack feed adresinle değiştir → **Deploy** |
| 3. Worker URL'ini al ve blog sayfasına yaz | Worker sayfasının üstündeki adresi (`https://<isim>.<hesabın>.workers.dev`) kopyala → `icerik/blog.md` içindeki `SUBSTACK_FEED_PROXY_WORKER_URL` sabitini bu adresle değiştir → commit'le |

**Bu özelliği istemiyorsan** (Substack kullanmıyorsan) yukarıdaki adımları
hiç uygulama — "Substack Yazıları" sütunu sadece bir hata mesajı gösterir,
sitenin geri kalanı etkilenmez. Kalıcı olarak kaldırmak istersen
`icerik/blog.md`'deki Substack sütununu ve ilgili `<script>` bloğunu,
`cloudflare worker/substack_feed_proxy_worker/` klasörünü ve `_config.yml`
içindeki `substack_url`/`substack_feed` satırlarını sil.

### 7. Secret / Gizli Anahtarlar — Nerede, Nasıl Tanımlanır

Bu projede kod içine **asla düz yazılmaması gereken** secret'lar:
Cloudflare Pages'i otomatik build tetikleyen deploy hook URL'i, ve (Bölüm
6'daki) GitHub İçerik Yönetimi Worker'ının `GITHUB_PAT` /
`SUPABASE_SERVICE_ROLE_KEY` değerleri. (Google Analytics ID ve giscus
ayarları secret değildir, herkese açık görünebilir bilgilerdir, bu yüzden
`_config.yml` içinde düz yazılıdır.)

| Secret adı | Nerede kullanılır | Nasıl oluşturulur | Nereye eklenir |
|---|---|---|---|
| `CLOUDFLARE_DEPLOY_HOOK_URL` | `.github/workflows/zamanlanmis-yayin.yml` | Cloudflare Pages projeni aç → **Settings → Builds & deployments → Deploy Hooks** → yeni bir hook oluştur, verdiği URL'i kopyala | GitHub repo'nda **Settings → Secrets and variables → Actions → New repository secret** → isim: `CLOUDFLARE_DEPLOY_HOOK_URL`, değer: kopyaladığın URL |
| `GITHUB_PAT` | `cloudflare worker/github_icerik_yonetim_worker/worker.js` | Bkz. Bölüm 6, adım 3 | Worker → **Settings → Variables and Secrets** (Secret/Encrypt olarak) |
| `SUPABASE_SERVICE_ROLE_KEY` | `cloudflare worker/github_icerik_yonetim_worker/worker.js` (ve varsa diğer Worker'ların — `r2_storage_worker`, `izleme_okuma_worker`) | Supabase Dashboard → **Project Settings → API** | İlgili Worker'ın **Settings → Variables and Secrets** (Secret/Encrypt olarak) |

Bu projede kullanılan diğer üçüncü parti servisler (Google Analytics,
giscus, Google Forms) API anahtarı değil, herkese açık/genel amaçlı ID'ler
kullanır; bunları `_config.yml` veya ilgili `.md` dosyasına doğrudan
yazman güvenlidir, GitHub Secrets'a eklemene gerek yoktur.

### 8. Yayına Alma Sırası (Özet)

1. Yukarıdaki `_config.yml` ve `_config_cloudflare.yml` alanlarını doldur
2. `assets/data/schema.json` ve `llms.txt`'i kendi bilgilerinle yeniden yaz (Bölüm 2)
3. İstemediğin özellikleri "Bölüm 4"e göre sil
4. Cloudflare Pages'te yeni bir proje oluştur, bu repo'yu bağla
   - Build command: `bundle exec jekyll build --config _config.yml,_config_cloudflare.yml`
   - Build output directory: `_site`
5. Zamanlanmış yayın özelliğini kullanacaksan `CLOUDFLARE_DEPLOY_HOOK_URL` secret'ını ekle (Bölüm 7)
6. GitHub İçerik Yönetimi'ni kullanacaksan Worker'ı kur (Bölüm 6)
6b. Substack kullanacaksan feed proxy Worker'ını kur (Bölüm 6b)
7. GitHub Pages'i de kullanacaksan repo **Settings → Pages → Build and
   deployment → Source** kısmını **"GitHub Actions"** olarak seç (ARTIK
   "Deploy from a branch" DEĞİL — proje `.github/workflows/
   github-pages-deploy.yml` ile kendi Ruby/Jekyll ortamında build alıp
   deploy ediyor; bunun nedeni, CSP'den `unsafe-inline`/`unsafe-eval`'i
   kaldıran `_plugins/csp_hash_enjekte.rb` gibi özel pluginlerin, GitHub'ın
   kendi "safe mode" build'inde ÇALIŞMAMASI — bkz. o dosyanın ve
   workflow'un başındaki ayrıntılı açıklamalar). Bu adım atlanırsa/eski
   "Deploy from a branch" seçili kalırsa, workflow'un deploy adımı hata
   verir.

---

[⬅️ README'ye dön](../README.md)

[📖 Site Rehberi](./01-site-rehberi.md) · [🔐 Supabase Sistemi](./02-supabase-sistemi.md) · **🍴 Fork Kurulumu**

---


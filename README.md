# Site Rehberi — Hangi Dosya Ne İşe Yarar, Neyi Nerede Değiştiririm?

Bu dosya, siteyi bir daha açtığında ("bunu nereye koymuştum?") hızlıca
yön bulman için var. Her bölüm bir dosyayı/özelliği anlatıyor: ne işe
yarıyor, hangi satırı değiştirirsen ne olur.

---

## 1. `_config.yml` — Sitenin ana ayar dosyası

Jekyll build'inde her sayfaya `site.XXX` olarak erişilebilen tüm genel
değerler burada. En sık dokunacağın dosya.

| Alan | Ne işe yarar |
|---|---|
| `title` | Site başlığı, sekme adı, header'daki logo yazısı |
| `description` | SEO açıklaması, sosyal medya paylaşım kartlarında görünür |
| `url` | Sitenin birincil adresi (Cloudflare Pages domainin) |
| `github_username` | GitHub kullanıcı adın |
| `kutuphane_repo` | İzlediklerim/okuduklarım verisinin tutulduğu ayrı repo |
| `izleme_projects_url` / `okuma_projects_url` | GitHub Projects panolarının linkleri |
| `substack_url` / `substack_feed` | Substack blog adresin ve RSS feed'i |
| `google_analytics_id` | Google Analytics ölçüm kimliği |
| `profile_image` | Profil fotoğrafın (`assets/`e yükleyip yolunu buraya yaz) |
| `cloudflare_worker_url` | İzleme/okuma verisini çeken Worker'ın adresi |
| `mirror_site_url` | Yedek/ikincil site adresin (GitHub Pages) |
| `giscus:` altındaki alanlar | Yorum sistemi (giscus.app'ten alınır) — `category` için "Announcements" tipi bir kategori seçmen önerilir, böylece yorum başlığını sadece sen/giscus botu açabilir |
| `social:` altındaki linkler | GitHub, LinkedIn, X/Twitter, Instagram, YouTube, n-sosyal, ORCID, Academia, ResearchGate, 1000Kitap, Play Store |
| `future` | `true` kalmalı — zamanlanmış/gizli yazıların çalışması buna bağlı, bkz. bölüm 9 |

## 2. `_config_cloudflare.yml` — Sadece Cloudflare build'ine özel ek ayarlar

Cloudflare Pages build komutunda `--config _config.yml,_config_cloudflare.yml`
ile birlikte okunur; buradaki anahtarlar `_config.yml`'deki aynı isimli
anahtarların üzerine yazar. Şu an sadece `google_analytics_id` burada —
Cloudflare build'i için ayrı bir Analytics ID istersen kullan, aynı ID'yi
kullanacaksan bu dosyaya dokunmana gerek yok.

## 3. `_headers` — Cloudflare Pages güvenlik header'ları

Kök dizinde duran bu dosya, Cloudflare Pages tarafından otomatik okunur
(bir ayar paneline eklemene gerek yok — dosyanın repo'da olması yeterli).
Her sayfaya `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`,
`Permissions-Policy`, `Strict-Transport-Security` header'larını ekler.
**Sadece Cloudflare Pages'te çalışır** — GitHub Pages özel HTTP header
ayarlamayı desteklemiyor, o yüzden mirror sitede bu korumalar yok.

Değiştirmek isteyebileceğin tek yer: `Permissions-Policy` satırındaki
`camera=(), microphone=(), geolocation=(), payment=()` — ileride bu
API'lerden birini gerçekten kullanacaksan (örn. bir harita gömersen ve
konum istersen), ilgili parantezin içine `(self)` yazman gerekir.

## 4. `iletisim.md` — İletişim formu

`src="FORM-EMBED-LINKINI-BURAYA-YAPISTIR"` satırındaki placeholder'ı,
Google Forms'tan aldığın gerçek embed linkiyle değiştir (Forms'ta
Gönder > `<>` ikonu > `src=` değerini kopyala).

## 5. `cloudflare-worker/worker.js` — İzlediklerim/Okuduklarım verisini çeken Worker

Bu dosya Cloudflare Dashboard'a **ayrıca** yapıştırılıp deploy edilmesi
gereken ayrı bir kod — repo'daki kopyası sadece kaynak/yedek, canlıya
otomatik yansımaz. Değiştirdiğinde Cloudflare Dashboard'da "Save and
Deploy" yapman gerekir.

| Ne | Nerede | Nasıl değiştirilir |
|---|---|---|
| GitHub kullanıcı adı | `GITHUB_LOGIN` sabiti (dosyanın başı) | Tırnak içindeki değeri kendi kullanıcı adınla değiştir |
| Proje numaraları | `PROJECTS` objesi içinde `number:` | GitHub Projects panosunun URL'indeki `/projects/N/` sayısı |
| **Sütun sırası** | `PROJECTS` objesi içinde her projenin `sutunSirasi:` dizisi | Panoda sütunları sürükleyip yer değiştirdiğinde site OTOMATİK güncellenmez (GitHub API view-sırasını döndürmüyor) — panodaki güncel sırayı, sütun adlarını BİREBİR yazımla (büyük/küçük harf dahil), soldan sağa bu diziye elle yaz. Listede unuttuğun bir alan otomatik sona eklenir, kaybolmaz. `sutunSirasi: []` bırakırsan GitHub'daki field oluşturma sırası kullanılır. |
| Gizlenen "yerleşik" sütunlar | `YERLESIK_ALANLAR` seti | GitHub'ın otomatik eklediği sistem alanları (Assignees, Labels, Reviewers, Created, Updated, vb.) burada listeleniyor ve tabloya hiç girmiyor. GitHub ileride yeni bir sistem alanı eklerse ve sitede gereksiz bir sütun görürsen, o alanın adını (BİREBİR yazımla) bu sete ekle. |
| `GITHUB_TOKEN` | **Kodun içinde YOK** | Cloudflare Dashboard > Settings > Variables and Secrets kısmından secret olarak eklenir. Asla dosyaya yazma. |

## 6. `robots.txt`

`Sitemap:` satırındaki adres, `_config.yml`'deki `url` ile aynı domaini
göstermeli.

## 7. `_includes/hakkimda-icerik.md` ve `_includes/hakkimda-kutusu.md`

Anasayfada görünen "hakkımda" metni ve kutusu — biyografini, unvanını,
tanıtım yazını buraya serbest metin olarak yaz.

## 8. İçerik ekleme — blog yazıları ve akademik projeler

- **Blog yazısı:** `_posts/` klasörüne `YIL-AY-GUN-baslik.md` formatında
  yeni bir dosya ekle (örn. `_posts/2026-09-01-yeni-yazi.md`). `blog.md`
  sayfasına hiç dokunmana gerek yok, otomatik listelenir.
- **Akademik proje:** `_projects/` klasörüne aynı mantıkla yeni bir `.md`
  dosyası ekle (örn. `_projects/2026-yeni-proje.md`). Kullanılabilecek
  front-matter alanları için `_projects/2025-ornek-proje.md` dosyasındaki
  örneğe bak (`title`, `date`, `venue`, `status`, `summary`, `link`,
  `link_label`).

## 9. Zamanlanmış ve gizli yazılar/projeler

Bir yazıyı ya da akademik projeyi GitHub'a hemen ekleyip, sitede **istediğin
tarihe kadar veya sen izin verene kadar** görünmemesini sağlayabilirsin.

### Nasıl çalışır?

**"yayinda" ve "date" artık birbirine bağlı çalışıyor.** Bir yazı/proje
sitede görünmek için **iki şartı BİRDEN** sağlamalı:

1. `yayinda: false` YAZILMAMIŞ olmalı (alan yoksa veya `true` ise sorun yok).
2. `date` alanındaki tarih **gelmiş veya geçmiş** olmalı (gelecekteyse gösterilmez).

Yani:

- `yayinda: true` + `date` **ileri bir tarih** → tarih gelene kadar
  **gösterilmez**, tarih geldiği an (bir sonraki build'de) otomatik görünür.
- `yayinda: true` + `date` **bugün veya geçmiş** → hemen görünür.
- `yayinda: false` + `date` **geçmiş bir tarih olsa bile** → yine de
  **gösterilmez**, sen elle `yayinda: true` yapmadan asla görünmez.
- `yayinda: false` her zaman `yayinda: true`'dan **önceliklidir** —
  yani `date` ne olursa olsun `yayinda: false` varsa sayfa gizlidir.

Front-matter'a şu iki alanı ekle:

```yaml
---
title: "Yazı Başlığı"
date: 2026-09-01
yayinda: true
sitemap: false
permalink: /blog/on-izleme-RASTGELE-BIR-DIZI/
---
```

- **`sitemap: false`**, gizli/zamanlanmış her yazıyla HER ZAMAN birlikte
  yazılmalı (`yayinda: false` olsun ya da ileri tarihli olsun fark etmez).
  Bu, `jekyll-sitemap` eklentisinin kendi tanıdığı resmi bir alan — sadece
  bunu görürse sayfayı `sitemap.xml`'den çıkarıyor, bizim uydurduğumuz
  `yayinda`/`date` mantığını tanımıyor. Yazmazsan sayfa blog listesinde
  görünmez ama sitemap'te görünmeye devam eder.
- **Görünürlük şartları sağlanmadığı sürece** yazı: blog listesinde
  (`blog.md`), akademik projeler listesinde (`akademik-projeler.md`) ve
  RSS feed'inde (`feed.xml`) **görünmez**. `sitemap: false` de site
  haritasından (sitemap.xml) çıkarır. Arama motorlarına ayrıca `noindex`
  sinyali gönderilir (sayfa ziyaret edilse bile indekslenmez) — bu artık
  hem `yayinda: false` hem de "date henüz gelmedi" durumunda otomatik
  devreye giriyor.
- **Sayfanın kendisi yine de var olur** — `permalink` alanında yazdığın
  adresi bilen biri doğrudan girip okuyabilir. Bu senin "manuel paylaşım"
  yöntemin: linki kimseyle paylaşmazsan kimse bulamaz; paylaştığın anda o
  kişi (ve linkin gittiği herkes) okuyabilir.
- **`permalink` MUTLAKA tahmin edilemez, rastgele bir dizi içermeli** —
  `/blog/on-izleme-x7k2p9qz/` gibi. `/blog/yeni-yazi/` gibi tahmin
  edilebilir bir adres KULLANMA, güvenlik tamamen bu adresin gizli
  kalmasına dayanıyor. Rastgele bir dizi üretmek için:
  - Tarayıcının adres çubuğuna `javascript:alert(crypto.randomUUID())`
    yazıp Enter'a basabilirsin (bazı tarayıcılar `javascript:` yapıştırmayı
    engeller, o zaman DevTools > Console'a `crypto.randomUUID()` yaz).
  - Ya da terminalde: `openssl rand -hex 8`
- **`sitemap: false`, görünürlük şartlarından TAMAMEN bağımsız çalışır.**
  Yani front-matter'a elle `sitemap: false` yazmazsan, `yayinda`/`date`
  ne olursa olsun sayfa sitemap.xml'e girer. Zamanlanmış/gizli her yazıda
  bunu yazmayı unutma — `noindex` yine indekslenmesini engeller, ama
  URL'in kendisi sitemap üzerinden "keşfedilebilir" hale gelir.
- **`permalink` alanını silersen** Jekyll dosya adından otomatik bir adres
  üretir (örn. `/blog/2026/09/01/yazi-basligi.html`) — bu tahmin
  edilebilir bir adres olduğu için SADECE normal, açık yazılarda
  `permalink`'i silmelisin. Gizli/zamanlanmış bir yazıda `permalink`'i
  silmek, gizlilik amacını tamamen ortadan kaldırır.
- **Erken yayınlamak istersen** (tarih gelmeden görünsün istersen):
  `date`'i geçmişe çek ya da bugüne eşitle.
- **Bir yazıyı süresiz gizli tutmak istersen:** `yayinda: false` yaz,
  `date`'i hiç düşünme — `yayinda: false` her zaman kazanır.
- **"Belirli bir tarihte otomatik yayınlansın" istersen:** `date:`
  alanını istediğin tarihe ayarlaman ve `yayinda: true` (ya da alanı hiç
  yazmaman) **artık tek başına yeterli** — ama bunun gerçekten
  "otomatik" olması için Cloudflare Pages'in o tarihte YENİ BİR BUILD
  alması gerekiyor, çünkü statik site build zamanındaki tarihe göre
  üretiliyor. Bunun için repo'ya bir GitHub Actions workflow'u eklendi:
  `.github/workflows/zamanlanmis-yayin.yml`. Bu workflow her gün otomatik
  çalışıp Cloudflare Pages'te yeni bir build tetikliyor. **Kurulumu
  (bir kereye mahsus):**
  1. Cloudflare Pages projenin ayarlarından **Deploy Hooks** (Dağıtım
     Kancaları) bölümüne git, yeni bir **Deploy Hook URL** oluştur.
  2. GitHub reponda **Settings → Secrets and variables → Actions →
     New repository secret** ile `CLOUDFLARE_DEPLOY_HOOK_URL` adında bir
     secret oluştur, değerine az önce kopyaladığın URL'i yapıştır.
  3. Bu kadar — workflow her gün otomatik çalışacak. İstersen GitHub'da
     **Actions** sekmesinden **"Run workflow"** ile elle de tetikleyebilirsin
     (örneğin tarihi tam geçtiği an hemen yayınlanmasını istiyorsan).
  4. Cron saatini değiştirmek istersen workflow dosyasındaki `cron:`
     satırını düzenle (yorum satırında açıklama var).
- Örnek bir taslak dosya için `_posts/2026-08-15-ornek-zamanlanmis-yazi.md`
  dosyasına bak — aynı desen `_projects/` için de birebir çalışır (örnek
  alanlar `_projects/2025-ornek-proje.md` içinde yorum satırı olarak var).

### Nerede tanımlı (teknik detay, dokunmana gerek yok ama bilgi için)

- `_config.yml` → `future: true` — sayfanın gelecek tarihli olsa da
  build edilmesini sağlıyor (linkin çalışabilmesi için şart).
- `blog.md`, `akademik-projeler.md`, `feed.xml` → listeleme
  döngülerinde `where_exp: "p", "p.yayinda != false and p.date <= site.time"`
  filtresi — hem `yayinda` hem `date` şartını birlikte kontrol ediyor.
- `sitemap.xml` → `jekyll-sitemap` eklentisi tarafından otomatik
  üretiliyor, front-matter'daki resmi `sitemap: false` alanına kendisi
  bakıyor (bizim `yayinda`/`date` mantığımızdan habersiz, o yüzden ayrı
  yazılması gerekiyor).
- `feed.xml` dosyasının kendisi kökte elle yazılmış durumda — Jekyll'in
  otomatik `jekyll-feed` eklentisi BİLEREK kapatıldı (`_config.yml` ve
  `Gemfile`'den çıkarıldı) çünkü o eklentinin kendi "published: false"
  alanı sayfayı build'den tamamen siliyor, bu da gizli linki kırıyordu.
- `_layouts/default.html` → `page.yayinda == false` VEYA `page.date`
  henüz gelmemişse `<meta name="robots" content="noindex, nofollow">`
  ekliyor.
- `_layouts/post.html`, `_layouts/project.html` → aynı iki durumda
  (gizli ya da henüz zamanı gelmemiş) sayfanın üstünde uygun bir uyarı
  gösteriyor.
- `.github/workflows/zamanlanmis-yayin.yml` → günlük otomatik Cloudflare
  Pages build tetikleyicisi (yukarıdaki kurulum adımlarına bak).

---

# 🎨 Tema Anahtarı (Koyu/Açık Mod)

Header'daki kayan switch — ☀️/🌙 ikonları sabit iki uçta, ortadaki topuz
aktif temaya göre kayıyor, yanında "Açık mod"/"Koyu mod" yazan bir etiket
var.

| Ne | Nerede |
|---|---|
| Yapı (HTML) | `_layouts/default.html` içinde `#theme-toggle` butonu |
| Davranış (JS) | Aynı dosyanın altındaki `<script>` bloğu — `data-theme` özniteliğini değiştirip `localStorage`'a kaydediyor |
| Görünüm (CSS) | `assets/style.css` içinde `.theme-toggle`, `.theme-toggle-track`, `.theme-toggle-thumb`, `.theme-toggle-icon`, `.theme-toggle-label` sınıfları |
| Mobil davranış | 640px altında metin etiketi gizleniyor, sadece anahtar+ikonlar kalıyor (bkz. `style.css`'teki `@media` bloğu) |
| Giscus (yorumlar) senkronizasyonu | `_layouts/default.html`'deki aynı script bloğunda bir `MutationObserver` — `data-theme` her değiştiğinde, o an DOM'da bir giscus yorum kutusu varsa ona `postMessage` ile "temanı değiştir" mesajı gönderiyor. Giscus'un iframe'i geç yüklendiği (`data-loading="lazy"`, kullanıcı yorumlara kaydırana kadar açılmıyor) için bunu tek seferlik değil, sürekli izleyerek yapıyoruz. |

---

# 💬 Yorumlar (Giscus)

| Dosya | Ne işe yarar |
|---|---|
| `_includes/comments.html` | Giscus widget'ını yükleyen kod. `site.giscus.*` ayarları `_config.yml`'den geliyor (bkz. bölüm 1). |
| `assets/style.css` içinde `#giscus-container` / `iframe.giscus-frame` | Yorum kutusunun tam genişlik kullanmasını sağlayan kurallar. Kutu daralmış/küçülmüş görünürse önce burayı kontrol et. |
| Tema senkronizasyonu | Yukarıdaki "Tema Anahtarı" bölümüne bak — giscus'un koyu/açık modu sitenin temasıyla senkron kalması bu mekanizmaya bağlı. |

Giscus'un kendi ayarları (repo, kategori, tema rengi vb.) [giscus.app](https://giscus.app)
üzerinden alınıp `_config.yml`'e yapıştırılıyor — orta bir değişiklik
yapmak istersen (örn. tepki emojilerini kapatmak) giscus.app'te yeni
ayarı oluşturup `_includes/comments.html` içindeki ilgili
`data-*` satırını güncellemen yeterli.

---

# 🗂️ İzlediklerim / Okuduklarım Tablosu

| Dosya | Ne işe yarar |
|---|---|
| `assets/js/koleksiyon-tablo.js` | GitHub Projects verisini Worker'dan çekip tabloyu (arama, tür filtresi, sayfalama dahil) oluşturan ortak kod. Hem `izlediklerim.md` hem `okuduklarim.md` bunu kullanıyor. |
| `izlediklerim.md`, `okuduklarim.md` | Sayfanın kendisi — `koleksiyonTablosuOlustur({...})` çağrısındaki `dataUrl`, `containerId` gibi parametreler hangi projeye (`?project=izleme` / `?project=okuma`) bağlanacağını belirliyor. |
| Sütun sırası/gizlenen sütunlar | Bkz. yukarıdaki bölüm 5 (`cloudflare-worker/worker.js`) — tablonun kendisi değil, worker'ın döndürdüğü veri bu sırayı belirliyor. |

---

# 🔒 Güvenlik Notları (bilmen faydalı olur)

- **CSP (`_layouts/default.html`, `<meta http-equiv="Content-Security-Policy">`):**
  sayfanın hangi domain'lerden script/frame/bağlantı yükleyebileceğini
  sınırlıyor. Yeni bir üçüncü parti servis (örn. yeni bir embed) eklersen
  ve site "kırık" görünürse, önce burada o servisin domain'inin
  `connect-src`/`frame-src`/`script-src`'e eklenmesi gerekip gerekmediğine
  bak.
- **`guvenliLink` fonksiyonu** (`assets/js/koleksiyon-tablo.js` ve
  `blog.md` içinde, aynı isimle iki ayrı yerde) — GitHub/RSS'ten gelen
  linklerin `http(s)://` ile başladığını ve içinde boşluk/kontrol
  karakteri olmadığını doğruluyor, öyle değilse linki `#`'e çeviriyor.
- **`escapeHtml` fonksiyonu** — tabloya/listeye basılan her metin
  (başlıklar, alan adları) HTML'e yazılmadan önce buradan geçiyor, bu
  yüzden GitHub tarafında biri kötü niyetli bir field adı/değeri girse
  bile sitede çalışan koda dönüşemiyor.
- **Substack RSS'i** (`blog.md`) üçüncü parti bir proxy'den
  (`api.allorigins.win`) geçiyor çünkü tarayıcılar farklı bir domain'den
  ham RSS çekmeye (CORS) izin vermiyor. Bu servis kontrolün dışında —
  ileride kendi Worker'ın üzerinden proxy'lemek istersen (daha güvenli
  ama kurulumu daha uzun), ayrı bir adım olarak yapılabilir.
  

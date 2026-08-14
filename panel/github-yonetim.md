---
layout: default
title: "GitHub İçerik Yönetimi"
yayinda: true
auth_css: true
permalink: "/panel/github-yonetim.html"
---

<link rel="stylesheet" href="{{ '/assets/css/github-yonetim.css' | relative_url }}">

<div class="loading-overlay" id="loading">Yükleniyor...</div>

<div id="app" hidden
     data-default-owner="{{ site.github_username }}"
     data-default-repo="{{ site.github_username }}.github.io">
  <h1>GitHub İçerik Yönetimi</h1>
  <p class="muted">
    Bu panel, blog yazılarını ve akademik projeleri doğrudan bu GitHub deponuza
    (<code>_posts/</code> ve <code>_projects/</code>) commit ederek yayınlamanı
    sağlar — 3. parti bir servis gerektirmez, doğrudan GitHub REST API'sini
    kullanır. Üstteki Supabase tabanlı "Admin Paneli"nden tamamen bağımsız
    çalışır; sadece sana (yöneticiye) özeldir.
  </p>

  <nav id="gy-nav" class="admin-tabs">
    <a href="#baglanti" data-section="baglanti" class="active">🔑 GitHub Bağlantısı</a>
    <a href="#icerik-ekle" data-section="icerik-ekle">📝 İçerik Ekle / Düzenle</a>
    <a href="#icerikler" data-section="icerikler">📚 Mevcut İçerikler</a>
    <a href="#klasorler" data-section="klasorler">📁 Klasörler</a>
    <a href="#profil-foto" data-section="profil-foto">🖼️ Profil Fotoğrafı</a>
  </nav>

  <div class="panel-grid">

      <section id="baglanti" class="panel-section">
        <h2>GitHub Bağlantısı</h2>
        <p class="muted">
          Token yalnızca bu sekme açıkken tarayıcının belleğinde tutulur;
          sayfayı yenilediğinde veya sekmeyi kapattığında otomatik olarak
          silinir — hiçbir yerde (localStorage dahil) saklanmaz, bu yüzden
          panele her girişte yeniden yapıştırman gerekir. Kullanıcı adı ve
          repo adı gizli olmadığından, kolaylık için tarayıcında hatırlanır.
        </p>
        <div class="form-field">
          <label for="gh-owner">GitHub Kullanıcı Adı</label>
          <input id="gh-owner" type="text" placeholder="kullanici-adi" autocomplete="off">
        </div>
        <div class="form-field">
          <label for="gh-repo">Repository Adı</label>
          <input id="gh-repo" type="text" placeholder="kullanici-adi.github.io" autocomplete="off">
        </div>
        <div class="form-field">
          <label for="gh-branch">Branch (opsiyonel — boş bırakılırsa reponun varsayılan branch'i kullanılır)</label>
          <input id="gh-branch" type="text" placeholder="main" autocomplete="off">
        </div>
        <div class="form-field">
          <label for="gh-pat">GitHub Personal Access Token (PAT)</label>
          <input id="gh-pat" type="password" autocomplete="off" placeholder="github_pat_xxxxxxxxxxxx">
          <p class="muted" style="margin:4px 0 0;font-size:0.85rem;">
            Fine-grained bir token oluşturup <strong>sadece bu repo</strong>
            için <code>Contents: Read and write</code> iznini vermen yeterli
            ve daha güvenli — tüm hesaba erişen "classic" token yerine bunu
            tercih et.
            <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Token oluştur →</a>
          </p>
        </div>
        <button id="gh-baglan-btn" type="button" class="btn-primary" style="width:auto;">Bağlantıyı Doğrula</button>
        <div id="gh-baglanti-message" class="auth-message" hidden></div>
      </section>

      <section id="icerik-ekle" class="panel-section">
        <h2 id="ic-form-baslik">Yeni İçerik Ekle</h2>

        <div class="form-field">
          <label>İçerik Türü</label>
          <div class="gy-tip-secim">
            <label class="gy-radio"><input type="radio" name="icerik-turu" value="blog" checked> 📰 Blog Yazısı</label>
            <label class="gy-radio"><input type="radio" name="icerik-turu" value="proje"> 🎓 Akademik Proje</label>
          </div>
        </div>

        <form id="icerik-form" novalidate>
          <div class="form-field">
            <label for="ic-title">Başlık</label>
            <input id="ic-title" type="text" required>
          </div>
          <div class="form-field">
            <label for="ic-date">Tarih</label>
            <input id="ic-date" type="date" required>
          </div>
          <div class="form-field">
            <label for="ic-slug">Dosya adı / slug (boş bırakılırsa başlıktan otomatik üretilir)</label>
            <input id="ic-slug" type="text" placeholder="ornek-yazi-basligi" autocomplete="off">
          </div>
          <div class="form-field" id="ic-klasor-wrap">
            <label for="ic-klasor-secim">Klasör (blog yazısının <code>_posts/</code> altında hangi alt klasöre kaydedileceği)</label>
            <select id="ic-klasor-secim">
              <option value="__auto__">Otomatik — tarihe göre yıl klasörü (örn. _posts/2026/)</option>
              <option value="__yeni__">➕ Yeni klasör oluştur…</option>
            </select>
            <input id="ic-klasor-yeni-ad" type="text" placeholder="örn. seyahat ya da 2027" autocomplete="off" hidden style="margin-top:8px;">
            <p class="gy-yardim-metni" id="ic-klasor-yardim">
              "Otomatik" seçiliyken dosya, yukarıdaki tarihin yılına göre
              (<code>_posts/&lt;yıl&gt;/</code>) kaydedilir — hiçbir şey
              yapmana gerek yok. Farklı bir klasör seçersen (örn. konuya
              göre <code>_posts/seyahat/</code> ya da farklı bir yıl)
              dosya SEÇTİĞİN klasöre gider; hangi klasörde durduğu
              yazının linkini (permalink'ini) ETKİLEMEZ, link her zaman
              tarih ve slug'dan üretilir. Yeni klasörleri "📁 Klasörler"
              sekmesinden de yönetebilirsin (oluşturma, yeniden
              adlandırma, silme).
            </p>
          </div>
          <div class="form-field" id="ic-yil-oneki-wrap" hidden>
            <label class="gy-checkbox"><input id="ic-yil-oneki" type="checkbox"> Dosya adına yıl önekini ekle (<code>YYYY-slug.md</code>)</label>
          </div>

          <div id="ic-proje-alanlar" hidden>
            <div class="form-field">
              <label for="ic-venue">Venue (Mekan / Mecra)</label>
              <input id="ic-venue" type="text" placeholder="Dergi / Konferans Adı veya Kaynakça">
            </div>
            <div class="form-field">
              <label for="ic-status">Durum</label>
              <select id="ic-status">
                <option value="Yayınlandı">Yayınlandı</option>
                <option value="Devam Ediyor">Devam Ediyor</option>
                <option value="İnceleme Aşamasında">İnceleme Aşamasında</option>
              </select>
            </div>
            <div class="form-field">
              <label for="ic-summary">Özet (listeleme sayfasında görünür, 1-2 cümle)</label>
              <input id="ic-summary" type="text">
            </div>
            <div class="form-field">
              <label for="ic-link">Dış Bağlantı URL (opsiyonel)</label>
              <input id="ic-link" type="url" placeholder="https://...">
            </div>
            <div class="form-field">
              <label for="ic-link-label">Bağlantı Etiketi (opsiyonel)</label>
              <input id="ic-link-label" type="text" placeholder="Makaleyi Oku">
            </div>
          </div>

          <div class="form-field">
            <label for="ic-body">İçerik (Markdown)</label>
            <div class="gy-editor-toolbar" role="toolbar" aria-label="Markdown biçimlendirme">
              <span class="gy-editor-grup">
                <button type="button" data-md="bold" title="Kalın (**metin**)"><strong>K</strong></button>
                <button type="button" data-md="italic" title="İtalik (*metin*)"><em>İ</em></button>
                <button type="button" data-md="strikethrough" title="Üstü çizili (~~metin~~)"><s>Ü</s></button>
                <button type="button" data-md="inline-code" title="Satır içi kod (`kod`)">&lt;/&gt;</button>
              </span>
              <span class="gy-editor-ayrac" aria-hidden="true"></span>
              <span class="gy-editor-grup">
                <button type="button" data-md="h2" title="Başlık (## metin)">H2</button>
                <button type="button" data-md="h3" title="Alt başlık (### metin)">H3</button>
                <button type="button" data-md="h4" title="Alt-alt başlık (#### metin)">H4</button>
              </span>
              <span class="gy-editor-ayrac" aria-hidden="true"></span>
              <span class="gy-editor-grup">
                <button type="button" data-md="list" title="Madde işaretli liste (- madde)">≡</button>
                <button type="button" data-md="ordered-list" title="Numaralı liste (1. madde)">1.</button>
                <button type="button" data-md="task-list" title="Yapılacaklar listesi (- [ ] madde)">☑</button>
              </span>
              <span class="gy-editor-ayrac" aria-hidden="true"></span>
              <span class="gy-editor-grup">
                <button type="button" data-md="quote" title="Alıntı (&gt; metin)">❝</button>
                <button type="button" data-md="code-block" title="Kod bloğu (```)">{ }</button>
                <button type="button" data-md="hr" title="Yatay çizgi (---)">―</button>
                <button type="button" data-md="table" title="Tablo şablonu (2 sütun)">▦</button>
              </span>
              <span class="gy-editor-ayrac" aria-hidden="true"></span>
              <span class="gy-editor-grup">
                <button type="button" data-md="link" title="Bağlantı ([metin](url))">🔗</button>
                <button type="button" data-md="image" title="Görsel — dış URL ile (![açıklama](url))">🖼️</button>
              </span>
            </div>
            <textarea id="ic-body" rows="14" placeholder="Markdown formatında içeriğini buraya yaz..."></textarea>
          </div>

          <div class="form-field">
            <label class="gy-toggle-satir" for="ic-yayinda">
              <span class="gy-toggle">
                <input id="ic-yayinda" type="checkbox" checked role="switch">
                <span class="gy-toggle-track"><span class="gy-toggle-thumb"></span></span>
              </span>
              <span class="gy-toggle-metin">
                <strong>Yayında</strong>
                <span class="muted">
                  Kapatırsan içerik blog/proje listesinden ve arama motorlarından
                  gizlenir; yalnızca aşağıdaki ön izleme linkine sahip olanlar
                  görebilir. Link her zaman burada görüntülenebilir ve
                  düzenlenebilir, içeriği görüntülerken de erişilebilir kalır;
                  istediğin an tekrar düzenleyip yayına alabilirsin.
                </span>
              </span>
            </label>
          </div>
          <div id="ic-onizleme-kutusu" class="gy-onizleme-kutusu" hidden>
            <div class="gy-onizleme-baslik">🔒 Gizli ön izleme linki</div>
            <p class="muted">
              Sadece bu linki bilenler görebilir. Kod otomatik üretilir;
              istersen aşağıdan kendi kodunu yazabilir ya da zar butonuyla
              yeni bir tane üretebilirsin — link, sayfayı yayına alana kadar
              her an burada görüntülenebilir ve değiştirilebilir.
            </p>
            <div class="gy-link-kutu">
              <span class="gy-onizleme-onek" id="ic-onizleme-onek"></span>
              <input type="text" id="ic-onizleme-kod" class="gy-onizleme-kod-girdi"
                     placeholder="ozel-kod" autocomplete="off" spellcheck="false">
              <button type="button" id="ic-onizleme-yenile-btn" class="gy-link-kopyala-btn" title="Yeni rastgele kod üret">🎲 Yenile</button>
            </div>
            <div class="gy-link-kutu">
              <input type="text" id="ic-onizleme-link" readonly onclick="this.select()">
              <button type="button" id="ic-onizleme-kopyala-btn" class="gy-link-kopyala-btn">Kopyala</button>
            </div>
          </div>

          <div style="display:flex; gap:10px; flex-wrap: wrap;">
            <button type="submit" id="ic-submit-btn" class="btn-primary" style="width:auto;">GitHub'a Yayınla</button>
            <button type="button" id="ic-iptal-btn" class="btn-danger" style="width:auto;" hidden>Düzenlemeyi İptal Et</button>
          </div>
        </form>
        <div id="ic-message" class="auth-message" hidden></div>
      </section>

      <section id="icerikler" class="panel-section">
        <h2>Mevcut İçerikler</h2>
        <p class="muted">Önce "GitHub Bağlantısı" sekmesinden bağlantını doğrula, sonra listeyi yükle.</p>
        <button id="ic-liste-yenile-btn" type="button" class="btn-primary" style="width:auto; margin-bottom:12px;">Listeyi Yükle / Yenile</button>

        <div class="gy-liste-araclar">
          <div class="gy-arama-kutu">
            <span class="gy-arama-ikon" aria-hidden="true">🔎</span>
            <input id="ic-liste-arama" type="search" placeholder="Başlık, dosya adı veya özet içinde ara..." autocomplete="off">
            <button type="button" id="ic-liste-arama-temizle" class="gy-arama-temizle" hidden aria-label="Aramayı temizle">✕</button>
          </div>
          <div class="gy-tur-sekmeleri" role="tablist" aria-label="İçerik türüne göre filtrele">
            <button type="button" class="gy-tur-sekme active" data-filtre-tur="tum" role="tab" aria-selected="true">Tümü</button>
            <button type="button" class="gy-tur-sekme" data-filtre-tur="blog" role="tab" aria-selected="false">📰 Blog</button>
            <button type="button" class="gy-tur-sekme" data-filtre-tur="proje" role="tab" aria-selected="false">🎓 Projeler</button>
          </div>
          <div class="gy-durum-sekmeleri" role="tablist" aria-label="Yayın durumuna göre filtrele">
            <button type="button" class="gy-durum-sekme active" data-filtre-durum="tum" role="tab" aria-selected="true">Tümü</button>
            <button type="button" class="gy-durum-sekme" data-filtre-durum="yayinda" role="tab" aria-selected="false">Yayında</button>
            <button type="button" class="gy-durum-sekme" data-filtre-durum="gizli" role="tab" aria-selected="false">Gizli</button>
          </div>
        </div>

        <div id="ic-liste"><p class="muted">Henüz yüklenmedi.</p></div>
        <p id="ic-liste-sonuc-yok" class="muted" hidden>Aramanla/filtrenle eşleşen içerik bulunamadı.</p>
      </section>

      <section id="klasorler" class="panel-section">
        <h2>Klasörler (<code>_posts/</code> altındaki alt klasörler)</h2>
        <p class="muted">
          Blog yazıların <code>_posts/</code> altında alt klasörlerde tutulur
          (varsayılan olarak yıla göre, örn. <code>_posts/2026/</code>) —
          hangi klasörde durdukları yazının linkini (permalink'ini)
          ETKİLEMEZ, sadece depodaki dosya organizasyonunu ilgilendirir.
          Burada yeni bir klasör oluşturabilir, mevcut bir klasörü yeniden
          adlandırabilir (içindeki tüm dosyalar yeni klasöre taşınır) ya da
          BOŞ bir klasörü silebilirsin. GitHub'da "gerçek" boş klasör
          kavramı olmadığı için yeni klasör oluşturma işlemi, o klasörün
          içine görünmez küçük bir <code>.gitkeep</code> dosyası ekleyerek
          yapılır — bu dosya klasörü var eder ama sitede hiçbir şekilde
          görünmez veya listelenmez.
        </p>
        <button id="kl-liste-yenile-btn" type="button" class="btn-primary" style="width:auto; margin-bottom:12px;">Klasörleri Yükle / Yenile</button>

        <div class="gy-klasor-olustur">
          <input id="kl-yeni-ad" type="text" placeholder="Yeni klasör adı (örn. 2027 ya da seyahat)" autocomplete="off">
          <button id="kl-olustur-btn" type="button" class="btn-primary" style="width:auto;">➕ Klasör Oluştur</button>
        </div>
        <div id="kl-message" class="auth-message" hidden></div>

        <div id="kl-liste"><p class="muted">Henüz yüklenmedi.</p></div>
      </section>

      <section id="profil-foto" class="panel-section">
        <h2>Profil Fotoğrafı Yönetimi</h2>
        <p class="muted">
          Sitede favicon ve profil resmi olarak kullanılan dosyayı (yolu
          <code>_config.yml → profile_image</code> alanından otomatik
          okunur, dosya adı/uzantısı ne olursa olsun) buradan görüntüle,
          değiştir veya sil. Yeni bir fotoğraf yüklediğinde dosya adı
          eskisinden farklı olabilir — panel yeni dosyayı ekler, eskisini
          siler ve <code>_config.yml</code>'i otomatik günceller.
        </p>
        <div id="pf-mevcut" class="gy-profil-onizleme">
          <p class="muted">Görüntülemek için önce bağlantıyı doğrula.</p>
        </div>
        <div class="form-field">
          <label for="pf-dosya">Yeni Fotoğraf Seç</label>
          <input id="pf-dosya" type="file" accept="image/*">
        </div>
        <div style="display:flex; gap:10px; flex-wrap: wrap;">
          <button id="pf-yukle-btn" type="button" class="btn-primary" style="width:auto;">Yükle / Değiştir</button>
          <button id="pf-sil-btn" type="button" class="btn-danger" style="width:auto;">Profil Fotoğrafını Sil</button>
        </div>
        <div id="pf-message" class="auth-message" hidden></div>
      </section>

  </div>
</div>

<script type="module" src="{{ '/assets/js/github-yonetim.js' | relative_url }}"></script>

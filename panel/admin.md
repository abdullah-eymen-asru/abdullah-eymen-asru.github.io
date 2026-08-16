---
layout: default
title: "Admin Paneli"
yayinda: true
auth_css: true
permalink: "/panel/admin.html"
---

<div class="loading-overlay" id="loading">Yükleniyor...</div>

<div id="app" hidden>
  <h1>Admin Paneli</h1>

  <!--
    "Kullanıcılar & Roller" ve "Mesajlar" bölümleri BURADAN, ayrı sayfalara
    taşındı (bkz. panel/uye-ayarlari.md ve panel/mesajlar.md başındaki
    notlar). Sebep: üye sayısı 100+'a çıkınca bu iki bölüm sayfayı aşırı
    uzatıyor, diğer bölümleri (içerik yönetimi, dosya paylaşımı) aşağı
    itiyordu. Aşağıdaki iki sekme artık sayfa-içi anchor değil, DOĞRUDAN
    o sayfalara giden linkler — bu yüzden data-section niteliği YOK (bkz.
    admin.js -> wireSectionNav(), sadece data-section'lı linkleri
    "sayfa içi kaydır" olarak ele alıyor; bunlar normal navigasyonla açılır).
  -->
  <nav id="admin-nav" class="admin-tabs">
    <a id="admin-nav-uye-ayarlari" href="{{ '/panel/uye-ayarlari.html' | relative_url }}">👤 Üye Ayarları</a>
    <a href="#icerik-ekle" data-section="icerik-ekle" class="active">📝 Özel İçerik Ekle/Düzenle</a>
    <a href="#icerikler" data-section="icerikler">📚 Mevcut Özel İçerikler</a>
    <a href="#dosya-paylasim" data-section="dosya-paylasim">🔗 R2 Dosya Paylaşımı</a>
    <a id="admin-nav-mesajlar" href="{{ '/panel/mesajlar.html' | relative_url }}">💬 Sohbet/Mesajlar</a>
    <a href="#hesabim" data-section="hesabim">⚙️ Hesabım</a>
  </nav>

  <div class="panel-grid">

      <section id="icerik-ekle" class="panel-section">
        <h2 id="icerik-form-baslik">Yeni Özel İçerik / Makale Ekle</h2>
        <p class="muted">
          Aşağıya gizli bir makale yazabilir ve/veya bir dosya ekleyebilirsin.
          Alttaki listeden hangi özel üyelerin erişebileceğini ve (istersen)
          o üye için erişimin ne zaman sona ereceğini seç. Tarih boş
          bırakılırsa erişim sınırsızdır.
        </p>
        <form id="icerik-form" novalidate>
          <div class="form-field">
            <label for="title">Başlık</label>
            <input id="title" name="title" type="text" required>
          </div>
          <div class="form-field">
            <label for="slug">Slug (boş bırakılırsa başlıktan otomatik üretilir)</label>
            <input id="slug" name="slug" type="text" placeholder="ozel-makale-1">
          </div>
          <div class="form-field">
            <label for="summary">Kısa Özet</label>
            <input id="summary" name="summary" type="text">
          </div>
          <div class="form-field">
            <label for="body_md">Makale İçeriği (Markdown)</label>
            <textarea id="body_md" name="body_md" rows="10"></textarea>
          </div>
          <div class="form-field">
            <label for="dosya">Ek Dosya (opsiyonel, küçük/orta boy dosyalar için)</label>
            <input id="dosya" name="dosya" type="file">
          </div>
          <div class="form-field">
            <label for="harici_dosya_url">50GB gibi çok büyük dosya için harici link (opsiyonel)</label>
            <input id="harici_dosya_url" name="harici_dosya_url" type="url" placeholder="https://pub-xxxx.r2.dev/dosya-adi.zip">
            <p class="muted" style="margin:2px 0 0;font-size:0.85rem;">
              Dosyayı Supabase yerine Cloudflare R2'ye yüklediysen oradan aldığın linki buraya yapıştır.
              Yukarıdaki "Ek Dosya" alanıyla aynı anda kullanma.
            </p>
          </div>
          <div class="form-field">
            <label>Erişim Verilecek Özel Üyeler / Yöneticiler (isteğe bağlı son geçerlilik tarih &amp; saatiyle, Türkiye saati)</label>
            <div class="form-field atama-arama">
              <input id="icerik-atama-arama" type="search" placeholder="Üye ara (isim veya e-posta)...">
            </div>
            <div id="icerik-atama-liste" class="atama-liste"><p class="muted">Yükleniyor...</p></div>
          </div>
          <div style="display:flex; gap:10px;">
            <button type="submit" id="icerik-form-submit-btn" class="btn-primary" style="width:auto;">Yayınla ve Ata</button>
            <button type="button" id="icerik-duzenle-iptal-btn" class="btn-danger" style="width:auto;" hidden>Düzenlemeyi İptal Et</button>
          </div>
        </form>
        <div id="icerik-message" class="auth-message" hidden></div>
      </section>

      <section id="icerikler" class="panel-section">
        <h2>Mevcut Özel İçerikler</h2>
        <p class="muted">Bir içeriği yayınladıktan sonra da "Düzenle" ile geri dönüp değiştirebilirsin.</p>
        <div id="icerik-liste"><p class="muted">Yükleniyor...</p></div>
      </section>

      <section id="dosya-paylasim" class="panel-section">
        <h2>R2 Dosya Paylaşımı</h2>
        <p class="muted">
          Cloudflare R2 bucket'ındaki (<code>abdullah-eymen-asru-site-ozel-dosyalar</code>)
          HERHANGİ BİR dosya yolu (key) için tek tıkla süreli (presigned)
          indirme linki üret ve panoya kopyala. Dosya yolunu R2 Dashboard'dan
          veya yukarıdaki "Özel İçerik" formunda yüklediğin dosyaların
          yolundan (<code>içerik-id/dosya-adi</code>) alabilirsin.
        </p>
        <div class="form-field">
          <label for="r2-dosya-key">Dosya Yolu (R2 key)</label>
          <input id="r2-dosya-key" type="text" placeholder="ör. 3f2504e0-4f89-.../rapor.pdf">
        </div>
        <div class="form-field">
          <label for="r2-gecerlilik-saniye">Geçerlilik Süresi (saniye)</label>
          <input id="r2-gecerlilik-saniye" type="number" min="60" step="60" value="3600">
        </div>
        <button id="r2-link-uret-btn" type="button" class="btn-primary" style="width:auto;">
          İmzalı Link Üret
        </button>
        <div id="r2-link-sonuc" class="auth-message" hidden></div>
        <div id="r2-link-kutu-wrap" class="form-field" hidden style="margin-top:10px;">
          <label for="r2-link-kutu">Üretilen Link (seçip kopyalayabilirsin)</label>
          <input id="r2-link-kutu" type="text" readonly onclick="this.select()">
        </div>
      </section>

      <section id="hesabim" class="panel-section danger-zone">
        <h2>Hesabım — Tehlikeli Bölge</h2>
        <p>
          Kendi yönetici hesabını da buradan silebilirsin. Diğer üyelerin
          hesaplarını silmek için <a href="{{ '/panel/uye-ayarlari.html' | relative_url }}">Üye Ayarları</a>
          sayfasındaki <strong>Sil</strong> butonunu kullan.
        </p>
        <p>Hesabını sildiğinde profilin ve özel içerik erişimlerin dahil TÜM
        verilerin kalıcı olarak silinir. Bu işlem geri alınamaz.</p>
        <div class="form-field">
          <label for="admin-kendi-hesap-sil-onay">Onaylamak için kutuya büyük harflerle <strong>SİL</strong> yaz</label>
          <input id="admin-kendi-hesap-sil-onay" type="text" autocomplete="off">
        </div>
        <button id="admin-kendi-hesap-sil-btn" type="button" class="btn-danger">Hesabımı Kalıcı Olarak Sil</button>
        <div id="admin-kendi-hesap-sil-message" class="auth-message" hidden></div>
        <p style="margin-top:16px;"><a href="{{ '/panel/panel.html' | relative_url }}">← Panelim sayfasına git (şifre değiştir, 2FA, KVKK)</a></p>
      </section>

  </div>
</div>

<script type="module" src="{{ '/assets/js/admin.js' | relative_url }}"></script>

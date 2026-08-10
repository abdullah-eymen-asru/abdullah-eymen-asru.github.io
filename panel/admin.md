---
layout: default
title: "Admin Paneli"
yayinda: true
permalink: "/panel/admin.html"
---

<link rel="stylesheet" href="{{ '/assets/css/auth.css' | relative_url }}">

<div class="loading-overlay" id="loading">Yükleniyor...</div>

<div id="app" hidden>
  <h1>Admin Paneli</h1>

  <div class="admin-layout">

    <nav id="admin-nav" class="admin-nav">
      <a href="#kullanicilar" data-section="kullanicilar" class="active">👤 Kullanıcılar &amp; Roller</a>
      <a href="#icerik-ekle" data-section="icerik-ekle">📝 Özel İçerik Ekle/Düzenle</a>
      <a href="#icerikler" data-section="icerikler">📚 Mevcut Özel İçerikler</a>
      <a href="#dosya-paylasim" data-section="dosya-paylasim">🔗 R2 Dosya Paylaşımı</a>
      <a href="#mesajlar" data-section="mesajlar">💬 Mesajlar</a>
      <a href="#hesabim" data-section="hesabim">⚙️ Hesabım</a>
    </nav>

    <div class="admin-content">

      <section id="kullanicilar" class="panel-section">
        <h2>Kullanıcılar &amp; Roller</h2>
        <p class="muted">Bir kullanıcının rolünü değiştirmek için aşağıdaki listeden seç — anında kaydedilir. İsim veya e-posta ile arayabilirsin.</p>
        <div class="form-field">
          <label for="kullanici-arama">Ara (isim veya e-posta)</label>
          <input id="kullanici-arama" type="search" placeholder="ör. ayse@ornek.com veya Ayşe">
        </div>
        <p class="muted" style="font-size:0.85rem;">
          Geniş ekranlarda tablo yana taşarsa "E-posta Değiştir" ve "Sil"
          butonlarını görmek için sağa doğru kaydır (↔). Telefon gibi dar
          ekranlarda her kullanıcı otomatik olarak kendi kartında, tüm
          bilgiler ve butonlarla birlikte görünür.
        </p>
        <div class="rol-tablo-wrap" style="overflow-x:auto;">
        <table class="rol-tablo">
          <thead>
            <tr><th>Kullanıcı</th><th>Kayıt</th><th>Rol</th><th>KVKK</th><th></th></tr>
          </thead>
          <tbody id="kullanici-tablo-govde">
            <tr><td colspan="5">Yükleniyor...</td></tr>
          </tbody>
        </table>
        </div>

        <!-- "E-posta Değiştir" butonuna basılınca renderUserTable() bu alanı
             doldurup gösterir: seçili kullanıcının adı + yeni e-posta formu.
             E-posta hiçbir mail gönderilmeden ANINDA değişir, eski adres
             gerekmez (bkz. admin.js -> wireAdminEmailChange() ve Edge
             Function admin-change-email). -->
        <div id="admin-eposta-degistir-kutu" class="panel-section" hidden style="margin-top:16px; background:var(--bg);">
          <h3 style="margin-top:0;">E-postasını Değiştir: <span id="admin-eposta-hedef-isim"></span></h3>
          <p class="muted">
            Bu, kullanıcının kendi panelinden yaptığı değişiklikten FARKLIDIR:
            e-posta <strong>hiçbir mail gönderilmeden, anında</strong> değişir
            — ne eski ne yeni adrese onay maili gitmez, eski adrese erişim
            gerekmez. Bu yüzden bu bölümü SADECE kullanıcı eski mailine
            erişemediği için seninle iletişime geçtiyse ve kimliğini (ör.
            panel üzerinden gönderdiği mesajla) doğruladıysan kullan — asıl
            "kimlik doğrulama" adımı burada senin elle yaptığın kontroldür.
          </p>
          <form id="admin-eposta-degistir-form" novalidate>
            <input type="hidden" id="admin-eposta-hedef-id">
            <div class="form-field">
              <label for="admin-eposta-yeni">Yeni E-posta</label>
              <input id="admin-eposta-yeni" type="email" autocomplete="off" required>
            </div>
            <div style="display:flex; gap:10px;">
              <button type="submit" class="btn-primary" style="width:auto;">E-postayı Şimdi Değiştir</button>
              <button type="button" id="admin-eposta-degistir-iptal-btn" class="btn-secondary" style="width:auto;">Vazgeç</button>
            </div>
          </form>
          <div id="admin-eposta-message" class="auth-message" hidden></div>
        </div>
      </section>

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

      <section id="mesajlar" class="panel-section">
        <h2>Mesajlar</h2>
        <p class="muted">Üyelerin sana gönderdiği mesajlar. Soldan bir konuşma seç.</p>
        <div id="chat-admin" class="chat-admin-layout">
          <div id="chat-konusma-liste" class="chat-konusma-liste"><p class="chat-bos">Yükleniyor...</p></div>
          <div class="chat-box">
            <p id="chat-secili-kullanici" class="muted" style="padding:10px 12px 0;">Bir konuşma seç.</p>
            <div id="chat-mesaj-liste-admin" class="chat-mesaj-liste"></div>
            <form id="chat-form-admin" class="chat-form" novalidate hidden>
              <textarea id="chat-metin-admin" placeholder="Yanıtını yaz..." required></textarea>
              <button type="submit">Gönder</button>
            </form>
          </div>
        </div>
        <div id="chat-message-admin" class="auth-message" hidden></div>
      </section>

      <section id="hesabim" class="panel-section danger-zone">
        <h2>Hesabım — Tehlikeli Bölge</h2>
        <p>
          Kendi yönetici hesabını da buradan silebilirsin. Diğer üyelerin
          hesaplarını silmek için "Kullanıcılar &amp; Roller" bölümündeki
          <strong>Sil</strong> butonunu kullan.
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
</div>

<script type="module" src="{{ '/assets/js/admin.js' | relative_url }}"></script>

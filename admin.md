---
layout: default
title: "Admin Paneli"
yayinda: true
---

<link rel="stylesheet" href="{{ '/assets/css/auth.css' | relative_url }}">

<div class="loading-overlay" id="loading">Yükleniyor...</div>

<div id="app" hidden>
  <h1>Admin Paneli</h1>

  <div class="panel-grid">

    <section class="panel-section">
      <h2>Kullanıcılar &amp; Roller</h2>
      <p class="muted">Bir kullanıcının rolünü değiştirmek için aşağıdaki listeden seç — anında kaydedilir.</p>
      <table class="rol-tablo">
        <thead>
          <tr><th>Kullanıcı</th><th>Kayıt</th><th>Rol</th><th></th></tr>
        </thead>
        <tbody id="kullanici-tablo-govde">
          <tr><td colspan="4">Yükleniyor...</td></tr>
        </tbody>
      </table>
    </section>

    <section class="panel-section">
      <h2>Yeni Özel İçerik / Makale Ekle</h2>
      <p class="muted">
        Aşağıya gizli bir makale yazabilir ve/veya bir dosya ekleyebilirsin.
        Alttaki listeden hangi özel üyelerin erişebileceğini seç.
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
            Bkz. README &gt; "Çok Büyük Dosyalar (Cloudflare R2)". Yukarıdaki "Ek Dosya" alanıyla
            aynı anda kullanma — ikisi farklı senaryolar için, karışıklık olmasın diye sadece birini doldur.
          </p>
        </div>
        <div class="form-field">
          <label for="icerik-atama-kullanici">Erişim Verilecek Özel Üyeler (Ctrl/Cmd basılı tut, birden çok seç)</label>
          <select id="icerik-atama-kullanici" multiple size="6"></select>
        </div>
        <button type="submit" class="btn-primary">Yayınla ve Ata</button>
      </form>
      <div id="icerik-message" class="auth-message" hidden></div>
    </section>

    <section class="panel-section">
      <h2>Mevcut Özel İçerikler</h2>
      <div id="icerik-liste"><p class="muted">Yükleniyor...</p></div>
    </section>

    <section class="panel-section">
      <h2>"Hakkımda" Metni</h2>
      <p class="muted">
        Buradaki metin anasayfadaki statik "Hakkımda" kutusunun üzerine
        gelir (JS ile). Değişiklik, sayfa yeniden yüklendiğinde herkese görünür.
      </p>
      <form id="ayarlar-form" novalidate>
        <div class="form-field">
          <label for="hakkimda-textarea">Hakkımda (Markdown)</label>
          <textarea id="hakkimda-textarea" rows="8"></textarea>
        </div>
        <button type="submit" class="btn-primary">Kaydet</button>
      </form>
      <div id="ayarlar-message" class="auth-message" hidden></div>
    </section>

  </div>
</div>

<script type="module" src="{{ '/assets/js/admin.js' | relative_url }}"></script>

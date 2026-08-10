---
layout: default
title: "Panelim"
yayinda: true
permalink: "/panel/panel.html"
---

<link rel="stylesheet" href="{{ '/assets/css/auth.css' | relative_url }}">

<div class="loading-overlay" id="loading">Yükleniyor...</div>

<div id="app" hidden>
  <h1>Panelim</h1>
  <p>
    <strong id="panel-email"></strong> ·
    <span class="muted">Rol: <span id="panel-rol"></span></span> ·
    <a href="#" id="cikis-btn">Çıkış Yap</a>
  </p>

  <div class="panel-grid">

    <section class="panel-section">
      <h2>Profil Bilgileri</h2>
      <form id="profil-form" novalidate>
        <div class="form-field">
          <label for="full_name">Ad Soyad</label>
          <input id="full_name" name="full_name" type="text">
        </div>
        <button type="submit" class="btn-primary">Kaydet</button>
      </form>
      <div id="profil-message" class="auth-message" hidden></div>
    </section>

    <section class="panel-section">
      <h2>E-posta Değiştir</h2>
      <p class="muted">
        Güvenlik için e-posta değişikliği <strong>çift onaylıdır</strong>: hem şu anki
        (eski) hem de yeni adresine ayrı ayrı bir onay maili gider ve değişikliğin
        tamamlanması için <strong>ikisinin de</strong> onaylanması gerekir. Bu sayede
        hesabına biri izinsiz erişse bile eski adresin sahibi olmadan e-posta
        değiştirilemez.
      </p>
      <form id="eposta-degistir-form" novalidate>
        <div class="form-field">
          <label for="yeni_eposta">Yeni E-posta</label>
          <input id="yeni_eposta" name="yeni_eposta" type="email" autocomplete="email" required>
        </div>
        <button type="submit" class="btn-primary">Onay Linklerini Gönder</button>
      </form>
      <div id="eposta-spam-notice" class="auth-spam-notice" hidden></div>
      <div id="eposta-message" class="auth-message" hidden></div>

      <!-- İstek gönderildikten sonra initEpostaDegistir() bu alanı doldurup
           gösterir: hem eski hem yeni adres için ayrı durum satırı + "linke
           tıklayamıyorsan kodla onayla" formu (yedek yol). -->
      <div id="eposta-onay-alani" hidden style="margin-top:18px;">
        <div class="eposta-onay-satiri">
          <div class="eposta-onay-baslik">
            <span id="eposta-onay-eski-durum" class="eposta-onay-rozet">Bekleniyor</span>
            Eski adres (<span id="eposta-onay-eski-adres"></span>)
          </div>
          <button type="button" class="btn-secondary eposta-onay-kod-toggle" data-hedef="eski">
            Linke tıklayamıyor musun? Kod ile onayla
          </button>
          <form class="eposta-onay-kod-form" data-hedef="eski" novalidate hidden>
            <div class="form-field">
              <label for="eposta-kod-eski">Eski adrese gelen kod</label>
              <input id="eposta-kod-eski" type="text" inputmode="numeric" autocomplete="one-time-code" required>
            </div>
            <button type="submit" class="btn-primary">Kodu Doğrula</button>
          </form>
        </div>

        <div class="eposta-onay-satiri">
          <div class="eposta-onay-baslik">
            <span id="eposta-onay-yeni-durum" class="eposta-onay-rozet">Bekleniyor</span>
            Yeni adres (<span id="eposta-onay-yeni-adres"></span>)
          </div>
          <button type="button" class="btn-secondary eposta-onay-kod-toggle" data-hedef="yeni">
            Linke tıklayamıyor musun? Kod ile onayla
          </button>
          <form class="eposta-onay-kod-form" data-hedef="yeni" novalidate hidden>
            <div class="form-field">
              <label for="eposta-kod-yeni">Yeni adrese gelen kod</label>
              <input id="eposta-kod-yeni" type="text" inputmode="numeric" autocomplete="one-time-code" required>
            </div>
            <button type="submit" class="btn-primary">Kodu Doğrula</button>
          </form>
        </div>

        <p class="muted" style="font-size:0.85rem; margin-top:8px;">
          Eski adresine artık erişimin yoksa değişikliği tamamlayamazsın —
          bu, hesabının kötüye kullanılmasını önlemek için bilinçli bir
          kısıtlamadır. Aşağıdaki "Eski Mailime Erişemiyorum" kutusundan
          site yöneticisiyle iletişime geçebilirsin.
        </p>
      </div>
    </section>

    <!-- Eski adresine hiç erişimi kalmamış kullanıcılar için: yukarıdaki
         çift onaylı akışı tamamlayamazlar, tek çözüm site yöneticisinin
         admin panelinden değişikliği yapması (admin panelinde e-posta
         hiçbir mail beklemeden ANINDA değişir — bkz. admin.js ->
         wireAdminEmailChange() ve Edge Function admin-change-email). Bu
         kutu her zaman görünür (sadece form gönderildikten sonra değil)
         çünkü kullanıcı hiç denemeden de doğrudan buraya gelip yardım
         isteyebilir. -->
    <section class="panel-section" id="eposta-yardim">
      <h2>Eski Mailime Erişemiyorum</h2>
      <p class="muted">
        Yukarıdaki "E-posta Değiştir" için eski adresine de onay vermen
        gerekiyor. Eğer o adrese artık erişimin yoksa (şifresini unuttun,
        hesabı kapattın, vb.) kendi başına tamamlayamazsın — bu durumda
        site yöneticisine ulaşman gerekir. Yönetici, admin panelinden senin
        adına e-postanı <strong>hiçbir mail beklemeden, anında</strong>
        güncelleyebilir; işlem bittiğinde ekstra bir onay yapmana gerek
        kalmadan yeni adresinle giriş yapabilirsin. Yöneticiye ulaşmak için:
      </p>
      <div style="display:flex; gap:10px; flex-wrap:wrap;">
        <a href="#chat-kullanici" id="eposta-yardim-mesaj-link" class="btn-primary" style="width:auto; text-decoration:none; display:inline-block; text-align:center;">
          Yöneticiyle Mesajlaş
        </a>
        <a href="{{ '/kurumsal/iletisim.html' | relative_url }}" class="btn-secondary" style="width:auto; text-decoration:none; display:inline-block; text-align:center;">
          İletişim Formuna Git
        </a>
      </div>
      <p class="muted" style="font-size:0.85rem; margin-top:10px;">
        Mesajında yeni e-posta adresini ve kimliğini doğrulayacak bilgileri
        (ör. kayıtlı ad-soyadın) belirtmen, yöneticinin işlemi hızlıca
        yapabilmesini sağlar. Yönetici işlemi tamamladıktan sonra sana
        haber verecektir — beklemeden yeni adresinle giriş yapmayı
        deneyebilirsin.
      </p>
    </section>

    <section class="panel-section">
      <h2>Şifre Değiştir</h2>
      <form id="sifre-degistir-form" novalidate>
        <div class="form-field">
          <label for="yeni_sifre">Yeni Şifre</label>
          <input id="yeni_sifre" name="yeni_sifre" type="password" minlength="8" required>
        </div>
        <div class="form-field">
          <label for="yeni_sifre_tekrar">Yeni Şifre (Tekrar)</label>
          <input id="yeni_sifre_tekrar" name="yeni_sifre_tekrar" type="password" minlength="8" required>
        </div>
        <button type="submit" class="btn-primary">Şifreyi Değiştir</button>
      </form>
      <div id="sifre-message" class="auth-message" hidden></div>
    </section>

    <section class="panel-section">
      <h2>İki Faktörlü Doğrulama (2FA)</h2>
      <div id="mfa-alani"><p class="muted">Yükleniyor...</p></div>
    </section>

    <section class="panel-section">
      <h2>KVKK Onayı</h2>
      <div id="kvkk-durum"><p class="muted">Yükleniyor...</p></div>
    </section>

    <section class="panel-section">
      <h2>Özel İçeriklerim</h2>
      <div id="ozel-icerik-list"><p class="muted">Yükleniyor...</p></div>
    </section>

    <section class="panel-section" id="chat-kullanici">
      <h2>Mesajlar</h2>
      <p class="muted">Sadece site yöneticisiyle yazışabilirsin.</p>
      <div class="chat-box">
        <div id="chat-mesaj-liste" class="chat-mesaj-liste"><p class="chat-bos">Yükleniyor...</p></div>
        <form id="chat-form" class="chat-form" novalidate>
          <textarea id="chat-metin" placeholder="Mesajını yaz..." required></textarea>
          <button type="submit">Gönder</button>
        </form>
      </div>
      <div id="chat-message" class="auth-message" hidden></div>
    </section>

    <section class="panel-section danger-zone">
      <h2>Tehlikeli Bölge</h2>
      <p>Hesabını sildiğinde profilin ve özel içerik erişimlerin dahil TÜM
      verilerin kalıcı olarak silinir. Bu işlem geri alınamaz.</p>
      <div class="form-field">
        <label for="hesap-sil-onay">Onaylamak için kutuya büyük harflerle <strong>SİL</strong> yaz</label>
        <input id="hesap-sil-onay" type="text" autocomplete="off">
      </div>
      <button id="hesap-sil-btn" type="button" class="btn-danger">Hesabımı Kalıcı Olarak Sil</button>
      <div id="hesap-sil-message" class="auth-message" hidden></div>
    </section>

  </div>
</div>

<script type="module" src="{{ '/assets/js/panel.js' | relative_url }}"></script>

---
layout: default
title: "Panelim"
yayinda: true
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

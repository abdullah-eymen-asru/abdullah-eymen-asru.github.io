---
layout: default
title: "Kayıt Ol"
yayinda: true
permalink: "/hesap/kayit.html"
---

<link rel="stylesheet" href="{{ '/assets/css/auth.css' | relative_url }}">

<div class="auth-box">
  <h1>Kayıt Ol</h1>
  <div id="auth-message" class="auth-message" hidden></div>
  <div id="auth-spam-notice" class="auth-spam-notice" hidden></div>

  <button id="google-kayit-btn" type="button" class="btn-google">
    Google ile Kayıt Ol
  </button>
  <div class="auth-divider">veya e-posta ile</div>

  <form id="kayit-form" novalidate>
    <div class="form-field">
      <label for="full_name">Ad Soyad</label>
      <input id="full_name" name="full_name" type="text" autocomplete="name" required>
    </div>
    <div class="form-field">
      <label for="email">E-posta</label>
      <input id="email" name="email" type="email" autocomplete="email" required>
    </div>
    <div class="form-field">
      <label for="password">Şifre</label>
      <input id="password" name="password" type="password" autocomplete="new-password" minlength="8" required>
    </div>
    <div class="form-field">
      <label for="password_again">Şifre (Tekrar)</label>
      <input id="password_again" name="password_again" type="password" autocomplete="new-password" minlength="8" required>
    </div>
    <div class="form-field">
      <label style="display:flex; gap:8px; align-items:flex-start; flex-direction:row; font-size:0.9rem; color:var(--text);">
        <input id="kvkk_onay" name="kvkk_onay" type="checkbox" required style="margin-top:3px;">
        <span>
          <a href="{{ '/kurumsal/gizlilik-politikasi.html' | relative_url }}" target="_blank">KVKK Aydınlatma Metni ve Gizlilik Politikası</a>'nı
          okudum, 6698 sayılı Kişisel Verilerin Korunması Kanunu kapsamında kişisel
          verilerimin belirtilen şekilde işlenmesine açık rıza gösteriyorum.
        </span>
      </label>
    </div>
    <button type="submit" class="btn-primary">Kayıt Ol</button>
  </form>

  <div class="auth-links">
    <a href="{{ '/hesap/giris.html' | relative_url }}">Zaten hesabın var mı? Giriş yap</a>
    <a id="kod-ile-onayla-link" href="{{ '/hesap/hesap-onayla.html' | relative_url }}">Linke tıklayamıyor musun? Kodla onayla</a>
  </div>
</div>

<script type="module">
  import { initKayitPage } from "{{ '/assets/js/auth-pages.js' | relative_url }}";
  initKayitPage();
</script>

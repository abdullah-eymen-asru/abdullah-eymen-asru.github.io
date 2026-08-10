---
layout: default
title: "Giriş Yap"
yayinda: true
permalink: "/hesap/giris.html"
---

<link rel="stylesheet" href="{{ '/assets/css/auth.css' | relative_url }}">

<div class="auth-box">
  <h1>Giriş Yap</h1>
  <div id="auth-message" class="auth-message" hidden></div>

  <button id="google-giris-btn" type="button" class="btn-google">
    Google ile Giriş Yap
  </button>
  <div class="auth-divider">veya e-posta ile</div>

  <form id="giris-form" novalidate>
    <div class="form-field">
      <label for="email">E-posta</label>
      <input id="email" name="email" type="email" autocomplete="email" required>
    </div>
    <div class="form-field">
      <label for="password">Şifre</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
    </div>
    <button type="submit" class="btn-primary">Giriş Yap</button>
  </form>

  <div class="auth-links">
    <a href="{{ '/hesap/kayit.html' | relative_url }}">Hesabın yok mu? Kayıt ol</a>
    <a href="{{ '/hesap/sifremi-unuttum.html' | relative_url }}">Şifremi unuttum</a>
  </div>
  <div class="auth-links">
    <a href="{{ '/hesap/hesap-onayla.html' | relative_url }}">Hesabını onaylamadın mı? Kodla onayla</a>
    <span></span>
  </div>
</div>

<script type="module">
  import { initGirisPage } from "{{ '/assets/js/auth-pages.js' | relative_url }}";
  initGirisPage();
</script>

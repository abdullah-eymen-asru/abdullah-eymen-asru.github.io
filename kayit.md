---
layout: default
title: "Kayıt Ol"
yayinda: true
---

<link rel="stylesheet" href="{{ '/assets/css/auth.css' | relative_url }}">

<div class="auth-box">
  <h1>Kayıt Ol</h1>
  <div id="auth-message" class="auth-message" hidden></div>

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
    <button type="submit" class="btn-primary">Kayıt Ol</button>
  </form>

  <div class="auth-links">
    <a href="{{ '/giris.html' | relative_url }}">Zaten hesabın var mı? Giriş yap</a>
  </div>
</div>

<script type="module">
  import { initKayitPage } from "{{ '/assets/js/auth-pages.js' | relative_url }}";
  initKayitPage();
</script>

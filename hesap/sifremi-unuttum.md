---
layout: default
title: "Şifremi Unuttum"
yayinda: true
permalink: "/hesap/sifremi-unuttum.html"
---

<link rel="stylesheet" href="{{ '/assets/css/auth.css' | relative_url }}">

<div class="auth-box">
  <h1>Şifremi Unuttum</h1>
  <p class="muted">E-posta adresini gir, sana bir şifre sıfırlama bağlantısı gönderelim.</p>
  <div id="auth-message" class="auth-message" hidden></div>

  <form id="sifremi-unuttum-form" novalidate>
    <div class="form-field">
      <label for="email">E-posta</label>
      <input id="email" name="email" type="email" autocomplete="email" required>
    </div>
    <button type="submit" class="btn-primary">Sıfırlama Bağlantısı Gönder</button>
  </form>

  <div class="auth-links">
    <a href="{{ '/hesap/giris.html' | relative_url }}">Girişe dön</a>
    <span></span>
  </div>
</div>

<script type="module">
  import { initSifremiUnuttumPage } from "{{ '/assets/js/auth-pages.js' | relative_url }}";
  initSifremiUnuttumPage();
</script>

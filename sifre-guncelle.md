---
layout: default
title: "Şifreni Güncelle"
yayinda: true
---

<link rel="stylesheet" href="{{ '/assets/css/auth.css' | relative_url }}">

<div class="auth-box">
  <h1>Yeni Şifre Belirle</h1>
  <div id="auth-message" class="auth-message" hidden></div>

  <form id="sifre-guncelle-form" novalidate>
    <div class="form-field">
      <label for="password">Yeni Şifre</label>
      <input id="password" name="password" type="password" autocomplete="new-password" minlength="8" required>
    </div>
    <div class="form-field">
      <label for="password_again">Yeni Şifre (Tekrar)</label>
      <input id="password_again" name="password_again" type="password" autocomplete="new-password" minlength="8" required>
    </div>
    <button type="submit" class="btn-primary">Şifreyi Güncelle</button>
  </form>
</div>

<script type="module">
  import { initSifreGuncellePage } from "{{ '/assets/js/auth-pages.js' | relative_url }}";
  initSifreGuncellePage();
</script>

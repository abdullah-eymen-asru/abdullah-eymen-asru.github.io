---
layout: default
title: "Hesabı Onayla"
yayinda: true
permalink: "/hesap/hesap-onayla.html"
---

<link rel="stylesheet" href="{{ '/assets/css/auth.css' | relative_url }}">

<div class="auth-box">
  <h1>Hesabı Onayla</h1>
  <p class="muted">Kayıt olurken sana gönderdiğimiz mail'deki linke tıklayamadıysan, aynı mailde yer alan kodu buraya girerek hesabını onaylayabilirsin.</p>
  <div id="auth-message" class="auth-message" hidden></div>

  <form id="hesap-onayla-form" novalidate>
    <div class="form-field">
      <label for="email">E-posta</label>
      <input id="email" name="email" type="email" autocomplete="email" required>
    </div>
    <div class="form-field">
      <label for="code">Mailde Gelen Kod</label>
      <input id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" required>
    </div>
    <button type="submit" class="btn-primary">Hesabı Onayla</button>
  </form>

  <div class="auth-links">
    <a href="{{ '/hesap/kayit.html' | relative_url }}">Kodu bulamıyorum, tekrar kayıt dene</a>
    <a href="{{ '/hesap/giris.html' | relative_url }}">Girişe dön</a>
  </div>
</div>

<script type="module">
  import { initHesapOnaylaPage } from "{{ '/assets/js/auth-pages.js' | relative_url }}";
  initHesapOnaylaPage();
</script>

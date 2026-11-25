---
layout: default
title: "Hesabı Onayla"
yayinda: true
auth_css: true
permalink: "/hesap/hesap-onayla.html"
---

<div class="auth-box auth-kart">
  <a class="auth-geri" href="{{ '/hesap/giris.html' | relative_url }}">← Girişe dön</a>

  <h1>Hesabını onayla</h1>
  <p class="auth-alt-baslik">Kayıt olurken gönderdiğimiz mail'deki linke tıklayamadıysan, aynı mailde yer alan kodu buraya gir.</p>

  <div id="auth-message" class="auth-message" hidden></div>
  <div id="auth-spam-notice" class="auth-spam-notice">Maili bulamıyorsan SPAM (Gereksiz/Junk) klasörünü kontrol et.</div>

  <form id="hesap-onayla-form" novalidate>
    <div class="form-field">
      <label for="email">E-posta</label>
      <input id="email" name="email" type="email" autocomplete="email" inputmode="email" required>
    </div>
    <div class="form-field">
      <label for="code">Mailde gelen kod</label>
      <input id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" required>
    </div>
    <button type="submit" class="btn-primary">Hesabı Onayla</button>
  </form>

  <p class="auth-alt-linkler">
    <a href="{{ '/hesap/kayit.html' | relative_url }}">Kodu bulamıyor musun? Tekrar kayıt dene</a>
  </p>
</div>

<script type="module">
  import { initHesapOnaylaPage } from "{{ '/assets/js/auth/auth-pages.js' | relative_url }}";
  initHesapOnaylaPage();
</script>

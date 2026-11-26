---
layout: default
title: "Şifremi Unuttum"
yayinda: true
auth_css: true
turnstile_onyukle: true
permalink: "/hesap/sifremi-unuttum.html"
---

<div class="auth-box auth-kart">
  <a class="auth-geri" href="{{ '/hesap/giris.html' | relative_url }}">← Girişe dön</a>

  <h1>Şifreni sıfırla</h1>
  <p class="auth-alt-baslik">E-posta adresini yaz; sana bir şifre sıfırlama bağlantısı gönderelim.</p>

  <div id="auth-message" class="auth-message" hidden></div>
  <div id="auth-spam-notice" class="auth-spam-notice" hidden></div>

  <form id="sifremi-unuttum-form" novalidate>
    <div class="form-field">
      <label for="email">E-posta</label>
      <input id="email" name="email" type="email" autocomplete="email" inputmode="email" required>
    </div>

    <!-- Cloudflare Turnstile (görünmez; yalnızca şüphe varsa kutu çıkar). Bkz. assets/js/auth/turnstile.js -->
    <div id="turnstile-kutu" class="auth-turnstile"></div>
    <p id="turnstile-durum" class="auth-turnstile-durum" role="status" hidden></p>

    <button type="submit" class="btn-primary">Sıfırlama Bağlantısı Gönder</button>
  </form>
</div>

<script type="module">
  import { initSifremiUnuttumPage } from "{{ '/assets/js/auth/auth-pages.js' | relative_url }}";
  initSifremiUnuttumPage();
</script>

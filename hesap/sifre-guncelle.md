---
layout: default
title: "Şifreni Güncelle"
yayinda: true
auth_css: true
permalink: "/hesap/sifre-guncelle.html"
---

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

  <!-- Sıfırlama linkinin süresi dolmuşsa / link daha önce kullanılmışsa
       initSifreGuncellePage() formu gizleyip bunu gösterir. -->
  <div id="auth-expired" hidden>
    <p class="muted">Bu linkle şifre güncellenemiyor. Yeni bir sıfırlama linki isteyebilirsin.</p>
    <a class="btn-primary" href="{{ '/hesap/sifremi-unuttum.html' | relative_url }}" style="display:block; text-align:center; text-decoration:none; box-sizing:border-box;">Yeni Sıfırlama Linki İste</a>
  </div>

  <!-- Link çalışmıyorsa (tıklayamıyor, e-posta uygulaması linki önden
       tüketmiş, vb.) alternatif yol: mailde linkle birlikte gelen kodu
       elle girerek de aynı işlemi tamamlayabilir. initSifreGuncellePage()
       yönetir. -->
  <div class="auth-otp-wrap" style="margin-top:18px;">
    <button type="button" id="auth-otp-toggle" class="btn-secondary">Linke tıklayamıyor musun? Kod ile devam et</button>
    <form id="auth-otp-form" novalidate hidden style="margin-top:14px;">
      <div class="form-field">
        <label for="otp_email">E-posta</label>
        <input id="otp_email" name="otp_email" type="email" autocomplete="email" required>
      </div>
      <div class="form-field">
        <label for="otp_code">Mailde Gelen Kod</label>
        <input id="otp_code" name="otp_code" type="text" inputmode="numeric" autocomplete="one-time-code" required>
      </div>
      <button type="submit" class="btn-primary">Kodu Doğrula</button>
    </form>
  </div>
</div>

<script type="module">
  import { initSifreGuncellePage } from "{{ '/assets/js/auth-pages.js' | relative_url }}";
  initSifreGuncellePage();
</script>

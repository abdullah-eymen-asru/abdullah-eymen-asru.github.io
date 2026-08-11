---
layout: default
title: "Kayıt Ol"
yayinda: true
auth_css: true
permalink: "/hesap/kayit.html"
---

<div class="auth-box">
  <h1>Kayıt Ol</h1>
  <div id="auth-message" class="auth-message" hidden></div>
  <div id="auth-spam-notice" class="auth-spam-notice" hidden></div>

  <!-- KVKK onayı BİLEREK formun dışında, en üstte duruyor: hem e-posta/şifre
       ile kayıtta hem de aşağıdaki "Google ile Kayıt Ol" butonunda ortak
       kullanılıyor (Google'ın kendi ekranında KVKK onayı almadığımız için
       OAuth'u başlatmadan ÖNCE bunun işaretli olması zorunlu tutuluyor —
       bkz. assets/js/auth-pages.js). form="kayit-form" ile aşağıdaki forma
       bağlı kaldığı için normal kayıt gönderiminde de değeri okunur. -->
  <div class="form-field">
    <label style="display:flex; gap:8px; align-items:flex-start; flex-direction:row; font-size:0.9rem; color:var(--text);">
      <input id="kvkk_onay" name="kvkk_onay" type="checkbox" form="kayit-form" required style="margin-top:3px;">
      <span>
        <a href="{{ '/kurumsal/gizlilik-politikasi.html' | relative_url }}" target="_blank">KVKK Aydınlatma Metni ve Gizlilik Politikası</a>'nı
        okudum, 6698 sayılı Kişisel Verilerin Korunması Kanunu kapsamında kişisel
        verilerimin belirtilen şekilde işlenmesine açık rıza gösteriyorum.
      </span>
    </label>
  </div>

  <button id="google-kayit-btn" type="button" class="btn-google">
    Google ile Kayıt Ol
  </button>
  <div class="auth-divider">veya e-posta ile</div>

  <form id="kayit-form" novalidate>
    <div class="form-field">
      <label for="first_name">Ad</label>
      <input id="first_name" name="first_name" type="text" autocomplete="given-name" required>
    </div>
    <div class="form-field">
      <label for="last_name">Soyad</label>
      <input id="last_name" name="last_name" type="text" autocomplete="family-name" required>
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
    <a href="{{ '/hesap/giris.html' | relative_url }}">Zaten hesabın var mı? Giriş yap</a>
    <a id="kod-ile-onayla-link" href="{{ '/hesap/hesap-onayla.html' | relative_url }}">Linke tıklayamıyor musun? Kodla onayla</a>
  </div>
</div>

<script type="module">
  import { initKayitPage } from "{{ '/assets/js/auth-pages.js' | relative_url }}";
  initKayitPage();
</script>

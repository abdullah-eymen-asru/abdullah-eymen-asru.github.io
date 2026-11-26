---
layout: default
title: "Giriş Yap"
yayinda: true
auth_css: true
turnstile_onyukle: true
permalink: "/hesap/giris.html"
---

<div class="auth-box auth-kart">
  <nav class="auth-sekmeler" aria-label="Hesap işlemleri">
    <a href="{{ '/hesap/giris.html' | relative_url }}" aria-current="page">Giriş Yap</a>
    <a href="{{ '/hesap/kayit.html' | relative_url }}">Kayıt Ol</a>
  </nav>

  <h1>Tekrar hoş geldin</h1>
  <p class="auth-alt-baslik">Hesabına e-posta ve şifrenle ya da Google ile gir.</p>

  <div id="auth-message" class="auth-message" hidden></div>

  <div id="giris-adimi">
  <form id="giris-form" novalidate>
    <div class="form-field">
      <label for="email">E-posta</label>
      <input id="email" name="email" type="email" autocomplete="email" inputmode="email" required>
    </div>
    <div class="form-field">
      <div class="auth-etiket-satiri">
        <label for="password">Şifre</label>
        <a class="auth-kucuk-link" href="{{ '/hesap/sifremi-unuttum.html' | relative_url }}">Şifremi unuttum</a>
      </div>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
    </div>

    <div class="auth-secenekler">
      <label class="auth-onay-satiri" for="remember-me">
        <input id="remember-me" name="remember_me" type="checkbox" checked>
        <span>Oturumumu hatırla</span>
      </label>
      <label class="auth-onay-satiri" for="offline-kasa">
        <input id="offline-kasa" name="offline_kasa" type="checkbox" checked>
        <span>Sunucu kesintisinde bu cihazdan girebileyim</span>
      </label>
      <details class="auth-ipucu">
        <summary>Bu ne demek?</summary>
        <p>Parolanla şifrelenmiş bir kopya yalnızca bu cihazda tutulur; sunucu kapalıyken e-posta + parolanla kısıtlı moda girersin. Ortak/paylaşılan cihazlarda işaretleme. 2FA açık hesaplarda uygulanmaz.</p>
      </details>
    </div>

    <!-- Cloudflare Turnstile (görünmez; yalnızca şüphe varsa kutu çıkar). Bkz. assets/js/auth/turnstile.js -->
    <div id="turnstile-kutu" class="auth-turnstile"></div>
    <p id="turnstile-durum" class="auth-turnstile-durum" role="status" hidden></p>

    <button type="submit" class="btn-primary">Giriş Yap</button>
  </form>

  <div class="auth-divider"><span>veya</span></div>

  <button id="google-giris-btn" type="button" class="btn-google">
    <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
    <span>Google ile Giriş Yap</span>
  </button>

  <div id="demo-giris-kutu" hidden>
    <button id="demo-giris-btn" type="button" class="btn-demo">🎭 Canlı Demo / Vitrin Modu</button>
    <p class="muted demo-giris-not">Hesap gerekmez. Örnek verilerle, salt-okunur olarak platformu dene; gerçek verilere erişilmez. Sana özel bir demo hesabı verildiyse yukarıdaki formla da girebilirsin.</p>
  </div>
  <p id="demo-kapali-not" class="muted demo-giris-not" hidden>Herkese açık demo şu an kapalı. Sana özel bir demo hesabı verildiyse yukarıdan e-posta ve şifrenle giriş yap; seni otomatik olarak salt-okunur vitrin moduna alırız.</p>
  <p id="demo-depo-not" class="auth-message auth-message--error" hidden>Tarayıcın oturum depolamasına izin vermediği için demo hesabın açılamadı. Gizli sekmeyi/çerez kısıtını kapatıp tekrar dene.</p>

  </div><!-- #giris-adimi -->

  <!-- İKİ ADIMLI DOĞRULAMA (2FA): şifre doğru ama hesapta TOTP varsa initGirisPage() bunu açar (auth-pages.js -> mfaKoduIste). -->
  <div id="mfa-adimi" hidden>
    <h2 class="auth-adim-baslik">İki adımlı doğrulama</h2>
    <p class="auth-alt-baslik">Authenticator uygulamandaki 6 haneli kodu gir.</p>
    <form id="mfa-form" novalidate>
      <div class="form-field">
        <label for="mfa-kod">Doğrulama kodu</label>
        <input id="mfa-kod" name="mfa_kod" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="8" required>
      </div>
      <button type="submit" class="btn-primary">Doğrula</button>
    </form>
    <button type="button" id="mfa-yedek-ac" class="auth-link-btn">Authenticator'a erişemiyorum, yedek kod kullan</button>
    <form id="yedek-kod-form" novalidate hidden>
      <p class="auth-alt-baslik">Yedek kod girmek hesabındaki iki adımlı doğrulamayı <strong>kaldırır</strong>. Girişten sonra panelden yeniden kurmanı öneririz.</p>
      <div class="form-field">
        <label for="yedek-kod">Yedek kod</label>
        <input id="yedek-kod" name="yedek_kod" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" required>
      </div>
      <button type="submit" class="btn-primary">Yedek kodu kullan</button>
    </form>
    <button type="button" id="mfa-iptal" class="auth-link-btn">Vazgeç ve çıkış yap</button>
  </div>

  <p class="auth-alt-linkler">
    <a href="{{ '/hesap/hesap-onayla.html' | relative_url }}">Hesabını onaylamadın mı? Kodla onayla</a>
  </p>
</div>

<link rel="stylesheet" href="{{ '/assets/css/demo.css' | relative_url }}">
<script type="module" src="{{ '/assets/js/demo/demo-giris.js' | relative_url }}"></script>

<script type="module">
  import { initGirisPage } from "{{ '/assets/js/auth/auth-pages.js' | relative_url }}";
  initGirisPage();
</script>

<!-- Not Kasası: şifreli girişte parolayı dışa aktarılamaz bir anahtara çevirir (ham parola saklanmaz).
     auth-pages.js'e dokunmaz; sadece submit olayını capture fazında dinler. Dosya yüklenemezse giriş etkilenmez. -->
<script type="module" src="{{ '/assets/js/notlar/kasa-kancalari.js' | relative_url }}"></script>

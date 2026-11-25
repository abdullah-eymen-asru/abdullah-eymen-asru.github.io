---
layout: default
title: "Kayıt Ol"
yayinda: true
auth_css: true
permalink: "/hesap/kayit.html"
---

<div class="auth-box auth-kart">
  <nav class="auth-sekmeler" aria-label="Hesap işlemleri">
    <a href="{{ '/hesap/giris.html' | relative_url }}">Giriş Yap</a>
    <a href="{{ '/hesap/kayit.html' | relative_url }}" aria-current="page">Kayıt Ol</a>
  </nav>

  <h1>Hesap oluştur</h1>
  <p class="auth-alt-baslik">Birkaç saniyede üye ol; e-postana gelen bağlantıyla hesabını onayla.</p>

  <div id="auth-message" class="auth-message" hidden></div>
  <div id="auth-spam-notice" class="auth-spam-notice" hidden></div>

  <!-- ÜYELİK KAYITLARI KAPALIYSA gösterilen uyarı ekranı — bkz. assets/js/auth/auth-pages.js -> initKayitPage().
       Sayfa açılır açılmaz site_settings.kayitlar_acik kontrol edilir; kapalıysa bu kutu gösterilir ve
       #kayit-aktif-alan (form + Google butonu + KVKK onayı) TAMAMEN gizlenir. Gerçek/bağlayıcı kısıt her zaman
       veritabanındadır (migration 0031) — bu sadece kullanıcı deneyimi. -->
  <div id="kayit-kapali-uyari" hidden>
    <p>
      Üyelik kayıtları şu anda kapalı, yeni hesap oluşturulamıyor. Daha
      önce hesap oluşturduysan
      <a href="{{ '/hesap/giris.html' | relative_url }}">giriş yap</a>
      sayfasından giriş yapmaya devam edebilirsin.
    </p>
  </div>

  <div id="kayit-aktif-alan">

  <form id="kayit-form" novalidate>
    <div class="auth-grid-2">
      <div class="form-field">
        <label for="first_name">Ad</label>
        <input id="first_name" name="first_name" type="text" autocomplete="given-name" required>
      </div>
      <div class="form-field">
        <label for="last_name">Soyad</label>
        <input id="last_name" name="last_name" type="text" autocomplete="family-name" required>
      </div>
    </div>
    <div class="form-field">
      <label for="email">E-posta</label>
      <input id="email" name="email" type="email" autocomplete="email" inputmode="email" required>
    </div>
    <div class="form-field">
      <label for="password">Şifre</label>
      <input id="password" name="password" type="password" autocomplete="new-password" minlength="12" aria-describedby="password-kural" required>
      <div class="sifre-kural" data-sifre-kural="password" id="password-kural"></div>
    </div>
    <div class="form-field">
      <label for="password_again">Şifre (Tekrar)</label>
      <input id="password_again" name="password_again" type="password" autocomplete="new-password" minlength="12" required>
    </div>

    <!-- HUKUKİ AYRIM (bkz. auth-pages.js başındaki not): aşağıdaki iki öğe KASITLI olarak birbirinden bağımsızdır
         ve "paket rıza" oluşturmaz:
         1) Aydınlatma bilgilendirmesi (#kvkk-aydinlatma-bilgi): ONAY KUTUSU DEĞİLDİR, sadece Aydınlatma Metni'ne
            bağlantı veren bir bilgilendirme cümlesidir (KVKK m.10).
         2) Yurt dışı aktarım açık rıza onay kutusu (#kvkk-yurtdisi-onay): KVKK m.9 kapsamında AYRI, özgür iradeye
            dayalı açık rıza. Varsayılan İŞARETSİZ gelir, önceden işaretlenemez; hem e-posta/şifre kaydında hem de
            "Google ile Kayıt Ol" butonunda OAuth başlatılmadan önce ayrıca kontrol edilir. form="kayit-form"
            bağı korunmuştur. -->
    <div class="auth-onay-kutusu">
      <label for="kvkk-yurtdisi-onay" class="auth-onay-satiri auth-onay-satiri--ust">
        <input id="kvkk-yurtdisi-onay" name="yurtdisi_onay" type="checkbox" form="kayit-form" required>
        <span>
          Kişisel verilerimin üyelik işlemlerinin yürütülmesi amacıyla yurt
          dışında (Almanya/Frankfurt) bulunan güvenli Supabase sunucularına
          aktarılmasına açık rıza veriyorum.
        </span>
      </label>
      <p id="kvkk-aydinlatma-bilgi">
        Kayıt olarak <a href="{{ '/kurumsal/kvkk-aydinlatma-metni.html' | relative_url }}" target="_blank" rel="noopener noreferrer">KVKK Aydınlatma Metni</a>'ni okuduğunuzu beyan edersiniz. Genel bilgi için <a href="{{ '/kurumsal/gizlilik-politikasi.html' | relative_url }}" target="_blank" rel="noopener noreferrer">Gizlilik Politikası</a>.
      </p>
    </div>

    <!-- Cloudflare Turnstile (görünmez; yalnızca şüphe varsa kutu çıkar). Bkz. assets/js/auth/turnstile.js -->
    <div id="turnstile-kutu" class="auth-turnstile"></div>
    <p id="turnstile-durum" class="auth-turnstile-durum" role="status" hidden></p>

    <button type="submit" class="btn-primary">Kayıt Ol</button>
  </form>

  <div class="auth-divider"><span>veya</span></div>

  <button id="google-kayit-btn" type="button" class="btn-google">
    <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
    <span>Google ile Kayıt Ol</span>
  </button>

  <p class="auth-alt-linkler">
    <a id="kod-ile-onayla-link" href="{{ '/hesap/hesap-onayla.html' | relative_url }}">Onay linkine tıklayamıyor musun? Kodla onayla</a>
  </p>

  </div><!-- #kayit-aktif-alan -->
</div>

<script type="module">
  import { initKayitPage } from "{{ '/assets/js/auth/auth-pages.js' | relative_url }}";
  initKayitPage();
</script>

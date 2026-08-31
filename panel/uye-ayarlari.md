---
layout: default
title: "Üye Ayarları"
yayinda: true
auth_css: true
uye_ayarlari_css: true
permalink: "/panel/uye-ayarlari.html"
---

<!--
  panel/uye-ayarlari.md — /panel/uye-ayarlari.html
  "Kullanıcılar & Roller" bölümü panel/admin.md'den BURAYA taşındı (bkz.
  assets/js/uye-ayarlari.js başındaki not). Sebep: üye sayısı 100+'a
  çıkınca tek sayfalık dev bir tablo, admin panelinin diğer bölümlerini
  (içerik yönetimi, dosya paylaşımı) aşağı itiyor ve kendi başına
  yönetilemez hale geliyordu. Bu sayfa SADECE admin'e açık
  (requireAuth({role:'admin'}) — bkz. uye-ayarlari.js) — manager (İçerik
  Sorumlusu) admin.md'den buraya giden linki hiç görmez ve doğrudan URL'yi
  yazsa bile requireAuth onu /panel/panel.html'e geri yönlendirir.

  Tasarım BİLİNÇLİ olarak admin.md'nin sekmeli/tek-tablo görünümünden
  farklı: üstte özet istatistik şeridi, altında arama + rol filtresi +
  sayfa başına gösterim seçili bir araç çubuğu, sonra üye başına bir KART
  (dev bir <table> değil) — sayfalama (pagination) ile bölünür, böylece
  100+ üyede bile sayfa aşırı uzamaz.
-->

<div class="loading-overlay" id="loading">Yükleniyor...</div>

<div id="app" hidden>
  <div class="uya-header">
    <div>
      <h1>Üye Ayarları</h1>
      <p class="muted">
        Tüm üyeleri görüntüle, rolünü değiştir, ad/soyadını düzenle,
        e-postasını (mail beklemeden anında) değiştir ya da hesabını sil.
        Arama, rol filtresi ve sayfalama sayesinde liste büyüse de
        yönetilebilir kalır.
      </p>
    </div>
    <a href="{{ '/panel/admin.html' | relative_url }}" class="btn-secondary uya-geri-btn">← Admin Paneline Dön</a>
  </div>

  <div id="uya-stats" class="uya-stats"><p class="muted">Yükleniyor...</p></div>

  <div class="uya-toolbar">
    <div class="form-field uya-arama-alani">
      <label for="uya-arama">Ara (isim veya e-posta)</label>
      <input id="uya-arama" type="search" placeholder="ör. ayse@ornek.com veya Ayşe">
    </div>
    <div class="form-field uya-filtre-alani">
      <label for="uya-rol-filtre">Rol</label>
      <select id="uya-rol-filtre">
        <option value="">Tüm roller</option>
        <option value="user">Üye</option>
        <option value="special_user">Özel Üye</option>
        <option value="editor">Editör</option>
        <option value="manager">İçerik Sorumlusu</option>
        <option value="admin">Yönetici</option>
      </select>
    </div>
    <div class="form-field uya-sayfa-boyutu-alani">
      <label for="uya-sayfa-boyutu">Sayfa başına</label>
      <select id="uya-sayfa-boyutu">
        <option value="10">10</option>
        <option value="20" selected>20</option>
        <option value="50">50</option>
        <option value="100">100</option>
      </select>
    </div>
  </div>

  <p id="uya-sonuc-sayisi" class="muted uya-sonuc-sayisi"></p>

  <div id="uya-liste" class="uya-liste"><p class="muted">Yükleniyor...</p></div>

  <div id="uya-sayfalama-ust" class="uya-sayfalama"></div>

  <!-- "E-posta Değiştir" butonuna basılınca uye-ayarlari.js bu alanı
       doldurup gösterir: seçili üyenin adı + yeni e-posta formu. E-posta
       hiçbir mail gönderilmeden ANINDA değişir, eski adres gerekmez (bkz.
       uye-ayarlari.js -> wireAdminEmailChange() ve Edge Function
       admin-change-email). -->
  <div id="admin-eposta-degistir-kutu" class="panel-section csp-mt-16" hidden>
    <h3 class="csp-mt-0">E-postasını Değiştir: <span id="admin-eposta-hedef-isim"></span></h3>
    <p class="muted">
      Bu, kullanıcının kendi panelinden yaptığı değişiklikten FARKLIDIR:
      e-posta <strong>hiçbir mail gönderilmeden, anında</strong> değişir —
      ne eski ne yeni adrese onay maili gitmez, eski adrese erişim gerekmez.
      Bu yüzden bu bölümü SADECE kullanıcı eski mailine erişemediği için
      seninle iletişime geçtiyse ve kimliğini (ör. panel üzerinden
      gönderdiği mesajla) doğruladıysan kullan — asıl "kimlik doğrulama"
      adımı burada senin elle yaptığın kontroldür.
    </p>
    <form id="admin-eposta-degistir-form" novalidate>
      <input type="hidden" id="admin-eposta-hedef-id">
      <div class="form-field">
        <label for="admin-eposta-yeni">Yeni E-posta</label>
        <input id="admin-eposta-yeni" type="email" autocomplete="off" required>
      </div>
      <div class="csp-flex-gap10">
        <button type="submit" class="btn-primary csp-w-auto">E-postayı Şimdi Değiştir</button>
        <button type="button" id="admin-eposta-degistir-iptal-btn" class="btn-secondary csp-w-auto">Vazgeç</button>
      </div>
    </form>
    <div id="admin-eposta-message" class="auth-message" hidden></div>
  </div>
</div>

<script type="module" src="{{ '/assets/js/uye-ayarlari.js' | relative_url }}"></script>

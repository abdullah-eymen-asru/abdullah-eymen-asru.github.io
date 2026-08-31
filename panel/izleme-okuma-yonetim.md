---
layout: default
title: "İzleme/Okuma Yönetimi"
yayinda: true
auth_css: true
permalink: "/panel/izleme-okuma-yonetim.html"
---

<link rel="stylesheet" href="{{ '/assets/css/github-yonetim.css' | relative_url }}">
<link rel="stylesheet" href="{{ '/assets/css/izleme-okuma-yonetim.css' | relative_url }}">

<div class="loading-overlay" id="loading">Yükleniyor...</div>

<div id="app" hidden>
  <h1>İzleme/Okuma Yönetimi</h1>
  <p class="muted">
    Bu sayfa <strong>sadece Site Sahibi (owner)</strong> tarafından
    kullanılabilir. Buradan doğrudan <code>{{ site.kutuphane_repo }}</code>
    reposunda yeni bir Issue açabilir, ilgili GitHub Projects panosuna
    (İzleme veya Okuma) ekleyip sütunlarını (Durum, Tür, Puan, vb.)
    doldurabilir, ya da panoda zaten var olan bir kaydı arayıp
    güncelleyebilirsin — GitHub'a hiç gitmeden. Panoya başka bir yoldan
    (doğrudan GitHub üzerinden) eklediğin/düzenlediğin kayıtlar da her
    zamanki gibi çalışmaya devam eder; bu sayfa sadece ek bir hızlı yol.
  </p>

  <nav id="iy-nav" class="gy-klasor-tur-sekmeleri" role="tablist" aria-label="İzleme/Okuma arasında geçiş yap">
    <button type="button" class="gy-klasor-tur-sekme active" data-koleksiyon="izleme" role="tab" aria-selected="true">🎬 İzlediklerim</button>
    <button type="button" class="gy-klasor-tur-sekme" data-koleksiyon="okuma" role="tab" aria-selected="false">📚 Okuduklarım</button>
  </nav>

  <nav id="iy-mod-nav" class="admin-tabs">
    <a href="#ekle" data-mod="ekle" class="active">➕ Yeni Kayıt Ekle</a>
    <a href="#mevcut" data-mod="mevcut">📋 Mevcut Kayıtlar</a>
  </nav>

  <div class="panel-grid">

    <section id="iy-mod-ekle" class="panel-section">
      <h2 id="iy-form-baslik">Yeni Kayıt Ekle — İzlediklerim</h2>
      <p class="muted" id="iy-form-aciklama">
        Başlık, filmin/dizinin adı olarak GitHub Issue başlığı olur.
        Açıklama alanı issue'nun gövdesine (body) yazılır — notlar, alıntı,
        kısa yorum vb. için kullanabilirsin, boş bırakılabilir. Aşağıdaki
        diğer alanlar, <code>{{ site.izleme_projects_url }}</code>
        panosundaki mevcut sütunlardan OTOMATİK olarak okunur — panoya yeni
        bir sütun eklersen bu form da kendiliğinden güncellenir, bu sayfaya
        dokunmana gerek kalmaz.
      </p>

      <form id="iy-form" novalidate>
        <div class="form-field">
          <label for="iy-title">Başlık (film/dizi adı ya da kitap adı)</label>
          <input id="iy-title" type="text" required autocomplete="off">
        </div>
        <div class="form-field">
          <label for="iy-aciklama">Açıklama (opsiyonel)</label>
          <textarea id="iy-aciklama" rows="4" placeholder="Notlar, alıntı, kısa yorum…"></textarea>
        </div>

        <div id="iy-alanlar-container">
          <p class="muted">Alanlar yükleniyor…</p>
        </div>

        <button type="submit" id="iy-submit-btn" class="btn-primary csp-w-auto">➕ Kaydı Ekle</button>
      </form>
      <div id="iy-message" class="auth-message" hidden></div>
      <div id="iy-basari-kutu" class="gy-onizleme-kutusu" hidden>
        <div class="gy-onizleme-baslik">✅ Kayıt eklendi</div>
        <p class="muted" id="iy-basari-metin"></p>
        <div class="gy-link-kutu">
          <a id="iy-basari-issue-link" href="#" target="_blank" rel="noopener noreferrer" class="btn-secondary csp-inline-block-link">GitHub'da Issue'yu Aç</a>
        </div>
      </div>
    </section>

    <section id="iy-mod-mevcut" class="panel-section" hidden>
      <h2 id="iy-liste-baslik">Mevcut Kayıtlar — İzlediklerim</h2>
      <p class="muted">
        Başlık, açıklama ya da herhangi bir sütun değeri (Durum, Tür, Yazar
        vb.) içinde arama yapabilirsin. Bir kayda tıklayınca aşağıda
        düzenleme formu açılır.
      </p>

      <div id="iy-duzenle-kutu" class="gy-onizleme-kutusu csp-mb-20" hidden>
        <div class="gy-onizleme-baslik" id="iy-duzenle-baslik">Kaydı Düzenle</div>
        <form id="iy-duzenle-form" novalidate>
          <div class="form-field">
            <label for="iy-duzenle-title">Başlık</label>
            <input id="iy-duzenle-title" type="text" required autocomplete="off">
          </div>
          <div class="form-field">
            <label for="iy-duzenle-aciklama">Açıklama</label>
            <textarea id="iy-duzenle-aciklama" rows="4" placeholder="Notlar, alıntı, kısa yorum…"></textarea>
          </div>
          <div id="iy-duzenle-alanlar-container"></div>
          <div class="csp-flex-gap10-wrap">
            <button type="submit" id="iy-duzenle-submit-btn" class="btn-primary csp-w-auto">💾 Güncelle</button>
            <button type="button" id="iy-duzenle-iptal-btn" class="btn-secondary csp-w-auto">İptal</button>
          </div>
        </form>
        <div id="iy-duzenle-message" class="auth-message" hidden></div>
      </div>

      <div class="gy-arama-kutu csp-mb-14">
        <span class="gy-arama-ikon" aria-hidden="true">🔎</span>
        <input id="iy-liste-arama" type="search" placeholder="Ara…" autocomplete="off">
        <button type="button" id="iy-liste-arama-temizle" class="gy-arama-temizle" hidden aria-label="Aramayı temizle">✕</button>
      </div>

      <button id="iy-liste-yenile-btn" type="button" class="btn-primary csp-w-auto csp-mb-12">Listeyi Yükle / Yenile</button>

      <div id="iy-liste"><p class="muted">Henüz yüklenmedi.</p></div>
      <p id="iy-liste-sonuc-yok" class="muted" hidden>Aramanla eşleşen kayıt bulunamadı.</p>
    </section>

  </div>
</div>

<script type="module" src="{{ '/assets/js/izleme-okuma-yonetim/izleme-okuma-yonetim.js' | relative_url }}"></script>

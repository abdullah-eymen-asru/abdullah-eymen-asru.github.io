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
    kullanılabilir. Buradan doldurduğun form, doğrudan
    <code>{{ site.kutuphane_repo }}</code> reposunda yeni bir Issue açar,
    ilgili GitHub Projects panosuna (İzleme veya Okuma) ekler ve panodaki
    sütunları (Durum, Tür, Puan, vb.) senin girdiğin değerlerle doldurur —
    GitHub'a hiç gitmeden buradan tek seferde kayıt ekleyebilirsin. Panoya
    başka bir yoldan (doğrudan GitHub üzerinden) eklediğin kayıtlar da her
    zamanki gibi çalışmaya devam eder; bu sayfa sadece ek bir hızlı yol.
  </p>

  <nav id="iy-nav" class="gy-klasor-tur-sekmeleri" role="tablist" aria-label="İzleme/Okuma arasında geçiş yap">
    <button type="button" class="gy-klasor-tur-sekme active" data-koleksiyon="izleme" role="tab" aria-selected="true">🎬 İzlediklerim</button>
    <button type="button" class="gy-klasor-tur-sekme" data-koleksiyon="okuma" role="tab" aria-selected="false">📚 Okuduklarım</button>
  </nav>

  <div class="panel-grid">
    <section class="panel-section">
      <h2 id="iy-form-baslik">Yeni Kayıt Ekle — İzlediklerim</h2>
      <p class="muted" id="iy-form-aciklama">
        Başlık, filmin/dizinin adı olarak GitHub Issue başlığı olur.
        Aşağıdaki alanlar, <code>{{ site.izleme_projects_url }}</code>
        panosundaki mevcut sütunlardan OTOMATİK olarak okunur — panoya yeni
        bir sütun eklersen bu form da kendiliğinden güncellenir, bu sayfaya
        dokunmana gerek kalmaz.
      </p>

      <form id="iy-form" novalidate>
        <div class="form-field">
          <label for="iy-title">Başlık (film/dizi adı ya da kitap adı)</label>
          <input id="iy-title" type="text" required autocomplete="off">
        </div>

        <div id="iy-alanlar-container">
          <p class="muted">Alanlar yükleniyor…</p>
        </div>

        <button type="submit" id="iy-submit-btn" class="btn-primary" style="width:auto;">➕ Kaydı Ekle</button>
      </form>
      <div id="iy-message" class="auth-message" hidden></div>
      <div id="iy-basari-kutu" class="gy-onizleme-kutusu" hidden>
        <div class="gy-onizleme-baslik">✅ Kayıt eklendi</div>
        <p class="muted" id="iy-basari-metin"></p>
        <div class="gy-link-kutu">
          <a id="iy-basari-issue-link" href="#" target="_blank" rel="noopener" class="btn-secondary" style="width:auto; text-decoration:none; display:inline-block; text-align:center;">GitHub'da Issue'yu Aç</a>
        </div>
      </div>
    </section>
  </div>
</div>

<script type="module" src="{{ '/assets/js/izleme-okuma-yonetim/izleme-okuma-yonetim.js' | relative_url }}"></script>

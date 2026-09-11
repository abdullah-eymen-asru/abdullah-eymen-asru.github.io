---
layout: default
title: Okuduklarım
permalink: "/icerik/okuduklarim.html"
---

<h1>Okuduklarım</h1>

<div class="listeler-sekmeler">
  <a href="/icerik/izlediklerim.html" class="sekme-btn">🎬 İzlediklerim</a>
  <a href="/icerik/okuduklarim.html" class="sekme-btn aktif">📚 Okuduklarım</a>
</div>

<p>
  Okuduğum kitapları
  <a href="{{ site.okuma_projects_url }}" target="_blank" rel="noopener noreferrer">GitHub Projects panosunda</a>
  kayıt altına alıyorum. Bu tablo, panoya her yeni kayıt eklendiğinde
  <strong>anlık olarak</strong> güncellenir — sayfayı her açtığında en güncel
  veriyi görürsün.
</p>

<p class="format-hint">
  Repo'nun kendisine <a href="https://github.com/abdullah-eymen-asru/izleme-okuma-listem" target="_blank" rel="noopener noreferrer">buradan</a> ulaşabilirsin.
</p>

<!-- Sadece site sahibi (owner) girişliyken görünür — bkz.
     assets/js/izleme-okuma-yonetim/izleme-okuma-yonetim-kisayol.js. Diğer
     ziyaretçiler için bu script hiçbir şey render etmez, sayfa öncekiyle
     birebir aynı görünür. -->
<div id="izleme-okuma-yonetim-kisayol"></div>

<!-- "Kaç kitap okudum" istatistik şeridi — koleksiyon-tablo.js tarafından
     JSON yüklendikten sonra doldurulur. Veri gelene kadar boş/gizli kalır,
     bu yüzden hiçbir yükleniyor metni içermiyor. -->
<div id="okuma-istatistik" class="liste-istatistik" role="group" aria-label="Okuma istatistikleri" hidden></div>

<div class="filter-row">
  <input
    type="text"
    id="okuma-search"
    class="search-box"
    placeholder="Kitap/yazar ara…"
    aria-label="Kitap veya yazar ara"
    disabled>

  <select id="tur-filtresi" class="tur-select" aria-label="Türe göre filtrele" disabled>
    <option value="">Tüm türler</option>
  </select>

  <select id="durum-filtresi" class="tur-select" aria-label="Okuma durumuna göre filtrele" disabled>
    <option value="">Tüm durumlar</option>
  </select>

  <select id="yil-filtresi" class="tur-select" aria-label="Yıla göre filtrele" disabled>
    <option value="">Tüm yıllar</option>
  </select>
</div>

<div id="okunanlar-tablo" class="scroll-list scroll-list--tablo">
  <p class="loading">Yükleniyor…</p>
</div>

<script src="{{ '/assets/js/koleksiyon-tablo.js' | relative_url }}"></script>
<script>
  koleksiyonTablosuOlustur({
    jsonUrl: "{{ site.cloudflare_worker_url }}?project=okuma",
    containerId: "okunanlar-tablo",
    searchInputId: "okuma-search",
    turSelectId: "tur-filtresi",
    turFieldName: "Tür",
    durumSelectId: "durum-filtresi",
    durumFieldName: "Okuma Durumu",
    yilSelectId: "yil-filtresi",
    aramaAlanlari: ["Yazar", "Tür", "Okuma Durumu"],
    gizliAlanlar: [],
    sayfaBasinaKayit: 50,
    istatistikContainerId: "okuma-istatistik",
    istatistikEylem: "okuduğum",
    istatistikTamamlandiDegeri: "Okudum",
    baslamaTarihiAlani: "Başlama Tarihi",
    bitisTarihiAlani: "Bitiş Tarihi"
  });
</script>
<script type="module" src="{{ '/assets/js/izleme-okuma-yonetim/izleme-okuma-yonetim-kisayol.js' | relative_url }}"></script>

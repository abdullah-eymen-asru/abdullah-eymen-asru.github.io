---
layout: default
title: İzlediklerim
permalink: "/icerik/izlediklerim.html"
---

<h1>İzlediklerim</h1>

<div class="listeler-sekmeler">
  <a href="/icerik/izlediklerim.html" class="sekme-btn aktif">🎬 İzlediklerim</a>
  <a href="/icerik/okuduklarim.html" class="sekme-btn">📚 Okuduklarım</a>
</div>

<p>
  İzlediğim film ve dizileri
  <a href="{{ site.izleme_projects_url }}" target="_blank" rel="noopener noreferrer">GitHub Projects panosunda</a>
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

<!-- "Kaç tane izledim" istatistik şeridi — koleksiyon-tablo.js tarafından
     JSON yüklendikten sonra doldurulur. Veri gelene kadar boş/gizli kalır,
     bu yüzden hiçbir yükleniyor metni içermiyor. -->
<div id="izleme-istatistik" class="liste-istatistik" role="group" aria-label="İzleme istatistikleri" hidden></div>

<div class="filter-row">
  <input
    type="text"
    id="izleme-search"
    class="search-box"
    placeholder="Film/dizi ara…"
    aria-label="Film veya dizi ara"
    disabled>

  <select id="tur-filtresi" class="tur-select" aria-label="Türe göre filtrele" disabled>
    <option value="">Tüm türler</option>
  </select>

  <select id="durum-filtresi" class="tur-select" aria-label="Durumuma göre filtrele" disabled>
    <option value="">Tüm durumlar</option>
  </select>
</div>

<div id="izlenenler-tablo" class="scroll-list scroll-list--tablo">
  <p class="loading">Yükleniyor…</p>
</div>

<script src="{{ '/assets/js/koleksiyon-tablo.js' | relative_url }}"></script>
<script>
  koleksiyonTablosuOlustur({
    jsonUrl: "{{ site.cloudflare_worker_url }}?project=izleme",
    containerId: "izlenenler-tablo",
    searchInputId: "izleme-search",
    turSelectId: "tur-filtresi",
    turFieldName: "Tür",
    durumSelectId: "durum-filtresi",
    durumFieldName: "Durum",
    aramaAlanlari: ["Tür", "Sezon/Bölüm", "Durum"],
    gizliAlanlar: [],
    sayfaBasinaKayit: 50,
    istatistikContainerId: "izleme-istatistik",
    istatistikEylem: "izlediğim",
    istatistikTamamlandiDegeri: "İzlendi",
    baslamaTarihiAlani: "Başlama Tarihi",
    bitisTarihiAlani: "Bitiş Tarihi"
  });
</script>
<script type="module" src="{{ '/assets/js/izleme-okuma-yonetim/izleme-okuma-yonetim-kisayol.js' | relative_url }}"></script>

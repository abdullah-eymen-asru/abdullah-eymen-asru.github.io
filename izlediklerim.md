---
layout: default
title: İzlediklerim
---

<h1>İzlediklerim</h1>
<p>
  İzlediğim film ve dizileri
  <a href="{{ site.izleme_projects_url }}" target="_blank">GitHub Projects panosunda</a>
  kayıt altına alıyorum. Bu tablo, o panodan otomatik olarak (günde 1 kez veya
  manuel tetiklemeyle) güncellenen statik bir veriyle besleniyor — sayfa açıldığında
  hiçbir GitHub API isteği yapılmaz, sadece hazır bir JSON dosyası okunur.
</p>

<div class="filter-row">
  <input
    type="text"
    id="izleme-search"
    class="search-box"
    placeholder="Film/dizi ara…"
    disabled>

  <select id="tur-filtresi" class="tur-select" disabled>
    <option value="">Tüm türler</option>
  </select>
</div>

<div id="izlenenler-tablo" class="scroll-list">
  <p class="loading">Yükleniyor…</p>
</div>

<script src="{{ '/assets/js/koleksiyon-tablo.js' | relative_url }}"></script>
<script>
  koleksiyonTablosuOlustur({
    jsonUrl: "{{ '/assets/data/izlenenler.json' | relative_url }}",
    containerId: "izlenenler-tablo",
    searchInputId: "izleme-search",
    turSelectId: "tur-filtresi",
    turFieldName: "Tür",
    aramaAlanlari: ["Tür", "Sezon/Bölüm", "Durum"],
    gizliAlanlar: [],
    sayfaBasinaKayit: 50
  });
</script>

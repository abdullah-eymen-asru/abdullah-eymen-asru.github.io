---
layout: default
title: Akademik Projeler
permalink: "/icerik/akademik-projeler.html"
---

<h1>Akademik Projeler</h1>
<p>Yayınlarım, projelerim ve devam eden çalışmalarım.</p>

{% assign sorted_projects = site.projects | where_exp: "p", "p.yayinda != false" | where_exp: "p", "p.date <= site.time" | sort: "date" | reverse %}

{% comment %}
  YIL FİLTRESİ + TAM TARİH: bkz. aşağıdaki <select id="project-year-filter">
  ve script'teki yilSecenekleriniDoldur()/uygulaFiltre() — okuduklarım/
  izlediklerim sayfalarındaki AYNI ".filter-row" + ".tur-select" görsel
  deseni kullanılıyor. Yıl seçenekleri build-time'da Liquid ile DEĞİL,
  istemci tarafında (JS) dolduruluyor çünkü "Sadece Supabase'te Yayınla"
  (bkz. panel/github-yonetim.md) ile eklenen projelerin yılları build
  zamanında BİLİNEMEZ — hem Jekyll hem Supabase kartları DOM'a girdikten
  SONRA, TEK bir yerden (initSayfalama() içinden) dolduruluyor.

  TARİH: eskiden burada sadece yıl yazıyordu (project.date, "%Y" biçiminde)
  ve hemen yanındaki proje durumu (project.status, ör.
  "Yayınlandı") ile "· 2026 · Yayınlandı ·" şeklinde yan yana görününce
  hangisinin tarih hangisinin durum olduğu karışıyordu. Artık "Yayın
  tarihi: " etiketiyle TAM tarih (gün ay yıl, Türkçe ay adıyla — bkz.
  _plugins/turkce_ay_filtresi.rb) yazılıyor, durum etiketinden ayrı
  okunuyor.
{% endcomment %}
<div class="filter-row">
  <input
    type="text"
    id="project-search"
    class="search-box"
    placeholder="Proje veya makale ara…">

  <select id="project-year-filter" class="tur-select">
    <option value="">Tüm yıllar</option>
  </select>
</div>

<div id="project-list">
  {% for project in sorted_projects %}
  <div class="project-card searchable"
       data-search="{{ project.title | downcase }} {{ project.author | downcase }} {{ project.summary | strip_html | downcase }} {{ project.venue | downcase }}"
       data-date="{{ project.date | date: '%Y-%m-%d' }}">
    <h3><a href="{{ project.url | relative_url }}">{{ project.title }}</a></h3>
    <div class="meta">
      {% if project.venue %}{{ project.venue }}{% endif %}
      {% if project.date %} · Yayın tarihi: {{ project.date | date: "%-d" }} {{ project.date | ay_adi_tr }} {{ project.date | date: "%Y" }}{% endif %}
      {% if project.status %} · <span class="tag">{{ project.status }}</span>{% endif %}
      {% if project.author %} · Yazan: {{ project.author }}{% endif %}
    </div>
    <p>{{ project.summary }}</p>
  </div>
  {% endfor %}
</div>

<button id="load-more" class="load-more-btn" hidden>Daha fazla göster</button>

<script type="module">
  // Sayfalama artık build-zamanında (Jekyll'in forloop.index > 8'i ile)
  // DEĞİL, aşağıdaki initSayfalama() içinde İSTEMCİ TARAFINDA kuruluyor —
  // bunun sebebi, Supabase'te "sadece Supabase'te yayınla" (bkz.
  // panel/github-yonetim.md, migration 0015) ile yayınlanmış projelerin bu
  // listeye JS ile SONRADAN eklenmesi: build zamanında kurulmuş bir
  // sayfalama, sonradan eklenen bu kartlardan habersiz kalır (8'den az
  // Jekyll projesi olsa bile toplamda 8'i geçebilir ya da tam tersi). Bu
  // yüzden hem Jekyll hem Supabase kartları DOM'a eklendikten SONRA, TEK
  // bir sayfalama kurulumu çalışıyor.
  import { supabase, escapeHtml } from "{{ '/assets/js/core/supabase-client.js' | relative_url }}";

  const searchInput = document.getElementById("project-search");
  const yearSelect = document.getElementById("project-year-filter");
  const list = document.getElementById("project-list");
  const loadMoreBtn = document.getElementById("load-more");
  const PAGE_SIZE = 8;
  let shownCount = PAGE_SIZE;

  // AYLAR_TR: Supabase'ten (JS ile, build-time olmadan) eklenen proje
  // kartlarının tarihi Jekyll'in `ay_adi_tr` Liquid filtresinden (bkz.
  // _plugins/turkce_ay_filtresi.rb) geçemez — bu yüzden burada tarayıcının
  // kendi `toLocaleDateString("tr-TR", ...)` API'sini kullanıyoruz, o da
  // doğru Türkçe ay adı üretir (Jekyll'in build-locale sorunundan farklı
  // olarak, tarayıcı Intl API'si açıkça verilen "tr-TR" locale'ini kullanır).
  function tamTarihMetni(isoTarih) {
    if (!isoTarih) return "";
    const d = new Date(isoTarih);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" });
  }

  async function supabaseProjeleriEkle() {
    try {
      const { data, error } = await supabase.rpc("sadece_supabase_yayinlari_listele", { p_tur: "proje" });
      if (error) throw error;
      const projeler = data || [];
      if (projeler.length === 0) return;

      const base = document.documentElement.dataset.baseurl || "";
      projeler.forEach((proje) => {
        const card = document.createElement("div");
        card.className = "project-card searchable";
        const ozet = proje.ozet || "";
        card.dataset.search = `${(proje.baslik || "").toLowerCase()} ${(proje.yazar_adi || "").toLowerCase()} ${ozet.toLowerCase()} ${(proje.venue || "").toLowerCase()}`;
        card.dataset.date = proje.tarih || "";
        const href = `${base}/icerik/supabase-yazi.html?tur=proje&slug=${encodeURIComponent(proje.slug)}`;
        // "Yayın tarihi: ..." + TAM tarih (gün ay yıl) — sadece yıl DEĞİL,
        // ve proje.durum (ör. "Yayınlandı") ile karışmasın diye ayrı
        // etiketli. Jekyll tarafındaki kartlarla (yukarıdaki for döngüsü)
        // AYNI biçim — bkz. dosya başındaki karşılaştırma notu.
        const tamTarih = tamTarihMetni(proje.tarih);
        const metaParcalar = [];
        if (proje.venue) metaParcalar.push(escapeHtml(proje.venue));
        if (tamTarih) metaParcalar.push(`Yayın tarihi: ${escapeHtml(tamTarih)}`);
        if (proje.durum) metaParcalar.push(`<span class="tag">${escapeHtml(proje.durum)}</span>`);
        if (proje.yazar_adi) metaParcalar.push(`Yazan: ${escapeHtml(proje.yazar_adi)}`);
        card.innerHTML = `
          <h3><a href="${href}">${escapeHtml(proje.baslik || "")}</a></h3>
          <div class="meta">${metaParcalar.join(" · ")}</div>
          <p>${escapeHtml(ozet)}</p>
        `;

        const digerKartlar = Array.from(list.querySelectorAll(".project-card.searchable"));
        const eklenecekYer = digerKartlar.find((k) => (k.dataset.date || "") < card.dataset.date);
        if (eklenecekYer) list.insertBefore(card, eklenecekYer);
        else list.appendChild(card);
      });
    } catch (err) {
      console.error("Supabase'te yayınlanan projeler yüklenemedi:", err);
    }
  }

  // YIL FİLTRESİ SEÇENEKLERİ: Jekyll + Supabase kartları DOM'a TAMAMEN
  // eklendikten sonra, her kartın data-date'inden (YYYY-MM-DD) yıl kısmı
  // çıkarılıp TEKİLLEŞTİRİLEREK (büyükten küçüğe) <select> içine yazılır.
  // Build-time'da (Liquid ile) doldurmuyoruz çünkü Supabase'te "sadece
  // Supabase'te yayınla" ile eklenen projelerin yılları build zamanında hiç
  // bilinemez — bu yöntem HER İKİ kaynağı da otomatik kapsar.
  function yilSecenekleriniDoldur() {
    const yillar = new Set();
    list.querySelectorAll(".searchable").forEach((card) => {
      const yil = (card.dataset.date || "").slice(0, 4);
      if (yil) yillar.add(yil);
    });
    const seciliDeger = yearSelect.value;
    yearSelect.innerHTML = '<option value="">Tüm yıllar</option>';
    Array.from(yillar).sort((a, b) => b.localeCompare(a)).forEach((yil) => {
      const opt = document.createElement("option");
      opt.value = yil;
      opt.textContent = yil;
      yearSelect.appendChild(opt);
    });
    // Daha önce bir yıl seçiliyse (ör. yeni kartlar eklendikten sonra
    // yeniden dolduruluyorsa) seçimi koru.
    if (Array.from(yearSelect.options).some((o) => o.value === seciliDeger)) {
      yearSelect.value = seciliDeger;
    }
  }

  // ORTAK FİLTRE UYGULAYICI: arama metni VE yıl seçimi BİRLİKTE (VE mantığı)
  // uygulanır. İkisi de boşsa normal sayfalamaya (shownCount) dönülür;
  // biri bile doluysa TÜM eşleşenler aynı anda gösterilir ve "Daha fazla
  // göster" butonu gizlenir (arama/filtre aktifken sayfalama anlamsızdır).
  function filtreyiUygula() {
    const q = searchInput.value.trim().toLowerCase();
    const yil = yearSelect.value;
    const cards = Array.from(list.querySelectorAll(".searchable"));
    const filtreAktif = q !== "" || yil !== "";
    let visibleCount = 0;

    if (!filtreAktif) {
      cards.forEach((card, i) => {
        card.style.display = i < shownCount ? "" : "none";
        if (i >= shownCount) card.setAttribute("data-hidden-by-page", "true");
        else card.removeAttribute("data-hidden-by-page");
      });
      if (loadMoreBtn) {
        const remaining = cards.length - shownCount;
        loadMoreBtn.hidden = remaining <= 0;
        if (remaining > 0) loadMoreBtn.textContent = `Daha fazla göster (${remaining} proje daha)`;
      }
    } else {
      if (loadMoreBtn) loadMoreBtn.hidden = true;
      cards.forEach((card) => {
        const metinEslesiyor = q === "" || card.dataset.search.includes(q);
        const yilEslesiyor = yil === "" || (card.dataset.date || "").slice(0, 4) === yil;
        const match = metinEslesiyor && yilEslesiyor;
        card.style.display = match ? "" : "none";
        if (match) visibleCount++;
      });
    }

    let emptyMsg = list.querySelector(".no-results");
    if (filtreAktif && visibleCount === 0) {
      if (!emptyMsg) {
        emptyMsg = document.createElement("p");
        emptyMsg.className = "loading no-results";
        emptyMsg.textContent = "Eşleşen sonuç bulunamadı.";
        list.appendChild(emptyMsg);
      }
    } else if (emptyMsg) {
      emptyMsg.remove();
    }
  }

  function initSayfalama() {
    const cards = Array.from(list.querySelectorAll(".searchable"));
    if (cards.length === 0) {
      if (!list.querySelector(".loading")) {
        const p = document.createElement("p");
        p.className = "loading";
        p.textContent = "Henüz proje eklenmedi.";
        list.appendChild(p);
      }
      return;
    }

    yilSecenekleriniDoldur();
    filtreyiUygula();
  }

  if (loadMoreBtn) {
    loadMoreBtn.addEventListener("click", () => {
      const hiddenCards = list.querySelectorAll('[data-hidden-by-page="true"]');
      Array.from(hiddenCards).slice(0, PAGE_SIZE).forEach(card => {
        card.style.display = "";
        card.removeAttribute("data-hidden-by-page");
      });
      shownCount += PAGE_SIZE;

      const remaining = list.querySelectorAll('[data-hidden-by-page="true"]').length;
      if (remaining === 0) {
        loadMoreBtn.hidden = true;
      } else {
        loadMoreBtn.textContent = `Daha fazla göster (${remaining} proje daha)`;
      }
    });
  }

  searchInput.addEventListener("input", filtreyiUygula);
  yearSelect.addEventListener("change", filtreyiUygula);

  (async function () {
    await supabaseProjeleriEkle();
    initSayfalama();
  })();
</script>

<!--
  Yeni bir proje eklemek için: _projects/ klasörüne yeni bir .md dosyası ekle
  (örn: _projects/2026-yeni-proje.md). Bu sayfaya hiç dokunmana gerek yok,
  yeni dosya otomatik olarak burada listelenir. Ya da panel/github-yonetim.md
  panelinden "Sadece Supabase'te Yayınla" seçeneğiyle GitHub'a hiç commit
  atmadan yayınlayabilirsin (bkz. migration 0015).
-->

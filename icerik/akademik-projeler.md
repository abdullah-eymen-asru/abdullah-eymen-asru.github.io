---
layout: default
title: Akademik Projeler
permalink: "/icerik/akademik-projeler.html"
---

<h1>Akademik Projeler</h1>
<p>Yayınlarım, projelerim ve devam eden çalışmalarım.</p>

{% assign sorted_projects = site.projects | where_exp: "p", "p.yayinda != false" | where_exp: "p", "p.date <= site.time" | sort: "date" | reverse %}

<input
  type="text"
  id="project-search"
  class="search-box"
  placeholder="Proje veya makale ara…">

<div id="project-list">
  {% for project in sorted_projects %}
  <div class="project-card searchable"
       data-search="{{ project.title | downcase }} {{ project.author | downcase }} {{ project.summary | strip_html | downcase }} {{ project.venue | downcase }}"
       data-date="{{ project.date | date: '%Y-%m-%d' }}">
    <h3><a href="{{ project.url | relative_url }}">{{ project.title }}</a></h3>
    <div class="meta">
      {% if project.venue %}{{ project.venue }}{% endif %}
      {% if project.date %} · {{ project.date | date: "%Y" }}{% endif %}
      {% if project.status %} · <span class="tag">{{ project.status }}</span>{% endif %}
      {% if project.author %} · ✍️ {{ project.author }}{% endif %}
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
  import { supabase, escapeHtml } from "{{ '/assets/js/supabase-client.js' | relative_url }}";

  const searchInput = document.getElementById("project-search");
  const list = document.getElementById("project-list");
  const loadMoreBtn = document.getElementById("load-more");
  const PAGE_SIZE = 8;
  let shownCount = PAGE_SIZE;

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
        const yil = proje.tarih ? new Date(proje.tarih).getFullYear() : "";
        const metaParcalar = [];
        if (proje.venue) metaParcalar.push(escapeHtml(proje.venue));
        if (yil) metaParcalar.push(yil);
        if (proje.durum) metaParcalar.push(`<span class="tag">${escapeHtml(proje.durum)}</span>`);
        if (proje.yazar_adi) metaParcalar.push(`✍️ ${escapeHtml(proje.yazar_adi)}`);
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

    cards.forEach((card, i) => {
      card.style.display = i < shownCount ? "" : "none";
      if (i >= shownCount) card.setAttribute("data-hidden-by-page", "true");
      else card.removeAttribute("data-hidden-by-page");
    });

    const remaining = cards.length - shownCount;
    if (loadMoreBtn) {
      loadMoreBtn.hidden = remaining <= 0;
      if (remaining > 0) loadMoreBtn.textContent = `Daha fazla göster (${remaining} proje daha)`;
    }
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

  searchInput.addEventListener("input", () => {
    const q = searchInput.value.trim().toLowerCase();
    const cards = list.querySelectorAll(".searchable");
    let visibleCount = 0;

    if (q === "") {
      cards.forEach((card, i) => {
        card.style.display = i < shownCount ? "" : "none";
        if (i >= shownCount) card.setAttribute("data-hidden-by-page", "true");
      });
      if (loadMoreBtn) {
        const remaining = cards.length - shownCount;
        loadMoreBtn.hidden = remaining <= 0;
        if (remaining > 0) loadMoreBtn.textContent = `Daha fazla göster (${remaining} proje daha)`;
      }
    } else {
      if (loadMoreBtn) loadMoreBtn.hidden = true;
      cards.forEach(card => {
        const match = card.dataset.search.includes(q);
        card.style.display = match ? "" : "none";
        if (match) visibleCount++;
      });
    }

    let emptyMsg = list.querySelector(".no-results");
    if (q !== "" && visibleCount === 0) {
      if (!emptyMsg) {
        emptyMsg = document.createElement("p");
        emptyMsg.className = "loading no-results";
        emptyMsg.textContent = "Eşleşen sonuç bulunamadı.";
        list.appendChild(emptyMsg);
      }
    } else if (emptyMsg) {
      emptyMsg.remove();
    }
  });

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

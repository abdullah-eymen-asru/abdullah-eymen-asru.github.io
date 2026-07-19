---
layout: default
title: Akademik Projeler
---

<h1>Akademik Projeler</h1>
<p>Yayınlarım, projelerim ve devam eden çalışmalarım.</p>

{% assign sorted_projects = site.projects | where_exp: "p", "p.yayinda != false and p.date <= site.time" | sort: "date" | reverse %}

{% if sorted_projects.size == 0 %}
  <p class="loading">Henüz proje eklenmedi.</p>
{% else %}

<input
  type="text"
  id="project-search"
  class="search-box"
  placeholder="Proje veya makale ara…">

<div id="project-list">
  {% for project in sorted_projects %}
  <div class="project-card searchable"
       data-search="{{ project.title | downcase }} {{ project.summary | strip_html | downcase }} {{ project.venue | downcase }}"
       {% if forloop.index > 8 %}data-hidden-by-page="true" style="display:none;"{% endif %}>
    <h3><a href="{{ project.url | relative_url }}">{{ project.title }}</a></h3>
    <div class="meta">
      {% if project.venue %}{{ project.venue }}{% endif %}
      {% if project.date %} · {{ project.date | date: "%Y" }}{% endif %}
      {% if project.status %} · <span class="tag">{{ project.status }}</span>{% endif %}
    </div>
    <p>{{ project.summary }}</p>
  </div>
  {% endfor %}
</div>

{% if sorted_projects.size > 8 %}
<button id="load-more" class="load-more-btn">Daha fazla göster ({{ sorted_projects.size | minus: 8 }} proje daha)</button>
{% endif %}

<script>
(function () {
  const searchInput = document.getElementById("project-search");
  const list = document.getElementById("project-list");
  const loadMoreBtn = document.getElementById("load-more");
  const PAGE_SIZE = 8;
  let shownCount = PAGE_SIZE;

  if (loadMoreBtn) {
    loadMoreBtn.addEventListener("click", () => {
      const hiddenCards = list.querySelectorAll('[data-hidden-by-page="true"]');
      // bir sonraki PAGE_SIZE kadar kartı aç
      Array.from(hiddenCards).slice(0, PAGE_SIZE).forEach(card => {
        card.style.display = "";
        card.removeAttribute("data-hidden-by-page");
      });
      shownCount += PAGE_SIZE;

      const remaining = list.querySelectorAll('[data-hidden-by-page="true"]').length;
      if (remaining === 0) {
        loadMoreBtn.style.display = "none";
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
      // arama boşaltıldıysa, sayfalama düzenine geri dön
      cards.forEach((card, i) => {
        card.style.display = i < shownCount ? "" : "none";
        if (i >= shownCount) card.setAttribute("data-hidden-by-page", "true");
      });
      if (loadMoreBtn) {
        const remaining = cards.length - shownCount;
        loadMoreBtn.style.display = remaining > 0 ? "" : "none";
        if (remaining > 0) loadMoreBtn.textContent = `Daha fazla göster (${remaining} proje daha)`;
      }
    } else {
      // arama aktifken: sayfalamayı yok say, tüm eşleşenleri göster
      if (loadMoreBtn) loadMoreBtn.style.display = "none";
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
})();
</script>

{% endif %}

<!--
  Yeni bir proje eklemek için: _projects/ klasörüne yeni bir .md dosyası ekle
  (örn: _projects/2026-yeni-proje.md). Bu sayfaya hiç dokunmana gerek yok,
  yeni dosya otomatik olarak burada listelenir.
-->

---
layout: default
title: Akademik Projeler
---

<h1>Akademik Projeler</h1>
<p>Yayınlarım, projelerim ve devam eden çalışmalarım.</p>

{% assign sorted_projects = site.projects | sort: "date" | reverse %}

{% if sorted_projects.size == 0 %}
  <p class="loading">Henüz proje eklenmedi.</p>
{% endif %}

{% for project in sorted_projects %}
<div class="project-card">
  <h3><a href="{{ project.url | relative_url }}">{{ project.title }}</a></h3>
  <div class="meta">
    {% if project.venue %}{{ project.venue }}{% endif %}
    {% if project.date %} · {{ project.date | date: "%Y" }}{% endif %}
    {% if project.status %} · <span class="tag">{{ project.status }}</span>{% endif %}
  </div>
  <p>{{ project.summary }}</p>
</div>
{% endfor %}

<!--
  Yeni bir proje eklemek için: _projects/ klasörüne yeni bir .md dosyası ekle
  (örn: _projects/2026-yeni-proje.md). Bu sayfaya hiç dokunmana gerek yok,
  yeni dosya otomatik olarak burada listelenir.
-->

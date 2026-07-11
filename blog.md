---
layout: default
title: Blog
---

<h1>Blog</h1>
<p>
  Yazılarımı <a href="{{ site.substack_url }}" target="_blank">Substack</a> üzerinde
  yayınlıyorum. Son yazılar aşağıda otomatik listeleniyor.
</p>

<div id="substack-posts">
  <p class="loading">Yazılar yükleniyor…</p>
</div>

<script>
(async function () {
  const feedUrl = "{{ site.substack_feed }}";
  // allorigins.win: ham XML'i olduğu gibi getirir, biz kendimiz ayrıştırırız
  const proxyUrl = "https://api.allorigins.win/raw?url=" + encodeURIComponent(feedUrl);
  const container = document.getElementById("substack-posts");

  try {
    const res = await fetch(proxyUrl);
    if (!res.ok) throw new Error("Proxy isteği başarısız: " + res.status);
    const xmlText = await res.text();

    // Tarayıcının kendi XML ayrıştırıcısı ile metni gerçek bir belgeye çeviriyoruz
    const parser = new DOMParser();
    const xml = parser.parseFromString(xmlText, "application/xml");
    const items = Array.from(xml.querySelectorAll("item"));

    if (items.length === 0) {
      throw new Error("Feed boş veya ayrıştırılamadı");
    }

    container.innerHTML = "";
    items.slice(0, 15).forEach(item => {
      const title = item.querySelector("title")?.textContent?.trim() || "(başlıksız)";
      const link = item.querySelector("link")?.textContent?.trim() || "#";
      const pubDateRaw = item.querySelector("pubDate")?.textContent;
      const descRaw = item.querySelector("description")?.textContent || "";

      const date = pubDateRaw
        ? new Date(pubDateRaw).toLocaleDateString("tr-TR", { year: "numeric", month: "long", day: "numeric" })
        : "";
      // description'dan HTML etiketlerini temizleyip kısa özet çıkar
      const plain = descRaw.replace(/<[^>]*>/g, "").slice(0, 180);

      const card = document.createElement("div");
      card.className = "post-card";
      card.innerHTML = `
        <h3><a href="${link}" target="_blank">${title}</a></h3>
        <div class="meta">${date}</div>
        <p>${plain}…</p>
      `;
      container.appendChild(card);
    });
  } catch (err) {
    container.innerHTML =
      '<p class="error">Yazılar otomatik yüklenemedi. ' +
      '<a href="{{ site.substack_url }}" target="_blank">Substack sayfamı buradan ziyaret edebilirsin</a>.</p>';
    console.error(err);
  }
})();
</script>

<hr style="margin:3em 0; border:none; border-top:1px solid var(--border);">

<h2>Notlarım</h2>
<p>Bazı yazılara kendi notlarımı/eklerimi burada da tutuyorum:</p>

{% for post in site.posts %}
<div class="post-card">
  <h3><a href="{{ post.url | relative_url }}">{{ post.title }}</a></h3>
  <div class="meta">{{ post.date | date: "%d %B %Y" }}</div>
  <p>{{ post.excerpt }}</p>
</div>
{% endfor %}

---
layout: default
title: Blog
permalink: "/icerik/blog.html"
---

<h1>Blog</h1>
<p>
  Yazılarımı <a href="{{ site.substack_url }}" target="_blank" rel="noopener noreferrer">Substack</a> üzerinde
  yayınlıyorum.
</p>

<div class="blog-columns">

  <div class="blog-column">
    <h2>Substack Yazıları</h2>
    <input
      type="text"
      id="substack-search"
      class="search-box"
      placeholder="Yazı ara…"
      disabled>

    <div id="substack-posts" class="scroll-list">
      <p class="loading">Yazılar yükleniyor…</p>
    </div>
  </div>

  <div class="blog-column">
    <h2>Notlarım</h2>
    <input
      type="text"
      id="notes-search"
      class="search-box"
      placeholder="Notlarımda ara…">

    <div id="notes-posts" class="scroll-list">
      {% assign yayindaki_yazilar = site.posts | where_exp: "p", "p.yayinda != false" | where_exp: "p", "p.date <= site.time" %}
      {% for post in yayindaki_yazilar %}
      <div class="post-card searchable" data-search="{{ post.title | downcase }} {{ post.author | downcase }} {{ post.excerpt | strip_html | downcase }}" data-date="{{ post.date | date: '%Y-%m-%d' }}">
        <h3><a href="{{ post.url | relative_url }}">{{ post.title }}</a></h3>
        <div class="meta">
          {{ post.date | date: "%d %B %Y" }}
          {% if post.author %} · Yazan: {{ post.author }}{% endif %}
        </div>
        <p>{{ post.excerpt }}</p>
      </div>
      {% endfor %}
      {% if yayindaki_yazilar.size == 0 %}
        <p class="loading">Henüz not eklenmedi.</p>
      {% endif %}
    </div>
  </div>

</div>

<script>
(async function () {
  // NOT: Bu bölüm eskiden Substack feed'ini ücretsiz, herkese açık bir
  // üçüncü parti CORS proxy'si (api.allorigins.win) üzerinden çekiyordu.
  // O servisin uptime garantisi yok ve zaman zaman tamamen kesiliyor
  // (500 hatası) — yazıların hiç yüklenmemesinin sebebi buydu. Artık
  // kendi Cloudflare Worker'ımız üzerinden çekiliyor (bkz.
  // cloudflare worker/substack_feed_proxy_worker/worker.js), böylece
  // güvenilmez bir dış servise bağımlılık ortadan kalkıyor.
  const SUBSTACK_FEED_PROXY_WORKER_URL = "https://substack-feed-proxy-worker.aeymena.workers.dev";
  const proxyUrl = SUBSTACK_FEED_PROXY_WORKER_URL;
  const container = document.getElementById("substack-posts");
  const searchBox = document.getElementById("substack-search");

  // WEBVIEW UYUMLULUĞU: fetch() bazı Android WebView'lerinde ağ/CORS
  // engellemesinde ne reddedilir ne sonuçlanır — süresiz ASKIDA kalabilir
  // (yalnızca "TypeError: Failed to fetch" fırlatması garanti değildir).
  // AbortController ile 10 sn'lik açık bir zaman aşımı koyuyoruz ki catch
  // bloğu HER durumda (ağ hatası, CORS, timeout) tetiklensin ve "Yazılar
  // yükleniyor…" ekranda sonsuza dek asılı kalmasın; sayfanın geri kalanı
  // (Notlarım sütunu vb.) bundan bağımsız sorunsuz render olmaya devam eder.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(proxyUrl, { signal: controller.signal });
    if (!res.ok) throw new Error("Proxy isteği başarısız: " + res.status);
    const xmlText = await res.text();

    const parser = new DOMParser();
    const xml = parser.parseFromString(xmlText, "application/xml");

    // DOMParser bozuk XML'de hata FIRLATMAZ, <parsererror> düğümü içeren
    // bir belge döner — bunu ayrıca kontrol ediyoruz (proxy bazen HTML
    // hata sayfası ya da JSON döndürebiliyor, bu durumda querySelectorAll
    // sessizce boş dizi döner ve aşağıdaki kontrol zaten yakalar, ama
    // açıkça kontrol etmek hatayı konsolda daha anlaşılır kılıyor).
    if (xml.querySelector("parsererror")) {
      throw new Error("Feed XML olarak ayrıştırılamadı");
    }

    const items = Array.from(xml.querySelectorAll("item"));

    if (items.length === 0) {
      throw new Error("Feed boş veya ayrıştırılamadı");
    }

    // RSS'ten gelen metinler innerHTML'e basılmadan önce HTML özel
    // karakterlerinden arındırılıyor (XSS koruması).
    function escapeHtml(text) {
      const div = document.createElement("div");
      div.textContent = text == null ? "" : String(text);
      return div.innerHTML;
    }

    // Substack'in RSS'i açıklamaları "&#252;" gibi HTML entity kodlarıyla
    // gönderiyor (ü, ', " gibi karakterler için). Bunları gerçek karaktere
    // çevirmek için tarayıcının kendi HTML ayrıştırıcısını kullanıyoruz.
    // ÖNEMLİ: Bu adım entity'leri çözer ama aynı zamanda metni geçici olarak
    // gerçek HTML'e çevirdiği için, sonucu SADECE .textContent ile okuyoruz
    // (asla innerHTML olarak geri basmıyoruz) — bu yüzden güvenlik açığı oluşturmaz.
    function decodeEntities(text) {
      const el = document.createElement("textarea");
      el.innerHTML = text;
      return el.textContent;
    }

    // Ekstra savunma katmanı: link http(s):// ile başlamalı VE içinde
    // boşluk/kontrol karakteri olmamalı. RSS içeriği kendi Worker'ımızdan
    // geçse de, kaynağı (Substack) tam kontrolümüzde olmadığı için gelen
    // link'i kendi tarafımızda da doğruluyoruz.
    function guvenliLink(url) {
      if (typeof url !== "string") return "#";
      const trimmed = url.trim();
      if (/^https?:\/\/[^\s<>"']+$/i.test(trimmed)) return trimmed;
      return "#";
    }

    container.innerHTML = "";
    items.forEach(item => {
      const titleRaw = item.querySelector("title")?.textContent?.trim() || "(başlıksız)";
      const link = item.querySelector("link")?.textContent?.trim() || "#";
      const pubDateRaw = item.querySelector("pubDate")?.textContent;
      const descRaw = item.querySelector("description")?.textContent || "";

      const title = decodeEntities(titleRaw);
      const date = pubDateRaw
        ? new Date(pubDateRaw).toLocaleDateString("tr-TR", { year: "numeric", month: "long", day: "numeric" })
        : "";
      // önce HTML etiketlerini temizle, sonra entity'leri çöz
      const withoutTags = descRaw.replace(/<[^>]*>/g, "");
      const plain = decodeEntities(withoutTags).slice(0, 180);

      const card = document.createElement("div");
      card.className = "post-card searchable";
      // arama için başlık+özet küçük harfe çevrilip veri olarak saklanıyor
      card.dataset.search = (title + " " + plain).toLowerCase();
      card.innerHTML = `
        <h3><a href="${escapeHtml(guvenliLink(link))}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a></h3>
        <div class="meta">${escapeHtml(date)}</div>
        <p>${escapeHtml(plain)}…</p>
      `;
      container.appendChild(card);
    });

    // Veri geldikten sonra arama kutusunu aktif hale getiriyoruz
    searchBox.disabled = false;
    searchBox.placeholder = "Yazı ara…";

  } catch (err) {
    // Timeout (AbortError) dahil HER hata türünde container'daki "yükleniyor"
    // metni kaldırılıp yerine kullanıcının ilerleyebileceği bir mesaj
    // konuyor — sayfa sonsuza dek "Yazılar yükleniyor…" durumunda kalmıyor.
    const mesaj =
      err.name === "AbortError" ? "Yazılar zaman aşımına uğradı." : "Yazılar otomatik yüklenemedi.";
    container.innerHTML =
      `<p class="error">${mesaj} ` +
      '<a href="{{ site.substack_url }}" target="_blank" rel="noopener noreferrer">Substack sayfamı buradan ziyaret edebilirsin</a>.</p>';
    console.error(err);
  } finally {
    clearTimeout(timeoutId);
  }
})();

// Genel arama mantığı: bir arama kutusu + bir liste kutusunu birbirine bağlar.
// Hem Substack hem Notlarım sütunu bu aynı fonksiyonu kullanır.
function baglaArama(inputId, listId) {
  const input = document.getElementById(inputId);
  const list = document.getElementById(listId);

  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    const cards = list.querySelectorAll(".searchable");
    let visibleCount = 0;

    cards.forEach(card => {
      const match = card.dataset.search.includes(q);
      card.style.display = match ? "" : "none";
      if (match) visibleCount++;
    });

    // "sonuç yok" mesajını yönet
    let emptyMsg = list.querySelector(".no-results");
    if (visibleCount === 0 && q !== "") {
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
}

baglaArama("substack-search", "substack-posts");
baglaArama("notes-search", "notes-posts");
</script>

<script type="module">
  // "Sadece Supabase'te Yayınla" (bkz. panel/github-yonetim.md, migration
  // 0015) ile yayınlanmış, GitHub'a hiç commit edilmemiş ama GERÇEKTEN
  // yayında olan yazıları burada Jekyll'in ürettiği statik kartlarla
  // BİRLEŞTİRİYORUZ — build zamanında (Jekyll derlemesi sırasında) bu
  // içerikler var olmadığından site.posts içinde hiç görünmezler, bu
  // yüzden istemci tarafında ayrıca çekilip listeye ekleniyorlar. Arama
  // kutusu zaten ".searchable" + "data-search" üzerinden çalıştığı için
  // (bkz. yukarıdaki baglaArama), buraya eklenen kartlar otomatik olarak
  // aranabilir hâle gelir — ekstra bir kablolamaya gerek yok.
  import { supabase, escapeHtml } from "{{ '/assets/js/core/supabase-client.js' | relative_url }}";

  (async function () {
    const list = document.getElementById("notes-posts");
    if (!list) return;

    try {
      const { data, error } = await supabase.rpc("sadece_supabase_yayinlari_listele", { p_tur: "blog" });
      if (error) throw error;
      const yazilar = data || [];
      if (yazilar.length === 0) return;

      // "Henüz not eklenmedi" mesajını (varsa) kaldır — artık en az bir yazı var.
      list.querySelector("p.loading")?.remove();

      const base = document.documentElement.dataset.baseurl || "";
      yazilar.forEach((yazi) => {
        const card = document.createElement("div");
        card.className = "post-card searchable";
        const ozet = (yazi.govde || "").replace(/[#*`>_-]/g, "").slice(0, 180);
        card.dataset.search = `${(yazi.baslik || "").toLowerCase()} ${(yazi.yazar_adi || "").toLowerCase()} ${ozet.toLowerCase()}`;
        card.dataset.date = yazi.tarih || "";
        const href = `${base}/icerik/supabase-yazi.html?tur=blog&slug=${encodeURIComponent(yazi.slug)}`;
        const tarihMetni = yazi.tarih
          ? new Date(yazi.tarih).toLocaleDateString("tr-TR", { day: "2-digit", month: "long", year: "numeric" })
          : "";
        card.innerHTML = `
          <h3><a href="${href}">${escapeHtml(yazi.baslik || "")}</a></h3>
          <div class="meta">
            ${escapeHtml(tarihMetni)}
            ${yazi.yazar_adi ? ` · Yazan: ${escapeHtml(yazi.yazar_adi)}` : ""}
          </div>
          <p>${escapeHtml(ozet)}${ozet.length >= 180 ? "…" : ""}</p>
        `;

        // Tarihe göre doğru konuma yerleştir (en yeni en üstte) — mevcut
        // Jekyll kartları arasına, kendi tarihine göre karışık sıralanır.
        const digerKartlar = Array.from(list.querySelectorAll(".post-card.searchable"));
        const eklenecekYer = digerKartlar.find((k) => (k.dataset.date || "") < card.dataset.date);
        if (eklenecekYer) {
          list.insertBefore(card, eklenecekYer);
        } else {
          list.appendChild(card);
        }
      });
    } catch (err) {
      // Sessizce vazgeç — Substack ve GitHub tabanlı yazılar zaten
      // gösteriliyor, bu ek kaynak başarısız olsa bile sayfanın geri
      // kalanı normal çalışmaya devam etmeli.
      console.error("Supabase'te yayınlanan yazılar yüklenemedi:", err);
    }
  })();
</script>


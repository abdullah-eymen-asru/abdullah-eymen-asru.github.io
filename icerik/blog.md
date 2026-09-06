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
    <div class="filter-row">
      <input
        type="text"
        id="substack-search"
        class="search-box"
        placeholder="Yazı ara…"
        disabled>
      <select id="substack-year-filter" class="tur-select" disabled>
        <option value="">Tüm yıllar</option>
      </select>
    </div>

    <div id="substack-posts" class="scroll-list">
      <p class="loading">Yazılar yükleniyor…</p>
    </div>
  </div>

  <div class="blog-column">
    <h2>Notlarım</h2>
    <div class="filter-row">
      <input
        type="text"
        id="notes-search"
        class="search-box"
        placeholder="Notlarımda ara…">
      <select id="notes-year-filter" class="tur-select">
        <option value="">Tüm yıllar</option>
      </select>
    </div>

    <div id="notes-posts" class="scroll-list">
      {% assign yayindaki_yazilar = site.posts | where_exp: "p", "p.yayinda != false" | where_exp: "p", "p.date <= site.time" %}
      {% for post in yayindaki_yazilar %}
      {% comment %}
        TARİH: eskiden post.date, "%d %B %Y" biçiminde doğrudan yazdırılıyordu
        — Jekyll'in `date: "%B"` filtresi build ortamının locale'i yüzünden
        AY ADINI HER ZAMAN İNGİLİZCE üretiyordu (ör. "05 September 2026").
        `ay_adi_tr` (bkz. _plugins/turkce_ay_filtresi.rb) bunu düzeltiyor.
        Ayrıca "Yayın tarihi: " etiketi eklendi — akademik-projeler.md'deki
        AYNI gerekçeyle (tarih, yanındaki başka bir etiketle karışmasın).
      {% endcomment %}
      <div class="post-card searchable" data-search="{{ post.title | downcase }} {{ post.author | downcase }} {{ post.excerpt | strip_html | downcase }}" data-date="{{ post.date | date: '%Y-%m-%d' }}">
        <h3><a href="{{ post.url | relative_url }}">{{ post.title }}</a></h3>
        <div class="meta">
          Yayın tarihi: {{ post.date | date: "%-d" }} {{ post.date | ay_adi_tr }} {{ post.date | date: "%Y" }}
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
      // TAM TARİH ("Yayın tarihi: ..."): eskiden burada sadece tarih
      // yazıyordu, etiketsiz — Notlarım/Akademik Projeler sütunlarındaki
      // AYNI gerekçeyle (bkz. dosya başındaki not) artık "Yayın tarihi: "
      // ile başlıyor. data-date (YYYY-MM-DD) ayrıca yıl filtresi için
      // saklanıyor — RSS'in pubDate'i zaten ISO değil (ör. "Sat, 05 Sep
      // 2026 ..."), bu yüzden Date nesnesinden yeniden ISO'ya çeviriyoruz.
      const tarihIso = pubDateRaw && !isNaN(new Date(pubDateRaw).getTime())
        ? new Date(pubDateRaw).toISOString().slice(0, 10)
        : "";
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
      card.dataset.date = tarihIso;
      card.innerHTML = `
        <h3><a href="${escapeHtml(guvenliLink(link))}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a></h3>
        <div class="meta">${date ? "Yayın tarihi: " + escapeHtml(date) : ""}</div>
        <p>${escapeHtml(plain)}…</p>
      `;
      container.appendChild(card);
    });

    // Veri geldikten sonra arama kutusunu VE yıl filtresini aktif hale
    // getiriyoruz, yıl seçeneklerini de şimdi (öğeler DOM'a girdikten
    // sonra) dolduruyoruz.
    searchBox.disabled = false;
    searchBox.placeholder = "Yazı ara…";
    const yearSelect = document.getElementById("substack-year-filter");
    if (yearSelect) {
      window.yilSecenekleriniDoldur("substack-posts", "substack-year-filter");
      yearSelect.disabled = false;
    }

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

// YIL FİLTRESİ SEÇENEKLERİNİ DOLDUR: verilen liste kutusundaki tüm
// ".searchable" kartların data-date'inden (YYYY-MM-DD) yıl çıkarılıp
// tekilleştirilerek, büyükten küçüğe verilen <select>'e yazılır. window'a
// asılı (window.yilSecenekleriniDoldur) çünkü hem bu script hem de aşağıdaki
// ayrı <script type="module"> bloğu (Supabase'ten eklenen notlar için)
// bunu çağırabilsin diye — modül script'leri kendi kapsamında çalışır,
// global olarak tanımlı bir fonksiyonu ÇAĞIRABİLİR ama modülün KENDİ
// tanımladığı fonksiyonlar dışarıdan görünmez, bu yüzden paylaşılan yön
// HER ZAMAN "normal script -> window'a asar, modül script okur" şeklinde.
window.yilSecenekleriniDoldur = function (listId, selectId) {
  const list = document.getElementById(listId);
  const select = document.getElementById(selectId);
  if (!list || !select) return;

  const yillar = new Set();
  list.querySelectorAll(".searchable").forEach((card) => {
    const yil = (card.dataset.date || "").slice(0, 4);
    if (yil) yillar.add(yil);
  });

  const seciliDeger = select.value;
  select.innerHTML = '<option value="">Tüm yıllar</option>';
  Array.from(yillar).sort((a, b) => b.localeCompare(a)).forEach((yil) => {
    const opt = document.createElement("option");
    opt.value = yil;
    opt.textContent = yil;
    select.appendChild(opt);
  });
  if (Array.from(select.options).some((o) => o.value === seciliDeger)) {
    select.value = seciliDeger;
  }
};

// Genel arama + yıl filtresi mantığı: bir arama kutusu + bir yıl <select>'i
// + bir liste kutusunu birbirine bağlar (VE mantığıyla birlikte uygular).
// Hem Substack hem Notlarım sütunu bu aynı fonksiyonu kullanır.
function baglaAramaVeYil(inputId, yearSelectId, listId) {
  const input = document.getElementById(inputId);
  const yearSelect = document.getElementById(yearSelectId);
  const list = document.getElementById(listId);

  function uygula() {
    const q = input.value.trim().toLowerCase();
    const yil = yearSelect.value;
    const cards = list.querySelectorAll(".searchable");
    let visibleCount = 0;

    cards.forEach(card => {
      const metinEslesiyor = q === "" || card.dataset.search.includes(q);
      const yilEslesiyor = yil === "" || (card.dataset.date || "").slice(0, 4) === yil;
      const match = metinEslesiyor && yilEslesiyor;
      card.style.display = match ? "" : "none";
      if (match) visibleCount++;
    });

    // "sonuç yok" mesajını yönet
    let emptyMsg = list.querySelector(".no-results");
    if (visibleCount === 0 && (q !== "" || yil !== "")) {
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

  input.addEventListener("input", uygula);
  yearSelect.addEventListener("change", uygula);
}

baglaAramaVeYil("substack-search", "substack-year-filter", "substack-posts");
baglaAramaVeYil("notes-search", "notes-year-filter", "notes-posts");

// Notlarım sütunu Jekyll build-time'da hazır olduğu için yıl seçeneklerini
// hemen dolduruyoruz (Substack için bu, feed geldikten SONRA yukarıda
// ayrıca çağrılıyor). Supabase'ten eklenen notlar için de aşağıdaki ayrı
// <script type="module"> bloğu bu fonksiyonu TEKRAR çağırıp olası yeni
// yılları ekliyor.
window.yilSecenekleriniDoldur("notes-posts", "notes-year-filter");
</script>

<script type="module">
  // "Sadece Supabase'te Yayınla" (bkz. panel/github-yonetim.md, migration
  // 0015) ile yayınlanmış, GitHub'a hiç commit edilmemiş ama GERÇEKTEN
  // yayında olan yazıları burada Jekyll'in ürettiği statik kartlarla
  // BİRLEŞTİRİYORUZ — build zamanında (Jekyll derlemesi sırasında) bu
  // içerikler var olmadığından site.posts içinde hiç görünmezler, bu
  // yüzden istemci tarafında ayrıca çekilip listeye ekleniyorlar. Arama
  // kutusu zaten ".searchable" + "data-search" üzerinden çalıştığı için
  // (bkz. yukarıdaki baglaAramaVeYil), buraya eklenen kartlar otomatik olarak
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
            ${tarihMetni ? "Yayın tarihi: " + escapeHtml(tarihMetni) : ""}
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

      // Supabase'ten eklenen notların yılları da yıl filtresine yansısın diye
      // (bkz. yukarıdaki plain <script> bloğundaki window.yilSecenekleriniDoldur)
      // seçenekleri şimdi TEKRAR dolduruyoruz — daha önce seçili bir yıl
      // varsa o seçim korunur (bkz. fonksiyonun içindeki seciliDeger mantığı).
      window.yilSecenekleriniDoldur?.("notes-posts", "notes-year-filter");
    } catch (err) {
      // Sessizce vazgeç — Substack ve GitHub tabanlı yazılar zaten
      // gösteriliyor, bu ek kaynak başarısız olsa bile sayfanın geri
      // kalanı normal çalışmaya devam etmeli.
      console.error("Supabase'te yayınlanan yazılar yüklenemedi:", err);
    }
  })();
</script>


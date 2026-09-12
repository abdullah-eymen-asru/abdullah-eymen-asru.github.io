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

<!--
  SEKMELİ YAPI (BUG FİX / TASARIM DEĞİŞİKLİĞİ): Bu sayfa eskiden iki sütunlu
  bir grid'di (.blog-columns) — Substack yazıları solda, "Notlarım" sağda,
  ikisi de HER ZAMAN aynı anda görünürdü. Masaüstünde yan yana durduğu için
  kabul edilebilirdi, ama mobilde (bkz. @media max-width:720px, sütunlar
  alt alta düşüyordu) İKİ AYRI arama kutusu + İKİ AYRI yıl filtresi + İKİ
  AYRI uzun kaydırmalı liste tek ekranda üst üste yığılıyordu — kullanıcı
  hangi arama kutusunun hangi listeye ait olduğunu karıştırıyor, sayfada
  kayboluyordu ("scroll trap" hissi).

  ÇÖZÜM: "Listelerim" (İzlediklerim/Okuduklarım) sayfasındaki GÖRSEL
  sekme dilini (.listeler-sekmeler / .sekme-btn, bkz. style.css) buraya da
  taşıyoruz — AMA o sayfadaki gibi <a href> ile AYRI URL'lere gitmek yerine
  (çünkü bu iki içerik ayrı sayfalar değil, aynı sayfanın iki görünümü),
  gerçek bir ARIA "tab" deseni kuruyoruz: role="tablist" + role="tab" +
  aria-selected, ve tıklanan sekmeye göre SADECE ilgili panel
  (role="tabpanel") gösterilip diğeri gizleniyor. Böylece ekranda AYNI ANDA
  sadece TEK bir arama kutusu + TEK bir liste oluyor, mobil karmaşa ortadan
  kalkıyor; masaüstünde de artık geniş boşlukta yan yana iki dar sütun
  yerine, tek seferde tam genişlikte okunan bir liste var — ki bu da uzun
  yazı özetleri için daha ferah bir okuma deneyimi.

  Sekme seçimi URL hash'ine yazılıyor (#yazilarim / #substack, bkz. altta
  JS) — böylece biri "blog.html#substack" linkini paylaştığında, sayfa
  doğrudan o sekmeyi açık şekilde yükleniyor.
-->
<div class="listeler-sekmeler" role="tablist" aria-label="Blog içerik türü">
  <button
    type="button"
    role="tab"
    id="blog-sekme-yazilarim"
    class="sekme-btn aktif"
    aria-selected="true"
    aria-controls="blog-panel-yazilarim"
  >✍️ Yazılarım</button>
  <button
    type="button"
    role="tab"
    id="blog-sekme-substack"
    class="sekme-btn"
    aria-selected="false"
    tabindex="-1"
    aria-controls="blog-panel-substack"
  >📰 Substack Bülteni</button>
</div>

<div id="blog-panel-yazilarim" class="blog-panel" role="tabpanel" aria-labelledby="blog-sekme-yazilarim" tabindex="0">
  <div class="filter-row">
    <label for="notes-search" class="sr-only">Yazılarımda ara</label>
    <input
      type="text"
      id="notes-search"
      class="search-box"
      placeholder="Yazılarımda ara…">
    <label for="notes-year-filter" class="sr-only">Yazılarımı yıla göre filtrele</label>
    <select id="notes-year-filter" class="tur-select">
      <option value="">Tüm yıllar</option>
    </select>
  </div>

  <div id="notes-posts" class="scroll-list" role="region" aria-label="Yazılarım listesi" aria-live="polite" tabindex="0">
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
      <p class="loading">Henüz yazı eklenmedi.</p>
    {% endif %}
  </div>
</div>

<div id="blog-panel-substack" class="blog-panel" role="tabpanel" aria-labelledby="blog-sekme-substack" tabindex="0" hidden>
  <div class="filter-row">
    <!--
      ERİŞİLEBİLİRLİK: Bu input/select'lerin ÖNCEDEN görünür/programatik
      HİÇBİR etiketi yoktu — sadece placeholder metni vardı. Placeholder,
      WCAG'e göre bir <label> yerine GEÇMEZ: (1) kullanıcı bir şey
      yazmaya başlar başlamaz kaybolur, o an ekran okuyucu kullanıcısı
      da dahil kimse alanın ne işe yaradığını göremez; (2) çoğu ekran
      okuyucu placeholder'ı hiç okumaz ya da "isim/açıklama" olarak değil
      yalnızca ipucu metni olarak okur, alan sesli olarak "adsız düzenleme
      kutusu" gibi duyurulabilir. Görsel olarak bir <label> EKLEMEK
      istemiyoruz (tasarım zaten placeholder ile kompakt tutulmuş) — bu
      yüzden ".sr-only" (bkz. style.css başı — ekranda görünmez ama
      ekran okuyucuya görünür) bir <label> ekliyoruz; placeholder GÖRSEL
      ipucu olarak kalmaya devam ediyor, ama artık her iki kullanıcı
      grubu için de alanın amacı net.
    -->
    <label for="substack-search" class="sr-only">Substack yazılarında ara</label>
    <input
      type="text"
      id="substack-search"
      class="search-box"
      placeholder="Yazı ara…"
      disabled
      aria-describedby="substack-search-durum">
    <label for="substack-year-filter" class="sr-only">Substack yazılarını yıla göre filtrele</label>
    <select id="substack-year-filter" class="tur-select" disabled aria-describedby="substack-search-durum">
      <option value="">Tüm yıllar</option>
    </select>
    <!--
      Neden disabled olduğunu (henüz feed yüklenmedi) hem görsel hem
      ekran-okuyucu kullanıcısına açıklayan, ekranda görünmez metin.
      JS bu alanları enabled yaptığında (bkz. aşağıdaki script,
      searchBox.disabled = false satırı) bu açıklama artık geçerli
      olmadığından aynı yerde kaldırılıyor.
    -->
    <span id="substack-search-durum" class="sr-only">Yazılar yüklenene kadar arama ve filtre kutuları kullanılamaz.</span>
  </div>

  <!--
    ERİŞİLEBİLİRLİK — CANLI BÖLGE: Bu kutunun içeriği JS ile üç ayrı
    anda değişiyor: (1) ilk yüklemede "Yazılar yükleniyor…" -> gerçek
    kart listesi, (2) arama/yıl filtresi her değiştiğinde görünür kart
    sayısı, (3) ağ hatası olursa hata mesajı. role="region" + aria-live
    olmadan ekran okuyucu kullanıcısı bu değişikliklerin HİÇBİRİNDEN
    haberdar olmaz — imleci o an başka bir yerdeyse (ör. arama kutusuna
    yazarken) listenin güncellendiğini fark etmesinin tek yolu manuel
    olarak listeye gidip yeniden okumaktır. "polite" (assertive DEĞİL)
    seçildi çünkü bu bir hata/acil durum uyarısı değil — kullanıcının o
    an yaptığı işi (ör. yazmayı) kesmeden, o iş bittiğinde duyurulması
    yeterli. aria-busy, yükleme sırasında "true", tamamlanınca JS
    tarafından "false" yapılıyor (bkz. script) — bazı ekran okuyucular
    bunu "içerik hâlâ değişiyor, bitene kadar bekle" sinyali olarak
    kullanır.
  -->
  <div id="substack-posts" class="scroll-list" role="region" aria-label="Substack yazı listesi" aria-live="polite" aria-busy="true" tabindex="0">
    <p class="loading">Yazılar yükleniyor…</p>
  </div>
</div>

<script>
// ============================================================================
// SEKME GEÇİŞ MANTIĞI ("Yazılarım" / "Substack Bülteni")
//
// Bu bölüm, eski iki-sütunlu (.blog-columns) düzenin yerine geçen sekmeli
// yapının aç/kapa mantığını kurar — bkz. HTML'deki büyük tasarım-değişikliği
// notu. Standart WAI-ARIA "tabs" deseni izleniyor:
//   - role="tablist" içindeki role="tab" düğmelerinden birine tıklanınca,
//     o düğme aria-selected="true" olur (diğeri "false"), ve SADECE onun
//     aria-controls ile işaret ettiği role="tabpanel" gösterilir.
//   - Solda/sağda ok tuşlarıyla da (Left/Right, Home/End) sekmeler arası
//     gezinme desteği eklendi — klavye kullanıcıları fare olmadan da
//     sekmeler arasında dolaşabilsin diye (WAI-ARIA Authoring Practices'in
//     "tabs" deseni bunu bekler; sadece Tab tuşuyla değil, ok tuşlarıyla
//     da gezinme standarttır).
//   - Seçili sekme URL hash'ine yazılır (#yazilarim / #substack) — sayfa
//     "blog.html#substack" gibi doğrudan bir sekmeye linklenebilsin diye.
//     Sayfa ilk açıldığında da mevcut hash'e bakılıp ona göre başlangıç
//     sekmesi belirlenir (hash yoksa/tanınmıyorsa varsayılan: Yazılarım).
// ============================================================================
(function () {
  const sekmeler = [
    { btnId: "blog-sekme-yazilarim", panelId: "blog-panel-yazilarim", hash: "yazilarim" },
    { btnId: "blog-sekme-substack", panelId: "blog-panel-substack", hash: "substack" },
  ];

  function sekmeyiSec(hedefHash, odaklan) {
    let bulunduMu = false;
    sekmeler.forEach(({ btnId, panelId, hash }) => {
      const btn = document.getElementById(btnId);
      const panel = document.getElementById(panelId);
      if (!btn || !panel) return;
      const secili = hash === hedefHash;
      if (secili) bulunduMu = true;
      btn.classList.toggle("aktif", secili);
      btn.setAttribute("aria-selected", String(secili));
      // Sadece SEÇİLİ sekme düğmesi normal Tab sırasında olsun (tabindex=0);
      // diğerleri Tab ile atlanır, aralarında gezinme ok tuşlarıyla yapılır
      // — bu da WAI-ARIA "tabs" deseninin standart klavye davranışı.
      btn.tabIndex = secili ? 0 : -1;
      panel.hidden = !secili;
      if (secili && odaklan) btn.focus();
    });
    return bulunduMu;
  }

  function mevcutHash() {
    return (window.location.hash || "").replace(/^#/, "");
  }

  // Sayfa ilk açıldığında: hash tanınıyorsa o sekmeyi, tanınmıyorsa/yoksa
  // varsayılan olarak "Yazılarım" sekmesini seç. HTML zaten "Yazılarım"ı
  // aktif/görünür başlattığı için (bkz. .sekme-btn.aktif ve panelin
  // "hidden" ATTRIBUTE'U OLMAMASI), burada başarısız bir eşleşme sayfanın
  // boş görünmesine yol açmaz — sadece hiçbir şeyi değiştirmemiş olur.
  sekmeyiSec(mevcutHash() === "substack" ? "substack" : "yazilarim", false);

  sekmeler.forEach(({ btnId, hash }, index) => {
    const btn = document.getElementById(btnId);
    if (!btn) return;

    btn.addEventListener("click", () => {
      sekmeyiSec(hash, false);
      // replaceState (pushState DEĞİL): sekmeler arası geçiş tarayıcı
      // geçmişine yeni bir kayıt EKLEMEMELİ — aksi halde kullanıcı "geri"
      // tuşuna bastığında sayfadan çıkmak yerine önceki sekmeye dönmeye
      // çalışır, ki bu kafa karıştırıcı olur (sekme geçişi bir "sayfa
      // değişikliği" değil, aynı sayfanın görünümü).
      history.replaceState(null, "", "#" + hash);
    });

    // OK TUŞLARIYLA GEZİNME (WAI-ARIA "tabs" deseni): Sol/Sağ ok bir
    // önceki/sonraki sekmeye geçer ve ona odaklanır (fareyle tıklamış gibi
    // davranır); Home/End ilk/son sekmeye atlar. Bu iki sekmeli basit
    // yapıda Sol/Sağ ile Home/End aynı sonucu verir ama gelecekte üçüncü
    // bir sekme eklenirse desen doğru ölçeklenir.
    btn.addEventListener("keydown", (e) => {
      let hedefIndex = null;
      if (e.key === "ArrowRight") hedefIndex = (index + 1) % sekmeler.length;
      else if (e.key === "ArrowLeft") hedefIndex = (index - 1 + sekmeler.length) % sekmeler.length;
      else if (e.key === "Home") hedefIndex = 0;
      else if (e.key === "End") hedefIndex = sekmeler.length - 1;
      if (hedefIndex === null) return;
      e.preventDefault();
      const hedefHash = sekmeler[hedefIndex].hash;
      sekmeyiSec(hedefHash, true);
      history.replaceState(null, "", "#" + hedefHash);
    });
  });

  // Kullanıcı tarayıcının geri/ileri tuşlarını kullanırsa (ör. bu sayfaya
  // başka bir sayfadan #substack hash'i taşıyan bir linkle geldiyse, sonra
  // geri gidip tekrar ileri geldiyse) hash'e göre doğru sekmeyi göster.
  window.addEventListener("hashchange", () => {
    sekmeyiSec(mevcutHash() === "substack" ? "substack" : "yazilarim", false);
  });
})();

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
  // (Yazılarım paneli vb.) bundan bağımsız sorunsuz render olmaya devam eder.
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
      // yazıyordu, etiketsiz — Yazılarım/Akademik Projeler panellerindeki
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
    searchBox.removeAttribute("aria-describedby");
    const yearSelect = document.getElementById("substack-year-filter");
    if (yearSelect) {
      window.yilSecenekleriniDoldur("substack-posts", "substack-year-filter");
      yearSelect.disabled = false;
      yearSelect.removeAttribute("aria-describedby");
    }
    // Artık geçerli olmayan "yüklenene kadar kullanılamaz" açıklamasını
    // DOM'dan da kaldırıyoruz (aria-describedby referansı yukarıda zaten
    // sökülmüştü, bu span'ın kendisi kalırsa sonraki bir odaklanmada
    // yanlışlıkla tekrar okunabilirdi diye tamamen temizliyoruz).
    document.getElementById("substack-search-durum")?.remove();
    // ERİŞİLEBİLİRLİK: yükleme bitti, canlı bölge artık "meşgul" değil —
    // aria-busy="false" bazı ekran okuyuculara içeriğin durulduğunu,
    // artık okunabilir/güvenilir olduğunu bildirir (bkz. yukarıdaki
    // blog.md'deki role="region" notunun devamı).
    container.setAttribute("aria-busy", "false");

  } catch (err) {
    // Timeout (AbortError) dahil HER hata türünde container'daki "yükleniyor"
    // metni kaldırılıp yerine kullanıcının ilerleyebileceği bir mesaj
    // konuyor — sayfa sonsuza dek "Yazılar yükleniyor…" durumunda kalmıyor.
    const mesaj =
      err.name === "AbortError" ? "Yazılar zaman aşımına uğradı." : "Yazılar otomatik yüklenemedi.";
    container.innerHTML =
      `<p class="error">${mesaj} ` +
      '<a href="{{ site.substack_url }}" target="_blank" rel="noopener noreferrer">Substack sayfamı buradan ziyaret edebilirsin</a>.</p>';
    // Hata durumunda da "meşgul" bayrağını kaldırıyoruz — aksi halde
    // aria-busy="true" sonsuza dek takılı kalır ve ekran okuyucu bu
    // bölgeyi (hatalı biçimde) hâlâ "yükleniyor" olarak değerlendirebilir.
    container.setAttribute("aria-busy", "false");
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
// Hem Substack hem Yazılarım paneli bu aynı fonksiyonu kullanır.
//
// ERİŞİLEBİLİRLİK NOTU: Kartları gizlemek için "display:none" kullanmak
// (aşağıda olduğu gibi) görsel olarak doğru ama tek başına ekran okuyucu
// kullanıcısına YETERLİ bilgi vermez — kullanıcı arama kutusuna yazarken
// imleç zaten oradadır, listeye "gidip" kaç sonuç kaldığını görmesi
// beklenemez. Bu yüzden her filtre uygulamasından sonra, listenin
// HEMEN ÖNÜNDEKİ .filter-row içine kısa bir "N sonuç" özetini ekliyoruz
// (bkz. durumOzeti oluşturma kısmı) — bu özet ".sr-only" olduğu için
// GÖRSEL olarak hiçbir şeyi değiştirmiyor (tasarım aynı kalıyor), ama
// aria-live="polite" olduğu için ekran okuyucu kullanıcısı yazmayı
// bitirir bitirmez "3 sonuç bulundu" gibi bir duyuru duyuyor.
function baglaAramaVeYil(inputId, yearSelectId, listId) {
  const input = document.getElementById(inputId);
  const yearSelect = document.getElementById(yearSelectId);
  const list = document.getElementById(listId);

  // Durum özetini tutacak canlı bölge — filter-row'un İÇİNDE değil hemen
  // ARDINDAN, listeden önce; input/select'lerin DOM sırasını bozmamak ve
  // "sr-only" olduğu için zaten görünmeyeceği için konum görsel olarak
  // önemsiz, ama mantıksal akışta (arama kutuları -> sonuç özeti -> liste)
  // doğru sırada olsun diye buraya ekleniyor.
  let durumOzeti = document.getElementById(listId + "-durum-ozeti");
  if (!durumOzeti) {
    durumOzeti = document.createElement("p");
    durumOzeti.id = listId + "-durum-ozeti";
    durumOzeti.className = "sr-only";
    durumOzeti.setAttribute("aria-live", "polite");
    list.parentElement.insertBefore(durumOzeti, list);
  }

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

    // Filtre hiç uygulanmamışken (arama boş VE yıl seçilmemiş) sonuç
    // sayısını duyurmuyoruz — bu durum zaten "tüm yazılar" demek, listeyi
    // her sayfa yüklemesinde gereksiz yere duyurmuş oluruz. Sadece
    // kullanıcı GERÇEKTEN bir filtre uyguladığında duyuruyoruz.
    if (q !== "" || yil !== "") {
      durumOzeti.textContent = visibleCount === 0
        ? "Eşleşen sonuç bulunamadı."
        : visibleCount + (visibleCount === 1 ? " sonuç bulundu." : " sonuç bulundu.");
    } else {
      durumOzeti.textContent = "";
    }
  }

  input.addEventListener("input", uygula);
  yearSelect.addEventListener("change", uygula);
}

baglaAramaVeYil("substack-search", "substack-year-filter", "substack-posts");
baglaAramaVeYil("notes-search", "notes-year-filter", "notes-posts");

// Yazılarım paneli Jekyll build-time'da hazır olduğu için yıl seçeneklerini
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


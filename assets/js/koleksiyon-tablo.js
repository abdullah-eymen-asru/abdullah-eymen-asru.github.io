/**
 * Bu dosya İzlediklerim ve Okuduklarım sayfalarının ortak mantığını taşır.
 * Build-time'da GitHub Actions tarafından üretilen statik JSON dosyalarını
 * (assets/data/izlenenler.json, okunanlar.json) fetch edip dinamik bir tablo,
 * arama kutusu, tür/durum filtreleri ve bir "kaç tane okudum/izledim"
 * istatistik şeridi oluşturur.
 *
 * "Dinamik" olmasının anlamı: kod hangi sütunların (Tür, Puan, Yazar vs.)
 * var olacağını build zamanında BİLMİYOR — JSON'da hangi alanlar geldiyse
 * onlara göre tablo başlıklarını kendisi kurar. Bu sayede GitHub Projects
 * tablosuna yeni bir sütun eklediğinde bu dosyaya hiç dokunman gerekmez.
 *
 * Hiçbir GitHub token'ı burada YOKTUR — bu kod tamamen ziyaretçinin
 * tarayıcısında çalışır ve sadece hazır, herkese açık bir JSON dosyasını okur.
 */

// GitHub'dan/JSON'dan gelen metinler kullanıcı tarafından girilebildiği için
// doğrudan innerHTML'e basılmıyor — HTML özel karakterleri kaçışlanıyor.
// (div.textContent -> div.innerHTML okuması, HTML serileştirme standardına göre
// < > & " karakterlerinin hepsini güvenli şekilde kaçışlar.)
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text == null ? "" : String(text);
  return div.innerHTML;
}

// Ekstra savunma katmanı: link http(s):// ile başlamalı VE içinde boşluk/
// kontrol karakteri (satır sonu dahil) olmamalı — sadece baştaki şemayı
// kontrol edip sonuna bir şey eklenebilmesine izin vermiyoruz. escapeHtml
// zaten attribute'tan çıkışı (örn. " ile kapatıp yeni attribute açmayı)
// engelliyor, bu ekstra bir kilit.
function guvenliLink(url) {
  if (typeof url !== "string") return "#";
  const trimmed = url.trim();
  if (/^https?:\/\/[^\s<>"']+$/i.test(trimmed)) return trimmed;
  return "#";
}

// Büyük/küçük harf duyarsız arama için Türkçe'ye uygun harf küçültme.
// Düz toLowerCase() "İ" (noktalı büyük İ) gibi harfleri Türkçe kuralına
// göre değil Unicode varsayılanına göre çevirir — bu da örneğin "İstanbul"
// yazınca "istanbul" ile eşleşmemesi gibi görünüşte rastgele arama
// başarısızlıklarına yol açabiliyordu. toLocaleLowerCase("tr") bunu
// Türkçe harf kurallarına göre doğru çevirir. (admin.js/github-yonetim.js
// içindeki aynı düzeltmeyle tutarlı olsun diye burada da uygulanıyor —
// bu dosya <script type="module"> DEĞİL, klasik bir script olduğu için
// ortak yardımcı dosyadan import edemiyor, küçük bir yerel kopya yeterli.)
function kucukHarfeCevirTr(metin) {
  return (metin == null ? "" : String(metin)).toLocaleLowerCase("tr");
}

// GitHub Projects'in "Date" alanları GraphQL'den her zaman "YYYY-MM-DD"
// formatında düz bir metin olarak gelir (saat/saat dilimi bilgisi YOKTUR).
// Bunu doğrudan `new Date(...)` ile parse edip .getFullYear() çağırmak,
// tarayıcının yerel saat dilimine göre (örn. UTC-x bölgelerde) günü bir
// önceki güne kaydırıp YANLIŞ yılı üretebilir. Bunun yerine baştaki 4
// haneyi düz metin olarak alıyoruz — saat dilimi belirsizliğine tamamen
// kapalı, garanti doğru bir yöntem.
function yilCikar(tarihMetni) {
  if (typeof tarihMetni !== "string") return null;
  const eslesme = tarihMetni.match(/^(\d{4})-\d{2}-\d{2}/);
  return eslesme ? eslesme[1] : null;
}

/**
 * "Kaç tane okudum/izledim" istatistik şeridini oluşturur.
 *
 * Mantık: her kaydın "tamamlanma yılı", önce Bitiş Tarihi'nden, o da yoksa
 * Başlama Tarihi'nden çıkarılır. İkisi de boşsa (örn. henüz başlanmamış,
 * "İzleyeceğim"/"Okuyacağım" durumundaki kayıtlar tipik olarak tarihsizdir)
 * o kayıt sayıma hiç girmez. Böylece ayrıca bir "Durum" alanı kontrolüne
 * ihtiyaç duymadan sayaç doğal olarak sadece başlanmış/bitmiş kayıtları
 * sayar — "başlama veya bitiş tarihi esas alınabilir" fikri tam olarak
 * bunu sağlıyor.
 *
 * Her yıl için ayrı bir kart + tüm yılların toplamı için bir "Toplam"
 * kartı üretilir. Yıllar en yeniden en eskiye sıralanır.
 */
function istatistikGosterimiOlustur(items, config) {
  if (!config.istatistikContainerId) return;
  const el = document.getElementById(config.istatistikContainerId);
  if (!el) return;

  const baslamaAlani = config.baslamaTarihiAlani || "Başlama Tarihi";
  const bitisAlani = config.bitisTarihiAlani || "Bitiş Tarihi";
  const eylem = config.istatistikEylem || "eklediğim";

  const yilSayaci = new Map();
  items.forEach(item => {
    const tarih = item[bitisAlani] || item[baslamaAlani];
    const yil = yilCikar(tarih);
    if (!yil) return;
    yilSayaci.set(yil, (yilSayaci.get(yil) || 0) + 1);
  });

  if (yilSayaci.size === 0) {
    el.innerHTML = "";
    el.hidden = true;
    return;
  }

  const toplam = [...yilSayaci.values()].reduce((a, b) => a + b, 0);
  // localeCompare ile string sıralama, 4 haneli yıllar için ("2026" > "2025")
  // sayısal sıralamayla birebir aynı sonucu verir, ekstra Number() dönüşümüne
  // gerek yok.
  const yillar = [...yilSayaci.keys()].sort((a, b) => b.localeCompare(a));

  const yilKartlariHtml = yillar.map(yil => `
    <div class="liste-istatistik-kart">
      <span class="liste-istatistik-sayi">${yilSayaci.get(yil).toLocaleString("tr-TR")}</span>
      <span class="liste-istatistik-etiket">${escapeHtml(yil)} yılında ${escapeHtml(eylem)}</span>
    </div>`).join("");

  el.hidden = false;
  el.innerHTML = `
    <div class="liste-istatistik-kart liste-istatistik-kart--toplam">
      <span class="liste-istatistik-sayi">${toplam.toLocaleString("tr-TR")}</span>
      <span class="liste-istatistik-etiket">Toplam ${escapeHtml(eylem)}</span>
    </div>
    ${yilKartlariHtml}`;
}

/**
 * @param {Object} config
 * @param {string} config.jsonUrl - JSON dosyasının yolu (örn. "/assets/data/izlenenler.json")
 * @param {string} config.containerId - Tablonun basılacağı <div> id'si
 * @param {string} config.searchInputId - Arama kutusu id'si
 * @param {string} config.turSelectId - Tür dropdown id'si
 * @param {string} config.turFieldName - JSON'daki hangi alan "Tür" olarak kullanılsın (örn. "Tür")
 * @param {string} [config.durumSelectId] - Durum/okuma durumu dropdown id'si (verilmezse durum filtresi kurulmaz)
 * @param {string} [config.durumFieldName] - JSON'daki hangi alan "Durum" filtresi olarak kullanılsın (örn. "Durum" ya da "Okuma Durumu")
 * @param {string[]} config.aramaAlanlari - Arama sırasında hangi alanlarda metin aransın (başlık her zaman dahildir)
 * @param {string[]} [config.gizliAlanlar] - Tabloda GÖSTERİLMEYECEK EK alan adları (id/url/state/title zaten her zaman gizli)
 * @param {number} [config.sayfaBasinaKayit=50] - Bir sayfada gösterilecek satır sayısı
 * @param {string} [config.istatistikContainerId] - "Kaç tane okudum/izledim" şeridinin basılacağı <div> id'si (verilmezse şerit oluşturulmaz)
 * @param {string} [config.istatistikEylem] - İstatistik etiketlerinde kullanılacak fiil (örn. "izlediğim", "okuduğum")
 * @param {string} [config.baslamaTarihiAlani="Başlama Tarihi"] - İstatistik hesaplamasında kullanılacak başlama tarihi alan adı
 * @param {string} [config.bitisTarihiAlani="Bitiş Tarihi"] - İstatistik hesaplamasında kullanılacak bitiş tarihi alan adı
 */
async function koleksiyonTablosuOlustur(config) {
  const container = document.getElementById(config.containerId);
  const searchBox = document.getElementById(config.searchInputId);
  const turSelect = document.getElementById(config.turSelectId);
  const durumSelect = config.durumSelectId ? document.getElementById(config.durumSelectId) : null;

  // "id", "url", "state" fetch-projects.js'in HER ZAMAN eklediği teknik
  // alanlar — bunlar hiçbir zaman ayrı sütun olarak gösterilmemeli, "url"
  // zaten Başlık sütununun linki için kullanılıyor. Kullanıcının verdiği
  // gizliAlanlar listesi bunun ÜSTÜNE ekleniyor (örn. "Durum", "Title").
  const gizliAlanlar = new Set(["id", "url", "state", ...(config.gizliAlanlar || [])]);
  const sayfaBasinaKayit = config.sayfaBasinaKayit || 50;

  // Sekme filtreleri: hem Tür hem (varsa) Durum/Okuma Durumu için AYNI
  // dropdown-doldurma + filtreleme mantığını tekrar tekrar yazmamak için
  // genel bir liste kuruyoruz. Her satıra buradaki alanların küçük harfli
  // değeri data-* attribute olarak yazılacak (örn. data-tur, data-durum),
  // dropdown'lar da JSON'daki gerçek (büyük/küçük harfi korunmuş) değerlerle
  // doldurulacak. Sadece HTML'de karşılığı olan (config'te id'si verilen)
  // filtreler listeye eklenir; okuduklarim.html'de olmayan bir alan
  // izlediklerim.html'i etkilemez ve tam tersi.
  const filtreTanimlari = [];
  if (config.turFieldName && turSelect) {
    filtreTanimlari.push({ alanAdi: config.turFieldName, select: turSelect, veriAlani: "tur" });
  }
  if (config.durumFieldName && durumSelect) {
    filtreTanimlari.push({ alanAdi: config.durumFieldName, select: durumSelect, veriAlani: "durum" });
  }

  // Ekran okuyucular için: koca tabloyu doğrudan aria-live yapmak (yüzlerce
  // satırı tek seferde okutup gürültü yaratır) yerine, "Yükleniyor…" ->
  // "143 kayıt yüklendi" gibi kısa durum değişikliklerini duyuran, görsel
  // olarak gizli (bkz. .sr-only) ayrı ve küçük bir canlı bölge kullanıyoruz.
  const durumDuyuru = document.createElement("div");
  durumDuyuru.className = "sr-only";
  durumDuyuru.setAttribute("role", "status");
  durumDuyuru.setAttribute("aria-live", "polite");
  container.parentNode.insertBefore(durumDuyuru, container);

  // WEBVIEW UYUMLULUĞU: aynı-origin bir istek olsa bile bazı WebView'lerde
  // ağ bağlantısı (ör. captive portal, flaky Wi-Fi) fetch()'i reddetmeden
  // süresiz askıda bırakabilir. AbortController ile 10 sn'lik açık bir
  // zaman aşımı koyup catch bloğunun HER durumda tetiklenmesini, "Liste
  // yükleniyor…" durumunun sonsuza dek sürmemesini sağlıyoruz.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    // cache: "no-store" -> tarayıcı bu isteği kendi önbelleğinden ASLA
    // karşılamaz, her sayfa yenilemesinde gerçekten taze veri ister.
    // Worker tarafında zaten kısa süreli (60sn) bir Cloudflare önbelleği
    // var, o yeterli hız/güvenlik dengesini sağlıyor.
    const res = await fetch(config.jsonUrl, { cache: "no-store", signal: controller.signal });
    if (!res.ok) throw new Error("JSON yüklenemedi: " + res.status);
    const data = await res.json();
    const items = Array.isArray(data.items) ? data.items : [];

    // İstatistik şeridi arama/filtrelemeden bağımsızdır — TÜM kayıtlar
    // üzerinden hesaplanır (görünürdeki sayfa/filtre durumuna göre değişmez),
    // bu yüzden burada, filtreleme başlamadan önce bir kere kuruluyor.
    istatistikGosterimiOlustur(items, config);

    if (items.length === 0) {
      container.innerHTML = '<p class="loading">Henüz eklenmiş bir kayıt yok.</p>';
      durumDuyuru.textContent = "Henüz eklenmiş bir kayıt yok.";
      return;
    }

    // Sütun sırası: Worker'dan gelen "fieldOrder" varsa GitHub Projects'teki
    // GERÇEK sütun sırasını birebir kullanıyoruz (senin panondaki düzenle
    // aynı görünsün diye). fieldOrder yoksa (eski/farklı bir kaynak
    // kullanılıyorsa) verideki alanları keşfederek eski davranışa dönüyoruz.
    let sutunlar;
    if (Array.isArray(data.fieldOrder) && data.fieldOrder.length > 0) {
      sutunlar = data.fieldOrder.filter(key => !gizliAlanlar.has(key));
    } else {
      sutunlar = [];
      const gorulenler = new Set();
      items.forEach(item => {
        Object.keys(item).forEach(key => {
          if (key === "id" || key === "title" || key === "url" || key === "state") return;
          if (gizliAlanlar.has(key)) return;
          if (!gorulenler.has(key)) {
            gorulenler.add(key);
            sutunlar.push(key);
          }
        });
      });
    }

    // Tablo başlıkları — "#" sırayı gösteren ilk sütun
    const theadHtml = `
      <tr>
        <th class="col-index">#</th>
        <th>Başlık</th>
        ${sutunlar.map(s => `<th>${escapeHtml(s)}</th>`).join("")}
      </tr>`;

    // Tablo satırları
    let rows = "";
    items.forEach((item, index) => {
      const aramaMetniParcalari = [item.title];
      (config.aramaAlanlari || []).forEach(alan => {
        if (item[alan] != null) aramaMetniParcalari.push(item[alan]);
      });
      const searchText = aramaMetniParcalari.join(" ").toString();
      const searchTextKucuk = kucukHarfeCevirTr(searchText);

      // Her filtre tanımı (Tür, Durum...) için o satırın küçük harfli
      // değerini ayrı bir data-* attribute olarak yazıyoruz.
      const filtreDataAttrs = filtreTanimlari.map(f => {
        const deger = kucukHarfeCevirTr(item[f.alanAdi] || "");
        return ` data-${f.veriAlani}="${escapeHtml(deger)}"`;
      }).join("");

      // data-label: mobilde (≤640px, bkz. style.css "MOBİL KART GÖRÜNÜMÜ")
      // tablo satır satır kartlara dönüşüyor ve her hücre CSS ile kendi
      // sütun adını "::before { content: attr(data-label) }" olarak
      // gösteriyor. Bu yüzden her <td>'ye kendi sütununun adını buraya
      // yazıyoruz — thead'deki metinle birebir aynı olmalı.
      const hucreler = sutunlar.map(sutun => {
        const deger = item[sutun];
        return `<td data-label="${escapeHtml(sutun)}">${escapeHtml(deger == null ? "" : deger)}</td>`;
      }).join("");

      rows += `
        <tr class="searchable" data-search="${escapeHtml(searchTextKucuk)}"${filtreDataAttrs}>
          <td class="col-index">${index + 1}</td>
          <td><a href="${escapeHtml(guvenliLink(item.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a></td>
          ${hucreler}
        </tr>`;
    });

    container.innerHTML = `
      <table>
        <thead>${theadHtml}</thead>
        <tbody id="${config.containerId}-tbody">${rows}</tbody>
      </table>
      <div id="${config.containerId}-pagination" class="pagination"></div>`;

    durumDuyuru.textContent = `${items.length.toLocaleString("tr-TR")} kayıt yüklendi.`;

    // Tür/Durum dropdown'larını doldur (varsa)
    const tbody = document.getElementById(`${config.containerId}-tbody`);
    const tumSatirlar = Array.from(tbody.querySelectorAll(".searchable"));
    const paginationEl = document.getElementById(`${config.containerId}-pagination`);
    let mevcutSayfa = 1;

    filtreTanimlari.forEach(f => {
      const benzersizDegerler = [...new Set(
        tumSatirlar.map(tr => tr.dataset[f.veriAlani]).filter(v => v)
      )].sort();

      if (benzersizDegerler.length === 0) return;

      benzersizDegerler.forEach(deger => {
        // Dropdown'da GÖRÜNEN metin, JSON'daki orijinal (büyük/küçük harfi
        // korunmuş) değer olsun diye küçük-harfli değere sahip ilk kaydı
        // örnek alıyoruz.
        const ornekItem = items.find(
          it => kucukHarfeCevirTr(it[f.alanAdi] || "") === deger
        );
        const option = document.createElement("option");
        option.value = deger;
        option.textContent = ornekItem[f.alanAdi];
        f.select.appendChild(option);
      });
      f.select.disabled = false;
      f.select.addEventListener("change", () => { mevcutSayfa = 1; uygulaFiltre(); });
    });

    // Arama/filtrelere göre "aktif" (eşleşen) satırları hesaplar.
    // Sayfalama SADECE bu eşleşen satırlar üzerinde çalışır — yani kullanıcı
    // arama yaptığında, o aramaya uyan tüm sonuçlar kendi sayfalarına göre
    // bölünür, filtrelenmemiş satırlar sayıma hiç girmez.
    function eslesenSatirlariBul() {
      const q = kucukHarfeCevirTr((searchBox.value || "").trim());
      return tumSatirlar.filter(tr => {
        const metinEslesiyor = tr.dataset.search.includes(q);
        const filtrelerUyuyor = filtreTanimlari.every(f => {
          const secilen = f.select.value;
          return !secilen || tr.dataset[f.veriAlani] === secilen;
        });
        return metinEslesiyor && filtrelerUyuyor;
      });
    }

    function tabloyuCiz() {
      const eslesenler = eslesenSatirlariBul();
      const toplamSayfa = Math.max(1, Math.ceil(eslesenler.length / sayfaBasinaKayit));
      if (mevcutSayfa > toplamSayfa) mevcutSayfa = toplamSayfa;

      const baslangic = (mevcutSayfa - 1) * sayfaBasinaKayit;
      const bitis = baslangic + sayfaBasinaKayit;

      // Önce her satırı gizle, sonra sadece o sayfaya düşenleri göster
      tumSatirlar.forEach(tr => { tr.style.display = "none"; });
      eslesenler.slice(baslangic, bitis).forEach(tr => { tr.style.display = ""; });

      // "Henüz eklenmiş bir kayıt yok" / sonuç yok mesajı
      let emptyMsg = tbody.querySelector(".no-results-row");
      if (eslesenler.length === 0) {
        if (!emptyMsg) {
          emptyMsg = document.createElement("tr");
          emptyMsg.className = "no-results-row";
          const sutunSayisi = 2 + sutunlar.length; // # + Başlık + diğer sütunlar
          emptyMsg.innerHTML = `<td colspan="${sutunSayisi}" class="loading">Eşleşen sonuç bulunamadı.</td>`;
          tbody.appendChild(emptyMsg);
        }
      } else if (emptyMsg) {
        emptyMsg.remove();
      }

      // Sayfalama kontrollerini çiz
      if (toplamSayfa <= 1) {
        paginationEl.innerHTML = "";
        return;
      }

      let sayfaBtnHtml = "";
      for (let s = 1; s <= toplamSayfa; s++) {
        sayfaBtnHtml += `<button type="button" class="page-btn ${s === mevcutSayfa ? "active" : ""}" data-page="${s}" aria-label="Sayfa ${s}" aria-current="${s === mevcutSayfa ? "page" : "false"}">${s}</button>`;
      }

      paginationEl.innerHTML = `
        <button type="button" class="page-nav" data-dir="prev" ${mevcutSayfa === 1 ? "disabled" : ""}>← Önceki</button>
        <div class="page-numbers">${sayfaBtnHtml}</div>
        <button type="button" class="page-nav" data-dir="next" ${mevcutSayfa === toplamSayfa ? "disabled" : ""}>Sonraki →</button>
      `;

      paginationEl.querySelectorAll(".page-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          mevcutSayfa = parseInt(btn.dataset.page, 10);
          tabloyuCiz();
          container.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      });

      const prevBtn = paginationEl.querySelector('[data-dir="prev"]');
      const nextBtn = paginationEl.querySelector('[data-dir="next"]');
      if (prevBtn) prevBtn.addEventListener("click", () => {
        if (mevcutSayfa > 1) { mevcutSayfa--; tabloyuCiz(); container.scrollIntoView({ behavior: "smooth", block: "start" }); }
      });
      if (nextBtn) nextBtn.addEventListener("click", () => {
        if (mevcutSayfa < toplamSayfa) { mevcutSayfa++; tabloyuCiz(); container.scrollIntoView({ behavior: "smooth", block: "start" }); }
      });
    }

    function uygulaFiltre() {
      mevcutSayfa = 1;
      tabloyuCiz();
    }

    searchBox.disabled = false;
    searchBox.addEventListener("input", uygulaFiltre);

    tabloyuCiz(); // ilk çizim

  } catch (err) {
    const mesaj =
      err.name === "AbortError"
        ? "Liste zaman aşımına uğradı."
        : "Liste yüklenemedi.";
    container.innerHTML = `<p class="error">${mesaj} Lütfen daha sonra tekrar dene.</p>`;
    durumDuyuru.textContent = `${mesaj} Lütfen daha sonra tekrar dene.`;
    console.error(err);
  } finally {
    clearTimeout(timeoutId);
  }
}

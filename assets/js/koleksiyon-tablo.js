/**
 * Bu dosya İzlediklerim ve Okuduklarım sayfalarının ortak mantığını taşır.
 * Build-time'da GitHub Actions tarafından üretilen statik JSON dosyalarını
 * (assets/data/izlenenler.json, okunanlar.json) fetch edip dinamik bir tablo,
 * arama kutusu, tür/durum/yıl filtreleri ve bir "kaç tane okudum/izledim"
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
  // div.innerHTML sadece TEXT-NODE bağlamında güvenlidir (&, <, > kaçışlanır).
  // Bu fonksiyon aynı zamanda ÖZNİTELİK (attribute) değerleri içinde de
  // kullanılıyor (data-search="...", data-tur="..." gibi) — orada çift
  // tırnak (") kaçışlanmazsa, değer içinde bir " geçtiğinde attribute'tan
  // kaçılıp yeni bir HTML özniteliği/etiketi açılabilir. Bu yüzden " ve '
  // karakterlerini elle de kaçışlıyoruz; text-node bağlamında bunun hiçbir
  // zararı yok, sadece attribute bağlamını da güvenli hale getiriyor.
  return div.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
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
 * Mantık: sadece GERÇEKTEN tamamlanmış kayıtlar sayılır — yani Durum alanı
 * (izlemede "Durum", okumada "Okuma Durumu") config.istatistikTamamlandiDegeri
 * ile eşleşen kayıtlar (örn. "İzledim" / "Okudum"). "İzliyorum/Okuyorum" ve
 * "İzleyeceğim/Okuyacağım" durumundaki kayıtlar sayaca hiç girmez.
 *
 * Bu tamamlanmış kayıtlar arasında, her birinin "yılı" önce Bitiş
 * Tarihi'nden, o da yoksa Başlama Tarihi'nden çıkarılır. (Tamamlanmış ama
 * olağandışı biçimde hiç tarihi girilmemiş bir kayıt olursa, o kayıt yine de
 * TOPLAM'a dahildir, sadece hiçbir yıla yazılmaz.)
 *
 * GÖRÜNÜM: tüm yılları aynı anda kart kart dizmek (özellikle çok yıllık bir
 * geçmişte) kalabalıklaşıyordu. Bunun yerine sadece "Toplam" ve "seçili yıl"
 * kartı gösteriliyor; diğer yıllar arasında geçiş yapmak için yanlarına küçük
 * bir <select> ekleniyor. Varsayılan seçili yıl: içinde bulunulan yıl (o yıla
 * ait hiç kayıt yoksa, verideki en yeni yıl).
 *
 * istatistikTamamlandiDegeri (ya da durum alanı) config'te verilmemişse,
 * yanlışlıkla her kaydı "tamamlandı" sayıp hatalı bir rakam göstermektense
 * şerit hiç gösterilmez.
 */
function istatistikGosterimiOlustur(items, config) {
  if (!config.istatistikContainerId) return;
  const el = document.getElementById(config.istatistikContainerId);
  if (!el) return;

  const baslamaAlani = config.baslamaTarihiAlani || "Başlama Tarihi";
  const bitisAlani = config.bitisTarihiAlani || "Bitiş Tarihi";
  const eylem = config.istatistikEylem || "eklediğim";
  const durumAlani = config.istatistikDurumAlani || config.durumFieldName;

  if (!config.istatistikTamamlandiDegeri || !durumAlani) {
    el.innerHTML = "";
    el.hidden = true;
    return;
  }
  const tamamlandiDegeri = kucukHarfeCevirTr(config.istatistikTamamlandiDegeri);

  const tamamlananlar = items.filter(
    item => kucukHarfeCevirTr(item[durumAlani] || "") === tamamlandiDegeri
  );

  if (tamamlananlar.length === 0) {
    // Geliştirme/hata ayıklama kolaylığı: "tamamlandı" sayılan hiçbir kayıt
    // bulunamadıysa (ör. istatistikTamamlandiDegeri, GitHub Projects'teki
    // gerçek seçenek metniyle birebir eşleşmiyorsa) tarayıcı konsoluna o
    // alanda GERÇEKTE görülen değerleri yazıyoruz. Bu sadece geliştirici
    // araçlarını açan biri için görünür, ziyaretçiyi hiç etkilemez.
    if (items.length > 0) {
      const gorulenDurumlar = [...new Set(items.map(it => it[durumAlani]).filter(Boolean))];
      console.warn(
        `[istatistik] "${durumAlani}" alanında "${config.istatistikTamamlandiDegeri}" değerine sahip kayıt bulunamadı.`,
        "Bu alanda görülen gerçek değerler:", gorulenDurumlar
      );
    }
    el.innerHTML = "";
    el.hidden = true;
    return;
  }

  const yilSayaci = new Map();
  tamamlananlar.forEach(item => {
    const tarih = item[bitisAlani] || item[baslamaAlani];
    const yil = yilCikar(tarih);
    if (!yil) return;
    yilSayaci.set(yil, (yilSayaci.get(yil) || 0) + 1);
  });

  const toplam = tamamlananlar.length;
  // localeCompare ile string sıralama, 4 haneli yıllar için ("2026" > "2025")
  // sayısal sıralamayla birebir aynı sonucu verir, ekstra Number() dönüşümüne
  // gerek yok.
  const yillar = [...yilSayaci.keys()].sort((a, b) => b.localeCompare(a));

  // Yıl kartı gösterilecek veri yoksa (hiçbir tamamlanmış kaydın tarihi
  // yoksa) sadece Toplam kartını göster, yıl seçiciyi hiç oluşturma.
  if (yillar.length === 0) {
    el.hidden = false;
    el.innerHTML = `
      <div class="liste-istatistik-kart liste-istatistik-kart--toplam">
        <span class="liste-istatistik-sayi">${toplam.toLocaleString("tr-TR")}</span>
        <span class="liste-istatistik-etiket">Toplam ${escapeHtml(eylem)}</span>
      </div>`;
    return;
  }

  const buYil = new Date().getFullYear().toString();
  let seciliYil = yilSayaci.has(buYil) ? buYil : yillar[0];

  const yilSecenekleriHtml = yillar
    .map(yil => `<option value="${escapeHtml(yil)}" ${yil === seciliYil ? "selected" : ""}>${escapeHtml(yil)}</option>`)
    .join("");

  el.hidden = false;
  el.innerHTML = `
    <div class="liste-istatistik-kart liste-istatistik-kart--toplam">
      <span class="liste-istatistik-sayi">${toplam.toLocaleString("tr-TR")}</span>
      <span class="liste-istatistik-etiket">Toplam ${escapeHtml(eylem)}</span>
    </div>
    <div class="liste-istatistik-kart" aria-live="polite">
      <span class="liste-istatistik-sayi" data-rol="yil-sayisi"></span>
      <span class="liste-istatistik-etiket" data-rol="yil-etiket"></span>
    </div>
    <select class="tur-select liste-istatistik-yil-secici" aria-label="Yıl seç">
      ${yilSecenekleriHtml}
    </select>`;

  // Seçili yıl kartının içeriğini (sayı + etiket) günceller. Tüm şeridi
  // yeniden çizmek yerine sadece bu iki <span>'i değiştiriyoruz ki
  // <select>'in kendisi odağını kaybetmesin.
  const sayiEl = el.querySelector('[data-rol="yil-sayisi"]');
  const etiketEl = el.querySelector('[data-rol="yil-etiket"]');
  const yilSecici = el.querySelector(".liste-istatistik-yil-secici");

  function yilKartiniGuncelle() {
    const yil = yilSecici.value;
    sayiEl.textContent = (yilSayaci.get(yil) || 0).toLocaleString("tr-TR");
    etiketEl.textContent = `${yil} yılında ${eylem}`;
  }

  yilSecici.addEventListener("change", yilKartiniGuncelle);
  yilKartiniGuncelle();
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
 * @param {string} [config.yilSelectId] - Yıl dropdown id'si (verilmezse yıl filtresi kurulmaz). Yıl, Bitiş Tarihi (yoksa Başlama Tarihi) alanından çıkarılır — istatistik şeridiyle aynı mantık.
 * @param {string[]} config.aramaAlanlari - Arama sırasında hangi alanlarda metin aransın (başlık her zaman dahildir)
 * @param {string[]} [config.gizliAlanlar] - Tabloda GÖSTERİLMEYECEK EK alan adları (id/url/state/title zaten her zaman gizli)
 * @param {number} [config.sayfaBasinaKayit=50] - Bir sayfada gösterilecek satır sayısı
 * @param {string} [config.istatistikContainerId] - "Kaç tane okudum/izledim" şeridinin basılacağı <div> id'si (verilmezse şerit oluşturulmaz)
 * @param {string} [config.istatistikEylem] - İstatistik etiketlerinde kullanılacak fiil (örn. "izlediğim", "okuduğum")
 * @param {string} [config.istatistikTamamlandiDegeri] - Durum alanında "tamamlandı" sayılacak değer (örn. "İzledim", "Okudum") — verilmezse istatistik şeridi hiç gösterilmez
 * @param {string} [config.istatistikDurumAlani] - İstatistik için hangi alana bakılsın (verilmezse config.durumFieldName kullanılır)
 * @param {string} [config.baslamaTarihiAlani="Başlama Tarihi"] - İstatistik hesaplamasında kullanılacak başlama tarihi alan adı
 * @param {string} [config.bitisTarihiAlani="Bitiş Tarihi"] - İstatistik hesaplamasında kullanılacak bitiş tarihi alan adı
 */
async function koleksiyonTablosuOlustur(config) {
  const container = document.getElementById(config.containerId);
  const searchBox = document.getElementById(config.searchInputId);
  const turSelect = document.getElementById(config.turSelectId);
  const durumSelect = config.durumSelectId ? document.getElementById(config.durumSelectId) : null;
  const yilSelect = config.yilSelectId ? document.getElementById(config.yilSelectId) : null;
  const baslamaAlani = config.baslamaTarihiAlani || "Başlama Tarihi";
  const bitisAlani = config.bitisTarihiAlani || "Bitiş Tarihi";

  // "id", "url", "state" fetch-projects.js'in HER ZAMAN eklediği teknik
  // alanlar — bunlar hiçbir zaman ayrı sütun olarak gösterilmemeli, "url"
  // zaten Başlık sütununun linki için kullanılıyor. Kullanıcının verdiği
  // gizliAlanlar listesi bunun ÜSTÜNE ekleniyor (örn. "Durum", "Title").
  const gizliAlanlar = new Set(["id", "url", "state", ...(config.gizliAlanlar || [])]);
  const sayfaBasinaKayit = config.sayfaBasinaKayit || 50;

  // Sekme filtreleri: Tür, (varsa) Durum/Okuma Durumu ve (varsa) Yıl için
  // AYNI dropdown-doldurma + filtreleme mantığını tekrar tekrar yazmamak
  // için genel bir liste kuruyoruz. Her tanım bir "cek(item)" fonksiyonuyla
  // o satırın ham (orijinal harf durumlu) değerini üretir — Tür/Durum için
  // bu doğrudan bir JSON alanı, Yıl için ise Bitiş/Başlama Tarihi'nden
  // türetilmiş bir değerdir (istatistik şeridindeki yilCikar ile birebir
  // aynı mantık). Her satıra bu değerin küçük harfli hâli data-* attribute
  // olarak yazılır (örn. data-tur, data-durum, data-yil), dropdown'lar da
  // "cek()"in döndürdüğü orijinal (büyük/küçük harfi korunmuş) değerlerle
  // doldurulur. Sadece HTML'de karşılığı olan (config'te id'si verilen)
  // filtreler listeye eklenir; okuduklarim.html'de olmayan bir alan
  // izlediklerim.html'i etkilemez ve tam tersi.
  const filtreTanimlari = [];
  if (config.turFieldName && turSelect) {
    filtreTanimlari.push({
      select: turSelect,
      veriAlani: "tur",
      cek: item => item[config.turFieldName]
    });
  }
  if (config.durumFieldName && durumSelect) {
    filtreTanimlari.push({
      select: durumSelect,
      veriAlani: "durum",
      cek: item => item[config.durumFieldName]
    });
  }
  if (yilSelect) {
    filtreTanimlari.push({
      select: yilSelect,
      veriAlani: "yil",
      cek: item => yilCikar(item[bitisAlani] || item[baslamaAlani]),
      // Yıllar alfabetik değil, en yeniden en eskiye sıralansın (istatistik
      // şeridindeki sıralamayla tutarlı olsun diye).
      sirala: (a, b) => b.localeCompare(a)
    });
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

      // Her filtre tanımı (Tür, Durum, Yıl...) için o satırın küçük harfli
      // değerini ayrı bir data-* attribute olarak yazıyoruz.
      const filtreDataAttrs = filtreTanimlari.map(f => {
        const deger = kucukHarfeCevirTr(f.cek(item) || "");
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
      )].sort(f.sirala || ((a, b) => a.localeCompare(b, "tr")));

      if (benzersizDegerler.length === 0) return;

      benzersizDegerler.forEach(deger => {
        // Dropdown'da GÖRÜNEN metin, JSON'daki orijinal (büyük/küçük harfi
        // korunmuş) değer olsun diye küçük-harfli değere sahip ilk kaydı
        // örnek alıyoruz.
        const ornekItem = items.find(
          it => kucukHarfeCevirTr(f.cek(it) || "") === deger
        );
        const option = document.createElement("option");
        option.value = deger;
        option.textContent = f.cek(ornekItem);
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

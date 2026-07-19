/**
 * Bu dosya İzlediklerim ve Okuduklarım sayfalarının ortak mantığını taşır.
 * Build-time'da GitHub Actions tarafından üretilen statik JSON dosyalarını
 * (assets/data/izlenenler.json, okunanlar.json) fetch edip dinamik bir tablo,
 * arama kutusu ve tür filtresi oluşturur.
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

/**
 * @param {Object} config
 * @param {string} config.jsonUrl - JSON dosyasının yolu (örn. "/assets/data/izlenenler.json")
 * @param {string} config.containerId - Tablonun basılacağı <div> id'si
 * @param {string} config.searchInputId - Arama kutusu id'si
 * @param {string} config.turSelectId - Tür dropdown id'si
 * @param {string} config.turFieldName - JSON'daki hangi alan "Tür" olarak kullanılsın (örn. "Tür")
 * @param {string[]} config.aramaAlanlari - Arama sırasında hangi alanlarda metin aransın (başlık her zaman dahildir)
 * @param {string[]} [config.gizliAlanlar] - Tabloda GÖSTERİLMEYECEK EK alan adları (id/url/state/title zaten her zaman gizli)
 * @param {number} [config.sayfaBasinaKayit=50] - Bir sayfada gösterilecek satır sayısı
 */
async function koleksiyonTablosuOlustur(config) {
  const container = document.getElementById(config.containerId);
  const searchBox = document.getElementById(config.searchInputId);
  const turSelect = document.getElementById(config.turSelectId);

  // "id", "url", "state" fetch-projects.js'in HER ZAMAN eklediği teknik
  // alanlar — bunlar hiçbir zaman ayrı sütun olarak gösterilmemeli, "url"
  // zaten Başlık sütununun linki için kullanılıyor. Kullanıcının verdiği
  // gizliAlanlar listesi bunun ÜSTÜNE ekleniyor (örn. "Durum", "Title").
  const gizliAlanlar = new Set(["id", "url", "state", ...(config.gizliAlanlar || [])]);
  const sayfaBasinaKayit = config.sayfaBasinaKayit || 50;

  try {
    // cache: "no-store" -> tarayıcı bu isteği kendi önbelleğinden ASLA
    // karşılamaz, her sayfa yenilemesinde gerçekten taze veri ister.
    // Worker tarafında zaten kısa süreli (60sn) bir Cloudflare önbelleği
    // var, o yeterli hız/güvenlik dengesini sağlıyor.
    const res = await fetch(config.jsonUrl, { cache: "no-store" });
    if (!res.ok) throw new Error("JSON yüklenemedi: " + res.status);
    const data = await res.json();
    const items = Array.isArray(data.items) ? data.items : [];

    if (items.length === 0) {
      container.innerHTML = '<p class="loading">Henüz eklenmiş bir kayıt yok.</p>';
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
      const turDegeri = config.turFieldName ? (item[config.turFieldName] || "") : "";

      const aramaMetniParcalari = [item.title];
      (config.aramaAlanlari || []).forEach(alan => {
        if (item[alan] != null) aramaMetniParcalari.push(item[alan]);
      });
      const searchText = aramaMetniParcalari.join(" ").toString().toLowerCase();

      const hucreler = sutunlar.map(sutun => {
        const deger = item[sutun];
        return `<td>${escapeHtml(deger == null ? "" : deger)}</td>`;
      }).join("");

      rows += `
        <tr class="searchable" data-search="${escapeHtml(searchText)}" data-tur="${escapeHtml(String(turDegeri).toLowerCase())}">
          <td class="col-index">${index + 1}</td>
          <td><a href="${escapeHtml(guvenliLink(item.url))}" target="_blank">${escapeHtml(item.title)}</a></td>
          ${hucreler}
        </tr>`;
    });

    container.innerHTML = `
      <table>
        <thead>${theadHtml}</thead>
        <tbody id="${config.containerId}-tbody">${rows}</tbody>
      </table>
      <div id="${config.containerId}-pagination" class="pagination"></div>`;

    // Tür dropdown'ını doldur (varsa)
    const tbody = document.getElementById(`${config.containerId}-tbody`);
    const tumSatirlar = Array.from(tbody.querySelectorAll(".searchable"));
    const paginationEl = document.getElementById(`${config.containerId}-pagination`);
    let mevcutSayfa = 1;

    if (config.turFieldName && turSelect) {
      const benzersizTurler = [...new Set(
        tumSatirlar.map(tr => tr.dataset.tur).filter(t => t !== "")
      )].sort();

      if (benzersizTurler.length > 0) {
        benzersizTurler.forEach(tur => {
          const ornekItem = items.find(
            it => String(it[config.turFieldName] || "").toLowerCase() === tur
          );
          const option = document.createElement("option");
          option.value = tur;
          option.textContent = ornekItem[config.turFieldName];
          turSelect.appendChild(option);
        });
        turSelect.disabled = false;
        turSelect.addEventListener("change", () => { mevcutSayfa = 1; uygulaFiltre(); });
      }
    }

    // Arama/tür filtresine göre "aktif" (eşleşen) satırları hesaplar.
    // Sayfalama SADECE bu eşleşen satırlar üzerinde çalışır — yani kullanıcı
    // arama yaptığında, o aramaya uyan tüm sonuçlar kendi sayfalarına göre
    // bölünür, filtrelenmemiş satırlar sayıma hiç girmez.
    function eslesenSatirlariBul() {
      const q = (searchBox.value || "").trim().toLowerCase();
      const secilenTur = turSelect ? turSelect.value : "";
      return tumSatirlar.filter(tr => {
        const metinEslesiyor = tr.dataset.search.includes(q);
        const turEslesiyor = !secilenTur || tr.dataset.tur === secilenTur;
        return metinEslesiyor && turEslesiyor;
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
        sayfaBtnHtml += `<button type="button" class="page-btn ${s === mevcutSayfa ? "active" : ""}" data-page="${s}">${s}</button>`;
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
    container.innerHTML = '<p class="error">Liste yüklenemedi. Lütfen daha sonra tekrar dene.</p>';
    console.error(err);
  }
}

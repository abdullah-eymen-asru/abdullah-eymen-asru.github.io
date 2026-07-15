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

// Ekstra savunma katmanı: bir link http(s):// ile başlamıyorsa reddet.
function guvenliLink(url) {
  if (typeof url === "string" && /^https?:\/\//i.test(url)) return url;
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
 * @param {string[]} [config.gizliAlanlar] - Tabloda GÖSTERİLMEYECEK alan adları (örn. "Durum" GitHub Projects'e özel bir iç alan olabilir)
 */
async function koleksiyonTablosuOlustur(config) {
  const container = document.getElementById(config.containerId);
  const searchBox = document.getElementById(config.searchInputId);
  const turSelect = document.getElementById(config.turSelectId);
  const gizliAlanlar = new Set(config.gizliAlanlar || []);

  try {
    const res = await fetch(config.jsonUrl);
    if (!res.ok) throw new Error("JSON yüklenemedi: " + res.status);
    const data = await res.json();
    const items = Array.isArray(data.items) ? data.items : [];

    if (items.length === 0) {
      container.innerHTML = '<p class="loading">Henüz eklenmiş bir kayıt yok.</p>';
      return;
    }

    // Tüm item'larda geçen alan isimlerini topla (title/url hariç), bunlar
    // otomatik olarak tablo sütunları olacak. Sıralamayı ilk item'ın alan
    // sırasına göre belirliyoruz ki tutarlı bir sütun düzeni olsun.
    const sutunlar = [];
    const gorulenler = new Set();
    items.forEach(item => {
      Object.keys(item).forEach(key => {
        if (key === "title" || key === "url") return;
        if (gizliAlanlar.has(key)) return;
        if (!gorulenler.has(key)) {
          gorulenler.add(key);
          sutunlar.push(key);
        }
      });
    });

    // Tablo başlıkları
    const theadHtml = `
      <tr>
        <th>Başlık</th>
        ${sutunlar.map(s => `<th>${escapeHtml(s)}</th>`).join("")}
      </tr>`;

    // Tablo satırları
    let rows = "";
    items.forEach(item => {
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
          <td><a href="${escapeHtml(guvenliLink(item.url))}" target="_blank">${escapeHtml(item.title)}</a></td>
          ${hucreler}
        </tr>`;
    });

    container.innerHTML = `
      <table>
        <thead>${theadHtml}</thead>
        <tbody id="${config.containerId}-tbody">${rows}</tbody>
      </table>`;

    // Tür dropdown'ını doldur (varsa)
    const tbody = document.getElementById(`${config.containerId}-tbody`);
    const tumSatirlar = Array.from(tbody.querySelectorAll(".searchable"));

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
        turSelect.addEventListener("change", uygulaFiltre);
      }
    }

    function uygulaFiltre() {
      const q = (searchBox.value || "").trim().toLowerCase();
      const secilenTur = turSelect ? turSelect.value : "";
      tumSatirlar.forEach(tr => {
        const metinEslesiyor = tr.dataset.search.includes(q);
        const turEslesiyor = !secilenTur || tr.dataset.tur === secilenTur;
        tr.style.display = (metinEslesiyor && turEslesiyor) ? "" : "none";
      });
    }

    searchBox.disabled = false;
    searchBox.addEventListener("input", uygulaFiltre);

  } catch (err) {
    container.innerHTML = '<p class="error">Liste yüklenemedi. Lütfen daha sonra tekrar dene.</p>';
    console.error(err);
  }
}

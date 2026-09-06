/*
 * assets/js/okuma-araclari/okuma-meta-yardimci.js
 *
 * GitHub'a hiç commit edilmemiş (Supabase-only) yazı/proje sayfaları
 * (supabase-yazi.js, onizleme.js) Kramdown/Jekyll'den GEÇMİYOR — kendi
 * `basitMarkdown()` fonksiyonlarıyla HTML üretiyorlar. Bu yüzden
 * _layouts/post.html ve _layouts/project.html'deki Liquid tabanlı "okuma
 * süresi" hesaplaması ve Kramdown'ın ürettiği `{:toc}` mekanizması burada
 * ÇALIŞMAZ; aynı üç özelliği (okuma süresi, PDF butonu, İçindekiler)
 * tarayıcıda, render edilmiş HTML üzerinden ürettiğimiz bu ortak modül
 * sağlıyor — iki sayfa da (ve ileride eklenebilecek benzerleri) aynı
 * mantığı kullansın, kopyalanmasın diye.
 */

/**
 * Ortalama dakikada 200 kelime kabulüyle okuma süresi metni üretir.
 * _layouts/post.html / project.html'deki
 * `number_of_words | divided_by: 200 | plus: 1` Liquid ifadesiyle AYNI
 * formül (tam bölme + 1) — iki taraf arasında tutarsız süre gösterilmesin.
 */
export function okumaSuresiHesapla(govdeMetni) {
  const kelimeSayisi = (govdeMetni || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  const dakika = Math.floor(kelimeSayisi / 200) + 1;
  return `${dakika} dk okuma`;
}

/**
 * Front-matter'daki `pdf_url` alanının Supabase karşılığı (bkz.
 * migration: taslak_icerikler.pdf_url) doluysa, _layouts/post.html'deki
 * ile GÖRSEL OLARAK AYNI "PDF İndir" butonunu üretir. Güvenlik: sadece
 * http(s) ile başlayan adreslere izin verilir (bkz. guvenliDisUrlMi ile
 * aynı gerekçe) — "javascript:" gibi bir URI asla render edilmez.
 */
export function pdfButonuHtml(pdfUrl, escapeHtml) {
  if (!pdfUrl || typeof pdfUrl !== "string") return "";
  if (!/^https?:\/\//i.test(pdfUrl)) return "";
  return `<p class="pdf-indir-alani"><a href="${escapeHtml(pdfUrl)}" class="pdf-indir-btn" target="_blank" rel="noopener noreferrer">📄 PDF İndir</a></p>`;
}

/**
 * `veri_url` (GitHub reposu/Zenodo/OSF/Kaggle gibi bir veri seti adresi)
 * doluysa, _layouts/post.html / project.html'deki ile GÖRSEL OLARAK AYNI
 * "Veri Seti" butonunu üretir — pdfButonuHtml ile AYNI güvenlik kuralı
 * (sadece http/https).
 */
export function veriButonuHtml(veriUrl, escapeHtml) {
  if (!veriUrl || typeof veriUrl !== "string") return "";
  if (!/^https?:\/\//i.test(veriUrl)) return "";
  return `<a href="${escapeHtml(veriUrl)}" class="veri-indir-btn" target="_blank" rel="noopener noreferrer">🗃️ Veri Seti</a>`;
}

/**
 * PDF ve Veri Seti butonlarını TEK bir "pdf-indir-alani" kutusunda,
 * YAN YANA birleştirir — _layouts/post.html / project.html'deki
 * "{% if _pdf_gecerli or _veri_gecerli %}" ile GÖRSEL OLARAK AYNI mimari.
 * İkisi de boşsa hiçbir şey döndürmez (boş bir <p> bırakmaz).
 */
export function kaynakButonlariHtml(pdfUrl, veriUrl, escapeHtml) {
  const pdfBtn = pdfUrl && /^https?:\/\//i.test(pdfUrl)
    ? `<a href="${escapeHtml(pdfUrl)}" class="pdf-indir-btn" target="_blank" rel="noopener noreferrer">📄 PDF İndir</a>`
    : "";
  const veriBtn = veriButonuHtml(veriUrl, escapeHtml);
  if (!pdfBtn && !veriBtn) return "";
  return `<p class="pdf-indir-alani">${pdfBtn}${veriBtn}</p>`;
}

/**
 * `govdeEl` içine render edilmiş HTML'i TARAR (h2/h3/h4 başlıklarını
 * bulur), her birine bir `id` atar (yoksa) ve _layouts/post.html'deki
 * `<details class="akademik-toc">` ile GÖRSEL OLARAK AYNI, katlanabilir
 * bir İçindekiler bloğu döndürür. `tocIstendi` false ise hiçbir şey
 * yapmadan null döner — panelde "İçindekiler" anahtarı kapalıysa bu
 * fonksiyon hiç çağrılmamalı zaten, ama çağrılırsa da sessizce atlanır.
 *
 * BUG FİX ("H3,H4 içindekilerde yer almıyor"): bu fonksiyon önceden
 * SADECE "h2, h3" arıyordu — H4 (editördeki "H4" araç çubuğu düğmesiyle
 * eklenen alt-alt başlıklar, bkz. panel/github-yonetim.md) İçindekiler'e
 * HİÇ girmiyordu (ayrıca basitMarkdown() H4'ü hiç <h4>'e çevirmiyordu,
 * bkz. onizleme.js/supabase-yazi.js/ozel-icerik.js'teki AYRI bugfix —
 * ikisi birlikte çözülmeden biri tek başına yeterli olmazdı). Artık h4
 * de taranıyor ve "toc-alt-alt-baslik" sınıfıyla (bkz. style.css) bir
 * kademe daha girintili gösteriliyor — kramdown'ın GitHub tarafında
 * ürettiği iç içe (nested) `<ul><li><ul>...` yapısının GÖRSEL dengi.
 *
 * Kramdown'ın kendisi burada YOK, bu yüzden slug üretimi basit tutuluyor:
 * küçük harfe çevir, Türkçe karakterleri sadeleştir, harf/rakam dışını
 * tireyle değiştir. Aynı başlık birden fazla kez geçerse sona sayaç eklenir.
 */
export function tocOlustur(govdeEl, tocIstendi) {
  if (!tocIstendi || !govdeEl) return null;

  const basliklar = govdeEl.querySelectorAll("h2, h3, h4");
  if (!basliklar.length) return null;

  const kullanilanSlugler = new Set();
  const trHarfEslesme = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" };

  function slugUret(metin) {
    let temel = metin
      .toLocaleLowerCase("tr-TR")
      .replace(/[çğışöü]/g, (h) => trHarfEslesme[h] || h)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!temel) temel = "baslik";
    let aday = temel;
    let sayac = 2;
    while (kullanilanSlugler.has(aday)) {
      aday = `${temel}-${sayac}`;
      sayac += 1;
    }
    kullanilanSlugler.add(aday);
    return aday;
  }

  const SINIF_ESLESME = { H3: " toc-alt-baslik", H4: " toc-alt-alt-baslik" };
  const satirlar = [];
  basliklar.forEach((baslik) => {
    if (!baslik.id) baslik.id = slugUret(baslik.textContent || "");
    const girintiSinifi = SINIF_ESLESME[baslik.tagName] || "";
    satirlar.push(
      `<li class="${girintiSinifi.trim()}"><a href="#${baslik.id}">${baslik.textContent}</a></li>`
    );
  });

  const detaylar = document.createElement("details");
  detaylar.className = "akademik-toc";
  detaylar.innerHTML = `<summary>İçindekiler</summary><ul class="toc-liste">${satirlar.join("")}</ul>`;
  return detaylar;
}

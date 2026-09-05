/*
 * assets/js/github-yonetim/supabase-yazi.js — /icerik/supabase-yazi.html?tur=blog|proje&slug=...
 *
 * "Sadece Supabase'te Yayınla" (bkz. panel/github-yonetim.md, migration
 * 0015) seçeneğiyle yayınlanmış, GitHub'a hiç commit edilmemiş ama
 * GERÇEKTEN yayında olan içerikleri gösterir. requireAuth() BİLEREK
 * kullanılmıyor — bu içerik zaten herkese açık/yayında, tıpkı normal bir
 * GitHub tabanlı blog yazısı/proje gibi giriş yapmamış ziyaretçiler de
 * görebilmeli.
 */
import { supabase, escapeHtml, guvenliDisUrlMi } from "../core/supabase-client.js";
import { okumaSuresiHesapla, pdfButonuHtml, tocOlustur } from "../okuma-araclari/okuma-meta-yardimci.js";

function relUrl(path) {
  const base = document.documentElement.dataset.baseurl || "";
  return base + path;
}

/*
 * AKADEMİK ATIF KUTUSU — "Sadece Supabase'te Yayınla" içeriği için
 * _includes/atif-kutusu.html'in ÇALIŞMA ZAMANI (client-side) eşdeğeri.
 * Bu sayfa (icerik/supabase-yazi.html) Jekyll build-time'da içerik
 * bilmediği için (hangi yazının gösterileceği ancak bir RPC ile ANLAŞILIYOR)
 * Liquid tabanlı atif-kutusu.html burada KULLANILAMAZ — aynı görsel/işlevsel
 * kutuyu (dil + format sekmeleri, kopyalama, erişim tarihi) burada saf
 * vanilla JS ile yeniden üretiyoruz. SIKI CSP: hiçbir inline <script>/
 * onclick YOK — bu dosyanın kendisi zaten harici bir <script type="module">
 * olarak yükleniyor (bkz. icerik/supabase-yazi.md), tüm etkileşim
 * addEventListener ile bağlanıyor.
 *
 * SADECE kayit.akademik === true iken çağrılır (bkz. init() içindeki
 * kontrol) — "Akademik Yazı / Atıf Kutusu Göster" kapalıyken hiç render
 * edilmez, panel/github-yonetim.js'deki front-matter mantığıyla BİREBİR
 * aynı davranış.
 */
const AYLAR_TR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const AYLAR_EN = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
// MLA 9: Mayıs/Haziran/Temmuz HİÇ kısaltılmaz, diğerleri noktayla kısaltılır.
const AYLAR_EN_KISA_MLA = ["Jan.", "Feb.", "Mar.", "Apr.", "May", "June",
  "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."];

function tarihParcalariniAl(isoTarih) {
  // "YYYY-MM-DD" (saat bilgisi olmadan) bekleniyor — Supabase'ten gelen
  // tarih/güncelleme sütunları bu biçimde. new Date("YYYY-MM-DD") UTC
  // gece yarısı olarak parse edilir; yerel saat dilimi kaymasını önlemek
  // için parçaları elle ayırıyoruz (tarayıcı saat dilimine bakmadan).
  if (!isoTarih) return null;
  const parcalar = String(isoTarih).slice(0, 10).split("-");
  if (parcalar.length !== 3) return null;
  const yil = parseInt(parcalar[0], 10);
  const ayIndex = parseInt(parcalar[1], 10) - 1;
  const gun = parseInt(parcalar[2], 10);
  if (Number.isNaN(yil) || Number.isNaN(ayIndex) || Number.isNaN(gun)) return null;
  return { yil, ayIndex, gun };
}

/**
 * kayit: sadece_supabase_yazi_getir() RPC'sinden dönen satır.
 * siteTitle/siteUrl: #supabase-yazi-app'in data-site-title/data-site-url
 * özniteliklerinden (Liquid build-time'da yazar).
 * dilVarsayilan: "tr" | "en" — document.documentElement.lang'ten türetilir.
 * Döndürdüğü <section> elementi çağıran kodun DOM'a eklemesi ve
 * wireAtifKutusu() ile olay dinleyicilerinin bağlanması GEREKİR.
 */
function atifKutusuOlustur(kayit, siteTitle, siteUrl, dilVarsayilan, escapeHtml) {
  const yazar = kayit.yazar_adi || siteTitle || "";
  const baslik = kayit.baslik || "";
  const site = siteTitle || "";
  const url = window.location.origin + window.location.pathname + window.location.search;

  const yayinTarihi = tarihParcalariniAl(kayit.tarih);
  const revizyonTarihiHam = kayit.last_modified_at || kayit.guncelleme_tarihi || null;
  const revizyonTarihi = tarihParcalariniAl(revizyonTarihiHam);

  if (!yayinTarihi) return null;

  const yayinTr = `${yayinTarihi.gun} ${AYLAR_TR[yayinTarihi.ayIndex]} ${yayinTarihi.yil}`;
  const yayinEn = `${AYLAR_EN[yayinTarihi.ayIndex]} ${yayinTarihi.gun}, ${yayinTarihi.yil}`;

  const revTr = revizyonTarihi
    ? `${revizyonTarihi.gun} ${AYLAR_TR[revizyonTarihi.ayIndex]} ${revizyonTarihi.yil}`
    : "";
  const revEn = revizyonTarihi
    ? `${AYLAR_EN[revizyonTarihi.ayIndex]} ${revizyonTarihi.gun}, ${revizyonTarihi.yil}`
    : "";
  const revEnMla = revizyonTarihi
    ? `${revizyonTarihi.gun} ${AYLAR_EN_KISA_MLA[revizyonTarihi.ayIndex]} ${revizyonTarihi.yil}`
    : "";

  const e = (s) => escapeHtml(String(s == null ? "" : s));
  const dilTr = dilVarsayilan === "en" ? "" : " active";
  const dilEn = dilVarsayilan === "en" ? " active" : "";
  const hiddenTr = dilVarsayilan === "en" ? " hidden" : "";
  const hiddenEn = dilVarsayilan === "en" ? "" : " hidden";

  const yazarSoyadi = (yazar.split(" ").pop() || "yazi").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const ilkKelime = (baslik.split(" ")[0] || "yazi").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const bibtexAnahtar = `${yazarSoyadi}${yayinTarihi.yil}${ilkKelime}`;
  const ayNumerik = yayinTarihi.ayIndex + 1;

  const kutu = document.createElement("section");
  kutu.className = "atif-kutusu";
  kutu.setAttribute("aria-label", "Bu içeriğe atıf verme / Cite this content");
  kutu.setAttribute("data-atif-dil-varsayilan", dilVarsayilan);

  kutu.innerHTML = `
    <h2 class="atif-baslik" data-atif-metin-tr="Bu İçeriğe Atıf Verin" data-atif-metin-en="Cite This Content">${
      dilVarsayilan === "en" ? "Cite This Content" : "Bu İçeriğe Atıf Verin"
    }</h2>
    <div class="atif-dil-secici lang-tabs" role="tablist">
      <button type="button" class="lang-tab-btn atif-dil-buton${dilTr}" data-atif-dil="tr" aria-selected="${dilVarsayilan !== "en"}">🇹🇷 Türkçe</button>
      <button type="button" class="lang-tab-btn atif-dil-buton${dilEn}" data-atif-dil="en" aria-selected="${dilVarsayilan === "en"}">🇬🇧 English</button>
    </div>
    <div class="atif-format-sekmeleri lang-tabs" role="tablist">
      <button type="button" class="lang-tab-btn atif-sekme-buton active" data-atif-sekme="apa" role="tab" aria-selected="true">APA 7</button>
      <button type="button" class="lang-tab-btn atif-sekme-buton" data-atif-sekme="chicago" role="tab" aria-selected="false">Chicago</button>
      <button type="button" class="lang-tab-btn atif-sekme-buton" data-atif-sekme="mla" role="tab" aria-selected="false">MLA 9</button>
      <button type="button" class="lang-tab-btn atif-sekme-buton" data-atif-sekme="bibtex" role="tab" aria-selected="false">BibTeX</button>
    </div>

    <div class="atif-metin-alani" data-atif-panel="apa" data-atif-dil="tr" role="tabpanel"${hiddenTr}>
      <p class="atif-metin">${e(yazar)}. (${yayinTarihi.yil}, ${yayinTarihi.gun} ${AYLAR_TR[yayinTarihi.ayIndex]}${revizyonTarihi ? `; güncellendi ${revizyonTarihi.yil}, ${revTr.split(" ").slice(0, 2).join(" ")}` : ""}). <em>${e(baslik)}</em>. ${e(site)}. <span data-atif-erisim>hesaplanıyor…</span> tarihinde <a href="${e(url)}" data-atif-url>${e(url)}</a> adresinden erişildi.</p>
    </div>
    <div class="atif-metin-alani" data-atif-panel="apa" data-atif-dil="en" role="tabpanel"${hiddenEn}>
      <p class="atif-metin">${e(yazar)} (${yayinTarihi.yil}, ${AYLAR_EN[yayinTarihi.ayIndex]} ${yayinTarihi.gun}${revizyonTarihi ? `; updated ${revizyonTarihi.yil}, ${AYLAR_EN[revizyonTarihi.ayIndex]} ${revizyonTarihi.gun}` : ""}). <em>${e(baslik)}</em>. ${e(site)}. Retrieved <span data-atif-erisim>calculating…</span>, from <a href="${e(url)}" data-atif-url>${e(url)}</a></p>
    </div>

    <div class="atif-metin-alani" data-atif-panel="chicago" data-atif-dil="tr" role="tabpanel" hidden>
      <p class="atif-metin">${e(yazar)}. "${e(baslik)}." ${e(site)}. Yayımlanma ${yayinTr}${revizyonTarihi ? `, son güncelleme ${revTr}` : ""}. Erişim tarihi <span data-atif-erisim>hesaplanıyor…</span>. <span data-atif-url>${e(url)}</span>.</p>
    </div>
    <div class="atif-metin-alani" data-atif-panel="chicago" data-atif-dil="en" role="tabpanel" hidden>
      <p class="atif-metin">${e(yazar)}. "${e(baslik)}." ${e(site)}. Published ${yayinEn}${revizyonTarihi ? `, last modified ${revEn}` : ""}. Accessed <span data-atif-erisim>calculating…</span>. <span data-atif-url>${e(url)}</span>.</p>
    </div>

    <div class="atif-metin-alani" data-atif-panel="mla" data-atif-dil="tr" role="tabpanel" hidden>
      <p class="atif-metin">${e(yazar)}. "${e(baslik)}." <em>${e(site)}</em>, ${revizyonTarihi ? `versiyon ${revTr}` : yayinTr}, <span data-atif-url>${e(url)}</span>. Erişim tarihi <span data-atif-erisim>hesaplanıyor…</span>.</p>
    </div>
    <div class="atif-metin-alani" data-atif-panel="mla" data-atif-dil="en" role="tabpanel" hidden>
      <p class="atif-metin">${e(yazar)}. "${e(baslik)}." <em>${e(site)}</em>, ${revizyonTarihi ? `version ${revEnMla}` : yayinEn}, <span data-atif-url>${e(url)}</span>. Accessed <span data-atif-erisim>calculating…</span>.</p>
    </div>

    <div class="atif-metin-alani" data-atif-panel="bibtex" data-atif-dil="tr" role="tabpanel" hidden><pre class="atif-metin atif-metin-kod">@misc{ ${e(bibtexAnahtar)},
  author       = { ${e(yazar)} },
  title        = { ${e(baslik)} },
  howpublished = { Kişisel Web Sitesi },
  year         = { ${yayinTarihi.yil} },
  month        = { ${ayNumerik} },
  day          = { ${yayinTarihi.gun} },
  url          = { <span data-atif-url>${e(url)}</span> },
  urldate      = { <span data-atif-urldate>hesaplanıyor…</span> }${revizyonTarihi ? `,
  version      = { ${revizyonTarihi.yil}-${String(revizyonTarihi.ayIndex + 1).padStart(2, "0")}-${String(revizyonTarihi.gun).padStart(2, "0")} }` : ""}
}</pre></div>
    <div class="atif-metin-alani" data-atif-panel="bibtex" data-atif-dil="en" role="tabpanel" hidden><pre class="atif-metin atif-metin-kod">@misc{ ${e(bibtexAnahtar)},
  author       = { ${e(yazar)} },
  title        = { ${e(baslik)} },
  howpublished = { Personal Website },
  year         = { ${yayinTarihi.yil} },
  month        = { ${ayNumerik} },
  day          = { ${yayinTarihi.gun} },
  url          = { <span data-atif-url>${e(url)}</span> },
  urldate      = { <span data-atif-urldate>calculating…</span> }${revizyonTarihi ? `,
  version      = { ${revizyonTarihi.yil}-${String(revizyonTarihi.ayIndex + 1).padStart(2, "0")}-${String(revizyonTarihi.gun).padStart(2, "0")} }` : ""}
}</pre></div>

    <div class="atif-alt-satir">
      <button type="button" class="atif-kopyala-buton" data-atif-kopyala>Atıfı Kopyala</button>
      <span class="atif-kopyalandi-bildirim" data-atif-bildirim hidden>Kopyalandı ✓</span>
    </div>
    <p class="atif-not" data-atif-metin-tr="Format otomatik oluşturulmuştur; gerektiğinde elle düzenleyebilirsiniz." data-atif-metin-en="This format was generated automatically; edit it if needed.">${
      dilVarsayilan === "en"
        ? "This format was generated automatically; edit it if needed."
        : "Format otomatik oluşturulmuştur; gerektiğinde elle düzenleyebilirsiniz."
    }</p>
  `;

  return kutu;
}

/**
 * _includes/atif-kutusu.html'deki inline <script>'in BİREBİR aynı mantığı
 * — SADECE addEventListener kullanılır, hiç onclick/inline stil YOK. Bu
 * fonksiyon her çağrıldığında YENİ bir kutu üzerinde çalışır (sayfa
 * başına bir kez çağrılır), bu yüzden modül-seviyesi paylaşılan durum
 * (secilenFormat/secilenDil) burada KAPALI (closure) olarak tutulur.
 */
function wireAtifKutusu(kutu) {
  const secim = { format: "apa", dil: kutu.getAttribute("data-atif-dil-varsayilan") === "en" ? "en" : "tr" };

  function panelleriGuncelle() {
    kutu.querySelectorAll("[data-atif-panel]").forEach((p) => {
      p.hidden = !(p.getAttribute("data-atif-panel") === secim.format && p.getAttribute("data-atif-dil") === secim.dil);
    });
  }

  kutu.querySelectorAll("[data-atif-sekme]").forEach((buton) => {
    buton.addEventListener("click", () => {
      secim.format = buton.getAttribute("data-atif-sekme");
      kutu.querySelectorAll("[data-atif-sekme]").forEach((b) => {
        const aktifMi = b === buton;
        b.classList.toggle("active", aktifMi);
        b.setAttribute("aria-selected", aktifMi ? "true" : "false");
      });
      panelleriGuncelle();
    });
  });

  const dilMetinElemanlari = kutu.querySelectorAll("[data-atif-metin-tr]");
  kutu.querySelectorAll(".atif-dil-buton").forEach((buton) => {
    buton.addEventListener("click", () => {
      secim.dil = buton.getAttribute("data-atif-dil");
      kutu.querySelectorAll(".atif-dil-buton").forEach((b) => {
        const aktifMi = b === buton;
        b.classList.toggle("active", aktifMi);
        b.setAttribute("aria-selected", aktifMi ? "true" : "false");
      });
      dilMetinElemanlari.forEach((el) => {
        el.textContent = secim.dil === "en" ? el.getAttribute("data-atif-metin-en") : el.getAttribute("data-atif-metin-tr");
      });
      panelleriGuncelle();
    });
  });

  const kopyalaButon = kutu.querySelector("[data-atif-kopyala]");
  const bildirim = kutu.querySelector("[data-atif-bildirim]");
  if (kopyalaButon) {
    kopyalaButon.addEventListener("click", () => {
      const aktifPanel = kutu.querySelector("[data-atif-panel]:not([hidden])");
      if (!aktifPanel) return;
      const metinEl = aktifPanel.querySelector(".atif-metin");
      const metin =
        aktifPanel.getAttribute("data-atif-panel") === "bibtex"
          ? metinEl.textContent.trim()
          : metinEl.textContent.replace(/\s+/g, " ").trim();

      const bildirGoster = (msg) => {
        if (!bildirim) return;
        bildirim.textContent = msg;
        bildirim.hidden = false;
        setTimeout(() => { bildirim.hidden = true; }, 1800);
      };

      if (!navigator.clipboard || !navigator.clipboard.writeText) {
        bildirGoster("Kopyalanamadı");
        return;
      }
      navigator.clipboard.writeText(metin).then(() => bildirGoster("Kopyalandı ✓")).catch(() => bildirGoster("Kopyalanamadı"));
    });
  }
}

/** Erişim tarihi / BibTeX urldate: ziyaretçinin O ANKİ tarayıcı tarihinden — build/veritabanı tarihi DEĞİL. */
function atifKutusuDinamikTarihleriDoldur(kutu) {
  const bugun = new Date();
  const erisimTr = `${bugun.getDate()} ${AYLAR_TR[bugun.getMonth()]} ${bugun.getFullYear()}`;
  const erisimEn = `${AYLAR_EN[bugun.getMonth()]} ${bugun.getDate()}, ${bugun.getFullYear()}`;
  kutu.querySelectorAll("[data-atif-erisim]").forEach((span) => {
    const panel = span.closest("[data-atif-panel]");
    const dil = panel ? panel.getAttribute("data-atif-dil") : "tr";
    span.textContent = dil === "en" ? erisimEn : erisimTr;
  });
  const pad = (n) => (n < 10 ? `0${n}` : `${n}`);
  const iso = `${bugun.getFullYear()}-${pad(bugun.getMonth() + 1)}-${pad(bugun.getDate())}`;
  kutu.querySelectorAll("[data-atif-urldate]").forEach((span) => { span.textContent = iso; });
}

async function init() {
  const govdeEl = document.getElementById("supabase-yazi-govde");
  const geriLink = document.getElementById("supabase-yazi-geri-link");

  const params = new URLSearchParams(window.location.search);
  const tur = params.get("tur");
  const slug = params.get("slug");

  if (geriLink) {
    geriLink.href = relUrl(tur === "proje" ? "/icerik/akademik-projeler.html" : "/icerik/blog.html");
    geriLink.textContent = tur === "proje" ? "← Tüm projeler" : "← Bloga dön";
  }

  if (!tur || !slug || !["blog", "proje"].includes(tur)) {
    govdeEl.innerHTML = `<h1>Geçersiz bağlantı</h1><p>Bu linkte gerekli bilgiler eksik ya da hatalı.</p>`;
    return;
  }

  try {
    const { data, error } = await supabase.rpc("sadece_supabase_yazi_getir", {
      p_tur: tur,
      p_slug: slug,
    });

    const kayit = Array.isArray(data) ? data[0] : data;

    if (error || !kayit) {
      govdeEl.innerHTML = `
        <h1>İçerik bulunamadı</h1>
        <p>Bu yazı artık burada değil — GitHub'a taşınmış, silinmiş ya da
        adresi değişmiş olabilir.</p>`;
      return;
    }

    document.title = kayit.baslik;

    const okumaSuresiMetni = okumaSuresiHesapla(kayit.govde);

    let metaHtml = "";
    if (tur === "proje") {
      const parcalar = [];
      if (kayit.venue) parcalar.push(escapeHtml(kayit.venue));
      if (kayit.tarih) parcalar.push(new Date(kayit.tarih).getFullYear());
      if (kayit.guncelleme_tarihi) {
        parcalar.push(
          `Güncellendi: ${new Date(kayit.guncelleme_tarihi).toLocaleDateString("tr-TR", { day: "2-digit", month: "long", year: "numeric" })}`
        );
      }
      if (kayit.durum) parcalar.push(`<span class="tag">${escapeHtml(kayit.durum)}</span>`);
      if (kayit.yazar_adi) parcalar.push(`Yazan: ${escapeHtml(kayit.yazar_adi)}`);
      parcalar.push(okumaSuresiMetni);
      metaHtml = `<div class="meta">${parcalar.join(" · ")}</div>`;
    } else {
      const parcalar = [];
      if (kayit.tarih) {
        parcalar.push(
          new Date(kayit.tarih).toLocaleDateString("tr-TR", { day: "2-digit", month: "long", year: "numeric" })
        );
      }
      if (kayit.guncelleme_tarihi) {
        parcalar.push(
          `Güncellendi: ${new Date(kayit.guncelleme_tarihi).toLocaleDateString("tr-TR", { day: "2-digit", month: "long", year: "numeric" })}`
        );
      }
      if (kayit.yazar_adi) parcalar.push(`Yazan: ${escapeHtml(kayit.yazar_adi)}`);
      parcalar.push(okumaSuresiMetni);
      metaHtml = `<div class="meta">${parcalar.join(" · ")}</div>`;
    }

    let html = `<h1>${escapeHtml(kayit.baslik)}</h1>${metaHtml}`;
    html += pdfButonuHtml(kayit.pdf_url, escapeHtml);
    html += `<div class="project-body">${basitMarkdown(kayit.govde || "")}</div>`;
    // GÜVENLİK: href'e basmadan önce şema kontrolü (bkz. supabase-client.js
    // guvenliDisUrlMi yorumu) — "javascript:" gibi bir URI hiç render edilmez.
    if (tur === "proje" && kayit.link && guvenliDisUrlMi(kayit.link)) {
      html += `<p class="proje-baglanti-alani"><a href="${escapeHtml(kayit.link)}" target="_blank" rel="noopener noreferrer">→ ${escapeHtml(
        kayit.link_etiket || "Bağlantıyı görüntüle"
      )}</a></p>`;
    }

    govdeEl.innerHTML = html;

    // İÇİNDEKİLER: gövde DOM'a yazıldıktan SONRA (h2/h3'ler artık gerçek
    // elementler olarak var) üretilip, .project-body'nin HEMEN ÖNÜNE
    // (yazının en başına, PDF butonundan sonra) ekleniyor — bkz.
    // _layouts/post.html'deki <details class="akademik-toc"> ile aynı yer.
    const tocElementi = tocOlustur(govdeEl.querySelector(".project-body"), kayit.toc === true);
    if (tocElementi) {
      govdeEl.querySelector(".project-body").before(tocElementi);
    }

    // AKADEMİK ATIF KUTUSU — SADECE kayit.akademik === true iken eklenir
    // (bkz. panel/github-yonetim.md "Akademik Yazı / Atıf Kutusu Göster"
    // ve _includes/atif-kutusu.html'deki `page.akademik == true` kontrolüyle
    // BİREBİR aynı davranış). Dil varsayılanı sayfanın <html lang> özniteliğine
    // göre belirlenir; site geneli için ayrı bir page.lang kavramı olmadığından
    // bu, atif-kutusu.html'deki site.lang/page.lang mantığının bu sayfadaki
    // karşılığıdır.
    if (kayit.akademik === true) {
      const appEl = document.getElementById("supabase-yazi-app");
      const siteTitle = appEl?.dataset.siteTitle || document.title;
      const dilVarsayilan = (document.documentElement.lang || "tr").toLowerCase().indexOf("en") === 0 ? "en" : "tr";
      const atifKutusu = atifKutusuOlustur(kayit, siteTitle, appEl?.dataset.siteUrl, dilVarsayilan, escapeHtml);
      if (atifKutusu) {
        govdeEl.appendChild(atifKutusu);
        wireAtifKutusu(atifKutusu);
        atifKutusuDinamikTarihleriDoldur(atifKutusu);
      }
    }

    // REKLAM (bkz. icerik/supabase-yazi.md ve assets/js/core/
    // site-islemleri.js reklamUygula) — bu sayfa şablonu TEK olduğu için
    // (hangi içerik gösterileceği ancak burada belli oluyor) reklam
    // yüklemesi sayfa açılışında OTOMATİK tetiklenmiyor; kaydın kendi
    // `reklam` alanına bakıp KENDİMİZ karar veriyoruz. Sadece ziyaretçi
    // "Reklam" çerezlerini DAHA ÖNCE onaylamışsa gösteriyoruz — onay hiç
    // verilmemişse (ya da reddedilmişse) burada YENİDEN sormuyoruz, sayfa
    // en üstteki genel çerez şeridi/panelinden zaten yönetiliyor.
    const appEl = document.getElementById("supabase-yazi-app");
    const adsenseClient = appEl?.dataset.adsenseClient;
    const adsenseSlot = appEl?.dataset.adsenseSlot;
    const reklamOnayVarMi = !!(window.CerezTercihleri && window.CerezTercihleri.al()?.reklam);
    if (adsenseClient && adsenseSlot && kayit.reklam !== false && reklamOnayVarMi) {
      const reklamDiv = document.createElement("div");
      reklamDiv.className = "reklam-alani reklam-yazi-alt";
      reklamDiv.hidden = true;
      const ins = document.createElement("ins");
      ins.className = "adsbygoogle";
      ins.style.display = "block";
      ins.setAttribute("data-ad-client", adsenseClient);
      ins.setAttribute("data-ad-slot", adsenseSlot);
      ins.setAttribute("data-ad-format", "auto");
      ins.setAttribute("data-full-width-responsive", "true");
      reklamDiv.appendChild(ins);
      govdeEl.after(reklamDiv);
      if (typeof window.__cerezReklamYukle === "function") window.__cerezReklamYukle();
    }
  } catch (err) {
    console.error("supabase-yazi.js init hatası:", err);
    govdeEl.innerHTML = `<p>Bir şeyler ters gitti, sayfayı yenilemeyi dene.</p>`;
  }
}

/** onizleme.js / ozel-icerik.js ile aynı, bağımlılıksız basit markdown->HTML dönüşümü.
 *
 * BUG FİX ("### şeklinde kalıyor" / H3-H4 içindekilere girmiyor): bkz.
 * onizleme.js'deki AYNI fonksiyonun başındaki bugfix notu — burada da
 * birebir aynı düzeltme uygulandı (H1-H4 hepsi tanınıyor).
 */
function basitMarkdown(md) {
  const esc = escapeHtml(md);
  return esc
    .split(/\n{2,}/)
    .map((blok) => {
      const baslikEslesme = blok.match(/^(#{1,4})[ \t]+(.+)$/);
      if (baslikEslesme) {
        const seviye = baslikEslesme[1].length;
        return `<h${seviye}>${baslikEslesme[2]}</h${seviye}>`;
      }
      let satir = blok
        .replaceAll(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replaceAll(/\*(.+?)\*/g, "<em>$1</em>")
        .replaceAll(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
        .replaceAll(/\n/g, "<br>");
      return `<p>${satir}</p>`;
    })
    .join("\n");
}

init();

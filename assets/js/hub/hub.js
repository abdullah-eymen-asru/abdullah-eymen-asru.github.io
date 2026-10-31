/*
 * assets/js/hub/hub.js — Panel Ana Ekranı (Hub): rol ve yetkiye göre erişilebilen TÜM modüller tek ekranda.
 * -----------------------------------------------------------------------
 *  • Veri kaynağı dashboard.js'in sidebar'ı çizerken kullandığı AYNI görünür-öğe listesidir (gorunurMu) → yetkisiz
 *    modül kartı hiç çizilmez; ayrı bir izin mantığı yoktur, ikisi birbirinden sapamaz.
 *  • Tek dokunuşla erişim (kart), arama/filtre ("/" ya da Ctrl/⌘+K ile arama kutusuna odak, ↑/↓ + Enter), kategori çipleri,
 *    "Son kullanılanlar" (localStorage; kapalıysa sorun değil).
 *  • innerHTML yok, inline stil yok (CSP).
 */
const ACIKLAMA = {
  "me-panel": "Hesabın, profilin ve kişisel özetin.",
  "content-all": "Yazılar ve projeler; düzenle, yayınla, ara.",
  "content-new": "Yeni yazı ya da proje oluştur.",
  "content-notlar": "Uçtan uca şifreli notlar, alıntılar, kaynaklar.",
  "content-private": "Gizli/özel makaleler ve erişim izinleri.",
  "content-folders": "İçerik klasörlerini düzenle.",
  "media-r2": "R2 dosya paylaşımı ve bağlantıları.",
  "media-arsiv": "Şifreli dosya yöneticisi (R2).",
  "media-izleme": "İzleme ve okuma listelerini yönet.",
  "media-cv": "Özgeçmiş (CV) ve profil görseli.",
  "lib-kutuphane": "Akademik kaynaklar, PDF okuyucu, atıf.",
  "lib-tum": "Tüm üyelerin kaynakları (salt okuma).",
  "users-uye": "Üyeleri, rolleri ve onayları yönet.",
  "users-mesajlar": "Sohbet ve mesajlar.",
  "tool-donusturucu": "PDF/Word/görsel dönüştür, tarayıcıda düzenle.",
  "tool-belge-tarayici": "Belgeleri tara, birleştir, boyutunu küçült; PDF/ZIP olarak indir.",
  "tool-metadata": "Fotoğraf, video, Office, PDF ve ZIP dosyalarındaki gizli üst veriyi (konum, yazar, tarih) temizle.",
  "tool-pdfbol": "PDF'i aralıklara, sayfa sayısına, boyuta göre böl; küçük resimlerden sayfa seç, ayıkla, sil, döndür. Dosya cihazından çıkmaz.",
  "tool-havastil": "Hava durumuna göre katman, ayakkabı ve renk önerisi (CLO motoru) + doğrulanmış haber taktiği.",
  "sys-guvenlik": "Admin güvenliği, denetim ve onaylar.",
  "sys-yetki": "Rol bazlı yetkiler ve erişim kalkanı.",
  "sys-kvkk": "KVKK ve açık rıza metinleri / sürümleri.",
  "sys-uye-aktarim": "Üye verisi indirme izinleri.",
  "sys-silme-onayi": "Silinen hesapların verileri, dosyaları, kalıcı silme.",
  "sys-durum": "Supabase, site ve bağlı servislerin anlık durumu; kesintide ne yapman gerektiği; R2 kotaları.",
  "sys-duyuru": "Bakım/yedekleme/felaket duyurusu yaz; ziyaretçilere pencere, üyelere şerit; kimlerin okuduğunu gör.",
  "sys-yedek": "Kendi verini yedekle ve geri yükle (Site Sahibi: tam sistem, depolama gezgini).",
  "sys-github": "GitHub / Worker bağlantı durumu.",
  "sys-hakkimda": "Hakkımda ve sosyal bağlantılar.",
  "sys-hesabim": "Hesap silme ve tehlikeli işlemler.",
  "sys-demo": "Demo/vitrin modunda hangi sayfa ve özelliklerin görüneceğini yönet.",
  "sys-metrik": "Depolama ve istek kullanımı (vitrin için örnek metrikler).",
};
const SON_ANAHTAR = "aea_hub_son";

const el = (e, oz = {}, ...c) => {
  const d = document.createElement(e);
  for (const [k, v] of Object.entries(oz)) { if (v == null || v === false) continue; if (k === "class") d.className = v; else if (k === "text") d.textContent = v; else d.setAttribute(k, v === true ? "" : v); }
  for (const x of c.flat()) if (x != null && x !== false) d.append(x);
  return d;
};
const norm = (s) => String(s || "").toLocaleLowerCase("tr");

function sonlariOku() { try { return JSON.parse(localStorage.getItem(SON_ANAHTAR) || "[]").filter((x) => typeof x === "string").slice(0, 8); } catch { return []; } }
export function sonKullanilanKaydet(id) {
  try { localStorage.setItem(SON_ANAHTAR, JSON.stringify([id, ...sonlariOku().filter((x) => x !== id)].slice(0, 8))); } catch { /* depolama kapalı: sorun değil */ }
}

/** @param {HTMLElement} kok  @param {{group:string,icon:string,items:{id:string,icon:string,label:string}[]}[]} gruplar  @param {(id:string)=>void} git */
export function hubCiz(kok, gruplar, git, { ad = "" } = {}) {
  let arama = "";
  let kategori = "hepsi";
  const girdi = el("input", { type: "search", class: "hub-arama", placeholder: "Araç ara…  ( / veya Ctrl+K )", "aria-label": "Panelde araç ara", autocomplete: "off", enterkeyhint: "go" });
  const cipler = el("div", { class: "hub-cipler", role: "group", "aria-label": "Kategori" });
  const icerik = el("div", { class: "hub-icerik" });
  const tum = gruplar.flatMap((g) => g.items.map((it) => ({ ...it, grup: g.group, grupIkon: g.icon })));

  const kart = (it) => {
    const a = el("a", { class: "hub-kart", href: `#${it.id}`, "data-hub-id": it.id },
      el("span", { class: "hub-kart-ikon", "aria-hidden": "true", text: it.icon || "•" }),
      el("span", { class: "hub-kart-govde" }, el("strong", { text: it.label }), el("small", { text: ACIKLAMA[it.id] || it.grup })));
    a.addEventListener("click", (e) => { e.preventDefault(); sonKullanilanKaydet(it.id); git(it.id); });
    return a;
  };

  function ciz() {
    const q = norm(arama).trim();
    const uygun = (it) => (kategori === "hepsi" || it.grup === kategori) && (!q || norm(`${it.label} ${ACIKLAMA[it.id] || ""} ${it.grup}`).includes(q));
    const bolumler = [];
    const sonlar = !q && kategori === "hepsi" ? sonlariOku().map((id) => tum.find((t) => t.id === id)).filter(Boolean).slice(0, 4) : [];
    if (sonlar.length) bolumler.push(el("section", { class: "hub-bolum" }, el("h2", { text: "🕘 Son kullanılanlar" }), el("div", { class: "hub-izgara" }, sonlar.map(kart))));
    for (const g of gruplar) {
      const liste = g.items.filter((it) => uygun({ ...it, grup: g.group }));
      if (!liste.length) continue;
      bolumler.push(el("section", { class: "hub-bolum" }, el("h2", { text: `${g.icon} ${g.group}` }), el("div", { class: "hub-izgara" }, liste.map((it) => kart({ ...it, grup: g.group })))));
    }
    icerik.replaceChildren(...(bolumler.length ? bolumler : [el("p", { class: "muted", text: "Eşleşen araç yok." })]));
  }

  function cipleriCiz() {
    cipler.replaceChildren(...[{ g: "hepsi", ad: "Hepsi", n: tum.length }, ...gruplar.map((g) => ({ g: g.group, ad: `${g.icon} ${g.group}`, n: g.items.length }))].map((c) => {
      const b = el("button", { type: "button", class: "hub-cip", "aria-pressed": String(kategori === c.g), text: `${c.ad} (${c.n})` });
      b.addEventListener("click", () => { kategori = c.g; cipleriCiz(); ciz(); });
      return b;
    }));
  }

  girdi.addEventListener("input", () => { arama = girdi.value; ciz(); });
  girdi.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { const ilk = icerik.querySelector(".hub-kart"); if (ilk) { e.preventDefault(); ilk.click(); } }
    else if (e.key === "ArrowDown") { e.preventDefault(); icerik.querySelector(".hub-kart")?.focus(); }
  });
  icerik.addEventListener("keydown", (e) => {
    if (!["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft"].includes(e.key)) return;
    const k = [...icerik.querySelectorAll(".hub-kart")];
    const i = k.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const adim = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1;
    if (i + adim < 0) girdi.focus(); else k[Math.min(k.length - 1, i + adim)]?.focus();
  });
  // Kısayol: yalnızca Ana Ekran görünürken ve bir yazı alanında değilken
  const kisayol = (e) => {
    if (kok.closest("[hidden]")) return;
    const yazi = /^(input|textarea|select)$/i.test(document.activeElement?.tagName || "") || document.activeElement?.isContentEditable;
    if ((e.key === "k" && (e.ctrlKey || e.metaKey)) || (e.key === "/" && !yazi)) { e.preventDefault(); girdi.focus(); girdi.select(); }
  };
  document.addEventListener("keydown", kisayol);

  kok.replaceChildren(el("p", { class: "muted hub-selam", text: ad ? `Merhaba ${ad}. Rolüne ve yetkilerine göre erişebildiğin her şey aşağıda.` : "Rolüne ve yetkilerine göre erişebildiğin her şey aşağıda." }), girdi, cipler, icerik);
  cipleriCiz();
  ciz();
  return { yenile: ciz, yokEt: () => document.removeEventListener("keydown", kisayol) };
}

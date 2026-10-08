/*
 * assets/js/akademik/okuyucu.js — Gelişmiş PDF okuma / açıklama penceresi.
 *
 * Görüntüleme: resmi PDF.js (PDFViewer: sayfa sanallaştırma, yakınlaştırma, metin katmanı, arama).
 *   PDF.js'in kendi açıklama katmanı KAPALIDIR (annotationMode=DISABLE); mevcut + yeni tüm açıklamalar
 *   TEK modelden (pdf-yaz.js) kendi SVG katmanımızda çizilir → çift çizim yok, hepsi düzenlenebilir.
 *   Bağlantılar (Link) ayrıca üst katmanda tıklanabilir bırakılır.
 * Kaydetme: pdf-lib ile standart /Annot nesneleri PDF'e işlenir, R2'deki dosyanın ÜZERİNE yazılır
 *   (önce Worker bir önceki sürümü yedekler), ardından özet Supabase'e (akademik_notlar) eşitlenir.
 *
 * Kullanım: okuyucuAc({ kaynak, salt, kullaniciAdi, kapaninca })
 *   salt=true → başkasının (paylaşılan / owner incelemesi) kaynağı: yalnızca okunur, açıklama yazılamaz.
 */
import { esc, el, toast, supabase, workerJson, pdfIndirBayt, pdfYukle, dosyaIndir, panoyaKopyala, uuid, bayt as baytYazi, RENKLER, AKADEMIK_WORKER_URL } from "./ortak.js";
import { motoruYukle, pdfLibAl } from "./motor.js";
import { acikla, uygula, satirlaraBol, NOT_BOYUTU } from "./pdf-yaz.js";
import { alintiMarkdown } from "./atif.js";

const SVGNS = "http://www.w3.org/2000/svg";
const svgEl = (tag, ozellik = {}) => {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(ozellik)) n.setAttribute(k, v);
  return n;
};

const ARACLAR = [
  { id: "gez", simge: "↖", ad: "İmleç / seç (Esc)", yazma: false },
  { id: "vurgu", simge: "🖍", ad: "Vurgula (metin seç)", yazma: true },
  { id: "altcizgi", simge: "U̲", ad: "Altını çiz (metin seç)", yazma: true },
  { id: "ustcizgi", simge: "S̶", ad: "Üstünü çiz (metin seç)", yazma: true },
  { id: "cizim", simge: "✎", ad: "Serbest çizim", yazma: true },
  { id: "sekil", simge: "▭", ad: "Dikdörtgen", yazma: true },
  { id: "yapiskan", simge: "🗒", ad: "Yapışkan not (tıkla)", yazma: true },
  { id: "metin", simge: "T", ad: "Metin kutusu (tıkla ya da sürükle)", yazma: true },
];
const TUR_ADI = { vurgu: "Vurgu", altcizgi: "Altı çizili", ustcizgi: "Üstü çizili", cizim: "Çizim", sekil: "Şekil", yapiskan: "Not", metin: "Metin" };
const METIN_TURLERI = new Set(["vurgu", "altcizgi", "ustcizgi"]);
const CIZIM_ARACLARI = new Set(["cizim", "sekil", "yapiskan", "metin"]);
const BUYUK_PDF_OKUMA_SINIRI = 60 * 1024 * 1024; // yalnızca bilgi amaçlı uyarı; SINIR DEĞİL

/* ------------------------------- geometri ------------------------------- */

const rectBirlesim = (rs) => [Math.min(...rs.map((r) => r[0])), Math.min(...rs.map((r) => r[1])), Math.max(...rs.map((r) => r[2])), Math.max(...rs.map((r) => r[3]))];
const noktaIcinde = (x, y, r, t = 0) => x >= r[0] - t && x <= r[2] + t && y >= r[1] - t && y <= r[3] + t;

function parcayaUzaklik(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const u = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(px - (ax + u * dx), py - (ay + u * dy));
}

/** Douglas-Peucker ile serbest çizim noktalarını sadeleştirir (düz sayı dizisi [x,y,x,y…]). */
function sadelestir(n, eps) {
  if (n.length <= 4) return n;
  const nk = [];
  for (let i = 0; i < n.length; i += 2) nk.push([n[i], n[i + 1]]);
  const tut = new Array(nk.length).fill(false);
  tut[0] = tut[nk.length - 1] = true;
  const yig = [[0, nk.length - 1]];
  while (yig.length) {
    const [a, b] = yig.pop();
    let en = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = parcayaUzaklik(nk[i][0], nk[i][1], nk[a][0], nk[a][1], nk[b][0], nk[b][1]);
      if (d > en) { en = d; idx = i; }
    }
    if (idx > -1 && en > eps) { tut[idx] = true; yig.push([a, idx], [idx, b]); }
  }
  return nk.filter((_, i) => tut[i]).flat();
}

/** Aynı satırdaki bitişik/üst üste binen kutuları birleştirir, tamamen içerilenleri atar. */
function kutulariBirlestir(kutular) {
  const s = kutular.filter((k) => k[2] - k[0] > 0.5 && k[3] - k[1] > 0.5).sort((a, b) => b[3] - a[3] || a[0] - b[0]);
  const cikti = [];
  for (const k of s) {
    const son = cikti.find((c) => {
      const dikeyOrt = Math.min(c[3], k[3]) - Math.max(c[1], k[1]);
      const yuk = Math.min(c[3] - c[1], k[3] - k[1]);
      return dikeyOrt > yuk * 0.5 && k[0] <= c[2] + 2 && k[2] >= c[0] - 2;
    });
    if (son) { son[0] = Math.min(son[0], k[0]); son[1] = Math.min(son[1], k[1]); son[2] = Math.max(son[2], k[2]); son[3] = Math.max(son[3], k[3]); }
    else cikti.push([...k]);
  }
  return cikti;
}

/** Seçili aralığın metni: satır sonu <br> → boşluk; satır sonu tireli kelime birleştirilir. */
function aralikMetni(aralik) {
  const parca = aralik.cloneContents();
  let s = "";
  const gez = (n) => {
    if (n.nodeType === 3) s += n.nodeValue;
    else if (n.nodeName === "BR") s += "\u0001";
    else if (n.nodeType === 1 && !n.classList?.contains("endOfContent")) n.childNodes.forEach(gez);
    else if (n.nodeType === 11) n.childNodes.forEach(gez);
  };
  gez(parca);
  return s.replace(/(\p{L})-\u0001(\p{Ll})/gu, "$1$2").replace(/\u0001/g, " ").replace(/\s+/g, " ").trim();
}

/* ------------------------------- ana giriş ------------------------------- */

export async function okuyucuAc({ kaynak, salt = false, kullaniciAdi = "", kapaninca = null }) {
  const d = {
    kaynak, salt, kullaniciAdi,
    arac: "gez", renk: RENKLER[0].hex, kalinlik: 2,
    model: new Map(), silinenler: [], undo: [],
    secili: null, kirli: false, kaydediliyor: false,
    bytes: null, rev: Number(kaynak.pdf_rev || 0), sifreli: false,
    linkler: new Map(), canli: null, olcu: null,
  };

  /* ---------- iskelet ---------- */
  const araclarHtml = salt ? "" : ARACLAR.map((a) => `<button type="button" class="ak-arac${a.id === "gez" ? " aktif" : ""}" data-ak-arac="${a.id}" title="${esc(a.ad)}" aria-label="${esc(a.ad)}">${a.simge}</button>`).join("");
  const kok = el("div", { class: "ak-okuyucu", role: "dialog", "aria-modal": "true", "aria-label": `PDF okuyucu: ${kaynak.baslik}` });
  kok.innerHTML = `
    <header class="ak-ok-ust">
      <button type="button" class="ak-btn ak-ok-kapat" data-ak="kapat" title="Kapat" aria-label="Kapat">✕</button>
      <div class="ak-ok-baslik" title="${esc(kaynak.baslik)}">${esc(kaynak.baslik)}${salt ? ' <span class="ak-etiket">salt okunur</span>' : ""}</div>
      <div class="ak-ok-araclar" role="toolbar" aria-label="Açıklama araçları">${araclarHtml}
        ${salt ? "" : `<span class="ak-ok-renkler" data-ak-renkler></span>
        <select class="ak-ok-sec" data-ak="kalinlik" title="Çizgi kalınlığı" aria-label="Çizgi kalınlığı"><option value="1">İnce</option><option value="2" selected>Orta</option><option value="4">Kalın</option><option value="7">Çok kalın</option></select>`}
      </div>
      <div class="ak-ok-sag">
        <input type="search" class="ak-ok-ara" data-ak="ara" placeholder="PDF'te ara" aria-label="PDF'te ara"><span class="ak-ok-say" data-ak-bul></span>
        <button type="button" class="ak-btn" data-ak="uzaklas" title="Uzaklaştır" aria-label="Uzaklaştır">−</button>
        <select class="ak-ok-sec" data-ak="olcek" aria-label="Yakınlaştırma"><option value="page-width">Genişliğe sığdır</option><option value="page-fit">Sayfaya sığdır</option><option value="auto">Otomatik</option><option value="0.75">75%</option><option value="1">100%</option><option value="1.25">125%</option><option value="1.5">150%</option><option value="2">200%</option></select>
        <button type="button" class="ak-btn" data-ak="yaklas" title="Yakınlaştır" aria-label="Yakınlaştır">+</button>
        <span class="ak-ok-sayfa"><input type="number" min="1" value="1" data-ak="sayfa" aria-label="Sayfa"> / <span data-ak-toplam>–</span></span>
        <button type="button" class="ak-btn" data-ak="yan" title="Açıklama paneli" aria-label="Açıklama paneli">☰</button>
        <button type="button" class="ak-btn" data-ak="tam" title="Tam ekran" aria-label="Tam ekran">⛶</button>
        <button type="button" class="ak-btn" data-ak="indir" title="PDF'i indir (kaydedilmiş sürüm)" aria-label="PDF'i indir">⬇</button>
        ${salt ? "" : `<button type="button" class="ak-btn" data-ak="onceki" title="Önceki sürüme dön" aria-label="Önceki sürüme dön">↶</button><button type="button" class="ak-btn ak-btn-birincil" data-ak="kaydet" title="Kaydet (Ctrl+S)">Kaydet</button>`}
      </div>
    </header>
    <div class="ak-ok-durum" data-ak-durum aria-live="polite"></div>
    <div class="ak-ok-govde">
      <div class="ak-ok-kap" data-ak-kap tabindex="0"><div class="pdfViewer"></div></div>
      <aside class="ak-ok-yan" data-ak-yan aria-label="Açıklamalar">
        <div class="ak-yan-ust">
          <strong>Açıklamalar <span data-ak-adet>0</span></strong>
          <button type="button" class="ak-btn" data-ak="md-tumu" title="Tümünü Markdown alıntısı olarak kopyala">Markdown kopyala</button>
        </div>
        <div class="ak-yan-filtre"><select data-ak="f-tur" aria-label="Türe göre süz"><option value="">Tüm türler</option>${Object.entries(TUR_ADI).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
        <select data-ak="f-renk" aria-label="Renge göre süz"><option value="">Tüm renkler</option>${RENKLER.map((r) => `<option value="${r.hex}">${r.ad}</option>`).join("")}</select></div>
        <div class="ak-yan-liste" data-ak-liste></div>
      </aside>
    </div>`;
  document.body.append(kok);
  document.body.classList.add("ak-okuyucu-acik");
  if (window.innerWidth <= 900) kok.classList.add("yan-kapali"); // dar ekranda panel varsayılan kapalı
  const q = (s) => kok.querySelector(s);
  const durumYaz = (m, tur = "") => { const e = q("[data-ak-durum]"); e.textContent = m; e.className = `ak-ok-durum ${tur}`; };
  durumYaz("PDF motoru yükleniyor…");
  // Erken hata yolu: motor/PDF yüklenemezse kullanıcı yine de pencereyi kapatabilsin
  // (asıl kapat() daha sonra tanımlanan sabitlere bağlı olduğundan burada ayrı, bağımsız bir kapatma var).
  const erkenKapat = () => { kok.remove(); document.body.classList.remove("ak-okuyucu-acik"); kapaninca?.(); };
  q('[data-ak="kapat"]').onclick = erkenKapat;

  let motor;
  try {
    motor = await motoruYukle();
  } catch (h) {
    durumYaz("PDF motoru yüklenemedi (CDN'e ulaşılamıyor olabilir). Bağlantını kontrol edip tekrar dene.", "hata");
    console.error(h);
    return;
  }
  const { pdfjsLib, pdfjsViewer, taban } = motor;

  /* ---------- PDF'i indir, aç ---------- */
  let belge;
  try {
    durumYaz("PDF indiriliyor… %0");
    const { bayt, rev } = await pdfIndirBayt(kaynak.id, (o) => durumYaz(`PDF indiriliyor… %${Math.round(o * 100)}`));
    d.bytes = bayt;
    d.rev = rev;
    if (bayt.byteLength > BUYUK_PDF_OKUMA_SINIRI) durumYaz("Büyük dosya: açıklamaları okumak biraz sürebilir…");
    belge = await pdfjsLib.getDocument({
      data: new Uint8Array(bayt), // kopya: PDF.js diziyi iş parçacığına devreder
      cMapUrl: `${taban}/cmaps/`, cMapPacked: true,
      standardFontDataUrl: `${taban}/standard_fonts/`, wasmUrl: `${taban}/wasm/`,
      isEvalSupported: false, useWasm: false, enableXfa: false,
    }).promise;
  } catch (h) {
    console.error(h);
    durumYaz(`PDF açılamadı: ${h.message || h}`, "hata");
    return;
  }
  d.belge = belge;

  /* ---------- açıklamaları yükle (PDF + Supabase özeti) ---------- */
  try {
    const pdflib = await pdfLibAl();
    const { aciklamalar, sifreli } = await acikla(pdflib, d.bytes);
    d.sifreli = sifreli;
    const { data: satirlar } = await supabase.from("akademik_notlar").select("ek_id,tur,sayfa,metin,yorum,renk,konum").eq("kaynak_id", kaynak.id).not("ek_id", "is", null);
    const dbHarita = new Map((satirlar || []).map((s) => [s.ek_id, s]));
    for (const a of aciklamalar) {
      const s = a.nm ? dbHarita.get(a.nm) : null;
      if (s?.metin) a.metin = s.metin;
      d.model.set(a.id, a);
    }
    if (sifreli) {
      // PDF'e yazılamayan (şifreli/bozuk) dosyada geometri veritabanından geri yüklenir.
      for (const s of satirlar || []) {
        if (!s.konum) continue;
        const id = s.ek_id.replace(/^ae-/, "");
        d.model.set(id, { id, nm: s.ek_id, tur: s.tur === "yapiskan" ? "yapiskan" : s.tur, sayfa: s.sayfa, renk: s.renk || "#ffd400", yorum: s.yorum || "", metin: s.metin || "", durum: "ayni", ...s.konum });
      }
      durumYaz("Bu PDF pdf-lib ile açılamadı (şifreli olabilir): açıklamalar yalnızca veritabanına kaydedilecek, PDF'e gömülmeyecek.", "uyari");
    }
  } catch (h) {
    console.warn("Açıklamalar okunamadı:", h);
    toast("Mevcut açıklamalar okunamadı; yeni açıklamalar yine eklenebilir.", "uyari");
  }

  /* ---------- görüntüleyici ---------- */
  q('[data-ak="kapat"]').onclick = null; // artık delegasyonlu kapat() devrede
  const kap = q("[data-ak-kap]");
  const eventBus = new pdfjsViewer.EventBus();
  const linkService = new pdfjsViewer.PDFLinkService({ eventBus, externalLinkTarget: 2, externalLinkRel: "noopener noreferrer" });
  const findController = new pdfjsViewer.PDFFindController({ eventBus, linkService });
  const viewer = new pdfjsViewer.PDFViewer({
    container: kap, eventBus, linkService, findController,
    annotationMode: 0, annotationEditorMode: -1, textLayerMode: 1, removePageBorders: false,
  });
  linkService.setViewer(viewer);
  d.viewer = viewer;
  viewer.setDocument(belge);
  linkService.setDocument(belge, null);
  q("[data-ak-toplam]").textContent = belge.numPages;

  eventBus.on("pagesinit", () => {
    viewer.currentScaleValue = "page-width";
    durumYaz(salt ? "Salt okunur." : "Hazır. Metin seçip vurgula ya da soldaki araçlardan birini seç.");
    metinDoldur();
  });
  eventBus.on("pagerendered", (e) => sayfaCiz(e.pageNumber));
  eventBus.on("pagechanging", (e) => { q('[data-ak="sayfa"]').value = e.pageNumber; });
  eventBus.on("scalechange", (e) => { const s = q('[data-ak="olcek"]'); if (![...s.options].some((o) => o.value === String(e.presetValue || e.scale))) return; s.value = String(e.presetValue || e.scale); });
  eventBus.on("updatefindmatchescount", (e) => { q("[data-ak-bul]").textContent = e.matchesCount?.total ? `${e.matchesCount.current}/${e.matchesCount.total}` : ""; });
  eventBus.on("updatefindcontrolstate", (e) => { if (e.matchesCount?.total === 0 && e.state === 1) q("[data-ak-bul]").textContent = "yok"; });

  /* ---------- koordinat yardımcıları ---------- */
  const sayfaGorunumu = (no) => viewer.getPageView(no - 1);
  const katman = (pv) => pv?.div?.querySelector(":scope > .ak-kat");
  function istemciRectPdf(pv, kat, l, t, r, b) {
    const k = kat.getBoundingClientRect();
    const sx = pv.viewport.width / k.width, sy = pv.viewport.height / k.height;
    const [x1, y1] = pv.viewport.convertToPdfPoint((l - k.left) * sx, (t - k.top) * sy);
    const [x2, y2] = pv.viewport.convertToPdfPoint((r - k.left) * sx, (b - k.top) * sy);
    return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
  }
  function olayNoktasi(e, sayfaDiv) {
    const pv = sayfaGorunumu(Number(sayfaDiv.dataset.pageNumber));
    const kat = katman(pv);
    if (!pv || !kat) return null;
    const k = kat.getBoundingClientRect();
    const vx = (e.clientX - k.left) * (pv.viewport.width / k.width);
    const vy = (e.clientY - k.top) * (pv.viewport.height / k.height);
    const [x, y] = pv.viewport.convertToPdfPoint(vx, vy);
    return { pv, x, y, vx, vy };
  }

  /* ---------- model işlemleri ---------- */
  function degisti() { d.kirli = true; listeCiz(); kaydetDurumu(); }
  function kaydetDurumu() {
    const b = q('[data-ak="kaydet"]');
    if (b) { b.textContent = d.kirli ? "Kaydet •" : "Kaydet"; b.classList.toggle("kirli", d.kirli); }
  }
  function ekleModel(a, geriAlinabilir = true) {
    a.id = a.id || uuid();
    a.durum = "yeni";
    a.metin = a.metin || "";
    a.yorum = a.yorum || "";
    d.model.set(a.id, a);
    if (geriAlinabilir) d.undo.push({ tip: "ekle", id: a.id });
    sayfaCiz(a.sayfa);
    degisti();
    return a;
  }
  function sil(id, geriAlinabilir = true) {
    const a = d.model.get(id);
    if (!a) return;
    d.model.delete(id);
    if (a.durum !== "yeni") d.silinenler.push({ nm: a.nm, ref: a.ref, sayfa: a.sayfa, _a: a });
    if (geriAlinabilir) d.undo.push({ tip: "sil", a });
    if (d.secili === id) sec(null);
    sayfaCiz(a.sayfa);
    degisti();
  }
  function guncelle(id, alanlar, geriAlinabilir = true) {
    const a = d.model.get(id);
    if (!a) return;
    if (geriAlinabilir) d.undo.push({ tip: "duzenle", id, onceki: Object.fromEntries(Object.keys(alanlar).map((k) => [k, a[k]])), durum: a.durum });
    Object.assign(a, alanlar);
    if (a.durum === "ayni") a.durum = "degisti";
    sayfaCiz(a.sayfa);
    degisti();
  }
  function geriAl() {
    const o = d.undo.pop();
    if (!o) return;
    if (o.tip === "ekle") sil(o.id, false);
    else if (o.tip === "sil") {
      d.model.set(o.a.id, o.a);
      d.silinenler = d.silinenler.filter((s) => s._a !== o.a);
      sayfaCiz(o.a.sayfa);
      degisti();
    } else if (o.tip === "duzenle") {
      const a = d.model.get(o.id);
      if (a) { Object.assign(a, o.onceki, { durum: o.durum }); sayfaCiz(a.sayfa); degisti(); }
    }
  }

  /* ---------- sayfa üstü katman çizimi ---------- */
  function sayfaCiz(no) {
    const pv = sayfaGorunumu(no);
    if (!pv?.div || !pv.viewport) return;
    let kat = katman(pv);
    if (!kat) { kat = el("div", { class: "ak-kat" }); pv.div.append(kat); }
    kat.textContent = "";
    const vp = pv.viewport;
    const W = vp.width, H = vp.height, olcek = vp.scale;
    const svg = svgEl("svg", { class: "ak-svg", viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none" });
    const R = (r) => {
      const [ax, ay] = vp.convertToViewportPoint(r[0], r[1]);
      const [bx, by] = vp.convertToViewportPoint(r[2], r[3]);
      return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
    };
    const olcu = d.olcu || (d.olcu = document.createElement("canvas").getContext("2d"));

    for (const a of [...d.model.values()].filter((x) => x.sayfa === no)) {
      const g = svgEl("g", { class: `ak-oge ak-${a.tur}${d.secili === a.id ? " secili" : ""}`, "data-id": a.id });
      if (METIN_TURLERI.has(a.tur)) {
        for (const k of a.kutular) {
          const r = R(k);
          if (a.tur === "vurgu") g.append(svgEl("rect", { x: r.x, y: r.y, width: r.w, height: r.h, fill: a.renk, "fill-opacity": "0.45", class: "ak-vurgu-kutu" }));
          else {
            const y = a.tur === "altcizgi" ? r.y + r.h * 0.9 : r.y + r.h * 0.52;
            g.append(svgEl("line", { x1: r.x, x2: r.x + r.w, y1: y, y2: y, stroke: a.renk, "stroke-width": Math.max(1.2, olcek * 1.1), "stroke-linecap": "round" }));
          }
        }
        if (a.yorum) {
          const r = R(a.kutular[0]);
          const ik = svgEl("g", { class: "ak-yorum-isareti", transform: `translate(${r.x + r.w - 2},${r.y - 9})` });
          ik.append(svgEl("rect", { width: 12, height: 10, rx: 2, fill: a.renk, stroke: "#333", "stroke-width": 0.8 }), svgEl("path", { d: "M3 10 L3 14 L7 10 Z", fill: a.renk, stroke: "#333", "stroke-width": 0.8 }));
          g.append(ik);
        }
      } else if (a.tur === "cizim") {
        for (const c of a.cizgiler) {
          let dd = "";
          for (let i = 0; i + 1 < c.length; i += 2) { const [x, y] = vp.convertToViewportPoint(c[i], c[i + 1]); dd += `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)} `; }
          if (c.length === 4 && c[0] === c[2] && c[1] === c[3]) dd += "l0.01 0";
          g.append(svgEl("path", { d: dd, fill: "none", stroke: a.renk, "stroke-width": (a.kalinlik || 1.5) * olcek, "stroke-linecap": "round", "stroke-linejoin": "round" }));
        }
      } else if (a.tur === "sekil") {
        const r = R(a.rect);
        g.append(svgEl("rect", { x: r.x, y: r.y, width: r.w, height: r.h, fill: "none", stroke: a.renk, "stroke-width": (a.kalinlik || 1.5) * olcek }));
      } else if (a.tur === "yapiskan") {
        const r = R(a.rect);
        const N = NOT_BOYUTU * Math.min(1.4, Math.max(0.8, olcek));
        const ik = svgEl("g", { transform: `translate(${r.x},${r.y})` });
        ik.append(svgEl("rect", { width: N, height: N, fill: a.renk, stroke: "#222", "stroke-width": 1 }));
        for (const yy of [0.3, 0.5, 0.7]) ik.append(svgEl("line", { x1: N * 0.2, x2: N * (yy === 0.7 ? 0.6 : 0.8), y1: N * yy, y2: N * yy, stroke: "#222", "stroke-width": 1 }));
        g.append(ik);
      } else if (a.tur === "metin") {
        const r = R(a.rect);
        const px = (a.yaziPt || 12) * olcek;
        olcu.font = `${px}px Helvetica, Arial, sans-serif`;
        const t = svgEl("text", { fill: a.renk, "font-size": px, "font-family": "Helvetica, Arial, sans-serif" });
        satirlaraBol(olcu, a.yorum || "", r.w - 4).forEach((satir, i) => {
          const ts = svgEl("tspan", { x: r.x + 2, y: r.y + 2 + px * (0.95 + i * 1.2) });
          ts.textContent = satir;
          t.append(ts);
        });
        g.append(svgEl("rect", { x: r.x, y: r.y, width: r.w, height: r.h, fill: "transparent", stroke: a.renk, "stroke-opacity": "0.35", "stroke-dasharray": "3 3", class: "ak-metin-cerceve" }), t);
      }
      if (d.secili === a.id) {
        const b = kutuPx(a, vp);
        g.append(svgEl("rect", { x: b.x - 3, y: b.y - 3, width: b.w + 6, height: b.h + 6, class: "ak-secim-cerceve", fill: "none" }));
      }
      svg.append(g);
    }
    kat.append(svg);

    // Bağlantılar (PDF.js açıklama katmanı kapalı olduğundan burada üretilir)
    if (!d.linkler.has(no)) {
      d.linkler.set(no, pv.pdfPage ? pv.pdfPage.getAnnotations({ intent: "display" }).then((l) => l.filter((x) => x.subtype === "Link" && (x.url || x.dest))).catch(() => []) : Promise.resolve([]));
    }
    d.linkler.get(no).then((liste) => {
      if (katman(pv) !== kat) return;
      for (const l of liste) {
        const [x1, y1, x2, y2] = vp.convertToViewportRectangle(l.rect);
        const yuzde = (v, t) => `${(v / t) * 100}%`;
        const url = l.url && /^(https?:|mailto:)/i.test(l.url) ? l.url : null;
        const a = el(url ? "a" : "button", url ? { class: "ak-link", href: url, target: "_blank", rel: "noopener noreferrer" } : { class: "ak-link", type: "button", "aria-label": "Bağlantıya git" });
        a.style.left = yuzde(Math.min(x1, x2), W); a.style.top = yuzde(Math.min(y1, y2), H);
        a.style.width = yuzde(Math.abs(x2 - x1), W); a.style.height = yuzde(Math.abs(y2 - y1), H);
        if (!url) a.addEventListener("click", (ev) => { ev.preventDefault(); linkService.goToDestination(l.dest); });
        kat.append(a);
      }
    });
  }

  function kutuPx(a, vp) {
    const r = a.kutular ? rectBirlesim(a.kutular) : a.cizgiler ? rectBirlesim(a.cizgiler.map((c) => { const xs = c.filter((_, i) => i % 2 === 0), ys = c.filter((_, i) => i % 2); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; })) : a.rect;
    const [ax, ay] = vp.convertToViewportPoint(r[0], r[1]);
    const [bx, by] = vp.convertToViewportPoint(r[2], r[3]);
    return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
  }

  /* ---------- seçili açıklama + düzenleme balonu ---------- */
  let pop = null;
  function popKapat() { pop?.remove(); pop = null; }
  function sec(id, odak = false) {
    const onceki = d.secili ? d.model.get(d.secili) : null;
    d.secili = id;
    popKapat();
    if (onceki) sayfaCiz(onceki.sayfa);
    const a = id ? d.model.get(id) : null;
    if (a) { sayfaCiz(a.sayfa); popAc(a, odak); }
    listeCiz();
  }
  function popAc(a, odak) {
    const pv = sayfaGorunumu(a.sayfa);
    const kat = katman(pv);
    if (!pv || !kat) return;
    const b = kutuPx(a, pv.viewport);
    const kr = kat.getBoundingClientRect();
    const govde = q(".ak-ok-govde").getBoundingClientRect();
    pop = el("div", { class: "ak-pop", role: "dialog", "aria-label": "Açıklama" });
    const renkSatir = el("div", { class: "ak-pop-renk" });
    if (!salt) {
      for (const r of RENKLER) {
        const n = el("button", { type: "button", class: `ak-renk${a.renk === r.hex ? " aktif" : ""}`, title: r.ad, "aria-label": r.ad, "data-hex": r.hex });
        n.style.background = r.hex;
        n.addEventListener("click", () => { guncelle(a.id, { renk: r.hex }); popAc(d.model.get(a.id), false); });
        renkSatir.append(n);
      }
    }
    const alan = el("textarea", { class: "ak-pop-metin", rows: a.tur === "metin" ? 4 : 3, placeholder: a.tur === "metin" ? "Metin kutusu içeriği" : "Yorum ekle…", "aria-label": "Yorum" });
    alan.value = a.yorum || "";
    alan.readOnly = salt;
    alan.addEventListener("input", () => { a.yorum = alan.value; if (a.durum === "ayni") a.durum = "degisti"; d.kirli = true; kaydetDurumu(); sayfaCiz(a.sayfa); });
    alan.addEventListener("change", () => { listeCiz(); });
    const eylem = el("div", { class: "ak-pop-eylem" },
      el("button", { type: "button", class: "ak-btn", "data-p": "md" }, "Markdown kopyala"),
      salt ? null : el("button", { type: "button", class: "ak-btn ak-tehlike", "data-p": "sil" }, "Sil"),
      el("button", { type: "button", class: "ak-btn", "data-p": "kapat" }, "Tamam"));
    pop.append(el("div", { class: "ak-pop-baslik" }, `${TUR_ADI[a.tur]} · s. ${a.sayfa}`), renkSatir);
    if (a.metin) pop.append(el("blockquote", { class: "ak-pop-alinti" }, a.metin.length > 400 ? `${a.metin.slice(0, 400)}…` : a.metin));
    pop.append(alan, eylem);
    pop.addEventListener("click", async (ev) => {
      const t = ev.target.closest("[data-p]")?.dataset.p;
      if (t === "sil") sil(a.id);
      else if (t === "kapat") sec(null);
      else if (t === "md") { await panoyaKopyala(alintiMarkdown(a, kaynak)); toast("Markdown alıntısı kopyalandı.", "basari"); }
    });
    q(".ak-ok-govde").append(pop);
    const gen = 280;
    pop.style.width = `${gen}px`;
    pop.style.left = `${Math.max(8, Math.min(govde.width - gen - 8, kr.left + b.x - govde.left))}px`;
    pop.style.top = `${Math.max(8, Math.min(govde.height - 220, kr.top + b.y + b.h + 8 - govde.top))}px`;
    if (odak) alan.focus();
  }

  /* ---------- yan panel ---------- */
  function listeCiz() {
    const liste = q("[data-ak-liste]");
    const ft = q('[data-ak="f-tur"]').value, fr = q('[data-ak="f-renk"]').value;
    const hepsi = [...d.model.values()].sort((a, b) => a.sayfa - b.sayfa || (b.rect?.[3] ?? b.kutular?.[0]?.[3] ?? 0) - (a.rect?.[3] ?? a.kutular?.[0]?.[3] ?? 0));
    q("[data-ak-adet]").textContent = hepsi.length;
    const goster = hepsi.filter((a) => (!ft || a.tur === ft) && (!fr || a.renk === fr));
    if (!goster.length) { liste.innerHTML = `<p class="ak-bos">${hepsi.length ? "Süzgece uyan açıklama yok." : salt ? "Bu PDF'te açıklama yok." : "Henüz açıklama yok. Metin seç → renk balonundan vurgula."}</p>`; return; }
    liste.innerHTML = goster.map((a) => `
      <article class="ak-liste-oge${d.secili === a.id ? " secili" : ""}" data-id="${esc(a.id)}">
        <span class="ak-liste-serit" data-renk="${esc(a.renk)}"></span>
        <div class="ak-liste-ic">
          <div class="ak-liste-ust"><span>${TUR_ADI[a.tur]}</span><span>s. ${a.sayfa}</span></div>
          ${a.metin ? `<blockquote>${esc(a.metin.length > 220 ? a.metin.slice(0, 220) + "…" : a.metin)}</blockquote>` : ""}
          ${a.yorum ? `<p class="ak-liste-yorum">${esc(a.yorum.length > 200 ? a.yorum.slice(0, 200) + "…" : a.yorum)}</p>` : ""}
        </div>
        <button type="button" class="ak-btn ak-liste-md" data-md="${esc(a.id)}" title="Markdown kopyala" aria-label="Markdown kopyala">❝</button>
      </article>`).join("");
    liste.querySelectorAll(".ak-liste-serit").forEach((n) => { n.style.background = n.dataset.renk; });
  }

  /** Dosyadan gelen metin-işaretlemelerin alıntı metnini PDF metin katmanından çıkarır. */
  async function metinDoldur() {
    const eksik = [...d.model.values()].filter((a) => METIN_TURLERI.has(a.tur) && !a.metin);
    if (!eksik.length) { listeCiz(); return; }
    const sayfalar = [...new Set(eksik.map((a) => a.sayfa))];
    for (const no of sayfalar) {
      try {
        const sayfa = await belge.getPage(no);
        const tc = await sayfa.getTextContent();
        for (const a of eksik.filter((x) => x.sayfa === no)) {
          const parcalar = [];
          for (const it of tc.items) {
            if (!it.str || !it.transform) continue;
            const ix1 = it.transform[4], iy1 = it.transform[5], ix2 = ix1 + (it.width || 0), iy2 = iy1 + (it.height || 0);
            const icinde = a.kutular.some((k) => { const ox = Math.min(ix2, k[2]) - Math.max(ix1, k[0]); const oy = Math.min(iy2, k[3]) - Math.max(iy1, k[1]); return ox > (ix2 - ix1) * 0.5 && oy > (iy2 - iy1) * 0.3; });
            if (icinde) parcalar.push(it.str);
          }
          a.metin = parcalar.join(" ").replace(/\s+/g, " ").trim();
        }
      } catch { /* o sayfa atlanır */ }
    }
    listeCiz();
  }

  /* ---------- metin seçiminden açıklama ---------- */
  function secimdenOlustur(tur, renk = d.renk) {
    const s = window.getSelection();
    if (!s || s.isCollapsed || !s.rangeCount) return false;
    const aralik = s.getRangeAt(0);
    let olustu = 0;
    kap.querySelectorAll(".page").forEach((sayfaDiv) => {
      const tl = sayfaDiv.querySelector(".textLayer");
      if (!tl || !aralik.intersectsNode(tl)) return;
      const r = document.createRange();
      r.selectNodeContents(tl);
      if (aralik.compareBoundaryPoints(Range.START_TO_START, r) > 0) r.setStart(aralik.startContainer, aralik.startOffset);
      if (aralik.compareBoundaryPoints(Range.END_TO_END, r) < 0) r.setEnd(aralik.endContainer, aralik.endOffset);
      const metin = aralikMetni(r);
      if (!metin) return;
      const no = Number(sayfaDiv.dataset.pageNumber);
      const pv = sayfaGorunumu(no);
      const kat = katman(pv);
      if (!pv || !kat) return;
      const kutular = kutulariBirlestir([...r.getClientRects()].map((c) => istemciRectPdf(pv, kat, c.left, c.top, c.right, c.bottom)));
      if (!kutular.length) return;
      ekleModel({ tur, sayfa: no, kutular, renk, metin });
      olustu++;
    });
    if (olustu) s.removeAllRanges();
    balonGizle();
    return olustu > 0;
  }

  /* seçim balonu (imleç modunda metin seçilince çıkar) */
  let balon = null;
  function balonGizle() { balon?.remove(); balon = null; }
  function balonGoster() {
    balonGizle();
    if (salt) return;
    const s = window.getSelection();
    if (!s || s.isCollapsed || !s.rangeCount || !kap.contains(s.anchorNode)) return;
    const rs = s.getRangeAt(0).getClientRects();
    if (!rs.length) return;
    const son = rs[rs.length - 1];
    const govde = q(".ak-ok-govde").getBoundingClientRect();
    balon = el("div", { class: "ak-balon", role: "toolbar", "aria-label": "Seçim araçları" });
    for (const r of RENKLER) {
      const n = el("button", { type: "button", class: "ak-renk", title: `${r.ad} vurgu`, "aria-label": `${r.ad} vurgu`, "data-hex": r.hex });
      n.style.background = r.hex;
      balon.append(n);
    }
    balon.append(el("button", { type: "button", class: "ak-btn", "data-b": "altcizgi", title: "Altını çiz" }, "U̲"), el("button", { type: "button", class: "ak-btn", "data-b": "ustcizgi", title: "Üstünü çiz" }, "S̶"), el("button", { type: "button", class: "ak-btn", "data-b": "yorum", title: "Vurgula ve yorum ekle" }, "💬"), el("button", { type: "button", class: "ak-btn", "data-b": "kopya", title: "Seçili metni kopyala" }, "⧉"));
    balon.addEventListener("mousedown", (e) => e.preventDefault()); // seçim bozulmasın
    balon.addEventListener("click", async (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.hex) { d.renk = b.dataset.hex; renkleriCiz(); secimdenOlustur("vurgu", b.dataset.hex); }
      else if (b.dataset.b === "altcizgi" || b.dataset.b === "ustcizgi") secimdenOlustur(b.dataset.b);
      else if (b.dataset.b === "yorum") { const n0 = d.model.size; if (secimdenOlustur("vurgu")) { const yeni = [...d.model.values()].slice(-1)[0]; if (d.model.size > n0) sec(yeni.id, true); } }
      else if (b.dataset.b === "kopya") { await panoyaKopyala(aralikMetni(window.getSelection().getRangeAt(0))); toast("Seçili metin kopyalandı.", "basari"); balonGizle(); }
    });
    q(".ak-ok-govde").append(balon);
    balon.style.left = `${Math.max(8, Math.min(govde.width - 330, son.right - govde.left - 20))}px`;
    balon.style.top = `${Math.min(govde.height - 50, son.bottom - govde.top + 8)}px`;
  }

  /* ---------- araç / renk durumu ---------- */
  function aracSec(id) {
    d.arac = id;
    kok.classList.toggle("ak-cizim-modu", CIZIM_ARACLARI.has(id));
    kok.classList.toggle("ak-metin-modu", METIN_TURLERI.has(id));
    kok.querySelectorAll("[data-ak-arac]").forEach((b) => b.classList.toggle("aktif", b.dataset.akArac === id));
    sec(null);
    balonGizle();
    // metin işaretleme aracı açıkken mevcut seçim varsa hemen uygula
    if (METIN_TURLERI.has(id)) secimdenOlustur(id);
  }
  function renkleriCiz() {
    const k = q("[data-ak-renkler]");
    if (!k) return;
    k.textContent = "";
    for (const r of RENKLER) {
      const n = el("button", { type: "button", class: `ak-renk${d.renk === r.hex ? " aktif" : ""}`, title: r.ad, "aria-label": r.ad, "data-hex": r.hex });
      n.style.background = r.hex;
      k.append(n);
    }
  }
  renkleriCiz();

  /* ---------- fare / dokunma etkileşimi ---------- */
  let cizim = null; // {tur, sayfaDiv, pv, noktalar|baslangic}
  function canliKaldir() { d.canli?.remove(); d.canli = null; }
  function canliSvg(pv) { const kat = katman(pv); return kat?.querySelector(".ak-svg"); }

  kap.addEventListener("pointerdown", (e) => {
    if (salt || !CIZIM_ARACLARI.has(d.arac) || e.button !== 0) return;
    if (e.target.closest(".ak-pop, .ak-balon")) return;
    const sayfaDiv = e.target.closest(".page");
    if (!sayfaDiv) return;
    const p = olayNoktasi(e, sayfaDiv);
    if (!p) return;
    e.preventDefault();
    kap.setPointerCapture?.(e.pointerId);
    sec(null);
    cizim = { tur: d.arac, sayfaDiv, pv: p.pv, noktalar: [p.x, p.y], bas: p, son: p };
  });
  kap.addEventListener("pointermove", (e) => {
    if (!cizim) return;
    const p = olayNoktasi(e, cizim.sayfaDiv);
    if (!p) return;
    const svg = canliSvg(cizim.pv);
    if (!svg) return;
    const olcek = cizim.pv.viewport.scale;
    canliKaldir();
    if (cizim.tur === "cizim") {
      const son = cizim.noktalar;
      if (Math.hypot(p.x - son[son.length - 2], p.y - son[son.length - 1]) >= 0.4) son.push(p.x, p.y);
      let dd = "";
      for (let i = 0; i + 1 < son.length; i += 2) { const [x, y] = cizim.pv.viewport.convertToViewportPoint(son[i], son[i + 1]); dd += `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)} `; }
      d.canli = svgEl("path", { d: dd, fill: "none", stroke: d.renk, "stroke-width": d.kalinlik * olcek, "stroke-linecap": "round", "stroke-linejoin": "round", class: "ak-canli" });
    } else {
      const x = Math.min(cizim.bas.vx, p.vx), y = Math.min(cizim.bas.vy, p.vy);
      d.canli = svgEl("rect", { x, y, width: Math.abs(p.vx - cizim.bas.vx), height: Math.abs(p.vy - cizim.bas.vy), fill: cizim.tur === "sekil" ? "none" : "rgba(0,0,0,0.04)", stroke: cizim.tur === "yapiskan" ? "none" : d.renk, "stroke-width": cizim.tur === "sekil" ? d.kalinlik * olcek : 1, "stroke-dasharray": cizim.tur === "metin" ? "4 3" : "0", class: "ak-canli" });
    }
    cizim.son = p;
    svg.append(d.canli);
  });
  const cizimBitir = (e) => {
    if (!cizim) return;
    const c = cizim;
    cizim = null;
    canliKaldir();
    const p = olayNoktasi(e, c.sayfaDiv) || c.son;
    const no = Number(c.sayfaDiv.dataset.pageNumber);
    const olcek = c.pv.viewport.scale;
    if (c.tur === "cizim") {
      let n = c.noktalar;
      if (n.length < 4) n = [n[0], n[1], n[0], n[1]];
      const yeni = ekleModel({ tur: "cizim", sayfa: no, cizgiler: [sadelestir(n, 0.35)], renk: d.renk, kalinlik: d.kalinlik });
      void yeni;
    } else if (c.tur === "sekil") {
      const r = [Math.min(c.bas.x, p.x), Math.min(c.bas.y, p.y), Math.max(c.bas.x, p.x), Math.max(c.bas.y, p.y)];
      if (r[2] - r[0] < 3 || r[3] - r[1] < 3) return;
      ekleModel({ tur: "sekil", sayfa: no, rect: r, renk: d.renk, kalinlik: d.kalinlik });
    } else if (c.tur === "yapiskan") {
      const N = NOT_BOYUTU;
      const a = ekleModel({ tur: "yapiskan", sayfa: no, rect: [c.bas.x, c.bas.y - N, c.bas.x + N, c.bas.y], renk: d.renk });
      sec(a.id, true);
    } else if (c.tur === "metin") {
      let r = [Math.min(c.bas.x, p.x), Math.min(c.bas.y, p.y), Math.max(c.bas.x, p.x), Math.max(c.bas.y, p.y)];
      if (r[2] - r[0] < 24 || r[3] - r[1] < 14) r = [c.bas.x, c.bas.y - 60, c.bas.x + 180, c.bas.y];
      const a = ekleModel({ tur: "metin", sayfa: no, rect: r, renk: "#000000", yaziPt: 12, yorum: "" });
      void olcek;
      sec(a.id, true);
    }
  };
  kap.addEventListener("pointerup", cizimBitir);
  kap.addEventListener("pointercancel", () => { cizim = null; canliKaldir(); });

  // Metin seçimi bittiğinde: işaretleme aracı açıksa uygula, değilse balonu göster
  kap.addEventListener("mouseup", (e) => {
    if (salt || CIZIM_ARACLARI.has(d.arac) || e.target.closest(".ak-balon")) return;
    setTimeout(() => {
      const s = window.getSelection();
      if (s && !s.isCollapsed) {
        if (METIN_TURLERI.has(d.arac)) secimdenOlustur(d.arac);
        else balonGoster();
      }
    }, 0);
  });
  // Seçili açıklamayı tıkla-seç (imleç modunda)
  kap.addEventListener("click", (e) => {
    if (CIZIM_ARACLARI.has(d.arac) && !salt) return;
    if (e.target.closest(".ak-pop, .ak-balon, .ak-link")) return;
    const s = window.getSelection();
    if (s && !s.isCollapsed) return;
    balonGizle();
    const sayfaDiv = e.target.closest(".page");
    if (!sayfaDiv) { sec(null); return; }
    const p = olayNoktasi(e, sayfaDiv);
    if (!p) return;
    const no = Number(sayfaDiv.dataset.pageNumber);
    const tol = 6 / p.pv.viewport.scale;
    const adaylar = [...d.model.values()].filter((a) => a.sayfa === no).reverse();
    const bulundu = adaylar.find((a) => {
      if (a.kutular) return a.kutular.some((k) => noktaIcinde(p.x, p.y, k, tol));
      if (a.cizgiler) return a.cizgiler.some((c) => { for (let i = 0; i + 3 < c.length; i += 2) if (parcayaUzaklik(p.x, p.y, c[i], c[i + 1], c[i + 2], c[i + 3]) <= tol + (a.kalinlik || 1.5) / 2) return true; return c.length === 4 && Math.hypot(p.x - c[0], p.y - c[1]) <= tol; });
      if (a.tur === "sekil") return noktaIcinde(p.x, p.y, a.rect, tol) && !noktaIcinde(p.x, p.y, [a.rect[0] + tol * 1.5, a.rect[1] + tol * 1.5, a.rect[2] - tol * 1.5, a.rect[3] - tol * 1.5]);
      return noktaIcinde(p.x, p.y, a.rect, tol);
    });
    sec(bulundu ? bulundu.id : null);
  });
  document.addEventListener("selectionchange", () => { if (!window.getSelection()?.isCollapsed) return; balonGizle(); });

  /* ---------- üst çubuk / yan panel olayları ---------- */
  kok.addEventListener("click", async (e) => {
    const ar = e.target.closest("[data-ak-arac]");
    if (ar) { aracSec(ar.dataset.akArac); return; }
    const rn = e.target.closest("[data-ak-renkler] .ak-renk");
    if (rn) { d.renk = rn.dataset.hex; renkleriCiz(); if (d.secili && !salt) guncelle(d.secili, { renk: d.renk }); return; }
    const md = e.target.closest("[data-md]");
    if (md) { const a = d.model.get(md.dataset.md); if (a) { await panoyaKopyala(alintiMarkdown(a, kaynak)); toast("Markdown alıntısı kopyalandı.", "basari"); } return; }
    const oge = e.target.closest(".ak-liste-oge");
    if (oge) {
      const a = d.model.get(oge.dataset.id);
      if (a) { viewer.currentPageNumber = a.sayfa; setTimeout(() => sec(a.id), 250); }
      return;
    }
    const i = e.target.closest("[data-ak]")?.dataset.ak;
    if (i === "kapat") kapat();
    else if (i === "yan") kok.classList.toggle("yan-kapali");
    else if (i === "tam") tamEkran();
    else if (i === "yaklas") viewer.increaseScale();
    else if (i === "uzaklas") viewer.decreaseScale();
    else if (i === "kaydet") kaydet();
    else if (i === "indir") dosyaIndir(`${(kaynak.pdf_dosya_adi || kaynak.baslik || "belge").replace(/\.pdf$/i, "")}.pdf`, new Blob([d.bytes], { type: "application/pdf" }));
    else if (i === "onceki") oncekiSurum();
    else if (i === "md-tumu") tumunuKopyala();
  });
  kok.addEventListener("change", (e) => {
    const i = e.target.dataset?.ak;
    if (i === "olcek") viewer.currentScaleValue = e.target.value;
    else if (i === "sayfa") viewer.currentPageNumber = Math.max(1, Math.min(belge.numPages, Number(e.target.value) || 1));
    else if (i === "kalinlik") d.kalinlik = Number(e.target.value);
    else if (i === "f-tur" || i === "f-renk") listeCiz();
  });
  const ara = (tip = "", geri = false) => eventBus.dispatch("find", { source: kok, type: tip, query: q('[data-ak="ara"]').value, caseSensitive: false, entireWord: false, highlightAll: true, findPrevious: geri, matchDiacritics: true });
  q('[data-ak="ara"]').addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); ara(d.sonAranan === q('[data-ak="ara"]').value ? "again" : "", e.shiftKey); d.sonAranan = q('[data-ak="ara"]').value; } });
  q('[data-ak="ara"]').addEventListener("input", (e) => { if (!e.target.value) { ara(""); q("[data-ak-bul]").textContent = ""; } });

  function tumunuKopyala() {
    const ft = q('[data-ak="f-tur"]').value, fr = q('[data-ak="f-renk"]').value;
    const parca = [...d.model.values()].filter((a) => (a.metin || a.yorum) && (!ft || a.tur === ft) && (!fr || a.renk === fr)).sort((a, b) => a.sayfa - b.sayfa).map((a) => alintiMarkdown(a, kaynak));
    if (!parca.length) { toast("Kopyalanacak metin ya da yorum yok.", "uyari"); return; }
    panoyaKopyala(parca.join("\n\n")).then(() => toast(`${parca.length} alıntı Markdown olarak kopyalandı.`, "basari"));
  }

  function tamEkran() {
    const acik = kok.classList.toggle("ak-tam");
    if (acik) kok.requestFullscreen?.().catch(() => {});
    else if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  }
  document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement) kok.classList.remove("ak-tam"); });

  /* ---------- klavye ---------- */
  const tus = (e) => {
    if (!document.body.contains(kok)) return;
    const yaziyor = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); kaydet(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !yaziyor && !salt) { e.preventDefault(); geriAl(); }
    else if (e.key === "Escape") { if (d.secili) sec(null); else if (d.arac !== "gez") aracSec("gez"); else if (!document.fullscreenElement) kapat(); }
    else if ((e.key === "Delete" || e.key === "Backspace") && d.secili && !yaziyor && !salt) { e.preventDefault(); sil(d.secili); }
  };
  document.addEventListener("keydown", tus);
  const oncesi = (e) => { if (d.kirli) { e.preventDefault(); e.returnValue = ""; } };
  window.addEventListener("beforeunload", oncesi);

  /* ---------- kaydet ---------- */
  async function kaydet() {
    if (salt) return;
    if (!d.kirli) { toast("Kaydedilecek değişiklik yok.", "bilgi"); return; }
    if (d.kaydediliyor) return;
    d.kaydediliyor = true;
    const btn = q('[data-ak="kaydet"]');
    btn.disabled = true;
    try {
      durumYaz("Kaydediliyor: PDF'e işleniyor…");
      const pdflib = await pdfLibAl();
      const aktif = [...d.model.values()];
      const degisenler = aktif.filter((a) => a.durum !== "ayni");
      const silinenler = d.silinenler.map(({ nm, ref, sayfa }) => ({ nm, ref, sayfa }));
      let pdfeGomuldu = false;
      let pdfDoc = null;
      if (!d.sifreli) { try { pdfDoc = await pdflib.PDFDocument.load(d.bytes, { updateMetadata: false, throwOnInvalidObject: false }); } catch { pdfDoc = null; } }
      if (pdfDoc) {
        const yeniBayt = await uygula(pdflib, pdfDoc, { degisenler, silinenler, yazar: d.kullaniciAdi });
        durumYaz(`Kaydediliyor: R2'ye yazılıyor (${baytYazi(yeniBayt.byteLength)})…`);
        const sonuc = await pdfYukle(kaynak.id, yeniBayt, { beklenenRev: d.rev, ilerleme: (o) => durumYaz(`R2'ye yazılıyor… %${Math.round(o * 100)}`) });
        d.bytes = yeniBayt;
        d.rev = sonuc.rev ?? d.rev + 1;
        kaynak.pdf_rev = d.rev;
        kaynak.pdf_boyut_bayt = sonuc.boyut ?? yeniBayt.byteLength;
        pdfeGomuldu = true;
      }
      durumYaz("Kaydediliyor: özet veritabanına işleniyor…");
      const ozet = aktif.map((a) => {
        const konum = {};
        for (const k of ["kutular", "cizgiler", "rect", "kalinlik", "yaziPt"]) if (a[k] !== undefined) konum[k] = a[k];
        return { ek_id: a.nm || `ae-${a.id}`, tur: a.tur, sayfa: a.sayfa, metin: a.metin || null, yorum: a.yorum || null, renk: a.renk, konum };
      });
      const { error } = await supabase.rpc("akademik_aciklamalari_esitle", { p_kaynak_id: kaynak.id, p_aciklamalar: ozet });
      if (error) throw new Error(`Özet kaydedilemedi: ${error.message}`);
      for (const a of aktif) { a.durum = "ayni"; a.nm = a.nm || `ae-${a.id}`; }
      d.silinenler = [];
      d.kirli = false;
      kaydetDurumu();
      durumYaz(pdfeGomuldu ? "Kaydedildi: açıklamalar PDF'e gömüldü ve R2'ye yazıldı." : "Kaydedildi (yalnızca veritabanına; PDF şifreli/bozuk olduğundan dosyaya gömülemedi).", pdfeGomuldu ? "basari" : "uyari");
      toast(pdfeGomuldu ? "Açıklamalar PDF'e kaydedildi." : "Açıklamalar veritabanına kaydedildi.", pdfeGomuldu ? "basari" : "uyari");
    } catch (h) {
      console.error(h);
      durumYaz(`Kaydedilemedi: ${h.message || h}`, "hata");
      toast(`Kaydedilemedi: ${h.message || h}`, "hata", 8000);
    } finally {
      d.kaydediliyor = false;
      btn.disabled = false;
    }
  }

  async function oncekiSurum() {
    if (!confirm("PDF, son kaydetmeden ÖNCEKİ sürüme döndürülsün mü? Şu anki sürüm kaybolur ve okuyucu yeniden açılır.")) return;
    try {
      await workerJson(`/pdf/${kaynak.id}/onceki-surum`, { method: "POST" });
      toast("Önceki sürüme dönüldü. Okuyucu yeniden açılıyor…", "basari");
      d.kirli = false;
      kapat(true);
      okuyucuAc({ kaynak: { ...kaynak, pdf_rev: d.rev + 1 }, salt, kullaniciAdi, kapaninca });
    } catch (h) { toast(h.message, "hata"); }
  }

  /* ---------- kapat ---------- */
  function kapat(zorla = false) {
    if (!zorla && d.kirli && !confirm("Kaydedilmemiş değişiklikler var. Kaydetmeden kapatılsın mı?")) return;
    document.removeEventListener("keydown", tus);
    window.removeEventListener("beforeunload", oncesi);
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    try { viewer.setDocument(null); belge?.destroy(); } catch { /* */ }
    popKapat(); balonGizle();
    kok.remove();
    document.body.classList.remove("ak-okuyucu-acik");
    kapaninca?.();
  }

  listeCiz();
  kaydetDurumu();
  return { kapat };
}

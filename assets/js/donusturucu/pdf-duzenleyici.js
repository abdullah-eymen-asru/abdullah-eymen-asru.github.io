/*
 * assets/js/donusturucu/pdf-duzenleyici.js — Tarayıcı içi PDF düzenleyici (PDF.js ile gösterim, pdf-lib ile kayıt).
 * -----------------------------------------------------------------------
 *  Sayfa yönetimi : sil, yeniden sırala (sürükle-bırak + ↑/↓ düğmeleri: dokunmatik uyumlu), 90° döndür, çoğalt,
 *                   başka PDF/görsel ekleyerek BİRLEŞTİR, boş sayfa ekle.
 *  Açıklama       : metin vurgulama / altını çizme / üstünü çizme (gerçek metin seçimiyle), serbest çizim, metin kutusu,
 *                   çizilmiş imza, silgi, seç-taşı-boyutlandır-sil.  Geri al / yinele.
 *  Kayıt          : sayfalar pdf-lib ile yeni belgeye KOPYALANIR (vektör içerik korunur); açıklamalar her sayfada tek
 *                   saydam PNG katmanı olarak "düzleştirilir" (Unicode/Türkçe metin kutuları için güvenli; dışa aktarılan
 *                   metin kutuları seçilebilir metin değil görüntüdür). Form alanları ve yer imleri korunmaz.
 *  Koordinatlar   : açıklamalar "gösterim çerçevesinde" PUNTO (1/72 in) cinsinden saklanır; sayfa döndürülünce birlikte döner.
 *  Gizlilik       : her şey bellekte; hiçbir bayt ağa gitmez.
 * -----------------------------------------------------------------------
 */
import { el, dugme, bos, formIste, baytlariOku, nefes, IOS_MU, adsizAl } from "./ortak.js";
import { pdfjsAl, pdfLibAl } from "./pdf-yukle.js";
import { gorsellerdenPdf } from "./motor-gorsel.js";

const RENKLER = ["#ffeb3b", "#8bc34a", "#4fc3f7", "#f48fb1", "#ff9800", "#e53935", "#1e40af", "#111111"];
const MAKS_PIKSEL = () => (IOS_MU() ? 12_000_000 : 40_000_000);

const hexRgb = (h) => { const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(h) || [0, "11", "11", "11"]; return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)]; };
const rgba = (h, a) => { const [r, g, b] = hexRgb(h); return `rgba(${r},${g},${b},${a})`; };
const kopya = (x) => (typeof structuredClone === "function" ? structuredClone(x) : JSON.parse(JSON.stringify(x)));

let anotSayaci = 1;
const gorselOnbellek = new Map();
function gorselAl(url, tekrarCiz) {
  let g = gorselOnbellek.get(url);
  if (!g) { g = new Image(); g.onload = () => tekrarCiz?.(); g.src = url; gorselOnbellek.set(url, g); }
  return g.complete && g.naturalWidth ? g : null;
}

/* ------------------------------ açıklama çizimi (ekran + dışa aktarma ortak) ------------------------------ */

const olcCtx = (() => { const c = document.createElement("canvas"); return c.getContext("2d"); })();

export function metinSatirlari(metin, w, boyut) {
  olcCtx.font = `${boyut}px "Helvetica Neue", Arial, "Segoe UI", sans-serif`;
  const satirlar = [];
  for (const parag of String(metin).split("\n")) {
    let satir = "";
    for (const kelime of parag.split(/(\s+)/)) {
      const dene = satir + kelime;
      if (olcCtx.measureText(dene).width > w && satir.trim()) { satirlar.push(satir.trimEnd()); satir = kelime.trimStart(); } else satir = dene;
    }
    satirlar.push(satir);
  }
  return satirlar;
}

export function anotKutusu(a) {
  switch (a.t) {
    case "vurgu": case "alt": case "ust": {
      const x1 = Math.min(...a.rects.map((r) => r.x)); const y1 = Math.min(...a.rects.map((r) => r.y));
      const x2 = Math.max(...a.rects.map((r) => r.x + r.w)); const y2 = Math.max(...a.rects.map((r) => r.y + r.h));
      return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    }
    case "cizim": {
      const xs = a.pts.map((p) => p.x); const ys = a.pts.map((p) => p.y);
      const k = a.kal / 2;
      return { x: Math.min(...xs) - k, y: Math.min(...ys) - k, w: Math.max(...xs) - Math.min(...xs) + a.kal, h: Math.max(...ys) - Math.min(...ys) + a.kal };
    }
    case "metin": {
      const n = metinSatirlari(a.metin, a.w, a.boyut).length;
      return { x: a.x, y: a.y, w: a.w, h: n * a.boyut * 1.25 + 4 };
    }
    default: return { x: a.x, y: a.y, w: a.w, h: a.h };
  }
}

export function anotCiz(ctx, a, tekrarCiz) {
  ctx.save();
  switch (a.t) {
    case "vurgu":
      ctx.fillStyle = rgba(a.renk, 0.4);
      for (const r of a.rects) ctx.fillRect(r.x, r.y, r.w, r.h);
      break;
    case "alt": case "ust":
      ctx.strokeStyle = a.renk;
      for (const r of a.rects) {
        ctx.lineWidth = Math.max(0.8, r.h * 0.07);
        const yy = a.t === "alt" ? r.y + r.h * 0.92 : r.y + r.h * 0.55;
        ctx.beginPath(); ctx.moveTo(r.x, yy); ctx.lineTo(r.x + r.w, yy); ctx.stroke();
      }
      break;
    case "cizim": {
      ctx.strokeStyle = a.renk; ctx.lineWidth = a.kal; ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.beginPath();
      const p = a.pts;
      if (p.length === 1) { ctx.fillStyle = a.renk; ctx.arc(p[0].x, p[0].y, a.kal / 2, 0, Math.PI * 2); ctx.fill(); break; }
      ctx.moveTo(p[0].x, p[0].y);
      for (let i = 1; i < p.length - 1; i++) { const mx = (p[i].x + p[i + 1].x) / 2; const my = (p[i].y + p[i + 1].y) / 2; ctx.quadraticCurveTo(p[i].x, p[i].y, mx, my); }
      ctx.lineTo(p[p.length - 1].x, p[p.length - 1].y);
      ctx.stroke();
      break;
    }
    case "metin": {
      ctx.fillStyle = a.renk; ctx.textBaseline = "top";
      ctx.font = `${a.boyut}px "Helvetica Neue", Arial, "Segoe UI", sans-serif`;
      metinSatirlari(a.metin, a.w, a.boyut).forEach((s, i) => ctx.fillText(s, a.x, a.y + 2 + i * a.boyut * 1.25));
      break;
    }
    case "imza": {
      const g = gorselAl(a.url, tekrarCiz);
      if (g) ctx.drawImage(g, a.x, a.y, a.w, a.h);
      break;
    }
    default: break;
  }
  ctx.restore();
}

/** Koordinat dönüşümü: 90° saat yönü (gösterim çerçevesi → yeni gösterim çerçevesi). Hd = eski gösterim yüksekliği. */
function don90(a, Hd) {
  const nok = (x, y) => ({ x: Hd - y, y: x });
  const dik = (r) => ({ x: Hd - (r.y + r.h), y: r.x, w: r.h, h: r.w });
  switch (a.t) {
    case "vurgu": case "alt": case "ust": return { ...a, rects: a.rects.map(dik) };
    case "cizim": return { ...a, pts: a.pts.map((p) => nok(p.x, p.y)) };
    case "metin": { const k = anotKutusu(a); const d = dik(k); return { ...a, x: d.x, y: d.y, w: Math.max(40, d.w) }; }
    default: { const d = dik({ x: a.x, y: a.y, w: a.w, h: a.h }); return { ...a, ...d }; }
  }
}

/* ------------------------------ düzenleyici ------------------------------ */

/**
 * @param {HTMLElement} kap
 * @param {{dosyalar: File[], onDegisim?:()=>void, parola?:Function, mesaj?:(m:string,t?:string)=>void}} s
 */
export async function pdfDuzenleyiciKur(kap, { dosyalar, onDegisim, mesaj = () => {} }) {
  const pdfjs = await pdfjsAl();
  const kaynaklar = new Map(); // id → {id, ad, bayt, pdf}
  let sayfalar = []; // {id, kaynakId, idx, ek, anot[]}
  let aktif = 0;
  let arac = "sec";
  let renk = RENKLER[0];
  let kalinlik = 2.5;
  let zoom = 1;
  let sigDurum = "sigdir"; // sigdir | serbest
  let secili = null; // anot id
  let imza = null; // son çizilen imza {url,w,h}
  let kirli = false;
  let gecmis = [];
  let gecmisIdx = -1;
  let sayfaSayaci = 1;
  let kaynakSayaci = 1;
  let renderKimlik = 0;
  let renderGorevi = null;
  let metinKatmani = null;
  let yokEdildi = false;
  const kucukler = new Map(); // sayfa id → canvas
  let kucukGozlemci = null;

  /* ---- kaynak yükleme ---- */
  async function pdfYukle(bayt, ad) {
    const gorev = pdfjs.getDocument({ data: bayt.slice(0) });
    let sifreli = false;
    gorev.onPassword = () => { sifreli = true; gorev.destroy(); };
    let pdf;
    try { pdf = await gorev.promise; } catch (h) {
      if (sifreli || h?.name === "PasswordException") throw new Error(`${ad}: parola korumalı PDF'ler düzenlenemez. Önce parolasını kaldır (ya da dönüştürme sekmesini kullan).`);
      throw new Error(`${ad}: PDF okunamadı (${h?.message || h}).`);
    }
    const id = kaynakSayaci++;
    kaynaklar.set(id, { id, ad, bayt, pdf });
    return id;
  }

  async function dosyaEkle(dosya, sonaMi = true) {
    const bayt = new Uint8Array(await baytlariOku(dosya));
    let pdfBayt = bayt;
    let ad = dosya.name || "belge";
    if (!(bayt[0] === 0x25 && bayt[1] === 0x50)) { // %P → PDF değil: görsel olarak dene
      const blob = await gorsellerdenPdf([{ blob: dosya, ad }], { sayfaBoyutu: "gorsel" });
      pdfBayt = new Uint8Array(await blob.arrayBuffer());
    }
    const kid = await pdfYukle(pdfBayt, ad);
    const n = kaynaklar.get(kid).pdf.numPages;
    const yeni = Array.from({ length: n }, (_, i) => ({ id: sayfaSayaci++, kaynakId: kid, idx: i, ek: 0, anot: [] }));
    if (sonaMi) sayfalar.push(...yeni); else sayfalar.splice(aktif + 1, 0, ...yeni);
    return yeni[0];
  }

  /* ---- geçmiş ---- */
  const anlik = () => kopya(sayfalar.map((s) => ({ ...s })));
  function kaydet() {
    gecmis.splice(gecmisIdx + 1);
    gecmis.push({ sayfalar: anlik(), aktif });
    if (gecmis.length > 60) gecmis.shift();
    gecmisIdx = gecmis.length - 1;
    kirli = true;
    onDegisim?.();
    cubukGuncelle();
  }
  async function gecmiseGit(yon) {
    const y = gecmisIdx + yon;
    if (y < 0 || y >= gecmis.length) return;
    gecmisIdx = y;
    sayfalar = kopya(gecmis[y].sayfalar);
    aktif = Math.min(gecmis[y].aktif, sayfalar.length - 1);
    secili = null;
    kirli = true;
    onDegisim?.();
    await kucuklerYenile();
    await sayfaGoster();
  }

  /* ---- yardımcılar ---- */
  const sf = () => sayfalar[aktif];
  async function pdfSayfa(s) { return kaynaklar.get(s.kaynakId).pdf.getPage(s.idx + 1); }
  async function olcu(s) {
    const p = await pdfSayfa(s);
    const T = (((p.rotate || 0) + s.ek) % 360 + 360) % 360;
    const vp = p.getViewport({ scale: 1, rotation: T });
    return { p, T, W: vp.width, H: vp.height };
  }

  /* ---- DOM ---- */
  const sahne = el("div", { class: "dn-pdf-sahne", tabindex: "0", "aria-label": "PDF sayfa görünümü" });
  const kutu = el("div", { class: "dn-pdf-sayfa" });
  const tuval = el("canvas", { class: "dn-pdf-tuval", "aria-hidden": "true" });
  const katman = el("canvas", { class: "dn-pdf-katman", "aria-label": "Açıklama katmanı" });
  const metinDiv = el("div", { class: "textLayer dn-pdf-metin" });
  kutu.append(tuval, metinDiv, katman);
  sahne.append(kutu);
  const kucukListe = el("div", { class: "dn-pdf-kucukler", role: "listbox", "aria-label": "Sayfalar" });
  const kenar = el("aside", { class: "dn-pdf-kenar" }, kucukListe);
  const sayfaBilgi = el("span", { class: "dn-pdf-sayfa-bilgi", role: "status", "aria-live": "polite" });
  const ozet = el("div", { class: "dn-pdf-ozet", hidden: true });
  const dosyaGirdi = el("input", { type: "file", accept: "application/pdf,.pdf,image/png,image/jpeg,image/webp", multiple: true, hidden: true });

  const dugmeler = {};
  const D = (id, ikon, metin, baslik, eylem, ekstra = {}) => {
    const d = dugme({ ikon, metin, kucuk: true, tur: "hayalet", title: baslik, "aria-label": baslik, ...ekstra });
    d.addEventListener("click", eylem);
    dugmeler[id] = d;
    return d;
  };
  const grup = (ad, ...c) => el("div", { class: "dn-arac-grup", role: "group", "aria-label": ad }, ...c);

  const aracDugmeleri = {};
  const ARACLAR = [["sec", "↖", "Seç", "Seç / taşı"], ["vurgu", "🖍", "Vurgu", "Metni vurgula"], ["alt", "U̲", "Altı", "Altını çiz"], ["ust", "S̶", "Üstü", "Üstünü çiz"], ["cizim", "✎", "Çiz", "Serbest çizim"], ["metin", "T", "Metin", "Metin kutusu ekle"], ["imza", "✍", "İmza", "İmza ekle"], ["sil", "⌫", "Silgi", "Açıklamayı sil"]];
  const aracGrubu = grup("Araçlar", ...ARACLAR.map(([k, ikon, m, b]) => {
    const d = dugme({ ikon, metin: m, kucuk: true, tur: "hayalet", title: b, "aria-label": b, "aria-pressed": String(k === arac) });
    d.addEventListener("click", () => aracSec(k));
    aracDugmeleri[k] = d;
    return d;
  }));

  const renkGrubu = grup("Renk", ...RENKLER.map((r) => {
    const d = el("button", { type: "button", class: "dn-renk", "aria-label": `Renk ${r}`, title: r, "data-renk": r });
    d.style.background = r;
    d.addEventListener("click", () => { renk = r; renkGuncelle(); if (secili) seciliOzellik({ renk }); });
    return d;
  }));
  const renkGirdi = el("input", { type: "color", class: "dn-renk-girdi", "aria-label": "Özel renk", value: renk });
  renkGirdi.addEventListener("input", () => { renk = renkGirdi.value; renkGuncelle(); if (secili) seciliOzellik({ renk }); });
  renkGrubu.append(renkGirdi);
  const kalinlikSecici = el("select", { class: "dn-select dn-select--kucuk", "aria-label": "Çizgi kalınlığı" },
    ...[[1.5, "İnce"], [2.5, "Orta"], [5, "Kalın"], [9, "Çok kalın"]].map(([v, e]) => el("option", { value: v, text: e, selected: v === 2.5 ? true : null })));
  kalinlikSecici.addEventListener("change", () => { kalinlik = Number(kalinlikSecici.value); });

  const uygulaDugme = D("uygula", "✓", "Seçimi uygula", "Seçili metne uygula", () => secimiUygula(), { hidden: true, class: "dn-btn--vurgulu" });

  const cubuk = el("div", { class: "dn-arac-cubugu dn-pdf-cubuk", role: "toolbar", "aria-label": "PDF araçları" },
    grup("Gezinti",
      D("panel", "▤", "Sayfalar", "Sayfa panelini aç/kapat", () => kap.firstElementChild.classList.toggle("dn-pdf--panel-acik")),
      D("onceki", "‹", "", "Önceki sayfa", () => sayfaGit(aktif - 1)), sayfaBilgi, D("sonraki", "›", "", "Sonraki sayfa", () => sayfaGit(aktif + 1))),
    aracGrubu, renkGrubu, grup("Kalınlık", kalinlikSecici), uygulaDugme,
    grup("Görünüm", D("uzak", "−", "", "Uzaklaştır", () => yakinlik(1 / 1.2)), D("yakin", "+", "", "Yakınlaştır", () => yakinlik(1.2)), D("sigdir", "⤢", "", "Genişliğe sığdır", () => sigdir())),
    grup("Geçmiş", D("geri", "↶", "", "Geri al", () => gecmiseGit(-1)), D("ileri", "↷", "", "Yinele", () => gecmiseGit(1))),
    grup("Sayfa işlemleri",
      D("don-sol", "↺", "", "Sayfayı sola döndür", () => dondur(-90)), D("don-sag", "↻", "", "Sayfayı sağa döndür", () => dondur(90)),
      D("yukari", "↑", "", "Sayfayı öne taşı", () => tasi(-1)), D("asagi", "↓", "", "Sayfayı arkaya taşı", () => tasi(1)),
      D("cogalt", "⧉", "", "Sayfayı çoğalt", () => cogalt()), D("sayfa-sil", "🗑", "", "Sayfayı sil", () => sayfaSil()),
      D("ekle", "＋", "PDF/Görsel ekle", "Başka PDF ya da görsel ekle (birleştir)", () => dosyaGirdi.click()), D("bos", "▢", "", "Boş sayfa ekle", () => bosSayfa())),
    dosyaGirdi);

  const alan = el("div", { class: "dn-pdf-alan" }, kenar, el("div", { class: "dn-pdf-orta" }, ozet, sahne));
  const kok = el("div", { class: "dn-editor dn-pdf" }, cubuk, alan, el("div", { class: "dn-editor-alt" }, el("span", { class: "dn-muted", text: "Açıklamalar kaydedilirken sayfaya işlenir. Her şey tarayıcında kalır." })));
  bos(kap);
  kap.append(kok);

  dosyaGirdi.addEventListener("change", async () => {
    const liste = [...dosyaGirdi.files];
    dosyaGirdi.value = "";
    try {
      for (const d of liste) await dosyaEkle(d, true);
      kaydet();
      await kucuklerYenile();
      mesaj(`${liste.length} dosya eklendi.`, "success");
    } catch (h) { mesaj(h.message, "error"); }
  });

  /* ---- araç durumu ---- */
  function renkGuncelle() {
    for (const d of renkGrubu.querySelectorAll(".dn-renk")) d.setAttribute("aria-pressed", String(d.dataset.renk === renk));
    renkGirdi.value = /^#[\da-f]{6}$/i.test(renk) ? renk : "#111111";
  }
  function cubukGuncelle() {
    dugmeler.geri.disabled = gecmisIdx <= 0;
    dugmeler.ileri.disabled = gecmisIdx >= gecmis.length - 1;
    dugmeler.onceki.disabled = aktif <= 0;
    dugmeler.sonraki.disabled = aktif >= sayfalar.length - 1;
    dugmeler["sayfa-sil"].disabled = sayfalar.length <= 1;
    dugmeler.yukari.disabled = aktif <= 0;
    dugmeler.asagi.disabled = aktif >= sayfalar.length - 1;
    sayfaBilgi.textContent = `${aktif + 1} / ${sayfalar.length}`;
    renkGuncelle();
  }
  function aracSec(k) {
    arac = k;
    if ((k === "cizim" || k === "metin") && renk === RENKLER[0]) renk = "#111111";
    else if (["vurgu", "alt", "ust"].includes(k) && renk === "#111111") renk = RENKLER[0];
    for (const [id, d] of Object.entries(aracDugmeleri)) d.setAttribute("aria-pressed", String(id === k));
    const metinModu = k === "vurgu" || k === "alt" || k === "ust";
    kutu.classList.toggle("dn-pdf--metinsec", metinModu);
    kutu.dataset.arac = k;
    uygulaDugme.hidden = !metinModu;
    if (k !== "sec") { secili = null; ozetGuncelle(); katmanCiz(); }
    mesaj("", "");
    if (metinModu) mesaj("Sayfadaki metni seç; fare ile bırakınca otomatik uygulanır, dokunmatikte “Seçimi uygula”ya bas.", "info");
  }

  /* ---- sayfa gösterimi ---- */
  let anaOlcu = null;
  async function sayfaGoster() {
    if (yokEdildi || !sf()) return;
    const kimlik = ++renderKimlik;
    try { renderGorevi?.cancel(); } catch { /* yok say */ }
    try { metinKatmani?.cancel(); } catch { /* yok say */ }
    const s = sf();
    const o = await olcu(s);
    if (kimlik !== renderKimlik) return;
    anaOlcu = o;
    const cssW = o.W * zoom;
    const cssH = o.H * zoom;
    kutu.style.width = `${cssW}px`;
    kutu.style.height = `${cssH}px`;
    kutu.style.setProperty("--scale-factor", String(zoom));
    kutu.style.setProperty("--total-scale-factor", String(zoom));
    kutu.style.setProperty("--user-unit", "1");
    let dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    while (cssW * dpr * cssH * dpr > MAKS_PIKSEL() && dpr > 0.5) dpr *= 0.8;
    for (const c of [tuval, katman]) { c.width = Math.max(1, Math.floor(cssW * dpr)); c.height = Math.max(1, Math.floor(cssH * dpr)); c.style.width = `${cssW}px`; c.style.height = `${cssH}px`; }
    const ctx = tuval.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, tuval.width, tuval.height);
    const vpPx = o.p.getViewport({ scale: zoom * dpr, rotation: o.T });
    renderGorevi = o.p.render({ canvasContext: ctx, viewport: vpPx });
    bos(metinDiv);
    const vpCss = o.p.getViewport({ scale: zoom, rotation: o.T });
    try {
      metinKatmani = new pdfjs.TextLayer({ textContentSource: o.p.streamTextContent(), container: metinDiv, viewport: vpCss });
      metinKatmani.render().catch(() => {});
    } catch { /* metin katmanı yoksa vurgu araçları devre dışı kalır */ }
    katmanCiz();
    cubukGuncelle();
    kucukIsaretle();
    try { await renderGorevi.promise; } catch (h) { if (h?.name !== "RenderingCancelledException") mesaj(`Sayfa çizilemedi: ${h?.message || h}`, "error"); }
  }

  function katmanCiz() {
    const s = sf();
    if (!s || !anaOlcu) return;
    const ctx = katman.getContext("2d");
    const k = katman.width / anaOlcu.W;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, katman.width, katman.height);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    for (const a of s.anot) anotCiz(ctx, a, katmanCiz);
    if (canliCizim) anotCiz(ctx, canliCizim);
    const sec = s.anot.find((a) => a.id === secili);
    if (sec) {
      const b = anotKutusu(sec);
      ctx.save(); ctx.strokeStyle = "#2563eb"; ctx.setLineDash([4 / zoom, 3 / zoom]); ctx.lineWidth = 1.2 / zoom;
      ctx.strokeRect(b.x - 2, b.y - 2, b.w + 4, b.h + 4); ctx.restore();
    }
  }

  async function sayfaGit(n) {
    if (n < 0 || n >= sayfalar.length) return;
    aktif = n;
    secili = null;
    ozetGuncelle();
    await sayfaGoster();
    sahne.scrollTo?.({ top: 0, left: 0 });
  }

  async function sigdir() {
    if (!sf()) return;
    const o = await olcu(sf());
    zoom = Math.max(0.3, Math.min(4, (sahne.clientWidth - 24) / o.W));
    await sayfaGoster();
  }
  async function yakinlik(k) { zoom = Math.max(0.25, Math.min(5, zoom * k)); await sayfaGoster(); }

  /* ---- küçük resimler ---- */
  async function kucukCiz(s, canvas) {
    try {
      const o = await olcu(s);
      const k = 120 / o.W;
      const vp = o.p.getViewport({ scale: k, rotation: o.T });
      canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await o.p.render({ canvasContext: ctx, viewport: vp }).promise;
      // açıklamaları da küçük resme işle
      ctx.save(); ctx.setTransform(canvas.width / o.W, 0, 0, canvas.width / o.W, 0, 0);
      for (const a of s.anot) anotCiz(ctx, a);
      ctx.restore();
    } catch { /* küçük resim hatası önemsiz */ }
  }

  let surukle = null;
  async function kucuklerYenile() {
    kucukGozlemci?.disconnect();
    kucukGozlemci = new IntersectionObserver((girdiler) => {
      for (const g of girdiler) {
        if (!g.isIntersecting) continue;
        const id = Number(g.target.dataset.sid);
        const s = sayfalar.find((x) => x.id === id);
        const c = g.target.querySelector("canvas");
        if (s && c && !c.dataset.cizildi) { c.dataset.cizildi = "1"; kucukCiz(s, c); }
      }
    }, { root: kucukListe, rootMargin: "200px" });
    bos(kucukListe);
    kucukler.clear();
    sayfalar.forEach((s, i) => {
      const c = el("canvas", { class: "dn-pdf-kucuk-tuval", "aria-hidden": "true", width: 90, height: 120 });
      const oge = el("div", { class: "dn-pdf-kucuk", role: "option", tabindex: "0", draggable: "true", "data-sid": s.id, "aria-label": `Sayfa ${i + 1}`, "aria-selected": String(i === aktif) }, c, el("span", { class: "dn-pdf-kucuk-no", text: String(i + 1) }));
      oge.addEventListener("click", () => sayfaGit(i));
      oge.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); sayfaGit(i); } });
      oge.addEventListener("dragstart", (e) => { surukle = i; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(i)); oge.classList.add("dn-surukleniyor"); });
      oge.addEventListener("dragend", () => { surukle = null; oge.classList.remove("dn-surukleniyor"); kucukListe.querySelectorAll(".dn-hedef").forEach((x) => x.classList.remove("dn-hedef")); });
      oge.addEventListener("dragover", (e) => { if (surukle != null) { e.preventDefault(); oge.classList.add("dn-hedef"); } });
      oge.addEventListener("dragleave", () => oge.classList.remove("dn-hedef"));
      oge.addEventListener("drop", async (e) => {
        e.preventDefault();
        if (surukle == null || surukle === i) return;
        const [x] = sayfalar.splice(surukle, 1);
        sayfalar.splice(i, 0, x);
        aktif = i;
        kaydet();
        await kucuklerYenile();
        await sayfaGoster();
      });
      kucukler.set(s.id, c);
      kucukListe.append(oge);
      kucukGozlemci.observe(oge);
    });
  }
  function kucukIsaretle() {
    [...kucukListe.children].forEach((o, i) => {
      o.setAttribute("aria-selected", String(i === aktif));
      if (i === aktif) o.scrollIntoView?.({ block: "nearest" });
    });
  }
  async function kucukTazele(s) {
    const c = kucukler.get(s.id);
    if (c) { c.dataset.cizildi = "1"; await kucukCiz(s, c); }
  }

  /* ---- sayfa işlemleri ---- */
  async function dondur(derece) {
    const s = sf();
    if (!s) return;
    const adim = derece > 0 ? 1 : 3; // sola = 3× sağa
    for (let i = 0; i < adim; i++) {
      const o = await olcu(s);
      s.anot = s.anot.map((a) => don90(a, o.H));
      s.ek = (s.ek + 90) % 360;
    }
    kaydet();
    await kucuklerYenile();
    await sayfaGoster();
    await sigdirGerekirse();
  }
  async function sigdirGerekirse() { if (anaOlcu && anaOlcu.W * zoom > sahne.clientWidth) await sigdir(); }

  async function sayfaSil() {
    if (sayfalar.length <= 1) return;
    sayfalar.splice(aktif, 1);
    aktif = Math.min(aktif, sayfalar.length - 1);
    kaydet();
    await kucuklerYenile();
    await sayfaGoster();
  }
  async function tasi(yon) {
    const y = aktif + yon;
    if (y < 0 || y >= sayfalar.length) return;
    [sayfalar[aktif], sayfalar[y]] = [sayfalar[y], sayfalar[aktif]];
    aktif = y;
    kaydet();
    await kucuklerYenile();
    await sayfaGoster();
  }
  async function cogalt() {
    const kopyaSayfa = { ...kopya(sf()), id: sayfaSayaci++ };
    kopyaSayfa.anot = kopya(sf().anot).map((a) => ({ ...a, id: anotSayaci++ }));
    sayfalar.splice(aktif + 1, 0, kopyaSayfa);
    aktif += 1;
    kaydet();
    await kucuklerYenile();
    await sayfaGoster();
  }
  async function bosSayfa() {
    const { PDFDocument } = await pdfLibAl();
    const d = await PDFDocument.create();
    const ref = anaOlcu ? [anaOlcu.T % 180 ? anaOlcu.H : anaOlcu.W, anaOlcu.T % 180 ? anaOlcu.W : anaOlcu.H] : [595.28, 841.89];
    d.addPage(ref);
    const bayt = new Uint8Array(await d.save());
    const kid = await pdfYukle(bayt, "Boş sayfa");
    sayfalar.splice(aktif + 1, 0, { id: sayfaSayaci++, kaynakId: kid, idx: 0, ek: 0, anot: [] });
    aktif += 1;
    kaydet();
    await kucuklerYenile();
    await sayfaGoster();
  }

  /* ---- açıklama ekleme ---- */
  function ekle(a) {
    a.id = anotSayaci++;
    sf().anot.push(a);
    secili = a.id;
    kaydet();
    katmanCiz();
    ozetGuncelle();
    kucukTazele(sf());
  }
  function sil(id) {
    const s = sf();
    s.anot = s.anot.filter((a) => a.id !== id);
    if (secili === id) secili = null;
    kaydet(); katmanCiz(); ozetGuncelle(); kucukTazele(s);
  }
  function seciliOzellik(o) {
    const a = sf().anot.find((x) => x.id === secili);
    if (!a) return;
    Object.assign(a, o);
    kaydet(); katmanCiz(); kucukTazele(sf());
  }

  const noktaPt = (e) => {
    const r = kutu.getBoundingClientRect();
    return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
  };

  function secimiUygula(otomatik = false) {
    const s = getSelection();
    if (!s || !s.rangeCount || s.isCollapsed) { if (!otomatik) mesaj("Önce sayfadaki metni seç.", "info"); return; }
    const aralik = s.getRangeAt(0);
    if (!metinDiv.contains(aralik.commonAncestorContainer)) return;
    const kr = kutu.getBoundingClientRect();
    const ham = [...aralik.getClientRects()].map((r) => ({ x: (r.left - kr.left) / zoom, y: (r.top - kr.top) / zoom, w: r.width / zoom, h: r.height / zoom })).filter((r) => r.w > 0.8 && r.h > 2 && r.w < anaOlcu.W * 1.01);
    if (!ham.length) return;
    // aynı satırdaki kutuları birleştir
    ham.sort((a, b) => a.y - b.y || a.x - b.x);
    const satirlar = [];
    for (const r of ham) {
      const son = satirlar.find((x) => Math.min(x.y + x.h, r.y + r.h) - Math.max(x.y, r.y) > 0.5 * Math.min(x.h, r.h));
      if (son) { const x2 = Math.max(son.x + son.w, r.x + r.w); const y2 = Math.max(son.y + son.h, r.y + r.h); son.x = Math.min(son.x, r.x); son.y = Math.min(son.y, r.y); son.w = x2 - son.x; son.h = y2 - son.y; } else satirlar.push({ ...r });
    }
    ekle({ t: arac, renk, rects: satirlar });
    s.removeAllRanges();
  }

  let canliCizim = null;
  let tasima = null;

  function vurusTesti(p) {
    const s = sf();
    for (let i = s.anot.length - 1; i >= 0; i--) {
      const a = s.anot[i];
      if (a.t === "cizim") {
        const tol = Math.max(a.kal, 8 / zoom);
        for (let j = 0; j < a.pts.length - 1; j++) {
          const A = a.pts[j]; const B = a.pts[j + 1];
          const dx = B.x - A.x; const dy = B.y - A.y;
          const t = dx || dy ? Math.max(0, Math.min(1, ((p.x - A.x) * dx + (p.y - A.y) * dy) / (dx * dx + dy * dy))) : 0;
          if (Math.hypot(p.x - (A.x + t * dx), p.y - (A.y + t * dy)) <= tol) return a;
        }
        if (a.pts.length === 1 && Math.hypot(p.x - a.pts[0].x, p.y - a.pts[0].y) <= tol) return a;
      } else {
        const b = anotKutusu(a);
        if (p.x >= b.x - 3 && p.x <= b.x + b.w + 3 && p.y >= b.y - 3 && p.y <= b.y + b.h + 3) return a;
      }
    }
    return null;
  }

  katman.addEventListener("pointerdown", async (e) => {
    if (e.button > 0 || !sf()) return;
    const p = noktaPt(e);
    if (arac === "cizim") {
      katman.setPointerCapture(e.pointerId);
      canliCizim = { t: "cizim", renk, kal: kalinlik, pts: [p] };
      e.preventDefault();
    } else if (arac === "sec") {
      const a = vurusTesti(p);
      secili = a ? a.id : null;
      ozetGuncelle();
      if (a && (a.t === "metin" || a.t === "imza")) { katman.setPointerCapture(e.pointerId); tasima = { id: a.id, dx: p.x - a.x, dy: p.y - a.y, tasindi: false }; }
      katmanCiz();
    } else if (arac === "sil") {
      const a = vurusTesti(p);
      if (a) sil(a.id);
    } else if (arac === "metin") {
      const v = await formIste({ baslik: "Metin kutusu", alanlar: [{ ad: "metin", etiket: "Metin", tur: "textarea", satir: 4 }, { ad: "boyut", etiket: "Yazı boyutu (pt)", tur: "number", deger: 14, min: 6, max: 96 }], tamam: "Ekle" });
      if (v && v.metin.trim()) {
        const boyut = Math.max(6, Math.min(96, v.boyut || 14));
        const w = Math.min(260, Math.max(60, anaOlcu.W - p.x - 8));
        ekle({ t: "metin", renk, metin: v.metin, boyut, x: Math.max(0, p.x), y: Math.max(0, p.y), w });
        aracSec("sec");
      }
    } else if (arac === "imza") {
      if (!imza) imza = await imzaCiz();
      if (imza) {
        const w = Math.min(160, anaOlcu.W * 0.4);
        ekle({ t: "imza", url: imza.url, x: Math.max(0, Math.min(anaOlcu.W - w, p.x - w / 2)), y: Math.max(0, p.y - (w * imza.h) / imza.w / 2), w, h: (w * imza.h) / imza.w });
        aracSec("sec");
      }
    }
  });
  katman.addEventListener("pointermove", (e) => {
    const p = noktaPt(e);
    if (canliCizim) {
      const son = canliCizim.pts[canliCizim.pts.length - 1];
      if (Math.hypot(p.x - son.x, p.y - son.y) > 0.6 / zoom) { canliCizim.pts.push(p); katmanCiz(); }
    } else if (tasima) {
      const a = sf().anot.find((x) => x.id === tasima.id);
      if (a) { a.x = Math.max(-a.w * 0.5, Math.min(anaOlcu.W - a.w * 0.5, p.x - tasima.dx)); a.y = Math.max(-5, Math.min(anaOlcu.H - 10, p.y - tasima.dy)); tasima.tasindi = true; katmanCiz(); }
    }
  });
  const bitir = () => {
    if (canliCizim) { const c = canliCizim; canliCizim = null; ekle(c); }
    else if (tasima) { if (tasima.tasindi) { kaydet(); kucukTazele(sf()); } tasima = null; }
  };
  katman.addEventListener("pointerup", bitir);
  katman.addEventListener("pointercancel", bitir);

  // metin seçimi araçları: fare ile bırakınca otomatik uygula
  metinDiv.addEventListener("pointerup", (e) => { if (e.pointerType === "mouse" && (arac === "vurgu" || arac === "alt" || arac === "ust")) setTimeout(() => secimiUygula(true), 0); });

  sahne.addEventListener("keydown", (e) => {
    if (e.target !== sahne) return;
    if (e.key === "Delete" || e.key === "Backspace") { if (secili) { e.preventDefault(); sil(secili); } }
    else if (e.key === "PageDown") { e.preventDefault(); sayfaGit(aktif + 1); }
    else if (e.key === "PageUp") { e.preventDefault(); sayfaGit(aktif - 1); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); gecmiseGit(e.shiftKey ? 1 : -1); }
  });

  /* ---- seçili açıklama özeti ---- */
  const ADLAR = { vurgu: "Vurgu", alt: "Alt çizgi", ust: "Üst çizgi", cizim: "Çizim", metin: "Metin kutusu", imza: "İmza" };
  function ozetGuncelle() {
    const a = sf()?.anot.find((x) => x.id === secili);
    ozet.hidden = !a;
    bos(ozet);
    if (!a) return;
    const b = (m, f, t) => { const d = dugme({ metin: m, kucuk: true, tur: t || "ikincil" }); d.addEventListener("click", f); return d; };
    ozet.append(el("strong", { text: `Seçili: ${ADLAR[a.t]}` }));
    if (a.t === "metin") {
      ozet.append(b("Düzenle", async () => {
        const v = await formIste({ baslik: "Metni düzenle", alanlar: [{ ad: "metin", etiket: "Metin", tur: "textarea", satir: 4, deger: a.metin }, { ad: "boyut", etiket: "Yazı boyutu (pt)", tur: "number", deger: a.boyut, min: 6, max: 96 }], tamam: "Kaydet" });
        if (v && v.metin.trim()) seciliOzellik({ metin: v.metin, boyut: Math.max(6, Math.min(96, v.boyut || a.boyut)) });
      }), b("A−", () => seciliOzellik({ boyut: Math.max(6, a.boyut - 2) })), b("A+", () => seciliOzellik({ boyut: Math.min(96, a.boyut + 2) })));
    }
    if (a.t === "imza") ozet.append(b("Küçült", () => { const k = 0.85; seciliOzellik({ w: a.w * k, h: a.h * k }); }), b("Büyüt", () => { const k = 1.18; seciliOzellik({ w: a.w * k, h: a.h * k }); }));
    ozet.append(b("Sil", () => sil(a.id), "tehlike-hafif"));
  }

  /* ---- imza çizimi ---- */
  function imzaCiz() {
    return new Promise((coz) => {
      if (typeof HTMLDialogElement === "undefined") { coz(null); return; }
      const d = el("dialog", { class: "dn-dialog dn-dialog--genis" });
      const c = el("canvas", { class: "dn-imza-tuval", width: 640, height: 240, "aria-label": "İmza çizim alanı" });
      const ctx = c.getContext("2d");
      ctx.lineWidth = 3.2; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = /^#[\da-f]{6}$/i.test(renk) && renk !== RENKLER[0] ? renk : "#111111";
      let ciziyor = false; let cizildi = false; let son = null;
      const pt = (e) => { const r = c.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height }; };
      c.addEventListener("pointerdown", (e) => { ciziyor = true; son = pt(e); c.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.arc(son.x, son.y, 1.6, 0, 7); ctx.fillStyle = ctx.strokeStyle; ctx.fill(); cizildi = true; e.preventDefault(); });
      c.addEventListener("pointermove", (e) => { if (!ciziyor) return; const p = pt(e); ctx.beginPath(); ctx.moveTo(son.x, son.y); ctx.lineTo(p.x, p.y); ctx.stroke(); son = p; });
      c.addEventListener("pointerup", () => { ciziyor = false; });
      const iptal = dugme({ metin: "Vazgeç" });
      const temizle = dugme({ metin: "Temizle" });
      const tamam = dugme({ metin: "Kullan", tur: "birincil" });
      let sonuc = null;
      iptal.addEventListener("click", () => d.close());
      temizle.addEventListener("click", () => { ctx.clearRect(0, 0, c.width, c.height); cizildi = false; });
      tamam.addEventListener("click", () => {
        if (!cizildi) return;
        const veri = ctx.getImageData(0, 0, c.width, c.height).data;
        let x1 = c.width; let y1 = c.height; let x2 = 0; let y2 = 0;
        for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (veri[(y * c.width + x) * 4 + 3] > 8) { if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y; }
        const pad = 6; x1 = Math.max(0, x1 - pad); y1 = Math.max(0, y1 - pad); x2 = Math.min(c.width, x2 + pad); y2 = Math.min(c.height, y2 + pad);
        const k = document.createElement("canvas"); k.width = Math.max(1, x2 - x1); k.height = Math.max(1, y2 - y1);
        k.getContext("2d").drawImage(c, x1, y1, k.width, k.height, 0, 0, k.width, k.height);
        sonuc = { url: k.toDataURL("image/png"), w: k.width, h: k.height };
        d.close();
      });
      d.append(el("div", { class: "dn-dialog-govde" }, el("h3", { class: "dn-dialog-baslik", text: "İmzanı çiz" }), el("p", { class: "dn-muted", text: "Parmağınla ya da fareyle çiz. İmza yalnızca bu oturumda bellekte tutulur." }), c, el("div", { class: "dn-dialog-eylem" }, iptal, temizle, tamam)));
      d.addEventListener("close", () => { d.remove(); coz(sonuc); });
      document.body.append(d);
      d.showModal();
    });
  }

  /* ---- kaydetme ---- */
  async function pdfOlustur(ilerle) {
    const { PDFDocument, degrees } = await pdfLibAl();
    const cikti = await PDFDocument.create();
    const kaynakDoc = new Map();
    for (let i = 0; i < sayfalar.length; i++) {
      const s = sayfalar[i];
      let kd = kaynakDoc.get(s.kaynakId);
      if (!kd) {
        try { kd = await PDFDocument.load(kaynaklar.get(s.kaynakId).bayt, { updateMetadata: false }); } catch (h) { throw new Error(`${kaynaklar.get(s.kaynakId).ad}: kaydedilemedi (${h.message}).`); }
        kaynakDoc.set(s.kaynakId, kd);
      }
      const [p] = await cikti.copyPages(kd, [s.idx]);
      const yerel = p.getRotation().angle || 0;
      const T = (((yerel + s.ek) % 360) + 360) % 360;
      if (s.anot.length) {
        const cb = p.getCropBox();
        const Wu = cb.width; const Hu = cb.height;
        const k = Math.min(3, 3000 / Math.max(Wu, Hu));
        const [Wd, Hd] = T % 180 ? [Hu, Wu] : [Wu, Hu];
        const gc = document.createElement("canvas"); gc.width = Math.ceil(Wd * k); gc.height = Math.ceil(Hd * k);
        const gx = gc.getContext("2d"); gx.scale(k, k);
        for (const a of s.anot) anotCiz(gx, a);
        const uc = document.createElement("canvas"); uc.width = Math.ceil(Wu * k); uc.height = Math.ceil(Hu * k);
        const ux = uc.getContext("2d");
        ux.translate(uc.width / 2, uc.height / 2); ux.rotate((-T * Math.PI) / 180); ux.drawImage(gc, -gc.width / 2, -gc.height / 2);
        const png = await new Promise((c, r) => uc.toBlob((b) => (b ? c(b) : r(new Error("Açıklama katmanı oluşturulamadı."))), "image/png"));
        const resim = await cikti.embedPng(new Uint8Array(await png.arrayBuffer()));
        p.drawImage(resim, { x: cb.x, y: cb.y, width: Wu, height: Hu });
        gc.width = 0; uc.width = 0;
      }
      p.setRotation(degrees(T));
      cikti.addPage(p);
      ilerle?.((i + 1) / sayfalar.length, `Sayfa ${i + 1}/${sayfalar.length} işleniyor…`);
      if (i % 3 === 2) await nefes();
    }
    cikti.setProducer("Evrensel Dönüştürücü (tarayıcıda)");
    return new Blob([await cikti.save()], { type: "application/pdf" });
  }

  /* ---- başlat ---- */
  for (const d of dosyalar) await dosyaEkle(d, true);
  if (!sayfalar.length) throw new Error("PDF'te sayfa bulunamadı.");
  gecmis = [{ sayfalar: anlik(), aktif: 0 }];
  gecmisIdx = 0;
  kirli = false;
  await kucuklerYenile();
  aracSec("sec");
  const baslangicBoyut = async () => { await sayfaGoster(); await sigdir(); };
  await baslangicBoyut();
  const yenidenBoyut = () => { if (sahne.clientWidth && anaOlcu && anaOlcu.W * zoom > sahne.clientWidth + 2) sigdir(); };
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(yenidenBoyut) : null;
  ro?.observe(sahne);

  return {
    sayfaSayisi: () => sayfalar.length,
    ad: () => adsizAl(kaynaklar.values().next().value?.ad || "belge"),
    pdfAl: pdfOlustur,
    kirli: () => kirli,
    yokEt() {
      yokEdildi = true;
      ro?.disconnect();
      kucukGozlemci?.disconnect();
      try { renderGorevi?.cancel(); } catch { /* yok say */ }
      for (const k of kaynaklar.values()) { try { k.pdf.destroy(); } catch { /* yok say */ } k.bayt = null; }
      kaynaklar.clear();
      sayfalar = []; gecmis = [];
      tuval.width = 0; katman.width = 0;
      bos(kap);
    },
  };
}

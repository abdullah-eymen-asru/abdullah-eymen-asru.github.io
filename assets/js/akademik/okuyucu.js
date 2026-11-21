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
import { taslakYaz, taslakOku, taslakSil } from "./taslak.js";
import { eklentilerAcikMi, ayarYukle, ayarKaydet, acikEklentiler, eklentiCalistir as eklentiYurut, ceviriUzun, otoCeviriAcikMi, DIL_SECENEKLERI } from "./eklentiler.js";
import { kancaCalistir, konumuYukselt, konumEkstra, SEMA_SURUMU } from "./modul-kayit.js";

/** Veritabanı `konum` verisini model alanlarına açar: şema yükseltilir, bilinmeyen alanlar `ekstra` altında saklanır (kaydederken geri yazılır). */
const konumAc = (k) => {
  if (!k || typeof k !== "object") return {};
  const y = konumuYukselt(k), cikti = {};
  for (const x of ["kutular", "cizgiler", "rect", "kalinlik", "yaziPt", "norm"]) if (y[x] !== undefined) cikti[x] = y[x];
  const e = konumEkstra(y);
  if (Object.keys(e).length) cikti.ekstra = e;
  return cikti;
};

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
const ARAC_KISA = { gez: "Seç", vurgu: "Vurgu", altcizgi: "Altı çiz", ustcizgi: "Üstü çiz", cizim: "Kalem", sekil: "Şekil", yapiskan: "Not", metin: "Metin" };
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

/* ---- Arka plan kaydırma kilidi ----
 * body{overflow:hidden} iOS/Safari'de arkadaki sayfanın kaymasını ENGELLEMEZ (okuyucunun arkasında site kayıyordu).
 * Güvenilir yöntem: body'yi position:fixed yapıp mevcut kaydırma konumunu CSS değişkeninde tutmak; kapanınca geri yüklemek. */
let kilitSayac = 0, kilitY = 0;
function kaydirmaKilitle() {
  if (kilitSayac++ > 0) return;
  kilitY = window.scrollY || document.documentElement.scrollTop || 0;
  document.body.style.setProperty("--ak-kilit-y", `-${kilitY}px`);
  document.body.classList.add("ak-okuyucu-acik");
  document.documentElement.classList.add("ak-okuyucu-acik-html");
}
function kaydirmaKilidiAc() {
  if (kilitSayac === 0) return;
  if (--kilitSayac > 0) return;
  document.body.classList.remove("ak-okuyucu-acik");
  document.documentElement.classList.remove("ak-okuyucu-acik-html");
  document.body.style.removeProperty("--ak-kilit-y");
  const eski = document.documentElement.style.scrollBehavior;
  document.documentElement.style.scrollBehavior = "auto";
  window.scrollTo(0, kilitY);
  document.documentElement.style.scrollBehavior = eski;
}

/** Seçim aralığının KOPYASINI, kelime ortasında başlıyor/bitiyorsa TAM KELİMEYE genişleterek döndürür (aynı metin düğümü içinde).
 *  "NATO's 2022" → "NATO's 2" gibi yarım alıntıları ve vurgunun kelimeyi kesmesini önler.
 *  ÖNEMLİ: canlı seçim ASLA değiştirilmez (removeAllRanges/addRange mobilde seçim tutamaçlarını öldürüyordu); yalnızca kopya hizalanır. */
const KELIME_HARF = /[\p{L}\p{N}_'’]/u;
function hizaliAralik(kapsayici, aralik) {
  const r = aralik.cloneRange();
  const katmanda = (n) => n && n.nodeType === 3 && n.parentElement?.closest(".textLayer") && kapsayici.contains(n);
  const sn = r.startContainer;
  if (katmanda(sn)) {
    const t = sn.nodeValue; let o = r.startOffset;
    while (o < t.length && /\s/.test(t[o])) o++;                                                     // baştaki boşluğu at
    while (o > 0 && KELIME_HARF.test(t[o - 1]) && KELIME_HARF.test(t[o] || "")) o--;                 // kelime ortasındaysa başa al
    if (o !== r.startOffset) r.setStart(sn, o);
  }
  const en = r.endContainer;
  if (katmanda(en)) {
    const t = en.nodeValue; let o = r.endOffset;
    while (o > 0 && /\s/.test(t[o - 1])) o--;                                                        // sondaki boşluğu at
    while (o < t.length && KELIME_HARF.test(t[o - 1] || "") && KELIME_HARF.test(t[o])) o++;          // kelime ortasındaysa sona al
    if (o !== r.endOffset) r.setEnd(en, o);
  }
  return r.collapsed ? aralik.cloneRange() : r;
}

/* ------------------------------- ana giriş ------------------------------- */

export async function okuyucuAc({ kaynak, salt = false, kullaniciAdi = "", kapaninca = null, paylasimToken = null }) {
  const d = {
    kaynak, salt, kullaniciAdi,
    arac: "gez", renk: RENKLER[0].hex, kalinlik: 2,
    model: new Map(), silinenler: [], undo: [],
    secili: null, kirli: false, pdfKirli: false, kaydediliyor: false, otoZaman: null, otoCalisiyor: false, sonOto: null,
    bytes: null, rev: Number(kaynak.pdf_rev || 0), sifreli: false,
    linkler: new Map(), canli: null, olcu: null, tcHazir: new Map(), pinSurukleme: 0, secKare: 0,
  };

  /* ---------- iskelet ---------- */
  const aracDugme = (a) => `<button type="button" class="ak-arac${a.id === "gez" ? " aktif" : ""}" data-ak-arac="${a.id}" title="${esc(a.ad)}" aria-label="${esc(a.ad)}"><span class="ak-arac-simge" aria-hidden="true">${a.simge}</span><span class="ak-arac-yazi">${esc(ARAC_KISA[a.id] || a.ad)}</span></button>`;
  const ANA_ARACLAR = new Set(["gez", "vurgu", "altcizgi", "ustcizgi"]);
  const araclarHtml = salt ? "" : `${ARACLAR.filter((a) => ANA_ARACLAR.has(a.id)).map(aracDugme).join("")}<details class="ak-ok-diger"><summary class="ak-arac" title="Çizim, şekil, not, metin kutusu"><span class="ak-arac-simge" aria-hidden="true">✎</span><span class="ak-arac-yazi">Çiz / Not</span></summary><div class="ak-ok-diger-ic">${ARACLAR.filter((a) => !ANA_ARACLAR.has(a.id)).map(aracDugme).join("")}</div></details>`;
  const kok = el("div", { class: "ak-okuyucu", role: "dialog", "aria-modal": "true", "aria-label": `PDF okuyucu: ${kaynak.baslik}` });
  kok.innerHTML = `
    <header class="ak-ok-ust">
      <button type="button" class="ak-btn ak-ok-kapat" data-ak="kapat" title="Kapat" aria-label="Kapat">✕</button>
      <div class="ak-ok-baslik" title="${esc(kaynak.baslik)}">${esc(kaynak.baslik)}${salt ? ' <span class="ak-etiket">salt okunur</span>' : ""}</div>
      <div class="ak-ok-ust-sag">
        <span class="ak-ok-sayfa"><input type="number" min="1" value="1" data-ak="sayfa" aria-label="Sayfa"> / <span data-ak-toplam>–</span></span>
        <button type="button" class="ak-btn" data-ak="yan" title="Açıklama paneli" aria-label="Açıklama paneli">☰</button>
        <details class="ak-ok-menu"><summary class="ak-btn" aria-label="Diğer işlemler" title="Ara, yakınlaştır, indir…">⋯</summary>
          <div class="ak-ok-menu-ic">
            <label class="ak-ok-menu-satir"><span>Ara</span><input type="search" class="ak-ok-ara" data-ak="ara" placeholder="PDF'te ara" aria-label="PDF'te ara"><span class="ak-ok-say" data-ak-bul></span></label>
            <div class="ak-ok-menu-satir"><span>Yakınlık</span>
              <button type="button" class="ak-btn" data-ak="uzaklas" title="Uzaklaştır" aria-label="Uzaklaştır">−</button>
              <select class="ak-ok-sec" data-ak="olcek" aria-label="Yakınlaştırma"><option value="page-width">Genişliğe sığdır</option><option value="page-fit">Sayfaya sığdır</option><option value="auto">Otomatik</option><option value="0.75">75%</option><option value="1">100%</option><option value="1.25">125%</option><option value="1.5">150%</option><option value="2">200%</option></select>
              <button type="button" class="ak-btn" data-ak="yaklas" title="Yakınlaştır" aria-label="Yakınlaştır">+</button></div>
            <button type="button" class="ak-btn" data-ak="tam" title="Tam ekran">⛶ Tam ekran</button>
            <button type="button" class="ak-btn ak-btn-indir" data-ak="indir" title="PDF dosyasını indir (açıklamalarınla birlikte)" aria-label="PDF dosyasını indir"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M12 3v11m0 0l-4-4m4 4l4-4M5 17v3h14v-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="ak-indir-yazi">PDF indir</span></button>
            ${salt ? "" : `<button type="button" class="ak-btn" data-ak="onceki" title="Önceki sürüme dön">↶ Önceki sürüm</button><button type="button" class="ak-btn" data-ak="kaydet" title="Değişiklikler zaten otomatik kaydedilir. Bu düğme açıklamaları PDF dosyasının içine de işler (Ctrl+S). Okuyucuyu kapatırken bu da kendiliğinden yapılır.">PDF'e işle</button>`}
          </div>
        </details>
      </div>
    </header>
    ${salt ? "" : `<div class="ak-ok-dock" role="toolbar" aria-label="Açıklama araçları"><div class="ak-ok-araclar">${araclarHtml}</div>
      <div class="ak-ok-stil"><span class="ak-ok-renkler" data-ak-renkler></span>
        <select class="ak-ok-sec" data-ak="kalinlik" title="Çizgi kalınlığı" aria-label="Çizgi kalınlığı"><option value="1">İnce</option><option value="2" selected>Orta</option><option value="4">Kalın</option><option value="7">Çok kalın</option></select></div></div>`}
    <div class="ak-ok-durumsatiri"><div class="ak-ok-durum" data-ak-durum aria-live="polite"></div><div class="ak-ok-oto" data-ak-oto aria-live="polite"></div></div>
    <div class="ak-ok-govde">
      <div class="ak-ok-kap" data-ak-kap tabindex="0"><div class="pdfViewer"></div></div>
      <aside class="ak-ok-yan" data-ak-yan aria-label="Açıklamalar">
        <div class="ak-yan-ust">
          <strong>Açıklamalar <span data-ak-adet>0</span></strong>
          <button type="button" class="ak-btn" data-ak="md-tumu" title="Tümünü Markdown alıntısı olarak kopyala">Markdown kopyala</button>
        </div>
        <div class="ak-yan-filtre"><select data-ak="f-tur" aria-label="Türe göre süz"><option value="">Tüm türler</option>${Object.entries(TUR_ADI).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
        <select data-ak="f-renk" aria-label="Renge göre süz"><option value="">Tüm renkler</option>${RENKLER.map((r) => `<option value="${r.hex}">${r.ad}</option>`).join("")}</select></div>
        <input type="search" class="ak-liste-ara" data-ak="f-ara" placeholder="Açıklamalarda ara (metin, yorum)" aria-label="Açıklamalarda ara" autocomplete="off">
        <div class="ak-yan-liste" data-ak-liste></div>
      </aside>
    </div>`;
  document.body.append(kok);
  kok.setAttribute("translate", "no");                       // Safari/Chrome'un kendi "Çevir" simgesi seçimin başında mavi daire olarak çıkmasın
  kaydirmaKilitle();
  if (window.innerWidth <= 900) kok.classList.add("yan-kapali"); // dar ekranda panel varsayılan kapalı
  const q = (s) => kok.querySelector(s);
  const durumYaz = (m, tur = "") => { const e = q("[data-ak-durum]"); e.textContent = m; e.className = `ak-ok-durum ${tur}`; };
  durumYaz("PDF motoru yükleniyor…");
  // Erken hata yolu: motor/PDF yüklenemezse kullanıcı yine de pencereyi kapatabilsin
  // (asıl kapat() daha sonra tanımlanan sabitlere bağlı olduğundan burada ayrı, bağımsız bir kapatma var).
  const erkenKapat = () => { kok.remove(); kaydirmaKilidiAc(); kapaninca?.(); };
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
    const { bayt, rev } = await pdfIndirBayt(kaynak.id, (o) => durumYaz(`PDF indiriliyor… %${Math.round(o * 100)}`), { paylasimToken });
    d.bytes = bayt;
    d.rev = rev;
    if (bayt.byteLength > BUYUK_PDF_OKUMA_SINIRI) durumYaz("Büyük dosya: açıklamaları okumak biraz sürebilir…");
    belge = await pdfjsLib.getDocument({
      data: new Uint8Array(bayt), // kopya: PDF.js diziyi iş parçacığına devreder
      cMapUrl: `${taban}/cmaps/`, cMapPacked: true,
      standardFontDataUrl: `${taban}/standard_fonts/`, wasmUrl: `${taban}/wasm/`, iccUrl: `${taban}/iccs/`,
      // useWasm:false KALDIRILDI: JPEG2000/JBIG2 görselli (taranmış/eski) PDF'lerde sayfa BEYAZ çiziliyordu.
      isEvalSupported: false, enableXfa: false,
    }).promise;
  } catch (h) {
    console.error(h);
    durumYaz(`PDF açılamadı: ${h.message || h}`, "hata");
    // YEDEK: tarayıcının yerleşik PDF okuyucusu (blob: çerçeve). Annotation/not araçları bu modda yoktur; belge en azından okunabilir.
    if (d.bytes && h?.name !== "PasswordException") {
      try {
        const { yerlesikOkuyucuGoster } = await import("../pdf-okuyucu/evrensel-pdf.js");
        const kap = q(".ak-ok-kap");
        if (kap) {
          yerlesikOkuyucuGoster(kap, new Blob([d.bytes], { type: "application/pdf" }), kaynak.baslik);
          durumYaz("PDF.js bu belgeyi çizemedi; tarayıcının yerleşik okuyucusu kullanılıyor (not/vurgu araçları kapalı).", "uyari");
        }
      } catch (ic) { console.error(ic); }
    }
    return;
  }
  d.belge = belge;

  /* ---------- açıklamaları yükle (PDF + Supabase özeti) ---------- */
  try {
    const pdflib = await pdfLibAl();
    const { aciklamalar, sifreli } = await acikla(pdflib, d.bytes);
    d.sifreli = sifreli;
    const { data: satirlar } = paylasimToken ? { data: [] } : await supabase.from("akademik_notlar").select("ek_id,tur,sayfa,metin,yorum,renk,konum").eq("kaynak_id", kaynak.id).not("ek_id", "is", null);
    const dbHarita = new Map((satirlar || []).map((s) => [s.ek_id, s]));
    let dbOtorite = kaynak.aciklama_db_otorite;
    if (paylasimToken) dbOtorite = false;
    else if (dbOtorite === undefined) { const { data: kr } = await supabase.from("akademik_kaynaklar").select("aciklama_db_otorite").eq("id", kaynak.id).maybeSingle(); dbOtorite = !!kr?.aciklama_db_otorite; }
    const konumAyni = (a, k) => ["kutular", "cizgiler", "rect"].every((x) => JSON.stringify(a[x] ?? null) === JSON.stringify(k?.[x] ?? null));
    for (const a of aciklamalar) {
      const s = a.nm ? dbHarita.get(a.nm) : null;
      if (dbOtorite && !s) {                                   // veritabanında silinmiş → PDF'ten de kaldırılacak (sonraki "PDF'e işle")
        if (a.ref) d.silinenler.push({ nm: a.nm, ref: a.ref, sayfa: a.sayfa, _a: a });
        d.pdfKirli = true;
        continue;
      }
      if (s) {
        if (s.metin) a.metin = s.metin;
        if (dbOtorite) {                                       // otorite veritabanı: yorum/renk/konum veritabanındaki güncel değerdir
          const fark = (s.yorum || "") !== (a.yorum || "") || (s.renk || a.renk) !== a.renk || (s.konum && !konumAyni(a, s.konum));
          if (fark) { Object.assign(a, { yorum: s.yorum || "", renk: s.renk || a.renk }, konumAc(s.konum)); if (a.durum === "ayni") a.durum = "degisti"; d.pdfKirli = true; }
        }
      }
      d.model.set(a.id, a);
    }
    if (dbOtorite) {                                           // veritabanında olup PDF'te olmayanlar (PDF'e henüz işlenmemiş açıklamalar)
      const pdfte = new Set(aciklamalar.map((a) => a.nm).filter(Boolean));
      for (const s of satirlar || []) {
        if (pdfte.has(s.ek_id) || !s.konum || !s.tur || ["not", "alinti"].includes(s.tur)) continue;
        const id = s.ek_id.replace(/^ae-/, "");
        d.model.set(id, { id, nm: s.ek_id, tur: s.tur, sayfa: s.sayfa, renk: s.renk || "#ffd400", yorum: s.yorum || "", metin: s.metin || "", durum: "yeni", ...konumAc(s.konum) });
        d.pdfKirli = true;
      }
    }
    // Cihazda bekleyen taslak varsa (internet/elektrik kesilmiş, değişiklik veritabanına gidememiş) en yeni durum odur: geri yükle ve gönder.
    if (!salt && !paylasimToken) {
      const tas = await taslakOku(kaynak.id);
      if (tas?.ozet) {
        const hepsi = new Map(tas.ozet.map((s) => [s.ek_id, s]));
        for (const a of [...d.model.values()]) {
          const s = hepsi.get(a.nm || `ae-${a.id}`);
          if (!s) { if (a.ref) d.silinenler.push({ nm: a.nm, ref: a.ref, sayfa: a.sayfa, _a: a }); d.model.delete(a.id); continue; }
          Object.assign(a, { yorum: s.yorum || "", renk: s.renk || a.renk, metin: s.metin || a.metin, ...konumAc(s.konum) });
          if (a.durum === "ayni") a.durum = "degisti";
          hepsi.delete(s.ek_id);
        }
        for (const s of hepsi.values()) {
          if (!s.konum || !s.tur) continue;
          const id = s.ek_id.replace(/^ae-/, "");
          d.model.set(id, { id, nm: s.ek_id, tur: s.tur, sayfa: s.sayfa, renk: s.renk || "#ffd400", yorum: s.yorum || "", metin: s.metin || "", durum: "yeni", ...konumAc(s.konum) });
        }
        d.kirli = true; d.pdfKirli = true;
        toast("Önceki oturumdan kaydedilememiş değişikliklerin cihazda bulundu; geri yüklendi ve gönderiliyor.", "bilgi", 6000);
        setTimeout(() => otoPlanla(300), 600);
      }
    }
    if (sifreli) {
      // PDF'e yazılamayan (şifreli/bozuk) dosyada geometri veritabanından geri yüklenir.
      for (const s of satirlar || []) {
        if (!s.konum) continue;
        const id = s.ek_id.replace(/^ae-/, "");
        d.model.set(id, { id, nm: s.ek_id, tur: s.tur === "yapiskan" ? "yapiskan" : s.tur, sayfa: s.sayfa, renk: s.renk || "#ffd400", yorum: s.yorum || "", metin: s.metin || "", durum: "ayni", ...konumAc(s.konum) });
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
    durumYaz(salt ? "Salt okunur." : "Hazır. Metin seçip vurgula ya da alttaki araçlardan birini seç.");
    metinDoldur();
    kanca("okuyucu:acildi", { kaynak: { id: kaynak.id, baslik: kaynak.baslik }, salt });
  });
  function kanca(ad, yuk) { kancaCalistir(ad, yuk, { salt, kaynakId: kaynak.id, sayfaSayisi: belge.numPages }).catch(() => {}); }
  function acKopya(a) { return { id: a.id, tur: a.tur, sayfa: a.sayfa, renk: a.renk, metin: a.metin || "", yorum: a.yorum || "" }; }
  eventBus.on("pagerendered", (e) => { tcAl(e.pageNumber); sayfaCiz(e.pageNumber); secKatmaniPlanla(); });
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
  function degisti() { d.kirli = true; d.pdfKirli = true; listeCiz(); kaydetDurumu(); taslagaYaz(); otoPlanla(); }
  function kaydetDurumu() {
    const b = q('[data-ak="kaydet"]');
    if (b) { b.textContent = "PDF'e işle"; b.classList.toggle("kirli", d.pdfKirli); b.title = d.pdfKirli ? "PDF dosyasına henüz işlenmemiş değişiklikler var (açıklamaların hesabında zaten kayıtlı). Kapatırken otomatik işlenir." : "PDF dosyası güncel."; }
    const c = q("[data-ak-oto]");
    if (c) c.textContent = salt ? "" : d.kirli ? "Kaydediliyor…" : d.sonOto ? `✓ Otomatik kaydedildi ${d.sonOto}` : "";
  }

  /* ---------- OTOMATİK KAYIT ----------
     Her değişiklik (vurgu, yorum, çizim, silme…) 1,2 sn sonra yalnızca VERİTABANINA (küçük satırlar) yazılır → "Kaydet'e basmayı unutma" riski yok
     ve R2'ye HİÇ yazılmaz. PDF dosyasına gömme (R2 yazımı) yalnızca okuyucu kapanırken ya da "PDF'e işle" ile, tek seferde yapılır. */
  const ozetOlustur = () => [...d.model.values()].map((a) => {
    const konum = {};
    for (const k of ["kutular", "cizgiler", "rect", "kalinlik", "yaziPt", "norm"]) if (a[k] !== undefined) konum[k] = a[k];
    Object.assign(konum, a.ekstra || {}, { sema: SEMA_SURUMU });      // bilinmeyen (başka modül/yeni sürüm) alanlar silinmeden korunur
    return { ek_id: a.nm || `ae-${a.id}`, tur: a.tur, sayfa: a.sayfa, metin: a.metin || null, yorum: a.yorum || null, renk: a.renk, konum };
  });
  /** Her değişiklik ÖNCE bu cihazın kalıcı deposuna (IndexedDB) yazılır: internet/elektrik giderse kayıp olmaz (bkz. taslak.js). */
  let taslakT = 0;
  function taslagaYaz() { if (salt || paylasimToken) return; taslakT = Date.now(); taslakYaz(kaynak.id, ozetOlustur()); }
  function otoPlanla(ms = 1200) { if (salt) return; clearTimeout(d.otoZaman); d.otoZaman = setTimeout(() => dbKaydet(), ms); }
  async function dbKaydet() {
    if (salt || !d.kirli) return true;
    if (d.otoCalisiyor) { otoPlanla(600); return false; }
    d.otoCalisiyor = true; clearTimeout(d.otoZaman);
    const anlik = ozetOlustur();
    try {
      const { error } = await supabase.rpc("akademik_aciklamalari_esitle", { p_kaynak_id: kaynak.id, p_aciklamalar: anlik });
      if (error) throw new Error(error.message);
      for (const a of d.model.values()) a.nm = a.nm || `ae-${a.id}`;
      kaynak.aciklama_db_otorite = true;
      if (JSON.stringify(anlik) === JSON.stringify(ozetOlustur())) taslakSil(kaynak.id, taslakT || Date.now()); else taslagaYaz();
      d.sonOto = new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      d.kirli = JSON.stringify(anlik) !== JSON.stringify(ozetOlustur());       // kayıt sırasında yeni değişiklik olduysa yeniden planla
      if (d.kirli) otoPlanla(300);
      kaydetDurumu();
      return true;
    } catch (h) {
      console.error("Otomatik kayıt:", h);
      durumYaz(`Bağlantı sorunu: değişiklikler bu cihazda güvende, bağlantı gelince otomatik gönderilecek.`, "uyari");
      otoPlanla(5000);
      return false;
    } finally { d.otoCalisiyor = false; }
  }
  // Sekme gizlenirken/kapanırken bekleyen kaydı hemen gönder (en iyi çaba).
  const gizlenince = () => { if (document.visibilityState === "hidden" && d.kirli) dbKaydet(); };
  document.addEventListener("visibilitychange", gizlenince);
  window.addEventListener("pagehide", () => { if (d.kirli) { taslagaYaz(); dbKaydet(); } });
  const cevrimici = () => { if (d.kirli) dbKaydet(); };
  window.addEventListener("online", cevrimici);
  function ekleModel(a, geriAlinabilir = true) {
    a.id = a.id || uuid();
    a.durum = "yeni";
    a.metin = a.metin || "";
    a.yorum = a.yorum || "";
    d.model.set(a.id, a);
    if (geriAlinabilir) d.undo.push({ tip: "ekle", id: a.id });
    sayfaCiz(a.sayfa);
    degisti();
    kanca("okuyucu:aciklama", { tip: "ekle", aciklama: acKopya(a) });
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
    kanca("okuyucu:aciklama", { tip: "sil", aciklama: acKopya(a) });
  }
  function guncelle(id, alanlar, geriAlinabilir = true) {
    const a = d.model.get(id);
    if (!a) return;
    if (geriAlinabilir) d.undo.push({ tip: "duzenle", id, onceki: Object.fromEntries(Object.keys(alanlar).map((k) => [k, a[k]])), durum: a.durum });
    Object.assign(a, alanlar);
    if (a.durum === "ayni") a.durum = "degisti";
    sayfaCiz(a.sayfa);
    degisti();
    kanca("okuyucu:aciklama", { tip: "guncelle", aciklama: acKopya(a) });
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
        /* yapışkan not: SVG değil, sürüklenebilir DOM işareti (pinleriCiz) */
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
    pinleriCiz(pv, no);

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

  const pdfKutusu = (a) => a.kutular ? rectBirlesim(a.kutular) : a.cizgiler ? rectBirlesim(a.cizgiler.map((c) => { const xs = c.filter((_, i) => i % 2 === 0), ys = c.filter((_, i) => i % 2); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; })) : a.rect;
  function kutuPx(a, vp) {
    const r = pdfKutusu(a);
    const [ax, ay] = vp.convertToViewportPoint(r[0], r[1]);
    const [bx, by] = vp.convertToViewportPoint(r[2], r[3]);
    return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
  }

  /* ---------- yapışkan not işaretleri: sürüklenebilir DOM düğmeleri ----------
     Konum PDF uzayında (rect) + sayfa yüzdesi olarak (norm) saklanır → yakınlaştırmadan/pencere boyutundan bağımsız. */
  function pinKatmani(pv) {
    let pk = pv.div.querySelector(":scope > .ak-pinkat");
    if (!pk) { pk = el("div", { class: "ak-pinkat" }); pv.div.append(pk); }
    return pk;
  }
  function yuvarla(v, n = 2) { return Number(v.toFixed(n)); }
  function pinleriCiz(pv, no) {
    const pk = pinKatmani(pv);
    pk.querySelectorAll(".ak-pin").forEach((n) => n.remove());
    const vp = pv.viewport, W = vp.width, H = vp.height;
    const N = NOT_BOYUTU * Math.min(1.4, Math.max(0.8, vp.scale));
    for (const a of d.model.values()) {
      if (a.sayfa !== no || a.tur !== "yapiskan" || !a.rect) continue;
      const [ax, ay] = vp.convertToViewportPoint(a.rect[0], a.rect[1]), [bx, by] = vp.convertToViewportPoint(a.rect[2], a.rect[3]);
      const pin = el("button", { type: "button", class: `ak-pin${salt ? " salt" : ""}${d.secili === a.id ? " secili" : ""}`, "data-id": a.id, title: salt ? "Not" : "Notu taşımak için sürükle, düzenlemek için tıkla", "aria-label": "Yapışkan not" }, a.yorum ? "✎" : "");
      pin.style.left = `${(Math.min(ax, bx) / W) * 100}%`; pin.style.top = `${(Math.min(ay, by) / H) * 100}%`;
      pin.style.width = `${N}px`; pin.style.height = `${N}px`; pin.style.background = a.renk;
      pin.addEventListener("click", (e) => { e.stopPropagation(); if (Date.now() - d.pinSurukleme < 450) return; balonGizle(); sec(a.id); });
      if (!salt) pinSurukle(pin, a.id, pv);
      pk.append(pin);
    }
  }
  function pinSurukle(pin, id, pv) {
    let o = null;
    pin.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const a = d.model.get(id);
      if (!a) return;
      e.stopPropagation();                                              // çizim aracı / kenar tıklaması başlamasın
      const vp = pv.viewport, kr = pin.parentElement.getBoundingClientRect(), pr = pin.getBoundingClientRect();
      const sx = vp.width / kr.width, sy = vp.height / kr.height;
      o = { x0: e.clientX, y0: e.clientY, sol: (pr.left - kr.left) * sx, ust: (pr.top - kr.top) * sy, sx, sy, N: pr.width * sx, Nh: pr.height * sy, vx: (pr.left - kr.left) * sx, vy: (pr.top - kr.top) * sy, hareket: false, id: e.pointerId };
      try { pin.setPointerCapture(e.pointerId); } catch { /* yok say */ }
    });
    pin.addEventListener("pointermove", (e) => {
      if (!o || e.pointerId !== o.id) return;
      const dx = e.clientX - o.x0, dy = e.clientY - o.y0;
      if (!o.hareket) { if (Math.hypot(dx, dy) < 5) return; o.hareket = true; pin.classList.add("surukleniyor"); popKapat(); balonGizle(); }
      const vp = pv.viewport;
      o.vx = Math.max(0, Math.min(vp.width - o.N, o.sol + dx * o.sx));       // sayfanın dışına çıkamaz
      o.vy = Math.max(0, Math.min(vp.height - o.Nh, o.ust + dy * o.sy));
      pin.style.left = `${(o.vx / vp.width) * 100}%`; pin.style.top = `${(o.vy / vp.height) * 100}%`;
      if (e.cancelable) e.preventDefault();
    });
    const bitir = (e, iptal) => {
      if (!o || e.pointerId !== o.id) return;
      const c = o; o = null;
      try { pin.releasePointerCapture(e.pointerId); } catch { /* yok say */ }
      pin.classList.remove("surukleniyor");
      if (!c.hareket) return;
      d.pinSurukleme = Date.now();                                            // sürükleme sonrası gelen "click" yok sayılır
      const a = d.model.get(id);
      if (!a) return;
      if (iptal) { sayfaCiz(a.sayfa); return; }
      const vp = pv.viewport;
      const [nx, ny] = vp.convertToPdfPoint(c.vx, c.vy), [ox, oy] = vp.convertToPdfPoint(c.sol, c.ust);
      const dx = nx - ox, dy = ny - oy, r = a.rect;
      guncelle(id, { rect: [yuvarla(r[0] + dx), yuvarla(r[1] + dy), yuvarla(r[2] + dx), yuvarla(r[3] + dy)], norm: { x: yuvarla(c.vx / vp.width, 5), y: yuvarla(c.vy / vp.height, 5), w: yuvarla(c.N / vp.width, 5), h: yuvarla(c.Nh / vp.height, 5) } });
    };
    pin.addEventListener("pointerup", (e) => bitir(e, false));
    pin.addEventListener("pointercancel", (e) => bitir(e, true));
    pin.addEventListener("keydown", (e) => {                                  // klavye: oklarla taşı (Shift = 4×)
      const adim = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
      const a = d.model.get(id);
      if (!adim || !a) return;
      e.preventDefault(); e.stopPropagation();
      const k = (e.shiftKey ? 16 : 4), r = a.rect;
      guncelle(id, { rect: [r[0] + adim[0] * k, r[1] + adim[1] * k, r[2] + adim[0] * k, r[3] + adim[1] * k] });
      kok.querySelector(`.ak-pin[data-id="${CSS.escape(id)}"]`)?.focus();
    });
  }
  /** Kenar çubuğundan seçilen açıklamanın satırını kısa süre parlatır. */
  function flasla(a) {
    const pv = sayfaGorunumu(a.sayfa);
    if (!pv?.div || !pv.viewport) return;
    const b = kutuPx(a, pv.viewport), W = pv.viewport.width, H = pv.viewport.height, pay = 3;
    const f = el("div", { class: "ak-flas ak-flas-kutu", "aria-hidden": "true" });
    f.style.left = `${((b.x - pay) / W) * 100}%`; f.style.top = `${((b.y - pay) / H) * 100}%`;
    f.style.width = `${((b.w + pay * 2) / W) * 100}%`; f.style.height = `${((b.h + pay * 2) / H) * 100}%`;
    pinKatmani(pv).append(f);
    setTimeout(() => f.remove(), 1700);
  }
  function aciklamayaOdaklan(a) {
    if (window.innerWidth <= 900) kok.classList.add("yan-kapali");
    setTimeout(() => {
      const r = pdfKutusu(a);
      try { viewer.scrollPageIntoView({ pageNumber: a.sayfa, destArray: [null, { name: "XYZ" }, Math.max(0, r[0] - 24), r[3] + 80, null] }); }
      catch { viewer.currentPageNumber = a.sayfa; }
      setTimeout(() => { sec(a.id); flasla(a); }, 350);
    }, 120);
  }

  /* ---------- seçili açıklama + düzenleme balonu ---------- */
  document.addEventListener("pointerdown", (e) => { if (pop && !e.target.closest(".ak-pop, .ak-kat, .ak-pin, .ak-liste-oge, .ak-balon")) { if (d.kirli) dbKaydet(); sec(null); } });
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
    alan.addEventListener("input", () => { a.yorum = alan.value; if (a.durum === "ayni") a.durum = "degisti"; d.kirli = true; d.pdfKirli = true; kaydetDurumu(); taslagaYaz(); otoPlanla(1500); });
    alan.addEventListener("change", () => { listeCiz(); sayfaCiz(a.sayfa); otoPlanla(300); });
    alan.addEventListener("blur", () => { if (d.kirli) otoPlanla(200); });
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
    const dar = window.matchMedia("(max-width: 700px), (pointer: coarse)").matches;
    if (dar) {
      // Telefon/tablet: ekranın altında "alt sayfa" — klavye açılınca görünür alanın hemen üstünde kalır, yazdığın metni örtmez.
      pop.classList.add("ak-pop-alt");
      const konumla = () => { const vv = window.visualViewport; pop.style.bottom = vv ? `${Math.max(0, window.innerHeight - vv.height - vv.offsetTop)}px` : "0px"; };
      konumla();
      window.visualViewport?.addEventListener("resize", konumla);
      window.visualViewport?.addEventListener("scroll", konumla);
      const eskiKaldir = pop.remove.bind(pop);
      pop.remove = () => { window.visualViewport?.removeEventListener("resize", konumla); window.visualViewport?.removeEventListener("scroll", konumla); eskiKaldir(); };
    } else {
      // Masaüstü: açıklamanın yanında; sığmıyorsa üstüne ya da yanına çevrilir, her zaman okuyucu alanının içinde kalır.
      const gen = Math.min(320, govde.width - 16);
      pop.style.width = `${gen}px`;
      const yuk = pop.offsetHeight || 220;
      const solX = kr.left + b.x - govde.left;
      let top = kr.top + b.y + b.h + 8 - govde.top;
      if (top + yuk > govde.height - 8) top = kr.top + b.y - yuk - 8 - govde.top;       // altına sığmadı → üstüne
      pop.style.left = `${Math.max(8, Math.min(govde.width - gen - 8, solX))}px`;
      pop.style.top = `${Math.max(8, Math.min(govde.height - yuk - 8, top))}px`;
    }
    if (odak) setTimeout(() => alan.focus({ preventScroll: true }), 0);
  }

  /* ---------- yan panel ---------- */
  function listeCiz() {
    const liste = q("[data-ak-liste]");
    const ft = q('[data-ak="f-tur"]').value, fr = q('[data-ak="f-renk"]').value;
    const aranan = (q('[data-ak="f-ara"]')?.value || "").trim().toLocaleLowerCase("tr");
    const hepsi = [...d.model.values()].sort((a, b) => a.sayfa - b.sayfa || (b.rect?.[3] ?? b.kutular?.[0]?.[3] ?? 0) - (a.rect?.[3] ?? a.kutular?.[0]?.[3] ?? 0));
    q("[data-ak-adet]").textContent = hepsi.length;
    const goster = hepsi.filter((a) => (!ft || a.tur === ft) && (!fr || a.renk === fr) && (!aranan || `${a.metin || ""} ${a.yorum || ""}`.toLocaleLowerCase("tr").includes(aranan)));
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

  /** Dosyadan gelen metin-işaretlemelerin alıntı metnini PDF metin katmanından çıkarır.
   *  Kutu bir metin öğesini KISMEN kapsıyorsa (örn. satırın ortasından başlayan vurgu) karakter oranıyla ilgili kısım alınır ve kelime sınırına tamamlanır. */
  async function metinDoldur() {
    const eksik = [...d.model.values()].filter((a) => METIN_TURLERI.has(a.tur) && !a.metin && a.kutular?.length);
    if (!eksik.length) { listeCiz(); return; }
    const sayfalar = [...new Set(eksik.map((a) => a.sayfa))];
    let doldu = 0;
    for (const no of sayfalar) {
      try {
        const sayfa = await belge.getPage(no);
        const tc = await sayfa.getTextContent();
        const ogeler = tc.items.filter((it) => it.str && it.transform && Math.abs(it.transform[1]) <= 0.01 && Math.abs(it.transform[2]) <= 0.01 && (it.width || 0) > 0);
        for (const a of eksik.filter((x) => x.sayfa === no)) {
          const secim = new Map();
          ogeler.forEach((it, idx) => {
            const ix1 = it.transform[4], gen = it.width, n = it.str.length;
            const h = Math.abs(it.transform[3]) || it.height || 0;
            const alt = it.transform[5] - 0.22 * h, ust = it.transform[5] + 0.8 * h;
            for (const k of a.kutular) {
              if (Math.min(ust, k[3]) - Math.max(alt, k[1]) <= (ust - alt) * 0.3) continue;
              if (Math.min(ix1 + gen, k[2]) - Math.max(ix1, k[0]) <= 0) continue;
              const i1 = Math.round(Math.max(0, (k[0] - ix1) / gen) * n), i2 = Math.round(Math.min(1, (k[2] - ix1) / gen) * n);
              if (i2 <= i1) continue;
              const o = secim.get(idx);
              secim.set(idx, o ? [Math.min(o[0], i1), Math.max(o[1], i2)] : [i1, i2]);
            }
          });
          const parcalar = [];
          for (const [idx, [i1, i2]] of [...secim].sort((x, y) => x[0] - y[0])) {
            const t = ogeler[idx].str; let b = i1, e = i2;
            while (b > 0 && KELIME_HARF.test(t[b - 1]) && KELIME_HARF.test(t[b] || "")) b--;
            while (e < t.length && KELIME_HARF.test(t[e - 1] || "") && KELIME_HARF.test(t[e])) e++;
            parcalar.push(t.slice(b, e));
          }
          const metin = parcalar.join(" ").replace(/\s+/g, " ").trim();
          if (metin) { a.metin = metin; doldu++; }
        }
      } catch { /* o sayfa atlanır */ }
    }
    listeCiz();
    // Çıkarılan alıntı metni, veritabanı otoriteli kaynaklarda kalıcı olur (kenar çubuğunda boş "Vurgu s.N" satırı kalmaz).
    if (doldu && !salt && !paylasimToken && kaynak.aciklama_db_otorite) { d.kirli = true; taslagaYaz(); otoPlanla(2500); }
  }

  /* ---------- metin seçiminden açıklama ---------- */
  /* Seçim anlık görüntüsü: dokunmatikte balon düğmesine dokunmak tarayıcının seçimini çökertir (mobilde "seçim geri kayboluyor"
     sorununun kök nedeni). Seçim yapıldığı anda aralık KOPYALANIR; eylem anında seçim boşsa kopya geri yüklenir. */
  let sonSecim = null;               // { aralik: Range, metin: string }
  let balonDokunuyor = false;
  const dokunmatik = window.matchMedia?.("(pointer: coarse)").matches || "ontouchstart" in window;
  function secimYakala() {
    const s = window.getSelection();
    if (!s || s.isCollapsed || !s.rangeCount || !kap.contains(s.anchorNode)) return false;
    const a = hizaliAralik(kap, s.getRangeAt(0));
    const metin = aralikMetni(a);
    if (!metin) return false;
    sonSecim = { aralik: a, metin, t: Date.now() };
    return true;
  }
  function secimiGeriYukle() {
    const s = window.getSelection();
    if (s && s.isCollapsed && sonSecim) { try { s.removeAllRanges(); s.addRange(sonSecim.aralik); } catch { /* düğüm DOM'dan gitmiş olabilir */ } }
    return !!s && !s.isCollapsed;
  }
  /* ---------- eklentiler (çeviri, sözlük, Vikipedi, Crossref, arama bağlantıları) ---------- */
  let ekAyar = null, ekListe = [];                         // yetki + ayar yüklenince dolar; yüklenene kadar balonda eklenti yok
  eklentilerAcikMi().then((acik) => (acik ? ayarYukle() : null)).then((a) => { if (a) { ekAyar = a; ekListe = acikEklentiler(a); } }).catch(() => {});
  function eklentiDugmeleri() {
    return ekListe.map((x) => el("button", { type: "button", class: "ak-btn", "data-eklenti": x.id, title: x.ad, "aria-label": x.ad }, x.simge));
  }
  async function eklentiCalistir(id) {
    const metin = sonSecim?.metin;
    if (!metin) { toast("Önce metin seç.", "uyari"); return; }
    const govde = q(".ak-ok-govde");
    govde.querySelector(".ak-eklenti-sonuc")?.remove();
    const kutu = el("aside", { class: "ak-eklenti-sonuc", role: "dialog", "aria-label": "Eklenti sonucu" });
    const bas = el("strong", {}, "…"), icerik = el("p", { class: "ak-eklenti-metin" }, "Çalışıyor…"), alt = el("small", { class: "ak-eklenti-not" });
    const kapat = el("button", { type: "button", class: "ak-btn", "aria-label": "Kapat" }, "✕");
    const kopya = el("button", { type: "button", class: "ak-btn", hidden: true }, "⧉ Kopyala");
    kapat.addEventListener("click", () => kutu.remove());
    kutu.append(el("div", { class: "ak-eklenti-ust" }, bas, kapat), icerik, alt, el("div", { class: "ak-eklenti-eylem" }, kopya));
    // Sonuç kutusuna dokunmak seçimi bozmasın
    ["mousedown", "pointerdown"].forEach((o) => kutu.addEventListener(o, (e) => { if (!e.target.closest("button, a")) return; e.preventDefault(); }));
    govde.append(kutu);
    balonGizle();
    try {
      const s = await eklentiYurut(id, metin, ekAyar);
      bas.textContent = s.baslik || "Sonuç";
      if (s.ac) { window.open(s.ac, "_blank", "noopener,noreferrer"); icerik.textContent = "Sonuç yeni sekmede açıldı."; }
      else icerik.textContent = s.metin || "";
      if (s.not) alt.textContent = s.not;
      if (s.baglanti) { const a = el("a", { href: s.baglanti, target: "_blank", rel: "noopener noreferrer" }, "Kaynağı aç ↗"); alt.append(alt.textContent ? " · " : "", a); }
      if (s.metin) { kopya.hidden = false; kopya.addEventListener("click", async () => { await panoyaKopyala(s.metin); toast("Kopyalandı.", "basari"); }); }
      for (const ey of s.eylemler || []) {
        const b = el("button", { type: "button", class: "ak-btn" }, ey.ad);
        b.addEventListener("click", async () => {
          if (ey.kopyala) { await panoyaKopyala(ey.kopyala); toast("Kopyalandı.", "basari"); return; }
          b.disabled = true; try { const r = await ey.calistir(); icerik.textContent = `${s.metin}\n\n${r.metin}`; } catch (h) { icerik.textContent = `${s.metin}\n\n${h.message}`; } b.disabled = false;
        });
        kutu.querySelector(".ak-eklenti-eylem").append(b);
      }
    } catch (h) { bas.textContent = "Eklenti çalışmadı"; icerik.textContent = h.message || String(h); }
  }

  /* ---------- OTOMATİK ANINDA ÇEVİRİ ----------
     GİZLİLİK: "Otomatik Anında Çeviri (Gizlilik Modu)" ayarı KAPALIYSA seçimde hiçbir ağ isteği yapılmaz; çeviri yalnızca "Çevir" düğmesiyle çalışır.
     Açıkken yalnızca seçim DURULUNCA (balon açılırken / işaretleme uygulanırken) ve yalnızca Türkçe olmayan, 3–600 karakterlik metin gönderilir. */
  const otoOnbellek = new Map();
  let otoIptal = null;
  const TR_HARF = /[çğıöşüÇĞİÖŞÜ]/;
  const TR_KELIME = /^(ve|bir|bu|için|ile|olarak|olan|daha|gibi|çok|ama|veya|de|da|ki|ne|mi|ise|her|çünkü)$/i;
  /** Seçimden çeviri metni: satır sonu tire bölünmeleri (“kar-\nşılaştır”) birleşir, boşluklar sadeleşir; paragraf/sayfa atlayan seçim tek metin olur. */
  const otoMetin = (ham) => String(ham || "").replace(/[\u00ad\u200b]/g, "").replace(/(\p{Ll})-[ \t]*\r?\n[ \t]*(\p{Ll})/gu, "$1$2").replace(/\s+/g, " ").trim();
  /** Gönderilsin mi? Uzunluk sınırı yok (6000 karaktere kadar parça parça çevrilir). Metin zaten Türkçeyse ve hedef Türkçeyse gönderilmez. */
  function otoUygunMu(m, hedef = "tr", kaynak = "auto") {
    if (m.length < 3 || !/\p{L}{2,}/u.test(m)) return false;
    if (hedef !== "tr" || kaynak !== "auto") return true;
    if (TR_HARF.test(m)) return false;
    const kel = m.split(/\s+/);
    return !(kel.length >= 4 && kel.filter((k) => TR_KELIME.test(k.replace(/[^\p{L}]/gu, ""))).length / kel.length > 0.2);
  }
  /** Çeviri kartı: kaynak/hedef dil seçicileri, kendi içinde kaydırılan metin, kopyala/küçült/kapat. Masaüstünde sağ altta, mobilde alt panel (en çok ekranın ~⅓'ü). */
  let otoKart = null;
  let otoSira = 0;
  async function otoCeviriKarti(ham) {
    const m = otoMetin(ham), sira = ++otoSira;
    let ayar;
    try { if (!(await eklentilerAcikMi())) return; ayar = await ayarYukle(); } catch { return; }
    if (sira !== otoSira || !otoCeviriAcikMi(ayar)) return;                                // ayar kapalı → HİÇBİR istek yok
    const c0 = ayar.ayar?.ceviri || {};
    if (!otoUygunMu(m, c0.hedef || "tr", c0.kaynak || "auto")) return;
    otoKart?.kart.remove(); otoIptal?.abort();
    const bu = { kart: null }; otoKart = bu;
    const sec = (secenekler, deger, etiket) => { const s = el("select", { class: "ak-oto-dil", "aria-label": etiket }); for (const [k, v] of Object.entries(secenekler)) s.append(el("option", { value: k }, v)); s.value = deger; return s; };
    const kaynakSec = sec({ auto: "Algıla", ...DIL_SECENEKLERI }, c0.kaynak || "auto", "Kaynak dil"), hedefSec = sec(DIL_SECENEKLERI, c0.hedef || "tr", "Hedef dil");
    const govde = el("div", { class: "ak-oto-metin", tabindex: "0", role: "status", "aria-live": "polite" }, "Çevriliyor…");
    const kopyaBtn = el("button", { type: "button", class: "ak-btn ak-oto-ik", "aria-label": "Çeviriyi kopyala", title: "Çeviriyi kopyala" }, "⧉");
    const kucukBtn = el("button", { type: "button", class: "ak-btn ak-oto-ik", "aria-label": "Küçült / büyüt", title: "Küçült / büyüt" }, "▾");
    const kapatBtn = el("button", { type: "button", class: "ak-btn ak-oto-ik", "aria-label": "Kapat", title: "Kapat" }, "✕");
    const kart = el("div", { class: "ak-oto-kart", role: "dialog", "aria-label": "Otomatik çeviri" },
      el("div", { class: "ak-oto-ust" }, kaynakSec, el("span", { "aria-hidden": "true" }, "→"), hedefSec, kopyaBtn, kucukBtn, kapatBtn), govde);
    bu.kart = kart; let son = "";
    kapatBtn.addEventListener("click", () => { kart.remove(); otoIptal?.abort(); });
    kucukBtn.addEventListener("click", () => { const k = kart.classList.toggle("ak-oto-kucuk"); kucukBtn.textContent = k ? "▴" : "▾"; });
    kopyaBtn.addEventListener("click", async () => { if (son) { await panoyaKopyala(son); toast("Çeviri kopyalandı.", "basari"); } });
    q(".ak-ok-govde").append(kart);
    const konumla = () => {                                            // mobilde alttaki işlem çubuğunun (balon) ÜSTÜNE otur; üst üste binip düğmeleri örtmesin
      const balon = q(".ak-balon"); kart.style.bottom = "";
      if (balon && !balon.hidden && window.matchMedia("(max-width: 720px)").matches) { const r = balon.getBoundingClientRect(); if (r.height > 0 && r.top > 0) kart.style.bottom = `${Math.max(8, window.innerHeight - r.top + 8)}px`; }
    };
    konumla(); requestAnimationFrame(konumla);
    const cevir = async () => {
      const kaynakDil = kaynakSec.value, hedef = hedefSec.value, motor = (ayar.ayar?.ceviri || {}).motor || "auto", anahtar = `${motor}|${kaynakDil}|${hedef}|${m}`;
      otoIptal?.abort(); const ac = new AbortController(); otoIptal = ac; son = "";
      const yaz = (metin, not) => { govde.replaceChildren(...(not ? [el("small", {}, not)] : []), metin); };
      try {
        let sonuc = otoOnbellek.get(anahtar);
        if (sonuc === undefined) {
          govde.textContent = "Çevriliyor…";
          const r = await ceviriUzun(m, { kaynak: kaynakDil, hedef, motor, otomatik: true, sinyal: ac.signal, ilerle: (kismi, i, n) => { if (bu.kart?.isConnected && !ac.signal.aborted) { son = kismi; yaz(kismi, n > 1 ? `Çevriliyor… ${i}/${n}` : ""); } } });
          if (ac.signal.aborted) return;
          sonuc = { metin: r.metin, dil: r.algilanan || "", kesildi: !!r.kesildi };
          if (otoOnbellek.size > 100) otoOnbellek.delete(otoOnbellek.keys().next().value);
          otoOnbellek.set(anahtar, sonuc);
        }
        if (!bu.kart?.isConnected) return;
        son = sonuc.metin;
        if (kaynakDil === "auto" && sonuc.dil && sonuc.dil === hedef && hedef === "tr") { kart.remove(); return; }       // zaten Türkçe → gösterme
        yaz(sonuc.metin, `${sonuc.dil ? `${DIL_SECENEKLERI[sonuc.dil] || sonuc.dil} → ` : ""}${DIL_SECENEKLERI[hedef] || hedef}${sonuc.kesildi ? " · metin çok uzundu, ilk 6000 karakter çevrildi" : ""}`);
      } catch (h) {
        if (h?.name === "AbortError" || !bu.kart?.isConnected) return;
        govde.textContent = "Otomatik çeviri yapılamadı. Dilleri değiştirip tekrar dene ya da balondaki “Çevir” düğmesini kullan.";
      }
    };
    const kaydet = async () => {                                       // dil seçimi kalıcı (kaynak/hedef ayarı)
      try { const a = await ayarYukle(); const c = { ...(a.ayar?.ceviri || {}), kaynak: kaynakSec.value, hedef: hedefSec.value }; await ayarKaydet({ ...a, ayar: { ...(a.ayar || {}), ceviri: c } }); } catch { /* ayar kaydedilemedi: bu çeviri yine de çalışır */ }
    };
    for (const s of [kaynakSec, hedefSec]) s.addEventListener("change", () => { kaydet(); cevir(); });
    cevir();
  }
  const otoCeviriGoster = (ham) => { otoCeviriKarti(ham); };

  /** Alıntı metni: “seçim” (Yazar, Yıl, s. N) — kaynaktaki yazar/yıl bilgisinden. */
  function metniAlintiYap(metin, sayfaNo) {
    const ys = (kaynak.yazarlar || []).map((y) => y.kurum || y.soyadi).filter(Boolean);
    const yazar = ys.length === 0 ? "" : ys.length === 1 ? ys[0] : ys.length === 2 ? `${ys[0]} ve ${ys[1]}` : `${ys[0]} vd.`;
    const yil = kaynak.yayin_yili || "t.y.";
    const kunye = [yazar, yil, sayfaNo ? `s. ${sayfaNo}` : ""].filter(Boolean).join(", ");
    return `“${metin.replace(/\s+/g, " ").trim()}” (${kunye})`;
  }
  function secimSayfasi() {
    const dugum = sonSecim?.aralik?.startContainer;
    const sayfa = (dugum?.nodeType === 1 ? dugum : dugum?.parentElement)?.closest?.(".page");
    return sayfa ? Number(sayfa.dataset.pageNumber) : null;
  }

  /** Aralığın METİN düğümlerinden satır kutuları (endOfContent/kapsayıcı kutuları DEĞİL → "çift katman" ve dev kutular oluşmaz). */
  function metinKutulari(aralik) {
    const kok0 = aralik.commonAncestorContainer.nodeType === 1 ? aralik.commonAncestorContainer : aralik.commonAncestorContainer.parentElement;
    if (!kok0) return [];
    const yurume = document.createTreeWalker(kok0, NodeFilter.SHOW_TEXT);
    const cikti = [];
    for (let n = yurume.nextNode(); n; n = yurume.nextNode()) {
      if (!aralik.intersectsNode(n) || !n.nodeValue?.trim() || n.parentElement?.closest(".endOfContent")) continue;
      const t = n.nodeValue;
      let bas = n === aralik.startContainer ? aralik.startOffset : 0, son = n === aralik.endContainer ? aralik.endOffset : t.length;
      while (bas < son && /\s/.test(t[bas])) bas++;                       // baştaki/sondaki boşluk kutuyu satır dışına taşırmasın
      while (son > bas && /\s/.test(t[son - 1])) son--;
      if (son <= bas) continue;
      const r = document.createRange();
      r.setStart(n, bas); r.setEnd(n, son);
      for (const c of r.getClientRects()) if (c.width > 0.5 && c.height > 0.5) cikti.push(c);
    }
    if (cikti.length > 3) {                                            // satır yüksekliğinin çok üstündeki aykırı kutuları ele
      const yuk = cikti.map((c) => c.height).sort((x, y) => x - y), med = yuk[Math.floor(yuk.length / 2)];
      return cikti.filter((c) => c.height <= med * 2.2);
    }
    return cikti;
  }
  const kutuOrtusme = (x, y) => { const ox = Math.min(x[2], y[2]) - Math.max(x[0], y[0]), oy = Math.min(x[3], y[3]) - Math.max(x[1], y[1]); if (ox <= 0 || oy <= 0) return 0; return (ox * oy) / Math.min((x[2] - x[0]) * (x[3] - x[1]), (y[2] - y[0]) * (y[3] - y[1])); };
  /** PDF metin içeriği (sayfa başına, önbellekli): vurgu kutularını gerçek metin satırlarına kırpmak için. */
  function tcAl(no) {
    if (d.tcHazir.has(no)) return;
    d.tcHazir.set(no, null);
    belge.getPage(no).then((sf) => sf.getTextContent()).then((tc) => { d.tcHazir.set(no, tc.items.filter((it) => it.str && it.transform)); }).catch(() => d.tcHazir.delete(no));
  }
  /** Ham getClientRects kutularını (PDF uzayı) temizler: sayfa sınırına, ve satırın gerçek metin öğelerinin yatay/dikey kapsamına kırpar. */
  function kutuTemizle(pv, no, kutular) {
    const [vx1, vy1, vx2, vy2] = pv.viewport.viewBox || [0, 0, pv.viewport.width / pv.viewport.scale, pv.viewport.height / pv.viewport.scale];
    const ogeler = d.tcHazir.get(no);
    const cikti = [];
    for (const k0 of kutular) {
      let k = [Math.max(Math.min(vx1, vx2), k0[0]), Math.max(Math.min(vy1, vy2), k0[1]), Math.min(Math.max(vx1, vx2), k0[2]), Math.min(Math.max(vy1, vy2), k0[3])];
      if (k[2] - k[0] < 0.5 || k[3] - k[1] < 0.5) continue;
      if (ogeler) {
        const cy = (k[1] + k[3]) / 2;
        let x1 = Infinity, x2 = -Infinity, y1 = Infinity, y2 = -Infinity;
        for (const it of ogeler) {
          const t = it.transform;
          if (Math.abs(t[1]) > 0.01 || Math.abs(t[2]) > 0.01) continue;     // yalnızca düz (dönmemiş) metin
          const h = Math.abs(t[3]) || it.height || 0;
          if (!h) continue;
          const alt = t[5] - 0.22 * h, ust = t[5] + 0.8 * h;
          if (cy < alt || cy > ust) continue;
          x1 = Math.min(x1, t[4]); x2 = Math.max(x2, t[4] + (it.width || 0)); y1 = Math.min(y1, alt); y2 = Math.max(y2, ust);
        }
        if (x2 > x1) {
          const nk = [Math.max(k[0], x1), Math.max(k[1], y1), Math.min(k[2], x2), Math.min(k[3], y2)];
          if (nk[2] - nk[0] >= 0.5 && nk[3] - nk[1] >= 0.5) k = nk;
        }
      }
      cikti.push(k);
    }
    return cikti;
  }
  /** Aralığın dokunduğu her sayfa için TEMİZLENMİŞ satır kutuları (PDF uzayı). Vurgu, alt/üst çizgi ve seçim katmanı AYNI kaynağı kullanır. */
  function sayfaKutulari(aralik) {
    const sonuc = [];
    kap.querySelectorAll(".page").forEach((sayfaDiv) => {
      const tl = sayfaDiv.querySelector(".textLayer");
      if (!tl || !aralik.intersectsNode(tl)) return;
      const r = document.createRange();
      r.selectNodeContents(tl);
      if (aralik.compareBoundaryPoints(Range.START_TO_START, r) > 0) r.setStart(aralik.startContainer, aralik.startOffset);
      if (aralik.compareBoundaryPoints(Range.END_TO_END, r) < 0) r.setEnd(aralik.endContainer, aralik.endOffset);
      if (r.collapsed) return;
      const no = Number(sayfaDiv.dataset.pageNumber);
      const pv = sayfaGorunumu(no);
      const kat = katman(pv);
      if (!pv || !kat) return;
      const kutular = kutulariBirlestir(kutuTemizle(pv, no, metinKutulari(r).map((c) => istemciRectPdf(pv, kat, c.left, c.top, c.right, c.bottom))));
      if (kutular.length) sonuc.push({ no, pv, kat, r, kutular });
    });
    return sonuc;
  }

  /* ---------- TEK seçim katmanı ----------
     Yerel ::selection şeffaf (CSS); seçimi YALNIZCA burada, vurguyla AYNI temizlenmiş gerçek getClientRects kutularından çiziyoruz.
     Böylece "iki mavi katman", satır sonu şeritleri ve yakınlaştırmada kayma olmaz. Çizilemezse yerel renge geri dönülür. */
  function secimKatmaniCiz() {
    d.secKare = 0;
    try {
      kap.querySelectorAll(".ak-sec").forEach((n) => n.replaceChildren());
      const s = window.getSelection();
      const katmanlar = kap.querySelectorAll(".textLayer");
      if (!s || s.isCollapsed || !s.rangeCount || !kap.contains(s.anchorNode)) { katmanlar.forEach((n) => n.classList.remove("ak-yerel-secim")); return; }
      const parcalar = sayfaKutulari(hizaliAralik(kap, s.getRangeAt(0)));
      katmanlar.forEach((n) => n.classList.toggle("ak-yerel-secim", !parcalar.length));
      for (const { pv, kutular } of parcalar) {
        let sk = pv.div.querySelector(":scope > .ak-sec");
        if (!sk) { sk = el("div", { class: "ak-sec", "aria-hidden": "true" }); pv.div.append(sk); }
        const vp = pv.viewport, W = vp.width, H = vp.height;
        for (const k of kutular) {
          const [ax, ay] = vp.convertToViewportPoint(k[0], k[1]), [bx, by] = vp.convertToViewportPoint(k[2], k[3]);
          const kutu = document.createElement("i");
          kutu.style.left = `${(Math.min(ax, bx) / W) * 100}%`; kutu.style.top = `${(Math.min(ay, by) / H) * 100}%`;
          kutu.style.width = `${(Math.abs(bx - ax) / W) * 100}%`; kutu.style.height = `${(Math.abs(by - ay) / H) * 100}%`;
          sk.append(kutu);
        }
      }
    } catch (h) { console.warn("Seçim katmanı çizilemedi; yerel seçim rengine dönüldü:", h); kap.querySelectorAll(".textLayer").forEach((n) => n.classList.add("ak-yerel-secim")); }
  }
  function secKatmaniPlanla() { if (!d.secKare) d.secKare = requestAnimationFrame(secimKatmaniCiz); }

  function secimdenOlustur(tur, renk = d.renk) {
    // Canlı seçim yoksa (iOS balona dokununca seçimi çökertir) saklı aralık kullanılır; seçim DOM'a GERİ YÜKLENMEZ ve ASLA DEĞİŞTİRİLMEZ.
    const s = window.getSelection();
    const canli = s && !s.isCollapsed && s.rangeCount;
    const aralik = canli ? hizaliAralik(kap, s.getRangeAt(0)) : sonSecim?.aralik;     // kelime ortasında kesilmiş seçim → tam kelime (kopya üzerinde)
    if (!aralik) return false;
    const aracModu = METIN_TURLERI.has(d.arac) && tur === d.arac;
    let olustu = 0, tekrar = 0; const tumMetin = [];
    for (const { no, r, kutular } of sayfaKutulari(aralik)) {
      const metin = aralikMetni(r);
      if (!metin) continue;
      // aynı türde, aynı yeri kaplayan açıklama zaten varsa ikinci kez ekleme (üst üste binen "çift kat" çizgiler)
      const ayni = [...d.model.values()].some((a) => a.tur === tur && a.sayfa === no && a.kutular && kutular.every((k) => a.kutular.some((x) => kutuOrtusme(k, x) > 0.85)));
      if (ayni) { tekrar++; continue; }
      ekleModel({ tur, sayfa: no, kutular, renk, metin });
      tumMetin.push(metin);
      olustu++;
    }
    if (olustu || tekrar) { try { s?.removeAllRanges(); } catch { /* yok say */ } sonSecim = null; secKatmaniPlanla(); }
    if (tekrar && !olustu) toast("Bu metne zaten aynı işaretleme yapılmış.", "uyari");
    balonGizle();
    if (olustu && aracModu) otoCeviriKarti(tumMetin.join(" "));
    return olustu > 0;
  }

  /* seçim balonu (imleç modunda metin seçilince çıkar) */
  let balon = null;
  function balonGizle() { balon?.remove(); balon = null; }
  function balonGoster() {
    balonGizle();
    const s = window.getSelection();
    if (!s || s.isCollapsed || !s.rangeCount || !kap.contains(s.anchorNode)) return;
    secimYakala();
    const rs = (sonSecim?.aralik || s.getRangeAt(0)).getClientRects();
    if (!rs.length) return;
    const son = rs[rs.length - 1];
    const govde = q(".ak-ok-govde").getBoundingClientRect();
    balon = el("div", { class: "ak-balon", role: "toolbar", "aria-label": "Seçim araçları" });
    // Sade balon: 4 renk + Altını çiz / Üstünü çiz / Yorum + Kopyala + Çevir; geri kalanı ("Daha fazla") ikinci satırda.
    const ana = el("div", { class: "ak-balon-sira" }), fazla = el("div", { class: "ak-balon-sira ak-balon-fazla", hidden: true });
    for (const r of (salt ? [] : RENKLER.slice(0, 4))) {
      const n = el("button", { type: "button", class: "ak-renk ak-renk-buyuk", title: `${r.ad} vurgu`, "aria-label": `${r.ad} vurgu`, "data-hex": r.hex });
      n.style.background = r.hex;
      ana.append(n);
    }
    const yaziDugme = (b, simge, yazi, baslik) => el("button", { type: "button", class: "ak-btn ak-balon-dugme", "data-b": b, title: baslik || yazi }, el("span", { "aria-hidden": "true" }, simge), el("span", { class: "ak-balon-yazi" }, yazi));
    if (!salt) ana.append(yaziDugme("altcizgi", "U̲", "Altı", "Altını çiz"), yaziDugme("ustcizgi", "S̶", "Üstü", "Üstünü çiz"), yaziDugme("yorum", "💬", "Yorum", "Vurgula ve yorum ekle"));
    ana.append(yaziDugme("kopya", "⧉", "Kopyala", "Seçili metni kopyala"));
    const ekler = eklentiDugmeleri();
    const cevir = ekler.find((x) => x.dataset.eklenti === "ceviri");
    if (cevir) { cevir.classList.add("ak-balon-dugme"); cevir.append(el("span", { class: "ak-balon-yazi" }, "Çevir")); ana.append(cevir); }
    if (!salt) fazla.append(...RENKLER.slice(4).map((r) => { const n = el("button", { type: "button", class: "ak-renk ak-renk-buyuk", title: `${r.ad} vurgu`, "aria-label": `${r.ad} vurgu`, "data-hex": r.hex }); n.style.background = r.hex; return n; }));
    fazla.append(yaziDugme("alinti", "❝", "Alıntı", "Alıntı olarak kopyala (yazar, yıl, sayfa ile)"), ...ekler.filter((x) => x !== cevir));
    ana.append(yaziDugme("fazla", "⋯", "Daha fazla", "Diğer renkler ve araçlar"));
    balon.append(ana, fazla);
    // Seçim bozulmasın: fare, dokunma ve işaretçi olaylarının hepsinde odak/seçim çalmayı engelle
    const seciliTut = (e) => { balonDokunuyor = true; if (e.cancelable) e.preventDefault(); setTimeout(() => { balonDokunuyor = false; }, 800); };
    balon.addEventListener("mousedown", seciliTut);
    balon.addEventListener("pointerdown", seciliTut);
    balon.addEventListener("touchstart", seciliTut, { passive: false });
    balon.classList.toggle("ak-balon-alt", dokunmatik);
    // Eylem tek yerde. DOKUNMATİK: touchstart'ta preventDefault (seçim bozulmasın) tarayıcının "click" üretmesini de engeller → eylemi
    // touchend'de tetikliyoruz; fare/klavye click ile çalışır. İkisi çift tetiklenmesin diye zaman damgasıyla ayrılır.
    const secimiBitir = () => { try { window.getSelection()?.removeAllRanges(); } catch { /* yok say */ } sonSecim = null; balonGizle(); };
    async function balonEylem(b) {
      try {
        if (b.dataset.b === "fazla") { const f = balon.querySelector(".ak-balon-fazla"); f.hidden = !f.hidden; return; }
        if (!sonSecim && !window.getSelection()?.rangeCount) { toast("Önce metin seç.", "uyari"); return; }
        if (b.dataset.eklenti) { await eklentiCalistir(b.dataset.eklenti); secimiBitir(); return; }
        if (b.dataset.hex) { d.renk = b.dataset.hex; renkleriCiz(); secimdenOlustur("vurgu", b.dataset.hex); }
        else if (b.dataset.b === "altcizgi" || b.dataset.b === "ustcizgi") secimdenOlustur(b.dataset.b);
        else if (b.dataset.b === "yorum") { const n0 = d.model.size; if (secimdenOlustur("vurgu")) { const yeni = [...d.model.values()].slice(-1)[0]; if (d.model.size > n0) sec(yeni.id, true); } }
        else if (b.dataset.b === "kopya") { const m = sonSecim?.metin || ""; if (!m) { toast("Önce metin seç.", "uyari"); return; } await panoyaKopyala(m); toast("Seçili metin kopyalandı.", "basari"); secimiBitir(); }
        else if (b.dataset.b === "alinti") { const m = sonSecim?.metin; if (!m) { toast("Önce metin seç.", "uyari"); return; } await panoyaKopyala(metniAlintiYap(m, secimSayfasi())); toast("Alıntı (yazar, yıl, sayfa ile) kopyalandı.", "basari"); secimiBitir(); }
      } catch (h) { console.error(h); durumYaz(`İşlem yapılamadı: ${h.message || h}`, "hata"); toast(`İşlem yapılamadı: ${h.message || h}`, "hata"); }
    }
    let sonDokunus = 0;
    balon.addEventListener("touchend", (e) => { const b = e.target.closest("button"); if (!b) return; e.preventDefault(); sonDokunus = Date.now(); balonEylem(b); }, { passive: false });
    balon.addEventListener("click", (e) => { if (Date.now() - sonDokunus < 700) return; const b = e.target.closest("button"); if (b) balonEylem(b); });
    q(".ak-ok-govde").append(balon);
    otoCeviriKarti(sonSecim?.metin);
    kanca("okuyucu:secim", { metin: String(sonSecim?.metin || "").slice(0, 2000), sayfa: secimSayfasi() });
    if (!dokunmatik) {
      balon.style.left = `${Math.max(8, Math.min(govde.width - 330, son.right - govde.left - 20))}px`;
      balon.style.top = `${Math.min(govde.height - 50, son.bottom - govde.top + 8)}px`;
    }
  }

  /* ---------- araç / renk durumu ---------- */
  function aracSec(id) {
    d.arac = id;
    kok.classList.toggle("ak-cizim-modu", CIZIM_ARACLARI.has(id));
    kok.classList.toggle("ak-metin-modu", METIN_TURLERI.has(id));
    kok.classList.toggle("ak-arac-aktif", id !== "gez");
    if (CIZIM_ARACLARI.has(id) || id === "gez") kok.querySelector(".ak-ok-diger")?.removeAttribute("open");
    kok.querySelectorAll("[data-ak-arac]").forEach((b) => { const a = b.dataset.akArac === id; b.classList.toggle("aktif", a); b.setAttribute("aria-pressed", String(a)); });
    const ozet = kok.querySelector(".ak-ok-diger > summary"); if (ozet) ozet.classList.toggle("aktif", !ANA_ARACLAR.has(id));   // Çiz / Not menüsünden bir araç açıkken özet de işaretli
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
    if (e.target.closest(".ak-pop, .ak-balon, .ak-pin")) return;
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
      const vpN = c.pv.viewport, nS = N * Math.min(1.4, Math.max(0.8, vpN.scale));
      const a = ekleModel({ tur: "yapiskan", sayfa: no, rect: [c.bas.x, c.bas.y - N, c.bas.x + N, c.bas.y], renk: d.renk, norm: { x: yuvarla(c.bas.vx / vpN.width, 5), y: yuvarla(c.bas.vy / vpN.height, 5), w: yuvarla(nS / vpN.width, 5), h: yuvarla(nS / vpN.height, 5) } });
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
    if (CIZIM_ARACLARI.has(d.arac) || e.target.closest(".ak-balon")) return;
    setTimeout(() => {
      const s = window.getSelection();
      if (s && !s.isCollapsed) {
        if (!salt && METIN_TURLERI.has(d.arac)) secimdenOlustur(d.arac);
        else balonGoster();
      }
    }, 0);
  });
  // Seçili açıklamayı tıkla-seç (imleç modunda)
  kap.addEventListener("click", (e) => {
    if (CIZIM_ARACLARI.has(d.arac) && !salt) return;
    if (e.target.closest(".ak-pop, .ak-balon, .ak-link, .ak-pin") || Date.now() - d.pinSurukleme < 450) return;
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
  // DOKUNMATİK: seçim "mouseup" olmadan biter (uzun basma + tutamaçlar). Bu yüzden selectionchange dinlenir; seçim DURULANA kadar
  // (400 ms) beklenip balon gösterilir/araç uygulanır. Boşalma, balona dokunma sırasında yok sayılır → seçim "kaybolmaz".
  let seciliZaman = null, bosZaman = null, isaretci = false;
  kap.addEventListener("pointerdown", () => { isaretci = true; });
  document.addEventListener("pointerup", () => { isaretci = false; });
  document.addEventListener("pointercancel", () => { isaretci = false; });
  document.addEventListener("selectionchange", () => {
    secKatmaniPlanla();
    const s = window.getSelection();
    if (!s || s.isCollapsed) {
      if (balonDokunuyor) return;
      clearTimeout(bosZaman);
      bosZaman = setTimeout(() => { const x = window.getSelection(); if (!balonDokunuyor && (!x || x.isCollapsed)) { balonGizle(); sonSecim = null; } }, dokunmatik ? 600 : 0);
      return;
    }
    if (CIZIM_ARACLARI.has(d.arac) || !kap.contains(s.anchorNode)) return;
    secimYakala();                                                   // ANINDA kopya: seçim hemen çökse bile elimizde
    clearTimeout(bosZaman); clearTimeout(seciliZaman);
    seciliZaman = setTimeout(secimiIsle, dokunmatik ? 350 : 200);
  });
  function secimiIsle() {
    try {
      if (balonDokunuyor || (isaretci && !dokunmatik)) return;      // masaüstünde sürükleme bitince mouseup halleder
      const x = window.getSelection();
      if (!x || x.isCollapsed) { if (!sonSecim || Date.now() - sonSecim.t > 700) return; } else if (!secimYakala()) return;   // iOS seçimi hemen çökertirse son 0,7 sn içindeki anlık kopya kullanılır
      if (!sonSecim) return;
      if (!salt && METIN_TURLERI.has(d.arac)) secimdenOlustur(d.arac); else balonGoster();
    } catch (h) { console.error(h); durumYaz(`Seçim işlenemedi: ${h.message || h}`, "hata"); }
  }
  // iOS/Android: tutamaç sürüklemesi bitince (parmak kalkınca) seçimi kesin işle
  kap.addEventListener("touchend", () => { clearTimeout(seciliZaman); seciliZaman = setTimeout(secimiIsle, 260); }, { passive: true });

  /* ---------- üst çubuk / yan panel olayları ---------- */
  kok.addEventListener("click", async (e) => {
    const ar = e.target.closest("[data-ak-arac]");
    if (ar) {
      // Aç/kapa: aktif araca ikinci basış aracı kapatır ve "Seç" (gez) moduna döner; her seferinde Seç'e basmak gerekmez.
      const id = ar.dataset.akArac;
      aracSec(d.arac === id && id !== "gez" ? "gez" : id);
      return;
    }
    const rn = e.target.closest("[data-ak-renkler] .ak-renk");
    if (rn) { d.renk = rn.dataset.hex; renkleriCiz(); if (d.secili && !salt) guncelle(d.secili, { renk: d.renk }); return; }
    const md = e.target.closest("[data-md]");
    if (md) { const a = d.model.get(md.dataset.md); if (a) { await panoyaKopyala(alintiMarkdown(a, kaynak)); toast("Markdown alıntısı kopyalandı.", "basari"); } return; }
    const oge = e.target.closest(".ak-liste-oge");
    if (oge) {
      const a = d.model.get(oge.dataset.id);
      if (a) aciklamayaOdaklan(a);
      return;
    }
    const i = e.target.closest("[data-ak]")?.dataset.ak;
    if (i === "kapat") kapat();
    else if (i === "yan") kok.classList.toggle("yan-kapali");
    else if (i === "tam") tamEkran();
    else if (i === "yaklas") viewer.increaseScale();
    else if (i === "uzaklas") viewer.decreaseScale();
    else if (i === "kaydet") kaydet();
    else if (i === "indir") pdfIndir();
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
  kok.addEventListener("input", (e) => { if (e.target.dataset?.ak === "f-ara") listeCiz(); });
  const ara = (tip = "", geri = false) => eventBus.dispatch("find", { source: kok, type: tip, query: q('[data-ak="ara"]').value, caseSensitive: false, entireWord: false, highlightAll: true, findPrevious: geri, matchDiacritics: true });
  q('[data-ak="ara"]').addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); ara(d.sonAranan === q('[data-ak="ara"]').value ? "again" : "", e.shiftKey); d.sonAranan = q('[data-ak="ara"]').value; } });
  q('[data-ak="ara"]').addEventListener("input", (e) => { if (!e.target.value) { ara(""); q("[data-ak-bul]").textContent = ""; } });

  /** PDF'i indirir. İşlenmemiş açıklamalar varsa dosya tarayıcıda (R2'ye hiçbir şey yazmadan) açıklamalarla birlikte üretilir. */
  async function pdfIndir() {
    const ad = `${(kaynak.pdf_dosya_adi || kaynak.baslik || "belge").replace(/\.pdf$/i, "")}.pdf`;
    let veri = d.bytes;
    if (!salt && d.pdfKirli && !d.sifreli) {
      try {
        durumYaz("İndirilecek PDF açıklamalarınla birlikte hazırlanıyor…");
        const pdflib = await pdfLibAl();
        const pdfDoc = await pdflib.PDFDocument.load(d.bytes, { updateMetadata: false, throwOnInvalidObject: false });
        veri = await uygula(pdflib, pdfDoc, { degisenler: [...d.model.values()].filter((a) => a.durum !== "ayni"), silinenler: d.silinenler.map(({ nm, ref, sayfa }) => ({ nm, ref, sayfa })), yazar: d.kullaniciAdi });
        durumYaz("PDF hazır, indiriliyor.", "basari");
      } catch (h) { console.warn(h); toast("Açıklamalar dosyaya işlenemedi; kayıtlı sürüm indiriliyor.", "uyari"); veri = d.bytes; }
    }
    dosyaIndir(ad, new Blob([veri], { type: "application/pdf" }));
  }

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

  /* ---------- yakınlaştırma: fare + dokunmatik yüzey + dokunmatik ekran (HIZLI) ----------
     Hareket sürerken sayfalar YENİDEN ÇİZİLMEZ: görünüm GPU ile CSS dönüşümüyle (transform: scale) anında büyür/küçülür; hareket
     durunca (≈140 ms) gerçek ölçek tek seferde uygulanır ve PDF.js yalnızca bir kez yeniden çizer. Böylece trackpad/parmak akıcı olur. */
  const OLCEK_MIN = 0.25, OLCEK_MAX = 5;
  const pdfKap = kap.querySelector(".pdfViewer");
  let canli = null, bitirZ = null;                      // canli: { taban, f, ox, oy } — taban: son kesin ölçek, f: bekleyen çarpan, (ox,oy): odak (kap içi px)
  function canliBaslat(odak) {
    const kr = kap.getBoundingClientRect();
    const ox = odak ? odak.x - kr.left : kr.width / 2, oy = odak ? odak.y - kr.top : kr.height / 2;
    if (!canli) {
      canli = { taban: viewer.currentScale, f: 1, ox, oy, cx: kap.scrollLeft + ox, cy: kap.scrollTop + oy };
      pdfKap.style.willChange = "transform";
      // dönüşüm başlangıcı: odak noktasının içerik koordinatı (kaydırma dahil) — pdfViewer kap içinde sol-üstten başlar
      pdfKap.style.transformOrigin = `${canli.cx - pdfKap.offsetLeft}px ${canli.cy - pdfKap.offsetTop}px`;
    }
    return canli;
  }
  function olcekCarpan(carpan, odak) {
    const c = canliBaslat(odak);
    const hedef = Math.max(OLCEK_MIN, Math.min(OLCEK_MAX, c.taban * c.f * carpan));
    c.f = hedef / c.taban;
    pdfKap.style.transform = `scale(${c.f})`;
    clearTimeout(bitirZ); bitirZ = setTimeout(olcekKesinle, 140);
  }
  function olcekKesinle() {
    if (!canli) return;
    const c = canli; canli = null;
    pdfKap.style.transform = ""; pdfKap.style.transformOrigin = ""; pdfKap.style.willChange = "";
    if (Math.abs(c.f - 1) < 0.004) return;
    viewer.currentScale = c.taban * c.f;
    const oran = viewer.currentScale / c.taban;
    kap.scrollLeft = c.cx * oran - c.ox;                // odak noktası yerinde kalsın
    kap.scrollTop = c.cy * oran - c.oy;
  }
  function olcekUygula(yeni, odak) { olcekCarpan(Math.max(OLCEK_MIN, Math.min(OLCEK_MAX, yeni)) / (canli ? canli.taban * canli.f : viewer.currentScale), odak); }
  kap.addEventListener("wheel", (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;               // normal kaydırma etkilenmez
    e.preventDefault();
    olcekCarpan(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.01)), { x: e.clientX, y: e.clientY });
  }, { passive: false });
  let gestureTaban = 1;
  kap.addEventListener("gesturestart", (e) => { e.preventDefault(); gestureTaban = canli ? canli.taban * canli.f : viewer.currentScale; });   // Safari (macOS) trackpad
  kap.addEventListener("gesturechange", (e) => { e.preventDefault(); olcekUygula(gestureTaban * e.scale, { x: e.clientX, y: e.clientY }); });
  kap.addEventListener("gestureend", (e) => { e.preventDefault(); olcekKesinle(); });
  // İki parmakla sıkıştırma (touch olayları, passive:false): 2 parmakta tarayıcının kendi yakınlaştırması engellenir; tek parmak kaydırma/seçim etkilenmez.
  let sikistirBas = null;
  const mesafe = (tt) => Math.hypot(tt[0].clientX - tt[1].clientX, tt[0].clientY - tt[1].clientY);
  const orta = (tt) => ({ x: (tt[0].clientX + tt[1].clientX) / 2, y: (tt[0].clientY + tt[1].clientY) / 2 });
  kap.addEventListener("touchstart", (e) => { if (e.touches.length === 2) { olcekKesinle(); sikistirBas = { m: mesafe(e.touches), son: 1 }; e.preventDefault(); } }, { passive: false });
  kap.addEventListener("touchmove", (e) => {
    if (e.touches.length !== 2 || !sikistirBas) return;
    e.preventDefault();
    if (sikistirBas.m < 10) return;
    const oran = mesafe(e.touches) / sikistirBas.m;
    olcekCarpan(oran / sikistirBas.son, orta(e.touches)); sikistirBas.son = oran;
  }, { passive: false });
  kap.addEventListener("touchend", (e) => { if (e.touches.length < 2 && sikistirBas) { sikistirBas = null; clearTimeout(bitirZ); bitirZ = setTimeout(olcekKesinle, 60); } });
  kap.addEventListener("touchcancel", () => { sikistirBas = null; olcekKesinle(); });
  // Çift dokunma / çift tıklama boş alanda: genişliğe sığdır ↔ %150 arasında geçiş (metin seçimini bozmamak için yalnızca boşlukta)
  let sonTik = 0;
  kap.addEventListener("dblclick", (e) => {
    if (e.target.closest(".textLayer span, .ak-kat > *, .ak-balon, .ak-pop")) return;
    e.preventDefault();
    if (Math.abs(viewer.currentScale - 1.5) < 0.05) viewer.currentScaleValue = "page-width"; else olcekUygula(1.5, { x: e.clientX, y: e.clientY });
  });

  /* ---------- klavye ---------- */
  const tus = (e) => {
    if (!document.body.contains(kok)) return;
    const yaziyor = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); kaydet(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !yaziyor && !salt) { e.preventDefault(); geriAl(); }
    else if ((e.ctrlKey || e.metaKey) && !yaziyor && (e.key === "+" || e.key === "=")) { e.preventDefault(); olcekUygula(viewer.currentScale * 1.15); }
    else if ((e.ctrlKey || e.metaKey) && !yaziyor && (e.key === "-" || e.key === "_")) { e.preventDefault(); olcekUygula(viewer.currentScale / 1.15); }
    else if ((e.ctrlKey || e.metaKey) && !yaziyor && e.key === "0") { e.preventDefault(); viewer.currentScaleValue = "page-width"; }
    else if (e.key === "Escape") { if (d.secili) sec(null); else if (d.arac !== "gez") aracSec("gez"); else if (!document.fullscreenElement) kapat(); }
    else if ((e.key === "Delete" || e.key === "Backspace") && d.secili && !yaziyor && !salt) { e.preventDefault(); sil(d.secili); }
  };
  document.addEventListener("keydown", tus);
  const oncesi = (e) => { if (d.kirli && !salt) { dbKaydet(); e.preventDefault(); e.returnValue = ""; } };
  window.addEventListener("beforeunload", oncesi);

  /* ---------- kaydet ---------- */
  async function kaydet() {
    if (salt) return;
    if (!d.kirli && !d.pdfKirli) { toast("PDF zaten güncel; değişiklikler otomatik kaydedilir.", "bilgi"); return; }
    if (d.kaydediliyor) return;
    clearTimeout(d.otoZaman);
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
      taslakSil(kaynak.id);
      // R2'ye yazıldı → DOĞRULA (PDF'i geri oku, tüm açıklamalar dosyada mı?) → ancak o zaman veritabanındaki açıklama satırlarını sil.
      // Doğrulama başarısız olursa satırlar KALIR (veri kaybı olmaz); yalnızca aramaya yarayan küçük özet metin saklanır.
      let temizlendi = false;
      if (pdfeGomuldu) {
        try {
          durumYaz("R2'ye yazılan PDF doğrulanıyor…");
          const { bayt: okunan } = await pdfIndirBayt(kaynak.id);
          const { aciklamalar: dosyadaki } = await acikla(pdflib, okunan);
          const dosyada = new Set(dosyadaki.map((x) => x.nm).filter(Boolean));
          if (ozet.every((o) => dosyada.has(o.ek_id))) {
            const { data: sil, error: e2 } = await supabase.rpc("akademik_aciklamalari_r2ye_islendi", { p_kaynak_id: kaynak.id, p_adet: ozet.length });
            temizlendi = !e2 && Number(sil) >= 0;
            if (temizlendi) kaynak.aciklama_db_otorite = false;
          }
        } catch (h) { console.warn("R2 doğrulaması/temizlik atlandı (satırlar korunuyor):", h); }
      }
      d.kirli = false; d.pdfKirli = !pdfeGomuldu && d.pdfKirli;
      d.sonOto = new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      kaydetDurumu();
      durumYaz(pdfeGomuldu ? `PDF güncellendi: açıklamalar dosyaya işlendi${temizlendi ? " ve doğrulandı; veritabanı kopyası temizlendi." : "."}` : "Kaydedildi (yalnızca veritabanına; PDF şifreli/bozuk olduğundan dosyaya gömülemedi).", pdfeGomuldu ? "basari" : "uyari");
      toast(pdfeGomuldu ? "Açıklamalar PDF'e işlendi." : "Açıklamalar veritabanına kaydedildi.", pdfeGomuldu ? "basari" : "uyari");
      return true;
    } catch (h) {
      console.error(h);
      durumYaz(`PDF'e işlenemedi: ${h.message || h}`, "hata");
      toast(`PDF'e işlenemedi: ${h.message || h}. Açıklamaların hesabında kayıtlı.`, "hata", 8000);
      return false;
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
  let kapaniyor = false;
  async function kapat(zorla = false) {
    if (kapaniyor) return;
    if (!zorla && !salt) {
      kapaniyor = true;
      try {
        clearTimeout(d.otoZaman);
        if (d.kirli) {
          durumYaz("Son değişiklikler kaydediliyor…");
          const tamam = await dbKaydet();
          if (!tamam && !confirm("Son değişiklikler hesabına kaydedilemedi (bağlantı sorunu olabilir). Yine de kapatılsın mı?")) { kapaniyor = false; return; }
        }
        if (d.pdfKirli && !d.sifreli) {
          durumYaz("Açıklamalar PDF dosyasına işleniyor…");
          const ok = await kaydet();
          if (!ok && !confirm("Açıklamaların hesabında kayıtlı ama PDF dosyasına işlenemedi. Yine de kapatılsın mı? (Bir sonraki açılışta yeniden denenir.)")) { kapaniyor = false; return; }
        }
      } finally { kapaniyor = false; }
    }
    kanca("okuyucu:kapandi", { kaynak: { id: kaynak.id } });
    document.removeEventListener("keydown", tus);
    document.removeEventListener("visibilitychange", gizlenince);
    window.removeEventListener("online", cevrimici);
    window.removeEventListener("beforeunload", oncesi);
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    try { viewer.setDocument(null); belge?.destroy(); } catch { /* */ }
    popKapat(); balonGizle();
    kok.remove();
    kaydirmaKilidiAc();
    kapaninca?.();
  }

  listeCiz();
  kaydetDurumu();
  return { kapat };
}

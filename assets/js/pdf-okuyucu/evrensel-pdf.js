/*
 * assets/js/pdf-okuyucu/evrensel-pdf.js — EVRENSEL PDF OKUYUCU (tek motor; sitenin her yerindeki PDF açma noktaları bunu kullanır).
 *
 * NEDEN: PDF bazı yerlerde (Araçlar, Düzenleyici, Dönüştürücü, Akademik Kütüphane, R2 önizleme) BEYAZ/BOŞ açılıyordu. Kök nedenler:
 *   • eski/taranmış PDF'ler CMap (CID yazı tipleri), standart yazı tipi dosyaları ve WASM çözücüler (JPEG2000 / JBIG2 / ICC) olmadan sayfayı boş çizer;
 *   • PDF bir <img> içine ya da (CSP'de blob: yokken) çerçeveye konuyordu; hata olunca da yedek yoktu.
 * ÇÖZÜM (üç kademe, sessiz geçişle):
 *   1) PDF.js, TAM seçenekle (cMapUrl + cMapPacked + standardFontDataUrl + wasmUrl + iccUrl) açılır;
 *   2) açma/ilk sayfa çizimi hata verirse daha yalın profillerle (disableFontFace, sistem yazı tipi kapalı…) yeniden denenir; parola istenirse sorulur;
 *   3) hâlâ olmazsa TARAYICININ YERLEŞİK PDF OKUYUCUSUNA otomatik geçilir (blob: çerçeve) + her zaman "İndir" bağlantısı.
 * Dosya hiçbir yere gönderilmez; yalnızca kütüphane kodu CDN'den gelir (sürüm sabitli, bkz. donusturucu/pdf-yukle.js).
 * CSP: satır içi stil/olay yok (görünüm assets/css/pdf-okuyucu.css).
 */
import { pdfjsAl, pdfAcSecenekleri, pdfBirak } from "../donusturucu/pdf-yukle.js";

const e = (etiket, sinif, metin) => { const n = document.createElement(etiket); if (sinif) n.className = sinif; if (metin != null) n.textContent = metin; return n; };
const MAKS_OLCEK = 4, MIN_OLCEK = 0.4;

/** PDF baytlarını (Uint8Array) güvenle açar. Dönen: { pdf, gorev, profil }. Parola gerekiyorsa err.parolaGerekli=true ile fırlatır. */
export async function pdfBelgesiAc(bayt, { parola } = {}) {
  const pdfjs = await pdfjsAl();
  const tam = await pdfAcSecenekleri({});
  const profiller = [
    ["tam", { ...tam }],
    ["yazi-tipi-gomme-kapali", { ...tam, useSystemFonts: false, disableFontFace: true }],
    ["yalin", { isEvalSupported: false, enableXfa: false, disableFontFace: true, stopAtErrors: false }],
  ];
  let son = null;
  for (const [ad, secenek] of profiller) {
    let gorev = null;
    try {
      gorev = pdfjs.getDocument({ ...secenek, data: bayt.slice(0), ...(parola ? { password: parola } : {}) });
      const pdf = await gorev.promise;
      return { pdf, gorev, profil: ad, pdfjs };
    } catch (h) {
      pdfBirak(gorev, null);
      son = h;
      if (h?.name === "PasswordException") { const x = new Error(h.message || "PDF parola korumalı."); x.parolaGerekli = true; x.kod = h.code; throw x; }
      if (h?.name === "InvalidPDFException" && ad !== "tam") break;      // bozuk dosya: yalın profil de açamaz
    }
  }
  throw son || new Error("PDF açılamadı.");
}

/** Tarayıcının yerleşik PDF okuyucusu (blob: çerçeve). CSP: frame-src blob: gerekir (_layouts/default.html, _headers). */
export function yerlesikOkuyucuGoster(kap, blobVeyaUrl, baslik = "PDF") {
  const url = typeof blobVeyaUrl === "string" ? blobVeyaUrl : URL.createObjectURL(blobVeyaUrl);
  const f = e("iframe", "eo-yerlesik"); f.title = baslik; f.src = url; f.referrerPolicy = "no-referrer";
  kap.replaceChildren(f);
  return () => { if (typeof blobVeyaUrl !== "string") URL.revokeObjectURL(url); };
}

/**
 * Bir kapsayıcıya tam özellikli (sayfa gezinme, yakınlaştırma, sığdır, indir, yerleşik okuyucuya geç) PDF okuyucu kurar.
 * kaynak: { bayt: Uint8Array } | { blob: Blob } | { dosya: File } | { url: string }   (url için CORS gerekir; olmazsa çerçeveye düşülür)
 * secenek: { baslik, indirUrl, yukseklik (px), parolaIste: async () => string|null }
 * Dönen: { yokEt(), blob() }
 */
export async function evrenselPdfGoster(kok, kaynak, secenek = {}) {
  const baslik = secenek.baslik || "PDF";
  kok.replaceChildren(); kok.classList.add("eo-kok");
  const bilgi = e("p", "eo-bilgi", "PDF açılıyor…"); bilgi.setAttribute("role", "status");
  kok.append(bilgi);
  let belge = null, gorev = null, bayt = null, blobNesne = null, iptal = false, olcek = 1, gozlem = null, yerlesikBirak = null, guncelOlcekModu = "sigdir";
  const sayfalar = [];                                                   // {kap, canvas, cizildi}
  const yokEt = () => {
    iptal = true; try { gozlem?.disconnect(); } catch { /* yok say */ }
    try { yerlesikBirak?.(); } catch { /* yok say */ }
    for (const s of sayfalar) { s.canvas.width = 0; s.canvas.height = 0; }
    pdfBirak(gorev, belge); belge = null; gorev = null; bayt = null;
  };
  const blobAl = () => blobNesne || (bayt ? (blobNesne = new Blob([bayt], { type: "application/pdf" })) : null);

  const indirBaglanti = () => {
    const a = e("a", "eo-btn", "⬇ İndir"); a.rel = "noopener";
    if (secenek.indirUrl) { a.href = secenek.indirUrl; a.target = "_blank"; }
    else { a.href = "#"; a.addEventListener("click", (ev) => { ev.preventDefault(); const b = blobAl(); if (!b) return; const u = URL.createObjectURL(b); const x = document.createElement("a"); x.href = u; x.download = /\.pdf$/i.test(baslik) ? baslik : `${baslik}.pdf`; document.body.append(x); x.click(); x.remove(); setTimeout(() => URL.revokeObjectURL(u), 60000); }); }
    return a;
  };

  /** Son çare: tarayıcı-içi okuyucu. */
  const yerlesigeGec = (neden) => {
    if (iptal) return;
    try { gozlem?.disconnect(); } catch { /* yok say */ }
    const b = blobAl();
    const cerceve = e("div", "eo-yerlesik-kap");
    const uyari = e("p", "eo-bilgi", `${neden ? `${neden} ` : ""}Tarayıcının yerleşik PDF okuyucusu kullanılıyor.`);
    const ust = e("div", "eo-arac"); ust.append(indirBaglanti());
    kok.replaceChildren(uyari, ust, cerceve);
    if (b) yerlesikBirak = yerlesikOkuyucuGoster(cerceve, b, baslik);
    else if (kaynak.yerlesikUrl || kaynak.url) yerlesikBirak = yerlesikOkuyucuGoster(cerceve, kaynak.yerlesikUrl || kaynak.url, baslik);
    else cerceve.append(e("p", "eo-hata", "Bu PDF görüntülenemedi; lütfen indirip başka bir okuyucuyla aç."));
  };

  try {
    // 1) baytları topla
    if (kaynak.bayt) bayt = kaynak.bayt instanceof Uint8Array ? kaynak.bayt : new Uint8Array(kaynak.bayt);
    else if (kaynak.blob || kaynak.dosya) bayt = new Uint8Array(await (kaynak.blob || kaynak.dosya).arrayBuffer());
    else if (kaynak.url) {
      const r = await fetch(kaynak.url, { credentials: "omit", referrerPolicy: "no-referrer" });
      if (!r.ok) throw new Error(`PDF alınamadı (HTTP ${r.status}).`);
      bayt = new Uint8Array(await r.arrayBuffer());
    } else throw new Error("PDF kaynağı verilmedi.");
    if (!bayt.length) throw new Error("PDF dosyası boş.");
    // %PDF üstbilgisi ilk 1 KB içinde aranır (bazı dosyalar önünde çöp bayt taşır; PDF.js bunu tolere eder).
    if (!new TextDecoder("latin1").decode(bayt.subarray(0, 1024)).includes("%PDF-")) throw new Error("Bu dosya geçerli bir PDF gibi görünmüyor.");

    // 2) aç (parola gerekiyorsa sor)
    let parola;
    for (let deneme = 0; deneme < 4; deneme++) {
      try { ({ pdf: belge, gorev } = await pdfBelgesiAc(bayt, { parola })); break; }
      catch (h) {
        if (!h.parolaGerekli) throw h;
        const p = secenek.parolaIste ? await secenek.parolaIste(deneme > 0) : window.prompt(deneme > 0 ? "Parola yanlış. Tekrar dene:" : "Bu PDF parola korumalı. Parolayı gir:");
        if (!p) { bilgi.textContent = "Parola girilmedi; PDF açılmadı."; return { yokEt, blob: blobAl }; }
        parola = p;
      }
    }
    if (!belge) throw new Error("PDF parolası doğrulanamadı.");
    if (iptal) { yokEt(); return { yokEt, blob: blobAl }; }

    // 3) arayüz
    const n = belge.numPages;
    const arac = e("div", "eo-arac");
    const onceki = e("button", "eo-btn", "◀"), sonraki = e("button", "eo-btn", "▶");
    for (const b of [onceki, sonraki]) b.type = "button";
    onceki.setAttribute("aria-label", "Önceki sayfa"); sonraki.setAttribute("aria-label", "Sonraki sayfa");
    const sayfaGirdi = e("input", "eo-sayfa"); sayfaGirdi.type = "number"; sayfaGirdi.min = "1"; sayfaGirdi.max = String(n); sayfaGirdi.value = "1"; sayfaGirdi.setAttribute("aria-label", "Sayfa numarası");
    const toplam = e("span", "eo-toplam", `/ ${n}`);
    const az = e("button", "eo-btn", "−"), cok = e("button", "eo-btn", "+"), sigdir = e("button", "eo-btn", "Sığdır");
    for (const b of [az, cok, sigdir]) b.type = "button";
    az.setAttribute("aria-label", "Uzaklaştır"); cok.setAttribute("aria-label", "Yakınlaştır");
    const yerlesikDugme = e("button", "eo-btn", "🌐 Tarayıcı okuyucusu"); yerlesikDugme.type = "button"; yerlesikDugme.title = "Bu PDF'i tarayıcının kendi PDF görüntüleyicisinde aç";
    arac.append(onceki, sayfaGirdi, toplam, sonraki, az, cok, sigdir, yerlesikDugme, indirBaglanti());
    const alan = e("div", "eo-alan"); alan.tabIndex = 0; alan.setAttribute("aria-label", `${baslik} — PDF sayfaları`);
    if (secenek.yukseklik) alan.style.height = `${secenek.yukseklik}px`;
    kok.replaceChildren(arac, alan);

    // 4) sayfa yer tutucuları (ilk sayfanın boyutundan ölçek) + tembel çizim
    const ilk = await belge.getPage(1);
    const vp1 = ilk.getViewport({ scale: 1 });
    const sigdirOlcek = () => Math.max(MIN_OLCEK, Math.min(MAKS_OLCEK, (alan.clientWidth - 24) / vp1.width));
    olcek = sigdirOlcek();
    const yerlestir = () => {
      for (const s of sayfalar) { s.kap.style.width = `${Math.floor(vp1.width * olcek)}px`; s.kap.style.height = `${Math.floor(vp1.height * olcek)}px`; s.cizildi = false; s.canvas.width = 0; s.canvas.height = 0; }
      gozlem?.disconnect();
      for (const s of sayfalar) gozlem?.observe(s.kap);
    };
    async function cizSayfa(s, i) {
      if (s.cizildi || iptal) return;
      s.cizildi = true;
      try {
        const p = i === 1 ? ilk : await belge.getPage(i);
        const vp = p.getViewport({ scale: olcek });
        const oran = Math.min(window.devicePixelRatio || 1, 2);
        s.canvas.width = Math.floor(vp.width * oran); s.canvas.height = Math.floor(vp.height * oran);
        s.kap.style.width = `${Math.floor(vp.width)}px`; s.kap.style.height = `${Math.floor(vp.height)}px`;
        const ctx = s.canvas.getContext("2d", { alpha: false });
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, s.canvas.width, s.canvas.height);
        await p.render({ canvasContext: ctx, viewport: vp, transform: oran !== 1 ? [oran, 0, 0, oran, 0, 0] : null, background: "#fff" }).promise;
      } catch (h) {
        if (iptal) return;
        s.cizildi = false;
        if (i === 1 && !s.birinciHata) { s.birinciHata = true; console.warn("evrensel-pdf: ilk sayfa çizilemedi, yerleşik okuyucuya geçiliyor:", h); yerlesigeGec("Bu PDF'in sayfaları çizilemedi."); }
      }
    }
    gozlem = new IntersectionObserver((girdiler) => {
      for (const g of girdiler) if (g.isIntersecting) { const i = Number(g.target.dataset.i); cizSayfa(sayfalar[i - 1], i); }
    }, { root: alan, rootMargin: "600px 0px" });
    for (let i = 1; i <= n; i++) {
      const kap = e("div", "eo-sayfa-kap"); kap.dataset.i = String(i);
      const canvas = e("canvas", "eo-canvas"); canvas.setAttribute("role", "img"); canvas.setAttribute("aria-label", `Sayfa ${i}`);
      kap.append(canvas); alan.append(kap); sayfalar.push({ kap, canvas, cizildi: false });
    }
    yerlestir();

    // 5) denetimler
    const sayfayaGit = (i) => { const h = sayfalar[Math.max(1, Math.min(n, i)) - 1]; h?.kap.scrollIntoView({ block: "start" }); };
    const gecerli = () => { let en = 1, fark = Infinity; const ust = alan.getBoundingClientRect().top; sayfalar.forEach((s, k) => { const d = Math.abs(s.kap.getBoundingClientRect().top - ust); if (d < fark) { fark = d; en = k + 1; } }); return en; };
    alan.addEventListener("scroll", () => { if (document.activeElement !== sayfaGirdi) sayfaGirdi.value = String(gecerli()); }, { passive: true });
    onceki.addEventListener("click", () => sayfayaGit(gecerli() - 1));
    sonraki.addEventListener("click", () => sayfayaGit(gecerli() + 1));
    sayfaGirdi.addEventListener("change", () => sayfayaGit(Number(sayfaGirdi.value) || 1));
    const olcekDegistir = (yeni, mod) => { const sayfa = gecerli(); olcek = Math.max(MIN_OLCEK, Math.min(MAKS_OLCEK, yeni)); guncelOlcekModu = mod; yerlestir(); sayfayaGit(sayfa); };
    az.addEventListener("click", () => olcekDegistir(olcek / 1.2, "serbest"));
    cok.addEventListener("click", () => olcekDegistir(olcek * 1.2, "serbest"));
    sigdir.addEventListener("click", () => olcekDegistir(sigdirOlcek(), "sigdir"));
    yerlesikDugme.addEventListener("click", () => yerlesigeGec(""));
    let yenidenBoyut = 0;
    window.addEventListener("resize", () => { if (guncelOlcekModu !== "sigdir") return; clearTimeout(yenidenBoyut); yenidenBoyut = setTimeout(() => { if (!iptal && alan.isConnected) olcekDegistir(sigdirOlcek(), "sigdir"); }, 200); });
  } catch (h) {
    if (!iptal) {
      console.warn("evrensel-pdf: PDF.js ile açılamadı, yerleşik okuyucuya geçiliyor:", h);
      // Bayt alınamadıysa (CORS vb.) URL doğrudan çerçeveye verilir; baytlar varsa blob ile.
      yerlesigeGec(h?.message ? `${h.message}` : "PDF.js açamadı.");
    }
  }
  return { yokEt, blob: blobAl };
}

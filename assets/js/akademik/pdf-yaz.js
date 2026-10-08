/*
 * assets/js/akademik/pdf-yaz.js — PDF açıklamalarını standart PDF annotation katmanına OKUR/YAZAR (pdf-lib).
 *
 * Yazılan her açıklama ISO 32000 uyumlu bir /Annot sözlüğüdür ve KENDİ GÖRÜNÜM AKIŞINI (/AP) taşır;
 * böylece Adobe Acrobat, Apple Books/Önizleme, Chrome, Firefox, Foxit vb. aynen gösterir:
 *   vurgu → /Highlight (QuadPoints, Multiply karışımı) · altçizgi → /Underline · üstçizgi → /StrikeOut
 *   çizim → /Ink (InkList) · şekil → /Square · yapışkan not → /Text · metin kutusu → /FreeText
 * Her açıklamanın /NM alanı bizim kimliğimizdir ("ae-<uuid>"); aynı kimlik Supabase'teki ek_id'dir.
 * Başka bir uygulamada eklenmiş açıklamalar da okunur; düzenlenir/silinirse eski nesne /Annots'tan çıkarılır
 * (silinen açıklamanın /Popup'ı da). Dokunulmayanlar ve tanınmayan türler (Link, Widget…) OLDUĞU GİBİ kalır.
 *
 * MODEL (tek biçim; hem arayüz hem bu modül kullanır; koordinatlar PDF kullanıcı uzayında, dönüşsüz):
 *   { id, nm, tur, sayfa, kutular?:[[x1,y1,x2,y2]], cizgiler?:[[x,y,x,y,…]], rect?:[x1,y1,x2,y2],
 *     renk:'#rrggbb', yorum, metin, kalinlik?, yaziPt?, durum:'ayni'|'yeni'|'degisti', ref?:'12 0' }
 */

export const TUR_ALT_TIP = { vurgu: "Highlight", altcizgi: "Underline", ustcizgi: "StrikeOut", cizim: "Ink", sekil: "Square", yapiskan: "Text", metin: "FreeText" };
const ALT_TIP_TUR = Object.fromEntries(Object.entries(TUR_ALT_TIP).map(([k, v]) => [v, k]));
export const NOT_BOYUTU = 20;

const hexRgb = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  const n = m ? parseInt(m[1], 16) : 0xffd400;
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const rgbHex = (a) => "#" + a.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0")).join("");
const f = (v) => Number(v.toFixed(3));

function pdfTarihi(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

/* ------------------------------- OKUMA ------------------------------- */

function sayilar(PDFLib, sozluk, anahtar) {
  const { PDFName, PDFArray } = PDFLib;
  const dizi = sozluk.lookupMaybe(PDFName.of(anahtar), PDFArray);
  if (!dizi) return null;
  const cikti = [];
  for (let i = 0; i < dizi.size(); i++) {
    const v = dizi.lookup(i);
    cikti.push(v && typeof v.asNumber === "function" ? v.asNumber() : NaN);
  }
  return cikti.some(Number.isNaN) ? null : cikti;
}

function metin(PDFLib, sozluk, anahtar) {
  const { PDFName, PDFString, PDFHexString } = PDFLib;
  const v = sozluk.lookupMaybe(PDFName.of(anahtar), PDFString, PDFHexString);
  try { return v ? v.decodeText() : ""; } catch { return ""; }
}

/**
 * PDF'i pdf-lib ile açar, tanınan açıklamaları modele çevirir.
 * @returns {{pdfDoc, aciklamalar:Array, sifreli:boolean}}  sifreli=true → pdf-lib açamadı (şifre/bozuk)
 */
export async function acikla(PDFLib, bayt) {
  const { PDFDocument, PDFName, PDFDict, PDFRef } = PDFLib;
  let pdfDoc;
  try {
    pdfDoc = await PDFDocument.load(bayt, { updateMetadata: false, throwOnInvalidObject: false });
  } catch (h) {
    console.warn("pdf-lib PDF'i açamadı:", h);
    return { pdfDoc: null, aciklamalar: [], sifreli: true };
  }
  const aciklamalar = [];
  pdfDoc.getPages().forEach((sayfa, idx) => {
    const dizi = sayfa.node.Annots();
    if (!dizi) return;
    for (let i = 0; i < dizi.size(); i++) {
      const ham = dizi.get(i);
      const sozluk = dizi.lookupMaybe(i, PDFDict);
      if (!sozluk) continue;
      const alt = sozluk.lookupMaybe(PDFName.of("Subtype"), PDFName);
      const tur = alt ? ALT_TIP_TUR[alt.decodeText()] : null;
      if (!tur) continue;
      // Popup/yanıt iş parçacıklarında asıl açıklama değil, yanıtlar (/IRT) atlanır.
      if (sozluk.has(PDFName.of("IRT"))) continue;

      const rectHam = sayilar(PDFLib, sozluk, "Rect");
      if (!rectHam || rectHam.length < 4) continue;
      const rect = [Math.min(rectHam[0], rectHam[2]), Math.min(rectHam[1], rectHam[3]), Math.max(rectHam[0], rectHam[2]), Math.max(rectHam[1], rectHam[3])];
      const renkDizi = sayilar(PDFLib, sozluk, "C");
      const renk = renkDizi && renkDizi.length === 3 ? rgbHex(renkDizi) : tur === "yapiskan" || tur === "vurgu" ? "#ffd400" : "#ff6666";
      const nm = metin(PDFLib, sozluk, "NM");
      const a = {
        id: nm || `dosya-${ham instanceof PDFRef ? ham.objectNumber + "-" + ham.generationNumber : `${idx}-${i}`}`,
        nm: nm || null,
        tur,
        sayfa: idx + 1,
        renk,
        yorum: metin(PDFLib, sozluk, "Contents"),
        metin: "",
        rect,
        durum: "ayni",
        ref: ham instanceof PDFRef ? `${ham.objectNumber} ${ham.generationNumber}` : null,
      };
      if (tur === "vurgu" || tur === "altcizgi" || tur === "ustcizgi") {
        const q = sayilar(PDFLib, sozluk, "QuadPoints");
        const kutular = [];
        if (q) {
          for (let k = 0; k + 7 < q.length; k += 8) {
            const xs = [q[k], q[k + 2], q[k + 4], q[k + 6]];
            const ys = [q[k + 1], q[k + 3], q[k + 5], q[k + 7]];
            kutular.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
          }
        }
        a.kutular = kutular.length ? kutular : [rect];
      } else if (tur === "cizim") {
        const { PDFArray } = PDFLib;
        const liste = sozluk.lookupMaybe(PDFName.of("InkList"), PDFArray);
        const cizgiler = [];
        if (liste) {
          for (let k = 0; k < liste.size(); k++) {
            const alt2 = liste.lookupMaybe(k, PDFArray);
            if (!alt2) continue;
            const nok = [];
            for (let m = 0; m < alt2.size(); m++) nok.push(alt2.lookup(m).asNumber());
            if (nok.length >= 4) cizgiler.push(nok);
          }
        }
        if (!cizgiler.length) continue;
        a.cizgiler = cizgiler;
        const bs = sozluk.lookupMaybe(PDFName.of("BS"), PDFDict);
        a.kalinlik = bs?.lookupMaybe(PDFName.of("W"), PDFLib.PDFNumber)?.asNumber() ?? 1.5;
      } else if (tur === "sekil") {
        const bs = sozluk.lookupMaybe(PDFName.of("BS"), PDFDict);
        a.kalinlik = bs?.lookupMaybe(PDFName.of("W"), PDFLib.PDFNumber)?.asNumber() ?? 1.5;
      } else if (tur === "metin") {
        const da = metin(PDFLib, sozluk, "DA");
        const pt = /([\d.]+)\s+Tf/.exec(da);
        a.yaziPt = pt ? Number(pt[1]) || 12 : 12;
        const rg = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/.exec(da);
        if (rg) a.renk = rgbHex([Number(rg[1]), Number(rg[2]), Number(rg[3])]);
        else a.renk = "#000000";
      }
      aciklamalar.push(a);
    }
  });
  return { pdfDoc, aciklamalar, sifreli: false };
}

/* ------------------------------- YAZMA ------------------------------- */

/** Serbest metin kutusunun görünümünü (Türkçe karakter dahil her yazı) PNG olarak üretir. */
export async function metinKutusuPng(metin, genislik, yukseklik, yaziPt, renk) {
  const olcek = 3;
  const tuval = document.createElement("canvas");
  tuval.width = Math.max(1, Math.ceil(genislik * olcek));
  tuval.height = Math.max(1, Math.ceil(yukseklik * olcek));
  const c = tuval.getContext("2d");
  c.scale(olcek, olcek);
  c.fillStyle = renk;
  c.font = `${yaziPt}px Helvetica, Arial, sans-serif`;
  c.textBaseline = "top";
  let y = 2;
  for (const satir of satirlaraBol(c, metin, genislik - 4)) {
    c.fillText(satir, 2, y);
    y += yaziPt * 1.2;
  }
  const blob = await new Promise((coz) => tuval.toBlob(coz, "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}

/** Bir tuval bağlamında kelime kaydırma (hem PDF görünümü hem ekran çizimi kullanır). */
export function satirlaraBol(c, metin, enPx) {
  const cikti = [];
  for (const paragraf of String(metin || "").split("\n")) {
    let satir = "";
    for (const kelime of paragraf.split(/(\s+)/)) {
      const deneme = satir + kelime;
      if (satir && c.measureText(deneme).width > enPx) { cikti.push(satir.trimEnd()); satir = kelime.trimStart(); }
      else satir = deneme;
    }
    cikti.push(satir.trimEnd());
  }
  return cikti;
}

function formNesnesi(ctx, bbox, icerik, kaynaklar = {}) {
  return ctx.register(ctx.stream(icerik, { Type: "XObject", Subtype: "Form", BBox: bbox, Resources: kaynaklar }));
}

function altRect(a) {
  if (a.kutular?.length) {
    return [Math.min(...a.kutular.map((k) => k[0])), Math.min(...a.kutular.map((k) => k[1])), Math.max(...a.kutular.map((k) => k[2])), Math.max(...a.kutular.map((k) => k[3]))];
  }
  if (a.cizgiler?.length) {
    const xs = a.cizgiler.flatMap((c) => c.filter((_, i) => i % 2 === 0));
    const ys = a.cizgiler.flatMap((c) => c.filter((_, i) => i % 2 === 1));
    const w = (a.kalinlik || 1.5) / 2 + 1;
    return [Math.min(...xs) - w, Math.min(...ys) - w, Math.max(...xs) + w, Math.max(...ys) + w];
  }
  return a.rect;
}

async function ekle(PDFLib, pdfDoc, sayfa, a, { yazar }) {
  const { PDFName, PDFString, PDFHexString } = PDFLib;
  const ctx = pdfDoc.context;
  const [r, g, b] = hexRgb(a.renk);
  const rgb = `${f(r)} ${f(g)} ${f(b)}`;
  const rect = altRect(a).map(f);
  const w = rect[2] - rect[0];
  const h = rect[3] - rect[1];
  const nm = a.nm || `ae-${a.id}`;
  const tipi = TUR_ALT_TIP[a.tur];
  const simdi = pdfTarihi();

  const sozlukHam = {
    Type: "Annot", Subtype: tipi, Rect: rect, F: 4, C: [f(r), f(g), f(b)], CA: 1,
    NM: PDFString.of(nm), T: PDFHexString.fromText(yazar || "Akademik Kütüphane"),
    M: PDFString.of(simdi), CreationDate: PDFString.of(simdi), P: sayfa.ref,
  };
  if (a.yorum) sozlukHam.Contents = PDFHexString.fromText(a.yorum);

  let ap;
  if (a.tur === "vurgu" || a.tur === "altcizgi" || a.tur === "ustcizgi") {
    const quad = [];
    let ic = "";
    for (const [x1, y1, x2, y2] of a.kutular) {
      quad.push(f(x1), f(y2), f(x2), f(y2), f(x1), f(y1), f(x2), f(y1));
      const kh = y2 - y1;
      if (a.tur === "vurgu") ic += `${f(x1)} ${f(y1)} m ${f(x2)} ${f(y1)} l ${f(x2)} ${f(y2)} l ${f(x1)} ${f(y2)} l h f\n`;
      else {
        const y = a.tur === "altcizgi" ? y1 + Math.max(0.8, kh * 0.12) : (y1 + y2) / 2;
        ic += `${f(x1)} ${f(y)} m ${f(x2)} ${f(y)} l S\n`;
      }
    }
    sozlukHam.QuadPoints = quad;
    if (a.tur === "vurgu") {
      const gs = ctx.register(ctx.obj({ Type: "ExtGState", BM: "Multiply", ca: 1, CA: 1 }));
      ap = formNesnesi(ctx, rect, `/GS gs\n${rgb} rg\n${ic}`, { ExtGState: { GS: gs } });
    } else {
      ap = formNesnesi(ctx, rect, `${rgb} RG 1 w\n${ic}`);
    }
  } else if (a.tur === "cizim") {
    const kal = a.kalinlik || 1.5;
    sozlukHam.InkList = a.cizgiler.map((c) => c.map(f));
    sozlukHam.BS = { W: kal, S: "S" };
    let ic = `${rgb} RG ${f(kal)} w 1 J 1 j\n`;
    for (const c of a.cizgiler) {
      ic += `${f(c[0])} ${f(c[1])} m `;
      for (let i = 2; i + 1 < c.length; i += 2) ic += `${f(c[i])} ${f(c[i + 1])} l `;
      if (c.length === 4 && c[0] === c[2] && c[1] === c[3]) ic += `${f(c[0] + 0.01)} ${f(c[1])} l `;
      ic += "S\n";
    }
    ap = formNesnesi(ctx, rect, ic);
  } else if (a.tur === "sekil") {
    const kal = a.kalinlik || 1.5;
    sozlukHam.BS = { W: kal, S: "S" };
    ap = formNesnesi(ctx, rect, `${rgb} RG ${f(kal)} w ${f(rect[0] + kal / 2)} ${f(rect[1] + kal / 2)} ${f(Math.max(0, w - kal))} ${f(Math.max(0, h - kal))} re S\n`);
  } else if (a.tur === "yapiskan") {
    sozlukHam.F = 28; // yazdır + yakınlaştırmayla büyüme yok + dönmez
    sozlukHam.Name = "Comment";
    sozlukHam.Open = false;
    const N = NOT_BOYUTU;
    ap = formNesnesi(ctx, [0, 0, N, N], `${rgb} rg 0 0 ${N} ${N} re f 0.15 0.15 0.15 RG 1 w 0.5 0.5 ${N - 1} ${N - 1} re S 4 14 m 16 14 l S 4 10 m 16 10 l S 4 6 m 12 6 l S\n`);
  } else if (a.tur === "metin") {
    const pt = a.yaziPt || 12;
    sozlukHam.DA = PDFString.of(`${f(r)} ${f(g)} ${f(b)} rg /Helv ${pt} Tf`);
    sozlukHam.Q = 0;
    const png = await metinKutusuPng(a.yorum || "", w, h, pt, a.renk);
    const resim = await pdfDoc.embedPng(png);
    ap = formNesnesi(ctx, [0, 0, f(w), f(h)], `q ${f(w)} 0 0 ${f(h)} 0 0 cm /Im0 Do Q\n`, { XObject: { Im0: resim.ref } });
    delete sozlukHam.C; // metin kutusunda /C arka plan rengi anlamına gelir; saydam kalsın
  }
  sozlukHam.AP = { N: ap };
  const ref = ctx.register(ctx.obj(sozlukHam));
  sayfa.node.addAnnot(ref);
  return { ref, nm };
}

function kaldir(PDFLib, sayfa, esles) {
  const { PDFDict, PDFName, PDFRef } = PDFLib;
  const dizi = sayfa.node.Annots();
  if (!dizi) return 0;
  let silinen = 0;
  for (let i = dizi.size() - 1; i >= 0; i--) {
    const ham = dizi.get(i);
    const sozluk = dizi.lookupMaybe(i, PDFDict);
    if (!sozluk) continue;
    const nm = metin(PDFLib, sozluk, "NM");
    const refStr = ham instanceof PDFRef ? `${ham.objectNumber} ${ham.generationNumber}` : null;
    if (!esles(nm, refStr)) continue;
    const popup = sozluk.get(PDFName.of("Popup"));
    dizi.remove(i);
    silinen++;
    if (popup instanceof PDFRef) {
      for (let j = dizi.size() - 1; j >= 0; j--) {
        const p = dizi.get(j);
        if (p instanceof PDFRef && p.objectNumber === popup.objectNumber) { dizi.remove(j); break; }
      }
    }
  }
  return silinen;
}

/**
 * Değişiklikleri PDF'e uygular ve yeni baytları döndürür.
 * @param degisenler  durum 'yeni' | 'degisti' olanlar (eskisi varsa önce kaldırılıp yenisi yazılır)
 * @param silinenler  modelden silinmiş, dosyada hâlâ bulunan açıklamalar ({nm, ref, sayfa})
 */
export async function uygula(PDFLib, pdfDoc, { degisenler, silinenler, yazar }) {
  const sayfalar = pdfDoc.getPages();
  for (const s of silinenler) {
    const sayfa = sayfalar[s.sayfa - 1];
    if (sayfa) kaldir(PDFLib, sayfa, (nm, ref) => (s.nm && nm === s.nm) || (!s.nm && s.ref && ref === s.ref));
  }
  for (const a of degisenler) {
    const sayfa = sayfalar[a.sayfa - 1];
    if (!sayfa) continue;
    if (a.durum === "degisti") kaldir(PDFLib, sayfa, (nm, ref) => (a.nm && nm === a.nm) || (!a.nm && a.ref && ref === a.ref));
    const { nm } = await ekle(PDFLib, pdfDoc, sayfa, a, { yazar });
    a.nm = nm;
  }
  return pdfDoc.save({ updateFieldAppearances: false });
}

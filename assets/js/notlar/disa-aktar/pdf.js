/*
 * assets/js/notlar/disa-aktar/pdf.js
 * -----------------------------------------------------------------------
 * Bağımlılıksız, tarayıcıda çalışan PDF üretici (A4, metin + görsel).
 *
 *  - Standart Helvetica ailesi (PDF'e gömülmez, her okuyucuda vardır) + özel Encoding:
 *    WinAnsi taban alınır; Ğ ğ İ ı Ş ş için /Differences ile 1–6. kodlar atanır.
 *    Böylece TÜRKÇE KARAKTERLERİN TAMAMI doğru görünür.
 *  - Kalın / italik / altı çizili / üstü çizili / vurgulu, başlıklar, madde ve numaralı
 *    listeler (iç içe), yapılacaklar kutuları, alıntı bloğu, ayraç, görsel (JPEG), sayfa numarası.
 *  - İçerik akışı FlateDecode ile sıkıştırılır (CompressionStream varsa).
 * -----------------------------------------------------------------------
 */
import { zlibSikistir } from "./zip.js";

const SAYFA_G = 595.28;
const SAYFA_Y = 841.89;
const KENAR = 56;
const ALT_KENAR = 60;
const ICERIK_G = SAYFA_G - KENAR * 2;

/* Helvetica AFM genişlikleri (1000 birim), kod 32–126 */
const W_N = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const W_B = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];

const OZEL = { Ğ: 1, ğ: 2, İ: 3, ı: 4, Ş: 5, ş: 6, "‘": 145, "’": 146, "“": 147, "”": 148, "•": 149, "–": 150, "—": 151, "…": 133, "€": 128, "™": 153 };
const TABAN_HARF = { Ğ: "G", ğ: "g", İ: "I", ı: "i", Ş: "S", ş: "s" };

/* Helvetica'da olmayan sık karakterler için yakın karşılıklar ("?" yerine okunur metin). */
const BENZER = {
  "→": "->", "←": "<-", "↔": "<->", "⇒": "=>", "✓": "v", "✔": "v", "✗": "x", "✘": "x", "≥": ">=", "≤": "<=", "≠": "!=", "≈": "~",
  "−": "-", "‐": "-", "‑": "-", "‒": "-", "′": "'", "″": '"', "‚": ",", "„": '"', "‹": "<", "›": ">", "\u2009": " ", "\u202f": " ",
  "\u2002": " ", "\u2003": " ", "\u200b": "", "\ufeff": "", "☐": "[ ]", "☑": "[x]", "★": "*", "☆": "*", "◦": "-", "▪": "-", "●": "•",
};
const kodlanabilirMi = (ch) => OZEL[ch] !== undefined || (ch.codePointAt(0) >= 32 && ch.codePointAt(0) <= 126) || (ch.codePointAt(0) >= 160 && ch.codePointAt(0) <= 255);

/** PDF yazı tipinde bulunmayan karakterleri yakın karşılığına çevirir; çevrilemeyenleri sayar. */
export function pdfMetni(metin, sayac = null) {
  let c = "";
  for (const ch of String(metin ?? "")) {
    if (ch === "\t" || ch === "\n" || ch === "\r") c += " ";
    else if (kodlanabilirMi(ch)) c += ch;
    else if (BENZER[ch] !== undefined) c += BENZER[ch];
    else {
      const taban = ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (taban && [...taban].every(kodlanabilirMi)) c += taban;
      else if (/[\u0300-\u036f\u200c-\u200f\ufe0f]/.test(ch)) continue; // birleştirici işaret / görünmez
      else {
        c += "?";
        if (sayac) sayac.kayip++;
      }
    }
  }
  return c;
}

function kodla(ch) {
  if (OZEL[ch] !== undefined) return OZEL[ch];
  const c = ch.codePointAt(0);
  if ((c >= 32 && c <= 126) || (c >= 160 && c <= 255)) return c;
  return 63; // ?
}

function genislik(ch, kalin) {
  const t = W_N;
  const tablo = kalin ? W_B : t;
  const taban = TABAN_HARF[ch] || ch;
  const c = taban.codePointAt(0);
  if (c >= 32 && c <= 126) return tablo[c - 32];
  if (ch === "ı") return 278;
  if (OZEL[ch] !== undefined && c > 255) return ch === "…" || ch === "—" ? 1000 : ch === "•" ? 350 : ch === "–" ? 556 : 333;
  const n = taban.normalize("NFD")[0];
  const nc = n.codePointAt(0);
  if (nc >= 32 && nc <= 126) return tablo[nc - 32];
  return 556;
}

function pdfDizgi(metin) {
  let s = "(";
  for (const ch of metin) {
    const k = kodla(ch);
    if (k === 40 || k === 41 || k === 92) s += "\\" + String.fromCharCode(k);
    else if (k < 32 || k > 126) s += "\\" + k.toString(8).padStart(3, "0");
    else s += String.fromCharCode(k);
  }
  return s + ")";
}

function utf16Hex(metin) {
  let h = "FEFF";
  for (let i = 0; i < metin.length; i++) h += metin.charCodeAt(i).toString(16).padStart(4, "0");
  return `<${h}>`;
}

const FONTLAR = { n: "F1", b: "F2", i: "F3", bi: "F4" };
const fontKey = (r) => (r.b && r.i ? "bi" : r.b ? "b" : r.i ? "i" : "n");

const sayi = (n) => (Math.round(n * 100) / 100).toString();

function pdfTarih(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

class Sayfa {
  constructor() {
    this.ops = [];
    this.resimler = new Set();
  }
}

export class PdfBelge {
  constructor({ baslik = "", yazar = "", olusturma = new Date(), degistirme = new Date() } = {}) {
    this.meta = { baslik, yazar, olusturma, degistirme };
    this.sayfalar = [];
    this.resimler = []; // {bayt, g, y}
    this.y = 0;
    this.kayip = 0; // yazı tipinde karşılığı olmayan, "?" ile gösterilen karakter sayısı
    this.yeniSayfa();
  }

  yeniSayfa() {
    this.sayfa = new Sayfa();
    this.sayfalar.push(this.sayfa);
    this.y = KENAR;
  }

  kalan() {
    return SAYFA_Y - ALT_KENAR - this.y;
  }

  gerekirse(yukseklik) {
    if (this.kalan() < yukseklik) this.yeniSayfa();
  }

  /** runs → kelime listesi (stil korunur), satırlara böler. */
  _satirlaraBol(runs, boyut, kalinZorla, enGenislik, ilkGirinti = 0) {
    const kelimeler = [];
    for (const r of runs) {
      if (r.br) {
        kelimeler.push({ br: true });
        continue;
      }
      const stil = { b: r.b || kalinZorla, i: r.i, u: r.u, s: r.s, mark: r.mark };
      for (const parca of pdfMetni(r.text, this).split(/(\s+)/)) {
        if (!parca) continue;
        if (/^\s+$/.test(parca)) kelimeler.push({ bosluk: true, stil });
        else kelimeler.push({ text: parca, stil });
      }
    }
    const olc = (metin, stil) => {
      let w = 0;
      for (const ch of metin) w += genislik(ch, stil.b);
      return (w * boyut) / 1000;
    };

    const satirlar = [];
    let satir = { ogeler: [], g: 0 };
    let limit = enGenislik - ilkGirinti;
    const bitir = () => {
      while (satir.ogeler.length && satir.ogeler[satir.ogeler.length - 1].bosluk) {
        satir.g -= satir.ogeler.pop().w;
      }
      satirlar.push(satir);
      satir = { ogeler: [], g: 0 };
      limit = enGenislik;
    };

    for (const k of kelimeler) {
      if (k.br) {
        bitir();
        continue;
      }
      if (k.bosluk) {
        if (!satir.ogeler.length) continue;
        const w = olc(" ", k.stil);
        satir.ogeler.push({ text: " ", stil: k.stil, w, bosluk: true });
        satir.g += w;
        continue;
      }
      let w = olc(k.text, k.stil);
      if (satir.g + w > limit && satir.ogeler.length) bitir();
      if (w > limit) {
        // tek başına satıra sığmayan uzun sözcük: karakter karakter böl
        let parca = "";
        let pw = 0;
        for (const ch of k.text) {
          const cw = olc(ch, k.stil);
          if (pw + cw > limit && parca) {
            satir.ogeler.push({ text: parca, stil: k.stil, w: pw });
            satir.g += pw;
            bitir();
            parca = "";
            pw = 0;
          }
          parca += ch;
          pw += cw;
        }
        if (parca) {
          satir.ogeler.push({ text: parca, stil: k.stil, w: pw });
          satir.g += pw;
        }
        continue;
      }
      satir.ogeler.push({ text: k.text, stil: k.stil, w });
      satir.g += w;
    }
    if (satir.ogeler.length || !satirlar.length) bitir();
    return satirlar;
  }

  /**
   * Biçimli paragraf yazar.
   * ayar: {boyut, kalin, x (girinti), isaret, isaretX, renk, aralik, satirAraligi, cubuk, sonrasi}
   */
  paragraf(runs, ayar = {}) {
    const boyut = ayar.boyut || 11;
    const satirY = boyut * (ayar.satirAraligi || 1.42);
    const x0 = KENAR + (ayar.x || 0);
    const genis = ICERIK_G - (ayar.x || 0);
    const renk = ayar.renk || "0.1 0.1 0.12";
    const satirlar = this._satirlaraBol(runs, boyut, !!ayar.kalin, genis);

    if (ayar.oncesi) this.y += ayar.oncesi;
    // başlık/ilk satır tek başına sayfa sonunda kalmasın
    this.gerekirse(satirY * Math.min(satirlar.length, ayar.birlikte || 2) + (ayar.birlikteEk || 0));

    let ilk = true;
    for (const satir of satirlar) {
      if (this.kalan() < satirY) this.yeniSayfa();
      const taban = this.y + boyut * 1.0; // metin taban çizgisi (yukarıdan)
      const pdfY = SAYFA_Y - taban;
      let x = x0;
      if (ilk && ayar.isaret) {
        this._yaz(ayar.isaret, x0 + (ayar.isaretX ?? -14), pdfY, "n", boyut, renk);
      }
      if (ayar.cubuk) {
        this.sayfa.ops.push(`${ayar.cubukRenk || "0.65 0.7 0.8"} RG ${sayi(2.2)} w ${sayi(x0 - 9)} ${sayi(SAYFA_Y - this.y + 1)} m ${sayi(x0 - 9)} ${sayi(SAYFA_Y - this.y - satirY + 1.5)} l S`);
      }
      for (const o of satir.ogeler) {
        const fk = fontKey(o.stil);
        if (o.stil.mark && !o.bosluk) {
          this.sayfa.ops.push(`1 0.93 0.45 rg ${sayi(x)} ${sayi(pdfY - boyut * 0.22)} ${sayi(o.w)} ${sayi(boyut * 1.08)} re f`);
        } else if (o.stil.mark && o.bosluk) {
          this.sayfa.ops.push(`1 0.93 0.45 rg ${sayi(x)} ${sayi(pdfY - boyut * 0.22)} ${sayi(o.w)} ${sayi(boyut * 1.08)} re f`);
        }
        if (!o.bosluk || o.stil.u || o.stil.s) {
          if (!o.bosluk) this._yaz(o.text, x, pdfY, fk, boyut, renk);
          if (o.stil.u) this.sayfa.ops.push(`${renk} RG 0.6 w ${sayi(x)} ${sayi(pdfY - boyut * 0.12)} m ${sayi(x + o.w)} ${sayi(pdfY - boyut * 0.12)} l S`);
          if (o.stil.s) this.sayfa.ops.push(`${renk} RG 0.6 w ${sayi(x)} ${sayi(pdfY + boyut * 0.3)} m ${sayi(x + o.w)} ${sayi(pdfY + boyut * 0.3)} l S`);
        }
        x += o.w;
      }
      this.y += satirY;
      ilk = false;
    }
    this.y += ayar.sonrasi ?? 0;
  }

  _yaz(metin, x, pdfY, fk, boyut, renk) {
    this.sayfa.ops.push(`BT ${renk} rg /${FONTLAR[fk]} ${sayi(boyut)} Tf ${sayi(x)} ${sayi(pdfY)} Td ${pdfDizgi(metin)} Tj ET`);
  }

  ayrac() {
    this.gerekirse(20);
    this.y += 8;
    const pdfY = SAYFA_Y - this.y;
    this.sayfa.ops.push(`0.8 0.82 0.86 RG 0.8 w ${sayi(KENAR)} ${sayi(pdfY)} m ${sayi(SAYFA_G - KENAR)} ${sayi(pdfY)} l S`);
    this.y += 10;
  }

  bosluk(n) {
    this.y += n;
  }

  /** bayt: JPEG baytları, g/y: piksel boyutu */
  resim(bayt, g, y, yazi = "") {
    const idx = this.resimler.push({ bayt, g, y }) - 1;
    let w = Math.min(ICERIK_G, g * 0.75);
    let h = (w * y) / g;
    const enYuksek = 420;
    if (h > enYuksek) {
      h = enYuksek;
      w = (h * g) / y;
    }
    if (h > this.kalan()) {
      if (h > SAYFA_Y - KENAR - ALT_KENAR) {
        h = SAYFA_Y - KENAR - ALT_KENAR;
        w = (h * g) / y;
      }
      this.yeniSayfa();
    }
    const pdfY = SAYFA_Y - this.y - h;
    this.sayfa.resimler.add(idx);
    this.sayfa.ops.push(`q ${sayi(w)} 0 0 ${sayi(h)} ${sayi(KENAR)} ${sayi(pdfY)} cm /Im${idx} Do Q`);
    this.y += h + 6;
    if (yazi) this.paragraf([{ text: yazi, i: true }], { boyut: 8.5, renk: "0.45 0.47 0.52", sonrasi: 6 });
  }

  async bayta(sikistir = true) {
    const nesneler = []; // her biri: Uint8Array parçaları listesi
    const kod = new TextEncoder();
    const ekle = (icerik) => {
      nesneler.push(icerik);
      return nesneler.length; // nesne numarası
    };
    // Sıra: 1 katalog, 2 sayfalar, 3 encoding, 4-7 fontlar, 8 info, sonra resimler, sonra sayfa+içerik
    const katalogNo = ekle(null);
    const sayfalarNo = ekle(null);
    const encNo = ekle("<< /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [1 /Gbreve /gbreve /Idotaccent /dotlessi /Scedilla /scedilla] >>");
    const fontNo = {};
    for (const [k, ad] of [["n", "Helvetica"], ["b", "Helvetica-Bold"], ["i", "Helvetica-Oblique"], ["bi", "Helvetica-BoldOblique"]]) {
      fontNo[k] = ekle(`<< /Type /Font /Subtype /Type1 /BaseFont /${ad} /Encoding ${encNo} 0 R >>`);
    }
    const info =
      `<< /Producer (Notlarım) /Creator (Notlarım) /Title ${utf16Hex(this.meta.baslik || "Not")} ` +
      (this.meta.yazar ? `/Author ${utf16Hex(this.meta.yazar)} ` : "") +
      `/CreationDate (${pdfTarih(this.meta.olusturma)}) /ModDate (${pdfTarih(this.meta.degistirme)}) >>`;
    const infoNo = ekle(info);

    const resimNo = this.resimler.map((r) => {
      const bas = kod.encode(`<< /Type /XObject /Subtype /Image /Width ${r.g} /Height ${r.y} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${r.bayt.length} >>\nstream\n`);
      const son = kod.encode("\nendstream");
      const u = new Uint8Array(bas.length + r.bayt.length + son.length);
      u.set(bas, 0);
      u.set(r.bayt, bas.length);
      u.set(son, bas.length + r.bayt.length);
      return ekle(u);
    });

    const sayfaNolari = [];
    const toplam = this.sayfalar.length;
    for (let i = 0; i < toplam; i++) {
      const s = this.sayfalar[i];
      // alt bilgi: sayfa numarası
      const no = `${i + 1} / ${toplam}`;
      let gen = 0;
      for (const ch of no) gen += genislik(ch, false);
      gen = (gen * 8) / 1000;
      s.ops.push(`BT 0.5 0.52 0.57 rg /F1 8 Tf ${sayi(SAYFA_G - KENAR - gen)} ${sayi(28)} Td ${pdfDizgi(no)} Tj ET`);
      if (this.meta.baslik) {
        let kisa = this.meta.baslik;
        if (kisa.length > 70) kisa = kisa.slice(0, 69) + "…";
        s.ops.push(`BT 0.5 0.52 0.57 rg /F1 8 Tf ${sayi(KENAR)} ${sayi(28)} Td ${pdfDizgi(kisa)} Tj ET`);
      }
      const icerik = kod.encode(s.ops.join("\n"));
      let akis = icerik;
      let filtre = "";
      if (sikistir) {
        const z = await zlibSikistir(icerik);
        if (z) {
          akis = z;
          filtre = "/Filter /FlateDecode ";
        }
      }
      const bas = kod.encode(`<< ${filtre}/Length ${akis.length} >>\nstream\n`);
      const son = kod.encode("\nendstream");
      const u = new Uint8Array(bas.length + akis.length + son.length);
      u.set(bas, 0);
      u.set(akis, bas.length);
      u.set(son, bas.length + akis.length);
      const icerikNo = ekle(u);
      const xobj = [...s.resimler].map((idx) => `/Im${idx} ${resimNo[idx]} 0 R`).join(" ");
      const sayfaNo = ekle(
        `<< /Type /Page /Parent ${sayfalarNo} 0 R /MediaBox [0 0 ${SAYFA_G} ${SAYFA_Y}] /Contents ${icerikNo} 0 R ` +
          `/Resources << /Font << /F1 ${fontNo.n} 0 R /F2 ${fontNo.b} 0 R /F3 ${fontNo.i} 0 R /F4 ${fontNo.bi} 0 R >> ${xobj ? `/XObject << ${xobj} >>` : ""} >> >>`
      );
      sayfaNolari.push(sayfaNo);
    }
    nesneler[katalogNo - 1] = `<< /Type /Catalog /Pages ${sayfalarNo} 0 R /Lang (tr-TR) >>`;
    nesneler[sayfalarNo - 1] = `<< /Type /Pages /Kids [${sayfaNolari.map((n) => `${n} 0 R`).join(" ")}] /Count ${sayfaNolari.length} >>`;

    const parcalar = [kod.encode("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n")];
    let konum = parcalar[0].length;
    const ofsetler = [];
    for (let i = 0; i < nesneler.length; i++) {
      ofsetler.push(konum);
      const n = nesneler[i];
      const bas = kod.encode(`${i + 1} 0 obj\n`);
      const govde = typeof n === "string" ? kod.encode(n) : n;
      const son = kod.encode("\nendobj\n");
      parcalar.push(bas, govde, son);
      konum += bas.length + govde.length + son.length;
    }
    const xref = [`xref\n0 ${nesneler.length + 1}\n0000000000 65535 f \n`];
    for (const o of ofsetler) xref.push(`${String(o).padStart(10, "0")} 00000 n \n`);
    xref.push(`trailer\n<< /Size ${nesneler.length + 1} /Root ${katalogNo} 0 R /Info ${infoNo} 0 R >>\nstartxref\n${konum}\n%%EOF\n`);
    parcalar.push(kod.encode(xref.join("")));

    let toplamBayt = 0;
    for (const p of parcalar) toplamBayt += p.length;
    const cikti = new Uint8Array(toplamBayt);
    let o = 0;
    for (const p of parcalar) {
      cikti.set(p, o);
      o += p.length;
    }
    return cikti;
  }
}

/** Blok listesi + künye → PDF baytları. resimAl(ekId) → {jpeg:Uint8Array, g, y, ad} | null */
export async function pdfUret({ baslik, kunye, bloklar, resimAl, alintilar, yazar, olusturma, guncelleme }) {
  const belge = new PdfBelge({ baslik, yazar, olusturma: new Date(olusturma), degistirme: new Date(guncelleme) });

  belge.paragraf([{ text: baslik || "Başlıksız not" }], { boyut: 22, kalin: true, satirAraligi: 1.25, sonrasi: 6, renk: "0.06 0.07 0.1" });
  for (const [e, d] of kunye) {
    belge.paragraf([{ text: `${e}: `, b: true }, { text: d }], { boyut: 9, renk: "0.38 0.4 0.46", satirAraligi: 1.35 });
  }
  belge.ayrac();

  for (const b of bloklar) {
    if (b.t === "h") {
      belge.paragraf(b.runs, b.s === 1 ? { boyut: 16, kalin: true, oncesi: 10, sonrasi: 4, birlikte: 3, satirAraligi: 1.3, renk: "0.06 0.07 0.1" } : { boyut: 13, kalin: true, oncesi: 7, sonrasi: 3, birlikte: 3, satirAraligi: 1.3, renk: "0.1 0.12 0.18" });
    } else if (b.t === "p") {
      belge.paragraf(b.runs, { boyut: 11, sonrasi: 5 });
    } else if (b.t === "li") {
      const x = 18 + b.d * 18;
      belge.paragraf(b.runs, { boyut: 11, x, isaret: b.isaret === "☐" ? "[   ]" : b.isaret === "☑" ? "[ x ]" : b.isaret, isaretX: b.isaret === "☐" || b.isaret === "☑" ? -21 : -13, sonrasi: 2.5 });
    } else if (b.t === "q") {
      belge.paragraf(b.runs.map((r) => ({ ...r, i: true })), { boyut: 11, x: 20, cubuk: true, renk: "0.28 0.3 0.36", sonrasi: 5 });
    } else if (b.t === "hr") {
      belge.ayrac();
    } else if (b.t === "img") {
      const r = await resimAl(b.ek);
      if (r?.jpeg) belge.resim(r.jpeg, r.g, r.y, "");
      else belge.paragraf([{ text: `[Görsel: ${b.alt || "eklenemedi"}]`, i: true }], { boyut: 10, renk: "0.45 0.47 0.52", sonrasi: 5 });
    }
  }

  if (alintilar?.length) {
    belge.paragraf([{ text: "Kaynaklı alıntılar" }], { boyut: 16, kalin: true, oncesi: 14, sonrasi: 4, birlikte: 3 });
    for (const a of alintilar) {
      if (a.alinti.trim()) belge.paragraf([{ text: a.alinti.trim(), i: true }], { boyut: 11, x: 20, cubuk: true, renk: "0.28 0.3 0.36", sonrasi: 2 });
      const kunyeMetni = [a.kaynak.trim(), a.sayfa.trim()].filter(Boolean).join(", ");
      if (kunyeMetni) belge.paragraf([{ text: `— ${kunyeMetni}` }], { boyut: 9.5, x: 20, renk: "0.4 0.42 0.48", sonrasi: 3 });
      if (a.yorum.trim()) belge.paragraf([{ text: "Yorumum: ", b: true }, { text: a.yorum.trim() }], { boyut: 11, x: 20, sonrasi: 8 });
    }
  }
  if (belge.kayip > 0) {
    belge.paragraf([{ text: `Not: ${belge.kayip} karakter (emoji ya da Latin dışı yazı) PDF yazı tipinde bulunmadığı için "?" olarak gösterildi. Metnin tamamı için Word, Markdown veya Web sayfası çıktısını kullanabilirsin.`, i: true }], { boyut: 8.5, renk: "0.45 0.47 0.52", oncesi: 12, sonrasi: 0 });
  }
  return belge.bayta(true);
}

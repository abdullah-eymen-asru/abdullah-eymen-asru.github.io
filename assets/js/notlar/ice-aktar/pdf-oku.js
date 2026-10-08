/*
 * assets/js/notlar/ice-aktar/pdf-oku.js
 * -----------------------------------------------------------------------
 * Bağımlılıksız, DOM'suz PDF METİN + GÖRSEL çıkarıcı (tarayıcıda ve Node'da çalışır).
 *
 * NEDEN: eski çıkarıcı yalnızca (düz metin) Tj/TJ dizgilerini okuyordu; Identity-H (CID) yazı tipleri,
 * ToUnicode haritaları, nesne akışları (ObjStm), çok sütunlu mizanpaj ve gömülü görseller yoktu → rapor tipi
 * PDF'lerde (örn. araştırma raporları) çöp metin üretiliyordu.
 *
 * YAPTIKLARI
 *   1. Nesneleri xref'e GÜVENMEDEN tarar (bozuk/eksik xref, artımlı güncelleme, ObjStm dahil).
 *   2. Sayfa ağacını gezer (bozuksa tüm /Page nesneleri); içerik akışlarını yorumlar (BT/ET, Tm, Td, TJ, Do, q/Q…).
 *   3. Yazı tiplerini çözer: ToUnicode (bfchar/bfrange), Encoding/Differences, Type0/CID genişlikleri.
 *   4. Yerleşim: satır kümeleme, SÜTUN tespiti (gutter + yayılan satırlar), başlık/paragraf/madde, tekrar eden
 *      üst/alt bilgi ve sayfa numarası temizliği, kısa çizgiyle bölünmüş sözcükleri birleştirme.
 *   5. Gömülü görseller: JPEG (DCT) olduğu gibi, Flate ham piksel → PNG (SMask varsa alfa ile).
 *   6. ASLA fırlatmaz (şifreli PDF hariç, açık hata): sayfa bazlı try/catch; çözülemeyen sayfa uyarıya dönüşür.
 *
 * Dönen: { bloklar:[{t:"h"|"p"|"li"|"img", ...}], baslik, gorseller:[{id,tip,bayt,pxG,pxY,sayfa}],
 *          uyarilar:[], sayfaSayisi, harfSayisi, cozulemeyenOran }
 * -----------------------------------------------------------------------
 */

const L1 = new TextDecoder("latin1");
const SINIR = { TOPLAM_GORSEL_BAYT: 100 * 1024 * 1024, SAYFA: 600, GORSEL: 40, GORSEL_BAYT: 15 * 1024 * 1024, HAM_PIKSEL_BAYT: 96 * 1024 * 1024, FORM_DERINLIK: 8, FORM_CAGRI: 4000 };

/* ============================ 1) Değer modeli + sözcük çözümleyici ============================ */

class Ad { constructor(v) { this.v = v; } }
class Ref { constructor(n, g) { this.n = n; this.g = g; } }
class Dz { constructor(b) { this.b = b; } } // PDF dizgisi (bayt)
class Akis { constructor(sozluk, veri) { this.d = sozluk; this.veri = veri; } }

const BOS = (c) => c === 32 || c === 10 || c === 13 || c === 9 || c === 12 || c === 0;
const AYIRAC = (c) => c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 47 || c === 37;

class Sozcuk {
  constructor(u8, pos = 0, icerik = false) { this.u = u8; this.p = pos; this.icerik = icerik; }
  bosluk() {
    const u = this.u;
    while (this.p < u.length) {
      const c = u[this.p];
      if (BOS(c)) this.p++;
      else if (c === 37) { while (this.p < u.length && u[this.p] !== 10 && u[this.p] !== 13) this.p++; }
      else break;
    }
  }
  /** Bir değer (sayı, ad, dizgi, dizi, sözlük) ya da anahtar sözcük ({k:"ad"}) okur. Sonda null. */
  oku() {
    this.bosluk();
    const u = this.u;
    if (this.p >= u.length) return null;
    const c = u[this.p];
    if (c === 47) return this.ad();
    if (c === 40) return this.dizgi();
    if (c === 60) {
      if (u[this.p + 1] === 60) { this.p += 2; return this.sozluk(); }
      return this.hex();
    }
    if (c === 91) { this.p++; return this.dizi(); }
    if (c === 93 || c === 62 || c === 41 || c === 123 || c === 125) { this.p++; return { k: String.fromCharCode(c) }; }
    // sayı / anahtar sözcük
    const bas = this.p;
    while (this.p < u.length && !BOS(u[this.p]) && !AYIRAC(u[this.p])) this.p++;
    if (this.p === bas) { this.p++; return { k: String.fromCharCode(c) }; }
    const s = L1.decode(u.subarray(bas, this.p));
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return parseFloat(s);
    if (/^[+-]?[\d.]+$/.test(s)) return parseFloat(s) || 0; // "--5" gibi bozuk sayılar
    if (s === "true") return true;
    if (s === "false") return false;
    if (s === "null") return { k: "null" };
    return { k: s };
  }
  ad() {
    this.p++;
    const u = this.u;
    const bas = this.p;
    while (this.p < u.length && !BOS(u[this.p]) && !AYIRAC(u[this.p])) this.p++;
    let s = L1.decode(u.subarray(bas, this.p));
    if (s.includes("#")) s = s.replace(/#([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    return new Ad(s);
  }
  dizgi() {
    const u = this.u;
    this.p++;
    const cikti = [];
    let derin = 1;
    while (this.p < u.length) {
      let c = u[this.p++];
      if (c === 92) {
        c = u[this.p++];
        if (c === 110) cikti.push(10);
        else if (c === 114) cikti.push(13);
        else if (c === 116) cikti.push(9);
        else if (c === 98) cikti.push(8);
        else if (c === 102) cikti.push(12);
        else if (c >= 48 && c <= 55) {
          let v = c - 48;
          for (let i = 0; i < 2 && u[this.p] >= 48 && u[this.p] <= 55; i++) v = v * 8 + (u[this.p++] - 48);
          cikti.push(v & 255);
        } else if (c === 13) { if (u[this.p] === 10) this.p++; }
        else if (c === 10) { /* satır devamı */ }
        else if (c !== undefined) cikti.push(c);
      } else if (c === 40) { derin++; cikti.push(c); }
      else if (c === 41) { if (--derin === 0) break; cikti.push(c); }
      else cikti.push(c);
    }
    return new Dz(Uint8Array.from(cikti));
  }
  hex() {
    const u = this.u;
    this.p++;
    let h = "";
    while (this.p < u.length && u[this.p] !== 62) {
      const c = u[this.p++];
      if ((c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102)) h += String.fromCharCode(c);
    }
    this.p++;
    if (h.length % 2) h += "0";
    const b = new Uint8Array(h.length / 2);
    for (let i = 0; i < b.length; i++) b[i] = parseInt(h.substr(i * 2, 2), 16);
    return new Dz(b);
  }
  dizi() {
    const a = [];
    for (;;) {
      const v = this.oku();
      if (v === null || (v && v.k === "]")) break;
      if (v && v.k === ">" ) continue;
      // "n g R" gönderimi
      if (!this.icerik && typeof v === "number" && Number.isInteger(v)) {
        const s = this.p;
        const g = this.oku();
        if (typeof g === "number" && Number.isInteger(g)) {
          const r = this.oku();
          if (r && r.k === "R") { a.push(new Ref(v, g)); continue; }
        }
        this.p = s;
      }
      a.push(v);
    }
    return a;
  }
  sozluk() {
    const d = new Map();
    for (;;) {
      const k = this.oku();
      if (k === null) break;
      if (k && k.k === ">") { if (this.u[this.p] === 62) this.p++; break; }
      if (!(k instanceof Ad)) continue;
      let v = this.oku();
      if (!this.icerik && typeof v === "number" && Number.isInteger(v)) {
        const s = this.p;
        const g = this.oku();
        if (typeof g === "number" && Number.isInteger(g)) {
          const r = this.oku();
          if (r && r.k === "R") v = new Ref(v, g);
          else this.p = s;
        } else this.p = s;
      }
      if (v && v.k === ">") { if (this.u[this.p] === 62) this.p++; d.set(k.v, null); break; }
      d.set(k.v, v);
    }
    return d;
  }
}

/* ============================ 2) Süzgeçler ============================ */

async function akisOku(girdi, bicim) {
  const parcalar = [];
  let toplam = 0;
  const okuyucu = new Blob([girdi]).stream().pipeThrough(new DecompressionStream(bicim)).getReader();
  try {
    for (;;) {
      const { done, value } = await okuyucu.read();
      if (done) break;
      parcalar.push(value);
      toplam += value.length;
      if (toplam > 256 * 1024 * 1024) break; // sıkıştırma bombası
    }
  } catch { /* bozuk/eksik akış: elde olanı döndür */ }
  const cikti = new Uint8Array(toplam);
  let o = 0;
  for (const p of parcalar) { cikti.set(p, o); o += p.length; }
  return cikti;
}

async function inflate(u8) {
  let r = await akisOku(u8, "deflate");
  if (!r.length && u8.length > 2) r = await akisOku(u8.subarray(2), "deflate-raw"); // başlığı bozuk zlib
  return r;
}

function lzw(u8, erken = 1) {
  const cikti = [];
  let tablo = [];
  const sifirla = () => { tablo = []; for (let i = 0; i < 256; i++) tablo.push([i]); tablo.push(null, null); };
  sifirla();
  let bit = 0, tampon = 0, uzun = 9, onceki = null;
  for (let i = 0; i < u8.length; i++) {
    tampon = (tampon << 8) | u8[i];
    bit += 8;
    while (bit >= uzun) {
      const kod = (tampon >> (bit - uzun)) & ((1 << uzun) - 1);
      bit -= uzun;
      tampon &= (1 << bit) - 1;
      if (kod === 256) { sifirla(); uzun = 9; onceki = null; continue; }
      if (kod === 257) return Uint8Array.from(cikti);
      let giris;
      if (kod < tablo.length) giris = tablo[kod];
      else if (onceki) giris = [...onceki, onceki[0]];
      else return Uint8Array.from(cikti);
      for (const b of giris) cikti.push(b);
      if (onceki) tablo.push([...onceki, giris[0]]);
      onceki = giris;
      const n = tablo.length + erken;
      uzun = n >= 2048 ? 12 : n >= 1024 ? 11 : n >= 512 ? 10 : 9;
    }
  }
  return Uint8Array.from(cikti);
}

function ascii85(u8) {
  const c = [];
  let g = [];
  let i = 0;
  const bas = L1.decode(u8.subarray(0, 2)) === "<~" ? 2 : 0;
  for (i = bas; i < u8.length; i++) {
    const ch = u8[i];
    if (ch === 126) break;
    if (BOS(ch)) continue;
    if (ch === 122 && !g.length) { c.push(0, 0, 0, 0); continue; }
    if (ch < 33 || ch > 117) continue;
    g.push(ch - 33);
    if (g.length === 5) { let v = 0; for (const x of g) v = v * 85 + x; c.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); g = []; }
  }
  if (g.length > 1) {
    const n = g.length;
    while (g.length < 5) g.push(84);
    let v = 0; for (const x of g) v = v * 85 + x;
    const b = [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
    c.push(...b.slice(0, n - 1));
  }
  return Uint8Array.from(c);
}

function asciiHex(u8) {
  const s = L1.decode(u8).replace(/>.*$/s, "").replace(/[^0-9A-Fa-f]/g, "");
  const b = new Uint8Array(Math.floor(s.length / 2));
  for (let i = 0; i < b.length; i++) b[i] = parseInt(s.substr(i * 2, 2), 16);
  return b;
}

function runLength(u8) {
  const c = [];
  for (let i = 0; i < u8.length;) {
    const n = u8[i++];
    if (n === 128) break;
    if (n < 128) { for (let k = 0; k <= n && i < u8.length; k++) c.push(u8[i++]); }
    else { const b = u8[i++]; for (let k = 0; k < 257 - n; k++) c.push(b); }
  }
  return Uint8Array.from(c);
}

/** PNG/TIFF öngörücüsünü geri al (Flate/LZW sonrası). */
function ongoruculeriAc(veri, p) {
  const pred = p.Predictor || 1;
  if (pred < 2) return veri;
  const renk = p.Colors || 1, bpc = p.BitsPerComponent || 8, sutun = p.Columns || 1;
  const bpp = Math.max(1, Math.ceil((renk * bpc) / 8));
  const satir = Math.ceil((renk * bpc * sutun) / 8);
  if (pred === 2) {
    if (bpc !== 8) return veri;
    const c = veri.slice();
    for (let r = 0; r + satir <= c.length; r += satir) for (let i = bpp; i < satir; i++) c[r + i] = (c[r + i] + c[r + i - bpp]) & 255;
    return c;
  }
  const n = Math.floor(veri.length / (satir + 1));
  const cikti = new Uint8Array(n * satir);
  for (let r = 0; r < n; r++) {
    const f = veri[r * (satir + 1)];
    const k = r * (satir + 1) + 1;
    const o = r * satir;
    for (let i = 0; i < satir; i++) {
      const x = veri[k + i];
      const a = i >= bpp ? cikti[o + i - bpp] : 0;
      const b = r ? cikti[o - satir + i] : 0;
      const cc = r && i >= bpp ? cikti[o - satir + i - bpp] : 0;
      let v;
      switch (f) {
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: { const p0 = a + b - cc, pa = Math.abs(p0 - a), pb = Math.abs(p0 - b), pc = Math.abs(p0 - cc); v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : cc); break; }
        default: v = x;
      }
      cikti[o + i] = v & 255;
    }
  }
  return cikti;
}

/* ============================ 3) Belge: nesne dizini ============================ */

class Belge {
  constructor(u8) {
    this.u = u8;
    this.metin = L1.decode(u8);
    this.dizin = new Map(); // num -> {off} | {stm, idx}
    this.onbellek = new Map();
    this.akisOnbellek = new Map();
    this.koklar = [];
    this.sifreli = false;
  }

  tara() {
    const re = /(?:^|[\r\n\s>])(\d{1,10})\s+(\d{1,5})\s+obj\b/g;
    let m;
    const stmler = [];
    while ((m = re.exec(this.metin))) {
      const num = +m[1];
      const off = m.index + m[0].length;
      this.dizin.set(num, { off });
      const bas = this.metin.substr(off, 400);
      if (/\/Type\s*\/ObjStm/.test(bas)) stmler.push(num);
    }
    // iz sürüş sözlükleri (Root / Encrypt)
    const tr = /trailer\s*<</g;
    while ((m = tr.exec(this.metin))) {
      const s = new Sozcuk(this.u, m.index + m[0].length - 2);
      s.p += 2;
      try { this.izSozlugu(s.sozluk()); } catch { /* yoksay */ }
    }
    return stmler;
  }

  izSozlugu(d) {
    if (d.has("Encrypt")) this.sifreli = true;
    const kok = d.get("Root");
    if (kok instanceof Ref) this.koklar.push(kok);
  }

  async nesneAkislariniAc(stmler) {
    for (const num of stmler) {
      try {
        const o = await this.al(new Ref(num, 0));
        if (!(o instanceof Akis)) continue;
        const veri = await this.coz(o);
        const n = o.d.get("N"), ilk = o.d.get("First");
        if (!(n > 0) || !(ilk >= 0)) continue;
        const s = new Sozcuk(veri, 0);
        const cift = [];
        for (let i = 0; i < n; i++) { const a = s.oku(), b = s.oku(); if (typeof a !== "number" || typeof b !== "number") break; cift.push([a, b]); }
        cift.forEach(([k, off], idx) => {
          const var_ = this.dizin.get(k);
          if (!var_ || var_.stm !== undefined) this.dizin.set(k, { stm: num, idx, veri, off: ilk + off });
        });
      } catch { /* bu ObjStm atlandı */ }
    }
    // XRef akışı / ObjStm sözlüklerinden Encrypt-Root
    for (const [num, g] of this.dizin) {
      if (g.stm !== undefined) continue;
      const bas = this.metin.substr(g.off, 300);
      if (/\/Type\s*\/XRef/.test(bas)) {
        try { const o = await this.al(new Ref(num, 0)); if (o instanceof Akis) this.izSozlugu(o.d); } catch { /* yoksay */ }
      }
    }
  }

  /** Bir nesneyi (Ref) çöz; Akis ya da değer döner; yoksa null. */
  async al(x) {
    if (!(x instanceof Ref)) return x;
    if (this.onbellek.has(x.n)) return this.onbellek.get(x.n);
    const g = this.dizin.get(x.n);
    if (!g) return null;
    let deger = null;
    try {
      if (g.stm !== undefined) {
        const s = new Sozcuk(g.veri, g.off);
        deger = this.ref(s);
      } else {
        const s = new Sozcuk(this.u, g.off);
        deger = this.ref(s);
        if (deger instanceof Map) {
          s.bosluk();
          if (this.u[s.p] === 115 && L1.decode(this.u.subarray(s.p, s.p + 6)) === "stream") {
            let bas = s.p + 6;
            if (this.u[bas] === 13 && this.u[bas + 1] === 10) bas += 2;
            else if (this.u[bas] === 10 || this.u[bas] === 13) bas += 1;
            let uzun = deger.get("Length");
            if (uzun instanceof Ref) uzun = await this.al(uzun);
            let son = -1;
            if (typeof uzun === "number" && uzun >= 0 && bas + uzun <= this.u.length) {
              const k = this.metin.substr(bas + uzun, 20);
              if (/^\s*endstream/.test(k)) son = bas + uzun;
            }
            if (son < 0) {
              const e = this.metin.indexOf("endstream", bas);
              son = e < 0 ? this.u.length : e;
              if (this.u[son - 1] === 10) son--;
              if (this.u[son - 1] === 13) son--;
            }
            deger = new Akis(deger, this.u.subarray(bas, son));
          }
        }
      }
    } catch { deger = null; }
    this.onbellek.set(x.n, deger);
    return deger;
  }

  /** "n g R" sayı-ikilisi gönderimi de dahil, tek değer. */
  ref(s) {
    const v = s.oku();
    return v;
  }

  /** Sözlük değeri (Ref'leri çözerek). */
  async g(d, anahtar) {
    if (!(d instanceof Map)) return undefined;
    return this.al(d.get(anahtar));
  }

  /** Akışı tüm bayt süzgeçlerinden geçir → {veri, kalan}; kalan = çözülmeyen görüntü süzgeci (DCTDecode…). */
  async kalanSuzgec(akis) {
    if (this.akisOnbellek.has(akis)) return this.akisOnbellek.get(akis);
    let veri = akis.veri;
    const f = (await this.g(akis.d, "Filter")) ?? (await this.g(akis.d, "F"));
    const p = (await this.g(akis.d, "DecodeParms")) ?? (await this.g(akis.d, "DP"));
    const filtreler = (Array.isArray(f) ? f : f ? [f] : []).map((x) => (x instanceof Ad ? x.v : ""));
    const parmlar = Array.isArray(p) ? p : p ? [p] : [];
    let kalan = null;
    for (let i = 0; i < filtreler.length; i++) {
      const ad = filtreler[i];
      let pm = parmlar[i];
      if (pm instanceof Ref) pm = await this.al(pm);
      const pp = {};
      if (pm instanceof Map) for (const [k, v] of pm) pp[k] = typeof v === "number" ? v : null;
      if (ad === "FlateDecode" || ad === "Fl") veri = ongoruculeriAc(await inflate(veri), pp);
      else if (ad === "LZWDecode" || ad === "LZW") veri = ongoruculeriAc(lzw(veri, pp.EarlyChange ?? 1), pp);
      else if (ad === "ASCII85Decode" || ad === "A85") veri = ascii85(veri);
      else if (ad === "ASCIIHexDecode" || ad === "AHx") veri = asciiHex(veri);
      else if (ad === "RunLengthDecode" || ad === "RL") veri = runLength(veri);
      else { kalan = ad; break; }
    }
    const r = { veri, kalan };
    this.akisOnbellek.set(akis, r);
    return r;
  }

  async coz(akis) {
    return (await this.kalanSuzgec(akis)).veri;
  }
}

/* ============================ 4) Yazı tipleri ============================ */

const KOD_WIN = new TextDecoder("windows-1252");
let KOD_MAC = null;
try { KOD_MAC = new TextDecoder("macintosh"); } catch { KOD_MAC = KOD_WIN; }

const ADLAR = {
  space: " ", exclam: "!", quotedbl: '"', numbersign: "#", dollar: "$", percent: "%", ampersand: "&", quotesingle: "'", quoteright: "’", quoteleft: "‘",
  parenleft: "(", parenright: ")", asterisk: "*", plus: "+", comma: ",", hyphen: "-", minus: "−", period: ".", slash: "/", colon: ":", semicolon: ";",
  less: "<", equal: "=", greater: ">", question: "?", at: "@", bracketleft: "[", backslash: "\\", bracketright: "]", asciicircum: "^", underscore: "_",
  grave: "`", braceleft: "{", bar: "|", braceright: "}", asciitilde: "~", zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9",
  endash: "–", emdash: "—", bullet: "•", ellipsis: "…", quotedblleft: "“", quotedblright: "”", quotesinglbase: "‚", quotedblbase: "„", guillemotleft: "«", guillemotright: "»",
  guilsinglleft: "‹", guilsinglright: "›", degree: "°", copyright: "©", registered: "®", trademark: "™", section: "§", paragraph: "¶", dagger: "†", daggerdbl: "‡", multiply: "×", divide: "÷",
  plusminus: "±", mu: "µ", periodcentered: "·", cent: "¢", sterling: "£", yen: "¥", Euro: "€", currency: "¤", fi: "fi", fl: "fl", ff: "ff", ffi: "ffi", ffl: "ffl", nbspace: " ", nonbreakingspace: " ", sfthyphen: "", softhyphen: "",
  Gbreve: "Ğ", gbreve: "ğ", Idotaccent: "İ", dotlessi: "ı", Scedilla: "Ş", scedilla: "ş", Scommaaccent: "Ş", scommaaccent: "ş", Ccedilla: "Ç", ccedilla: "ç", Odieresis: "Ö", odieresis: "ö", Udieresis: "Ü", udieresis: "ü",
  Aacute: "Á", aacute: "á", Agrave: "À", agrave: "à", Acircumflex: "Â", acircumflex: "â", Atilde: "Ã", atilde: "ã", Adieresis: "Ä", adieresis: "ä", Aring: "Å", aring: "å", AE: "Æ", ae: "æ",
  Eacute: "É", eacute: "é", Egrave: "È", egrave: "è", Ecircumflex: "Ê", ecircumflex: "ê", Edieresis: "Ë", edieresis: "ë", Iacute: "Í", iacute: "í", Igrave: "Ì", igrave: "ì", Icircumflex: "Î", icircumflex: "î", Idieresis: "Ï", idieresis: "ï",
  Oacute: "Ó", oacute: "ó", Ograve: "Ò", ograve: "ò", Ocircumflex: "Ô", ocircumflex: "ô", Otilde: "Õ", otilde: "õ", Oslash: "Ø", oslash: "ø", Uacute: "Ú", uacute: "ú", Ugrave: "Ù", ugrave: "ù", Ucircumflex: "Û", ucircumflex: "û",
  Ntilde: "Ñ", ntilde: "ñ", germandbls: "ß", Yacute: "Ý", yacute: "ý", ydieresis: "ÿ", Ydieresis: "Ÿ", OE: "Œ", oe: "œ", Scaron: "Š", scaron: "š", Zcaron: "Ž", zcaron: "ž", Lslash: "Ł", lslash: "ł",
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", theta: "θ", lambda: "λ", pi: "π", sigma: "σ", tau: "τ", phi: "φ", omega: "ω", Delta: "Δ", Sigma: "Σ", Omega: "Ω",
  arrowright: "→", arrowleft: "←", arrowup: "↑", arrowdown: "↓", approxequal: "≈", notequal: "≠", lessequal: "≤", greaterequal: "≥", infinity: "∞", summation: "∑", radical: "√", partialdiff: "∂",
};
for (let i = 0; i < 26; i++) { ADLAR[String.fromCharCode(65 + i)] = String.fromCharCode(65 + i); ADLAR[String.fromCharCode(97 + i)] = String.fromCharCode(97 + i); }

function glifAdiMetni(ad) {
  if (ADLAR[ad] !== undefined) return ADLAR[ad];
  let m = /^uni([0-9A-Fa-f]{4})(?:[0-9A-Fa-f]{4})*$/.exec(ad);
  if (m) return ad.slice(3).match(/.{4}/g).map((h) => String.fromCharCode(parseInt(h, 16))).join("");
  m = /^u([0-9A-Fa-f]{4,6})$/.exec(ad);
  if (m) return String.fromCodePoint(parseInt(m[1], 16));
  const nokta = ad.split(".")[0];
  if (nokta !== ad && ADLAR[nokta] !== undefined) return ADLAR[nokta]; // "a.sc", "fi.alt"
  return null;
}

/** ToUnicode / CMap çözücü. */
function cmapCoz(u8) {
  const s = L1.decode(u8);
  const harita = new Map();
  const kodAlani = []; // {uz, lo, hi}
  const hex16 = (h) => {
    h = h.replace(/\s+/g, "");
    let t = "";
    for (let i = 0; i + 3 < h.length + 1; i += 4) { const k = h.substr(i, 4); if (k.length === 4) t += String.fromCharCode(parseInt(k, 16)); }
    if (!t && h.length === 2) t = String.fromCharCode(parseInt(h, 16));
    return t;
  };
  for (const b of s.matchAll(/begincodespacerange([\s\S]*?)endcodespacerange/g)) {
    for (const m of b[1].matchAll(/<([0-9A-Fa-f\s]+)>\s*<([0-9A-Fa-f\s]+)>/g)) {
      const lo = m[1].replace(/\s+/g, ""), hi = m[2].replace(/\s+/g, "");
      kodAlani.push({ uz: Math.ceil(lo.length / 2), lo: parseInt(lo, 16), hi: parseInt(hi, 16) });
    }
  }
  for (const b of s.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of b[1].matchAll(/<([0-9A-Fa-f\s]+)>\s*<([0-9A-Fa-f\s]*)>/g)) harita.set(parseInt(m[1].replace(/\s+/g, ""), 16), hex16(m[2]));
  }
  for (const b of s.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of b[1].matchAll(/<([0-9A-Fa-f\s]+)>\s*<([0-9A-Fa-f\s]+)>\s*(\[[^\]]*\]|<[0-9A-Fa-f\s]*>)/g)) {
      const lo = parseInt(m[1].replace(/\s+/g, ""), 16), hi = Math.min(parseInt(m[2].replace(/\s+/g, ""), 16), lo + 65535);
      if (m[3][0] === "[") {
        const ogeler = [...m[3].matchAll(/<([0-9A-Fa-f\s]*)>/g)].map((x) => hex16(x[1]));
        for (let k = lo; k <= hi && k - lo < ogeler.length; k++) harita.set(k, ogeler[k - lo]);
      } else {
        const bas = hex16(m[3].slice(1, -1));
        if (!bas) continue;
        const son = bas.charCodeAt(bas.length - 1);
        for (let k = lo; k <= hi; k++) harita.set(k, bas.slice(0, -1) + String.fromCharCode(son + (k - lo)));
      }
    }
  }
  return { harita, kodAlani };
}

async function yaziTipiYukle(belge, sozluk) {
  const f = { ad: "", kalin: false, harita: null, kodAlani: null, cift: false, genislik: new Map(), vars: 0.5, kodlama: null, farklar: null, cozulemez: false, taban: "" };
  const temel = await belge.g(sozluk, "BaseFont");
  f.ad = temel instanceof Ad ? temel.v.replace(/^[A-Z]{6}\+/, "") : "";
  f.kalin = /bold|black|heavy|semibold|demi|extrabold/i.test(f.ad);
  const alt = (await belge.g(sozluk, "Subtype"))?.v;
  const tuMap = await belge.g(sozluk, "ToUnicode");
  if (tuMap instanceof Akis) {
    try { const c = cmapCoz(await belge.coz(tuMap)); if (c.harita.size) { f.harita = c.harita; f.kodAlani = c.kodAlani; } } catch { /* yoksay */ }
  }
  if (alt === "Type0") {
    f.cift = true;
    const torun = await belge.g(sozluk, "DescendantFonts");
    const t0 = Array.isArray(torun) ? await belge.al(torun[0]) : torun;
    const dw = t0 instanceof Map ? await belge.g(t0, "DW") : null;
    f.vars = (typeof dw === "number" ? dw : 1000) / 1000;
    const w = t0 instanceof Map ? await belge.g(t0, "W") : null;
    if (Array.isArray(w)) {
      for (let i = 0; i < w.length;) {
        const a = await belge.al(w[i]);
        const b = await belge.al(w[i + 1]);
        if (Array.isArray(b)) { for (let k = 0; k < b.length; k++) f.genislik.set(a + k, (await belge.al(b[k])) / 1000); i += 2; }
        else { const c = await belge.al(w[i + 2]); for (let k = a; k <= Math.min(b, a + 20000); k++) f.genislik.set(k, c / 1000); i += 3; }
      }
    }
    f.cozulemez = !f.harita; // ToUnicode yoksa CID→karakter eşlemesi yazı tipi dosyasını gerektirir
    return f;
  }
  // basit yazı tipi
  const ilk = await belge.g(sozluk, "FirstChar");
  const gen = await belge.g(sozluk, "Widths");
  if (Array.isArray(gen) && typeof ilk === "number") {
    for (let i = 0; i < gen.length; i++) { const w = await belge.al(gen[i]); if (typeof w === "number") f.genislik.set(ilk + i, w / 1000); }
  }
  const fd = await belge.g(sozluk, "FontDescriptor");
  const mw = fd instanceof Map ? await belge.g(fd, "MissingWidth") : null;
  f.vars = typeof mw === "number" && mw > 0 ? mw / 1000 : 0.5;
  const enc = await belge.g(sozluk, "Encoding");
  let tabanAd = "";
  if (enc instanceof Ad) tabanAd = enc.v;
  else if (enc instanceof Map) {
    const b = await belge.g(enc, "BaseEncoding");
    if (b instanceof Ad) tabanAd = b.v;
    const fark = await belge.g(enc, "Differences");
    if (Array.isArray(fark)) {
      f.farklar = new Map();
      let kod = 0;
      for (const o of fark) {
        const v = await belge.al(o);
        if (typeof v === "number") kod = v;
        else if (v instanceof Ad) { const t = glifAdiMetni(v.v); if (t !== null) f.farklar.set(kod, t); kod++; }
      }
    }
  }
  f.taban = tabanAd;
  if (alt === "Type3" && !f.harita && !f.farklar) f.cozulemez = true;
  return f;
}

/** Bayt dizisini [{t, w, bosluk}] glif listesine çevir. */
function glifleriCoz(f, bayt) {
  const cikti = [];
  if (f.cift) {
    const alanlar = f.kodAlani && f.kodAlani.length ? f.kodAlani : null;
    for (let i = 0; i < bayt.length;) {
      let uz = 2, kod = 0;
      if (alanlar) {
        let bulundu = false;
        for (let k = 1; k <= 4 && i + k <= bayt.length; k++) {
          let v = 0;
          for (let j = 0; j < k; j++) v = v * 256 + bayt[i + j];
          if (alanlar.some((a) => a.uz === k && v >= a.lo && v <= a.hi)) { uz = k; kod = v; bulundu = true; break; }
        }
        if (!bulundu) { uz = alanlar[0].uz; kod = 0; for (let j = 0; j < uz && i + j < bayt.length; j++) kod = kod * 256 + bayt[i + j]; }
      } else {
        kod = (bayt[i] << 8) | (bayt[i + 1] ?? 0);
      }
      i += uz;
      const t = f.harita ? f.harita.get(kod) : undefined;
      cikti.push({ t: t ?? null, w: f.genislik.get(kod) ?? f.vars, bosluk: false });
    }
    return cikti;
  }
  for (const b of bayt) {
    let t = f.harita?.get(b);
    if (t === undefined && f.farklar?.has(b)) t = f.farklar.get(b);
    if (t === undefined && !f.cozulemez) {
      if (f.taban === "MacRomanEncoding") t = KOD_MAC.decode(Uint8Array.of(b));
      else if (b < 32) t = null;
      else if (b < 127) t = String.fromCharCode(b);
      else t = KOD_WIN.decode(Uint8Array.of(b));
    }
    cikti.push({ t: t ?? null, w: f.genislik.get(b) ?? f.vars, bosluk: b === 32 });
  }
  return cikti;
}

/* ============================ 5) Sayfa ağacı ============================ */

const KIMLIK = [1, 0, 0, 1, 0, 0];
const carp = (m, n) => [
  m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
];
const sayi = (x, v = 0) => (typeof x === "number" && Number.isFinite(x) ? x : v);

async function sayfalariBul(belge) {
  const sayfalar = [];
  const ziyaret = new Set();
  const yurut = async (ref, miras, derin) => {
    if (derin > 40 || sayfalar.length >= SINIR.SAYFA) return;
    const dugum = await belge.al(ref);
    if (!(dugum instanceof Map)) return;
    if (ref instanceof Ref) { if (ziyaret.has(ref.n)) return; ziyaret.add(ref.n); }
    const yeni = { ...miras };
    for (const k of ["Resources", "MediaBox", "Rotate"]) { const v = dugum.get(k); if (v !== undefined) yeni[k] = v; }
    const tur = (await belge.g(dugum, "Type"))?.v;
    const cocuklar = await belge.g(dugum, "Kids");
    if (Array.isArray(cocuklar) && tur !== "Page") { for (const c of cocuklar) await yurut(c, yeni, derin + 1); return; }
    sayfalar.push({ sozluk: dugum, num: ref instanceof Ref ? ref.n : 0, kaynak: yeni.Resources, kutu: yeni.MediaBox });
  };
  for (const kok of belge.koklar) {
    try {
      const katalog = await belge.al(kok);
      const sayfalarRef = katalog instanceof Map ? katalog.get("Pages") : null;
      if (sayfalarRef) await yurut(sayfalarRef, {}, 0);
      if (sayfalar.length) return sayfalar;
    } catch { /* sıradaki köke geç */ }
  }
  // Yedek: tüm /Type /Page nesneleri (numara sırasıyla)
  const adaylar = [];
  const re = /\/Type\s*\/Page(?![s\w])/g;
  const sirali = [...belge.dizin.entries()].filter(([, g]) => g.stm === undefined).sort((a, b) => a[1].off - b[1].off);
  for (const [num, g] of sirali) {
    const bas = belge.metin.substr(g.off, 1500);
    re.lastIndex = 0;
    if (re.test(bas) && !/\/Type\s*\/Pages/.test(bas.slice(0, 400))) adaylar.push(num);
  }
  adaylar.sort((a, b) => a - b);
  for (const num of adaylar) {
    const d = await belge.al(new Ref(num, 0));
    if (d instanceof Map) sayfalar.push({ sozluk: d, num, kaynak: d.get("Resources"), kutu: d.get("MediaBox") });
    if (sayfalar.length >= SINIR.SAYFA) break;
  }
  return sayfalar;
}

/* ============================ 6) İçerik akışı yorumlayıcı ============================ */

async function icerikBayti(belge, sayfa) {
  const c = await belge.g(sayfa, "Contents");
  const akislar = [];
  if (c instanceof Akis) akislar.push(c);
  else if (Array.isArray(c)) for (const r of c) { const a = await belge.al(r); if (a instanceof Akis) akislar.push(a); }
  const parcalar = [];
  let toplam = 0;
  for (const a of akislar) {
    try { const v = await belge.coz(a); parcalar.push(v, Uint8Array.of(10)); toplam += v.length + 1; } catch { /* bozuk parça atlandı */ }
  }
  const b = new Uint8Array(toplam);
  let o = 0;
  for (const p of parcalar) { b.set(p, o); o += p.length; }
  return b;
}

class Sayfa {
  constructor(no, kutu) {
    this.no = no;
    this.kutu = kutu;
    this.parcalar = [];
    this.gorseller = [];
    this.cozulemeyen = 0;
    this.toplamGlif = 0;
    this.formCagri = 0;
  }
}

async function yaziTipiAl(belge, kaynak, ad, onbellek) {
  const fontlar = await belge.g(kaynak, "Font");
  if (!(fontlar instanceof Map)) return null;
  const ham = fontlar.get(ad);
  const anahtar = ham instanceof Ref ? ham.n : ham;
  if (onbellek.has(anahtar)) return onbellek.get(anahtar);
  const d = await belge.al(ham);
  let f = null;
  if (d instanceof Map) { try { f = await yaziTipiYukle(belge, d); } catch { f = null; } }
  onbellek.set(anahtar, f);
  return f;
}

async function yorumla(belge, bayt, kaynak, sayfa, durum, yaziOnbellek, derin) {
  const s = new Sozcuk(bayt, 0, true);
  const yigin = [];
  let op = [];
  const art = []; // işaretli içerik yığını: true = Artifact
  let artifactSayisi = 0;
  const kay = [];
  let ctm = durum.ctm;
  let tm = KIMLIK, tlm = KIMLIK;
  let f = durum.f, fs = durum.fs, Tc = durum.Tc, Tw = durum.Tw, Th = durum.Th, TL = durum.TL, Ts = durum.Ts;
  let sayac = 0;

  const yaz = (parcalar) => {
    // parcalar: [{t:glifler} | {bosluk:em}] — tek Tj/TJ işlemi
    let metin = "";
    let bas = null;
    let baslangicTm = tm;
    const bitir = () => {
      if (metin.trim() && bas) {
        const bt = carp(baslangicTm, ctm);
        const sonTm = tm;
        const bs = carp(sonTm, ctm);
        const rot = Math.abs(bt[1]) > Math.abs(bt[0]) * 0.5 || bt[3] < 0 || bt[0] < 0;
        const boyut = Math.abs(fs) * Math.hypot(bt[2], bt[3]);
        if (!rot && boyut > 1 && !artifactSayisi) {
          sayfa.parcalar.push({ x: bt[4], y: bt[5] + Ts * Math.hypot(bt[2], bt[3]), x2: bs[4], boyut, metin, kalin: !!f?.kalin });
        }
      }
      metin = "";
      bas = null;
    };
    for (const p of parcalar) {
      if (p.em !== undefined) {
        const adv = (-p.em / 1000) * fs * Th;
        const bosluk = -p.em / 1000;
        if (bosluk >= 1.5) { bitir(); tm = carp([1, 0, 0, 1, adv, 0], tm); baslangicTm = tm; continue; }
        if (bosluk >= 0.17 && metin && !/\s$/.test(metin)) metin += " ";
        tm = carp([1, 0, 0, 1, adv, 0], tm);
        continue;
      }
      if (!bas) { bas = true; baslangicTm = tm; }
      let adv = 0;
      for (const g of p.glifler) {
        sayfa.toplamGlif++;
        if (g.t === null) sayfa.cozulemeyen++;
        else metin += g.t;
        adv += (g.w * fs + Tc + (g.bosluk ? Tw : 0)) * Th;
      }
      tm = carp([1, 0, 0, 1, adv, 0], tm);
    }
    bitir();
  };

  const dizgiGlif = (dz) => (f ? glifleriCoz(f, dz.b) : []);

  for (;;) {
    const v = s.oku();
    if (v === null) break;
    if (!(v && typeof v === "object" && "k" in v) || v.k === "null" || v.k === "[" ) { op.push(v); if (op.length > 64) op.shift(); continue; }
    const k = v.k;
    if (++sayac > 3_000_000) break;
    try {
      switch (k) {
        case "q": kay.push({ ctm, f, fs, Tc, Tw, Th, TL, Ts }); break;
        case "Q": { const o = kay.pop(); if (o) ({ ctm, f, fs, Tc, Tw, Th, TL, Ts } = o); break; }
        case "cm": if (op.length >= 6) ctm = carp(op.slice(-6).map((x) => sayi(x)), ctm); break;
        case "BT": tm = tlm = KIMLIK; break;
        case "Tf": { const ad = op[op.length - 2]; fs = sayi(op[op.length - 1], fs); if (ad instanceof Ad) f = await yaziTipiAl(belge, kaynak, ad.v, yaziOnbellek); break; }
        case "Tc": Tc = sayi(op[op.length - 1]); break;
        case "Tw": Tw = sayi(op[op.length - 1]); break;
        case "Tz": Th = sayi(op[op.length - 1], 100) / 100; break;
        case "TL": TL = sayi(op[op.length - 1]); break;
        case "Ts": Ts = sayi(op[op.length - 1]); break;
        case "Td": case "TD": {
          const ty = sayi(op[op.length - 1]), tx = sayi(op[op.length - 2]);
          if (k === "TD") TL = -ty;
          tlm = carp([1, 0, 0, 1, tx, ty], tlm); tm = tlm; break;
        }
        case "Tm": if (op.length >= 6) { tm = tlm = op.slice(-6).map((x) => sayi(x)); } break;
        case "T*": tlm = carp([1, 0, 0, 1, 0, -TL], tlm); tm = tlm; break;
        case "Tj": { const dz = op[op.length - 1]; if (dz instanceof Dz) yaz([{ glifler: dizgiGlif(dz) }]); break; }
        case "'": case '"': {
          tlm = carp([1, 0, 0, 1, 0, -TL], tlm); tm = tlm;
          if (k === '"') { Tw = sayi(op[op.length - 3]); Tc = sayi(op[op.length - 2]); }
          const dz = op[op.length - 1]; if (dz instanceof Dz) yaz([{ glifler: dizgiGlif(dz) }]); break;
        }
        case "TJ": {
          const dizi = op[op.length - 1];
          if (Array.isArray(dizi)) yaz(dizi.map((x) => (x instanceof Dz ? { glifler: dizgiGlif(x) } : typeof x === "number" ? { em: x } : null)).filter(Boolean));
          break;
        }
        case "BMC": art.push(false); break;
        case "BDC": { const etiket = op[op.length - 2]; const a = etiket instanceof Ad && etiket.v === "Artifact"; art.push(a); if (a) artifactSayisi++; break; }
        case "EMC": { const a = art.pop(); if (a) artifactSayisi = Math.max(0, artifactSayisi - 1); break; }
        case "Do": {
          const ad = op[op.length - 1];
          if (!(ad instanceof Ad)) break;
          const xo = await belge.g(kaynak, "XObject");
          if (!(xo instanceof Map)) break;
          const ham = xo.get(ad.v);
          const nesne = await belge.al(ham);
          if (!(nesne instanceof Akis)) break;
          const alt = (await belge.g(nesne.d, "Subtype"))?.v;
          if (alt === "Image") {
            if (!artifactSayisi) sayfa.gorseller.push({ num: ham instanceof Ref ? ham.n : 0, nesne, x: ctm[4], y: ctm[5], w: Math.hypot(ctm[0], ctm[1]), h: Math.hypot(ctm[2], ctm[3]), a: ctm[0], d: ctm[3] });
          } else if (alt === "Form" && derin < SINIR.FORM_DERINLIK && ++sayfa.formCagri < SINIR.FORM_CAGRI) {
            const fm = await belge.g(nesne.d, "Matrix");
            const m = Array.isArray(fm) && fm.length === 6 ? fm.map((x) => sayi(x)) : KIMLIK;
            const formKaynak = (await belge.g(nesne.d, "Resources")) || kaynak;
            const gov = await belge.coz(nesne);
            await yorumla(belge, gov, formKaynak, sayfa, { ctm: carp(m, ctm), f, fs, Tc, Tw, Th, TL, Ts }, yaziOnbellek, derin + 1);
          }
          break;
        }
        case "BI": {
          // satır içi görsel: ID … EI arasını atla
          let i = s.p;
          const m = bayt;
          for (; i < m.length - 1; i++) if (m[i] === 73 && m[i + 1] === 68 && BOS(m[i - 1]) && BOS(m[i + 2] ?? 32)) break;
          i += 3;
          for (; i < m.length - 1; i++) if (m[i] === 69 && m[i + 1] === 73 && BOS(m[i - 1]) && (i + 2 >= m.length || BOS(m[i + 2]))) break;
          s.p = i + 2;
          break;
        }
        default: break;
      }
    } catch { /* tek işlem hatası sayfayı bozmasın */ }
    op = [];
  }
}

/* ============================ 7) Görsel çıkarma (JPEG olduğu gibi, ham piksel → PNG) ============================ */

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

async function zlibSikistir(u8) {
  const okuyucu = new Blob([u8]).stream().pipeThrough(new CompressionStream("deflate")).getReader();
  const parcalar = [];
  let n = 0;
  for (;;) { const { done, value } = await okuyucu.read(); if (done) break; parcalar.push(value); n += value.length; }
  const c = new Uint8Array(n);
  let o = 0;
  for (const p of parcalar) { c.set(p, o); o += p.length; }
  return c;
}

async function pngYap(genislik, yukseklik, bitDerinligi, renkTuru, satirlar, palet) {
  const parca = (tur, veri) => {
    const b = new Uint8Array(12 + veri.length);
    const dv = new DataView(b.buffer);
    dv.setUint32(0, veri.length);
    for (let i = 0; i < 4; i++) b[4 + i] = tur.charCodeAt(i);
    b.set(veri, 8);
    dv.setUint32(8 + veri.length, crc32(b.subarray(4, 8 + veri.length)));
    return b;
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, genislik); dv.setUint32(4, yukseklik);
  ihdr[8] = bitDerinligi; ihdr[9] = renkTuru;
  const sikis = await zlibSikistir(satirlar);
  const parcalar = [Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), parca("IHDR", ihdr)];
  if (palet) parcalar.push(parca("PLTE", palet));
  parcalar.push(parca("IDAT", sikis), parca("IEND", new Uint8Array(0)));
  const n = parcalar.reduce((a, p) => a + p.length, 0);
  const c = new Uint8Array(n);
  let o = 0;
  for (const p of parcalar) { c.set(p, o); o += p.length; }
  return c;
}

async function renkUzayi(belge, cs) {
  cs = await belge.al(cs);
  if (cs instanceof Ad) {
    if (/^(DeviceRGB|CalRGB|RGB)$/.test(cs.v)) return { n: 3 };
    if (/^(DeviceGray|CalGray|G)$/.test(cs.v)) return { n: 1 };
    if (/^(DeviceCMYK|CMYK)$/.test(cs.v)) return { n: 4 };
    return null;
  }
  if (Array.isArray(cs) && cs[0] instanceof Ad) {
    const ad = cs[0].v;
    if (ad === "ICCBased") { const a = await belge.al(cs[1]); const n = a instanceof Akis ? await belge.g(a.d, "N") : null; return n === 1 || n === 3 || n === 4 ? { n } : null; }
    if (ad === "CalRGB") return { n: 3 };
    if (ad === "CalGray") return { n: 1 };
    if (ad === "Indexed" || ad === "I") {
      const taban = await renkUzayi(belge, cs[1]);
      if (!taban || taban.n === 4) return null;
      const hival = sayi(await belge.al(cs[2]));
      let tablo = await belge.al(cs[3]);
      let b = tablo instanceof Dz ? tablo.b : tablo instanceof Akis ? await belge.coz(tablo) : null;
      if (!b) return null;
      const palet = new Uint8Array((hival + 1) * 3);
      for (let i = 0; i <= hival; i++) for (let j = 0; j < 3; j++) palet[i * 3 + j] = taban.n === 3 ? b[i * 3 + j] ?? 0 : b[i] ?? 0;
      return { n: 1, palet };
    }
    if (ad === "Separation" || ad === "DeviceN") return null;
  }
  return null;
}

async function gorseliCikar(belge, nesne) {
  const d = nesne.d;
  const G = sayi(await belge.g(d, "Width")), Y = sayi(await belge.g(d, "Height"));
  if (G < 1 || Y < 1 || G * Y > 80_000_000) return null;
  const r = await belge.kalanSuzgec(nesne);
  if (r.kalan === "DCTDecode") {
    if (r.veri[0] !== 0xff || r.veri[1] !== 0xd8) return null;
    return { tip: "image/jpeg", bayt: r.veri, pxG: G, pxY: Y };
  }
  if (r.kalan) return { atla: "biçim" }; // JPX / CCITT / JBIG2
  const bpc = sayi(await belge.g(d, "BitsPerComponent"), 8);
  const cs = await renkUzayi(belge, d.get("ColorSpace"));
  if (!cs || ![1, 2, 4, 8, 16].includes(bpc)) return { atla: "biçim" };
  let veri = r.veri;
  const dec = await belge.g(d, "Decode");
  if (cs.n === 1 && !cs.palet && Array.isArray(dec) && dec[0] === 1 && dec[1] === 0) veri = veri.map((b) => (bpc === 16 ? b : b ^ 255)).slice();
  let n = cs.n;
  let satirBayt = Math.ceil((G * n * bpc) / 8);
  if (n === 4) { // CMYK → RGB (8 bit)
    if (bpc !== 8) return { atla: "biçim" };
    const rgb = new Uint8Array(G * Y * 3);
    for (let i = 0, o = 0; i < G * Y; i++, o += 3) {
      const c = (veri[i * 4] ?? 0) / 255, m = (veri[i * 4 + 1] ?? 0) / 255, ye = (veri[i * 4 + 2] ?? 0) / 255, k = (veri[i * 4 + 3] ?? 0) / 255;
      rgb[o] = 255 * (1 - c) * (1 - k); rgb[o + 1] = 255 * (1 - m) * (1 - k); rgb[o + 2] = 255 * (1 - ye) * (1 - k);
    }
    veri = rgb; n = 3; satirBayt = G * 3;
  }
  if (satirBayt * Y > SINIR.HAM_PIKSEL_BAYT) return { atla: "boyut" };
  // yumuşak maske (alfa) — yalnızca 8 bit gri/RGB
  let alfa = null;
  const sm = await belge.g(d, "SMask");
  if (sm instanceof Akis && bpc === 8 && !cs.palet) {
    const sg = sayi(await belge.g(sm.d, "Width")), sy = sayi(await belge.g(sm.d, "Height"));
    const sb = sayi(await belge.g(sm.d, "BitsPerComponent"), 8);
    if (sg === G && sy === Y && sb === 8) { const a = await belge.coz(sm); if (a.length >= G * Y) alfa = a; }
  }
  const sat = new Uint8Array((satirBayt + 1) * Y);
  let renkTuru = cs.palet ? 3 : n === 3 ? 2 : 0;
  if (alfa) {
    const px = n;
    const yeni = new Uint8Array((G * (px + 1) + 1) * Y);
    for (let y = 0; y < Y; y++) {
      const o = y * (G * (px + 1) + 1);
      for (let x = 0; x < G; x++) {
        for (let j = 0; j < px; j++) yeni[o + 1 + x * (px + 1) + j] = veri[(y * G + x) * px + j] ?? 0;
        yeni[o + 1 + x * (px + 1) + px] = alfa[y * G + x];
      }
    }
    renkTuru = n === 3 ? 6 : 4;
    return { tip: "image/png", bayt: await pngYap(G, Y, 8, renkTuru, yeni, null), pxG: G, pxY: Y };
  }
  for (let y = 0; y < Y; y++) {
    const kaynakO = y * satirBayt;
    sat.set(veri.subarray(kaynakO, kaynakO + satirBayt), y * (satirBayt + 1) + 1);
  }
  return { tip: "image/png", bayt: await pngYap(G, Y, bpc, renkTuru, sat, cs.palet || null), pxG: G, pxY: Y };
}

/** Sayfalardaki görselleri süz (logo/süs/küçük at), çıkar, kimlik ver. */
async function gorselleriTopla(belge, sayfalar, uyarilar) {
  const sayim = new Map();
  for (const s of sayfalar) for (const g of new Set(s.gorseller.map((x) => x.num).filter(Boolean))) sayim.set(g, (sayim.get(g) || 0) + 1);
  const cikanlar = [];
  const kimlikler = new Map(); // nesne no -> id
  let atlananBicim = 0, atlananBuyuk = 0, hata = 0, toplamBayt = 0;
  for (const s of sayfalar) {
    const kalan = [];
    for (const g of s.gorseller.sort((a, b) => b.y - a.y)) {
      try {
        if (g.w < 28 || g.h < 28) continue;
        if ((await belge.g(g.nesne.d, "ImageMask")) === true) continue;
        const G = sayi(await belge.g(g.nesne.d, "Width")), Y = sayi(await belge.g(g.nesne.d, "Height"));
        if (G < 48 || Y < 48) continue;
        if (g.num && sayfalar.length >= 3 && (sayim.get(g.num) || 0) >= 3) continue; // her sayfada tekrar eden logo/süs
        if (g.num && kimlikler.has(g.num)) { kalan.push({ ...g, id: kimlikler.get(g.num), tekrar: true }); continue; }
        if (cikanlar.length >= SINIR.GORSEL || toplamBayt >= SINIR.TOPLAM_GORSEL_BAYT) { atlananBuyuk++; continue; }
        const c = await gorseliCikar(belge, g.nesne);
        if (!c) { hata++; continue; }
        if (c.atla) { atlananBicim++; continue; }
        if (c.bayt.length > SINIR.GORSEL_BAYT) { atlananBuyuk++; continue; }
        toplamBayt += c.bayt.length;
        const id = `ia-g-${cikanlar.length + 1}`;
        cikanlar.push({ id, tip: c.tip, bayt: c.bayt, pxG: c.pxG, pxY: c.pxY, sayfa: s.no });
        if (g.num) kimlikler.set(g.num, id);
        kalan.push({ ...g, id });
      } catch { hata++; }
    }
    s.gorseller = kalan.filter((x) => !x.tekrar);
  }
  if (atlananBicim) uyarilar.push(`${atlananBicim} görsel desteklenmeyen biçimde (JPEG2000/CCITT/JBIG2 vb.) olduğu için alınamadı.`);
  if (atlananBuyuk) uyarilar.push(`${atlananBuyuk} görsel boyut/adet sınırı nedeniyle alınmadı (en fazla ${SINIR.GORSEL} görsel, her biri 15 MB).`);
  if (hata) uyarilar.push(`${hata} görsel çözülemedi.`);
  return cikanlar;
}

/* ============================ 8) Yerleşim çözümleme ============================ */

const LIGATUR = { "ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl", "ﬅ": "st", "ﬆ": "st" };
function metniTemizle(t) {
  return t
    .replace(/[\uF0B7\uF0A7\uF0B6\uF076\uF06C\uF0D8\uF0FC]/g, "•") // Symbol/Wingdings madde imleri
    .replace(/[\uE000-\uF8FF]/g, "")
    .replace(/[\uFB00-\uFB06]/g, (c) => LIGATUR[c] || c)
    .replace(/[\u00AD\u200B-\u200D\uFEFF]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, " ")
    .replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .normalize("NFC");
}

function satirlariKur(sayfa) {
  let p = sayfa.parcalar;
  const k = sayfa.kutu;
  if (Array.isArray(k) && k.length === 4) {
    const [x0, y0, x1, y1] = k.map((v) => sayi(v));
    const ax = Math.min(x0, x1) - 20, bx = Math.max(x0, x1) + 20, ay = Math.min(y0, y1) - 20, by = Math.max(y0, y1) + 20;
    p = p.filter((c) => c.x >= ax && c.x <= bx && c.y >= ay && c.y <= by);
  }
  // sahte kalın (aynı metin üst üste basılmış) kopyaları ele
  p = [...p].sort((a, b) => b.y - a.y || a.x - b.x);
  const tekil = [];
  for (const c of p) {
    const onceki = tekil[tekil.length - 1];
    if (onceki && onceki.metin === c.metin && Math.abs(onceki.x - c.x) < 1.5 && Math.abs(onceki.y - c.y) < 1.5) continue;
    tekil.push(c);
  }
  const satirlar = [];
  for (const c of tekil) {
    let hedef = null;
    for (let i = satirlar.length - 1; i >= Math.max(0, satirlar.length - 6); i--) {
      const L = satirlar[i];
      if (Math.abs(L.y - c.y) <= 0.4 * Math.max(L.boyut, c.boyut)) { hedef = L; break; }
    }
    if (!hedef) { hedef = { y: c.y, boyut: c.boyut, parcalar: [] }; satirlar.push(hedef); }
    hedef.parcalar.push(c);
    if (c.boyut > hedef.boyut) { hedef.boyut = c.boyut; hedef.y = c.y; }
  }
  for (const L of satirlar) L.parcalar.sort((a, b) => a.x - b.x);
  return satirlar.sort((a, b) => b.y - a.y);
}

/** Satırı bölümlere (segment) ayır: geniş boşluklarda ve SÜTUN ARALIĞINDA böl; sütun aralığını aşan satır "yayılan"dır. */
function segmentleriKur(L, ayiricilar) {
  const segs = [];
  let sg = null;
  const aralikBolmeli = (onceki, c) =>
    ayiricilar.some((g) => onceki <= g.orta + 1 && c.x >= g.orta - 1 && c.x - onceki >= 0.6 * g.gen);
  for (const c of L.parcalar) {
    const bos = c.metin.replace(/\s/g, "");
    if (!bos) { if (sg) sg.x2 = Math.max(sg.x2, c.x2, c.x); continue; }
    const x2 = Math.max(c.x2, c.x);
    if (sg) {
      const aralik = c.x - sg.x2;
      if (aralik > Math.max(1.6 * c.boyut, 14) || aralikBolmeli(sg.x2, c)) { segs.push(sg); sg = null; }
      else {
        if (aralik > 0.18 * c.boyut && !/\s$/.test(sg.text) && !/^\s/.test(c.metin)) sg.text += " ";
        sg.text += c.metin; sg.x2 = Math.max(sg.x2, x2); sg.harf += bos.length; sg.kalinHarf += c.kalin ? bos.length : 0;
        if (c.boyut > sg.boyut) sg.boyut = c.boyut;
        continue;
      }
    }
    sg = { x: c.x, x2, text: c.metin, boyut: c.boyut, harf: bos.length, kalinHarf: c.kalin ? bos.length : 0 };
  }
  if (sg) segs.push(sg);
  for (const s of segs) { s.text = metniTemizle(s.text); s.kalin = s.harf > 0 && s.kalinHarf / s.harf > 0.8; }
  L.segs = segs.filter((s) => s.text);
  L.yayilan = L.segs.some((s) => ayiricilar.some((g) => s.x < g.orta - 1 && s.x2 > g.orta + 1));
}


function sutunAyiricilari(satirlar) {
  const parcalar = satirlar.flatMap((L) => L.parcalar);
  if (parcalar.length < 30) return [];
  const xs = parcalar.map((c) => c.x).sort((a, b) => a - b);
  const x2s = parcalar.map((c) => Math.max(c.x2, c.x)).sort((a, b) => a - b);
  const minX = xs[Math.floor(xs.length * 0.02)], maxX = x2s[Math.floor(x2s.length * 0.98)];
  const gen = maxX - minX;
  if (gen < 200) return [];
  const BIN = 1.5;
  const nb = Math.ceil(gen / BIN) + 1;
  const dolu = new Uint16Array(nb);
  const dar = parcalar.filter((c) => Math.max(c.x2, c.x) - c.x < 0.6 * gen);
  for (const c of dar) {
    const a = Math.max(0, Math.floor((c.x - minX) / BIN)), b = Math.min(nb - 1, Math.floor((Math.max(c.x2, c.x) - minX) / BIN));
    for (let i = a; i <= b; i++) dolu[i]++;
  }
  const tepe = Math.max(...dolu, 1);
  const bosEsik = Math.max(2, Math.ceil(tepe * 0.1)); // birkaç yayılan satır aralığı doldurmasın
  const adaylar = [];
  for (let i = 0; i < nb;) {
    if (dolu[i] > bosEsik) { i++; continue; }
    let j = i;
    while (j < nb && dolu[j] <= bosEsik) j++;
    const orta = minX + ((i + j) / 2) * BIN;
    const oran = (orta - minX) / gen;
    if ((j - i) * BIN >= 7 && oran > 0.15 && oran < 0.85) adaylar.push({ orta, gen: (j - i) * BIN });
    i = j;
  }
  const kabul = [];
  for (const a of adaylar) {
    const sol = dar.filter((c) => Math.max(c.x2, c.x) <= a.orta + 1), sag = dar.filter((c) => c.x >= a.orta - 1);
    if (sol.length < 8 || sag.length < 8) continue;
    // sütun "paragraf gibi" mi? (tablo hücreleri kısa metindir): satır başına taraf metni uzunluğu
    const yanUzunluk = (taraf) => {
      const kume = new Set(taraf);
      const uz = satirlar.map((L) => L.parcalar.filter((c) => kume.has(c)).reduce((t, c) => t + c.metin.length, 0)).filter((n) => n > 0);
      return uz.length ? uz.reduce((t, n) => t + n, 0) / uz.length : 0;
    };
    if (yanUzunluk(sol) < 24 || yanUzunluk(sag) < 24) continue;
    const solHarf = sol.reduce((t, c) => t + c.metin.length, 0), sagHarf = sag.reduce((t, c) => t + c.metin.length, 0), tum = dar.reduce((t, c) => t + c.metin.length, 0) || 1;
    if (solHarf / tum < 0.15 || sagHarf / tum < 0.15) continue;
    if (kabul.length && Math.abs(kabul[kabul.length - 1].orta - a.orta) < 0.12 * gen) { if (a.gen > kabul[kabul.length - 1].gen) kabul[kabul.length - 1] = a; continue; }
    kabul.push(a);
  }
  return kabul.slice(0, 2);
}

/** Satırları okuma sırasına diz: yayılan satırlar bölümleyicidir; her bant içinde sütun sütun. */
function okumaSirasi(satirlar, ayiricilar, govdeBoyut) {
  if (!ayiricilar.length) return [satirlar];
  const gruplar = [];
  let bant = null;
  const bantiKapat = () => { if (bant) { for (const sutun of bant) if (sutun.length) gruplar.push(sutun); bant = null; } };
  let tekGrup = null;
  let sonYayilan = null;
  for (const L of satirlar) {
    let yayilan = !!L.yayilan;
    // Yayılan bir başlığın ikinci satırı (aynı büyük boyut, hemen altında) başlıkla birlikte kalır
    if (!yayilan && sonYayilan && !L.gorsel && L.boyut >= govdeBoyut * 1.18 && Math.abs(L.boyut - sonYayilan.boyut) < 0.6 && sonYayilan.y - L.y < L.boyut * 1.8) yayilan = true;
    if (yayilan) {
      bantiKapat();
      if (!tekGrup) { tekGrup = []; gruplar.push(tekGrup); }
      tekGrup.push(L);
      sonYayilan = L;
      continue;
    }
    tekGrup = null;
    sonYayilan = null;
    if (!bant) bant = Array.from({ length: ayiricilar.length + 1 }, () => []);
    const dilim = bant.map(() => []);
    for (const s of L.segs) {
      const orta = (s.x + s.x2) / 2;
      let idx = 0;
      while (idx < ayiricilar.length && orta > ayiricilar[idx].orta) idx++;
      dilim[idx].push(s);
    }
    dilim.forEach((segs, i) => { if (segs.length) bant[i].push({ ...L, segs }); });
  }
  bantiKapat();
  return gruplar;
}

const MADDE = /^([•▪◦‣●○■□·–—-]|\u2022|\d{1,2}[.)]|\([a-z0-9]{1,2}\)|[a-z]\))\s+/;

function bloklaraCevir(grup, govdeBoyut, bloklar) {
  const metinSatirlari = grup.filter((L) => !L.gorsel && L.segs.length === 1);
  const farklar = [];
  for (let i = 1; i < metinSatirlari.length; i++) {
    const a = metinSatirlari[i - 1], b = metinSatirlari[i];
    if (Math.abs(a.boyut - b.boyut) < 0.3 && a.y > b.y) farklar.push(a.y - b.y);
  }
  farklar.sort((a, b) => a - b);
  const aralik = farklar.length ? farklar[Math.floor(farklar.length / 2)] : govdeBoyut * 1.25;
  const sol = Math.min(...grup.flatMap((L) => L.segs.map((s) => s.x)));
  const sag = Math.max(...grup.flatMap((L) => L.segs.map((s) => s.x2)));
  const govdeSatirlar = metinSatirlari.filter((L) => Math.abs(L.boyut - govdeBoyut) < 0.8);
  const hizali = govdeSatirlar.length ? govdeSatirlar.filter((L) => L.segs[0].x2 >= sag - govdeBoyut).length / govdeSatirlar.length : 0;
  const iki = hizali >= 0.4; // iki yana yaslı metin: kısa satır paragraf sonudur

  let par = null; // {t, text, x, boyut, y, x2, level}
  const bosalt = () => { if (par) { par.text = par.text.replace(/\s+/g, " ").trim(); if (par.text) bloklar.push({ t: par.t, level: par.level, text: par.text }); par = null; } };
  const ekle = (onceki, yeni) => {
    if (/[A-Za-zÇĞİÖŞÜçğıöşü]-$/.test(onceki) && /^[a-zçğıöşü]/.test(yeni)) return onceki.slice(0, -1) + yeni; // satır sonu tire
    return onceki + " " + yeni;
  };

  for (const L of grup) {
    if (L.gorsel) { bosalt(); bloklar.push({ t: "img", id: L.gorsel }); continue; }
    if (L.segs.length >= 2) { bosalt(); bloklar.push({ t: "p", text: L.segs.map((s) => s.text).join(" | ") }); continue; }
    const s = L.segs[0];
    const oran = s.boyut / govdeBoyut;
    const kalinSatir = s.kalin && s.text.length <= 90 && !/[.;,]$/.test(s.text) && oran >= 0.95;
    const baslik = (oran >= 1.18 && s.text.length <= 200) || kalinSatir;
    if (baslik) {
      const seviye = oran >= 1.6 ? 2 : 3;
      if (par && par.t === "h" && Math.abs(par.boyut - s.boyut) < 0.6 && par.y - L.y < s.boyut * 1.7) { par.text = ekle(par.text, s.text); par.y = L.y; continue; }
      bosalt();
      par = { t: "h", level: seviye, text: s.text, x: s.x, boyut: s.boyut, y: L.y, x2: s.x2 };
      continue;
    }
    const madde = MADDE.exec(s.text);
    const bosluk = par ? par.y - L.y : 0;
    if (madde) {
      bosalt();
      par = { t: "li", text: s.text.replace(MADDE, ""), x: s.x, boyut: s.boyut, y: L.y, x2: s.x2 };
      continue;
    }
    if (par && (par.t === "p" || par.t === "li")) {
      const yeniPar =
        bosluk > Math.max(aralik * 1.45, s.boyut * 1.9) ||
        (par.t === "p" && s.x - sol > s.boyut * 0.9 && par.x - sol < s.boyut * 0.5 && bosluk > 0) ||
        (par.t === "p" && iki && par.x2 < sag - 3 * s.boyut && /[.!?:”")]$/.test(par.text)) ||
        (par.t === "p" && !iki && par.x2 < sag - 8 * s.boyut && /[.!?:”")]$/.test(par.text));
      if (!yeniPar) { par.text = ekle(par.text, s.text); par.y = L.y; par.x2 = s.x2; continue; }
    }
    bosalt();
    par = { t: "p", text: s.text, x: s.x, boyut: s.boyut, y: L.y, x2: s.x2 };
  }
  bosalt();
}

function ustAltBilgiAnahtari(L) {
  return L.segs.map((s) => s.text).join(" ").toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, "");
}
const SAYFA_NO = /^(sayfa|page|s\.|p\.)?\s*\d{1,4}(\s*(\/|of|\/)\s*\d{1,4})?$|^[ivxlc]{1,6}$/i;

function ustAltBilgiTemizle(sayfaSatirlari) {
  const n = sayfaSatirlari.length;
  const sayac = new Map();
  const adaylar = sayfaSatirlari.map((satirlar) => {
    if (satirlar.length < 4) return [];
    const ust = satirlar.slice(0, 2), alt = satirlar.slice(-2);
    return [...ust, ...alt];
  });
  adaylar.forEach((liste) => { for (const a of new Set(liste.map(ustAltBilgiAnahtari))) sayac.set(a, (sayac.get(a) || 0) + 1); });
  const esik = Math.max(3, Math.ceil(n * 0.5));
  sayfaSatirlari.forEach((satirlar, i) => {
    const sil = new Set();
    for (const L of adaylar[i]) {
      const metin = L.segs.map((s) => s.text).join(" ").trim();
      if (SAYFA_NO.test(metin) || (n >= 3 && (sayac.get(ustAltBilgiAnahtari(L)) || 0) >= esik)) sil.add(L);
    }
    if (sil.size) sayfaSatirlari[i] = satirlar.filter((L) => !sil.has(L));
  });
}

function govdeBoyutuBul(tumSatirlar) {
  const kova = new Map();
  for (const L of tumSatirlar) for (const s of L.segs) { const k = Math.round(s.boyut * 2) / 2; kova.set(k, (kova.get(k) || 0) + s.text.length); }
  let en = 10, say = 0;
  for (const [k, v] of kova) if (v > say) { en = k; say = v; }
  return en;
}

/* ============================ 9) Genel giriş ============================ */

export class PdfSifreliHatasi extends Error {}

export async function pdfCikar(u8) {
  const uyarilar = [];
  const bas = L1.decode(u8.subarray(0, Math.min(u8.length, 1024)));
  if (!bas.includes("%PDF")) throw new Error("Geçerli bir PDF dosyası değil.");
  const belge = new Belge(u8);
  const stmler = belge.tara();
  await belge.nesneAkislariniAc(stmler);
  if (belge.sifreli) throw new PdfSifreliHatasi("Bu PDF parola ile korunuyor/şifreli; metni okunamadı. Parolasız bir kopyasını kullan.");
  const ham = await sayfalariBul(belge);
  if (!ham.length) throw new Error("PDF içinde sayfa bulunamadı (dosya bozuk olabilir).");
  if (ham.length >= SINIR.SAYFA) uyarilar.push(`İlk ${SINIR.SAYFA} sayfa okundu.`);

  const yaziOnbellek = new Map();
  const sayfalar = [];
  let bozuk = 0;
  for (let i = 0; i < ham.length; i++) {
    const h = ham[i];
    const kutuHam = Array.isArray(h.kutu) ? await Promise.all(h.kutu.map((x) => belge.al(x))) : null;
    const s = new Sayfa(i + 1, kutuHam);
    try {
      const kaynak = (await belge.al(h.kaynak)) || new Map();
      const bayt = await icerikBayti(belge, h.sozluk);
      await yorumla(belge, bayt, kaynak, s, { ctm: KIMLIK, f: null, fs: 10, Tc: 0, Tw: 0, Th: 1, TL: 0, Ts: 0 }, yaziOnbellek, 0);
    } catch (e) {
      bozuk++;
    }
    sayfalar.push(s);
  }
  if (bozuk) uyarilar.push(`${bozuk} sayfa tam okunamadı; okunabilen kısımlar alındı.`);

  const gorseller = await gorselleriTopla(belge, sayfalar, uyarilar);

  // satırlar + sütun + üst/alt bilgi
  const sayfaAyiricilari = [];
  const sayfaSatirlari = sayfalar.map((s, i) => {
    try {
      const L = satirlariKur(s);
      const g = sutunAyiricilari(L);
      sayfaAyiricilari[i] = g;
      for (const x of L) segmentleriKur(x, g);
      return L.filter((x) => x.segs.length);
    } catch { sayfaAyiricilari[i] = []; return []; }
  });
  ustAltBilgiTemizle(sayfaSatirlari);
  const govde = govdeBoyutuBul(sayfaSatirlari.flat());

  const bloklar = [];
  let cozulemeyen = 0, toplamGlif = 0;
  sayfalar.forEach((s, i) => {
    cozulemeyen += s.cozulemeyen; toplamGlif += s.toplamGlif;
    try {
      const satirlar = sayfaSatirlari[i].slice();
      const ayiricilar = sayfaAyiricilari[i] || [];
      for (const g of s.gorseller) {
        const x = g.x, y = g.y + Math.abs(g.h) , w = g.w;
        satirlar.push({ y, boyut: g.h, gorsel: g.id, yayilan: ayiricilar.some((a) => x < a.orta - 1 && x + w > a.orta + 1), segs: [{ x, x2: x + w, text: "", boyut: g.h }] });
      }
      satirlar.sort((a, b) => b.y - a.y);
      for (const grup of okumaSirasi(satirlar, ayiricilar, govde)) if (grup.length) bloklaraCevir(grup, govde, bloklar);
    } catch {
      // yerleşim çözülemedi: ham metni sırayla kurtar
      const duz = sayfaSatirlari[i].map((L) => L.segs.map((x) => x.text).join(" ")).join("\n");
      if (duz.trim()) bloklar.push({ t: "p", text: duz.replace(/\s+/g, " ") });
      uyarilar.push(`Sayfa ${s.no}: yerleşim çözülemedi, düz metin alındı.`);
    }
  });

  // Sütun/sayfa sınırında bölünen paragrafı birleştir: önceki cümle bitmemiş, sonraki küçük harfle başlıyor
  for (let i = bloklar.length - 1; i > 0; i--) {
    const a = bloklar[i - 1], b = bloklar[i];
    if (a.t === "p" && b.t === "p" && !/[.!?:;”")\]…]$/.test(a.text) && /^[a-zçğıöşü]/.test(b.text)) {
      a.text = /[A-Za-zÇĞİÖŞÜçğıöşü]-$/.test(a.text) ? a.text.slice(0, -1) + b.text : a.text + " " + b.text;
      bloklar.splice(i, 1);
    }
  }
  let baslik = "";
  const ilkBaslik = bloklar.findIndex((b) => b.t === "h");
  if (ilkBaslik >= 0 && ilkBaslik < 4 && bloklar[ilkBaslik].level === 2) { baslik = bloklar[ilkBaslik].text.slice(0, 200); bloklar.splice(ilkBaslik, 1); }

  const harfSayisi = bloklar.reduce((a, b) => a + (b.text ? (b.text.match(/\p{L}/gu) || []).length : 0), 0);
  const cozulemeyenOran = toplamGlif ? cozulemeyen / toplamGlif : 0;
  if (toplamGlif && cozulemeyenOran > 0.25) uyarilar.push(`Yazı tipi kodlaması nedeniyle karakterlerin %${Math.round(cozulemeyenOran * 100)}'i çözülemedi; metin eksik olabilir.`);
  return { bloklar, baslik, gorseller, uyarilar, sayfaSayisi: ham.length, harfSayisi, cozulemeyenOran };
}

/** Yalnızca testler için iç işlevler. */
export const _ic = { Belge, sayfalariBul, icerikBayti, yorumla, Sayfa, satirlariKur, sutunAyiricilari, segmentleriKur };

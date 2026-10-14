/*
 * assets/js/belge-tarayici/belge-bul.js — Otomatik BELGE ALGILAMA (kâğıdı bul, arka planı at). Saf JS: DOM/Canvas YOK, harici kütüphane YOK.
 * -----------------------------------------------------------------------
 *  Amaç: masa/halı/el gibi karmaşık bir arka plana sahip fotoğraftaki fatura/belgeyi (WhatsApp "belge tara" gibi) bulup
 *  4 köşesini döndürmek; çağıran taraf perspektifi düzeltip arka planı keser.
 *
 *  Tek bir "eşik" yöntemine güvenmez (karmaşık arka planda tek yöntem tutmaz). 4 bağımsız ADAY maske üretir:
 *    1) parlak + düşük doygunluk (beyaz/krem kâğıt)       2) görüntü merkezindeki kâğıt rengine benzerlik
 *    3) Lab uzayında k-means kümeleri (+ iki parlak kümenin birleşimi: gölgeli kâğıt)   4) güçlü kenarlarla kapanan bölge
 *  Her aday: morfolojik temizlik → en iyi bağlı bileşen → delik doldurma → dışbükey kabuk → 4 kenara indirgeme
 *  ("kenar uzatma" ile dışa teğet dörtgen; parmak/gölge çıkıntılarına dayanıklı). Adaylar; dolgunluk (maske/dörtgen alanı),
 *  kenar desteği (dörtgen kenarlarında iç-dış zıtlığı), açı/oran makullüğü ve merkezlilik ile puanlanır; en iyisi seçilir.
 *  Güven düşükse null döner (arayüz bunu "elle ayarla" olarak sunar) — yanlış kırpma, hiç kırpmamaktan kötüdür.
 *
 *  Giriş: küçültülmüş RGBA (en uzun kenar ≈ 320 px). Çıkış: {kose:[[x,y]×4 normalize, sol-üst→sağ-üst→sağ-alt→sol-alt], guven, yontem} | null.
 * -----------------------------------------------------------------------
 */

export const ALGILAMA_KENARI = 320;
const GUVEN_ESIGI = 0.66; // altında: "emin değilim" → kırpma yapılmaz, kullanıcı elle ayarlar

/* ------------------------------ renk ------------------------------ */

const DOGRUSAL = new Float32Array(256);
for (let i = 0; i < 256; i += 1) { const c = i / 255; DOGRUSAL[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
const lf = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

/** RGBA → {L,A,B,V,S} dizileri (Float32). L: 0-100, V: 0-255 (max kanal), S: 0-1 (doygunluk). */
function renkAlanlari(d, w, h) {
  const n = w * h;
  const L = new Float32Array(n); const A = new Float32Array(n); const B = new Float32Array(n);
  const V = new Float32Array(n); const S = new Float32Array(n);
  for (let i = 0, p = 0; i < n; i += 1, p += 4) {
    const r = d[p]; const g = d[p + 1]; const b = d[p + 2];
    const rl = DOGRUSAL[r]; const gl = DOGRUSAL[g]; const bl = DOGRUSAL[b];
    const x = (0.4124 * rl + 0.3576 * gl + 0.1805 * bl) / 0.95047;
    const y = 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
    const z = (0.0193 * rl + 0.1192 * gl + 0.9505 * bl) / 1.08883;
    const fx = lf(x); const fy = lf(y); const fz = lf(z);
    L[i] = 116 * fy - 16; A[i] = 500 * (fx - fy); B[i] = 200 * (fy - fz);
    const mx = Math.max(r, g, b); const mn = Math.min(r, g, b);
    V[i] = mx; S[i] = mx ? (mx - mn) / mx : 0;
  }
  return { L, A, B, V, S };
}

/* ------------------------------ morfoloji (kare yapı elemanı, ayrılabilir) ------------------------------ */

function kaydirMaks(src, w, h, r, maks) { // maks=true: genişlet, false: aşındır
  const t = new Uint8Array(src.length);
  const tmp = new Uint8Array(src.length);
  for (let y = 0; y < h; y += 1) {
    const o = y * w;
    for (let x = 0; x < w; x += 1) {
      let v = maks ? 0 : 1;
      const a = Math.max(0, x - r); const b = Math.min(w - 1, x + r);
      for (let k = a; k <= b; k += 1) { const s = src[o + k]; if (maks ? s : !s) { v = maks ? 1 : 0; break; } }
      // kenar dışı: aşındırmada görüntü dışı "0" sayılmaz (belge kareyi doldurabilir) → dokunma
      tmp[o + x] = v;
    }
  }
  for (let x = 0; x < w; x += 1) {
    for (let y = 0; y < h; y += 1) {
      let v = maks ? 0 : 1;
      const a = Math.max(0, y - r); const b = Math.min(h - 1, y + r);
      for (let k = a; k <= b; k += 1) { const s = tmp[k * w + x]; if (maks ? s : !s) { v = maks ? 1 : 0; break; } }
      t[y * w + x] = v;
    }
  }
  return t;
}
const genislet = (m, w, h, r) => kaydirMaks(m, w, h, r, true);
const asindir = (m, w, h, r) => kaydirMaks(m, w, h, r, false);
const kapat = (m, w, h, r) => asindir(genislet(m, w, h, r), w, h, r);
const ac = (m, w, h, r) => genislet(asindir(m, w, h, r), w, h, r);

/** 4-bağlantılı bileşenler. Dönüş: {etiket:Int32Array, alanlar:number[] (indeks=etiket-1)}. */
function bilesenler(m, w, h) {
  const n = w * h;
  const etiket = new Int32Array(n);
  const alanlar = [];
  const yigin = new Int32Array(n);
  let sayi = 0;
  for (let i = 0; i < n; i += 1) {
    if (!m[i] || etiket[i]) continue;
    sayi += 1; let alan = 0; let sp = 0;
    yigin[sp++] = i; etiket[i] = sayi;
    while (sp) {
      const p = yigin[--sp]; alan += 1;
      const x = p % w; const y = (p - x) / w;
      if (x > 0 && m[p - 1] && !etiket[p - 1]) { etiket[p - 1] = sayi; yigin[sp++] = p - 1; }
      if (x < w - 1 && m[p + 1] && !etiket[p + 1]) { etiket[p + 1] = sayi; yigin[sp++] = p + 1; }
      if (y > 0 && m[p - w] && !etiket[p - w]) { etiket[p - w] = sayi; yigin[sp++] = p - w; }
      if (y < h - 1 && m[p + w] && !etiket[p + w]) { etiket[p + w] = sayi; yigin[sp++] = p + w; }
    }
    alanlar.push(alan);
  }
  return { etiket, alanlar };
}

/** Kenardan ulaşılamayan 0'ları 1 yapar (belge içindeki yazı/lekeler). */
function deliklerDoldur(m, w, h) {
  const n = w * h;
  const ters = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) ters[i] = m[i] ? 0 : 1;
  const ziyaret = new Uint8Array(n);
  const yigin = new Int32Array(n);
  let sp = 0;
  const it = (p) => { if (ters[p] && !ziyaret[p]) { ziyaret[p] = 1; yigin[sp++] = p; } };
  for (let x = 0; x < w; x += 1) { it(x); it((h - 1) * w + x); }
  for (let y = 0; y < h; y += 1) { it(y * w); it(y * w + w - 1); }
  while (sp) {
    const p = yigin[--sp]; const x = p % w; const y = (p - x) / w;
    if (x > 0) it(p - 1); if (x < w - 1) it(p + 1); if (y > 0) it(p - w); if (y < h - 1) it(p + w);
  }
  const c = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) c[i] = m[i] || !ziyaret[i] ? 1 : 0;
  return c;
}

/* ------------------------------ aday maskeler ------------------------------ */

function otsu(deger, n, aralik = 256) {
  const hist = new Float64Array(aralik);
  for (let i = 0; i < n; i += 1) hist[Math.max(0, Math.min(aralik - 1, deger[i] | 0))] += 1;
  let toplam = 0; for (let i = 0; i < aralik; i += 1) toplam += i * hist[i];
  let sb = 0; let wb = 0; let enIyi = 0; let esik = aralik / 2;
  for (let i = 0; i < aralik; i += 1) {
    wb += hist[i]; if (!wb) continue;
    const wf = n - wb; if (!wf) break;
    sb += i * hist[i];
    const mb = sb / wb; const mf = (toplam - sb) / wf;
    const v = wb * wf * (mb - mf) * (mb - mf);
    if (v > enIyi) { enIyi = v; esik = i; }
  }
  return esik;
}

const medyan = (dizi) => { const a = Array.from(dizi).sort((x, y) => x - y); return a.length ? a[a.length >> 1] : 0; };

function adayParlak(c, w, h) {
  const n = w * h;
  const p = new Float32Array(n);
  for (let i = 0; i < n; i += 1) p[i] = c.V[i] * (1 - 0.85 * c.S[i]);
  const esik = otsu(p, n);
  const m = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) m[i] = p[i] > esik ? 1 : 0;
  return { m, ad: "parlak" };
}

function adayMerkezRenk(c, w, h) {
  const n = w * h;
  const x0 = Math.round(w * 0.35); const x1 = Math.round(w * 0.65); const y0 = Math.round(h * 0.35); const y1 = Math.round(h * 0.65);
  const idx = [];
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) idx.push(y * w + x);
  idx.sort((a, b) => c.L[b] - c.L[a]); // yazı/gölge dışarıda kalsın: en parlak %55
  const sec = idx.slice(0, Math.max(10, Math.round(idx.length * 0.55)));
  const mL = medyan(sec.map((i) => c.L[i])); const mA = medyan(sec.map((i) => c.A[i])); const mB = medyan(sec.map((i) => c.B[i]));
  const sap = sec.map((i) => Math.hypot((c.L[i] - mL) * 0.6, c.A[i] - mA, c.B[i] - mB)).sort((a, b) => a - b);
  const esik = Math.max(12, Math.min(34, sap[Math.floor(sap.length * 0.9)] * 1.7 + 4));
  const m = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) m[i] = Math.hypot((c.L[i] - mL) * 0.6, c.A[i] - mA, c.B[i] - mB) < esik ? 1 : 0;
  return { m, ad: "merkez-renk" };
}

function kumeler(c, w, h, k = 4) {
  const n = w * h;
  const adim = 2;
  const nok = [];
  for (let y = 0; y < h; y += adim) for (let x = 0; x < w; x += adim) nok.push(y * w + x);
  const lw = 0.7; // aydınlatma farkına biraz tolerans
  const mer = [];
  const sirali = nok.slice().sort((a, b) => c.L[b] - c.L[a]);
  const ilk = sirali.slice(0, Math.max(5, Math.floor(sirali.length * 0.08)));
  mer.push([ilk.reduce((s, i) => s + c.L[i], 0) / ilk.length, ilk.reduce((s, i) => s + c.A[i], 0) / ilk.length, ilk.reduce((s, i) => s + c.B[i], 0) / ilk.length]);
  const uzak = (i, m) => Math.hypot((c.L[i] - m[0]) * lw, c.A[i] - m[1], c.B[i] - m[2]);
  while (mer.length < k) {
    let eniyi = -1; let ed = -1;
    for (let j = 0; j < nok.length; j += 3) {
      const i = nok[j]; let dm = Infinity;
      for (const m of mer) dm = Math.min(dm, uzak(i, m));
      if (dm > ed) { ed = dm; eniyi = i; }
    }
    mer.push([c.L[eniyi], c.A[eniyi], c.B[eniyi]]);
  }
  for (let it = 0; it < 9; it += 1) {
    const top = mer.map(() => [0, 0, 0, 0]);
    for (const i of nok) {
      let b = 0; let bd = Infinity;
      for (let j = 0; j < k; j += 1) { const d = uzak(i, mer[j]); if (d < bd) { bd = d; b = j; } }
      const t = top[b]; t[0] += c.L[i]; t[1] += c.A[i]; t[2] += c.B[i]; t[3] += 1;
    }
    for (let j = 0; j < k; j += 1) if (top[j][3]) { mer[j] = [top[j][0] / top[j][3], top[j][1] / top[j][3], top[j][2] / top[j][3]]; }
  }
  const etiket = new Uint8Array(n);
  const adet = new Array(k).fill(0);
  for (let i = 0; i < n; i += 1) {
    let b = 0; let bd = Infinity;
    for (let j = 0; j < k; j += 1) { const d = uzak(i, mer[j]); if (d < bd) { bd = d; b = j; } }
    etiket[i] = b; adet[b] += 1;
  }
  const sira = mer.map((m, j) => j).sort((a, b) => mer[b][0] - mer[a][0]); // parlaktan koyuya
  const adaylar = [];
  for (const j of sira) {
    if (adet[j] < n * 0.06) continue;
    const m = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) m[i] = etiket[i] === j ? 1 : 0;
    adaylar.push({ m, ad: `küme${j}` });
  }
  // gölgeli kâğıt: en parlak iki kümenin birleşimi (renk tonları yakınsa)
  const a = sira[0]; const b = sira[1];
  if (b !== undefined && adet[a] >= n * 0.03 && Math.hypot(mer[a][1] - mer[b][1], mer[a][2] - mer[b][2]) < 14) {
    const m = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) m[i] = etiket[i] === a || etiket[i] === b ? 1 : 0;
    adaylar.push({ m, ad: "küme-birlesim" });
  }
  return adaylar;
}

function adayKenar(c, w, h) {
  const n = w * h;
  const g = new Float32Array(n);
  for (let i = 0; i < n; i += 1) g[i] = c.L[i] * 2.55;
  const mag = new Float32Array(n);
  const dagilim = [];
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const i = y * w + x;
      const gx = -g[i - w - 1] - 2 * g[i - 1] - g[i + w - 1] + g[i - w + 1] + 2 * g[i + 1] + g[i + w + 1];
      const gy = -g[i - w - 1] - 2 * g[i - w] - g[i - w + 1] + g[i + w - 1] + 2 * g[i + w] + g[i + w + 1];
      // renk kenarı da sayılsın (kâğıt-masa aynı parlaklıkta ama farklı renkte olabilir)
      const ca = Math.abs(c.A[i + 1] - c.A[i - 1]) + Math.abs(c.A[i + w] - c.A[i - w]);
      const cb = Math.abs(c.B[i + 1] - c.B[i - 1]) + Math.abs(c.B[i + w] - c.B[i - w]);
      const v = Math.hypot(gx, gy) / 4 + (ca + cb) * 1.2;
      mag[i] = v; dagilim.push(v);
    }
  }
  dagilim.sort((a, b) => a - b);
  const esik = Math.max(18, dagilim[Math.floor(dagilim.length * 0.86)] || 30);
  let kenar = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) kenar[i] = mag[i] > esik ? 1 : 0;
  kenar = genislet(kenar, w, h, 1);
  // sınırdan serbest bölgeyi doldur: ulaşılamayanlar = kenarlarla çevrili bölge
  const ziyaret = new Uint8Array(n); const yigin = new Int32Array(n); let sp = 0;
  const it = (p) => { if (!kenar[p] && !ziyaret[p]) { ziyaret[p] = 1; yigin[sp++] = p; } };
  for (let x = 0; x < w; x += 1) { it(x); it((h - 1) * w + x); }
  for (let y = 0; y < h; y += 1) { it(y * w); it(y * w + w - 1); }
  while (sp) {
    const p = yigin[--sp]; const x = p % w; const y = (p - x) / w;
    if (x > 0) it(p - 1); if (x < w - 1) it(p + 1); if (y > 0) it(p - w); if (y < h - 1) it(p + w);
  }
  const m = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) m[i] = ziyaret[i] ? 0 : 1;
  return { m, ad: "kenar" };
}

/* ------------------------------ maske temizleme ------------------------------ */

function maskeTemizle(m0, w, h) {
  const boy = Math.max(w, h);
  let m = kapat(m0, w, h, Math.max(2, Math.round(boy * 0.012)));
  m = ac(m, w, h, Math.max(2, Math.round(boy * 0.016)));
  const { etiket, alanlar } = bilesenler(m, w, h);
  if (!alanlar.length) return null;
  let en = 0; for (let i = 1; i < alanlar.length; i += 1) if (alanlar[i] > alanlar[en]) en = i;
  const merkez = etiket[Math.floor(h / 2) * w + Math.floor(w / 2)];
  if (merkez && alanlar[merkez - 1] >= alanlar[en] * 0.5) en = merkez - 1;
  const sec = en + 1;
  const t = new Uint8Array(w * h);
  let alan = 0;
  for (let i = 0; i < t.length; i += 1) if (etiket[i] === sec) { t[i] = 1; alan += 1; }
  if (alan < w * h * 0.08) return null;
  const dolu = deliklerDoldur(t, w, h);
  let a2 = 0; for (let i = 0; i < dolu.length; i += 1) if (dolu[i]) a2 += 1;
  return { m: dolu, alan: a2 };
}

/* ------------------------------ geometri ------------------------------ */

function disbukeyKabuk(m, w, h) {
  const pts = [];
  for (let y = 0; y < h; y += 1) {
    let sol = -1; let sag = -1;
    for (let x = 0; x < w; x += 1) if (m[y * w + x]) { if (sol < 0) sol = x; sag = x; }
    if (sol >= 0) { pts.push([sol, y], [sol, y + 1], [sag + 1, y], [sag + 1, y + 1]); }
  }
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const alt = [];
  for (const p of pts) { while (alt.length >= 2 && cross(alt[alt.length - 2], alt[alt.length - 1], p) <= 0) alt.pop(); alt.push(p); }
  const ust = [];
  for (let i = pts.length - 1; i >= 0; i -= 1) { const p = pts[i]; while (ust.length >= 2 && cross(ust[ust.length - 2], ust[ust.length - 1], p) <= 0) ust.pop(); ust.push(p); }
  alt.pop(); ust.pop();
  return alt.concat(ust); // ekran koordinatında (y aşağı) saat yönünün tersi / dışbükey
}

const alanKoordinat = (P) => { let s = 0; for (let i = 0; i < P.length; i += 1) { const a = P[i]; const b = P[(i + 1) % P.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };

function dogruKesisim(a, b, c, d) {
  const x1 = a[0]; const y1 = a[1]; const x2 = b[0]; const y2 = b[1]; const x3 = c[0]; const y3 = c[1]; const x4 = d[0]; const y4 = d[1];
  const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(den) < 1e-9) return null;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / den;
  return { x: [x1 + t * (x2 - x1), y1 + t * (y2 - y1)], t, u };
}

/** Dışbükey çokgeni, kenar uzatarak (dışa teğet) 4 kenara indirger. */
function dortgeneIndir(kabuk) {
  let P = kabuk.map((p) => p.slice());
  if (P.length < 4) return null;
  let guvenlik = 400;
  while (P.length > 4 && guvenlik-- > 0) {
    const n = P.length;
    let eniyi = -1; let enUcuz = Infinity; let enNokta = null;
    for (let i = 0; i < n; i += 1) {
      const a = P[(i - 1 + n) % n]; const b = P[i]; const c = P[(i + 1) % n]; const d = P[(i + 2) % n];
      const k = dogruKesisim(a, b, d, c); // a→b doğrusu ile d→c doğrusu
      if (!k || k.t <= 1 || k.u <= 1) continue; // her iki doğru da kenarın ötesinde (dışarıda) kesişmeli
      const x = k.x;
      const maliyet = Math.abs((b[0] - x[0]) * (c[1] - x[1]) - (c[0] - x[0]) * (b[1] - x[1])) / 2;
      if (maliyet < enUcuz) { enUcuz = maliyet; eniyi = i; enNokta = x; }
    }
    if (eniyi < 0) { // kesişme yok: en az alan kaybettiren köşeyi at
      let bi = 0; let bm = Infinity;
      for (let i = 0; i < n; i += 1) {
        const a = P[(i - 1 + n) % n]; const b = P[i]; const c = P[(i + 1) % n];
        const m = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
        if (m < bm) { bm = m; bi = i; }
      }
      P.splice(bi, 1);
    } else {
      const i = eniyi; const j = (i + 1) % n;
      const yeni = [];
      for (let k2 = 0; k2 < n; k2 += 1) { if (k2 === i) yeni.push(enNokta); else if (k2 !== j) yeni.push(P[k2]); }
      P = yeni;
    }
  }
  return P.length === 4 ? P : null;
}

/** Köşeleri sol-üst → sağ-üst → sağ-alt → sol-alt (ekranda saat yönü) sıraya sokar; ilk kenar "üst" kenardır. */
function koseSirala(P) {
  let Q = P.slice();
  if (alanKoordinat(Q) < 0) Q = Q.reverse();
  let en = 0; let ea = Infinity;
  for (let i = 0; i < 4; i += 1) {
    const a = Q[i]; const b = Q[(i + 1) % 4];
    const aci = Math.abs(Math.atan2(b[1] - a[1], b[0] - a[0]));
    if (aci < ea) { ea = aci; en = i; }
  }
  return [Q[en], Q[(en + 1) % 4], Q[(en + 2) % 4], Q[(en + 3) % 4]];
}

function dortgenMakul(Q, w, h) {
  const alan = Math.abs(alanKoordinat(Q));
  if (alan < w * h * 0.1) return false;
  for (let i = 0; i < 4; i += 1) {
    const a = Q[i]; const b = Q[(i + 1) % 4]; const c = Q[(i + 2) % 4];
    const v1 = [a[0] - b[0], a[1] - b[1]]; const v2 = [c[0] - b[0], c[1] - b[1]];
    const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(...v1) * Math.hypot(...v2) || 1);
    const aci = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
    if (aci < 50 || aci > 132) return false;
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (cr <= 0) return false; // dışbükey değil
  }
  const kenarlar = [0, 1, 2, 3].map((i) => Math.hypot(Q[i][0] - Q[(i + 1) % 4][0], Q[i][1] - Q[(i + 1) % 4][1]));
  if (Math.min(...kenarlar) < Math.max(...kenarlar) * 0.14) return false;
  const pay = Math.max(w, h) * 0.07;
  return Q.every(([x, y]) => x > -pay && y > -pay && x < w + pay && y < h + pay);
}

/** Dörtgenin kenarları boyunca iç/dış zıtlığı (0-1): gerçek bir belge sınırında kenar iki yanda farklıdır. */
function kenarDestegi(Q, c, w, h) {
  let toplam = 0; let sayi = 0;
  const kk = (x, y) => { const xi = Math.max(0, Math.min(w - 1, Math.round(x))); const yi = Math.max(0, Math.min(h - 1, Math.round(y))); return yi * w + xi; };
  const ic = [(Q[0][0] + Q[1][0] + Q[2][0] + Q[3][0]) / 4, (Q[0][1] + Q[1][1] + Q[2][1] + Q[3][1]) / 4];
  for (let e = 0; e < 4; e += 1) {
    const a = Q[e]; const b = Q[(e + 1) % 4];
    const dx = b[0] - a[0]; const dy = b[1] - a[1]; const uz = Math.hypot(dx, dy) || 1;
    let nx = -dy / uz; let ny = dx / uz; // iç yöne bak
    if ((ic[0] - a[0]) * nx + (ic[1] - a[1]) * ny < 0) { nx = -nx; ny = -ny; }
    let iyi = 0; let say = 0;
    for (let s = 0.08; s <= 0.92; s += 0.04) {
      const px = a[0] + dx * s; const py = a[1] + dy * s;
      if (px < 3 || py < 3 || px > w - 4 || py > h - 4) { iyi += 0.6; say += 1; continue; } // görüntü kenarına yaslı: belge çerçeveyi aşıyor olabilir
      const i1 = kk(px + nx * 4, py + ny * 4); const o1 = kk(px - nx * 4, py - ny * 4);
      const fark = Math.hypot((c.L[i1] - c.L[o1]) * 0.8, c.A[i1] - c.A[o1], c.B[i1] - c.B[o1]);
      iyi += Math.min(1, fark / 20); say += 1;
    }
    toplam += say ? iyi / say : 0; sayi += 1;
  }
  return sayi ? toplam / sayi : 0;
}


/** Dörtgenin iç kısmı (köşelerden %7 içeri) tek bir kâğıt renginde mi? Kâğıtlar düzgündür; karmaşık arka plan parçaları değildir. */
function icHomojenlik(Q, c, w, h) {
  const mx = (Q[0][0] + Q[1][0] + Q[2][0] + Q[3][0]) / 4; const my = (Q[0][1] + Q[1][1] + Q[2][1] + Q[3][1]) / 4;
  const K = Q.map(([x, y]) => [x + (mx - x) * 0.07, y + (my - y) * 0.07]);
  const x0 = Math.max(0, Math.floor(Math.min(...K.map((k) => k[0])))); const x1 = Math.min(w - 1, Math.ceil(Math.max(...K.map((k) => k[0]))));
  const y0 = Math.max(0, Math.floor(Math.min(...K.map((k) => k[1])))); const y1 = Math.min(h - 1, Math.ceil(Math.max(...K.map((k) => k[1]))));
  const idx = [];
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      let ic = true;
      for (let e = 0; e < 4 && ic; e += 1) {
        const a = K[e]; const b = K[(e + 1) % 4];
        if ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) < 0) ic = false;
      }
      if (ic) idx.push(y * w + x);
    }
  }
  if (idx.length < 30) return 0;
  const mL = medyan(idx.map((i) => c.L[i])); const mA = medyan(idx.map((i) => c.A[i])); const mB = medyan(idx.map((i) => c.B[i]));
  let iyi = 0;
  for (const i of idx) if (Math.hypot((c.L[i] - mL) * 0.6, c.A[i] - mA, c.B[i] - mB) < 15) iyi += 1;
  return iyi / idx.length;
}

/* ------------------------------ ana giriş ------------------------------ */

/**
 * @param {Uint8ClampedArray|Uint8Array} rgba  küçültülmüş görüntü (RGBA)
 * @param {number} w  @param {number} h
 * @param {{ayrinti?:boolean}} [secenek]
 * @returns {{kose:number[][], guven:number, yontem:string, tam?:boolean}|null}
 */
export function belgeKosesiBul(rgba, w, h, secenek = {}) {
  if (w < 24 || h < 24) return null;
  const c = renkAlanlari(rgba, w, h);
  const aday = [adayParlak(c, w, h), adayMerkezRenk(c, w, h), ...kumeler(c, w, h, 4), adayKenar(c, w, h)];
  let en = null;
  const rapor = [];
  let tamKare = 0;
  for (const a of aday) {
    const t = maskeTemizle(a.m, w, h);
    if (!t) { rapor.push({ ad: a.ad, durum: "maske yok" }); continue; }
    const kabuk = disbukeyKabuk(t.m, w, h);
    const alanKabuk = Math.abs(alanKoordinat(kabuk));
    const Q0 = dortgeneIndir(kabuk);
    if (!Q0) { rapor.push({ ad: a.ad, durum: "dörtgen yok" }); continue; }
    const Q = koseSirala(Q0);
    const alanQ = Math.abs(alanKoordinat(Q));
    if (alanQ > w * h * 0.985) { tamKare += 1; rapor.push({ ad: a.ad, durum: "tüm kare" }); continue; }
    if (!dortgenMakul(Q, w, h)) { rapor.push({ ad: a.ad, durum: "makul değil" }); continue; }
    const dolgun = t.alan / alanQ;            // maske dörtgeni ne kadar dolduruyor
    const kabukDolgun = alanKabuk / alanQ;    // dışbükey kabuk ile dörtgen uyumu
    const kenar = kenarDestegi(Q, c, w, h);
    const homojen = icHomojenlik(Q, c, w, h);
    const mx = (Q[0][0] + Q[1][0] + Q[2][0] + Q[3][0]) / 4 / w; const my = (Q[0][1] + Q[1][1] + Q[2][1] + Q[3][1]) / 4 / h;
    const merkezlik = 1 - Math.min(1, Math.hypot(mx - 0.5, my - 0.5) / 0.55);
    const boyut = alanQ / (w * h);
    const boyutPuani = boyut < 0.2 ? boyut / 0.2 : boyut > 0.95 ? 0.6 : 1;
    const dol = Math.max(0, Math.min(1, (dolgun - 0.72) / 0.26));
    const kdol = Math.max(0, Math.min(1, (kabukDolgun - 0.80) / 0.18));
    const hom = Math.max(0, Math.min(1, (homojen - 0.45) / 0.27));
    const puan = 0.28 * dol + 0.10 * kdol + 0.24 * kenar + 0.22 * hom + 0.08 * merkezlik + 0.08 * boyutPuani;
    rapor.push({ ad: a.ad, puan: +puan.toFixed(3), dolgun: +dolgun.toFixed(3), kenar: +kenar.toFixed(3), boyut: +boyut.toFixed(3), homojen: +homojen.toFixed(3), Q: Q.map(([x, y]) => [x / w, y / h]) });
    if (dolgun < 0.76 || homojen < 0.5) continue;
    if (!en || puan > en.puan) en = { puan, Q, ad: a.ad, dolgun, kenar };
  }
  if (secenek.ayrinti) secenek.ayrinti(rapor);
  if (!en) return tamKare >= 2 ? { kose: [[0, 0], [1, 0], [1, 1], [0, 1]], guven: 0.5, yontem: "tam-kare", tam: true } : null;
  if (en.puan < GUVEN_ESIGI) return null;
  const kose = en.Q.map(([x, y]) => [Math.max(0, Math.min(1, x / w)), Math.max(0, Math.min(1, y / h))]);
  return { kose, guven: Math.min(1, en.puan), yontem: en.ad };
}

/** Köşeleri merkeze doğru küçük bir payla içeri çeker (kenardaki koyu/arka plan taşmasını keser). */
export function koseleriIceCek(kose, oran = 0.006) {
  const mx = kose.reduce((s, k) => s + k[0], 0) / 4; const my = kose.reduce((s, k) => s + k[1], 0) / 4;
  return kose.map(([x, y]) => [x + (mx - x) * oran * 2, y + (my - y) * oran * 2].map((v) => Math.max(0, Math.min(1, v))));
}

/**
 * Perspektifte bozulmuş dörtgenin GERÇEK en/boy oranını (genişlik/yükseklik) kestirir (Zhang & He, asal nokta = görüntü merkezi).
 * Köşeler piksel koordinatında, sıra: sol-üst, sağ-üst, sağ-alt, sol-alt. Hesaplanamazsa null döner.
 */
export function gercekOran(P, w, h) {
  const m1 = [P[0][0], P[0][1], 1]; const m2 = [P[1][0], P[1][1], 1]; const m4 = [P[2][0], P[2][1], 1]; const m3 = [P[3][0], P[3][1], 1];
  const cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dt = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const k2 = dt(cr(m1, m4), m3) / dt(cr(m2, m4), m3);
  const k3 = dt(cr(m1, m4), m2) / dt(cr(m3, m4), m2);
  if (!Number.isFinite(k2) || !Number.isFinite(k3) || k2 <= 0 || k3 <= 0) return null;
  const n2 = [k2 * m2[0] - m1[0], k2 * m2[1] - m1[1], k2 * m2[2] - m1[2]];
  const n3 = [k3 * m3[0] - m1[0], k3 * m3[1] - m1[1], k3 * m3[2] - m1[2]];
  const u0 = w / 2; const v0 = h / 2;
  if (Math.abs(k2 - 1) < 1e-3 && Math.abs(k3 - 1) < 1e-3) return Math.hypot(n2[0], n2[1]) / Math.hypot(n3[0], n3[1]); // paralelkenar: perspektif yok
  const pay = n2[2] * n3[2];
  if (Math.abs(pay) < 1e-9) return null;
  const f2 = -((n2[0] * n3[0] - (n2[0] * n3[2] + n2[2] * n3[0]) * u0 + pay * u0 * u0) + (n2[1] * n3[1] - (n2[1] * n3[2] + n2[2] * n3[1]) * v0 + pay * v0 * v0)) / pay;
  if (!(f2 > 0) || !Number.isFinite(f2)) return null;
  const nz = (n) => ((n[0] - u0 * n[2]) ** 2 + (n[1] - v0 * n[2]) ** 2) / f2 + n[2] * n[2];
  const oran = Math.sqrt(nz(n2) / nz(n3));
  return Number.isFinite(oran) && oran > 0.1 && oran < 10 ? oran : null;
}

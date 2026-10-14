/*
 * assets/js/belge-tarayici/tarama.js — İki aşamalı görüntü işleme motoru (Canvas / ImageData, %100 istemci).
 * -----------------------------------------------------------------------
 *  1) Perspektif düzeltme : 4 köşe → dikdörtgen (homografi + bilinear örnekleme, çıktı BANTLAR hâlinde yazılır).
 *  2) Belge temizleme     : "sihirli" (Magic Color: gölge/sararma → beyaz, renkli mühür/imza korunur)
 *                           "bw"      (Sauvola uyarlamalı eşikleme; entegral görüntü, BANT bazlı → düşük RAM)
 *                           "orijinal" (dokunma)
 *  Tüm yoğun işlemler bantlıdır: tam çözünürlüklü ImageData'nın tamamı asla bir arada tutulmaz (kaynak örnekleme hariç).
 * -----------------------------------------------------------------------
 */
import { gorselCoz } from "../donusturucu/motor-gorsel.js";
import { nefes } from "../donusturucu/ortak.js";
import { tuvalAl, tuvalBirak, KAYNAK_MAKS_KENAR, alanaSigdir } from "./bellek-kalkani.js";
import { belgeKosesiBul, koseleriIceCek, gercekOran, ALGILAMA_KENARI } from "./belge-bul.js";

const BANT = 192; // satır

/* ------------------------------ geometri ------------------------------ */

export const VARSAYILAN_KOSELER = () => [[0, 0], [1, 0], [1, 1], [0, 1]]; // sol-üst, sağ-üst, sağ-alt, sol-alt (normalize)

export const kosesiVarsayilanMi = (k) => !k || k.every(([x, y], i) => Math.abs(x - (i === 1 || i === 2 ? 1 : 0)) < 0.002 && Math.abs(y - (i >= 2 ? 1 : 0)) < 0.002);

/** 90° saat yönünde döndürmede normalize köşeleri taşır: (x,y) → (1-y, x); sıra korunur (yeni sol-üst = eski sol-alt). */
export function kosalariDondur(k, adim) {
  let s = k.map(([x, y]) => [x, y]);
  const n = ((adim % 4) + 4) % 4;
  for (let i = 0; i < n; i += 1) {
    s = s.map(([x, y]) => [1 - y, x]);
    s = [s[3], s[0], s[1], s[2]];
  }
  return s;
}

/** Dörtgenden homografi: birim kareden (u,v) → kaynak (x,y). Heckbert çözümü. */
function homografi(p) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = p;
  const dx1 = x1 - x2; const dx2 = x3 - x2; const dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2; const dy2 = y3 - y2; const dy3 = y0 - y1 + y2 - y3;
  let a; let b; let c; let d; let e; let f; let g; let h;
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
    a = x1 - x0; b = x2 - x1; c = x0; d = y1 - y0; e = y2 - y1; f = y0; g = 0; h = 0;
  } else {
    const det = dx1 * dy2 - dx2 * dy1 || 1e-9;
    g = (dx3 * dy2 - dx2 * dy3) / det;
    h = (dx1 * dy3 - dx3 * dy1) / det;
    a = x1 - x0 + g * x1; b = x3 - x0 + h * x3; c = x0;
    d = y1 - y0 + g * y1; e = y3 - y0 + h * y3; f = y0;
  }
  return { a, b, c, d, e, f, g, h };
}

const uzun = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/* ------------------------------ kaynak hazırlama ------------------------------ */

/**
 * Blob → döndürülmüş, en uzun kenarı ≤ KAYNAK_MAKS_KENAR olan tuval (çağıran tuvalBirak ile bırakır).
 * @returns {{tuval:HTMLCanvasElement, w:number, h:number, orijinalW:number, orijinalH:number}}
 */
export async function kaynakTuvaliAl(blob, ad, dondur = 0, maksKenar = KAYNAK_MAKS_KENAR()) {
  const cozum = await gorselCoz(blob, ad);
  try {
    const adim = ((Math.round(dondur / 90) % 4) + 4) % 4;
    const yan = adim % 2 === 1;
    const ow = yan ? cozum.h : cozum.w;
    const oh = yan ? cozum.w : cozum.h;
    const k = Math.min(1, maksKenar / Math.max(ow, oh));
    const alan = alanaSigdir(ow * k, oh * k);
    const w = alan.w; const h = alan.h;
    const c = tuvalAl(w, h);
    const g = c.getContext("2d");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, w, h);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    g.save();
    g.translate(w / 2, h / 2);
    g.rotate((adim * Math.PI) / 2);
    const cw = yan ? h : w; const ch = yan ? w : h; // döndürmeden önceki çizim boyutu
    g.drawImage(cozum.cizilebilir, -cw / 2, -ch / 2, cw, ch);
    g.restore();
    return { tuval: c, w, h, orijinalW: ow, orijinalH: oh };
  } finally { cozum.kapat?.(); }
}

/* ------------------------------ perspektif ------------------------------ */

/** Kaynak tuvalden 4 köşeyi düzleştirir → yeni tuval (cw×ch). Köşeler normalize [0..1]. */
async function perspektifUygula(kaynak, kose, cw, ch) {
  const sg = kaynak.getContext("2d", { willReadFrequently: true });
  const kaynakVeri = sg.getImageData(0, 0, kaynak.width, kaynak.height);
  const sd = kaynakVeri.data; const sw = kaynak.width; const sh = kaynak.height;
  const P = kose.map(([x, y]) => [x * (sw - 1), y * (sh - 1)]);
  const H = homografi(P);
  const cikis = tuvalAl(cw, ch);
  const cg = cikis.getContext("2d");
  for (let y0 = 0; y0 < ch; y0 += BANT) {
    const bh = Math.min(BANT, ch - y0);
    const bant = cg.createImageData(cw, bh);
    const od = bant.data;
    let o = 0;
    for (let y = 0; y < bh; y += 1) {
      const v = (y0 + y + 0.5) / ch;
      for (let x = 0; x < cw; x += 1) {
        const u = (x + 0.5) / cw;
        const wq = H.g * u + H.h * v + 1;
        const sx = (H.a * u + H.b * v + H.c) / wq;
        const sy = (H.d * u + H.e * v + H.f) / wq;
        if (sx < 0 || sy < 0 || sx > sw - 1 || sy > sh - 1) { od[o] = 255; od[o + 1] = 255; od[o + 2] = 255; od[o + 3] = 255; o += 4; continue; }
        const ix = sx | 0; const iy = sy | 0;
        const fx = sx - ix; const fy = sy - iy;
        const ix1 = ix + 1 < sw ? ix + 1 : ix; const iy1 = iy + 1 < sh ? iy + 1 : iy;
        const i00 = (iy * sw + ix) * 4; const i10 = (iy * sw + ix1) * 4; const i01 = (iy1 * sw + ix) * 4; const i11 = (iy1 * sw + ix1) * 4;
        const w00 = (1 - fx) * (1 - fy); const w10 = fx * (1 - fy); const w01 = (1 - fx) * fy; const w11 = fx * fy;
        od[o] = sd[i00] * w00 + sd[i10] * w10 + sd[i01] * w01 + sd[i11] * w11;
        od[o + 1] = sd[i00 + 1] * w00 + sd[i10 + 1] * w10 + sd[i01 + 1] * w01 + sd[i11 + 1] * w11;
        od[o + 2] = sd[i00 + 2] * w00 + sd[i10 + 2] * w10 + sd[i01 + 2] * w01 + sd[i11 + 2] * w11;
        od[o + 3] = 255;
        o += 4;
      }
    }
    cg.putImageData(bant, 0, y0);
    // bant referansı bırakılır (GC)
    await nefes();
  }
  kaynakVeri.data.fill?.(0); // büyük tamponu hemen sıfırla; referans fonksiyon çıkışında kopar
  return cikis;
}

/* ------------------------------ Magic Color ------------------------------ */

function maksFiltre(d, w, h, r) { // ayrılabilir maks. filtre (koyu mürekkebi siler → kâğıt rengi kalır)
  const t = new Uint8ClampedArray(d.length);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      for (let c = 0; c < 3; c += 1) {
        let m = 0;
        for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k += 1) { const v = d[(y * w + k) * 4 + c]; if (v > m) m = v; }
        t[(y * w + x) * 4 + c] = m;
      }
      t[(y * w + x) * 4 + 3] = 255;
    }
  }
  const o = new Uint8ClampedArray(d.length);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      for (let c = 0; c < 3; c += 1) {
        let m = 0;
        for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k += 1) { const v = t[(k * w + x) * 4 + c]; if (v > m) m = v; }
        o[(y * w + x) * 4 + c] = m;
      }
      o[(y * w + x) * 4 + 3] = 255;
    }
  }
  return o;
}

function kutuBulaniklastir(d, w, h, r) {
  const t = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y += 1) {
    for (let c = 0; c < 3; c += 1) {
      let toplam = 0; let adet = 0;
      for (let x = -r; x <= r; x += 1) { if (x >= 0 && x < w) { toplam += d[(y * w + x) * 4 + c]; adet += 1; } }
      for (let x = 0; x < w; x += 1) {
        t[(y * w + x) * 3 + c] = toplam / adet;
        const ekle = x + r + 1; const cikar = x - r;
        if (ekle < w) { toplam += d[(y * w + ekle) * 4 + c]; adet += 1; }
        if (cikar >= 0) { toplam -= d[(y * w + cikar) * 4 + c]; adet -= 1; }
      }
    }
  }
  const o = new Uint8ClampedArray(d.length);
  for (let x = 0; x < w; x += 1) {
    for (let c = 0; c < 3; c += 1) {
      let toplam = 0; let adet = 0;
      for (let y = -r; y <= r; y += 1) { if (y >= 0 && y < h) { toplam += t[(y * w + x) * 3 + c]; adet += 1; } }
      for (let y = 0; y < h; y += 1) {
        o[(y * w + x) * 4 + c] = toplam / adet;
        o[(y * w + x) * 4 + 3] = 255;
        const ekle = y + r + 1; const cikar = y - r;
        if (ekle < h) { toplam += t[(ekle * w + x) * 3 + c]; adet += 1; }
        if (cikar >= 0) { toplam -= t[(cikar * w + x) * 3 + c]; adet -= 1; }
      }
    }
  }
  return o;
}

/** Kâğıt rengi (arka plan) haritası: küçük kopya → maks. filtre (mürekkep silinir) → bulanıklaştırma → tam boyuta yumuşak büyütme. */
async function arkaPlanTuvali(c) {
  const k = 160 / Math.max(c.width, c.height);
  const sw = Math.max(8, Math.round(c.width * Math.min(1, k)));
  const sh = Math.max(8, Math.round(c.height * Math.min(1, k)));
  const kucuk = tuvalAl(sw, sh);
  const kg = kucuk.getContext("2d", { willReadFrequently: true });
  kg.imageSmoothingQuality = "high";
  kg.drawImage(c, 0, 0, sw, sh);
  let veri = kg.getImageData(0, 0, sw, sh);
  const r = Math.max(2, Math.round(Math.max(sw, sh) / 28));
  let dil = maksFiltre(veri.data, sw, sh, r);
  let bul = kutuBulaniklastir(dil, sw, sh, Math.max(1, Math.round(r / 2)));
  veri = new ImageData(bul, sw, sh);
  kg.putImageData(veri, 0, 0);
  const buyuk = tuvalAl(c.width, c.height);
  const bg = buyuk.getContext("2d");
  bg.imageSmoothingEnabled = true;
  bg.imageSmoothingQuality = "high";
  bg.drawImage(kucuk, 0, 0, c.width, c.height);
  dil = null; bul = null; veri = null;
  tuvalBirak(kucuk);
  return buyuk;
}

async function sihirliRenk(c) {
  const w = c.width; const h = c.height;
  const bgTuval = await arkaPlanTuvali(c);
  const g = c.getContext("2d", { willReadFrequently: true });
  const bg = bgTuval.getContext("2d", { willReadFrequently: true });
  const LO = 0.50; const HI = 0.90; // oran: bu değerin altı mürekkep (kararır), üstü kâğıt (saf beyaz)
  const ARALIK = 1 / (HI - LO);
  for (let y0 = 0; y0 < h; y0 += BANT) {
    const bh = Math.min(BANT, h - y0);
    const veri = g.getImageData(0, y0, w, bh);
    const arka = bg.getImageData(0, y0, w, bh);
    const d = veri.data; const a = arka.data;
    for (let i = 0; i < d.length; i += 4) {
      for (let k = 0; k < 3; k += 1) {
        const oran = d[i + k] / Math.max(24, a[i + k]);
        let v = (oran - LO) * ARALIK;
        v = v < 0 ? 0 : v > 1 ? 1 : v;
        d[i + k] = 255 * (v * v * (3 - 2 * v)); // smoothstep: yumuşak kenar, net mürekkep
      }
    }
    g.putImageData(veri, 0, y0);
    await nefes();
  }
  tuvalBirak(bgTuval);
}

/* ------------------------------ Sauvola (B&W) ------------------------------ */

async function sauvola(c) {
  const w = c.width; const h = c.height;
  const g = c.getContext("2d", { willReadFrequently: true });
  const r = Math.max(8, Math.min(40, Math.round(Math.min(w, h) / 45)));
  const K = 0.25; const R = 128; const YUMUSAK = 14;
  const W1 = w + 1;
  let kuyruk = null; // önceki bandın ORİJİNAL son r satırı (o satırlar tuvalde artık eşiklenmiş durumda; pencere orijinali ister)
  for (let y0 = 0; y0 < h; y0 += BANT) {
    const bh = Math.min(BANT, h - y0);
    const ya = Math.max(0, y0 - r); const yb = Math.min(h, y0 + bh + r);
    const yeni = g.getImageData(0, y0, w, yb - y0).data;
    let d = yeni;
    if (kuyruk && y0 > 0) { d = new Uint8ClampedArray(kuyruk.length + yeni.length); d.set(kuyruk); d.set(yeni, kuyruk.length); }
    const satir = yb - ya;
    // entegral görüntüler yalnızca bu bant için (düşük bellek)
    const S = new Float64Array((satir + 1) * W1);
    const Q = new Float64Array((satir + 1) * W1);
    for (let y = 0; y < satir; y += 1) {
      let rs = 0; let rq = 0;
      for (let x = 0; x < w; x += 1) {
        const i = (y * w + x) * 4;
        const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        rs += v; rq += v * v;
        S[(y + 1) * W1 + x + 1] = S[y * W1 + x + 1] + rs;
        Q[(y + 1) * W1 + x + 1] = Q[y * W1 + x + 1] + rq;
      }
    }
    const cikis = g.createImageData(w, bh);
    const od = cikis.data;
    for (let y = 0; y < bh; y += 1) {
      const gy = y0 + y; const ly = gy - ya;
      const t = Math.max(0, ly - r); const b = Math.min(satir - 1, ly + r);
      for (let x = 0; x < w; x += 1) {
        const l = Math.max(0, x - r); const rr = Math.min(w - 1, x + r);
        const adet = (b - t + 1) * (rr - l + 1);
        const toplam = S[(b + 1) * W1 + rr + 1] - S[t * W1 + rr + 1] - S[(b + 1) * W1 + l] + S[t * W1 + l];
        const kare = Q[(b + 1) * W1 + rr + 1] - Q[t * W1 + rr + 1] - Q[(b + 1) * W1 + l] + Q[t * W1 + l];
        const ort = toplam / adet;
        const sapma = Math.sqrt(Math.max(0, kare / adet - ort * ort));
        const esik = ort * (1 + K * (sapma / R - 1));
        const i = (ly * w + x) * 4;
        const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        let s = (v - (esik - YUMUSAK)) / (2 * YUMUSAK);
        s = s < 0 ? 0 : s > 1 ? 1 : s;
        const q = 255 * s;
        const oi = (y * w + x) * 4;
        od[oi] = q; od[oi + 1] = q; od[oi + 2] = q; od[oi + 3] = 255;
      }
    }
    g.putImageData(cikis, 0, y0);
    const kBas = Math.max(0, y0 + bh - r - ya);
    kuyruk = d.slice(kBas * w * 4, (y0 + bh - ya) * w * 4);
    d = null;
    await nefes();
  }
  kuyruk = null;
}

/** Mod uygula (yerinde). */
export async function modUygula(tuval, mod) {
  if (mod === "sihirli") await sihirliRenk(tuval);
  else if (mod === "bw") await sauvola(tuval);
}

/* ------------------------------ otomatik köşe / belge algılama ------------------------------ */

/**
 * Tuvaldeki belgeyi (kâğıt) arka plandan ayırır: belge-bul.js (çok aday + puanlama). Küçültülmüş kopyada çalışır (~320 px).
 * @returns {{kose:number[][], guven:number, tam?:boolean}|null}  null = emin değil (kırpma yapılmaz)
 */
export async function belgeyiAlgilaTuval(tuval) {
  const k = ALGILAMA_KENARI / Math.max(tuval.width, tuval.height);
  const w = Math.max(24, Math.round(tuval.width * Math.min(1, k)));
  const h = Math.max(24, Math.round(tuval.height * Math.min(1, k)));
  const c = tuvalAl(w, h);
  try {
    const g = c.getContext("2d", { willReadFrequently: true });
    g.imageSmoothingQuality = "high";
    g.drawImage(tuval, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    await nefes();
    const r = belgeKosesiBul(d, w, h);
    if (!r || r.tam) return r ? { ...r, kose: null } : null;
    return { ...r, kose: koseleriIceCek(r.kose) };
  } finally { tuvalBirak(c); }
}

/** Bir öğenin kaynağından (döndürme dahil) belgeyi algılar. Başarısızsa null. */
export async function belgeyiAlgila(blob, ad, dondur = 0) {
  const { tuval } = await kaynakTuvaliAl(blob, ad, dondur, 640);
  try { return await belgeyiAlgilaTuval(tuval); } finally { tuvalBirak(tuval); }
}

/** Eski ad (köşe düzenleme penceresi "Otomatik algıla" düğmesi): yalnızca köşeleri döndürür, bulamazsa null. */
export async function otomatikKose(kaynakTuvali) {
  const r = await belgeyiAlgilaTuval(kaynakTuvali);
  return r && r.kose ? r.kose : null;
}

/* ------------------------------ ana boru hattı ------------------------------ */

/**
 * Bir kuyruk öğesini işler → ÇIKTI TUVALİ (çağıran toBlob sonrası tuvalBirak ile bırakır).
 * @param {object} oge   {blob, ad, dondur, kose, mod}
 * @param {object} secenek {mod, maksKenar (px, uzun kenar), maksKisa (px, kısa kenar), kaynakMaksKenar?}
 */
export async function ogeyiIsle(oge, secenek) {
  const { tuval: kaynak, w: sw, h: sh } = await kaynakTuvaliAl(oge.blob, oge.ad, oge.dondur || 0, secenek.kaynakMaksKenar);
  let sonuc = null;
  try {
    const kose = oge.kose || VARSAYILAN_KOSELER();
    const duzelt = !kosesiVarsayilanMi(kose);
    const P = kose.map(([x, y]) => [x * (sw - 1), y * (sh - 1)]);
    let dogalW = duzelt ? Math.max(uzun(P[0], P[1]), uzun(P[3], P[2])) : sw;
    let dogalH = duzelt ? Math.max(uzun(P[0], P[3]), uzun(P[1], P[2])) : sh;
    if (duzelt) {
      // Perspektifte kenar uzunlukları yanıltır (yakın kenar uzun görünür): kâğıdın GERÇEK en/boy oranı kestirilir; alan korunur.
      const r = gercekOran(P, sw, sh);
      const basit = dogalW / dogalH;
      if (r && r / basit > 0.6 && r / basit < 1.67) { const alan = dogalW * dogalH; dogalW = Math.sqrt(alan * r); dogalH = Math.sqrt(alan / r); }
    }
    const k = Math.min(1, (secenek.maksKenar || Infinity) / Math.max(dogalW, dogalH), (secenek.maksKisa || Infinity) / Math.min(dogalW, dogalH));
    const hedef = alanaSigdir(Math.max(1, dogalW * k), Math.max(1, dogalH * k));
    if (duzelt) {
      sonuc = await perspektifUygula(kaynak, kose, hedef.w, hedef.h);
    } else if (hedef.w === sw && hedef.h === sh) {
      sonuc = kaynak; // taşı: ek kopya yok
      return await sonrasi(sonuc, oge, secenek);
    } else {
      sonuc = tuvalAl(hedef.w, hedef.h);
      const g = sonuc.getContext("2d");
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
      g.drawImage(kaynak, 0, 0, hedef.w, hedef.h);
    }
    return await sonrasi(sonuc, oge, secenek);
  } finally {
    if (sonuc !== kaynak) tuvalBirak(kaynak);
  }
}

async function sonrasi(tuval, oge, secenek) {
  try { await modUygula(tuval, oge.mod && oge.mod !== "genel" ? oge.mod : secenek.mod); } catch (h) { tuvalBirak(tuval); throw h; }
  return tuval;
}

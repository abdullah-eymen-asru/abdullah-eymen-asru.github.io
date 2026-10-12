/*
 * assets/js/belge-tarayici/sikistir.js — Evrensel boyut küçültme (istemci taraflı sıkıştırma) ayarları + canlı boyut tahmini.
 * -----------------------------------------------------------------------
 *  Profiller (DPI = A4 sayfanın piksel yoğunluğu; kalite = JPEG/WebP kalitesi):
 *    web     : Düşük Boyut / Web   → 110 DPI, %55   (e-posta/form yükleme)
 *    dengeli : Dengeli (önerilen)  → 170 DPI, %80
 *    arsiv   : Orijinal / Arşiv    → 300 DPI, %95   (A4'ten büyük kaynaklar 300 DPI'ya iner; küçük kaynak BÜYÜTÜLMEZ)
 *  Çözünürlük sınırı: orijinal | 1080p (1920×1080) | 2K (2560×1440) | A4 (profil DPI'ı × 8,27×11,69 inç)
 *  Tahmin: gerçek bir örnek sayfa SEÇİLİ ayarlarla işlenip kodlanır → piksel başına bayt ölçülür → tüm sayfalara ölçeklenir.
 * -----------------------------------------------------------------------
 */
import { ogeyiIsle } from "./tarama.js";
import { tuvalBirak } from "./bellek-kalkani.js";

export const PROFILLER = {
  web: { ad: "Düşük Boyut / Web", aciklama: "Maksimum sıkıştırma", dpi: 110, kalite: 55, cozunurluk: "a4" },
  dengeli: { ad: "Dengeli (Önerilen)", aciklama: "Netlik ve boyut dengesi", dpi: 170, kalite: 80, cozunurluk: "a4" },
  arsiv: { ad: "Orijinal / Arşiv", aciklama: "Minimum sıkıştırma", dpi: 300, kalite: 95, cozunurluk: "a4" },
};

export const COZUNURLUKLER = {
  orijinal: "Orijinal boyut",
  "1080p": "1080p (1920×1080)",
  "2k": "2K (2560×1440)",
  a4: "A4 standardı (profil DPI)",
};

export const A4_INC = { kisa: 8.27, uzun: 11.69 };
export const A4_PT = { w: 595.28, h: 841.89 };

export const varsayilanAyar = () => ({
  profil: "dengeli", ...{ dpi: PROFILLER.dengeli.dpi, kalite: PROFILLER.dengeli.kalite, cozunurluk: PROFILLER.dengeli.cozunurluk },
  mod: "sihirli", format: "jpeg", sayfa: "a4", zipSeviye: 6,
});

export function profilUygula(ayar, ad) {
  const p = PROFILLER[ad];
  if (!p) return ayar;
  return { ...ayar, profil: ad, dpi: p.dpi, kalite: p.kalite, cozunurluk: p.cozunurluk };
}

/** ayar → ogeyiIsle sınırları (uzun/kısa kenar px). */
export function sinirlar(ayar) {
  switch (ayar.cozunurluk) {
    case "1080p": return { maksKenar: 1920, maksKisa: 1080 };
    case "2k": return { maksKenar: 2560, maksKisa: 1440 };
    case "a4": return { maksKenar: Math.round(A4_INC.uzun * ayar.dpi), maksKisa: Math.round(A4_INC.kisa * ayar.dpi) };
    default: return { maksKenar: Infinity, maksKisa: Infinity };
  }
}

export const MIME = { jpeg: "image/jpeg", webp: "image/webp", png: "image/png" };
export const UZANTI = { jpeg: "jpg", webp: "webp", png: "png" };

export const tuvalBlob = (c, mime, kalite) => new Promise((coz, red) => c.toBlob((b) => (b ? coz(b) : red(new Error("Tuval dışa aktarılamadı."))), mime, mime === "image/png" ? undefined : kalite));

/** Tarayıcı WebP'yi gerçekten üretiyor mu? (Safari sessizce PNG'ye düşer) */
let webpSozu = null;
export function webpDestekli() {
  if (!webpSozu) {
    webpSozu = (async () => {
      try { const c = document.createElement("canvas"); c.width = 2; c.height = 2; const b = await tuvalBlob(c, "image/webp", 0.8); c.width = 0; c.height = 0; return b.type === "image/webp"; } catch { return false; }
    })();
  }
  return webpSozu;
}

/** Bir ögeyi ayarlarla işleyip kodlar → {blob, w, h}. Tuval her durumda bırakılır. */
export async function ogeyiKodla(oge, ayar, mime, ekSecenek = {}) {
  const tuval = await ogeyiIsle(oge, { mod: ayar.mod, ...sinirlar(ayar), ...ekSecenek });
  try {
    const w = tuval.width; const h = tuval.height;
    const blob = await tuvalBlob(tuval, mime, ayar.kalite / 100);
    return { blob, w, h };
  } finally { tuvalBirak(tuval); }
}

/** Dönüşüm sonrası tahmini piksel boyutu (köşe düzeltme + sınırlar), işlem yapmadan. */
export function cikisBoyutu(oge, ayar) {
  const yan = ((Math.round((oge.dondur || 0) / 90) % 4) + 4) % 2 === 1;
  const sw = yan ? oge.h : oge.w; const sh = yan ? oge.w : oge.h;
  let dw = sw; let dh = sh;
  const k4 = oge.kose;
  if (k4) {
    const P = k4.map(([x, y]) => [x * sw, y * sh]);
    const L = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    dw = Math.max(L(P[0], P[1]), L(P[3], P[2])) || sw; dh = Math.max(L(P[0], P[3]), L(P[1], P[2])) || sh;
  }
  const s = sinirlar(ayar);
  const k = Math.min(1, s.maksKenar / Math.max(dw, dh), s.maksKisa / Math.min(dw, dh));
  return { w: Math.max(1, Math.round(dw * k)), h: Math.max(1, Math.round(dh * k)) };
}

let tahminSayac = 0;
const onbellek = new Map();

/**
 * @returns {Promise<{once:number, pdf:number, gorsel:number, iptal?:boolean}>}
 *  once: kaynakların toplam bayt'ı; pdf: tahmini PDF; gorsel: tahmini toplu görsel/ZIP (seçili format).
 */
export async function tahminiBoyut(ogeler, ayar) {
  const sira = ++tahminSayac;
  const once = ogeler.reduce((a, o) => a + (o.orijinalBayt || 0), 0);
  if (!ogeler.length) return { once: 0, pdf: 0, gorsel: 0 };
  const ornek = ogeler[Math.floor(ogeler.length / 2)];
  const anahtar = JSON.stringify([ornek.id, ornek.v, ayar.kalite, ayar.dpi, ayar.cozunurluk, ayar.mod, ayar.format]);
  let bpp = onbellek.get(anahtar);
  if (!bpp) {
    const jpegMi = ayar.format === "jpeg";
    const webpOk = ayar.format === "webp" ? await webpDestekli() : false;
    const tuval = await ogeyiIsle(ornek, { mod: ayar.mod, ...sinirlar(ayar) });
    try {
      const px = tuval.width * tuval.height;
      const j = await tuvalBlob(tuval, "image/jpeg", ayar.kalite / 100);
      let g = j;
      if (!jpegMi) g = await tuvalBlob(tuval, webpOk || ayar.format === "png" ? MIME[ayar.format] : "image/jpeg", ayar.kalite / 100);
      bpp = { jpeg: j.size / px, gorsel: g.size / px };
    } finally { tuvalBirak(tuval); }
    if (onbellek.size > 30) onbellek.clear();
    onbellek.set(anahtar, bpp);
  }
  if (sira !== tahminSayac) return { once, pdf: 0, gorsel: 0, iptal: true };
  let pdf = 0; let gorsel = 0;
  for (const o of ogeler) {
    const { w, h } = cikisBoyutu(o, ayar);
    pdf += w * h * bpp.jpeg + 1200;
    gorsel += w * h * bpp.gorsel;
  }
  return { once, pdf: Math.round(pdf), gorsel: Math.round(gorsel) };
}

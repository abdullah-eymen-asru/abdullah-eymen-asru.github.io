/*
 * assets/js/notlar/disa-aktar/zip.js
 * -----------------------------------------------------------------------
 * Bağımlılıksız ZIP yazıcı (tarayıcıda). Not dışa aktarmada KLASÖR YAPISINI,
 * DOSYA ADLARINI ve ZAMAN DAMGALARINI birebir korumak için kullanılır.
 *
 *  - Her kayıt kendi tarih-saatiyle (DOS zaman damgası, yerel saat) yazılır; arşivi
 *    açınca dosyaların "değiştirilme tarihi" notun son güncelleme zamanı olur.
 *  - Ad UTF-8 (bayrak bit 11): Türkçe karakterler Windows/macOS/Linux'ta bozulmaz.
 *  - Mümkünse deflate-raw ile sıkıştırır (CompressionStream); PNG/JPEG/WebP gibi zaten
 *    sıkışık türlerde ya da kazanç yoksa "store" kullanır.
 *  - ZIP64 yok: 65.535 kayıt / 4 GB üstü desteklenmez (açık hata verir).
 * -----------------------------------------------------------------------
 */

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(u8) {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const kodla = new TextEncoder();
const SIKISMAZ = /\.(png|jpe?g|gif|webp|zip|docx|xlsx|pptx|mp3|mp4|mov)$/i;

function dosZaman(d) {
  const y = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export async function deflateRaw(u8) {
  if (typeof CompressionStream !== "function") return null;
  try {
    const akis = new Blob([u8]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(akis).arrayBuffer());
  } catch {
    return null;
  }
}

export async function zlibSikistir(u8) {
  if (typeof CompressionStream !== "function") return null;
  try {
    const akis = new Blob([u8]).stream().pipeThrough(new CompressionStream("deflate"));
    return new Uint8Array(await new Response(akis).arrayBuffer());
  } catch {
    return null;
  }
}

export class ZipYazici {
  constructor() {
    this.parcalar = [];
    this.merkez = [];
    this.konum = 0;
    this.adlar = new Set();
  }

  /** Aynı yol ikinci kez gelirse "ad (2).uzantı" üretir. */
  benzersiz(yol) {
    if (!this.adlar.has(yol.toLowerCase())) return yol;
    const nokta = yol.lastIndexOf(".");
    const govde = nokta > yol.lastIndexOf("/") ? yol.slice(0, nokta) : yol;
    const uzanti = govde.length === yol.length ? "" : yol.slice(nokta);
    for (let i = 2; ; i++) {
      const aday = `${govde} (${i})${uzanti}`;
      if (!this.adlar.has(aday.toLowerCase())) return aday;
    }
  }

  _kaydet(ad, veri, crc, boyut, yontem, tarih, klasorMu) {
    if (this.merkez.length >= 65535) throw new Error("ZIP en fazla 65.535 kayıt içerebilir; dışa aktarmayı parçalara böl.");
    const adBayt = kodla.encode(ad);
    const { time, date } = dosZaman(tarih);
    const yerel = new DataView(new ArrayBuffer(30));
    yerel.setUint32(0, 0x04034b50, true);
    yerel.setUint16(4, 20, true);
    yerel.setUint16(6, 0x0800, true);
    yerel.setUint16(8, yontem, true);
    yerel.setUint16(10, time, true);
    yerel.setUint16(12, date, true);
    yerel.setUint32(14, crc, true);
    yerel.setUint32(18, veri.length, true);
    yerel.setUint32(22, boyut, true);
    yerel.setUint16(26, adBayt.length, true);
    yerel.setUint16(28, 0, true);

    const orta = new DataView(new ArrayBuffer(46));
    orta.setUint32(0, 0x02014b50, true);
    orta.setUint16(4, 20, true);
    orta.setUint16(6, 20, true);
    orta.setUint16(8, 0x0800, true);
    orta.setUint16(10, yontem, true);
    orta.setUint16(12, time, true);
    orta.setUint16(14, date, true);
    orta.setUint32(16, crc, true);
    orta.setUint32(20, veri.length, true);
    orta.setUint32(24, boyut, true);
    orta.setUint16(28, adBayt.length, true);
    orta.setUint32(38, klasorMu ? 0x10 : 0, true);
    orta.setUint32(42, this.konum, true);

    this.parcalar.push(new Uint8Array(yerel.buffer), adBayt, veri);
    this.merkez.push(new Uint8Array(orta.buffer), adBayt);
    this.konum += 30 + adBayt.length + veri.length;
    if (this.konum > 0xfffffff0) throw new Error("ZIP 4 GB sınırını aştı; dışa aktarmayı parçalara böl.");
  }

  async dosyaEkle(yol, veri, tarih = new Date()) {
    const u8 = typeof veri === "string" ? kodla.encode(veri) : veri;
    const ad = this.benzersiz(yol);
    this.adlar.add(ad.toLowerCase());
    const crc = crc32(u8);
    let yontem = 0;
    let govde = u8;
    if (u8.length > 64 && !SIKISMAZ.test(ad)) {
      const s = await deflateRaw(u8);
      if (s && s.length < u8.length * 0.95) {
        yontem = 8;
        govde = s;
      }
    }
    this._kaydet(ad, govde, crc, u8.length, yontem, tarih, false);
    return ad;
  }

  klasorEkle(yol, tarih = new Date()) {
    const ad = yol.endsWith("/") ? yol : yol + "/";
    if (this.adlar.has(ad.toLowerCase())) return;
    this.adlar.add(ad.toLowerCase());
    this._kaydet(ad, new Uint8Array(0), 0, 0, 0, tarih, true);
  }

  bitir() {
    let merkezBoyut = 0;
    for (const p of this.merkez) merkezBoyut += p.length;
    const son = new DataView(new ArrayBuffer(22));
    son.setUint32(0, 0x06054b50, true);
    const sayi = this.merkez.length / 2;
    son.setUint16(8, sayi, true);
    son.setUint16(10, sayi, true);
    son.setUint32(12, merkezBoyut, true);
    son.setUint32(16, this.konum, true);
    return new Blob([...this.parcalar, ...this.merkez, son.buffer], { type: "application/zip" });
  }
}

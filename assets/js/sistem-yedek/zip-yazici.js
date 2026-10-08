/*
 * assets/js/sistem-yedek/zip-yazici.js — AKIŞLI, bağımlılıksız ZIP yazıcı (tarayıcıda), ZIP64 destekli.
 * -----------------------------------------------------------------------
 *  - Çıktı bir "alıcı"ya (sink) yazılır: Dosya Sistemi Erişimi API'si varsa doğrudan diske
 *    (sabit bellek), yoksa Blob parçalarına (tarayıcı diske taşıyabilir).
 *  - Büyük girişler (R2 dosyası, GitHub zip) bayt bayt akar: önce başlık (bit 3: veri tanımlayıcı),
 *    sonra veri, sonra CRC32 + boyut. Küçük metinler deflate-raw ile sıkıştırılır.
 *  - Yol adları UTF-8 (bayrak bit 11). Aynı yol ikinci kez gelirse "ad (2).uzantı" üretilir.
 *  - Tek giriş en çok 4 GB (akışlı girişlerde); toplam arşiv ZIP64 ile 4 GB'ı aşabilir.
 * -----------------------------------------------------------------------
 */
const CRC_TABLO = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crcGuncelle(crc, u8) {
  let c = crc ^ 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLO[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const kodla = new TextEncoder();
const SIKISMAZ = /\.(png|jpe?g|gif|webp|zip|docx|xlsx|pptx|pdf|mp3|mp4|mov|bin)$/i;
const DORT_GB = 0xffffffff;

function dosZaman(d) {
  const y = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

async function deflateRaw(u8) {
  if (typeof CompressionStream !== "function") return null;
  try {
    const akis = new Blob([u8]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(akis).arrayBuffer());
  } catch {
    return null;
  }
}

/** Dosya Sistemi Erişimi API'si → diske akış; yoksa Blob parçaları. */
export async function aliciOlustur(dosyaAdi, { diskeYaz = true } = {}) {
  if (diskeYaz && typeof window !== "undefined" && typeof window.showSaveFilePicker === "function") {
    // Kullanıcı hareketi gerekir: bu fonksiyon, tıklama işleyicisinde ilk await olarak çağrılmalı.
    const tutamac = await window.showSaveFilePicker({
      suggestedName: dosyaAdi,
      types: [{ description: "ZIP arşivi", accept: { "application/zip": [".zip"] } }],
    });
    const yazilabilir = await tutamac.createWritable();
    return {
      tur: "disk",
      yaz: (u8) => yazilabilir.write(u8),
      kapat: async () => { await yazilabilir.close(); return null; },
      iptal: async () => { try { await yazilabilir.abort(); } catch { /* yoksay */ } },
    };
  }
  const parcalar = [];
  return {
    tur: "bellek",
    yaz: async (u8) => { parcalar.push(u8); },
    kapat: async () => new Blob(parcalar, { type: "application/zip" }),
    iptal: async () => { parcalar.length = 0; },
  };
}

export class AkisliZip {
  constructor(alici) {
    this.alici = alici;
    this.konum = 0;
    this.merkez = [];
    this.adlar = new Set();
    this.acik = null;
  }

  benzersiz(yol) {
    const temiz = yol.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\.\.+\//g, "");
    if (!this.adlar.has(temiz.toLowerCase())) return temiz;
    const nokta = temiz.lastIndexOf(".");
    const govde = nokta > temiz.lastIndexOf("/") ? temiz.slice(0, nokta) : temiz;
    const uzanti = govde.length === temiz.length ? "" : temiz.slice(nokta);
    for (let i = 2; ; i++) {
      const aday = `${govde} (${i})${uzanti}`;
      if (!this.adlar.has(aday.toLowerCase())) return aday;
    }
  }

  async _yaz(u8) {
    await this.alici.yaz(u8);
    this.konum += u8.length;
  }

  /** Küçük/bilinen boyutlu giriş (metin ya da bayt dizisi). Uygunsa deflate ile sıkıştırır. */
  async dosyaEkle(yol, veri, tarih = new Date()) {
    if (this.acik) throw new Error("Önceki akışlı giriş kapatılmadan yenisi eklenemez.");
    const u8 = typeof veri === "string" ? kodla.encode(veri) : veri;
    const ad = this.benzersiz(yol);
    this.adlar.add(ad.toLowerCase());
    const crc = crcGuncelle(0, u8);
    let yontem = 0;
    let govde = u8;
    if (u8.length > 128 && !SIKISMAZ.test(ad)) {
      const s = await deflateRaw(u8);
      if (s && s.length < u8.length * 0.95) { yontem = 8; govde = s; }
    }
    if (govde.length >= DORT_GB || u8.length >= DORT_GB) throw new Error(`“${ad}” 4 GB sınırını aşıyor.`);
    const adBayt = kodla.encode(ad);
    const { time, date } = dosZaman(tarih);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(6, 0x0800, true);
    h.setUint16(8, yontem, true);
    h.setUint16(10, time, true);
    h.setUint16(12, date, true);
    h.setUint32(14, crc, true);
    h.setUint32(18, govde.length, true);
    h.setUint32(22, u8.length, true);
    h.setUint16(26, adBayt.length, true);
    const ofset = this.konum;
    await this._yaz(new Uint8Array(h.buffer));
    await this._yaz(adBayt);
    await this._yaz(govde);
    this.merkez.push({ adBayt, yontem, time, date, crc, csize: govde.length, usize: u8.length, ofset, bayrak: 0x0800 });
    return ad;
  }

  /** Akışlı giriş: { yaz(u8), bitir() }. Boyut önceden bilinmez (bit 3: veri tanımlayıcı), saklama (store). */
  async akisAc(yol, tarih = new Date()) {
    if (this.acik) throw new Error("Önceki akışlı giriş kapatılmadan yenisi eklenemez.");
    const ad = this.benzersiz(yol);
    this.adlar.add(ad.toLowerCase());
    const adBayt = kodla.encode(ad);
    const { time, date } = dosZaman(tarih);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(6, 0x0808, true);
    h.setUint16(8, 0, true);
    h.setUint16(10, time, true);
    h.setUint16(12, date, true);
    h.setUint16(26, adBayt.length, true);
    const ofset = this.konum;
    await this._yaz(new Uint8Array(h.buffer));
    await this._yaz(adBayt);
    let crc = 0;
    let boyut = 0;
    const kayit = { adBayt, yontem: 0, time, date, ofset, bayrak: 0x0808 };
    const bu = this;
    const giris = {
      ad,
      async yaz(u8) {
        if (!u8.length) return;
        boyut += u8.length;
        if (boyut >= DORT_GB) throw new Error(`“${ad}” tek dosya olarak 4 GB sınırını aşıyor.`);
        crc = crcGuncelle(crc, u8);
        await bu._yaz(u8);
      },
      async bitir() {
        const d = new DataView(new ArrayBuffer(16));
        d.setUint32(0, 0x08074b50, true);
        d.setUint32(4, crc, true);
        d.setUint32(8, boyut, true);
        d.setUint32(12, boyut, true);
        await bu._yaz(new Uint8Array(d.buffer));
        Object.assign(kayit, { crc, csize: boyut, usize: boyut });
        bu.merkez.push(kayit);
        bu.acik = null;
        return boyut;
      },
    };
    this.acik = giris;
    return giris;
  }

  /** Bir Response/ReadableStream gövdesini akışlı girişe aktarır; aktarılan bayt sayısını döndürür. */
  async akisEkle(yol, akis, { tarih, sinyal, ilerleme } = {}) {
    const giris = await this.akisAc(yol, tarih);
    try {
      const okuyucu = akis.getReader();
      for (;;) {
        if (sinyal?.aborted) throw new DOMException("İptal edildi", "AbortError");
        const { done, value } = await okuyucu.read();
        if (done) break;
        await giris.yaz(value);
        ilerleme?.(value.length);
      }
    } catch (h) {
      // Yarım kalan girişi geçerli (kısa) bir giriş olarak kapat → arşiv bozulmaz.
      await giris.bitir().catch(() => {});
      throw h;
    }
    return giris.bitir();
  }

  /** Merkezî dizini + (gerekirse) ZIP64 sonunu yazar, alıcıyı kapatır. Disk alıcısında null, bellekte Blob döner. */
  async bitir() {
    if (this.acik) await this.acik.bitir();
    const mBas = this.konum;
    for (const g of this.merkez) {
      const zip64Ofset = g.ofset >= DORT_GB;
      const ek = zip64Ofset ? 12 : 0;
      const o = new DataView(new ArrayBuffer(46));
      o.setUint32(0, 0x02014b50, true);
      o.setUint16(4, 45, true);
      o.setUint16(6, 45, true);
      o.setUint16(8, g.bayrak, true);
      o.setUint16(10, g.yontem, true);
      o.setUint16(12, g.time, true);
      o.setUint16(14, g.date, true);
      o.setUint32(16, g.crc, true);
      o.setUint32(20, g.csize, true);
      o.setUint32(24, g.usize, true);
      o.setUint16(28, g.adBayt.length, true);
      o.setUint16(30, ek, true);
      o.setUint32(42, zip64Ofset ? DORT_GB : g.ofset, true);
      await this._yaz(new Uint8Array(o.buffer));
      await this._yaz(g.adBayt);
      if (zip64Ofset) {
        const e = new DataView(new ArrayBuffer(12));
        e.setUint16(0, 0x0001, true);
        e.setUint16(2, 8, true);
        e.setBigUint64(4, BigInt(g.ofset), true);
        await this._yaz(new Uint8Array(e.buffer));
      }
    }
    const mBoy = this.konum - mBas;
    const sayi = this.merkez.length;
    const zip64 = sayi >= 0xffff || mBas >= DORT_GB || mBoy >= DORT_GB;
    if (zip64) {
      const z = new DataView(new ArrayBuffer(56));
      z.setUint32(0, 0x06064b50, true);
      z.setBigUint64(4, 44n, true);
      z.setUint16(12, 45, true);
      z.setUint16(14, 45, true);
      z.setBigUint64(24, BigInt(sayi), true);
      z.setBigUint64(32, BigInt(sayi), true);
      z.setBigUint64(40, BigInt(mBoy), true);
      z.setBigUint64(48, BigInt(mBas), true);
      const zKonum = this.konum;
      await this._yaz(new Uint8Array(z.buffer));
      const l = new DataView(new ArrayBuffer(20));
      l.setUint32(0, 0x07064b50, true);
      l.setBigUint64(8, BigInt(zKonum), true);
      l.setUint32(16, 1, true);
      await this._yaz(new Uint8Array(l.buffer));
    }
    const s = new DataView(new ArrayBuffer(22));
    s.setUint32(0, 0x06054b50, true);
    s.setUint16(8, zip64 ? 0xffff : sayi, true);
    s.setUint16(10, zip64 ? 0xffff : sayi, true);
    s.setUint32(12, zip64 ? DORT_GB : mBoy, true);
    s.setUint32(16, zip64 ? DORT_GB : mBas, true);
    await this._yaz(new Uint8Array(s.buffer));
    const boyut = this.konum;
    const sonuc = await this.alici.kapat();
    return { boyut, blob: sonuc };
  }

  async iptal() { await this.alici.iptal(); }
}

/* --------------------------- ZIP OKUYUCU (GitHub zipball'ı için) --------------------------- */

/** Blob olarak verilen ZIP'in merkezî dizinini okur (ZIP64 gerekmez; GitHub zipball'ları standarttır). */
export async function zipGirisleri(blob) {
  const son = Math.min(blob.size, 65557);
  const kuyruk = new Uint8Array(await blob.slice(blob.size - son).arrayBuffer());
  const kv = new DataView(kuyruk.buffer);
  let e = -1;
  for (let i = kuyruk.length - 22; i >= 0; i--) {
    if (kv.getUint32(i, true) === 0x06054b50) { e = i; break; }
  }
  if (e < 0) throw new Error("Geçerli bir ZIP değil.");
  const sayi = kv.getUint16(e + 10, true);
  const mBoy = kv.getUint32(e + 12, true);
  const mBas = kv.getUint32(e + 16, true);
  const merkez = new Uint8Array(await blob.slice(mBas, mBas + mBoy).arrayBuffer());
  const dv = new DataView(merkez.buffer);
  const kod = new TextDecoder("utf-8");
  const girisler = [];
  let k = 0;
  for (let i = 0; i < sayi; i++) {
    if (dv.getUint32(k, true) !== 0x02014b50) break;
    const bayrak = dv.getUint16(k + 8, true);
    const yontem = dv.getUint16(k + 10, true);
    const csize = dv.getUint32(k + 20, true);
    const usize = dv.getUint32(k + 24, true);
    const nl = dv.getUint16(k + 28, true);
    const xl = dv.getUint16(k + 30, true);
    const cl = dv.getUint16(k + 32, true);
    const lo = dv.getUint32(k + 42, true);
    const ad = kod.decode(merkez.subarray(k + 46, k + 46 + nl));
    girisler.push({ ad, yontem, csize, usize, lo, bayrak, dizin: ad.endsWith("/") });
    k += 46 + nl + xl + cl;
  }
  return girisler;
}

export async function zipGirisOku(blob, g) {
  const yerel = new DataView(await blob.slice(g.lo, g.lo + 30).arrayBuffer());
  const bas = g.lo + 30 + yerel.getUint16(26, true) + yerel.getUint16(28, true);
  const ham = blob.slice(bas, bas + g.csize);
  if (g.yontem === 0) return new Uint8Array(await ham.arrayBuffer());
  if (g.yontem === 8) {
    if (typeof DecompressionStream !== "function") throw new Error("Bu tarayıcı ZIP açmayı desteklemiyor.");
    const akis = ham.stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(akis).arrayBuffer());
  }
  throw new Error(`Desteklenmeyen sıkıştırma yöntemi (${g.yontem}).`);
}

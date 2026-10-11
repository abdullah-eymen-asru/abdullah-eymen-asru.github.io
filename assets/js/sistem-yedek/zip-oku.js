/*
 * assets/js/sistem-yedek/zip-oku.js — ZIP OKUYUCU (tarayıcıda, bağımlılıksız, ZIP64 destekli).
 * -----------------------------------------------------------------------
 * NEDEN AYRI? zip-yazici.js içindeki eski okuyucu (zipGirisleri) ZIP64'ü bilmez; oysa aynı dosyadaki YAZICI,
 * 65.535 girişten ya da 4 GB'tan büyük paketlerde ZIP64 yazar. Büyük bir felaket yedeği yazılabiliyor ama geri
 * okunamıyordu (uçtan uca gidiş-dönüş hatası). Bu modül ZIP64 merkezî dizinini ve ek alanlarını çözer.
 *
 * Bellek: dosya Blob.slice() ile okunur (disk), yalnızca istenen giriş açılır. "Saklı" (yöntem 0) girişler kopyasız
 * Blob dilimi olarak döner; "deflate" (yöntem 8) girişler DecompressionStream ile açılır.
 * Güvenlik: yol geçişi ("..", mutlak yol, ters eğik çizgi) olan girişler listeden ÇIKARILIR.
 * -----------------------------------------------------------------------
 */

const DORT_GB = 0xffffffff;
const kod = new TextDecoder("utf-8");

const yolGuvenli = (ad) => ad && !ad.startsWith("/") && !ad.includes("\\") && !ad.split("/").includes("..") && !/[\u0000-\u001f]/.test(ad);

export async function zipAc(blob) {
  if (!blob || blob.size < 22) throw new Error("Geçerli bir ZIP değil (çok küçük).");

  // 1) EOCD + (varsa) ZIP64 konum işaretçisi için son baytlar
  const son = Math.min(blob.size, 65535 + 22 + 20 + 56);
  const kuyruk = new Uint8Array(await blob.slice(blob.size - son).arrayBuffer());
  const kv = new DataView(kuyruk.buffer);
  let e = -1;
  for (let i = kuyruk.length - 22; i >= 0; i--) {
    if (kv.getUint32(i, true) === 0x06054b50) { e = i; break; }
  }
  if (e < 0) throw new Error("Geçerli bir ZIP değil (merkezî dizin bulunamadı).");

  let sayi = kv.getUint16(e + 10, true);
  let mBoy = kv.getUint32(e + 12, true);
  let mBas = kv.getUint32(e + 16, true);

  if (sayi === 0xffff || mBoy === DORT_GB || mBas === DORT_GB) {
    const l = e - 20;
    if (l < 0 || kv.getUint32(l, true) !== 0x07064b50) throw new Error("ZIP64 konum işaretçisi bulunamadı.");
    const z64 = Number(kv.getBigUint64(l + 8, true));
    const z = new DataView(await blob.slice(z64, z64 + 56).arrayBuffer());
    if (z.getUint32(0, true) !== 0x06064b50) throw new Error("ZIP64 sonu bozuk.");
    sayi = Number(z.getBigUint64(32, true));
    mBoy = Number(z.getBigUint64(40, true));
    mBas = Number(z.getBigUint64(48, true));
  }
  if (mBas + mBoy > blob.size) throw new Error("ZIP merkezî dizini dosya sınırını aşıyor (bozuk/eksik indirme).");

  // 2) Merkezî dizin
  const merkez = new Uint8Array(await blob.slice(mBas, mBas + mBoy).arrayBuffer());
  const dv = new DataView(merkez.buffer);
  const girisler = [];
  let k = 0;
  for (let i = 0; i < sayi; i++) {
    if (k + 46 > merkez.length || dv.getUint32(k, true) !== 0x02014b50) break;
    const bayrak = dv.getUint16(k + 8, true);
    const yontem = dv.getUint16(k + 10, true);
    let csize = dv.getUint32(k + 20, true);
    let usize = dv.getUint32(k + 24, true);
    const nl = dv.getUint16(k + 28, true);
    const xl = dv.getUint16(k + 30, true);
    const cl = dv.getUint16(k + 32, true);
    let lo = dv.getUint32(k + 42, true);
    const ad = kod.decode(merkez.subarray(k + 46, k + 46 + nl));

    // ZIP64 ek alanı (0x0001): yalnızca 0xFFFFFFFF olan alanlar, bu SIRAYLA: usize, csize, ofset
    if (usize === DORT_GB || csize === DORT_GB || lo === DORT_GB) {
      let x = k + 46 + nl;
      const xson = x + xl;
      while (x + 4 <= xson) {
        const id = dv.getUint16(x, true);
        const boy = dv.getUint16(x + 2, true);
        if (id === 0x0001) {
          let p = x + 4;
          if (usize === DORT_GB && p + 8 <= x + 4 + boy) { usize = Number(dv.getBigUint64(p, true)); p += 8; }
          if (csize === DORT_GB && p + 8 <= x + 4 + boy) { csize = Number(dv.getBigUint64(p, true)); p += 8; }
          if (lo === DORT_GB && p + 8 <= x + 4 + boy) { lo = Number(dv.getBigUint64(p, true)); p += 8; }
          break;
        }
        x += 4 + boy;
      }
    }
    k += 46 + nl + xl + cl;
    if (!yolGuvenli(ad)) continue; // yol geçişi / garip ad: yok say
    girisler.push({ ad, yontem, csize, usize, lo, bayrak, dizin: ad.endsWith("/") });
  }

  /** Girişi Blob olarak döndürür. Saklı: disk dilimi (RAM'e kopyalanmaz). Deflate: açılmış Blob (RAM). */
  async function oku(g) {
    const yerel = new DataView(await blob.slice(g.lo, g.lo + 30).arrayBuffer());
    if (yerel.getUint32(0, true) !== 0x04034b50) throw new Error(`Bozuk yerel başlık: ${g.ad}`);
    const bas = g.lo + 30 + yerel.getUint16(26, true) + yerel.getUint16(28, true);
    const ham = blob.slice(bas, bas + g.csize);
    if (g.yontem === 0) return ham;
    if (g.yontem === 8) {
      if (typeof DecompressionStream !== "function") throw new Error("Bu tarayıcı ZIP açmayı desteklemiyor (DecompressionStream yok).");
      return new Response(ham.stream().pipeThrough(new DecompressionStream("deflate-raw"))).blob();
    }
    throw new Error(`Desteklenmeyen sıkıştırma yöntemi (${g.yontem}): ${g.ad}`);
  }

  return {
    girisler,
    oku,
    bul: (ad) => girisler.find((g) => g.ad === ad),
    async metin(g) { return (await oku(g)).text(); },
  };
}

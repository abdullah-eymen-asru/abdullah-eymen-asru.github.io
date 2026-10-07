/*
 * assets/js/notlar/ice-aktar/zip-oku.js
 * -----------------------------------------------------------------------
 * Bağımlılıksız ZIP OKUYUCU (tarayıcıda; DecompressionStream "deflate-raw").
 * İçeri aktarmada hem dışa aktarılan ZIP paketlerini hem de .docx dosyalarını (docx = ZIP) açmak için.
 * Sınırlar: ZIP64 yok; tek giriş ≤ 40 MB, toplam ≤ 250 MB açılmış boyut (zip bombasına karşı).
 * -----------------------------------------------------------------------
 */
const GIRIS_UST = 40 * 1024 * 1024;
const TOPLAM_UST = 250 * 1024 * 1024;

async function sisir(u8) {
  if (typeof DecompressionStream !== "function") throw new Error("Bu tarayıcı ZIP açmayı desteklemiyor (DecompressionStream yok).");
  const akis = new Blob([u8]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(akis).arrayBuffer());
}

export async function zipOku(arrayBuffer) {
  const u8 = new Uint8Array(arrayBuffer);
  const dv = new DataView(arrayBuffer);
  let e = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      e = i;
      break;
    }
  }
  if (e < 0) throw new Error("Geçerli bir ZIP/DOCX dosyası değil.");
  const sayi = dv.getUint16(e + 10, true);
  let konum = dv.getUint32(e + 16, true);
  const kod = new TextDecoder("utf-8");
  const girisler = [];
  for (let i = 0; i < sayi; i++) {
    if (dv.getUint32(konum, true) !== 0x02014b50) break;
    const yontem = dv.getUint16(konum + 10, true);
    const csize = dv.getUint32(konum + 20, true);
    const usize = dv.getUint32(konum + 24, true);
    const nl = dv.getUint16(konum + 28, true);
    const xl = dv.getUint16(konum + 30, true);
    const cl = dv.getUint16(konum + 32, true);
    const lo = dv.getUint32(konum + 42, true);
    const ad = kod.decode(u8.subarray(konum + 46, konum + 46 + nl));
    girisler.push({ ad, yontem, csize, usize, lo, dizin: ad.endsWith("/") });
    konum += 46 + nl + xl + cl;
  }
  let toplam = 0;
  const oku = async (g) => {
    if (g.usize > GIRIS_UST) throw new Error(`“${g.ad}” çok büyük (40 MB üstü).`);
    toplam += g.usize;
    if (toplam > TOPLAM_UST) throw new Error("Arşivin açılmış boyutu sınırı aşıyor.");
    const bas = g.lo + 30 + dv.getUint16(g.lo + 26, true) + dv.getUint16(g.lo + 28, true);
    const ham = u8.subarray(bas, bas + g.csize);
    if (g.yontem === 0) return ham.slice();
    if (g.yontem === 8) return sisir(ham);
    throw new Error(`“${g.ad}” desteklenmeyen sıkıştırma yöntemi (${g.yontem}).`);
  };
  return { girisler, oku, metin: async (g) => kod.decode(await oku(g)) };
}

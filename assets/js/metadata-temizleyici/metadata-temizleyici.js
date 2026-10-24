/*
 * assets/js/metadata-temizleyici/motor.js — EVRENSEL METADATA TEMİZLEYİCİ MOTORU (istemci taraflı, sunucuya HİÇBİR şey gitmez).
 * -----------------------------------------------------------------------------------------------------------------------------
 * SIFIR-RAM / AKIŞ MİMARİSİ: büyük medya dosyaları (100 MB – 4 GB) belleğe OKUNMAZ. Yalnızca küçük başlık/kutu bölgeleri okunur;
 * çıktı, `File.slice()` parçalarından ve yeniden yazılmış küçük tamponlardan oluşan bir Blob olarak BİRLEŞTİRİLİR (tarayıcı bunu diske
 * yaslı tutar; bayt kopyası/ArrayBuffer yoktur). Bu yöntem Streams API/OPFS'e ihtiyaç duymadan çalışır ve Safari/iOS'ta da geçerlidir.
 *
 *   JPEG  : SOS'a kadar APPn/COM bölümleri taranır; EXIF/XMP/IPTC/Photoshop/yorum atılır, JFIF + Adobe + ICC profili korunur. Piksel verisi dokunulmaz.
 *   PNG   : parça (chunk) yürüyüşü; tEXt/zTXt/iTXt/eXIf/tIME/tXMP atılır (CRC'ler parçayla gelir, yeniden hesap gerekmez).
 *   WebP  : RIFF parçaları; EXIF/XMP atılır, RIFF boyutu + VP8X bayrakları düzeltilir.
 *   MP4/MOV/M4A/M4V/3GP : üst düzey kutular; udta/meta/uuid kutuları AYNI BOYUTTA "free" kutusuna çevrilir (yer değiştirmez → stco/co64
 *                  ofsetleri bozulmaz), mvhd/tkhd/mdhd oluşturma-değiştirme zamanları sıfırlanır. mdat'a hiç dokunulmaz.
 *   OOXML (docx/xlsx/pptx) / ODF (odt/ods/odp) / ZIP : AKIŞLI ZIP yeniden yazımı — yalnızca merkezi dizin + küçük XML girdileri okunur, diğer girdiler
 *                  sıkıştırılmış haliyle slice edilir (yeniden sıkıştırma yok); docProps/meta.xml boşaltılır, zaman damgaları/extra alanları sabitlenir/silinir.
 *   PDF   : pdf-lib (belleğe yüklenir → BELLEK_SINIRI) — Info sözlüğü ve XMP akışı kaldırılır.
 * DÜRÜST SINIRLAR: Belge İÇERİĞİ (görünen metin, yorum yazarları, izlenen değişiklikler, görsel içindeki yüz/konum) temizlenmez; yalnızca
 * dosya üst verisi. Bellekte çalışan biçimlerde sınırı aşan dosyalar için yerel komut satırı yönergesi (CLI_YONERGESI) gösterilir.
 */
export const BELLEK_SINIRI = 100 * 1024 * 1024;           // yalnızca pdf-lib yolu
export const AKIS_SINIRI = 4 * 1024 * 1024 * 1024;        // akış yolları (File.slice) — pratik üst sınır
export const OKUMA_PARCASI = 8 * 1024 * 1024;

const u8 = async (blob) => new Uint8Array(await blob.arrayBuffer());
const dv = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const ascii = (b, o, n) => String.fromCharCode(...b.subarray(o, o + n));
const uzanti = (ad) => (String(ad).toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || "";

export const CLI_YONERGESI = {
  medya: "Çok büyük medya için yerel araç: exiftool -all= -overwrite_original DOSYA   |   ffmpeg -i GIRIS -map_metadata -1 -c copy CIKIS",
  belge: "Çok büyük belge/ZIP için yerel araç: exiftool -all= DOSYA   |   qpdf --linearize --object-streams=generate GIRIS CIKIS (PDF)   |   mat2 DOSYA",
};

export function turTespit(ad, bas = new Uint8Array(0)) {
  const u = uzanti(ad);
  if (bas[0] === 0xff && bas[1] === 0xd8) return "jpeg";
  if (bas[0] === 0x89 && ascii(bas, 1, 3) === "PNG") return "png";
  if (ascii(bas, 0, 4) === "RIFF" && ascii(bas, 8, 4) === "WEBP") return "webp";
  if (bas.length >= 12 && ascii(bas, 4, 4) === "ftyp") return "iso";
  if (ascii(bas, 0, 5) === "%PDF-") return "pdf";
  if (bas[0] === 0x50 && bas[1] === 0x4b) {
    if (["docx", "xlsx", "pptx", "dotx", "xltx", "potx", "docm", "xlsm", "pptm"].includes(u)) return "ooxml";
    if (["odt", "ods", "odp", "odg", "ott", "ots"].includes(u)) return "odf";
    return "zip";
  }
  return null;
}

/* ------------------------------------------------------------------ JPEG */
export async function jpegTemizle(file) {
  const bas = await u8(file.slice(0, Math.min(file.size, OKUMA_PARCASI)));
  if (bas[0] !== 0xff || bas[1] !== 0xd8) throw new Error("Geçerli bir JPEG değil.");
  const parcalar = [bas.slice(0, 2)];
  let o = 2, atilan = 0, sos = -1;
  while (o + 4 <= bas.length) {
    if (bas[o] !== 0xff) throw new Error("JPEG bölüm yapısı bozuk.");
    const m = bas[o + 1];
    if (m === 0xff) { o += 1; continue; }                                  // dolgu baytı
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { parcalar.push(bas.slice(o, o + 2)); o += 2; continue; }
    if (m === 0xda) { sos = o; break; }                                    // piksel verisi başlıyor
    const uz = (bas[o + 2] << 8) | bas[o + 3];
    if (uz < 2 || o + 2 + uz > bas.length) throw new Error("JPEG başlığı beklenenden büyük ya da bozuk.");
    const govde = bas.subarray(o + 4, o + 2 + uz);
    const tut = m === 0xe0 || m === 0xee || (m === 0xe2 && ascii(govde, 0, 11) === "ICC_PROFILE") || !((m >= 0xe1 && m <= 0xef) || m === 0xfe);
    if (tut) parcalar.push(bas.slice(o, o + 2 + uz)); else atilan += 2 + uz;
    o += 2 + uz;
  }
  if (sos < 0) throw new Error("JPEG'de piksel verisi başlangıcı (SOS) bulunamadı.");
  parcalar.push(file.slice(sos));                                          // piksel verisi: slice (RAM'e okunmaz)
  return { blob: new Blob(parcalar, { type: "image/jpeg" }), ozet: [`${atilan.toLocaleString("tr-TR")} bayt üst veri (EXIF/XMP/IPTC/yorum) atıldı`] };
}

/* ------------------------------------------------------------------ PNG */
const PNG_ATILAN = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME", "tXMP", "dSIG"]);
export async function pngTemizle(file) {
  const imza = await u8(file.slice(0, 8));
  if (imza[0] !== 0x89 || ascii(imza, 1, 3) !== "PNG") throw new Error("Geçerli bir PNG değil.");
  const parcalar = []; let tutBas = 0, o = 8, atilan = 0, sayi = 0;
  while (o + 12 <= file.size) {
    const bas = await u8(file.slice(o, o + 8));
    const uz = dv(bas).getUint32(0), tip = ascii(bas, 4, 4), toplam = 12 + uz;
    if (o + toplam > file.size) throw new Error("PNG parça boyutu dosyayı aşıyor (bozuk).");
    if (PNG_ATILAN.has(tip)) { if (o > tutBas) parcalar.push(file.slice(tutBas, o)); tutBas = o + toplam; atilan += toplam; sayi += 1; }
    o += toplam;
    if (tip === "IEND") break;
  }
  if (tutBas < file.size) parcalar.push(file.slice(tutBas));
  return { blob: new Blob(parcalar, { type: "image/png" }), ozet: [`${sayi} metin/EXIF/zaman parçası (${atilan.toLocaleString("tr-TR")} bayt) atıldı`] };
}

/* ------------------------------------------------------------------ WebP */
export async function webpTemizle(file) {
  const h = await u8(file.slice(0, 12));
  if (ascii(h, 0, 4) !== "RIFF" || ascii(h, 8, 4) !== "WEBP") throw new Error("Geçerli bir WebP değil.");
  const govdeParcalari = []; let o = 12, atilan = 0, vp8x = null;
  const bitis = Math.min(file.size, 8 + dv(h).getUint32(4, true));
  while (o + 8 <= bitis) {
    const b = await u8(file.slice(o, o + 8));
    const tip = ascii(b, 0, 4), uz = dv(b).getUint32(4, true), toplam = 8 + uz + (uz & 1);
    if (tip === "EXIF" || tip === "XMP ") atilan += toplam;
    else if (tip === "VP8X") { const t = await u8(file.slice(o, o + 8 + uz)); t[8] &= ~0x0c; govdeParcalari.push(t); vp8x = true; }  // EXIF(0x08) + XMP(0x04) bayrakları
    else govdeParcalari.push(file.slice(o, Math.min(o + toplam, file.size)));
    o += toplam;
  }
  const govdeBoyut = govdeParcalari.reduce((n, p) => n + (p.size ?? p.byteLength), 0);
  const ust = new Uint8Array(12); ust.set(h.subarray(0, 12));
  dv(ust).setUint32(4, 4 + govdeBoyut, true);
  return { blob: new Blob([ust, ...govdeParcalari], { type: "image/webp" }), ozet: [`${atilan} bayt EXIF/XMP atıldı${vp8x ? "" : ""}`] };
}

/* ------------------------------------------------------------------ MP4 / MOV (ISO BMFF) */
const KUTU_KAPLARI = new Set(["moov", "trak", "mdia", "minf", "stbl", "edts", "dinf"]);   // içine inilen kaplar
function zamanSifirla(t, o, tip) {                                                       // t: moov tamponu, o: kutu BAŞLANGICI
  const surum = t[o + 8];
  const kaydir = o + 12;                                                                 // sürüm/bayrak (4) sonrası
  const n = surum === 1 ? 16 : 8;                                                        // oluşturma + değiştirme
  t.fill(0, kaydir, kaydir + n);
  return tip;
}
function kutuGez(t, bas, bit, sonuc) {
  let o = bas;
  while (o + 8 <= bit) {
    let uz = dv(t).getUint32(o), basBoyut = 8;
    const tip = ascii(t, o + 4, 4);
    if (uz === 1) { uz = Number(dv(t).getBigUint64(o + 8)); basBoyut = 16; } else if (uz === 0) uz = bit - o;
    if (uz < basBoyut || o + uz > bit) throw new Error("MP4 kutu yapısı bozuk.");
    if (tip === "udta" || tip === "meta" || tip === "uuid") {
      t.fill(0, o + basBoyut, o + uz);                                                   // yük sıfırlanır; tür "free" olur: boyut AYNI
      t.set([0x66, 0x72, 0x65, 0x65], o + 4); sonuc.kutu += 1; sonuc.bayt += uz;
    } else if (tip === "mvhd" || tip === "tkhd" || tip === "mdhd") { zamanSifirla(t, o, tip); sonuc.zaman += 1; }
    else if (KUTU_KAPLARI.has(tip)) kutuGez(t, o + basBoyut, o + uz, sonuc);
    o += uz;
  }
}
export async function isoTemizle(file) {
  const parcalar = []; let o = 0, tutBas = 0; const sonuc = { kutu: 0, bayt: 0, zaman: 0 };
  while (o + 8 <= file.size) {
    const b = await u8(file.slice(o, o + 16));
    let uz = dv(b).getUint32(0), basBoyut = 8; const tip = ascii(b, 4, 4);
    if (uz === 1) { uz = Number(dv(b).getBigUint64(8)); basBoyut = 16; } else if (uz === 0) uz = file.size - o;
    if (uz < basBoyut || o + uz > file.size) throw new Error("MP4 üst düzey kutu boyutu bozuk.");
    if (tip === "moov") {
      if (uz > 512 * 1024 * 1024) throw new Error("moov kutusu çok büyük.");
      const t = await u8(file.slice(o, o + uz));
      kutuGez(t, basBoyut, uz, sonuc);
      if (o > tutBas) parcalar.push(file.slice(tutBas, o));
      parcalar.push(t); tutBas = o + uz;
    } else if (tip === "meta" || tip === "uuid" || tip === "udta") {
      if (uz > 64 * 1024 * 1024) throw new Error(`${tip} kutusu beklenmedik büyüklükte.`);
      const t = await u8(file.slice(o, o + uz)); t.fill(0, basBoyut); t.set([0x66, 0x72, 0x65, 0x65], 4);
      if (o > tutBas) parcalar.push(file.slice(tutBas, o));
      parcalar.push(t); tutBas = o + uz; sonuc.kutu += 1; sonuc.bayt += uz;
    }
    o += uz;
  }
  if (tutBas < file.size) parcalar.push(file.slice(tutBas));
  return { blob: new Blob(parcalar, { type: file.type || "video/mp4" }), ozet: [`${sonuc.kutu} üst veri kutusu (${sonuc.bayt.toLocaleString("tr-TR")} bayt) boşaltıldı`, `${sonuc.zaman} zaman damgası sıfırlandı`] };
}

/* ------------------------------------------------------------------ OOXML / ODF / ZIP (AKIŞLI yeniden yazım) */
/*
 * ZIP'in yalnızca MERKEZİ DİZİNİ (central directory) ve değişecek küçük XML girdileri belleğe alınır; diğer tüm girdiler (yerel başlık hariç)
 * File.slice() ile OLDUĞU GİBİ (sıkıştırılmış baytlar, yeniden sıkıştırma yok) çıktı Blob'una eklenir. Böylece 4 GB'a kadar arşivler RAM'e
 * okunmadan temizlenir. Yapılanlar: (1) docProps/core|app|custom.xml ya da ODF meta.xml boşaltılır, küçük resimler kaldırılır;
 * (2) tüm girdilerin zaman damgası 1980-01-01'e sabitlenir; (3) yerel/merkezi "extra" alanları (genişletilmiş zaman, NTFS, UID/GID) ve arşiv/girdi
 * yorumları silinir (şifreli girdilerin AES extra'sı korunur). ZIP64 (4 GB üstü) desteklenmez → CLI yönergesi.
 */
const OOXML_CORE = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"></cp:coreProperties>';
const OOXML_APP = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"></Properties>';
const OOXML_CUSTOM = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"></Properties>';
const ODF_META = '<?xml version="1.0" encoding="UTF-8"?>\n<office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" office:version="1.2"><office:meta/></office:document-meta>';
const DOS_ZAMAN = 0, DOS_TARIH = 0x0021;                                   // 1980-01-01 00:00:00
const enc = new TextEncoder(), dec = new TextDecoder("utf-8");

const CRC_TABLO = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(u) { let c = 0xffffffff; for (let i = 0; i < u.length; i++) c = CRC_TABLO[(c ^ u[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

async function inflateRaw(u) {
  if (typeof DecompressionStream === "undefined") throw new Error("Bu tarayıcı DecompressionStream desteklemiyor.");
  return new Uint8Array(await new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
}

async function zipMerkeziDizin(file) {
  const kuyrukBoy = Math.min(file.size, 66000);
  const k = await u8(file.slice(file.size - kuyrukBoy));
  let e = -1;
  for (let i = k.length - 22; i >= 0; i--) if (k[i] === 0x50 && k[i + 1] === 0x4b && k[i + 2] === 5 && k[i + 3] === 6) { e = i; break; }
  if (e < 0) throw new Error("ZIP sonu (EOCD) bulunamadı; dosya bozuk ya da ZIP değil.");
  if (e >= 20 && k[e - 20] === 0x50 && k[e - 19] === 0x4b && k[e - 18] === 6 && k[e - 17] === 7) throw new Error(`ZIP64 (4 GB üstü) arşivler desteklenmiyor. ${CLI_YONERGESI.belge}`);
  const d = dv(k);
  const sayi = d.getUint16(e + 10, true), cdBoy = d.getUint32(e + 12, true), cdOfs = d.getUint32(e + 16, true);
  if (sayi === 0xffff || cdBoy === 0xffffffff || cdOfs === 0xffffffff) throw new Error(`ZIP64 arşivler desteklenmiyor. ${CLI_YONERGESI.belge}`);
  if (cdBoy > 64 * 1024 * 1024) throw new Error("ZIP merkezi dizini beklenmedik büyüklükte.");
  const cd = await u8(file.slice(cdOfs, cdOfs + cdBoy));
  const cdv = dv(cd), girdiler = [];
  let o = 0;
  for (let i = 0; i < sayi; i++) {
    if (o + 46 > cd.length || cdv.getUint32(o, true) !== 0x02014b50) throw new Error("ZIP merkezi dizini bozuk.");
    const nL = cdv.getUint16(o + 28, true), eL = cdv.getUint16(o + 30, true), cL = cdv.getUint16(o + 32, true);
    girdiler.push({
      surumYapan: cdv.getUint16(o + 4, true), surumGerek: cdv.getUint16(o + 6, true), bayrak: cdv.getUint16(o + 8, true), yontem: cdv.getUint16(o + 10, true),
      crc: cdv.getUint32(o + 16, true), csize: cdv.getUint32(o + 20, true), usize: cdv.getUint32(o + 24, true),
      disk: cdv.getUint16(o + 34, true), icAttr: cdv.getUint16(o + 36, true), disAttr: cdv.getUint32(o + 38, true), ofs: cdv.getUint32(o + 42, true),
      adBayt: cd.slice(o + 46, o + 46 + nL), ad: dec.decode(cd.subarray(o + 46, o + 46 + nL)),
      extraBayt: cd.slice(o + 46 + nL, o + 46 + nL + eL),
    });
    o += 46 + nL + eL + cL;
  }
  return { girdiler, cdOfs };
}

const yerelBaslik = (g, crc, csize, usize, yontem, bayrak) => {   // 30 bayt + ad
  const b = new Uint8Array(30 + g.adBayt.length), v = dv(b);
  v.setUint32(0, 0x04034b50, true); v.setUint16(4, g.surumGerek || 20, true); v.setUint16(6, bayrak, true); v.setUint16(8, yontem, true);
  v.setUint16(10, DOS_ZAMAN, true); v.setUint16(12, DOS_TARIH, true); v.setUint32(14, crc, true); v.setUint32(18, csize, true); v.setUint32(22, usize, true);
  v.setUint16(26, g.adBayt.length, true); v.setUint16(28, 0, true); b.set(g.adBayt, 30);
  return b;
};

export async function zipAkisTemizle(file, tur) {
  const { girdiler, cdOfs } = await zipMerkeziDizin(file);
  const ozet = [], yeni = [];                                              // yeni: { g, ofs, crc, csize, usize, yontem, bayrak }
  const parcalar = []; let ofs = 0;
  const ekle = (p, boy) => { parcalar.push(p); ofs += boy; };
  const degisenIcerik = (ad) => {                                           // → string | null(= dokunma) | false(= girdiyi at)
    if (tur === "ooxml") {
      if (ad === "docProps/core.xml") return OOXML_CORE;
      if (ad === "docProps/app.xml") return OOXML_APP;
      if (ad === "docProps/custom.xml") return OOXML_CUSTOM;
      if (/^docProps\/thumbnail\./i.test(ad)) return false;
    } else if (tur === "odf") {
      if (ad === "meta.xml") return ODF_META;
      if (/^Thumbnails\//i.test(ad)) return false;
    }
    return null;
  };
  let atilan = 0, bosaltilan = 0;
  const sirali = [...girdiler].sort((a, b) => a.ofs - b.ofs);              // fiziksel sıra (ODF: mimetype ilk kalır)
  for (const g of sirali) {
    if (g.bayrak & 1 && degisenIcerik(g.ad) !== null) throw new Error("Şifreli ZIP girdisi: üst veri güvenle değiştirilemez.");
    const d = degisenIcerik(g.ad);
    if (d === false) { atilan += 1; continue; }
    const rel = tur === "ooxml" && g.ad === "_rels/.rels", mf = tur === "odf" && g.ad === "META-INF/manifest.xml";
    let yeniIcerik = typeof d === "string" ? enc.encode(d) : null;
    if (!yeniIcerik && (rel || mf) && !(g.bayrak & 1) && (g.yontem === 0 || g.yontem === 8) && g.usize < 8 * 1024 * 1024) {
      const yl = await u8(file.slice(g.ofs, g.ofs + 30));
      const veriOfs = g.ofs + 30 + dv(yl).getUint16(26, true) + dv(yl).getUint16(28, true);
      const ham = await u8(file.slice(veriOfs, veriOfs + g.csize));
      const metin = dec.decode(g.yontem === 8 ? await inflateRaw(ham) : ham);
      const sonuc = rel ? metin.replace(/<Relationship\b[^>]*thumbnail[^>]*\/>/gi, "") : metin.replace(/<manifest:file-entry\b[^>]*Thumbnails\/[^>]*\/>/gi, "");
      if (sonuc !== metin) yeniIcerik = enc.encode(sonuc);
    }
    if (yeniIcerik) {                                                        // küçük, yeniden yazılan girdi (STORE)
      const crc = crc32(yeniIcerik), h = yerelBaslik(g, crc, yeniIcerik.length, yeniIcerik.length, 0, g.bayrak & 0x0800);
      yeni.push({ g, ofs, crc, csize: yeniIcerik.length, usize: yeniIcerik.length, yontem: 0, bayrak: g.bayrak & 0x0800 });
      ekle(h, h.length); ekle(yeniIcerik, yeniIcerik.length); bosaltilan += 1;
    } else {                                                                 // dokunulmayan girdi: başlık yeniden yazılır (zaman/extra), veri slice
      const yl = await u8(file.slice(g.ofs, g.ofs + 30));
      const yv = dv(yl);
      if (yv.getUint32(0, true) !== 0x04034b50) throw new Error(`ZIP yerel başlığı bozuk (${g.ad}).`);
      const nL = yv.getUint16(26, true), eL = yv.getUint16(28, true);
      const sifreli = !!(g.bayrak & 1);
      const veriBas = g.ofs + 30 + nL + eL;
      let veriBit = veriBas + g.csize;
      if (g.bayrak & 8) {                                                    // veri tanımlayıcı (data descriptor)
        const t = await u8(file.slice(veriBit, veriBit + 4));
        veriBit += dv(t).getUint32(0, true) === 0x08074b50 ? 16 : 12;
      }
      if (veriBit > cdOfs) throw new Error(`ZIP girdi boyutu merkezi dizinle tutarsız (${g.ad}).`);
      const h = new Uint8Array(30 + g.adBayt.length); h.set(yl.subarray(0, 30)); h.set(g.adBayt, 30);
      const hv = dv(h); hv.setUint16(10, DOS_ZAMAN, true); hv.setUint16(12, DOS_TARIH, true);
      let ekstra = new Uint8Array(0);
      if (sifreli) ekstra = (await u8(file.slice(g.ofs + 30 + nL, g.ofs + 30 + nL + eL)));   // AES extra'sı korunur
      hv.setUint16(28, ekstra.length, true);
      yeni.push({ g, ofs, crc: g.crc, csize: g.csize, usize: g.usize, yontem: g.yontem, bayrak: g.bayrak, ekstra: sifreli ? g.extraBayt : null });
      ekle(h, h.length); if (ekstra.length) ekle(ekstra, ekstra.length);
      ekle(file.slice(veriBas, veriBit), veriBit - veriBas);
    }
  }
  const cdBas = ofs;
  for (const y of yeni) {                                                     // yeni merkezi dizin
    const g = y.g, ek = y.ekstra || new Uint8Array(0), b = new Uint8Array(46 + g.adBayt.length + ek.length), v = dv(b);
    v.setUint32(0, 0x02014b50, true); v.setUint16(4, g.surumYapan, true); v.setUint16(6, g.surumGerek, true); v.setUint16(8, y.bayrak, true); v.setUint16(10, y.yontem, true);
    v.setUint16(12, DOS_ZAMAN, true); v.setUint16(14, DOS_TARIH, true); v.setUint32(16, y.crc, true); v.setUint32(20, y.csize, true); v.setUint32(24, y.usize, true);
    v.setUint16(28, g.adBayt.length, true); v.setUint16(30, ek.length, true); v.setUint16(32, 0, true); v.setUint16(34, 0, true);
    v.setUint16(36, g.icAttr, true); v.setUint32(38, g.disAttr, true); v.setUint32(42, y.ofs, true);
    b.set(g.adBayt, 46); b.set(ek, 46 + g.adBayt.length);
    ekle(b, b.length);
  }
  const cdBoy = ofs - cdBas;
  if (ofs + 22 > 0xffffffff) throw new Error(`Çıktı 4 GB'ı aşıyor (ZIP64 gerekir). ${CLI_YONERGESI.belge}`);
  const e = new Uint8Array(22), ev = dv(e);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, yeni.length, true); ev.setUint16(10, yeni.length, true); ev.setUint32(12, cdBoy, true); ev.setUint32(16, cdBas, true);
  ekle(e, 22);
  if (bosaltilan) ozet.push(`${bosaltilan} üst veri girdisi yeniden yazıldı (core/app/custom/meta, .rels, manifest)`);
  if (atilan) ozet.push(`${atilan} küçük resim/önizleme dosyası kaldırıldı`);
  ozet.push("tüm girdi zaman damgaları 1980-01-01'e sabitlendi; extra alanları (zaman, UID/GID) ve arşiv yorumu silindi");
  return { blob: new Blob(parcalar, { type: file.type || "application/zip" }), ozet };
}

/* ------------------------------------------------------------------ PDF (pdf-lib; bellekte) */
export async function pdfTemizle(file, PDFLib) {
  if (!PDFLib?.PDFDocument) throw new Error("pdf-lib yüklenemedi.");
  const { PDFDocument, PDFName } = PDFLib;
  const doc = await PDFDocument.load(await file.arrayBuffer(), { updateMetadata: false, ignoreEncryption: false });
  const ozet = [];
  const trailer = doc.context.trailerInfo;
  if (trailer?.Info) { try { doc.context.delete(trailer.Info); } catch { /* yok say */ } trailer.Info = undefined; ozet.push("Info sözlüğü (başlık, yazar, üretici, tarihler) kaldırıldı"); }
  if (doc.catalog.has(PDFName.of("Metadata"))) { doc.catalog.delete(PDFName.of("Metadata")); ozet.push("XMP üst veri akışı kaldırıldı"); }
  const bytes = await doc.save({ useObjectStreams: false });
  return { blob: new Blob([bytes], { type: "application/pdf" }), ozet };
}

/* ------------------------------------------------------------------ ana giriş */
/**
 * @param {File} file
 * @param {{PDFLib?: any}} kutuphaneler  (yalnızca PDF bellek yolu için, tembel yüklenmiş)
 * @returns {Promise<{blob:Blob, ad:string, tur:string, yontem:"akis"|"bellek", ozet:string[]}>}
 */
export async function metadataTemizle(file, kutuphaneler = {}) {
  const bas = await u8(file.slice(0, 16));
  const tur = turTespit(file.name, bas);
  if (!tur) throw new Error("Desteklenmeyen biçim. (JPEG, PNG, WebP, MP4/MOV/M4A, DOCX/XLSX/PPTX, ODT/ODS/ODP, PDF, ZIP)");
  const akis = ["jpeg", "png", "webp", "iso", "ooxml", "odf", "zip"].includes(tur);
  if (akis && file.size > AKIS_SINIRI) throw new Error(`Dosya ${AKIS_SINIRI / 1024 ** 3} GB'ı aşıyor. ${CLI_YONERGESI.medya}`);
  if (!akis && file.size > BELLEK_SINIRI) throw new Error(`Bu biçim tarayıcı belleğinde işlenir ve ${BELLEK_SINIRI / 1024 ** 2} MB ile sınırlıdır. ${CLI_YONERGESI.belge}`);
  const r = tur === "jpeg" ? await jpegTemizle(file) : tur === "png" ? await pngTemizle(file) : tur === "webp" ? await webpTemizle(file)
    : tur === "iso" ? await isoTemizle(file) : tur === "pdf" ? await pdfTemizle(file, kutuphaneler.PDFLib) : await zipAkisTemizle(file, tur);
  const nokta = file.name.lastIndexOf(".");
  const ad = nokta > 0 ? `${file.name.slice(0, nokta)}.temiz${file.name.slice(nokta)}` : `${file.name}.temiz`;
  return { blob: r.blob, ad, tur, yontem: akis ? "akis" : "bellek", ozet: r.ozet };
}

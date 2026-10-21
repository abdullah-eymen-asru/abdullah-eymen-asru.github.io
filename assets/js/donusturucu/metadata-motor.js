/*
 * assets/js/donusturucu/metadata-motor.js — EVRENSEL METADATA TEMİZLEYİCİ MOTORU (istemci taraflı, sunucuya HİÇBİR şey gitmez).
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
 *   OOXML (docx/xlsx/pptx) / ODF (odt/ods/odp) / ZIP : JSZip (belleğe yüklenir → BELLEK_SINIRI) — docProps / meta.xml boşaltılır, küçük
 *                  resim ve ZIP girdi zaman damgaları sabitlenir.
 *   PDF   : pdf-lib (belleğe yüklenir → BELLEK_SINIRI) — Info sözlüğü ve XMP akışı kaldırılır.
 * DÜRÜST SINIRLAR: Belge İÇERİĞİ (görünen metin, yorum yazarları, izlenen değişiklikler, görsel içindeki yüz/konum) temizlenmez; yalnızca
 * dosya üst verisi. Bellekte çalışan biçimlerde sınırı aşan dosyalar için yerel komut satırı yönergesi (CLI_YONERGESI) gösterilir.
 */
export const BELLEK_SINIRI = 100 * 1024 * 1024;           // JSZip / pdf-lib yolları
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

/* ------------------------------------------------------------------ OOXML / ODF / ZIP (JSZip; bellekte) */
const OOXML_CORE = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"></cp:coreProperties>';
const OOXML_APP = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"></Properties>';
const OOXML_CUSTOM = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"></Properties>';
const ODF_META = '<?xml version="1.0" encoding="UTF-8"?>\n<office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" office:version="1.2"><office:meta/></office:document-meta>';
const SABIT_TARIH = () => new Date(Date.UTC(1980, 0, 1));

export async function zipTemizle(file, tur, JSZip) {
  if (!JSZip) throw new Error("JSZip yüklenemedi.");
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const ozet = [];
  if (tur === "ooxml") {
    if (zip.file("docProps/core.xml")) { zip.file("docProps/core.xml", OOXML_CORE); ozet.push("core.xml (yazar, son değiştiren, tarihler) boşaltıldı"); }
    if (zip.file("docProps/app.xml")) { zip.file("docProps/app.xml", OOXML_APP); ozet.push("app.xml (şirket, yönetici, şablon, süre) boşaltıldı"); }
    if (zip.file("docProps/custom.xml")) { zip.file("docProps/custom.xml", OOXML_CUSTOM); ozet.push("özel özellikler boşaltıldı"); }
    const kucuk = Object.keys(zip.files).filter((p) => /^docProps\/thumbnail\./i.test(p));
    if (kucuk.length) {
      for (const p of kucuk) zip.remove(p);
      const rel = zip.file("_rels/.rels");
      if (rel) zip.file("_rels/.rels", (await rel.async("string")).replace(/<Relationship\b[^>]*thumbnail[^>]*\/>/gi, ""));
      ozet.push("küçük resim (önizleme) kaldırıldı");
    }
  } else if (tur === "odf") {
    if (zip.file("meta.xml")) { zip.file("meta.xml", ODF_META); ozet.push("meta.xml (yazar, tarihler, istatistik) boşaltıldı"); }
    const kucuk = Object.keys(zip.files).filter((p) => /^Thumbnails\//i.test(p));
    if (kucuk.length) {
      for (const p of kucuk) zip.remove(p);
      const mf = zip.file("META-INF/manifest.xml");
      if (mf) zip.file("META-INF/manifest.xml", (await mf.async("string")).replace(/<manifest:file-entry\b[^>]*Thumbnails\/[^>]*\/>/gi, ""));
      ozet.push("küçük resim kaldırıldı");
    }
  }
  const t = SABIT_TARIH();
  zip.forEach((_, f) => { f.date = t; });                                  // ZIP girdi zaman damgaları sabitlenir
  const sira = Object.keys(zip.files);
  const cikti = new JSZip();
  for (const p of sira) {                                                    // ODF: "mimetype" ilk ve SIKIŞTIRILMAMIŞ olmalı
    const f = zip.files[p];
    if (f.dir) { cikti.folder(p); continue; }
    cikti.file(p, await f.async("uint8array"), { date: t, compression: p === "mimetype" ? "STORE" : "DEFLATE", createFolders: false });
  }
  ozet.push("ZIP girdi tarihleri 1980-01-01'e sabitlendi, arşiv yorumu temizlendi");
  const blob = await cikti.generateAsync({ type: "blob", compression: "DEFLATE", comment: "", mimeType: file.type || undefined });
  return { blob, ozet };
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
 * @param {{JSZip?: any, PDFLib?: any}} kutuphaneler  (yalnızca bellek yolları için, tembel yüklenmiş)
 * @returns {Promise<{blob:Blob, ad:string, tur:string, yontem:"akis"|"bellek", ozet:string[]}>}
 */
export async function metadataTemizle(file, kutuphaneler = {}) {
  const bas = await u8(file.slice(0, 16));
  const tur = turTespit(file.name, bas);
  if (!tur) throw new Error("Desteklenmeyen biçim. (JPEG, PNG, WebP, MP4/MOV/M4A, DOCX/XLSX/PPTX, ODT/ODS/ODP, PDF, ZIP)");
  const akis = ["jpeg", "png", "webp", "iso"].includes(tur);
  if (akis && file.size > AKIS_SINIRI) throw new Error(`Dosya ${AKIS_SINIRI / 1024 ** 3} GB'ı aşıyor. ${CLI_YONERGESI.medya}`);
  if (!akis && file.size > BELLEK_SINIRI) throw new Error(`Bu biçim tarayıcı belleğinde işlenir ve ${BELLEK_SINIRI / 1024 ** 2} MB ile sınırlıdır. ${CLI_YONERGESI.belge}`);
  const r = tur === "jpeg" ? await jpegTemizle(file) : tur === "png" ? await pngTemizle(file) : tur === "webp" ? await webpTemizle(file)
    : tur === "iso" ? await isoTemizle(file) : tur === "pdf" ? await pdfTemizle(file, kutuphaneler.PDFLib) : await zipTemizle(file, tur, kutuphaneler.JSZip);
  const nokta = file.name.lastIndexOf(".");
  const ad = nokta > 0 ? `${file.name.slice(0, nokta)}.temiz${file.name.slice(nokta)}` : `${file.name}.temiz`;
  return { blob: r.blob, ad, tur, yontem: akis ? "akis" : "bellek", ozet: r.ozet };
}

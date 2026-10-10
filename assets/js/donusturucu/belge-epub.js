/*
 * assets/js/donusturucu/belge-epub.js — EPUB 3 yazma (HTML pivotundan) ve okuma (→ HTML pivot). JSZip tabanlı, istemci tarafı.
 *  Yazma : "mimetype" ilk sırada ve SIKIŞTIRILMAMIŞ; bölümler h1 (yoksa h2) başlıklarında ayrılır; data: görseller dosyaya çıkarılır;
 *          nav.xhtml + toc.ncx (EPUB 2 okuyucular için) üretilir.
 *  Okuma : container.xml → OPF → spine sırasıyla XHTML gövdeleri; görseller data: URI'ye gömülür. Zip-bombası sınırı: 500 MB / 5000 giriş.
 */
import { kutuphaneYukle } from "./cdn.js";
import { dataUrlBaytlari, htmlKacis } from "./ortak.js";

const XHTML_NS = "http://www.w3.org/1999/xhtml";
const UZANTI = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg", "image/bmp": "bmp" };
const MIME_UZ = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp" };

const CSS = `body{font-family:serif;line-height:1.5;margin:1em}h1,h2,h3,h4{font-family:sans-serif;line-height:1.25}
img{max-width:100%;height:auto}pre{background:#f3f3f3;padding:.6em;white-space:pre-wrap;overflow-wrap:anywhere}
code{font-family:monospace}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:.3em}th{background:#eee}
blockquote{margin-left:1em;padding-left:1em;border-left:3px solid #aaa;color:#444}`;

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

function xhtmlBolum(baslik, govdeXhtml, dil) {
  return `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="${XHTML_NS}" xmlns:epub="http://www.idpf.org/2007/ops" lang="${dil}" xml:lang="${dil}">\n<head><meta charset="utf-8"/><title>${htmlKacis(baslik)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>\n<body>\n${govdeXhtml}\n</body>\n</html>`;
}

/** @returns {Promise<Blob>} */
export async function htmlDenEpub(html, { baslik = "Belge", yazar = "", dil = "tr" } = {}) {
  const JSZip = await kutuphaneYukle("jszip");
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}`, "text/html");
  const zip = new JSZip();
  const medya = [];

  doc.body.querySelectorAll("img").forEach((img) => {
    const v = dataUrlBaytlari(img.getAttribute("src") || "");
    const uz = v && UZANTI[v.mime.toLowerCase()];
    if (!uz) { img.remove(); return; }
    const ad = `images/img-${medya.length + 1}.${uz}`;
    medya.push({ ad, bayt: v.bayt, mime: v.mime.toLowerCase() });
    img.setAttribute("src", ad);
  });

  // bölümlere ayır
  const cocuklar = [...doc.body.children];
  const h1 = cocuklar.filter((c) => c.localName === "h1").length;
  const bolucu = h1 >= 2 ? "h1" : cocuklar.filter((c) => c.localName === "h2").length >= 2 ? "h2" : null;
  const bolumler = [];
  let guncel = { baslik, dugumler: [] };
  for (const c of cocuklar) {
    if (bolucu && c.localName === bolucu) {
      if (guncel.dugumler.length) bolumler.push(guncel);
      guncel = { baslik: c.textContent.trim().slice(0, 120) || "Bölüm", dugumler: [] };
    }
    guncel.dugumler.push(c);
  }
  if (guncel.dugumler.length || !bolumler.length) bolumler.push(guncel);

  const ser = new XMLSerializer();
  const dosyalar = bolumler.map((b, i) => ({
    ad: `bolum-${String(i + 1).padStart(3, "0")}.xhtml`,
    baslik: b.baslik,
    xhtml: xhtmlBolum(b.baslik, b.dugumler.map((d) => ser.serializeToString(d)).join("\n") || "<p></p>", dil),
  }));

  const kimlik = `urn:uuid:${uuid()}`;
  const tarih = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const manifest = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
    '<item id="css" href="style.css" media-type="text/css"/>',
    ...dosyalar.map((d, i) => `<item id="b${i + 1}" href="${d.ad}" media-type="application/xhtml+xml"/>`),
    ...medya.map((m, i) => `<item id="m${i + 1}" href="${m.ad}" media-type="${m.mime}"/>`),
  ].join("\n    ");
  const spine = dosyalar.map((_, i) => `<itemref idref="b${i + 1}"/>`).join("\n    ");

  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml", `<?xml version="1.0"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  zip.file("OEBPS/content.opf", `<?xml version="1.0" encoding="utf-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="${dil}">\n  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n    <dc:identifier id="uid">${kimlik}</dc:identifier>\n    <dc:title>${htmlKacis(baslik)}</dc:title>\n    <dc:language>${dil}</dc:language>${yazar ? `\n    <dc:creator>${htmlKacis(yazar)}</dc:creator>` : ""}\n    <meta property="dcterms:modified">${tarih}</meta>\n  </metadata>\n  <manifest>\n    ${manifest}\n  </manifest>\n  <spine toc="ncx">\n    ${spine}\n  </spine>\n</package>`);
  zip.file("OEBPS/style.css", CSS);
  zip.file("OEBPS/nav.xhtml", `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="${XHTML_NS}" xmlns:epub="http://www.idpf.org/2007/ops" lang="${dil}"><head><meta charset="utf-8"/><title>İçindekiler</title></head><body><nav epub:type="toc" id="toc"><h1>İçindekiler</h1><ol>${dosyalar.map((d) => `<li><a href="${d.ad}">${htmlKacis(d.baslik)}</a></li>`).join("")}</ol></nav></body></html>`);
  zip.file("OEBPS/toc.ncx", `<?xml version="1.0" encoding="utf-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="${kimlik}"/></head><docTitle><text>${htmlKacis(baslik)}</text></docTitle><navMap>${dosyalar.map((d, i) => `<navPoint id="n${i + 1}" playOrder="${i + 1}"><navLabel><text>${htmlKacis(d.baslik)}</text></navLabel><content src="${d.ad}"/></navPoint>`).join("")}</navMap></ncx>`);
  for (const d of dosyalar) zip.file(`OEBPS/${d.ad}`, d.xhtml);
  for (const m of medya) zip.file(`OEBPS/${m.ad}`, m.bayt);
  return zip.generateAsync({ type: "blob", mimeType: "application/epub+zip", compression: "DEFLATE" });
}

/* ------------------------------------ okuma ------------------------------------ */

function yolCoz(taban, goreli) {
  const parcalar = (taban ? taban.split("/").slice(0, -1) : []);
  for (const p of decodeURIComponent(goreli.split("#")[0]).split("/")) {
    if (p === "..") parcalar.pop();
    else if (p && p !== ".") parcalar.push(p);
  }
  return parcalar.join("/");
}

function xmlAyristir(metin, tur = "application/xml") {
  const d = new DOMParser().parseFromString(metin, tur);
  return d.getElementsByTagName("parsererror").length ? null : d;
}

/** @returns {Promise<{html:string, baslik:string, yazar:string}>} */
export async function epubOku(arrayBuffer) {
  const JSZip = await kutuphaneYukle("jszip");
  const zip = await JSZip.loadAsync(arrayBuffer);
  const girisler = Object.values(zip.files).filter((f) => !f.dir);
  if (girisler.length > 5000) throw new Error("EPUB çok fazla dosya içeriyor (güvenlik sınırı).");
  const toplam = girisler.reduce((a, f) => a + (f._data?.uncompressedSize || 0), 0);
  if (toplam > 500 * 1024 * 1024) throw new Error("EPUB açıldığında çok büyük (güvenlik sınırı: 500 MB).");

  const konteyner = zip.file("META-INF/container.xml");
  if (!konteyner) throw new Error("Geçerli bir EPUB değil (container.xml yok).");
  const kd = xmlAyristir(await konteyner.async("string"));
  const opfYolu = kd?.querySelector("rootfile")?.getAttribute("full-path");
  if (!opfYolu || !zip.file(opfYolu)) throw new Error("EPUB paket dosyası (OPF) bulunamadı.");
  const opf = xmlAyristir(await zip.file(opfYolu).async("string"));
  if (!opf) throw new Error("EPUB paket dosyası okunamadı.");

  const ilk = (ad) => opf.getElementsByTagNameNS("*", ad)[0]?.textContent?.trim() || "";
  const baslik = ilk("title") || "EPUB";
  const yazar = ilk("creator");
  const kayit = new Map();
  for (const it of opf.getElementsByTagNameNS("*", "item")) kayit.set(it.getAttribute("id"), { href: it.getAttribute("href"), tip: it.getAttribute("media-type") });
  const sira = [...opf.getElementsByTagNameNS("*", "itemref")].map((r) => kayit.get(r.getAttribute("idref"))).filter(Boolean);

  const parcalar = [];
  for (const it of sira) {
    if (!/x?html/i.test(it.tip || "")) continue;
    const yol = yolCoz(opfYolu, it.href);
    const dosya = zip.file(yol);
    if (!dosya) continue;
    const metin = await dosya.async("string");
    const d = xmlAyristir(metin, "application/xhtml+xml") || new DOMParser().parseFromString(metin, "text/html");
    const govde = d.getElementsByTagName("body")[0];
    if (!govde) continue;
    for (const img of govde.querySelectorAll("img")) {
      const src = img.getAttribute("src") || "";
      if (/^data:/i.test(src)) continue;
      const g = zip.file(yolCoz(yol, src));
      const uz = (src.split(".").pop() || "").toLowerCase();
      if (g && MIME_UZ[uz]) {
        const b64 = await g.async("base64");
        img.setAttribute("src", `data:${MIME_UZ[uz]};base64,${b64}`);
      } else img.removeAttribute("src");
    }
    // XHTML ad alanı çıktısı yerine temiz iç HTML: ad alanı bilgisini bırakmak için gövde içeriğini yeniden ayrıştır
    parcalar.push(new XMLSerializer().serializeToString(govde).replace(/^<body[^>]*>|<\/body>$/g, ""));
  }
  if (!parcalar.length) throw new Error("EPUB içinde okunabilir bölüm bulunamadı.");
  return { html: parcalar.join("\n"), baslik, yazar };
}

/*
 * assets/js/notlar/disa-aktar/docx.js
 * -----------------------------------------------------------------------
 * Bağımlılıksız Word (.docx, OOXML) üretici. Başlıklar (Heading 1/2), biçimli metin
 * (kalın, italik, altı/üstü çizili, vurgulu), iç içe liste ve yapılacaklar, alıntı
 * stili, ayraç, gömülü görsel (PNG/JPEG/GIF), altbilgide sayfa numarası, belge
 * özellikleri (oluşturma / değiştirme tarihi).
 * -----------------------------------------------------------------------
 */
import { ZipYazici } from "./zip.js";

const GECERSIZ = /[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD]/g;
const xml = (s) =>
  String(s ?? "")
    .replace(GECERSIZ, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

function kosu(r, ekstra = "") {
  if (r.br) return "<w:r><w:br/></w:r>";
  let rpr = ekstra;
  if (r.b) rpr += "<w:b/>";
  if (r.i) rpr += "<w:i/>";
  if (r.s) rpr += "<w:strike/>";
  if (r.mark) rpr += '<w:highlight w:val="yellow"/>';
  if (r.u) rpr += '<w:u w:val="single"/>';
  return `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ""}<w:t xml:space="preserve">${xml(r.text)}</w:t></w:r>`;
}

const par = (icerik, ppr = "") => `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ""}${icerik}</w:p>`;

const STILLER = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${W}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="tr-TR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="120" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:b/><w:color w:val="111827"/><w:sz w:val="44"/><w:szCs w:val="44"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="320" w:after="100"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="111827"/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="220" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="1F2937"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="10" w:color="A3AEC2"/></w:pBdr><w:spacing w:after="100"/><w:ind w:left="420"/></w:pPr><w:rPr><w:i/><w:color w:val="4B5563"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Kunye"><w:name w:val="Kunye"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="20" w:line="260" w:lineRule="auto"/></w:pPr><w:rPr><w:color w:val="6B7280"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="right"/></w:pPr><w:rPr><w:color w:val="9CA3AF"/><w:sz w:val="16"/></w:rPr></w:style>
</w:styles>`;

const EMU = 9525;

/**
 * resimAl(ekId) → {bayt:Uint8Array, tip:"png"|"jpeg"|"gif", g, y} | null
 */
export async function docxUret({ baslik, kunye, bloklar, resimAl, alintilar, yazar, olusturma, guncelleme }) {
  const medya = []; // {ad, bayt}
  let govde = "";

  govde += par(kosu({ text: baslik || "Başlıksız not" }), '<w:pStyle w:val="Title"/>');
  for (const [e, d] of kunye) govde += par(kosu({ text: `${e}: `, b: true }) + kosu({ text: d }), '<w:pStyle w:val="Kunye"/>');
  govde += par("", '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="D1D5DB"/></w:pBdr><w:spacing w:after="160"/>');

  let resimSay = 0;
  for (const b of bloklar) {
    if (b.t === "h") {
      govde += par(b.runs.map((r) => kosu(r)).join(""), `<w:pStyle w:val="Heading${b.s}"/>`);
    } else if (b.t === "p") {
      govde += par(b.runs.map((r) => kosu(r)).join(""));
    } else if (b.t === "li") {
      const sol = 540 + b.d * 360;
      govde += par(
        kosu({ text: b.isaret }) + "<w:r><w:tab/></w:r>" + b.runs.map((r) => kosu(r)).join(""),
        `<w:tabs><w:tab w:val="left" w:pos="${sol}"/></w:tabs><w:spacing w:after="40"/><w:ind w:left="${sol}" w:hanging="360"/>`
      );
    } else if (b.t === "q") {
      govde += par(b.runs.map((r) => kosu(r)).join(""), '<w:pStyle w:val="Quote"/>');
    } else if (b.t === "hr") {
      govde += par("", '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="D1D5DB"/></w:pBdr>');
    } else if (b.t === "img") {
      const r = await resimAl(b.ek);
      if (!r) {
        govde += par(kosu({ text: `[Görsel: ${b.alt || "eklenemedi"}]`, i: true }));
        continue;
      }
      resimSay++;
      const ad = `image${resimSay}.${r.tip === "jpeg" ? "jpg" : r.tip}`;
      medya.push({ ad, bayt: r.bayt });
      let w = r.g;
      let h = r.y;
      const enGen = 600;
      if (w > enGen) {
        h = (h * enGen) / w;
        w = enGen;
      }
      const cx = Math.round(w * EMU);
      const cy = Math.round(h * EMU);
      const rid = `rIdImg${resimSay}`;
      govde += par(
        `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${resimSay}" name="${xml(ad)}" descr="${xml(b.alt)}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${resimSay}" name="${xml(ad)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
      );
    }
  }

  if (alintilar?.length) {
    govde += par(kosu({ text: "Kaynaklı alıntılar" }), '<w:pStyle w:val="Heading1"/>');
    for (const a of alintilar) {
      if (a.alinti.trim()) govde += par(kosu({ text: a.alinti.trim() }), '<w:pStyle w:val="Quote"/>');
      const k = [a.kaynak.trim(), a.sayfa.trim()].filter(Boolean).join(", ");
      if (k) govde += par(kosu({ text: `— ${k}` }), '<w:pStyle w:val="Kunye"/><w:ind w:left="420"/>');
      if (a.yorum.trim()) govde += par(kosu({ text: "Yorumum: ", b: true }) + kosu({ text: a.yorum.trim() }), '<w:ind w:left="420"/><w:spacing w:after="200"/>');
    }
  }

  const belge = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W}><w:body>${govde}<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;

  const altBilgi = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr ${W}><w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr><w:r><w:t xml:space="preserve">${xml((baslik || "").slice(0, 60))}   ·   </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`;

  const iliskiler =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `<Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>` +
    medya.map((m, i) => `<Relationship Id="rIdImg${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${m.ad}"/>`).join("") +
    `</Relationships>`;

  const turler =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
    `<Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/>` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
    `<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>` +
    `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
    `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;

  const kok =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
    `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;

  const iso = (t) => new Date(t).toISOString().replace(/\.\d+Z$/, "Z");
  const cekirdek =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
    `<dc:title>${xml(baslik)}</dc:title>${yazar ? `<dc:creator>${xml(yazar)}</dc:creator>` : ""}` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${iso(olusturma)}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${iso(guncelleme)}</dcterms:modified></cp:coreProperties>`;
  const uygulama = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Notlarım</Application></Properties>`;

  const zip = new ZipYazici();
  const t = new Date(guncelleme);
  await zip.dosyaEkle("[Content_Types].xml", turler, t);
  await zip.dosyaEkle("_rels/.rels", kok, t);
  await zip.dosyaEkle("word/document.xml", belge, t);
  await zip.dosyaEkle("word/styles.xml", STILLER, t);
  await zip.dosyaEkle("word/footer1.xml", altBilgi, t);
  await zip.dosyaEkle("word/_rels/document.xml.rels", iliskiler, t);
  await zip.dosyaEkle("docProps/core.xml", cekirdek, t);
  await zip.dosyaEkle("docProps/app.xml", uygulama, t);
  for (const m of medya) await zip.dosyaEkle(`word/media/${m.ad}`, m.bayt, t);
  const blob = zip.bitir();
  return new Uint8Array(await blob.arrayBuffer());
}

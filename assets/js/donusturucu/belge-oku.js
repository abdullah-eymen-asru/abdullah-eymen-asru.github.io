/*
 * assets/js/donusturucu/belge-oku.js — Her belge türü → TEMİZ HTML pivotu.
 *  docx → mammoth | md → marked (+ YAML ön bilgisi atılır) | html → temizleyici | txt → paragraflar | epub → belge-epub.js | pdf → pdf-metin.js
 */
import { kutuphaneYukle } from "./cdn.js";
import { temizHtml, metinDenHtml } from "./temizle.js";
import { baytlariOku, metinOku, adsizAl } from "./ortak.js";
import { epubOku } from "./belge-epub.js";
import { pdfDenHtml } from "./pdf-metin.js";
import { pdfjsAl } from "./pdf-yukle.js";

const STIL_HARITASI = [
  "p[style-name='Title'] => h1:fresh",
  "p[style-name='Subtitle'] => h2:fresh",
  "p[style-name='Quote'] => blockquote:fresh",
  "p[style-name='Intense Quote'] => blockquote:fresh",
  "p[style-name='Block Text'] => blockquote:fresh",
  "u => u",
  "strike => s",
];

export function yamlOnBilgisiAyir(md) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md);
  return m ? { onBilgi: m[1], govde: md.slice(m[0].length) } : { onBilgi: "", govde: md };
}

export async function mdDenHtml(md) {
  const marked = await kutuphaneYukle("marked");
  const { govde } = yamlOnBilgisiAyir(String(md));
  let h = marked.parse(govde, { gfm: true, breaks: false, async: false });
  // yapılacaklar kutuları (input) temizleyicide atılacağından önce simgeye çevrilir
  h = h.replace(/<input[^>]*type="checkbox"[^>]*>/gi, (m) => (/checked/i.test(m) ? "☑ " : "☐ "));
  return temizHtml(h);
}

export async function docxDenHtml(arrayBuffer) {
  const mammoth = await kutuphaneYukle("mammoth");
  const sonuc = await mammoth.convertToHtml({ arrayBuffer }, { styleMap: STIL_HARITASI });
  return temizHtml(sonuc.value);
}

function htmlBaslik(html) {
  const d = new DOMParser().parseFromString(html, "text/html");
  return (d.querySelector("title")?.textContent || "").trim();
}

/**
 * @param {File|Blob} dosya  @param {string} tur  pdf|docx|html|md|txt|epub
 * @param {{ilerle?:Function, iptalKontrol?:Function, parola?:Function}} ctx
 * @returns {Promise<{html:string, baslik:string, yazar?:string, taranmis?:boolean, sayfaSayisi?:number}>}
 */
export async function belgeHtmlAl(dosya, tur, ctx = {}) {
  const ad = adsizAl(dosya.name || "belge");
  switch (tur) {
    case "docx": return { html: await docxDenHtml(await baytlariOku(dosya)), baslik: ad };
    case "md": return { html: await mdDenHtml(await metinOku(dosya)), baslik: ad };
    case "txt": return { html: metinDenHtml(await metinOku(dosya)), baslik: ad };
    case "html": {
      const ham = await metinOku(dosya);
      return { html: await temizHtml(ham), baslik: htmlBaslik(ham) || ad };
    }
    case "epub": {
      const e = await epubOku(await baytlariOku(dosya));
      return { html: await temizHtml(e.html), baslik: e.baslik || ad, yazar: e.yazar };
    }
    case "pdf": {
      const pdfjs = await pdfjsAl();
      const bayt = new Uint8Array(await baytlariOku(dosya));
      const gorev = pdfjs.getDocument({ data: bayt });
      gorev.onPassword = async (cevapVer, neden) => {
        const p = ctx.parola ? await ctx.parola(neden === 2) : null;
        if (p == null) { gorev.destroy(); return; }
        cevapVer(p);
      };
      const pdf = await gorev.promise;
      try {
        const s = await pdfDenHtml(pdf, ctx);
        return { html: await temizHtml(s.html), baslik: ad, taranmis: s.taranmis, sayfaSayisi: s.sayfaSayisi };
      } finally { pdf.destroy(); }
    }
    default: throw new Error(`Okunamayan belge türü: ${tur}`);
  }
}

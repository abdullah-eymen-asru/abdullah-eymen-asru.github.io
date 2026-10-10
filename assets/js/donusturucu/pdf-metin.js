/*
 * assets/js/donusturucu/pdf-metin.js — PDF → HTML pivot (metin çıkarma + sezgisel yapı).
 * PDF'te "paragraf/başlık/liste" yoktur; yalnızca konumlu metin parçaları vardır. Burada:
 *   - parçalar satırlara (y konumu), satırlar paragraflara (dikey boşluk) toplanır,
 *   - gövde yazı boyutunun belirgin üstündeki KISA satırlar başlık (h1-h3) sayılır,
 *   - "•, -, 1." ile başlayan satırlar liste olur, satır sonu tireli sözcükler birleştirilir.
 * Tablolar/çok sütunlu düzen/şekiller birebir korunmaz. Taranmış (görüntü) PDF'lerde metin yoktur → taranmis:true döner.
 */
import { htmlKacis, nefes } from "./ortak.js";

const MADDE = /^\s*([•●▪◦‣∙·*\-–—])\s+(.*)$/;
const NUMARALI = /^\s*(\d{1,3})[.)]\s+(.*)$/;

export async function pdfDenHtml(pdfDoc, { ilerle, iptalKontrol } = {}) {
  const sayfaSayisi = pdfDoc.numPages;
  const satirlarTum = [];
  const boyutSayac = new Map();
  let karakter = 0;

  for (let sn = 1; sn <= sayfaSayisi; sn++) {
    iptalKontrol?.();
    const sayfa = await pdfDoc.getPage(sn);
    const icerik = await sayfa.getTextContent();
    const parcalar = [];
    for (const it of icerik.items) {
      if (!("str" in it) || !it.str) continue;
      const boyut = Math.hypot(it.transform[2], it.transform[3]) || it.height || 10;
      parcalar.push({ s: it.str, x: it.transform[4], y: it.transform[5], boyut, w: it.width, eol: !!it.hasEOL });
    }
    // satırlara grupla (y yakınlığı)
    parcalar.sort((a, b) => (Math.abs(b.y - a.y) < Math.min(a.boyut, b.boyut) * 0.4 ? a.x - b.x : b.y - a.y));
    const satirlar = [];
    for (const p of parcalar) {
      const son = satirlar[satirlar.length - 1];
      if (son && Math.abs(son.y - p.y) < Math.min(son.boyut, p.boyut) * 0.4) {
        const bosluk = p.x - son.sonX;
        son.metin += (bosluk > p.boyut * 0.18 && !son.metin.endsWith(" ") && !p.s.startsWith(" ") ? " " : "") + p.s;
        son.sonX = p.x + p.w;
        son.boyut = Math.max(son.boyut, p.boyut);
      } else satirlar.push({ metin: p.s, y: p.y, x: p.x, sonX: p.x + p.w, boyut: p.boyut, sayfa: sn });
    }
    for (const s of satirlar) {
      s.metin = s.metin.replace(/\s+/g, " ").trim();
      if (!s.metin) continue;
      satirlarTum.push(s);
      karakter += s.metin.length;
      const k = Math.round(s.boyut * 2) / 2;
      boyutSayac.set(k, (boyutSayac.get(k) || 0) + s.metin.length);
    }
    satirlarTum.push({ sayfaSonu: true, sayfa: sn });
    sayfa.cleanup?.();
    ilerle?.(sn / sayfaSayisi, `Metin okunuyor: sayfa ${sn}/${sayfaSayisi}`);
    if (sn % 5 === 0) await nefes();
  }

  if (karakter < Math.max(20, sayfaSayisi * 15)) return { html: "", taranmis: true, sayfaSayisi };

  let govde = 11;
  let enCok = 0;
  for (const [k, n] of boyutSayac) if (n > enCok) { enCok = n; govde = k; }

  const cikti = [];
  let paragraf = [];
  let liste = null; // {ordered, ogeler}
  let oncekiY = null;
  let oncekiSayfa = null;
  let oncekiBoyut = govde;

  const paragrafBitir = () => {
    if (paragraf.length) {
      let m = "";
      for (const s of paragraf) {
        if (!m) { m = s; continue; }
        if (/[A-Za-zÇĞİÖŞÜçğıöşü]-$/.test(m) && /^[a-zçğıöşü]/.test(s)) m = m.slice(0, -1) + s;
        else m += ` ${s}`;
      }
      cikti.push(`<p>${htmlKacis(m)}</p>`);
    }
    paragraf = [];
  };
  const listeBitir = () => {
    if (liste) {
      cikti.push(`<${liste.ordered ? "ol" : "ul"}>${liste.ogeler.map((o) => `<li>${htmlKacis(o)}</li>`).join("")}</${liste.ordered ? "ol" : "ul"}>`);
      liste = null;
    }
  };

  for (const s of satirlarTum) {
    if (s.sayfaSonu) { oncekiY = null; oncekiSayfa = s.sayfa; continue; }
    const oran = s.boyut / govde;
    const bosluk = oncekiY == null ? 0 : Math.abs(oncekiY - s.y);
    const yeniParagraf = oncekiY != null && bosluk > Math.max(s.boyut, oncekiBoyut) * 1.65;
    oncekiY = s.y;
    oncekiBoyut = s.boyut;

    if (oran >= 1.18 && s.metin.length <= 120) {
      paragrafBitir(); listeBitir();
      const lv = oran >= 1.7 ? 1 : oran >= 1.4 ? 2 : 3;
      cikti.push(`<h${lv}>${htmlKacis(s.metin)}</h${lv}>`);
      continue;
    }
    const mm = MADDE.exec(s.metin);
    const nm = !mm && NUMARALI.exec(s.metin);
    if (mm || nm) {
      paragrafBitir();
      const ordered = !!nm;
      if (!liste || liste.ordered !== ordered) { listeBitir(); liste = { ordered, ogeler: [] }; }
      liste.ogeler.push((mm || nm)[2]);
      continue;
    }
    if (liste && !yeniParagraf && s.x > 0) {
      // liste maddesinin devam satırı
      liste.ogeler[liste.ogeler.length - 1] += ` ${s.metin}`;
      continue;
    }
    listeBitir();
    if (yeniParagraf) paragrafBitir();
    paragraf.push(s.metin);
  }
  paragrafBitir(); listeBitir();
  return { html: cikti.join("\n"), taranmis: false, sayfaSayisi };
}

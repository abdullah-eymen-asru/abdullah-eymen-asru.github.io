/*
 * assets/js/uye-disa-aktar/yazicilar.js
 * -----------------------------------------------------------------------
 * Üye listesi yazıcıları: CSV · Excel (.xlsx) · TXT · PDF. Hepsi tarayıcıda, bağımlılıksız üretilir;
 * veri sunucuya geri gönderilmez. Zip/PDF altyapısı Notlarım dışa aktarmasındaki modüllerle ORTAKTIR.
 * -----------------------------------------------------------------------
 */
import { ZipYazici } from "../notlar/disa-aktar/zip.js";
import { PdfBelge } from "../notlar/disa-aktar/pdf.js";

export const ROL_ETIKETLERI = { user: "Üye", special_user: "Özel Üye", editor: "Editör", manager: "İçerik Sorumlusu", admin: "Yönetici", owner: "Site Sahibi" };

const p2 = (n) => String(n).padStart(2, "0");
export function tarihMetni(v, saatli = false) {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  const gun = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  return saatli ? `${gun} ${p2(d.getHours())}:${p2(d.getMinutes())}` : gun;
}
const evetHayir = (b) => (b ? "Evet" : "Hayır");

/** RPC satırı → sütun sırası/başlıkları. Tüm formatlar BU tanımı paylaşır (alan eksikliği olamaz). */
export const SUTUNLAR = [
  { b: "E-posta", d: (u) => u.email || "", g: 32 },
  { b: "Ad", d: (u) => u.first_name || "", g: 16 },
  { b: "Soyad", d: (u) => u.last_name || "", g: 16 },
  { b: "Ad Soyad", d: (u) => u.full_name || "", g: 24 },
  { b: "Rol", d: (u) => ROL_ETIKETLERI[u.role] || u.role || "", g: 16 },
  { b: "Üyelik Tarihi", d: (u) => tarihMetni(u.created_at, true), g: 18 },
  { b: "Hesap Durumu", d: (u) => (u.is_suspended ? "Askıda" : "Aktif"), g: 13 },
  { b: "E-posta Doğrulandı", d: (u) => evetHayir(!!u.email_dogrulama_tarihi), g: 16 },
  { b: "Son Giriş", d: (u) => tarihMetni(u.son_giris_tarihi, true), g: 18 },
  { b: "KVKK Aydınlatma Onayı", d: (u) => evetHayir(u.kvkk_onay_verildi), g: 18 },
  { b: "KVKK Onay Tarihi", d: (u) => tarihMetni(u.kvkk_onay_tarihi, true), g: 18 },
  { b: "KVKK Onay Sürümü", d: (u) => u.kvkk_onay_versiyonu || "", g: 14 },
  { b: "Yurt Dışı Açık Rıza", d: (u) => evetHayir(u.yurtdisi_onay_verildi), g: 16 },
  { b: "Açık Rıza Tarihi", d: (u) => tarihMetni(u.yurtdisi_onay_tarihi, true), g: 18 },
  { b: "Açık Rıza Sürümü", d: (u) => u.yurtdisi_onay_versiyonu || "", g: 14 },
  { b: "Üye ID", d: (u) => u.id || "", g: 38 },
];
const SADECE_EPOSTA = [SUTUNLAR[0]];

const kolonlar = (secenek) => (secenek.sadeceEposta ? SADECE_EPOSTA : SUTUNLAR);

/* ---------- CSV ---------- */
/** Formül enjeksiyonuna karşı: =, +, -, @ ile başlayan hücrelerin başına ' konur (Excel/Sheets formül saymaz). */
const csvGuvenli = (v) => (/^[=+\-@\t\r]/.test(v) ? "'" + v : v);

export function csvUret(uyeler, { ayrac = ";", sadeceEposta = false } = {}) {
  const k = kolonlar({ sadeceEposta });
  const hucre = (v) => {
    const t = csvGuvenli(String(v ?? ""));
    return /[";,\r\n]/.test(t) || t !== t.trim() ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const satirlar = [k.map((c) => hucre(c.b)).join(ayrac), ...uyeler.map((u) => k.map((c) => hucre(c.d(u))).join(ayrac))];
  // BOM: Excel Türkçe karakterleri doğru okusun
  return new Blob(["\uFEFF" + satirlar.join("\r\n") + "\r\n"], { type: "text/csv;charset=utf-8" });
}

/* ---------- TXT ---------- */
export function txtUret(uyeler, { sadeceEposta = false, baslik = "Üye listesi" } = {}) {
  if (sadeceEposta) return new Blob([uyeler.map((u) => u.email).join("\r\n") + "\r\n"], { type: "text/plain;charset=utf-8" });
  const k = SUTUNLAR.filter((c) => c.b !== "Ad Soyad");
  const genis = Math.max(...k.map((c) => c.b.length));
  const bloklar = uyeler.map((u, i) => [`#${i + 1}`, ...k.map((c) => `${c.b.padEnd(genis)} : ${c.d(u)}`)].join("\r\n"));
  const ust = `${baslik} — ${uyeler.length} üye — ${tarihMetni(new Date(), true)}\r\n${"=".repeat(60)}\r\n\r\n`;
  return new Blob([ust + bloklar.join("\r\n\r\n") + "\r\n"], { type: "text/plain;charset=utf-8" });
}

/* ---------- XLSX ---------- */
const xmlKac = (s) =>
  String(s ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function sutunHarfi(i) {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export async function xlsxUret(uyeler, { sadeceEposta = false, sayfaAdi = "Üyeler" } = {}) {
  const k = kolonlar({ sadeceEposta });
  const satir = (degerler, stil) =>
    degerler.map((v, i) => `<c r="${sutunHarfi(i)}#R#" t="inlineStr"${stil ? ` s="${stil}"` : ""}><is><t xml:space="preserve">${xmlKac(v)}</t></is></c>`).join("");
  const satirlar = [k.map((c) => c.b), ...uyeler.map((u) => k.map((c) => c.d(u)))].map(
    (h, i) => `<row r="${i + 1}">${satir(h, i === 0 ? 1 : 0).replace(/#R#/g, String(i + 1))}</row>`
  );
  const son = `${sutunHarfi(k.length - 1)}${uyeler.length + 1}`;
  const sayfa =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${k.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.g}" customWidth="1"/>`).join("")}</cols>` +
    `<sheetData>${satirlar.join("")}</sheetData><autoFilter ref="A1:${son}"/></worksheet>`;
  const z = new ZipYazici();
  const tarih = new Date();
  await z.dosyaEkle("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`, tarih);
  await z.dosyaEkle("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`, tarih);
  await z.dosyaEkle("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlKac(sayfaAdi)}" sheetId="1" r:id="rId1"/></sheets></workbook>`, tarih);
  await z.dosyaEkle("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`, tarih);
  await z.dosyaEkle("xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/></cellXfs></styleSheet>`, tarih);
  await z.dosyaEkle("xl/worksheets/sheet1.xml", sayfa, tarih);
  return new Blob([z.bitir()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

/* ---------- PDF ---------- */
export async function pdfUret(uyeler, { sadeceEposta = false, baslik = "Üye listesi", yazar = "" } = {}) {
  const b = new PdfBelge({ baslik, yazar });
  b.paragraf([{ text: baslik, b: true }], { boyut: 18, sonrasi: 4 });
  b.paragraf([{ text: `${uyeler.length} üye · ${tarihMetni(new Date(), true)}${yazar ? " · " + yazar : ""}` }], { boyut: 9.5, renk: "0.45 0.47 0.52", sonrasi: 6 });
  b.ayrac();
  for (const u of uyeler) {
    if (sadeceEposta) {
      b.paragraf([{ text: u.email || "" }], { boyut: 10.5, satirAraligi: 1.25 });
      continue;
    }
    b.gerekirse(70);
    b.paragraf([{ text: u.full_name || [u.first_name, u.last_name].filter(Boolean).join(" ") || "İsimsiz üye", b: true }, { text: "   " + (u.email || "") }], { boyut: 11, oncesi: 6, sonrasi: 1, birlikte: 3 });
    b.paragraf(
      [{ text: `Rol: ${ROL_ETIKETLERI[u.role] || u.role || ""} · Üyelik: ${tarihMetni(u.created_at)} · Hesap: ${u.is_suspended ? "Askıda" : "Aktif"} · E-posta doğrulandı: ${evetHayir(!!u.email_dogrulama_tarihi)} · Son giriş: ${tarihMetni(u.son_giris_tarihi) || "-"}` }],
      { boyut: 9, renk: "0.3 0.32 0.38", satirAraligi: 1.35 }
    );
    b.paragraf(
      [{ text: `KVKK Aydınlatma: ${evetHayir(u.kvkk_onay_verildi)}${u.kvkk_onay_verildi ? ` (${tarihMetni(u.kvkk_onay_tarihi)}, ${u.kvkk_onay_versiyonu || "-"})` : ""} · Yurt dışı açık rıza: ${evetHayir(u.yurtdisi_onay_verildi)}${u.yurtdisi_onay_verildi ? ` (${tarihMetni(u.yurtdisi_onay_tarihi)}, ${u.yurtdisi_onay_versiyonu || "-"})` : ""}` }],
      { boyut: 9, renk: "0.3 0.32 0.38", satirAraligi: 1.35, sonrasi: 4 }
    );
  }
  return new Blob([await b.bayta(true)], { type: "application/pdf" });
}

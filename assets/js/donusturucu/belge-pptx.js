/*
 * assets/js/donusturucu/belge-pptx.js — PowerPoint (.pptx / .ppt) OKUMA + slayt görüntüleme (canvas) + PDF/görsel/HTML çıktısı.
 * -----------------------------------------------------------------------
 *  • .pptx: OOXML (zip) tarayıcıda ayrıştırılır (JSZip + DOMParser). Konum/boyut, yer tutucu (başlık/gövde) kalıtımı, tema renkleri,
 *    arka plan, metin biçimi (boyut/kalın/italik/altı çizili/renk/hiza/madde işareti), resimler (kırpma dahil), tablolar, gruplar,
 *    dikdörtgen/yuvarlatılmış/elips/çizgi şekilleri çizilir. → tasarım ve mizanpaj SLAYT BAŞINA GÖRÜNTÜ olarak korunur (PDF'e birebir).
 *    Çizilemeyenler (grafik, SmartArt, ses/video, karmaşık şekiller) kutu + etiket olarak gösterilir ve uyarı verilir.
 *  • .ppt (eski ikili biçim): CFB/OLE kapsayıcısı okunur; yalnızca METİN (başlık/gövde) çıkarılır. Tasarım/resim okunamaz → uyarı verilir.
 *  • Diğer biçimlere (DOCX, MD, HTML, TXT, EPUB) HTML pivotu: slayt başlığı + metin + resim + tablo.
 * Dosya hiçbir yere gönderilmez. Satır içi stil/olay yok.
 * -----------------------------------------------------------------------
 */
import { kutuphaneYukle } from "./cdn.js";
import { nefes } from "./ortak.js";

const EMU_PT = 12700;
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/* ------------------------------- XML yardımcıları ------------------------------- */
const xmlAyristir = (s) => new DOMParser().parseFromString(s, "application/xml");
const cocuklar = (d, ad) => [...(d?.children || [])].filter((c) => c.localName === ad);
const cocuk = (d, ad) => cocuklar(d, ad)[0] || null;
const yol = (d, ...adlar) => adlar.reduce((x, a) => (x ? cocuk(x, a) : null), d);
const tum = (d, ad) => [...(d?.getElementsByTagName("*") || [])].filter((c) => c.localName === ad);
const sayi = (v, y = 0) => { if (v == null || v === "") return y; const n = Number(v); return Number.isFinite(n) ? n : y; };
const rid = (d) => d?.getAttributeNS(NS_R, "embed") || d?.getAttribute("r:embed") || d?.getAttributeNS(NS_R, "id") || d?.getAttribute("r:id") || null;

function yolCoz(taban, hedef) {
  if (hedef.startsWith("/")) return hedef.slice(1);
  const p = taban.split("/"); p.pop();
  for (const s of hedef.split("/")) { if (s === "..") p.pop(); else if (s && s !== ".") p.push(s); }
  return p.join("/");
}

async function iliskiler(zip, dosyaYolu) {
  const ad = dosyaYolu.replace(/([^/]+)$/, "_rels/$1.rels");
  const f = zip.file(ad);
  const h = new Map();
  if (!f) return h;
  const d = xmlAyristir(await f.async("string"));
  for (const r of tum(d, "Relationship")) h.set(r.getAttribute("Id"), { hedef: r.getAttribute("Target"), tur: r.getAttribute("Type") || "", dis: r.getAttribute("TargetMode") === "External" });
  return h;
}

/* ------------------------------- renk / tema ------------------------------- */
const VARSAYILAN_TEMA = { dk1: "000000", lt1: "FFFFFF", dk2: "44546A", lt2: "E7E6E6", accent1: "4472C4", accent2: "ED7D31", accent3: "A5A5A5", accent4: "FFC000", accent5: "5B9BD5", accent6: "70AD47", hlink: "0563C1", folHlink: "954F72" };

function temaOku(d) {
  const t = { ...VARSAYILAN_TEMA };
  const sema = tum(d, "clrScheme")[0];
  for (const c of [...(sema?.children || [])]) {
    const ic = c.children[0];
    if (!ic) continue;
    t[c.localName] = (ic.getAttribute("val") && ic.localName === "srgbClr" ? ic.getAttribute("val") : ic.getAttribute("lastClr") || t[c.localName]).toUpperCase();
  }
  const fontlar = { baslik: "Calibri", govde: "Calibri" };
  const mj = tum(d, "majorFont")[0], mn = tum(d, "minorFont")[0];
  const lat = (x) => cocuk(x, "latin")?.getAttribute("typeface");
  if (lat(mj)) fontlar.baslik = lat(mj);
  if (lat(mn)) fontlar.govde = lat(mn);
  return { renk: t, font: fontlar };
}

const kisit = (n, a, b) => Math.max(a, Math.min(b, n));
function hexRgb(h) { return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
function rgbHex(r, g, b) { return [r, g, b].map((v) => kisit(Math.round(v), 0, 255).toString(16).padStart(2, "0")).join("").toUpperCase(); }
function rgbHsl([r, g, b]) { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let h = 0, s = 0; const l = (mx + mn) / 2; if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; } return [h, s, l]; }
function hslRgb([h, s, l]) { if (s === 0) return [l * 255, l * 255, l * 255]; const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q; const f = (t) => { t = (t + 1) % 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; }; return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255]; }

/** DrawingML renk düğümünü ("solidFill" içeriği) #RRGGBB'ye çevirir. */
function renkCoz(dugum, ctx) {
  if (!dugum) return null;
  const k = dugum.children[0] || dugum;
  let hex = null;
  if (k.localName === "srgbClr") hex = (k.getAttribute("val") || "000000").toUpperCase();
  else if (k.localName === "sysClr") hex = (k.getAttribute("lastClr") || "000000").toUpperCase();
  else if (k.localName === "schemeClr") {
    let a = k.getAttribute("val");
    const harita = ctx.renkHaritasi || {};
    a = { tx1: harita.tx1 || "dk1", bg1: harita.bg1 || "lt1", tx2: harita.tx2 || "dk2", bg2: harita.bg2 || "lt2" }[a] || a;
    hex = ctx.tema.renk[a] || (a === "phClr" ? ctx.phClr : null) || "000000";
  } else if (k.localName === "prstClr") hex = { black: "000000", white: "FFFFFF", red: "FF0000", green: "008000", blue: "0000FF", yellow: "FFFF00" }[k.getAttribute("val")] || "000000";
  if (!hex) return null;
  let rgb = hexRgb(hex), hsl = null;
  for (const m of [...k.children]) {
    const v = sayi(m.getAttribute("val")) / 100000;
    if (m.localName === "lumMod" || m.localName === "lumOff") { hsl = hsl || rgbHsl(rgb); hsl[2] = m.localName === "lumMod" ? hsl[2] * v : hsl[2] + v; hsl[2] = kisit(hsl[2], 0, 1); rgb = hslRgb(hsl); }
    else if (m.localName === "tint") rgb = rgb.map((c) => c + (255 - c) * (1 - v));
    else if (m.localName === "shade") rgb = rgb.map((c) => c * v);
  }
  return `#${rgbHex(...rgb)}`;
}

/** spPr benzeri düğümden dolgu: {tur:"duz",renk}|{tur:"resim",rid,kirp}|{tur:"yok"}|null (belirtilmemiş) */
function dolguOku(sp, ctx) {
  if (!sp) return null;
  if (cocuk(sp, "noFill")) return { tur: "yok" };
  const d = cocuk(sp, "solidFill");
  if (d) return { tur: "duz", renk: renkCoz(d, ctx) };
  const g = cocuk(sp, "gradFill");
  if (g) { const ilk = tum(g, "gs")[0]; if (ilk) return { tur: "duz", renk: renkCoz(ilk, ctx) }; }
  const b = cocuk(sp, "blipFill");
  if (b) return { tur: "resim", rid: rid(cocuk(b, "blip")), kirp: kirpOku(cocuk(b, "srcRect")) };
  return null;
}
function kirpOku(r) { return r ? { l: sayi(r.getAttribute("l")) / 100000, t: sayi(r.getAttribute("t")) / 100000, r: sayi(r.getAttribute("r")) / 100000, b: sayi(r.getAttribute("b")) / 100000 } : null; }

/* ------------------------------- yerleşim kalıtımı ------------------------------- */
function phBilgi(sp) {
  const ph = tum(cocuk(cocuk(sp, "nvSpPr") || cocuk(sp, "nvPicPr"), "nvPr"), "ph")[0];
  return ph ? { tur: ph.getAttribute("type") || "body", idx: ph.getAttribute("idx") } : null;
}
function xfrmOku(sp) {
  const x = yol(cocuk(sp, "spPr"), "xfrm") || cocuk(cocuk(sp, "xfrm") ? sp : null, "xfrm") || cocuk(sp, "xfrm");
  if (!x) return null;
  const off = cocuk(x, "off"), ext = cocuk(x, "ext");
  if (!off || !ext) return null;
  return { x: sayi(off.getAttribute("x")), y: sayi(off.getAttribute("y")), cx: sayi(ext.getAttribute("cx")), cy: sayi(ext.getAttribute("cy")), rot: sayi(x.getAttribute("rot")) / 60000, flipH: x.getAttribute("flipH") === "1", flipV: x.getAttribute("flipV") === "1" };
}
function yerTutucuBul(agacKok, ph) {
  if (!ph || !agacKok) return null;
  const adaylar = tum(agacKok, "sp").filter((s) => phBilgi(s));
  return adaylar.find((s) => { const b = phBilgi(s); return (ph.idx != null && b.idx === ph.idx) || (b.tur === ph.tur && (ph.idx == null || b.idx == null)); })
    || adaylar.find((s) => phBilgi(s).tur === ph.tur) || null;
}
function metinStiliVarsayilan(ph, master, lvl) {
  const st = yol(master, "txStyles");
  const grup = !ph ? "otherStyle" : /title/i.test(ph.tur) ? "titleStyle" : /^(body|subTitle|obj|)$/.test(ph.tur) || ph.idx != null ? "bodyStyle" : "otherStyle";
  const l = yol(cocuk(st, grup), `lvl${lvl + 1}pPr`);
  return { sz: sayi(yol(l, "defRPr")?.getAttribute("sz")) / 100 || (grup === "titleStyle" ? 44 : grup === "bodyStyle" ? Math.max(14, 28 - lvl * 4) : 18), renk: yol(l, "defRPr", "solidFill"), algn: l?.getAttribute("algn") || null, madde: grup === "bodyStyle" };
}

/* ------------------------------- ana okuyucu ------------------------------- */
/**
 * @returns {Promise<{tur:"pptx", gen:number, yuk:number, slaytlar:Array, uyarilar:string[]}>}
 * slayt: { no, arka:{renk}|{resim}, ogeler:[...], baslik, notlar }
 */
export async function pptxOku(arrayBuffer, { ilerle, iptalKontrol } = {}) {
  const JSZip = await kutuphaneYukle("jszip");
  let zip;
  try { zip = await JSZip.loadAsync(arrayBuffer); } catch { throw new Error("PPTX dosyası açılamadı (bozuk ya da şifreli olabilir)."); }
  const sunumF = zip.file("ppt/presentation.xml");
  if (!sunumF) throw new Error("Bu dosya geçerli bir PPTX değil (ppt/presentation.xml yok).");
  const sunum = xmlAyristir(await sunumF.async("string"));
  const sz = tum(sunum, "sldSz")[0];
  const gen = sayi(sz?.getAttribute("cx"), 9144000), yuk = sayi(sz?.getAttribute("cy"), 5143500);
  const sunumRel = await iliskiler(zip, "ppt/presentation.xml");
  const sirali = tum(sunum, "sldId").map((s) => sunumRel.get(rid(s))?.hedef).filter(Boolean).map((h) => yolCoz("ppt/presentation.xml", h));
  if (!sirali.length) throw new Error("Sunumda slayt bulunamadı.");

  const temaF = zip.file(/^ppt\/theme\/theme\d+\.xml$/)[0];
  const temaVarsayilan = temaF ? temaOku(xmlAyristir(await temaF.async("string"))) : { renk: VARSAYILAN_TEMA, font: { baslik: "Calibri", govde: "Calibri" } };
  const uyarilar = new Set();
  const medyaOnbellek = new Map();
  const medyaAl = async (yolu) => {
    if (medyaOnbellek.has(yolu)) return medyaOnbellek.get(yolu);
    const f = zip.file(yolu); let v = null;
    if (f) {
      const uz = (yolu.split(".").pop() || "").toLowerCase();
      const mime = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", svg: "image/svg+xml" }[uz];
      if (mime) {
        const blob = new Blob([await f.async("uint8array")], { type: mime });
        v = await new Promise((coz) => { const u = URL.createObjectURL(blob); const im = new Image(); im.onload = () => coz({ img: im, url: u, mime, blob }); im.onerror = () => { URL.revokeObjectURL(u); coz(null); }; im.src = u; });
      } else uyarilar.add(`Desteklenmeyen resim biçimi atlandı (.${uz}).`);
    }
    medyaOnbellek.set(yolu, v); return v;
  };

  const slaytlar = [];
  for (let n = 0; n < sirali.length; n++) {
    iptalKontrol?.();
    ilerle?.(0.05 + 0.4 * (n / sirali.length), `Slayt ${n + 1}/${sirali.length} okunuyor…`);
    const sy = sirali[n];
    const f = zip.file(sy);
    if (!f) continue;
    const sd = xmlAyristir(await f.async("string"));
    const rel = await iliskiler(zip, sy);
    const yerYolu = [...rel.values()].find((r) => /slideLayout$/.test(r.tur))?.hedef;
    const yerAd = yerYolu ? yolCoz(sy, yerYolu) : null;
    const yerD = yerAd && zip.file(yerAd) ? xmlAyristir(await zip.file(yerAd).async("string")) : null;
    const yerRel = yerAd ? await iliskiler(zip, yerAd) : new Map();
    const mastYolu = [...yerRel.values()].find((r) => /slideMaster$/.test(r.tur))?.hedef;
    const mastAd = mastYolu ? yolCoz(yerAd, mastYolu) : null;
    const mastD = mastAd && zip.file(mastAd) ? xmlAyristir(await zip.file(mastAd).async("string")) : null;
    const mastRel = mastAd ? await iliskiler(zip, mastAd) : new Map();
    const temaYolu = [...mastRel.values()].find((r) => /theme$/.test(r.tur))?.hedef;
    const tema = temaYolu && zip.file(yolCoz(mastAd, temaYolu)) ? temaOku(xmlAyristir(await zip.file(yolCoz(mastAd, temaYolu)).async("string"))) : temaVarsayilan;
    const cm = tum(mastD, "clrMap")[0];
    const renkHaritasi = cm ? Object.fromEntries([...cm.attributes].map((a) => [a.name, a.value])) : {};
    const ctx = { tema, renkHaritasi, phClr: null };
    const spTree = tum(sd, "spTree")[0];
    const goster = (sd.documentElement.getAttribute("showMasterSp") !== "0");

    // arka plan: slayt → yerleşim → ana slayt
    const arkaOku = async (belge, relH, bazYol) => {
      const bg = tum(belge, "bg")[0]; if (!bg) return null;
      const bgPr = cocuk(bg, "bgPr");
      if (bgPr) {
        const d = dolguOku(bgPr, ctx);
        if (d?.tur === "duz") return { renk: d.renk };
        if (d?.tur === "resim") { const r = relH.get(d.rid); const m = r && await medyaAl(yolCoz(bazYol, r.hedef)); if (m) return { resim: m }; }
      }
      const ref = cocuk(bg, "bgRef");
      if (ref) { const c = renkCoz(ref, ctx); if (c) return { renk: c }; }
      return null;
    };
    const arka = (await arkaOku(sd, rel, sy)) || (yerD && await arkaOku(yerD, yerRel, yerAd)) || (mastD && await arkaOku(mastD, mastRel, mastAd)) || { renk: "#FFFFFF" };

    const ogeler = [];
    const baglam = { zip, rel, sy, yerD, mastD, yerRel, yerAd, mastRel, mastAd, ctx, tema, medyaAl, uyarilar };
    // ana slayt / yerleşimdeki süs şekilleri (yer tutucu olmayanlar) önce çizilir
    if (goster) {
      for (const [belge, relH, ad] of [[mastD, mastRel, mastAd], [yerD, yerRel, yerAd]]) {
        const agac = belge && tum(belge, "spTree")[0];
        if (agac) await agacIsle(agac, ogeler, { ...baglam, rel: relH, sy: ad }, { ox: 0, oy: 0, sx: 1, sy: 1 }, true);
      }
    }
    if (spTree) await agacIsle(spTree, ogeler, baglam, { ox: 0, oy: 0, sx: 1, sy: 1 }, false);

    // not metni
    let notlar = "";
    const notR = [...rel.values()].find((r) => /notesSlide$/.test(r.tur));
    if (notR && zip.file(yolCoz(sy, notR.hedef))) {
      const nd = xmlAyristir(await zip.file(yolCoz(sy, notR.hedef)).async("string"));
      notlar = tum(nd, "sp").filter((s) => phBilgi(s)?.tur === "body").map((s) => tum(s, "p").map((p) => tum(p, "t").map((t) => t.textContent).join("")).join("\n")).join("\n").trim();
    }
    const baslikOge = ogeler.find((o) => o.tur === "metin" && /title/i.test(o.ph?.tur || "") && o.paragraflar.some((p) => p.metin.trim()));
    slaytlar.push({ no: n + 1, arka, ogeler, baslik: baslikOge ? baslikOge.paragraflar.map((p) => p.metin).join(" ").trim() : "", notlar });
    await nefes();
  }
  return { tur: "pptx", gen, yuk, slaytlar, uyarilar: [...uyarilar], temizle: () => { for (const v of medyaOnbellek.values()) if (v?.url) URL.revokeObjectURL(v.url); medyaOnbellek.clear(); } };
}

function donustur(x, t) { return x ? { ...x, x: t.ox + x.x * t.sx, y: t.oy + x.y * t.sy, cx: x.cx * t.sx, cy: x.cy * t.sy } : null; }

async function agacIsle(agac, ogeler, b, t, yalnizSus) {
  for (const d of [...agac.children]) {
    const ad = d.localName;
    if (ad === "grpSp") {
      const gx = yol(cocuk(d, "grpSpPr"), "xfrm");
      let t2 = t;
      if (gx) {
        const off = cocuk(gx, "off"), ext = cocuk(gx, "ext"), co = cocuk(gx, "chOff"), ce = cocuk(gx, "chExt");
        if (off && ext && co && ce) {
          const sx = sayi(ext.getAttribute("cx")) / (sayi(ce.getAttribute("cx")) || 1), sy2 = sayi(ext.getAttribute("cy")) / (sayi(ce.getAttribute("cy")) || 1);
          t2 = { sx: t.sx * sx, sy: t.sy * sy2, ox: t.ox + (sayi(off.getAttribute("x")) - sayi(co.getAttribute("x")) * sx) * t.sx, oy: t.oy + (sayi(off.getAttribute("y")) - sayi(co.getAttribute("y")) * sy2) * t.sy };
        }
      }
      await agacIsle(d, ogeler, b, t2, yalnizSus);
    } else if (ad === "sp" || ad === "cxnSp") await sekilIsle(d, ogeler, b, t, yalnizSus);
    else if (ad === "pic") { if (!yalnizSus || !phBilgi(d)) await resimIsle(d, ogeler, b, t); }
    else if (ad === "graphicFrame" && !yalnizSus) await cerceveIsle(d, ogeler, b, t);
    else if (ad === "AlternateContent") { const c = cocuk(d, "Choice") || cocuk(d, "Fallback"); if (c) await agacIsle(c, ogeler, b, t, yalnizSus); }
  }
}

async function sekilIsle(sp, ogeler, b, t, yalnizSus) {
  const ph = phBilgi(sp);
  if (yalnizSus && ph) return;                       // yerleşim/ana slayt yer tutucuları slaytta görünmez
  if (ph && /^(sldNum|dt|ftr|hdr)$/.test(ph.tur) && !tum(sp, "t").some((x) => x.textContent.trim())) return;
  let x = xfrmOku(sp);
  if (!x && ph) {
    const y = yerTutucuBul(b.yerD && tum(b.yerD, "spTree")[0], ph), m = yerTutucuBul(b.mastD && tum(b.mastD, "spTree")[0], ph);
    x = xfrmOku(y) || xfrmOku(m);
  }
  if (!x) return;
  x = donustur(x, t);
  const spPr = cocuk(sp, "spPr");
  const geo = yol(spPr, "prstGeom")?.getAttribute("prst") || (cocuk(spPr, "custGeom") ? "ozel" : "rect");
  const stil = cocuk(sp, "style");
  let dolgu = dolguOku(spPr, b.ctx);
  if (!dolgu && stil && sayi(yol(stil, "fillRef")?.getAttribute("idx")) > 0 && !ph) dolgu = { tur: "duz", renk: renkCoz(cocuk(stil, "fillRef"), b.ctx) };
  if (dolgu?.tur === "resim") { const r = b.rel.get(dolgu.rid); const m = r && await b.medyaAl(yolCoz(b.sy, r.hedef)); dolgu = m ? { tur: "resim", medya: m, kirp: dolgu.kirp } : null; }
  const ln = cocuk(spPr, "ln");
  let cizgi = null;
  if (ln && !cocuk(ln, "noFill")) { const c = renkCoz(cocuk(ln, "solidFill"), b.ctx) || (stil ? renkCoz(cocuk(stil, "lnRef"), b.ctx) : null); if (c) cizgi = { renk: c, kalin: sayi(ln.getAttribute("w"), 9525) }; }
  else if (!ln && stil && sayi(yol(stil, "lnRef")?.getAttribute("idx")) > 0 && !ph) { const c = renkCoz(cocuk(stil, "lnRef"), b.ctx); if (c) cizgi = { renk: c, kalin: 9525 }; }

  const govde = cocuk(sp, "txBody");
  const oge = { tur: sp.localName === "cxnSp" || /line|Connector/i.test(geo) ? "cizgi" : "sekil", geo, ...x, dolgu, cizgi, ph };
  if (!["rect", "roundRect", "ellipse", "cizgi", "line", "straightConnector1", "ozel", "round1Rect", "round2SameRect", "flowChartProcess", "rightArrow", "triangle"].includes(geo) && !govde) b.uyarilar.add(`Karmaşık şekiller yaklaşık (dikdörtgen) çizildi (${geo}).`);
  if (govde && tum(govde, "t").some((q) => q.textContent.length)) {
    const gp = cocuk(govde, "bodyPr");
    const ins = (a, v) => sayi(gp?.getAttribute(a), v);
    const olcek = sayi(yol(gp, "normAutofit")?.getAttribute("fontScale"), 100000) / 100000;
    const yerD = ph ? yerTutucuBul(b.yerD && tum(b.yerD, "spTree")[0], ph) : null;
    const yerGp = yerD ? yol(yerD, "txBody", "bodyPr") : null;
    const yerAnchor = yerGp?.getAttribute("anchor");
    Object.assign(oge, {
      tur: oge.tur === "cizgi" ? "cizgi" : "metin",
      ins: { l: ins("lIns", 91440), t: ins("tIns", 45720), r: ins("rIns", 91440), b: ins("bIns", 45720) },
      hizaDikey: gp?.getAttribute("anchor") || yerAnchor || (ph && /title/i.test(ph.tur) ? "ctr" : "t"),
      sarma: gp?.getAttribute("wrap") !== "none",
      paragraflar: paragraflariOku(govde, b, ph, olcek, yerD),
    });
  } else if (oge.tur === "cizgi" || dolgu || cizgi) { /* salt şekil */ } else return;
  ogeler.push(oge);
}

function paragraflariOku(govde, b, ph, olcek, yerD) {
  const sonuc = [];
  const yerListe = yerD ? yol(yerD, "txBody", "lstStyle") : null;
  for (const p of cocuklar(govde, "p")) {
    const pPr = cocuk(p, "pPr");
    const lvl = sayi(pPr?.getAttribute("lvl"));
    const vars = metinStiliVarsayilan(ph, b.mastD, lvl);
    const yerLvl = yol(yerListe, `lvl${lvl + 1}pPr`);
    const yerSz = sayi(yol(yerLvl, "defRPr")?.getAttribute("sz")) / 100;
    const algn = pPr?.getAttribute("algn") || yerLvl?.getAttribute("algn") || vars.algn || "l";
    const marL = pPr?.getAttribute("marL") != null ? sayi(pPr.getAttribute("marL")) : sayi(yerLvl?.getAttribute("marL"), vars.madde ? 342900 * (lvl + 1) : 0);
    const indent = pPr?.getAttribute("indent") != null ? sayi(pPr.getAttribute("indent")) : sayi(yerLvl?.getAttribute("indent"), vars.madde ? -342900 : 0);
    let madde = null;
    if (pPr && cocuk(pPr, "buNone")) madde = null;
    else if (pPr && cocuk(pPr, "buChar")) madde = cocuk(pPr, "buChar").getAttribute("char") || "•";
    else if (pPr && cocuk(pPr, "buAutoNum")) madde = "#";
    else if (!pPr || (!cocuk(pPr, "buNone"))) madde = (yerLvl && cocuk(yerLvl, "buChar")) ? cocuk(yerLvl, "buChar").getAttribute("char") : (vars.madde && ph && ph.tur !== "subTitle" ? "•" : null);
    const satirAraligi = sayi(yol(pPr, "lnSpc", "spcPct")?.getAttribute("val"), 100000) / 100000;
    const once = sayi(yol(pPr, "spcBef", "spcPts")?.getAttribute("val")) / 100;
    const kosular = [];
    let metin = "";
    const kosuEkle = (r, metinStr) => {
      const rPr = cocuk(r, "rPr");
      const sz = (sayi(rPr?.getAttribute("sz")) / 100 || yerSz || vars.sz) * olcek;
      const renkD = cocuk(rPr, "solidFill");
      const varsRenk = `#${b.ctx.tema.renk[(b.ctx.renkHaritasi || {}).tx1 || "dk1"] || "000000"}`;
      const renk = (renkD ? renkCoz(renkD, b.ctx) : null) || renkCoz(vars.renk, b.ctx) || varsRenk;
      const lat = cocuk(rPr, "latin")?.getAttribute("typeface");
      const font = lat ? (lat.startsWith("+mj") ? b.tema.font.baslik : lat.startsWith("+mn") ? b.tema.font.govde : lat) : (ph && /title/i.test(ph.tur) ? b.tema.font.baslik : b.tema.font.govde);
      kosular.push({ m: metinStr, sz, b: rPr?.getAttribute("b") === "1", i: rPr?.getAttribute("i") === "1", u: !!rPr?.getAttribute("u") && rPr.getAttribute("u") !== "none", renk, font });
      metin += metinStr;
    };
    for (const r of [...p.children]) {
      if (r.localName === "r" || r.localName === "fld") kosuEkle(r, tum(r, "t").map((q) => q.textContent).join(""));
      else if (r.localName === "br") { kosular.push({ m: "\n", sz: vars.sz * olcek, br: true }); metin += "\n"; }
    }
    if (!kosular.length) { const e = cocuk(p, "endParaRPr"); kosular.push({ m: "", sz: (sayi(e?.getAttribute("sz")) / 100 || yerSz || vars.sz) * olcek }); }
    sonuc.push({ kosular, metin, lvl, algn, marL, indent, madde, satirAraligi, once });
  }
  return sonuc;
}

async function resimIsle(pic, ogeler, b, t) {
  let x = xfrmOku(pic);
  if (!x) return;
  x = donustur(x, t);
  const bf = cocuk(pic, "blipFill");
  const r = b.rel.get(rid(cocuk(bf, "blip")));
  if (!r) return;
  const m = await b.medyaAl(yolCoz(b.sy, r.hedef));
  if (!m) { b.uyarilar.add("Okunamayan bir resim atlandı."); return; }
  ogeler.push({ tur: "resim", ...x, medya: m, kirp: kirpOku(cocuk(bf, "srcRect")) });
}

async function cerceveIsle(gf, ogeler, b, t) {
  const x0 = yol(gf, "xfrm");
  const off = cocuk(x0, "off"), ext = cocuk(x0, "ext");
  if (!off || !ext) return;
  const x = donustur({ x: sayi(off.getAttribute("x")), y: sayi(off.getAttribute("y")), cx: sayi(ext.getAttribute("cx")), cy: sayi(ext.getAttribute("cy")) }, t);
  const tbl = tum(gf, "tbl")[0];
  if (!tbl) {
    const tur = tum(gf, "graphicData")[0]?.getAttribute("uri") || "";
    const etiket = /chart/i.test(tur) ? "📊 Grafik" : /diagram|dgm/i.test(tur) ? "🧩 SmartArt" : "🔲 Nesne";
    b.uyarilar.add(`${etiket.slice(3)} çizilemedi; yer tutucu kutu gösterildi.`);
    ogeler.push({ tur: "yerTutucu", ...x, etiket });
    return;
  }
  const sutunlar = tum(cocuk(tbl, "tblGrid"), "gridCol").map((g) => sayi(g.getAttribute("w")));
  const toplamW = sutunlar.reduce((a, c) => a + c, 0) || x.cx;
  const satirlar = cocuklar(tbl, "tr").map((tr) => ({
    h: sayi(tr.getAttribute("h")) * t.sy,
    hucreler: cocuklar(tr, "tc").map((tc) => {
      const pr = cocuk(tc, "tcPr");
      const tb = cocuk(tc, "txBody");
      return { dolgu: dolguOku(pr, b.ctx), span: sayi(tc.getAttribute("gridSpan"), 1), birlesik: tc.getAttribute("hMerge") === "1" || tc.getAttribute("vMerge") === "1", paragraflar: tb ? paragraflariOku(tb, b, { tur: "tablo", idx: null }, 1, null) : [] };
    }),
  }));
  // PowerPoint satırı içeriğe göre büyütür; h="0" ya da küçük değerlerde metin yüksekliğinden az olmasın.
  for (const sr of satirlar) {
    const gerek = Math.max(0, ...sr.hucreler.map((hc) => hc.paragraflar.reduce((a, p) => a + Math.max(8, ...p.kosular.map((q) => q.sz || 0)) * EMU_PT * 1.2 * (p.satirAraligi || 1), 0))) + 91440;
    sr.h = Math.max(sr.h, gerek);
  }
  ogeler.push({ tur: "tablo", ...x, sutunlar: sutunlar.map((w) => (w / toplamW) * x.cx), satirlar });
}

/* ------------------------------- canvas çizimi ------------------------------- */
const fontAilesi = (ad) => `"${String(ad || "Calibri").replace(/"/g, "")}", Calibri, "Segoe UI", Roboto, Arial, sans-serif`;

function metinCiz(c, oge, k, kutuX, kutuY, kutuW, kutuH, ins) {
  const iX = kutuX + ins.l * k, iY = kutuY + ins.t * k, iW = Math.max(4, kutuW - (ins.l + ins.r) * k), iH = Math.max(4, kutuH - (ins.t + ins.b) * k);
  const satirlar = []; // {parcalar:[{m,font,renk,u,genislik}], yukseklik, taban, algn, girinti}
  let numaralar = {};
  for (const p of oge.paragraflar) {
    const girinti = Math.max(0, p.marL) * k, ilkGirinti = Math.max(0, p.marL + p.indent) * k;
    const maksSz = Math.max(...p.kosular.map((q) => q.sz), 8);
    const satirYuk = maksSz * EMU_PT * k * 1.2 * (p.satirAraligi || 1);
    let maddeMetin = null;
    if (p.madde === "#") { numaralar[p.lvl] = (numaralar[p.lvl] || 0) + 1; maddeMetin = `${numaralar[p.lvl]}.`; } else { numaralar = {}; if (p.madde) maddeMetin = /^[-]$/u.test(p.madde) ? "•" : p.madde; }
    // belirteçleme: kelime kelime
    const belirtecler = [];
    for (const q of p.kosular) {
      const font = `${q.i ? "italic " : ""}${q.b ? "bold " : ""}${Math.max(4, q.sz * EMU_PT * k)}px ${fontAilesi(q.font)}`;
      if (q.br) { belirtecler.push({ br: true }); continue; }
      for (const parca of q.m.split(/(\s+)/)) if (parca) belirtecler.push({ m: parca, font, renk: q.renk || "#000", u: q.u, sz: q.sz });
    }
    let satir = { parcalar: [], w: 0, algn: p.algn, x0: maddeMetin ? Math.max(girinti, ilkGirinti + 1) : ilkGirinti, maddeX: ilkGirinti, madde: maddeMetin, maddeRenk: p.kosular[0]?.renk, maddeFont: `${Math.max(4, maksSz * EMU_PT * k)}px ${fontAilesi(p.kosular[0]?.font)}`, yuk: satirYuk, once: (satirlar.length ? p.once : 0) * EMU_PT * k };
    const bitir = (son) => { satirlar.push(satir); satir = { parcalar: [], w: 0, algn: p.algn, x0: girinti, madde: null, yuk: satirYuk, once: 0 }; return son; };
    for (const bt of belirtecler) {
      if (bt.br) { bitir(); continue; }
      c.font = bt.font;
      const w = c.measureText(bt.m).width;
      const bos = /^\s+$/.test(bt.m);
      if (oge.sarma && !bos && satir.w + w > iW - satir.x0 && satir.parcalar.length) bitir();
      if (bos && !satir.parcalar.length) continue;
      satir.parcalar.push({ ...bt, w }); satir.w += w;
    }
    satirlar.push(satir);
  }
  const toplamYuk = satirlar.reduce((a, s) => a + s.yuk + s.once, 0);
  let y = oge.hizaDikey === "ctr" ? iY + (iH - toplamYuk) / 2 : oge.hizaDikey === "b" ? iY + iH - toplamYuk : iY;
  for (const s of satirlar) {
    y += s.once;
    const govdeW = s.parcalar.reduce((a, q) => a + q.w, 0);
    const bos = iW - s.x0;
    let x = iX + s.x0 + (s.algn === "ctr" ? (bos - govdeW) / 2 : s.algn === "r" ? bos - govdeW : 0);
    const taban = y + s.yuk * 0.82;
    if (s.madde) { c.font = s.maddeFont; c.fillStyle = s.maddeRenk || "#000"; c.textBaseline = "alphabetic"; c.fillText(s.madde, iX + s.maddeX, taban); }
    for (const q of s.parcalar) {
      c.font = q.font; c.fillStyle = q.renk; c.textBaseline = "alphabetic";
      c.fillText(q.m, x, taban);
      if (q.u) { c.fillRect(x, taban + 2, q.w, Math.max(1, q.sz * EMU_PT * k * 0.06)); }
      x += q.w;
    }
    y += s.yuk;
  }
}

function sekilYolu(c, o, x, y, w, h, k) {
  c.beginPath();
  if (o.geo === "ellipse") c.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  else if (/^round/.test(o.geo) && c.roundRect) c.roundRect(x, y, w, h, Math.min(w, h) * 0.16);
  else if (o.geo === "triangle") { c.moveTo(x + w / 2, y); c.lineTo(x + w, y + h); c.lineTo(x, y + h); c.closePath(); }
  else c.rect(x, y, w, h);
}

/** Slaytı verilen canvas'a çizer. genislikPx: hedef piksel genişliği. */
export async function slaytCiz(model, slayt, canvas, genislikPx = 1600) {
  const k = genislikPx / model.gen;
  canvas.width = Math.round(model.gen * k); canvas.height = Math.round(model.yuk * k);
  const c = canvas.getContext("2d", { alpha: false });
  c.fillStyle = slayt.arka.renk || "#fff"; c.fillRect(0, 0, canvas.width, canvas.height);
  if (slayt.arka.resim) c.drawImage(slayt.arka.resim.img, 0, 0, canvas.width, canvas.height);
  for (const o of slayt.ogeler) {
    const x = o.x * k, y = o.y * k, w = o.cx * k, h = o.cy * k;
    c.save();
    if (o.rot || o.flipH || o.flipV) { c.translate(x + w / 2, y + h / 2); if (o.rot) c.rotate((o.rot * Math.PI) / 180); c.scale(o.flipH ? -1 : 1, o.flipV ? -1 : 1); c.translate(-(x + w / 2), -(y + h / 2)); }
    if (o.tur === "resim") {
      const im = o.medya.img, kr = o.kirp || { l: 0, t: 0, r: 0, b: 0 };
      const sx = im.naturalWidth * kr.l, sy = im.naturalHeight * kr.t, sw = im.naturalWidth * (1 - kr.l - kr.r), sh = im.naturalHeight * (1 - kr.t - kr.b);
      try { c.drawImage(im, sx, sy, Math.max(1, sw), Math.max(1, sh), x, y, w, h); } catch { /* yok say */ }
    } else if (o.tur === "yerTutucu") {
      c.fillStyle = "#f1f3f5"; c.fillRect(x, y, w, h); c.strokeStyle = "#adb5bd"; c.strokeRect(x, y, w, h);
      c.fillStyle = "#495057"; c.font = `${Math.max(12, h * 0.12)}px sans-serif`; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(`${o.etiket} (önizlenemiyor)`, x + w / 2, y + h / 2); c.textAlign = "left";
    } else if (o.tur === "tablo") {
      let yy = y;
      for (const s of o.satirlar) {
        let xx = x, ci = 0;
        for (const hc of s.hucreler) {
          const gw = o.sutunlar.slice(ci, ci + hc.span).reduce((a, v) => a + v, 0) * k; ci += hc.span;
          if (!hc.birlesik) {
            if (hc.dolgu?.tur === "duz" && hc.dolgu.renk) { c.fillStyle = hc.dolgu.renk; c.fillRect(xx, yy, gw, s.h * k); }
            c.strokeStyle = "#8a8a8a"; c.lineWidth = Math.max(1, k * 9525); c.strokeRect(xx, yy, gw, s.h * k);
            metinCiz(c, { paragraflar: hc.paragraflar, hizaDikey: "ctr", sarma: true }, k, xx, yy, gw, s.h * k, { l: 91440, t: 45720, r: 91440, b: 45720 });
          }
          xx += gw;
        }
        yy += s.h * k;
      }
    } else {
      if (o.tur === "cizgi") {
        if (o.cizgi) { c.strokeStyle = o.cizgi.renk; c.lineWidth = Math.max(1, o.cizgi.kalin * k); c.beginPath(); c.moveTo(x, y); c.lineTo(x + w, y + h); c.stroke(); }
      } else {
        if (o.dolgu?.tur === "duz" && o.dolgu.renk) { sekilYolu(c, o, x, y, w, h, k); c.fillStyle = o.dolgu.renk; c.fill(); }
        else if (o.dolgu?.tur === "resim") { c.save(); sekilYolu(c, o, x, y, w, h, k); c.clip(); try { c.drawImage(o.dolgu.medya.img, x, y, w, h); } catch { /* yok say */ } c.restore(); }
        if (o.cizgi) { sekilYolu(c, o, x, y, w, h, k); c.strokeStyle = o.cizgi.renk; c.lineWidth = Math.max(1, o.cizgi.kalin * k); c.stroke(); }
      }
      if (o.tur === "metin" && o.paragraflar) { c.beginPath(); metinCiz(c, o, k, x, y, w, h, o.ins); }
    }
    c.restore();
  }
}

/* ------------------------------- çıktılar ------------------------------- */
const canvasBlob = (cv, mime, kalite) => new Promise((coz, red) => cv.toBlob((b) => (b ? coz(b) : red(new Error("Görüntü üretilemedi."))), mime, kalite));

/** PPTX → PDF: her slayt tek sayfa, sayfa boyutu = slayt boyutu (pt). Tasarım görüntü olarak korunur. */
export async function pptxDenPdf(model, { baslik = "Sunum", ilerle, iptalKontrol, pdfLibAl } = {}) {
  const { PDFDocument } = await pdfLibAl();
  const belge = await PDFDocument.create();
  belge.setTitle(baslik); belge.setCreator("Abdullah Eymen Asru — Belge Çalışma Alanı");
  const cv = document.createElement("canvas");
  for (let i = 0; i < model.slaytlar.length; i++) {
    iptalKontrol?.();
    await slaytCiz(model, model.slaytlar[i], cv, 1920);
    const jpg = await belge.embedJpg(new Uint8Array(await (await canvasBlob(cv, "image/jpeg", 0.92)).arrayBuffer()));
    const sayfa = belge.addPage([model.gen / EMU_PT, model.yuk / EMU_PT]);
    sayfa.drawImage(jpg, { x: 0, y: 0, width: sayfa.getWidth(), height: sayfa.getHeight() });
    ilerle?.(0.5 + 0.45 * ((i + 1) / model.slaytlar.length), `Slayt ${i + 1}/${model.slaytlar.length} PDF'e yazılıyor…`);
    await nefes();
  }
  cv.width = 0; cv.height = 0;
  return new Blob([await belge.save()], { type: "application/pdf" });
}

/** PPTX → slayt görselleri (png/jpg/webp). */
export async function pptxSlaytGorselleri(model, hedef, { adTaban = "slayt", ilerle, iptalKontrol } = {}) {
  const mime = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" }[hedef] || "image/png";
  const cv = document.createElement("canvas"), cikti = [];
  for (let i = 0; i < model.slaytlar.length; i++) {
    iptalKontrol?.();
    await slaytCiz(model, model.slaytlar[i], cv, 1920);
    cikti.push({ blob: await canvasBlob(cv, mime, 0.92), ad: `${adTaban}-slayt-${String(i + 1).padStart(3, "0")}.${hedef}` });
    ilerle?.((i + 1) / model.slaytlar.length, `Slayt ${i + 1}/${model.slaytlar.length} görsele çevriliyor…`);
    await nefes();
  }
  cv.width = 0; cv.height = 0;
  return cikti;
}

const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
async function blobDataUrl(blob) { return new Promise((coz) => { const r = new FileReader(); r.onload = () => coz(r.result); r.onerror = () => coz(""); r.readAsDataURL(blob); }); }

/** PPTX/PPT modeli → HTML pivotu (DOCX/MD/HTML/TXT/EPUB çıktıları için). */
export async function pptxDenHtml(model) {
  const parcalar = [];
  for (const s of model.slaytlar) {
    const baslikOge = s.ogeler.find((o) => o.tur === "metin" && /title/i.test(o.ph?.tur || "") && o.paragraflar.some((p) => p.metin.trim()));
    parcalar.push(`<h2>Slayt ${s.no}${s.baslik ? `: ${esc(s.baslik)}` : ""}</h2>`);
    let liste = false;
    const kapat = () => { if (liste) { parcalar.push("</ul>"); liste = false; } };
    for (const o of s.ogeler) {
      if (o.tur === "metin" && o !== baslikOge) {
        for (const p of o.paragraflar) {
          const m = esc(p.metin).replace(/\n/g, "<br>").trim();
          if (!m) continue;
          const govde = p.kosular.map((q) => { let v = esc(q.m).replace(/\n/g, "<br>"); if (q.b) v = `<strong>${v}</strong>`; if (q.i) v = `<em>${v}</em>`; return v; }).join("");
          if (p.madde) { if (!liste) { parcalar.push("<ul>"); liste = true; } parcalar.push(`<li>${govde}</li>`); }
          else { kapat(); parcalar.push(`<p>${govde}</p>`); }
        }
        kapat();
      } else if (o.tur === "resim") { kapat(); const u = await blobDataUrl(o.medya.blob); if (u) parcalar.push(`<p><img src="${u}" alt=""></p>`); }
      else if (o.tur === "tablo") {
        kapat();
        parcalar.push("<table>" + o.satirlar.map((r, ri) => `<tr>${r.hucreler.filter((h) => !h.birlesik).map((h) => `<${ri === 0 ? "th" : "td"}>${esc(h.paragraflar.map((p) => p.metin).join(" "))}</${ri === 0 ? "th" : "td"}>`).join("")}</tr>`).join("") + "</table>");
      }
    }
    kapat();
    if (s.notlar) parcalar.push(`<blockquote><p><em>Konuşmacı notları:</em> ${esc(s.notlar).replace(/\n/g, "<br>")}</p></blockquote>`);
  }
  return parcalar.join("\n");
}

/* ------------------------------- ESKİ .PPT (yalnızca metin) ------------------------------- */
/** CFB (OLE2) içinden adlandırılmış akışı okur. */
function cfbAkisi(bayt, akisAdi) {
  const dv = new DataView(bayt.buffer, bayt.byteOffset, bayt.byteLength);
  if (dv.getUint32(0, true) !== 0xe011cfd0 || dv.getUint32(4, true) !== 0xe11ab1a1) throw new Error("Geçerli bir .ppt (OLE) dosyası değil.");
  const sektBoy = 1 << dv.getUint16(0x1e, true), miniBoy = 1 << dv.getUint16(0x20, true);
  const bitisli = 0xfffffffe;
  const sektor = (n) => bayt.subarray((n + 1) * sektBoy, (n + 2) * sektBoy);
  const fatSayi = dv.getUint32(0x2c, true), dizinIlk = dv.getUint32(0x30, true), miniKesim = dv.getUint32(0x38, true), miniFatIlk = dv.getUint32(0x3c, true), difatIlk = dv.getUint32(0x44, true), difatSayi = dv.getUint32(0x48, true);
  const difat = [];
  for (let i = 0; i < 109; i++) { const v = dv.getUint32(0x4c + i * 4, true); if (v < 0xfffffffa) difat.push(v); }
  let dn = difatIlk;
  for (let i = 0; i < difatSayi && dn < 0xfffffffa; i++) { const s = sektor(dn), d2 = new DataView(s.buffer, s.byteOffset, s.byteLength); for (let j = 0; j < sektBoy / 4 - 1; j++) { const v = d2.getUint32(j * 4, true); if (v < 0xfffffffa) difat.push(v); } dn = d2.getUint32(sektBoy - 4, true); }
  const fat = [];
  for (const f of difat.slice(0, fatSayi)) { const s = sektor(f), d2 = new DataView(s.buffer, s.byteOffset, s.byteLength); for (let j = 0; j < sektBoy / 4; j++) fat.push(d2.getUint32(j * 4, true)); }
  const zincir = (ilk, tablo) => { const r = []; let n = ilk, g = 0; while (n < 0xfffffff0 && n !== bitisli && g++ < 1e6) { r.push(n); n = tablo[n]; } return r; };
  const oku = (ilk) => { const z = zincir(ilk, fat), cikti = new Uint8Array(z.length * sektBoy); z.forEach((n, i) => cikti.set(sektor(n), i * sektBoy)); return cikti; };
  const dizin = oku(dizinIlk), dd = new DataView(dizin.buffer);
  const girdiler = [];
  for (let o = 0; o + 128 <= dizin.length; o += 128) {
    const ln = dd.getUint16(o + 0x40, true);
    let ad = ""; for (let i = 0; i < Math.max(0, ln / 2 - 1); i++) ad += String.fromCharCode(dd.getUint16(o + i * 2, true));
    girdiler.push({ ad, tur: dizin[o + 0x42], ilk: dd.getUint32(o + 0x74, true), boy: dd.getUint32(o + 0x78, true) });
  }
  const kok = girdiler[0]; const hedef = girdiler.find((g) => g.tur === 2 && g.ad === akisAdi);
  if (!hedef) throw new Error(`.ppt içinde "${akisAdi}" akışı bulunamadı.`);
  if (hedef.boy >= miniKesim) return oku(hedef.ilk).subarray(0, hedef.boy);
  const miniAkis = oku(kok.ilk), miniFatBayt = oku(miniFatIlk), mf = new DataView(miniFatBayt.buffer), miniFat = [];
  for (let i = 0; i < miniFatBayt.length / 4; i++) miniFat.push(mf.getUint32(i * 4, true));
  const z = zincir(hedef.ilk, miniFat), cikti = new Uint8Array(z.length * miniBoy);
  z.forEach((n, i) => cikti.set(miniAkis.subarray(n * miniBoy, (n + 1) * miniBoy), i * miniBoy));
  return cikti.subarray(0, hedef.boy);
}

const CP1252 = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008DŽ\u008F\u0090‘’“”•–—˜™š›œ\u009DžŸ";
const bytesMetin = (u8) => { let s = ""; for (const b of u8) s += b >= 0x80 && b < 0xa0 ? CP1252[b - 0x80] : String.fromCharCode(b); return s; };

/** Eski .ppt → { slaytlar:[{no,baslik,ogeler,...}] } (yalnızca metin; tasarım/resim yok). */
export function pptOku(arrayBuffer) {
  const akis = cfbAkisi(new Uint8Array(arrayBuffer), "PowerPoint Document");
  const dv = new DataView(akis.buffer, akis.byteOffset, akis.byteLength);
  const slaytlar = []; let mevcut = null, sonTur = 4;
  const yeniParagraflar = (metin) => metin.split(/\r|\n/).map((m) => m.replace(/\u000b/g, "\n"));
  const gez = (bas, son, atla) => {
    let o = bas;
    while (o + 8 <= son) {
      const ver = dv.getUint16(o, true) & 0xf, tur = dv.getUint16(o + 2, true), boy = dv.getUint32(o + 4, true);
      const icBas = o + 8, icSon = Math.min(son, icBas + boy);
      if (ver === 0xf) {
        if (tur === 0x03ee) { mevcut = { metinler: [] }; slaytlar.push(mevcut); gez(icBas, icSon, false); mevcut = null; }
        else if (tur === 0x03f8 || tur === 0x03f0 || tur === 0x03f1) { /* ana slayt / notlar */ }
        else gez(icBas, icSon, atla);
      } else if (mevcut) {
        if (tur === 0x0f9f) sonTur = dv.getUint32(icBas, true);
        else if (tur === 0x0fa0) mevcut.metinler.push({ tur: sonTur, m: new TextDecoder("utf-16le").decode(akis.subarray(icBas, icSon)) });
        else if (tur === 0x0fa8) mevcut.metinler.push({ tur: sonTur, m: bytesMetin(akis.subarray(icBas, icSon)) });
      }
      o = icSon;
    }
  };
  gez(0, akis.length, false);
  if (!slaytlar.length) throw new Error("Bu .ppt dosyasında okunabilir slayt metni bulunamadı. PowerPoint/LibreOffice ile .pptx olarak kaydedip tekrar dene.");
  const GEN = 9144000, YUK = 5143500;
  const model = { tur: "ppt", gen: GEN, yuk: YUK, uyarilar: ["Eski .ppt biçimi tarayıcıda yalnızca METİN olarak okunabilir: tasarım, resim ve şekiller aktarılamaz. Tam tasarım için dosyayı .pptx olarak kaydet."], slaytlar: [], temizle() {} };
  slaytlar.forEach((s, i) => {
    const baslik = s.metinler.find((t) => t.tur === 0 || t.tur === 6);
    const govde = s.metinler.filter((t) => t !== baslik && t.m.trim());
    const kos = (m, sz, b) => ({ kosular: [{ m, sz, b, renk: "#000000", font: "Calibri" }], metin: m, lvl: 0, algn: "l", marL: 0, indent: 0, madde: null, satirAraligi: 1, once: 0 });
    const ogeler = [];
    const ins = { l: 91440, t: 45720, r: 91440, b: 45720 };
    if (baslik) ogeler.push({ tur: "metin", geo: "rect", x: 457200, y: 228600, cx: GEN - 914400, cy: 1000000, ins, hizaDikey: "ctr", sarma: true, ph: { tur: "title" }, paragraflar: yeniParagraflar(baslik.m).map((m) => kos(m, 32, true)) });
    if (govde.length) ogeler.push({ tur: "metin", geo: "rect", x: 457200, y: 1400000, cx: GEN - 914400, cy: YUK - 1700000, ins, hizaDikey: "t", sarma: true, ph: { tur: "body" }, paragraflar: govde.flatMap((t) => yeniParagraflar(t.m)).filter((m) => m.trim()).map((m) => ({ ...kos(m, 18, false), madde: "•", marL: 285750, indent: -285750 })) });
    model.slaytlar.push({ no: i + 1, arka: { renk: "#FFFFFF" }, ogeler, baslik: baslik ? baslik.m.replace(/\s+/g, " ").trim() : "", notlar: "" });
  });
  return model;
}
